using System.Collections.Concurrent;
using System.Data;
using System.Net;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Zed.Core.Data;
using Zed.Core.Mobile;
using Zed.Main.MobileApi.Models;

namespace Zed.Main.MobileApi.Tests;

/// <summary>
/// The mobile host as the Surveillance deployment (Mobile:System = Surveillance), with the database faked and the
/// MsmeCertifications rows of the per-call checks answered from <see cref="SurveillanceSql.Units"/>.
/// </summary>
public sealed class SurveillanceAppHost : IDisposable
{
    public MobileTestHost Host { get; } = new();
    public SurveillanceSql Sql { get; }
    private WebApplicationFactory<Program>? _factory;
    private HttpClient? _client;

    public SurveillanceAppHost()
    {
        Sql = new SurveillanceSql(Host.Sql);
        Host.Settings["Mobile:System"] = "Surveillance";
    }

    public FakeSql Fake => Host.Sql;
    public FakeDevices Devices => Host.Devices;
    public Dictionary<string, string?> Settings => Host.Settings;

    public HttpClient Client => _client ??= (_factory = Host.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
    {
        s.RemoveAll<ISqlExecutor>();
        s.AddSingleton<ISqlExecutor>(Sql);
    }))).CreateClient();

    public async Task<(JsonElement Body, HttpStatusCode Status)> Send(string path, HttpContent content)
    {
        var r = await Client.PostAsync(path, content);
        return (JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement, r.StatusCode);
    }

    public async Task<JsonElement> Json(string path, object body) =>
        (await Send(path, new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"))).Body;

    public IReadOnlyList<(string Name, object? Args)> CallsTo(string name) =>
        Fake.Calls.Where(c => string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase)).ToList();

    public object? Args(string name) => Assert.Single(CallsTo(name)).Args;

    public static string? Arg(object? args, string name) => FakeSql.Arg(args, name);

    public static DataTable? Tvp(object? args, string name)
    {
        if (args is not Dapper.DynamicParameters dp || !dp.ParameterNames.Contains(name)) return null;
        var tvp = dp.Get<object>(name);
        return tvp.GetType().GetFields(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public)
            .Select(f => f.GetValue(tvp)).OfType<DataTable>().Single();
    }

    public string FileUnderRoot(params string[] parts) => Path.Combine([Host.StorageRoot, .. parts]);

    public IEnumerable<string> AllFiles() =>
        Directory.Exists(Host.StorageRoot) ? Directory.EnumerateFiles(Host.StorageRoot, "*", SearchOption.AllDirectories) : [];

    public void Dispose()
    {
        _client?.Dispose();
        _factory?.Dispose();
        Host.Dispose();
    }
}

/// <summary>FakeSql plus the MsmeCertifications rows the surveillance checks read with inline SQL.</summary>
public sealed class SurveillanceSql(FakeSql inner) : ISqlExecutor
{
    public ConcurrentDictionary<string, List<SurveillanceUnit>> Units { get; } = new(StringComparer.OrdinalIgnoreCase);

    public SurveillanceUnit Unit(string zedId, string cert, string? desktopAssessor, int status = 1, int ncCount = 0, int ncStatus = 0, string? siteAssessor = null)
    {
        var u = new SurveillanceUnit
        {
            Certification = cert, DesktopAssessorId = desktopAssessor, SiteAssessorId = siteAssessor, CertificationStatus = status, NcCount = ncCount,
        };
        if (ncCount is >= 1 and <= 5) typeof(SurveillanceUnit).GetProperty($"Nc{ncCount}Status")!.SetValue(u, ncStatus);
        Units.GetOrAdd(zedId, _ => []).Add(u);
        return u;
    }

