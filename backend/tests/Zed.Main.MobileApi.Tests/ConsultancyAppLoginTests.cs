using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Zed.Core.Data;
using Zed.Core.Mobile;
using Zed.Main.MobileApi.Controllers.Consultancy;
using Zed.Main.MobileApi.Models.Consultancy;

namespace Zed.Main.MobileApi.Tests;

/// <summary>
/// The mobile host as the Consultancy deployment (Mobile:System = Consultancy), with the database faked and the
/// consultant allotment query answered from <see cref="ConsultancyAllotmentSql.Allot"/>.
/// </summary>
public sealed class ConsultancyAppHost : IDisposable
{
    public MobileTestHost Host { get; } = new();
    public ConsultancyAllotmentSql Sql { get; }
    private WebApplicationFactory<Program>? _factory;
    private HttpClient? _client;

    public ConsultancyAppHost(bool consultancy = true)
    {
        Sql = new ConsultancyAllotmentSql(Host.Sql);
        if (consultancy) Host.Settings["Mobile:System"] = "Consultancy";
    }

    public FakeSql Fake => Host.Sql;
    public FakeDevices Devices => Host.Devices;
    public string StorageRoot => Host.StorageRoot;
    public Dictionary<string, string?> Settings => Host.Settings;

    public HttpClient Client => _client ??= (_factory = Host.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
    {
        s.RemoveAll<ISqlExecutor>();
        s.AddSingleton<ISqlExecutor>(Sql);
    }))).CreateClient();

    public async Task<JsonElement> Json(string path, object body)
    {
        var r = await Client.PostAsync(path, new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"));
        return JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
    }

    public async Task<JsonElement> Form(string path, MultipartFormDataContent form)
    {
        var r = await Client.PostAsync(path, form);
        return JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
    }

    public IEnumerable<(string Name, object? Args)> CallsTo(string name) =>
        Fake.Calls.Where(c => string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase));

    public object? LastArgs(string name) => CallsTo(name).Last().Args;

    public static string? Arg(object? args, string name) => FakeSql.Arg(args, name);

    public string FileUnderRoot(params string[] parts) => Path.Combine([StorageRoot, .. parts]);

    public IEnumerable<string> AllFiles() =>
        Directory.Exists(StorageRoot) ? Directory.EnumerateFiles(StorageRoot, "*", SearchOption.AllDirectories) : [];

    public void Dispose()
    {
        _client?.Dispose();
        _factory?.Dispose();
        Host.Dispose();
    }
}

/// <summary>FakeSql plus answers for <see cref="ConsultancySAController.AllotmentSql"/> and procedures that throw.</summary>
public sealed class ConsultancyAllotmentSql(FakeSql inner) : ISqlExecutor
{
    public ConcurrentDictionary<(string ZedId, string Cert), List<ConsultancyAllotment>> Allotments { get; } = new();
    public ConcurrentDictionary<string, bool> Failing { get; } = new(StringComparer.OrdinalIgnoreCase);

    public void Allot(string zedId, string cert, string role, string userId) =>
        Allotments.GetOrAdd((zedId.ToUpperInvariant(), cert.ToUpperInvariant()), _ => []).Add(new ConsultancyAllotment { Role = role, UserId = userId });

    private void ThrowIfFailing(string name)
    {
        if (Failing.ContainsKey(name)) throw new FakeDbException("Procedure " + name + " failed with internal detail.");
    }

    public Task<IReadOnlyList<T>> QueryProcAsync<T>(string procedure, object? parameters = null, CancellationToken ct = default) =>
        inner.QueryProcAsync<T>(procedure, parameters, ct);

    public Task<ResultSets> QueryProcMultipleAsync(string procedure, object? parameters = null, CancellationToken ct = default)
    {
        ThrowIfFailing(procedure);
        return inner.QueryProcMultipleAsync(procedure, parameters, ct);
    }

    public Task<int> ExecuteProcAsync(string procedure, object? parameters = null, CancellationToken ct = default)
    {
        ThrowIfFailing(procedure);
        return inner.ExecuteProcAsync(procedure, parameters, ct);
    }

    public Task<int> ExecuteSqlAsync(string sql, object? parameters = null, CancellationToken ct = default) => inner.ExecuteSqlAsync(sql, parameters, ct);

