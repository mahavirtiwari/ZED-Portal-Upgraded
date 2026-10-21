using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Portal.Features.Msme.Handholding;

namespace Zed.Main.Api.Tests;

/// <summary>Handholding Support page of the MSME (api/msme/handholding).</summary>
public sealed class HandholdingTests : IDisposable
{
    private const string Me = "ZEDMSME000001";
    private const string Other = "ZEDMSME000002";
    private const string Api = "/api/msme/handholding";
    private readonly TestHost _host = new();
    private Dictionary<string, object?> _status = Status();

    public HandholdingTests()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = args => FakeSql.Arg(args, "UserId") switch
        {
            Me or Other => FakeSql.Sets([new { UserId = FakeSql.Arg(args, "UserId"), UserName = "Acme", RoleId = 5, Email = "a@acme.test" }], [new { ERRORMSG = "SUCCESS" }]),
            "ASSESSOR1" => FakeSql.Sets([new { UserId = "ASSESSOR1", UserName = "Assessor", RoleId = 3, Email = "as@zed.test" }], [new { ERRORMSG = "SUCCESS" }]),
            _ => FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]),
        };
        _host.Sql.Procs["SP_GET_SUB_ROLE"] = _ => FakeSql.Sets([new { DesktopVerification = 1, SiteVerification = 1, FinancialVerification = 0 }]);
        // SELECT * on ZED_CONSULTANT Msme / MsmeBasicInformation: columns the page never shows must not reach the browser.
        _host.Sql.Procs["SP_CONSULTANCY_MSME_GET_DETAILS"] = args => FakeSql.Sets(
            [new
            {
                ZedId = FakeSql.Arg(args, "ZedId"), EnterpriseName = "Acme", EnterpriseType = "Micro", RegistrationType = "UDYAM", PUnitName = "Unit 1",
                PAddress = "Plot 4", PDistrictName = "Kanpur", PStateName = "UP", PPin = "208001", PledgeOn = "May 1, 2024", IsSilverPaymentDone = 1,
                MobileNo = "9999999999", PledgeEmailId = "pledge@acme.test", Password = "secret", MsmeId = 77,
            }],
            [new { UdyogAadharNo = "UDYAM-UP-29-0003915", PanNo = "ABCDE1234F", MobileNo = "9999999999" }]);
        _host.Sql.Procs["SP_CONSULTANCY_APP_MSME_STATUS"] = _ => FakeSql.Sets([_status]);
    }

    public void Dispose() => _host.Dispose();

    /// <summary>A row shaped like SP_CONSULTANCY_APP_MSME_STATUS (only the columns used).</summary>
    internal static Dictionary<string, object?> Status(
        int enableSilver = 1, int enableGold = 0, int silverStarted = 0, int[]? silverCompletion = null, int goldStarted = 0, int[]? goldCompletion = null)
    {
        var s = silverCompletion ?? [0, 0, 0];
        var g = goldCompletion ?? [0, 0, 0];
        var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase)
        {
            ["EnableSilver"] = enableSilver, ["EnableGold"] = enableGold,
            ["SilverStatusOfNc"] = silverStarted, ["GoldStatusOfNc"] = goldStarted,
            ["SilverStatus"] = silverStarted > 0 ? 2 : 0, ["GoldStatus"] = 0, ["Nc1StatusTextSilver"] = "internal text",
            ["IsCouponUsed"] = 0, ["SilverIncentives"] = "https://old/Incentive/Details/9?ct=Silver",
        };
        for (var i = 1; i <= 3; i++)
        {
            row[$"MilestoneCompletionStatus{i}"] = s[i - 1];
            row[$"MilestoneCompletionStatusGold{i}"] = g[i - 1];
            row[$"SilverStatusOfNc{i}"] = silverStarted >= i ? 1 : 0;
            row[$"GoldStatusOfNc{i}"] = goldStarted >= i ? 1 : 0;
        }
        return row;
    }

    private async Task<HttpClient> SignedInAsync(string user = Me)
    {
        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = user, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        return client;
    }

    [Fact]
    public async Task Endpoints_require_a_signed_in_msme()
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(Api)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync($"{Api}/accept-milestone", new { certification = "Silver", milestone = 1 })).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name.StartsWith("SP_CONSULTANCY", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Staff_accounts_are_forbidden()
    {
        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = "ASSESSOR1", password = "Right#Pass1" })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(Api)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync($"{Api}/accept-milestone", new { certification = "Silver", milestone = 1 })).StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MONITORING_RA_APPLICANT_ACCEPTANCE");
    }

    [Fact]
    public async Task Summary_is_for_the_signed_in_unit_and_carries_only_the_shown_columns()
    {
        _status = Status(silverStarted: 1, silverCompletion: [100, 0, 0]);
        var client = await SignedInAsync();

        var json = await client.GetFromJsonAsync<JsonElement>($"{Api}?zedId={Other}");

        Assert.All(_host.Sql.Calls.Where(c => c.Name.StartsWith("SP_CONSULTANCY", StringComparison.Ordinal)), c => Assert.Equal(Me, FakeSql.Arg(c.Args, "ZedId")));
        var msme = json.GetProperty("msme");
        Assert.Equal(Me, msme.GetProperty("ZedId").GetString());
        Assert.Equal("Acme", msme.GetProperty("EnterpriseName").GetString());
        foreach (var hidden in new[] { "Password", "MobileNo", "PledgeEmailId", "MsmeId" }) Assert.False(msme.TryGetProperty(hidden, out _), hidden);
        var basic = json.GetProperty("basicInfo");
        Assert.Equal("UDYAM-UP-29-0003915", basic.GetProperty("UdyogAadharNo").GetString());
        Assert.False(basic.TryGetProperty("PanNo", out _));
        var status = json.GetProperty("status");
        Assert.Equal(100, status.GetProperty("MilestoneCompletionStatus1").GetInt32());
        Assert.False(status.TryGetProperty("Nc1StatusTextSilver", out _));
        Assert.False(status.TryGetProperty("SilverIncentives", out _));

        var silver = json.GetProperty("levels").EnumerateArray().Single(l => l.GetProperty("certification").GetString() == "Silver");
        Assert.True(silver.GetProperty("canPay").GetBoolean());
        Assert.Equal(2, silver.GetProperty("nextMilestone").GetInt32());
        var gold = json.GetProperty("levels").EnumerateArray().Single(l => l.GetProperty("certification").GetString() == "Gold");
        Assert.False(gold.GetProperty("canPay").GetBoolean());   // EnableGold = 0
    }

    [Fact]
    public async Task Unit_without_consultancy_record_gets_not_found()
    {
        _host.Sql.Procs["SP_CONSULTANCY_MSME_GET_DETAILS"] = _ => FakeSql.Sets([], []);
        var client = await SignedInAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(Api)).StatusCode);
    }

    [Theory]
    [InlineData(1, 0, new[] { 0, 0, 0 }, true, 1, null)]
    [InlineData(1, 1, new[] { 16, 0, 0 }, false, 2, "Milestone 1 must be completed and accepted before Milestone 2 can be paid.")]
    [InlineData(1, 1, new[] { 100, 0, 0 }, true, 2, null)]
    [InlineData(1, 2, new[] { 100, 9, 0 }, false, 3, "Milestone 2 must be completed and accepted before Milestone 3 can be paid.")]
    [InlineData(1, 3, new[] { 100, 100, 100 }, false, 3, "All milestones of Handholding Support for this level have been paid.")]
    [InlineData(0, 0, new[] { 0, 0, 0 }, false, 1, "Handholding Support is not available for this level.")]
    public void Eligibility_follows_the_milestone_rules(int enable, int started, int[] completion, bool canPay, int next, string? refusal)
    {
        var state = HandholdingEligibility.Evaluate(Status(enableSilver: enable, silverStarted: started, silverCompletion: completion), "Silver");
        Assert.Equal(canPay, state.CanPay);
        Assert.Equal(next, state.NextMilestone);
        Assert.Equal(refusal, state.Refusal);
    }

    [Fact]
    public void Gold_uses_its_own_completion_columns()
    {
        var state = HandholdingEligibility.Evaluate(Status(enableGold: 1, goldStarted: 1, goldCompletion: [16, 0, 0], silverCompletion: [100, 100, 100]), "Gold");
        Assert.False(state.CanPay);
        Assert.Equal(1, state.AwaitingAcceptance);
        Assert.Null(HandholdingEligibility.Evaluate(null, "Gold").AwaitingAcceptance);
    }

    [Fact]
    public async Task Accepting_a_milestone_needs_that_milestone_to_wait_for_acceptance()
    {
        _status = Status(silverStarted: 1, silverCompletion: [9, 0, 0]);
        var client = await SignedInAsync();

        var early = await client.PostAsJsonAsync($"{Api}/accept-milestone", new { certification = "Silver", milestone = 1 });
        Assert.Equal("Milestone 1 is not waiting for your acceptance.", await early.ProblemTitle());
        var invalid = await client.PostAsJsonAsync($"{Api}/accept-milestone", new { certification = "Bronze", milestone = 1 });
        Assert.Equal("Invalid milestone.", await invalid.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MONITORING_RA_APPLICANT_ACCEPTANCE");

        _status = Status(silverStarted: 1, silverCompletion: [16, 0, 0]);
        var other = await client.PostAsJsonAsync($"{Api}/accept-milestone", new { certification = "Silver", milestone = 2 });
        Assert.Equal(HttpStatusCode.BadRequest, other.StatusCode);

        var ok = await client.PostAsJsonAsync($"{Api}/accept-milestone", new { certification = "silver", milestone = 1, zedId = Other });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var call = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MONITORING_RA_APPLICANT_ACCEPTANCE");
        Assert.Equal(Me, FakeSql.Arg(call.Args, "UserId"));
        Assert.Equal(Me, FakeSql.Arg(call.Args, "ZedId"));
        Assert.Equal("Silver", FakeSql.Arg(call.Args, "CertificationType"));
    }

    [Fact]
    public async Task Failed_acceptance_returns_a_generic_message()
    {
        _status = Status(silverStarted: 1, silverCompletion: [16, 0, 0]);
        _host.Sql.Procs["SP_MONITORING_RA_APPLICANT_ACCEPTANCE"] = _ => throw new ProcedureError();
        var client = await SignedInAsync();
        var r = await client.PostAsJsonAsync($"{Api}/accept-milestone", new { certification = "Silver", milestone = 1 });
        Assert.Equal("The milestone could not be accepted. Please try again.", await r.ProblemTitle());
    }

    private sealed class ProcedureError() : System.Data.Common.DbException("Invalid column name 'internal'.");
}