    public Task<IReadOnlyList<T>> QueryProcAsync<T>(string procedure, object? parameters = null, CancellationToken ct = default) => inner.QueryProcAsync<T>(procedure, parameters, ct);
    public Task<ResultSets> QueryProcMultipleAsync(string procedure, object? parameters = null, CancellationToken ct = default) => inner.QueryProcMultipleAsync(procedure, parameters, ct);
    public Task<int> ExecuteProcAsync(string procedure, object? parameters = null, CancellationToken ct = default) => inner.ExecuteProcAsync(procedure, parameters, ct);
    public Task<int> ExecuteSqlAsync(string sql, object? parameters = null, CancellationToken ct = default) => inner.ExecuteSqlAsync(sql, parameters, ct);

    public async Task<IReadOnlyList<T>> QuerySqlAsync<T>(string sql, object? parameters = null, CancellationToken ct = default)
    {
        await inner.QuerySqlAsync<T>(sql, parameters, ct);
        if (typeof(T) != typeof(SurveillanceUnit)) return [];
        if (!Units.TryGetValue(FakeSql.Arg(parameters, "ZedId") ?? "", out var rows)) return [];
        IEnumerable<SurveillanceUnit> result = rows;
        if (sql.Contains("SiteAssessorId IS NOT NULL", StringComparison.Ordinal))
        {
            var cert = FakeSql.Arg(parameters, "Certification");
            result = rows.Where(r => string.Equals(r.Certification, cert, StringComparison.OrdinalIgnoreCase) && r.SiteAssessorId is not null && r.SaCertificateNo is null);
        }
        return (IReadOnlyList<T>)(object)result.ToList();
    }
}

public sealed class SurveillanceAppTests : IDisposable
{
    private const string Zed = "ZEDMSME000001";
    private const string Assessor = "ZEDBAS0001";
    private readonly SurveillanceAppHost _t = new();

    public void Dispose() => _t.Dispose();

    private static void AssertFail(JsonElement e, string message)
    {
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Equal(message, e.GetProperty("errorMessage").GetString());
    }

    private static void AssertOk(JsonElement e) => Assert.Equal("1", e.GetProperty("status").GetString());

    private static string Png => Convert.ToBase64String([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0]);

    // ---------------------------------------------------------------- Login

    private void LoginProc(bool allotted = true, string password = "pw")
    {
        _t.Fake.Procs["SP_APP_SURVEILLANCE_CHECK_LOGIN"] = _ => FakeSql.Sets(
            [new { UserId = Assessor, RoleId = 3, Password = password }],
            [new { MsmeId = "11", ZedId = Zed, PledgeCertificateNo = Zed, PUnitName = "Unit" }],
            [new { EnterpriseName = "Acme" }],
            [new { BronzeStatus = 1, SilverStatus = 0, GoldStatus = 0, BronzeStatusOfNc = 0, IsCouponUsed = true }],
            allotted ? [new { ZedId = Zed, Certification = "Bronze", CertificationStatus = 1, DesktopAssessorId = Assessor }] : []);
    }

    [Fact]
    public async Task Login_answers_the_msme_login_shape_and_registers_the_device_for_the_assessor()
    {
        LoginProc();
        var e = await _t.Json("/Surveillance/Login", new { assessorId = Assessor, zedId = Zed, password = "pw", deviceInfo = new { deviceId = "dev-1" } });
        AssertOk(e);
        Assert.Equal(Zed, e.GetProperty("MsmeDetails").GetProperty("ZedId").GetString());
        Assert.Equal("Acme", e.GetProperty("MsmeDetails").GetProperty("BasicDetails").GetProperty("EnterpriseName").GetString());
        Assert.Equal(1, e.GetProperty("MsmeDetails").GetProperty("msmeStatus").GetProperty("BronzeStatus").GetInt32());
        Assert.Equal(JsonValueKind.Null, e.GetProperty("MsmeDetails").GetProperty("Password").ValueKind);
        var args = _t.Args("SP_APP_SURVEILLANCE_CHECK_LOGIN");
        Assert.Equal(Assessor, SurveillanceAppHost.Arg(args, "AssessorId"));
        Assert.Equal(Zed, SurveillanceAppHost.Arg(args, "ZedId"));
        Assert.Equal("pw", SurveillanceAppHost.Arg(args, "Password"));
        Assert.Contains("dev-1", _t.Devices.Known[("SURV", Assessor)]);
    }