    public async Task<IReadOnlyList<T>> QuerySqlAsync<T>(string sql, object? parameters = null, CancellationToken ct = default)
    {
        await inner.QuerySqlAsync<T>(sql, parameters, ct);
        if (typeof(T) != typeof(ConsultancyAllotment) || sql != ConsultancySAController.AllotmentSql) return [];
        var key = ((FakeSql.Arg(parameters, "ZedId") ?? "").ToUpperInvariant(), (FakeSql.Arg(parameters, "Certification") ?? "").ToUpperInvariant());
        return Allotments.TryGetValue(key, out var rows) ? (IReadOnlyList<T>)(object)rows.ToList() : [];
    }
}

public sealed class ConsultancyAppLoginTests : IDisposable
{
    private const string Zed = "ZEDMSME000001";
    private const string Lead = "ZEDCC0001";
    private const string Co = "ZEDCC101";
    private const string Co2 = "ZEDCC0003";
    private const string Dfo = "ZEDCC0756";
    private const string Password = "Consult#1";
    private readonly ConsultancyAppHost _t = new();
    private int _status = 9;
    private object? _userType = 1;
    private bool _siteVerification = true;
    private string? _failure;

    public ConsultancyAppLoginTests()
    {
        _t.Sql.Allot(Zed, "Silver", "Lead", Lead);
        _t.Sql.Allot(Zed, "Silver", "Co", Co);
        _t.Sql.Allot(Zed, "Silver", "Co", Co2);

        // SP_APP_SA_CHECK_LOGIN_V2 then the consultant (or TU) sub-procedure's nine sets.
        _t.Fake.Procs["SP_APP_SA_CHECK_LOGIN_V2"] = args =>
        {
            var user = FakeSql.Arg(args, "UserId")!;
            if (_failure is not null) return FakeSql.Sets([new Dictionary<string, object?> { ["StatusCode"] = "0", ["ErrorMessage"] = _failure }]);
            if (FakeSql.Arg(args, "Password") != Password)
                return FakeSql.Sets([new Dictionary<string, object?> { ["StatusCode"] = "0", ["ErrorMessage"] = "Invalid Credentials. Please check" }]);
            var users = new[]
            {
                new Dictionary<string, object?>
                {
                    ["UserId"] = user, ["Password"] = Password, ["RoleId"] = 3, ["SiteVerification"] = _siteVerification,
                    ["FinancialVerification"] = !_siteVerification, ["StatusCode"] = "1", ["ErrorMessage"] = "",
                },
            };
            Dictionary<string, object?> Unit(string? co, string? coName) => new()
            {
                ["AssessmentDate"] = "05/01/2024 10:00:00 AM", ["EnterpriseName"] = "Acme", ["Sector"] = "24", ["UnitAddress"] = "Plot 1AgraUP282001",
                ["Email"] = "u@x.in", ["PhoneNumber"] = "999", ["UserType"] = _userType, ["CertificationStatus"] = _status,
                ["LeadAssessorId"] = Lead, ["LeadAssessorName"] = "Lead", ["CoAssessorId"] = co, ["CoAssessorName"] = coName,
                ["ZedId"] = Zed, ["CertificationType"] = "Silver", ["AuditsConducted"] = "Yes", ["DomesticCustomers"] = "D",
                ["InternationalCustomers"] = "I", ["RawMaterialImported"] = "No", ["OutsourcedProcesses"] = "O", ["EnergySources"] = "Solar,Grid",
                ["Milestone"] = 2, ["BdsFromDate"] = "01-02-2024", ["BdsToDate"] = "02-02-2024", ["HapFromDate"] = "03-02-2024", ["HapToDate"] = "04-02-2024",
                ["PAddress"] = "Plot 1", ["PDistrictName"] = "Agra", ["PStateName"] = "UP", ["PPincode"] = "282001",
            };
            return FakeSql.Sets(
                users,
                [Unit(Co, "Co One"), Unit(Co2, "Co Two")],
                [new { Id = 7, SectionId = "1", SectionName = "Leadership", SectionCode = "1", IsAssessmentExcempted = "No" }],
                [new { Id = 11, ProductName = "Bolt", Exported = "No" }],
                [new { Id = 12, RawMaterialName = "Steel", RawMaterialPercentage = "80", CountryName = "India" }],
                [new Dictionary<string, object?>
                {
                    ["Id"] = 210, ["SectionCode"] = "1", ["RequirementCode"] = "R1", ["AssessorRemarks"] = "ok", ["PrevReqId"] = 21,
                    ["SaConformance"] = "Yes", ["BaselineRemarks"] = "base", ["EstimatedTimeInDays"] = "30", ["HActionPlanRemarks"] = "hap",
                    ["Intervention"] = "Use IoT", ["InterventionRemarks"] = "int", ["IsProposedActivityCompleted"] = "No", ["ProgressReviewRemarks"] = "pr1",
                }],
                [new { Id = 31, SectionCode = "1", RequirementCode = "R1", OptionCode = "O1", OptionName = "Yes" }],
                [new { Id = 41, SectionCode = "1", RequirementCode = "R1", OptionCode = "O1", SubOptionCode = "S1", SubOptionName = "Fully" }],
                [new Dictionary<string, object?> { ["OpenMeetingSubmitted"] = true, ["SelfieSubmitted"] = false }],
                [
                    new { Id = 1, RequirementId = 21, BulletPoints = "Gap A", ReqType = "BaselineDiagnostic" },
                    new { Id = 2, RequirementId = 21, BulletPoints = "Gap B", ReqType = "BaselineDiagnostic" },
                    new { Id = 3, RequirementId = 21, BulletPoints = "Train staff", ReqType = "HandholdingActionPlan" },
                    new { Id = 4, RequirementId = 21, BulletPoints = "Sensors", ReqType = "TechnologyIntervention" },
                    new { Id = 5, RequirementId = 99, BulletPoints = "Other unit", ReqType = "BaselineDiagnostic" },
                ]);
        };
    }

