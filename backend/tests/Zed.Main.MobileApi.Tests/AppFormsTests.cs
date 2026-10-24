using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Zed.Core.Data;
using Zed.Core.Forms;
using Zed.Main.MobileApi.Controllers.Consultancy;

namespace Zed.Main.MobileApi.Tests;

/// <summary>The Admin's rows of dbo.V4AppFormFields and the stored answers, in memory.</summary>
public sealed class FakeAppFormStore : IAppFormStore
{
    public List<AppFormFieldRow> Rows { get; } = [];
    public ConcurrentQueue<(string Form, string ZedId, string Certification, Dictionary<string, string?> Values, string By)> Saved { get; } = new();

    public void Field(string form, string key, bool custom = false, string? label = null, string? type = null, bool? required = null,
        bool enabled = true, int? order = null, string? options = null, string? section = "basic") =>
        Rows.Add(new AppFormFieldRow(form, key, custom, label, null, type, required, enabled, order, custom ? section : null, options, "ADMIN1",
            new DateTime(2026, 10, 1, 10, 0, 0, DateTimeKind.Utc)));

    public Task<IReadOnlyList<AppFormFieldRow>> FieldsAsync(string formKey, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<AppFormFieldRow>>(Rows.Where(r => r.FormKey == formKey).ToList());

    public Task SaveFieldAsync(AppFormFieldRow row, string userId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task SaveOrderAsync(string formKey, IReadOnlyList<(string FieldKey, int SortOrder)> order, string userId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task ResetAsync(string formKey, string fieldKey, CancellationToken ct = default) => throw new NotSupportedException();

    public Task SaveValuesAsync(string formKey, string zedId, string certification, IReadOnlyDictionary<string, string?> values, string submittedBy,
        CancellationToken ct = default)
    {
        Saved.Enqueue((formKey, zedId, certification, new Dictionary<string, string?>(values), submittedBy));
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<AppFormValueRow>> ValuesAsync(string zedId, string certification, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<AppFormValueRow>>([]);
}

public sealed class AppFormsTests : IDisposable
{
    private const string Zed = "ZEDMSME000001";
    private const string Msme = AppFormCatalogue.MsmeBasicInfo;
    private readonly MobileTestHost _host = new();
    private readonly FakeAppFormStore _store = new();
    private HttpClient? _client;

    public void Dispose() => _host.Dispose();

    private HttpClient Client(ISqlExecutor? sql = null, MobileTestHost? host = null) => _client ??= (host ?? _host).WithWebHostBuilder(b => b.ConfigureTestServices(s =>
    {
        if (sql is not null)
        {
            s.RemoveAll<ISqlExecutor>();
            s.AddSingleton(sql);
        }
        s.RemoveAll<IAppFormStore>();
        s.AddSingleton<IAppFormStore>(_store);
    })).CreateClient();

    private async Task<JsonElement> Post(string path, object body, ISqlExecutor? sql = null, MobileTestHost? host = null)
    {
        var r = await Client(sql, host).PostAsync(path, new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"));
        return JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
    }

    private async Task<JsonElement> Definition(string form, MobileTestHost? host = null)
    {
        var r = await Client(host: host).GetAsync("/Forms/Definition?form=" + form);
        return JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
    }

    private static string[] Keys(JsonElement definition) => [.. definition.GetProperty("fields").EnumerateArray().Select(f => f.GetProperty("key").GetString()!)];

    private static JsonElement FieldOf(JsonElement definition, string key) =>
        definition.GetProperty("fields").EnumerateArray().Single(f => f.GetProperty("key").GetString() == key);

    private static void AssertOk(JsonElement e) => Assert.Equal("1", e.GetProperty("status").GetString());

    private static void AssertFail(JsonElement e, string message)
    {
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Equal(message, e.GetProperty("errorMessage").GetString());
    }

    private void Stage(int status = 1) => _host.Sql.Procs["SP_APP_MSME_STATUS"] = _ =>
        FakeSql.Sets([new Dictionary<string, object?> { ["BronzeStatus"] = status, ["SilverStatus"] = 0, ["GoldStatus"] = 0, ["BronzeStatusOfNc"] = 0 }]);

    private IReadOnlyList<(string Name, object? Args)> CallsTo(string name) =>
        _host.Sql.Calls.Where(c => string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase)).ToList();

    private static Dictionary<string, object?> MsmeInfo() => new()
    {
        ["auditsConducted"] = "Yes", ["domesticCustomers"] = "A, B", ["rawMaterialImported"] = "No", ["energySources"] = new[] { "Solar" },
        ["monthlyManufacturingCapacityUnits"] = "Litre", ["monthlyManufacturingCapacityValue"] = "10",
        ["monthlyUtilizationUnits"] = "Litre", ["monthlyUtilizationValue"] = "8",
        ["productDetailsList"] = new[]
        {
            new { productName = "Bolt", exported = "No", productPhoto = new { photoId = "pp1" }, productDescriptionPhoto = new { photoId = "pd1" } },
        },
        ["siteExteriorPhotos"] = new[] { new { photoId = "site1" } },
    };

    private static object MsmeRequest(Dictionary<string, object?>? info = null, object? customFields = null, string? formVersion = null) => new
    {
        userName = Zed, certificationType = "bronze", deviceInfo = new { deviceId = "dev-1" },
        basicInformation = info ?? MsmeInfo(), customFields, formVersion,
    };

    private void CustomMsmeFields()
    {
        _store.Field(Msme, "cf_gst_number", custom: true, label: "GST number", type: AppFieldTypes.Text, required: true, order: 25);
        _store.Field(Msme, "cf_employees", custom: true, label: "Employees", type: AppFieldTypes.Number, required: false, order: 26);
        _store.Field(Msme, "cf_sector", custom: true, label: "Sector", type: AppFieldTypes.Dropdown, required: false, order: 27, options: """["Auto","Textile"]""");
        _store.Field(Msme, "cf_markets", custom: true, label: "Markets", type: AppFieldTypes.MultiSelect, required: false, order: 28, options: """["North","South","East"]""");
        _store.Field(Msme, "cf_iso", custom: true, label: "ISO certified?", type: AppFieldTypes.YesNo, required: false, order: 29);
        _store.Field(Msme, "cf_old", custom: true, label: "Old question", type: AppFieldTypes.Text, required: true, enabled: false, order: 30);
    }

    // ---------------------------------------------------------------- Definition

    [Fact]
    public async Task The_standard_msme_form_on_main_lists_the_legacy_fields_in_order_without_the_selfie()
    {
        var d = await Definition(Msme);
        AssertOk(d);
        Assert.Equal(Msme, d.GetProperty("form").GetString());
        Assert.Matches("^[0-9a-f]{16}$", d.GetProperty("version").GetString()!);
        Assert.Equal(
        [
            "siteExteriorPhotos", "auditsConducted", "productDetailsList", "domesticCustomers", "internationalCustomers", "rawMaterialImported",
            "rawMaterialsList", "monthlyManufacturingCapacityUnits", "monthlyManufacturingCapacityValue", "monthlyUtilizationUnits",
            "monthlyUtilizationValue", "outsourcedProcesses", "energySources",
        ], Keys(d));
        Assert.Equal(2, FieldOf(d, "siteExteriorPhotos").GetProperty("maxItems").GetInt32());
        var products = FieldOf(d, "productDetailsList");
        Assert.Equal("rows", products.GetProperty("type").GetString());
        Assert.Equal(["productName", "exported", "productPhoto", "productDescriptionPhoto"],
            products.GetProperty("columns").EnumerateArray().Select(c => c.GetProperty("key").GetString()));
        var international = FieldOf(d, "internationalCustomers").GetProperty("when");
        Assert.Equal("productDetailsList/exported", international.GetProperty("field").GetString());
        Assert.Equal("Yes", international.GetProperty("equals").GetString());
        var country = FieldOf(d, "rawMaterialsList").GetProperty("columns")[2];
        Assert.Equal("countries", country.GetProperty("optionsSource").GetString());
        Assert.Equal(", ", country.GetProperty("separator").GetString());
        Assert.False(FieldOf(d, "outsourcedProcesses").GetProperty("required").GetBoolean());
        Assert.Equal(8, FieldOf(d, "energySources").GetProperty("options").GetArrayLength());
        Assert.False(FieldOf(d, "auditsConducted").TryGetProperty("help", out _));
    }

    [Fact]
    public async Task The_surveillance_host_adds_the_assessor_selfie_and_the_consultancy_host_has_the_consultant_form_only()
    {
        _host.Settings["Mobile:System"] = "Surveillance";
        var d = await Definition(Msme);
        Assert.Equal("assessorSelfie", Keys(d)[0]);
        Assert.Contains("auditsConducted", Keys(await Definition(AppFormCatalogue.AssessorBasicInfo)));

        using var consultancy = new MobileTestHost();
        consultancy.Settings["Mobile:System"] = "Consultancy";
        _client = null;
        AssertFail(await Definition(Msme, consultancy), "Unknown form.");
        _client = null;
        var c = await Definition(AppFormCatalogue.ConsultantBasicInfo, consultancy);
        Assert.Equal(9, c.GetProperty("sections").GetArrayLength());
        Assert.Equal("occupationalSafety.numOfAccidents", Keys(c)[0]);
        Assert.Equal("decimal", FieldOf(c, "energyManagement.electrical.totalConsumptionPercentage").GetProperty("type").GetString());
        Assert.Equal("A. Electrical", FieldOf(c, "energyManagement.electrical.unit").GetProperty("heading").GetString());
    }

    [Fact]
    public async Task The_definition_has_the_admins_changes_and_a_new_version()
    {
        var standard = (await Definition(AppFormCatalogue.AssessorBasicInfo)).GetProperty("version").GetString();
        _client = null;
        const string Form = AppFormCatalogue.AssessorBasicInfo;
        _store.Field(Form, "auditsConducted", label: "Are financial audits done by a third party?");
        _store.Field(Form, "outsourcedProcesses", required: true, order: 5);
        _store.Field(Form, "energySources", enabled: false);
        _store.Field(Form, "rawMaterialImported", enabled: false);
        _store.Field(Form, "productDetailsList/productDescriptionPhoto", required: false);
        _store.Field(Form, "cf_gst", custom: true, label: "GST number", type: AppFieldTypes.Dropdown, required: true, order: 15, options: """["Yes","Applied"]""");
        _store.Field(Form, "cf_hidden", custom: true, label: "Hidden", type: AppFieldTypes.Text, enabled: false);

        var d = await Definition(Form);
        Assert.NotEqual(standard, d.GetProperty("version").GetString());
        Assert.True(d.GetProperty("numbered").GetBoolean());
        var keys = Keys(d);
        Assert.Equal(["outsourcedProcesses", "auditsConducted", "cf_gst", "productDetailsList"], keys.Take(4));
        // Disabled fields, and a field shown only for a disabled field's answer, are not sent.
        Assert.DoesNotContain("energySources", keys);
        Assert.DoesNotContain("rawMaterialsList", keys);
        Assert.DoesNotContain("cf_hidden", keys);
        Assert.Equal("Are financial audits done by a third party?", FieldOf(d, "auditsConducted").GetProperty("label").GetString());
        Assert.True(FieldOf(d, "outsourcedProcesses").GetProperty("required").GetBoolean());
        var gst = FieldOf(d, "cf_gst");
        Assert.True(gst.GetProperty("custom").GetBoolean());
        Assert.Equal(["Yes", "Applied"], gst.GetProperty("options").EnumerateArray().Select(o => o.GetString()));
        Assert.False(FieldOf(d, "productDetailsList").GetProperty("columns")[3].GetProperty("required").GetBoolean());
    }

    // ---------------------------------------------------------------- MSME submit

    [Fact]
    public async Task A_legacy_msme_request_without_custom_fields_still_works_when_the_admin_requires_one()
    {
        Stage();
        CustomMsmeFields();
        AssertOk(await Post("/Msme/SubmitBasicInformation", MsmeRequest()));
        Assert.Single(CallsTo("SP_APP_MSME_INSERT_BASIC_INFO"));
        Assert.Empty(_store.Saved);
    }

    [Fact]
    public async Task Custom_answers_are_checked_normalised_and_stored_after_the_procedure()
    {
        Stage();
        CustomMsmeFields();
        var version = (await Definition(Msme)).GetProperty("version").GetString();
        var e = await Post("/Msme/SubmitBasicInformation", MsmeRequest(customFields: new Dictionary<string, object>
        {
            ["cf_gst_number"] = " 09ABCDE1234F1Z5 ", ["cf_employees"] = 25, ["cf_sector"] = "textile", ["cf_markets"] = new[] { "south", "North", "South" },
            ["cf_iso"] = true, ["cf_old"] = "ignored (disabled)", ["auditsConducted"] = "ignored (standard)", ["unknown"] = "ignored",
        }, formVersion: version));
        AssertOk(e);
        Assert.Single(CallsTo("SP_APP_MSME_INSERT_BASIC_INFO"));
        var saved = Assert.Single(_store.Saved);
        Assert.Equal((Msme, Zed, "Bronze", Zed), (saved.Form, saved.ZedId, saved.Certification, saved.By));
        Assert.Equal(new Dictionary<string, string?>
        {
            ["cf_gst_number"] = "09ABCDE1234F1Z5", ["cf_employees"] = "25", ["cf_sector"] = "Textile", ["cf_markets"] = """["South","North"]""", ["cf_iso"] = "Yes",
        }, saved.Values);
    }

    [Fact]
    public async Task With_a_form_version_required_fields_are_enforced_and_unanswered_custom_fields_are_cleared()
    {
        Stage();
        CustomMsmeFields();
        var version = (await Definition(Msme)).GetProperty("version").GetString();

        AssertFail(await Post("/Msme/SubmitBasicInformation", MsmeRequest(customFields: new { cf_employees = "3" }, formVersion: version)),
            "Please fill in: GST number.");
        AssertFail(await Post("/Msme/SubmitBasicInformation", MsmeRequest(customFields: new { cf_employees = "3" }, formVersion: "0000000000000000")),
            "Please fill in: GST number. (The form was changed on the server; please refresh it.)");
        var noCustomers = MsmeInfo();
        noCustomers.Remove("domesticCustomers");
        AssertFail(await Post("/Msme/SubmitBasicInformation", MsmeRequest(noCustomers, new { cf_gst_number = "X" }, version)), "Please fill in: Key Domestic Customers.");
        var exported = MsmeInfo();
        exported["productDetailsList"] = new[] { new { productName = "Bolt", exported = "Yes", productPhoto = new { photoId = "pp1" }, productDescriptionPhoto = new { photoId = "pd1" } } };
        AssertFail(await Post("/Msme/SubmitBasicInformation", MsmeRequest(exported, new { cf_gst_number = "X" }, version)), "Please fill in: Key International Customers.");
        var noPhoto = MsmeInfo();
        noPhoto["productDetailsList"] = new[] { new { productName = "Bolt", exported = "No", productPhoto = new { photoId = "pp1" } } };
        AssertFail(await Post("/Msme/SubmitBasicInformation", MsmeRequest(noPhoto, new { cf_gst_number = "X" }, version)),
            "Please fill in Product Label/Description Photo for every entry of Products.");
        Assert.Empty(CallsTo("SP_APP_MSME_INSERT_BASIC_INFO"));

        AssertOk(await Post("/Msme/SubmitBasicInformation", MsmeRequest(customFields: new { cf_gst_number = "X" }, formVersion: version)));
        var saved = Assert.Single(_store.Saved).Values;
        Assert.Equal("X", saved["cf_gst_number"]);
        Assert.True(saved.ContainsKey("cf_employees") && saved["cf_employees"] is null);
        Assert.False(saved.ContainsKey("cf_old"));
    }

    [Fact]
    public async Task Fields_the_admin_disabled_or_made_optional_may_be_left_out()
    {
        Stage();
        _store.Field(Msme, "siteExteriorPhotos", enabled: false);
        _store.Field(Msme, "domesticCustomers", required: false);
        _store.Field(Msme, "productDetailsList", enabled: false);
        var version = (await Definition(Msme)).GetProperty("version").GetString();
        var info = MsmeInfo();
        info.Remove("siteExteriorPhotos");
        info.Remove("domesticCustomers");
        info.Remove("productDetailsList");
        AssertOk(await Post("/Msme/SubmitBasicInformation", MsmeRequest(info, formVersion: version)));
        var args = Assert.Single(CallsTo("SP_APP_MSME_INSERT_BASIC_INFO")).Args;
        Assert.Null(FakeSql.Arg(args, "DomesticCustomers"));
        Assert.Empty(_store.Saved);
    }

    [Fact]
    public async Task A_wrong_custom_answer_is_refused_even_without_a_form_version_and_nothing_is_saved()
    {
        Stage();
        CustomMsmeFields();
        AssertFail(await Post("/Msme/SubmitBasicInformation", MsmeRequest(customFields: new { cf_employees = "many" })), "Employees: please enter a whole number.");
        AssertFail(await Post("/Msme/SubmitBasicInformation", MsmeRequest(customFields: new { cf_sector = "Food" })), "Sector: \"Food\" is not one of the choices.");
        AssertFail(await Post("/Msme/SubmitBasicInformation", MsmeRequest(customFields: new { cf_iso = "Maybe" })), "ISO certified?: please answer Yes or No.");
        Assert.Empty(CallsTo("SP_APP_MSME_INSERT_BASIC_INFO"));
        Assert.Empty(_store.Saved);
    }

    [Fact]
    public async Task Custom_answers_are_not_stored_when_the_procedure_fails_or_the_stage_is_closed()
    {
        CustomMsmeFields();
        Stage(2);
        AssertFail(await Post("/Msme/SubmitBasicInformation", MsmeRequest(customFields: new { cf_gst_number = "X" })), "Invalid Details.");
        Stage();
        _host.Sql.Procs["SP_APP_MSME_INSERT_BASIC_INFO"] = _ => throw new FakeDbException("procedure failed");
        AssertFail(await Post("/Msme/SubmitBasicInformation", MsmeRequest(customFields: new { cf_gst_number = "X" })), "An error has occurred, please try again later.");
        Assert.Empty(_store.Saved);
    }

    // ---------------------------------------------------------------- Site assessment, surveillance and consultancy

    [Fact]
    public async Task Site_assessment_accepts_left_out_energy_sources_and_photos_once_the_admin_made_them_optional()
    {
        using var t = new AssessorTestHost();
        t.Sql.Allot(Zed, "Silver", "ZEDAS0001", "ZEDAS0002");
        t.Fake.Procs["SP_SA_APP_CHECK_STATUS"] = _ => FakeSql.Sets([new Dictionary<string, object?> { ["OpenMeetingSubmitted"] = true, ["ClosingMeetingSubmitted"] = false }]);
        var photo = new { photoId = "pp1", name = "p", timeStamp = "t" };
        object Request(object? customFields = null) => new
        {
            saId = "ZEDAS0001", zedId = Zed, certificationType = "Silver", customFields,
            basicInformation = new { auditsConducted = "Yes", productDetailsList = new[] { new { productName = "Bolt", exported = "No", productPhoto = photo } } },
        };

        const string Error = "An error has occurred, please try again later.";
        AssertFail(await Post("/SA/SubmitBasicInformation", Request(), t.Sql, t.Host), Error);
        _store.Field(AppFormCatalogue.AssessorBasicInfo, "energySources", required: false);
        AssertFail(await Post("/SA/SubmitBasicInformation", Request(), t.Sql, t.Host), Error); // the description photo list is still empty
        _store.Field(AppFormCatalogue.AssessorBasicInfo, "productDetailsList/productDescriptionPhoto", enabled: false);
        _store.Field(AppFormCatalogue.AssessorBasicInfo, "cf_rating", custom: true, label: "Rating", type: AppFieldTypes.Decimal);
        AssertOk(await Post("/SA/SubmitBasicInformation", Request(new { cf_rating = "4.5" }), t.Sql, t.Host));

        var args = t.LastArgs("SP_APP_SA_INSERT_BASIC_INFO");
        Assert.Equal("", AssessorTestHost.Arg(args, "EnergySources"));
        Assert.NotNull(AssessorTestHost.Tvp(args, "ProductPhotos"));
        Assert.Null(AssessorTestHost.Tvp(args, "ProductDescriptionPhotos"));
        var saved = Assert.Single(_store.Saved);
        Assert.Equal((AppFormCatalogue.AssessorBasicInfo, Zed, "Silver", "ZEDAS0001"), (saved.Form, saved.ZedId, saved.Certification, saved.By));
        Assert.Equal("4.5", saved.Values["cf_rating"]);
    }

    [Fact]
    public async Task The_surveillance_app_stores_the_answers_with_the_allotted_assessor()
    {
        using var t = new SurveillanceAppHost();
        t.Sql.Unit(Zed, "Bronze", "ZEDBAS0001");
        _store.Field(Msme, "cf_note", custom: true, label: "Note", type: AppFieldTypes.Text);
        AssertOk(await Post("/Surveillance/SubmitBasicInformation", MsmeRequest(customFields: new { cf_note = "ok" }), t.Sql, t.Host));
        Assert.Single(t.CallsTo("SP_APP_SURVEILLANCE_INSERT_BASIC_INFO"));
        var saved = Assert.Single(_store.Saved);
        Assert.Equal((Msme, Zed, "Bronze", "ZEDBAS0001"), (saved.Form, saved.ZedId, saved.Certification, saved.By));
    }

    [Fact]
    public async Task The_consultant_app_may_leave_out_a_group_whose_fields_are_all_optional()
    {
        using var t = new ConsultancyAppHost();
        t.Sql.Allot(Zed, "Silver", "Lead", "ZEDCC0001");
        t.Fake.Procs["SP_SA_APP_CHECK_STATUS"] = _ => FakeSql.Sets([new Dictionary<string, object?>
        {
            ["SaStatus"] = 1, ["OpenMeetingSubmitted"] = true, ["FinalSubmissionDone"] = false, ["ClosingMeetingSubmitted"] = false, ["LeadAssessor"] = true,
        }]);
        var p = new { unit = "kWh", totalConsumptionPercentage = "10" };
        var info = new Dictionary<string, object?>
        {
            ["occupationalSafety"] = new { numOfAccidents = "1" },
            ["measurementOfTimelyDelivery"] = new { }, ["plannedMaintenanceCalibration"] = new { },
            ["energyManagement"] = new { electrical = p, solar = p, wind = p, fossilFuel = p, gas = p, others = p },
            ["environmentManagement"] = new { }, ["humanResourceManagement"] = new { }, ["measurementAnalysis"] = new { },
            ["naturalResourcesManagement"] = new { },
        };
        object Request() => new { saId = "ZEDCC0001", zedId = Zed, certificationType = "Silver", basicInformation = info, customFields = new { cf_plan = "Yes" } };

        AssertFail(await Post("/SA/SubmitBasicInformation", Request(), t.Sql, t.Host), ConsultancySAController.ErrorText);
        _store.Field(AppFormCatalogue.ConsultantBasicInfo, "financialPerformance.turnover", required: false);
        _store.Field(AppFormCatalogue.ConsultantBasicInfo, "financialPerformance.grossProfit", enabled: false);
        _store.Field(AppFormCatalogue.ConsultantBasicInfo, "cf_plan", custom: true, label: "Plan agreed?", type: AppFieldTypes.YesNo,
            section: "financialPerformance");
        AssertOk(await Post("/SA/SubmitBasicInformation", Request(), t.Sql, t.Host));

        var args = t.LastArgs("SP_APP_SA_CONSULTANCY_INSERT_BASIC_INFO");
        Assert.Equal("1", ConsultancyAppHost.Arg(args, "NumOfAccidents"));
        Assert.Null(ConsultancyAppHost.Arg(args, "Turnover"));
        var saved = Assert.Single(_store.Saved);
        Assert.Equal((AppFormCatalogue.ConsultantBasicInfo, "ZEDCC0001"), (saved.Form, saved.By));
        Assert.Equal("Yes", saved.Values["cf_plan"]);
    }
}