    [Fact]
    public async Task Login_with_the_procedure_master_password_is_refused()
    {
        LoginProc(password: "real");
        AssertFail(await _t.Json("/Surveillance/Login", new { assessorId = Assessor, zedId = Zed, password = "master" }), "Invalid Credentials.");
        Assert.Empty(_t.Devices.Known);
    }

    [Fact]
    public async Task Login_for_a_unit_not_allotted_to_the_assessor_is_refused()
    {
        LoginProc(allotted: false);
        AssertFail(await _t.Json("/Surveillance/Login", new { assessorId = Assessor, zedId = Zed, password = "pw", deviceInfo = new { deviceId = "d" } }),
            "Bronze Surveillance Assessment data not yet allocated for the ZEDID: " + Zed);
        Assert.Empty(_t.Devices.Known);
    }

    [Fact]
    public async Task Login_is_locked_after_five_failures()
    {
        for (var i = 0; i < 5; i++) await _t.Json("/Surveillance/Login", new { assessorId = Assessor, zedId = Zed, password = "x" });
        LoginProc();
        AssertFail(await _t.Json("/Surveillance/Login", new { assessorId = Assessor, zedId = Zed, password = "pw" }),
            "Too many failed attempts. Please try again after 15 minutes.");
    }

    // ---------------------------------------------------------------- Allotment on every call

    private static object BasicInfo(string user = Zed, string? saId = null) => new
    {
        userName = user, certificationType = "Bronze", saId, deviceInfo = new { deviceId = "dev-1" },
        basicInformation = new
        {
            auditsConducted = "Yes", rawMaterialImported = "No", energySources = new[] { "Solar", "Grid" },
            productDetailsList = new[] { new { productName = "Bolt", exported = "No", productPhoto = new { photoId = "pp1", isPdf = false } } },
            siteExteriorPhotos = new[] { new { photoId = "site1", photo = Png } },
        },
    };

    [Fact]
    public async Task Basic_information_for_the_allotted_unit_goes_to_the_surveillance_procedure()
    {
        _t.Sql.Unit(Zed, "Bronze", Assessor);
        AssertOk(await _t.Json("/Surveillance/SubmitBasicInformation", BasicInfo()));
        Assert.True(File.Exists(_t.FileUnderRoot("Photos", Zed, "Bronze", "SiteExteriorPhotos", "site1.jpg")));
        var args = _t.Args("SP_APP_SURVEILLANCE_INSERT_BASIC_INFO");
        Assert.Equal(Zed, SurveillanceAppHost.Arg(args, "ZedId"));
        Assert.Equal("Solar,Grid", SurveillanceAppHost.Arg(args, "EnergySources"));
        Assert.Equal("pp1.jpg", SurveillanceAppHost.Tvp(args, "ProductList")!.Rows[0]["ProductPhoto"]);
        Assert.Empty(_t.CallsTo("SP_APP_MSME_INSERT_BASIC_INFO"));
    }

    [Fact]
    public async Task A_unit_without_a_desktop_assessor_is_refused_before_anything_is_written()
    {
        _t.Sql.Unit(Zed, "Bronze", null);
        AssertFail(await _t.Json("/Surveillance/SubmitBasicInformation", BasicInfo()),
            "Bronze Surveillance Assessment data not yet allocated for the ZEDID: " + Zed);
        AssertFail(await _t.Json("/Surveillance/SubmitBasicInformation", BasicInfo(user: "ZEDMSME999999")),
            "Bronze Surveillance Assessment data not yet allocated for the ZEDID: ZEDMSME999999");
        Assert.Empty(_t.CallsTo("SP_APP_SURVEILLANCE_INSERT_BASIC_INFO"));
        Assert.Empty(_t.AllFiles());
    }