    public void Dispose() => _t.Dispose();

    private Task<JsonElement> Login(string user = Lead, string password = Password, string zedId = Zed, string? version = "1.0") =>
        _t.Json("/SA/Login", new { zedId, assessorId = user, password, version, deviceInfo = new { deviceId = "cc-phone" } });

    private static void AssertFail(JsonElement e, string message)
    {
        Assert.Equal("0", e.GetProperty("status").GetString());
        Assert.Equal(message, e.GetProperty("errorMessage").GetString());
    }

    [Fact]
    public async Task Consultancy_deployment_serves_the_consultant_controller_at_SA()
    {
        await Login();
        Assert.Single(_t.CallsTo("SP_APP_SA_CHECK_LOGIN_V2"));
        Assert.Empty(_t.CallsTo("SP_APP_SA_CHECK_LOGIN"));

        // Main's MSME and RA controllers are not part of this deployment (Home is served by all three).
        foreach (var path in new[] { "/Msme/Login", "/RA/Login", "/ConsultancySA/Login" })
            Assert.Equal(HttpStatusCode.NotFound, (await _t.Client.PostAsync(path, new StringContent("{}", Encoding.UTF8, "application/json"))).StatusCode);
    }

    [Fact]
    public async Task Main_deployment_keeps_its_own_SA_controller()
    {
        using var main = new ConsultancyAppHost(consultancy: false);
        await main.Json("/SA/Login", new { zedId = Zed, assessorId = Lead, password = Password });
        Assert.Single(main.CallsTo("SP_APP_SA_CHECK_LOGIN"));
        Assert.Empty(main.CallsTo("SP_APP_SA_CHECK_LOGIN_V2"));
        // The consultancy-only actions do not exist on the Main deployment.
        foreach (var path in new[] { "/SA/SubmitAttendance", "/SA/SubmitBaselineDiagnostic", "/SA/CheckParameterSyncStatus" })
            Assert.Equal(HttpStatusCode.NotFound,
                (await main.Client.PostAsync(path, new StringContent("{}", Encoding.UTF8, "application/json"))).StatusCode);
    }

