using System.Collections;
using System.Net;
using System.Net.Http.Json;
using Zed.Core.Forms;
using Zed.Portal.Features.Staff.Assessment;
using Zed.Portal.Features.Staff.Settings;

namespace Zed.Main.Api.Tests.Staff;

public sealed class AppFormsTests : IDisposable
{
    private const string Url = "/api/staff/settings/app-forms";
    private const string Msme = AppFormCatalogue.MsmeBasicInfo;
    private readonly TestHost _host = new();
    private readonly List<AppFormFieldRow> _rows = [];

    public AppFormsTests()
    {
        UsersMastersLogin.Setup(_host);
        _host.Sql.Queries[SqlAppFormStore.FieldsSql] = args => _rows.Where(r => r.FormKey == Value(args, "FormKey")).ToList();
    }

    public void Dispose() => _host.Dispose();

    private static string? Value(object? args, string name) => args?.GetType().GetProperty(name)?.GetValue(args) switch
    {
        Dapper.DbString s => s.Value,
        var v => v?.ToString(),
    };

    private void Stored(string key, bool custom = false, string? label = null, string? type = null, bool? required = null, bool enabled = true,
        int? order = null, string? options = null) =>
        _rows.Add(new AppFormFieldRow(Msme, key, custom, label, null, type, required, enabled, order, custom ? "basic" : null, options, "ADMIN1",
            new DateTime(2026, 10, 1, 10, 0, 0)));

    private List<(string Name, object? Args)> Writes() =>
        _host.Sql.Calls.Where(c => c.Name.StartsWith("MERGE dbo.V4AppForm") || c.Name.StartsWith("DELETE FROM dbo.V4AppForm")).ToList();

    private (string Name, object? Args) LastWrite() => Writes().Last();

    private Task<HttpClient> Admin() => UsersMastersLogin.SignInAsync(_host, "ADMIN1");

    private static async Task AssertProblem(HttpResponseMessage r, string title)
    {
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal(title, await r.ProblemTitle());
    }