    [Fact]
    public async Task Another_assessor_named_in_the_request_is_refused()
    {
        _t.Sql.Unit(Zed, "Bronze", Assessor);
        AssertFail(await _t.Json("/Surveillance/SubmitBasicInformation", BasicInfo(saId: "ZEDBAS0099")),
            "Bronze Surveillance Assessment data not yet allocated for the ZEDID: " + Zed);
        Assert.Empty(_t.CallsTo("SP_APP_SURVEILLANCE_INSERT_BASIC_INFO"));
        AssertOk(await _t.Json("/Surveillance/SubmitBasicInformation", BasicInfo(saId: Assessor.ToLowerInvariant())));
    }

    [Fact]
    public async Task Enforced_device_binding_refuses_a_device_the_allotted_assessor_never_used()
    {
        _t.Settings["Mobile:DeviceBinding"] = "Enforce";
        _t.Sql.Unit(Zed, "Bronze", Assessor);
        _t.Devices.Known[("SURV", Assessor)] = ["dev-other"];
        AssertFail(await _t.Json("/Surveillance/SubmitBasicInformation", BasicInfo()),
            "This device is not registered for your account. Please login again.");
        Assert.Empty(_t.CallsTo("SP_APP_SURVEILLANCE_INSERT_BASIC_INFO"));
        Assert.Contains(_t.Devices.Events, ev => ev.App == "SURV" && ev.User == Assessor && ev.Refused);

        _t.Devices.Known[("SURV", Assessor)].Add("dev-1");
        AssertOk(await _t.Json("/Surveillance/SubmitBasicInformation", BasicInfo()));
    }

    [Fact]
    public async Task Basic_information_after_final_submit_is_refused()
    {
        _t.Sql.Unit(Zed, "Bronze", Assessor, status: 2);
        AssertFail(await _t.Json("/Surveillance/SubmitBasicInformation", BasicInfo()), "Invalid Details.");
        Assert.Empty(_t.CallsTo("SP_APP_SURVEILLANCE_INSERT_BASIC_INFO"));
        Assert.Empty(_t.AllFiles());
    }

    [Fact]
    public async Task An_unknown_level_in_a_path_is_refused()
    {
        _t.Sql.Unit(Zed, "..", Assessor);
        var body = new { userName = Zed, certificationType = "..", basicInformation = new { energySources = new[] { "x" } } };
        AssertFail(await _t.Json("/Surveillance/SubmitBasicInformation", body), "Invalid Data.");
        Assert.Empty(_t.CallsTo("SP_APP_SURVEILLANCE_INSERT_BASIC_INFO"));
    }

    // ---------------------------------------------------------------- Questionnaire, ESG, financial assistance availed

    [Fact]
    public async Task Parameters_come_from_the_surveillance_questionnaire_with_userName_as_the_unit()
    {
        _t.Sql.Unit(Zed, "Bronze", Assessor, status: 4);
        _t.Fake.Procs["SP_APP_SURVEILLANCE_GET_QUESTIONS_BY_TYPE"] = _ => FakeSql.Sets(
            [new { Id = 1, SectionCode = "1", SectionName = "Leadership" }],
            [new { Id = 10, SectionCode = "1", RequirementCode = "A" }], [], [],
            [new { Id = 90, SectionCode = "1", RequirementCode = "A", EvidenceCode = "E1", EvidenceName = "Photo", ValidationRequired = true }]);
        var e = await _t.Json("/Surveillance/GetParametersByType", new { zedId = "IGNORED", userName = Zed, certificationType = "Bronze" });
        AssertOk(e);
        Assert.Equal("E1", e.GetProperty("parameters")[0].GetProperty("requirements")[0].GetProperty("evidences")[0].GetProperty("code").GetString());
        Assert.Equal(Zed, SurveillanceAppHost.Arg(_t.Args("SP_APP_SURVEILLANCE_GET_QUESTIONS_BY_TYPE"), "ZedId"));
    }