    [Fact]
    public async Task Successful_login_maps_the_consultancy_fields_and_remembers_the_device()
    {
        var e = await Login();
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal(1, e.GetProperty("userType").GetInt32());
        Assert.Equal(2, e.GetProperty("milestone").GetInt32());
        Assert.Equal("Silver", e.GetProperty("certificationType").GetString());
        Assert.True(e.GetProperty("isOpenMeetingSubmitted").GetBoolean());
        Assert.False(e.GetProperty("isSelfieSubmitted").GetBoolean());
        // Fields of the main app the consultancy response does not have.
        Assert.False(e.TryGetProperty("allowFinalSubmit", out _));
        Assert.False(e.TryGetProperty("isSurveillance", out _));
        Assert.False(e.TryGetProperty("minimumParameters", out _));
        Assert.DoesNotContain(Password, e.GetRawText());

        var profile = e.GetProperty("companyProfile");
        Assert.Equal("01-02-2024", profile.GetProperty("bdsFromDate").GetString());
        Assert.Equal("02-02-2024", profile.GetProperty("bdsToDate").GetString());
        Assert.Equal("03-02-2024", profile.GetProperty("hapFromDate").GetString());
        Assert.Equal("04-02-2024", profile.GetProperty("hapToDate").GetString());
        Assert.Equal("Plot 1", profile.GetProperty("address").GetString());
        Assert.Equal("Agra", profile.GetProperty("districtName").GetString());
        Assert.Equal("UP", profile.GetProperty("stateName").GetString());
        Assert.Equal("282001", profile.GetProperty("pincode").GetString());
        Assert.Equal("Plot 1AgraUP282001", profile.GetProperty("unitAddress").GetString());

        var assessors = e.GetProperty("assessors");
        Assert.Equal([Lead, Co, Co2], assessors.EnumerateArray().Select(a => a.GetProperty("assessorId").GetString()));
        Assert.Equal(["1", "2", "2"], assessors.EnumerateArray().Select(a => a.GetProperty("userType").GetString()));

        var p = Assert.Single(e.GetProperty("allottedParameters").EnumerateArray());
        var r = Assert.Single(p.GetProperty("requirements").EnumerateArray());
        Assert.Equal(210, r.GetProperty("id").GetInt32());
        Assert.Equal("30", r.GetProperty("estimatedTimeInDays").GetString());
        Assert.Equal("Use IoT", r.GetProperty("technologyInterventionRationale").GetString());
        Assert.Equal("Yes", r.GetProperty("conformance").GetString());
        Assert.Equal("No", r.GetProperty("isProposedActivityCompleted").GetString());
        Assert.Equal("base", r.GetProperty("baselineRemarks").GetString());
        Assert.Equal("hap", r.GetProperty("handholdingActionPlanRemarks").GetString());
        Assert.Equal("int", r.GetProperty("technologyInterventionRemarks").GetString());
        Assert.Equal("pr1", r.GetProperty("progressReview1Remarks").GetString());
        Assert.Equal(["Gap A", "Gap B"], r.GetProperty("gapsIdentified").EnumerateArray().Select(x => x.GetString()));
        Assert.Equal(["Train staff"], r.GetProperty("plannedActivities").EnumerateArray().Select(x => x.GetString()));
        Assert.Equal(["Sensors"], r.GetProperty("suggestedTechnologyIntervention").EnumerateArray().Select(x => x.GetString()));
        Assert.Equal("Fully", r.GetProperty("options")[0].GetProperty("subOptions")[0].GetProperty("label").GetString());
        Assert.Equal(JsonValueKind.Null, r.GetProperty("capturedEvidences").ValueKind);

        Assert.Contains("cc-phone", _t.Devices.Known[(MobileApps.SiteAssessor, Lead)]);
        var args = _t.LastArgs("SP_APP_SA_CHECK_LOGIN_V2");
        Assert.Equal(Lead, ConsultancyAppHost.Arg(args, "UserId"));
        Assert.Equal(Zed, ConsultancyAppHost.Arg(args, "ZedId"));
    }

    [Fact]
    public async Task Before_allotment_the_lead_gets_input_parameters()
    {
        _status = 8;
        var e = await Login();
        Assert.Equal(JsonValueKind.Null, e.GetProperty("allottedParameters").ValueKind);
        Assert.Equal("1", e.GetProperty("inputParameters")[0].GetProperty("parameterId").GetString());
    }

    [Fact]
    public async Task A_co_consultant_matched_only_by_the_procedures_LIKE_is_refused()
    {
        // ZEDCC10 is a prefix of the allotted ZEDCC101: SP_APP_SA_CHECK_LOGIN_V2's LIKE lets it through (#93).
        var e = await Login("ZEDCC10");
        AssertFail(e, ConsultancySAController.NotAllocated + Zed);
        Assert.Empty(_t.Devices.Known);
    }