    [Fact]
    public async Task Only_the_Admin_sees_and_changes_the_forms()
    {
        var anonymous = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(Url)).StatusCode);
        foreach (var user in new[] { "MASTER1", "AGENCY1", "SUPER1", "ASSESSOR1" })
        {
            var other = await UsersMastersLogin.SignInAsync(_host, user);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync(Url)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync($"{Url}/{Msme}")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.PostAsJsonAsync($"{Url}/{Msme}/fields", new { label = "X", type = "text" })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.PutAsJsonAsync($"{Url}/{Msme}/enabled", new { key = "auditsConducted", enabled = false })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await other.PostAsJsonAsync($"{Url}/{Msme}/reset", new { key = "auditsConducted" })).StatusCode);
        }
        Assert.Empty(Writes());
    }

    [Fact]
    public async Task Lists_this_systems_forms_and_the_fields_with_the_admins_changes()
    {
        Stored("auditsConducted", label: "Audited by a third party?");
        Stored("cf_sector", custom: true, label: "Sector", type: "dropdown", required: true, enabled: false, order: 35, options: """["Auto","Textile"]""");
        var admin = await Admin();

        var forms = (await admin.GetFromJsonAsync<List<AppFormsController.FormItem>>(Url))!;
        Assert.Equal([Msme, AppFormCatalogue.AssessorBasicInfo], forms.Select(f => f.Key));
        Assert.Equal((1, 1), (forms[0].CustomFields, forms[0].Disabled));

        var form = (await admin.GetFromJsonAsync<AppFormsController.FormDetails>($"{Url}/{Msme}"))!;
        Assert.Equal(AppFieldTypes.Custom, form.CustomTypes);
        Assert.Equal("basic", Assert.Single(form.Sections).Key);
        // Main has no selfie (Bronze surveillance only).
        Assert.Equal(["siteExteriorPhotos", "auditsConducted", "cf_sector", "productDetailsList"], form.Fields.Take(4).Select(f => f.Key));
        var audits = form.Fields.Single(f => f.Key == "auditsConducted");
        Assert.Equal(("Audited by a third party?", "Whether 3rd Party Financial Audits are conducted?", true), (audits.Label, audits.StandardLabel, audits.Customised));
        var sector = form.Fields.Single(f => f.Key == "cf_sector");
        Assert.True(sector is { Custom: true, Enabled: false, Required: true, StandardLabel: null });
        Assert.Equal(["Auto", "Textile"], sector.Options!);
        var products = form.Fields.Single(f => f.Key == "productDetailsList");
        Assert.Equal("productDetailsList/productName", products.Columns![0].Key);
        Assert.Equal("Whether Exported? is Yes", form.Fields.Single(f => f.Key == "internationalCustomers").ShownWhen);

        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"{Url}/{AppFormCatalogue.ConsultantBasicInfo}")).StatusCode);
    }

    [Fact]
    public async Task A_standard_field_keeps_its_type_and_only_what_differs_is_stored()
    {
        var admin = await Admin();
        (await admin.PutAsJsonAsync($"{Url}/{Msme}/fields",
            new { key = "outsourcedProcesses", label = " Processes Outsourced, if any ", help = "List them", required = true, enabled = true })).EnsureSuccessStatusCode();
        var (sql, args) = LastWrite();
        Assert.StartsWith("MERGE dbo.V4AppFormFields", sql);
        Assert.Equal(("outsourcedProcesses", null, "List them", "True", "True", null), (Value(args, "FieldKey"), Value(args, "Label"), Value(args, "Help"),
            Value(args, "Required"), Value(args, "Enabled"), Value(args, "Type")));
        Assert.Equal("False", Value(args, "Custom"));

        // A column of a row field; nothing differs from the standard: the row is removed.
        (await admin.PutAsJsonAsync($"{Url}/{Msme}/fields",
            new { key = "productDetailsList/productName", label = "Name of Product manufactured", required = true, enabled = true })).EnsureSuccessStatusCode();
        Assert.StartsWith("DELETE FROM dbo.V4AppFormFields", LastWrite().Name);
        Assert.Equal("productDetailsList/productName", Value(LastWrite().Args, "FieldKey"));

        var before = Writes().Count;
        await AssertProblem(await admin.PutAsJsonAsync($"{Url}/{Msme}/fields", new { key = "auditsConducted", label = "X", type = "text", required = true }),
            "The type of a standard field cannot be changed.");
        await AssertProblem(await admin.PutAsJsonAsync($"{Url}/{Msme}/fields", new { key = "auditsConducted", label = " ", required = true }), "Please enter the label.");
        await AssertProblem(await admin.PutAsJsonAsync($"{Url}/{Msme}/fields", new { key = "auditsConducted", label = new string('x', 201), required = true }),
            "The label is too long (200 characters at most).");
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync($"{Url}/{Msme}/fields", new { key = "assessorSelfie", label = "X" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync($"{Url}/unknown.form/fields", new { key = "x", label = "X" })).StatusCode);
        Assert.Equal(before, Writes().Count);
    }

    [Fact]
    public async Task Adds_a_field_of_the_admins_own_with_its_choices()
    {
        Stored("cf_sector_of_the_unit", custom: true, label: "Sector of the unit", type: "text", order: 500);
        var admin = await Admin();
        var r = await admin.PostAsJsonAsync($"{Url}/{Msme}/fields",
            new { label = "Sector of the unit", help = "Main sector", type = "Dropdown", required = true, options = new[] { "Auto", " Textile ", "" } });
        r.EnsureSuccessStatusCode();
        var added = (await r.Content.ReadFromJsonAsync<AppFormsController.AddedResponse>())!;
        Assert.Equal("cf_sector_of_the_unit_2", added.Key);
        var args = LastWrite().Args;
        Assert.Equal(("True", "dropdown", "basic", "True", """["Auto","Textile"]""", "510"), (Value(args, "Custom"), Value(args, "Type"), Value(args, "Section"),
            Value(args, "Required"), Value(args, "OptionsJson"), Value(args, "SortOrder")));

        var before = Writes().Count;
        await AssertProblem(await admin.PostAsJsonAsync($"{Url}/{Msme}/fields", new { label = "Sector", type = "checkboxes", options = Array.Empty<string>() }),
            "Please add at least one choice.");
        await AssertProblem(await admin.PostAsJsonAsync($"{Url}/{Msme}/fields", new { label = "Sector", type = "multiselect", options = new[] { "A", "a" } }),
            "The choice \"a\" is listed twice.");
        await AssertProblem(await admin.PostAsJsonAsync($"{Url}/{Msme}/fields", new { label = "Photo", type = "photo" }), "Please choose the type of the field.");
        await AssertProblem(await admin.PostAsJsonAsync($"{Url}/{Msme}/fields", new { label = "X", type = "text", section = "energyManagement" }), "Unknown section.");
        Assert.Equal(before, Writes().Count);
    }

    [Fact]
    public async Task Disables_reorders_and_resets_fields()
    {
        Stored("cf_sector", custom: true, label: "Sector", type: "dropdown", required: true, order: 25, options: """["Auto"]""");
        Stored("auditsConducted", label: "Audited?");
        var admin = await Admin();

        (await admin.PutAsJsonAsync($"{Url}/{Msme}/enabled", new { key = "cf_sector", enabled = false })).EnsureSuccessStatusCode();
        var args = LastWrite().Args;
        Assert.Equal(("cf_sector", "False", "Sector", "dropdown", """["Auto"]"""), (Value(args, "FieldKey"), Value(args, "Enabled"), Value(args, "Label"),
            Value(args, "Type"), Value(args, "OptionsJson")));
        (await admin.PutAsJsonAsync($"{Url}/{Msme}/enabled", new { key = "auditsConducted", enabled = false })).EnsureSuccessStatusCode();
        Assert.Equal(("Audited?", "False"), (Value(LastWrite().Args, "Label"), Value(LastWrite().Args, "Enabled")));

        var form = (await admin.GetFromJsonAsync<AppFormsController.FormDetails>($"{Url}/{Msme}"))!;
        var keys = form.Fields.Select(f => f.Key).Reverse().ToList();
        (await admin.PutAsJsonAsync($"{Url}/{Msme}/order", new { section = "basic", keys })).EnsureSuccessStatusCode();
        var order = Assert.IsAssignableFrom<IEnumerable>(LastWrite().Args).Cast<object>().ToList();
        Assert.Equal(keys.Count, order.Count);
        Assert.Equal((keys[0], "10"), (Value(order[0], "FieldKey"), Value(order[0], "SortOrder")));
        await AssertProblem(await admin.PutAsJsonAsync($"{Url}/{Msme}/order", new { section = "basic", keys = keys.Skip(1) }),
            "The list of fields does not match the form. Please reload the page.");

        (await admin.PostAsJsonAsync($"{Url}/{Msme}/reset", new { key = "auditsConducted" })).EnsureSuccessStatusCode();
        Assert.StartsWith("DELETE FROM dbo.V4AppFormFields", LastWrite().Name);
        await AssertProblem(await admin.PostAsJsonAsync($"{Url}/{Msme}/reset", new { key = "cf_sector" }),
            "A field you added cannot be reset. Disable it instead; its answers are kept.");
    }

    // ---------------------------------------------------------------- answers on the desktop-assessment page

    [Fact]
    public async Task Staff_who_may_open_the_assessment_see_the_answers_to_the_admins_fields()
    {
        const string Zed = "ZEDMSME000001";
        Stored("cf_markets", custom: true, label: "Markets", type: "multiselect", order: 25, options: """["North","South"]""", enabled: false);
        Stored("cf_note", custom: true, label: "Note", type: "text", order: 26);
        _host.Sql.Queries[AssessmentRecords.CertificationSql] = _ => [new { ZedId = Zed, Certification = "Bronze", CertificationStatus = 3, CertificationBodyUserId = "AGENCY2" }];
        _host.Sql.Queries[SqlAppFormStore.ValuesSql] = _ =>
        [
            new AppFormValueRow(Msme, Zed, "Bronze", "cf_note", "Exports soon", Zed, new DateTime(2026, 10, 2)),
            new AppFormValueRow(Msme, Zed, "Bronze", "cf_markets", """["South","North"]""", Zed, new DateTime(2026, 10, 2)),
            new AppFormValueRow(AppFormCatalogue.AssessorBasicInfo, Zed, "Bronze", "cf_gone", "", "ZEDAS0001", null),
        ];
        const string Values = "/api/staff/app-form-values/" + Zed + "/bronze";

        var master = await UsersMastersLogin.SignInAsync(_host, "MASTER1");
        var result = (await master.GetFromJsonAsync<List<AppFormValuesController.FormValues>>(Values))!;
        var form = Assert.Single(result);
        Assert.Equal(Msme, form.Form);
        Assert.Equal([("cf_markets", "Markets", "South, North", false), ("cf_note", "Note", "Exports soon", true)],
            form.Values.Select(v => (v.Key, v.Label, v.Value, v.Enabled)));

        Assert.Equal(HttpStatusCode.NotFound, (await (await UsersMastersLogin.SignInAsync(_host, "AGENCY1")).GetAsync(Values)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await (await UsersMastersLogin.SignInAsync(_host, "AGENCY2")).GetAsync(Values)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await (await Admin()).GetAsync(Values)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await master.GetAsync("/api/staff/app-form-values/" + Zed + "/Platinum")).StatusCode);
    }
}