    [Fact]
    public async Task Esg_checklist_goes_to_the_surveillance_procedure_and_answers_its_status()
    {
        _t.Sql.Unit(Zed, "Bronze", Assessor);
        _t.Fake.Procs["SP_APP_SURVEILLANCE_INSERT_ESG_CHECKLIST"] = _ => FakeSql.Sets([new { Status = 1, ErrorMessage = "Data submitted Successfully." }]);
        var e = await _t.Json("/Surveillance/SubmitEsgChecklist", new
        {
            userName = Zed, certificationType = "Bronze",
            esgChecklist = new[] { new { code = 1, question = "Q1", answer = "Yes" } },
            socialOhsChecklist = new[] { new { code = 2, question = "Q2", answer = "No" } },
        });
        Assert.Equal("Data submitted Successfully.", e.GetProperty("errorMessage").GetString());
        var args = _t.Args("SP_APP_SURVEILLANCE_INSERT_ESG_CHECKLIST");
        Assert.Equal("Q1", SurveillanceAppHost.Tvp(args, "EsgChecklist")!.Rows[0]["Question"]);
        Assert.Equal("2", SurveillanceAppHost.Tvp(args, "SocialOhsChecklist")!.Rows[0]["Code"]);
    }

    [Fact]
    public async Task Financial_assistance_availed_answers_are_stored_before_final_submit_only()
    {
        _t.Sql.Unit(Zed, "Bronze", Assessor);
        var body = new { userName = Zed, certificationType = "Bronze", financialAssistanceAvailed = "No", anyDocuments = "Yes", documentTypes = "System certification" };
        AssertOk(await _t.Json("/Surveillance/SubmitFinancialAssistanceDetails", body));
        var args = _t.Args("SP_APP_SUBMIT_FINANCIAL_ASSISTANCE_AVAILED");
        Assert.Equal("No", SurveillanceAppHost.Arg(args, "FinancialAssistanceAvailed"));
        Assert.Equal("System certification", SurveillanceAppHost.Arg(args, "DocumentTypes"));

        _t.Sql.Units.Clear();
        _t.Sql.Unit(Zed, "Bronze", Assessor, status: 2);
        AssertFail(await _t.Json("/Surveillance/SubmitFinancialAssistanceDetails", body), "Invalid Details.");
        Assert.Single(_t.CallsTo("SP_APP_SUBMIT_FINANCIAL_ASSISTANCE_AVAILED"));
    }

    // ---------------------------------------------------------------- Final submit

    [Fact]
    public async Task Final_submit_passes_the_two_surveillance_answers()
    {
        _t.Sql.Unit(Zed, "Bronze", Assessor);
        _t.Fake.Procs["SP_APP_CHECK_DATA_SYNC_FINAL_SUBMIT"] = _ => FakeSql.Sets([new { AllowFinalSubmit = false, ErrorMessage = "" }]);
        _t.Fake.Procs["SP_ASSESSMENT_CHECK_NC_PHOTO_AVAILABILITY"] = _ => FakeSql.Sets([], [], []);
        AssertOk(await _t.Json("/Surveillance/FinalSubmit", new { userName = Zed, certificationType = "Bronze", suitableForSilverUpgrade = "Yes", handholdingSupport = "No" }));
        var args = _t.Args("SP_APP_MSME_FINAL_SUBMIT");
        Assert.Equal("Yes", SurveillanceAppHost.Arg(args, "SuitableForSilverUpgrade"));
        Assert.Equal("No", SurveillanceAppHost.Arg(args, "HandholdingSupport"));
        Assert.Equal(Zed, SurveillanceAppHost.Arg(args, "ZedId"));
    }

    [Fact]
    public async Task Final_submit_refused_by_the_sync_check_shows_its_reason()
    {
        _t.Sql.Unit(Zed, "Bronze", Assessor);
        _t.Fake.Procs["SP_APP_CHECK_DATA_SYNC_FINAL_SUBMIT"] = _ => FakeSql.Sets([new { AllowFinalSubmit = true, ErrorMessage = "Products details are not submitted. Please review." }]);
        AssertFail(await _t.Json("/Surveillance/FinalSubmit", new { userName = Zed, certificationType = "Bronze" }), "Products details are not submitted. Please review.");
        Assert.Empty(_t.CallsTo("SP_APP_MSME_FINAL_SUBMIT"));
    }