    [Fact]
    public async Task An_allotted_co_consultant_logs_in()
    {
        _userType = 2;
        var e = await Login(Co);
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Equal(2, e.GetProperty("userType").GetInt32());
        Assert.Contains("cc-phone", _t.Devices.Known[(MobileApps.SiteAssessor, Co.ToUpperInvariant())]);
    }

    [Fact]
    public async Task The_procedures_own_failure_texts_are_returned()
    {
        _failure = "Handholding Closing Meeting Submitted for the ZEDID: " + Zed;
        var e = await Login();
        AssertFail(e, _failure);
        Assert.Equal(JsonValueKind.Null, e.GetProperty("companyProfile").ValueKind);
    }

    [Fact]
    public async Task Wrong_password_gets_the_procedures_text_and_five_lock_the_user()
    {
        AssertFail(await Login(password: "nope"), "Invalid Credentials. Please check");
        for (var i = 0; i < 4; i++) await Login(password: "nope");
        AssertFail(await Login(), ConsultancySAController.TooManyAttempts);
    }

    [Fact]
    public async Task Allocation_failures_do_not_count_towards_the_lock()
    {
        _failure = "Handholding Consultant not yet allocated for the ZEDID: " + Zed;
        for (var i = 0; i < 6; i++) await Login();
        _failure = null;
        Assert.Equal("1", (await Login()).GetProperty("status").GetString());
    }

    [Fact]
    public async Task A_password_that_differs_from_the_users_row_is_refused()
    {
        _t.Fake.Procs["SP_APP_SA_CHECK_LOGIN_V2"] = _ => FakeSql.Sets(
            [new Dictionary<string, object?> { ["UserId"] = Lead, ["Password"] = "Other", ["RoleId"] = 3, ["SiteVerification"] = true, ["StatusCode"] = "1" }]);
        AssertFail(await Login(), "Invalid Credentials. Please check");
        Assert.Empty(_t.Devices.Known);
    }

    [Fact]
    public async Task A_placeholder_unit_row_without_user_type_is_not_allotted()
    {
        _userType = null;
        AssertFail(await Login(), ConsultancySAController.NotAllocated + Zed);
    }

    [Fact]
    public async Task The_allotted_DFO_logs_in_through_the_TU_branch()
    {
        _siteVerification = false;
        _t.Sql.Allot(Zed, "Silver", "Dfo", Dfo);
        var e = await Login(Dfo);
        Assert.Equal("1", e.GetProperty("status").GetString());
        Assert.Contains("cc-phone", _t.Devices.Known[(MobileApps.SiteAssessor, Dfo)]);
    }

    [Fact]
    public async Task A_DFO_who_is_not_the_units_DFO_is_refused()
    {
        _siteVerification = false;
        _t.Sql.Allot(Zed, "Silver", "Dfo", Dfo);
        AssertFail(await Login("ZEDCC0757"), ConsultancySAController.DfoNotAllocated + Zed);
        // A consultant of the unit is not its DFO either.
        AssertFail(await Login(Lead), ConsultancySAController.DfoNotAllocated + Zed);
    }

    [Fact]
    public async Task Version_check_is_off_unless_configured()
    {
        Assert.Equal("1", (await Login(version: null)).GetProperty("status").GetString());
    }

    [Fact]
    public async Task Old_app_versions_are_told_to_update_when_the_check_is_on()
    {
        using var t = new ConsultancyAppHost();
        t.Settings["Mobile:CheckSaVersion"] = "true";
        t.Settings["Mobile:SaVersion"] = "2.0";
        var e = await t.Json("/SA/Login", new { zedId = Zed, assessorId = Lead, password = Password, version = "1.0" });
        Assert.Equal("2", e.GetProperty("status").GetString());
        Assert.Equal("Download new app from store.", e.GetProperty("errorMessage").GetString());
        Assert.Empty(t.CallsTo("SP_APP_SA_CHECK_LOGIN_V2"));
    }

    [Fact]
    public async Task A_database_failure_returns_the_fixed_text()
    {
        _t.Sql.Failing["SP_APP_SA_CHECK_LOGIN_V2"] = true;
        var e = await Login();
        AssertFail(e, ConsultancySAController.ErrorText);
        Assert.DoesNotContain("internal detail", e.GetRawText());
    }
}