    [Fact]
    public async Task Final_submit_after_submission_without_an_open_nc_is_refused()
    {
        _t.Sql.Unit(Zed, "Bronze", Assessor, status: 4, ncCount: 1, ncStatus: 2);
        AssertFail(await _t.Json("/Surveillance/FinalSubmit", new { userName = Zed, certificationType = "Bronze" }), "Invalid Details.");
        Assert.Empty(_t.CallsTo("SP_APP_CHECK_DATA_SYNC_FINAL_SUBMIT"));
        Assert.Empty(_t.CallsTo("SP_APP_MSME_FINAL_SUBMIT"));
    }

    // ---------------------------------------------------------------- NC replies

    [Fact]
    public async Task Nc_site_exterior_reply_needs_an_open_nc()
    {
        var body = new { userName = Zed, certificationType = "Bronze", msmeRemarks = "fixed", photos = new[] { new { photoId = "x1", photo = Png } } };
        _t.Sql.Unit(Zed, "Bronze", Assessor, status: 1);
        AssertFail(await _t.Json("/Surveillance/SubmitSiteExteriorInfo", body), "Invalid Details.");
        Assert.Empty(_t.AllFiles());

        _t.Sql.Units.Clear();
        _t.Sql.Unit(Zed, "Bronze", Assessor, status: 4, ncCount: 1, ncStatus: 1);
        AssertOk(await _t.Json("/Surveillance/SubmitSiteExteriorInfo", body));
        Assert.True(File.Exists(_t.FileUnderRoot("Photos", Zed, "Bronze", "SiteExteriorPhotos", "x1.jpg")));
        Assert.Equal("fixed", SurveillanceAppHost.Arg(_t.Args("SP_APP_MSME_INSERT_SITE_EXTERIOR"), "MsmeRemarks"));
    }

    [Fact]
    public async Task Nc_details_are_read_for_the_allotted_unit_only()
    {
        _t.Sql.Unit(Zed, "Bronze", Assessor, status: 4, ncCount: 1, ncStatus: 1);
        _t.Fake.Procs["SP_APP_MSME_GET_NC_DETAILS_BY_TYPE"] = _ => FakeSql.Sets(
            [new { AssessorRemarks = "dirty", PhotoPath = "p.jpg" }], [], []);
        var e = await _t.Json("/Surveillance/GetNcDetailsByType", new { userName = Zed, certificationType = "Bronze", ncCount = "1" });
        Assert.Equal("dirty", e.GetProperty("assessorRemarksSite").GetString());
        AssertFail(await _t.Json("/Surveillance/GetNcDetailsByType", new { userName = "ZEDMSME999999", certificationType = "Bronze", ncCount = "1" }),
            "Bronze Surveillance Assessment data not yet allocated for the ZEDID: ZEDMSME999999");
        Assert.Single(_t.CallsTo("SP_APP_MSME_GET_NC_DETAILS_BY_TYPE"));
    }

    // ---------------------------------------------------------------- Leftovers

    [Fact]
    public async Task Msme_account_leftovers_keep_their_old_failures_without_database_calls()
    {
        AssertFail(await _t.Json("/Surveillance/ChangePassword", new { userName = Assessor, oldPassword = "a", newPassword = "b" }), "Invalid Old Password.");
        AssertFail(await _t.Json("/Surveillance/ResetPassword", new { userName = Zed }), "Sorry, no User exists with these details.");
        var (body, status) = await _t.Send("/Surveillance/GetMsmeStatus", new StringContent("{}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.InternalServerError, status);
        Assert.Equal("0", body.GetProperty("status").GetString());
        Assert.Empty(_t.Fake.Calls);
    }

    [Fact]
    public async Task The_esg_checklist_form_is_served()
    {
        var r = await _t.Client.GetAsync("/Surveillance/GetEsgChecklist");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("application/json", r.Content.Headers.ContentType?.MediaType);
    }
}
