using System.Net;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Zed.Core.Mobile;
using Zed.Core.Payments;
using Zed.Portal.Features.Payments.Consultancy;
using Zed.Portal.Features.Payments.Mobile;
using Zed.Portal.Features.Staff.Expenditure;

namespace Zed.Main.Api.Tests;

/// <summary>
/// 2026-11-21 (the product owner's rule): handholding milestone 1. The payment asks "Did any Consultant Organisation assist
/// you?"; once paid, milestone 1 goes to the organisation named, else by round robin, else waits with a mail to the ZED team.
/// </summary>
public sealed class HandholdingCoAllotmentTests : IDisposable
{
    private const string Me = "ZEDMSME000001";
    private const string Api = "/api/msme/consultancy-payments";

    private readonly TestHost _host = new();
    private int _milestoneRow = 1;
    private string? _rowCo;
    private (bool? Assisted, string? Co) _answer = (null, null);
    /// <summary>The organisations of SP_ASSESSMENT_AGENCIES_TO_ALLOT (the procedure's state and NIC sector filter) with their Users.Id.</summary>
    private readonly List<(string Id, string Name, long UsersId, bool Site)> _offered = [];
    private string? _lastRoundRobin;

    public HandholdingCoAllotmentTests()
    {
        _host.Settings["Email:ZedTeamInbox"] = "team@zed.test";
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = args => FakeSql.Arg(args, "UserId") == Me
            ? FakeSql.Sets([new { UserId = Me, UserName = "Acme", RoleId = 5, Email = "a@acme.test" }], [new { ERRORMSG = "SUCCESS" }])
            : FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]);
        // Milestone 1 due (nothing started yet).
        _host.Sql.Procs["SP_CONSULTANCY_APP_MSME_STATUS"] = _ => FakeSql.Sets([HandholdingTests.Status()]);
        _host.Sql.Procs["SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS"] = _ =>
        {
            var row = new Dictionary<string, object?>
            {
                ["Id"] = 30, ["Total"] = "200000.00", ["Coupon"] = null, ["ApplicantContributionAfterSubsidy"] = "23600.00",
                ["NetPaybleTds15"] = "23200.00", ["NetPaybleTds75"] = "21600.00", ["UdyamPanNo"] = "ABCDE1234F", ["SubsidyLabel"] = "(80%)", ["MileStone"] = 1,
            };
            return FakeSql.Sets([row], [row], [new { IsCouponUsed = 0 }]);
        };
        _host.Sql.Procs["SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS"] = args => FakeSql.Sets([new
        {
            AmountToBePaid = "23600.00", TransactionId = FakeSql.Arg(args, "TransactionId"), MerchantParam3 = "Milestone 1", EnterpriseName = "Acme",
            PAddress = "Plot 4", MobileNo = "9999999999", PledgeEmailId = "pledge@acme.test", PStateName = "UP", PDistrictName = "Kanpur", PPin = "208001",
        }]);

        // ZED_CONSULTANT (the keyed fake is the same FakeSql).
        _host.Sql.Queries[HandholdingCoChoice.ActiveSql] = _ =>
            [new { UserId = "CO_A", UserName = "Alpha Consultants" }, new { UserId = "CO_B", UserName = "Beta Advisory" }, new { UserId = "CO_C", UserName = "Gamma Partners" }];
        // CO_B's Silver purchase order is used up (2 of 2 cases: one counted, one in progress).
        _host.Sql.Queries[PoLimits.TotalsSql] = _ => [new { PartyId = "CO_B", Level = "Silver", Cases = 2, FirstPo = new DateTime(2026, 4, 1) }];
        _host.Sql.Queries[PoLimits.ConsultancyUsedSql] = _ => [new { PartyId = "CO_B", Level = "Silver", Cases = 1 }];
        _host.Sql.Queries[PoLimits.ConsultancyInProgressSql] = _ => [new { PartyId = "CO_B", Level = "Silver", Cases = 1 }];
        _host.Sql.Queries[HandholdingAutoAllotment.MilestoneSql] = _ => [new { NcCount = (int?)_milestoneRow, CertificationBodyUserId = _rowCo, CoAllotType = (string?)null }];
        _host.Sql.Queries[HandholdingAutoAllotment.AnswerSql] = _ => _answer.Assisted is null ? [] : [new { AssistedByCo = _answer.Assisted, AssistedCoId = _answer.Co }];
        _host.Sql.Procs["SP_ASSESSMENT_AGENCIES_TO_ALLOT"] = _ => FakeSql.Sets(_offered.Select(o =>
            (object)new { UserId = o.Id, UserName = o.Name, DesktopVerification = false, SiteVerification = o.Site }).ToList());
        _host.Sql.Queries[HandholdingAutoAllotment.UserIdsSql] = args =>
        {
            var ids = ((System.Collections.IEnumerable)args!.GetType().GetProperty("Ids")!.GetValue(args)!).Cast<string>().ToHashSet();
            return _offered.Where(o => ids.Contains(o.Id)).Select(o => (object)new { UserId = o.Id, Id = o.UsersId }).ToList();
        };
        _host.Sql.Queries[HandholdingAutoAllotment.LastSql] = _ => _lastRoundRobin is null ? [] : [new { AgencyId = _lastRoundRobin }];
        _host.Sql.Queries[HandholdingAutoAllotment.UnitSql] = _ => [new { EnterpriseName = "Acme Castings" }];
        // The allotment mail's details (the procedure answers after SP_ASSESSMENT_ALLOT_TO_AGENCY: the organisation now allotted).
        _host.Sql.Procs["SP_EMAIL_GET_DETAILS"] = _ =>
        {
            var co = _host.Sql.Calls.LastOrDefault(c => c.Name == "SP_ASSESSMENT_ALLOT_TO_AGENCY").Args is { } a ? FakeSql.Arg(a, "CertificationBodyUserId") : null;
            return FakeSql.Sets([new { EnterpriseName = "Acme Castings", Address = "Plot 4, Kanpur", AgencyEmailId = $"{co?.ToLowerInvariant()}@co.test", NcCount = 1 }]);
        };
    }

    public void Dispose() => _host.Dispose();

    private async Task<HandholdingAutoAllotment.Outcome?> RunAsync()
    {
        using var scope = _host.Services.CreateScope();
        return await HandholdingAutoAllotment.Create(scope.ServiceProvider).RunAsync(Me, "Silver", CancellationToken.None);
    }

    private List<(string Name, object? Args)> Calls(string name) => _host.Sql.Calls.Where(c => c.Name == name).ToList();

    private async Task<HttpClient> SignedInAsync()
    {
        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = Me, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        return client;
    }

    private static object Checkout(bool? assisted, string? co) => new
    {
        useReward = false, gstinApplicable = false, tdsDeductible = false, milestone = 1, assistedByCo = assisted, assistedCoId = co,
    };

    // ----- after the payment -----

    [Fact]
    public async Task Yes_allots_milestone_1_to_the_organisation_the_unit_named_through_the_payment_completion()
    {
        _answer = (true, "CO_C");
        _offered.Add(("CO_A", "Alpha Consultants", 3, true));   // the round robin would have given CO_A

        using (var scope = _host.Services.CreateScope())
            await ConsultancyPaymentCompletion.Create(scope.ServiceProvider).CompleteAsync(Me, "Silver", gateway: false, CancellationToken.None);

        var allot = Assert.Single(Calls("SP_ASSESSMENT_ALLOT_TO_AGENCY"));
        Assert.Equal(Me, FakeSql.Arg(allot.Args, "ZedId"));
        Assert.Equal("Silver", FakeSql.Arg(allot.Args, "Certification"));
        Assert.Equal("CO_C", FakeSql.Arg(allot.Args, "CertificationBodyUserId"));
        Assert.Empty(Calls("SP_ASSESSMENT_AGENCIES_TO_ALLOT"));   // no round robin

        var mark = Assert.Single(Calls(HandholdingAutoAllotment.MarkSql));
        Assert.Equal("Chosen", FakeSql.Arg(mark.Args, "Type"));
        Assert.Contains("assisted by Gamma Partners (CO_C)", FakeSql.Arg(mark.Args, "Descrip"));
        var history = Assert.Single(Calls(HandholdingAutoAllotment.HistorySql));
        Assert.Equal(HandholdingAutoAllotment.ChosenType, FakeSql.Arg(history.Args, "AllotType"));
        Assert.Equal("CO_C", FakeSql.Arg(history.Args, "Agency"));

        // The Master Admin's allotment mail, to the organisation.
        var mail = Assert.Single(_host.Email.Sent, m => m.Subject.StartsWith("Allocation of MSME for Handholding Support (Milestone 1)"));
        Assert.Equal("co_c@co.test", mail.To);
        Assert.EndsWith(Me, mail.Subject);
    }

    [Fact]
    public async Task No_allots_by_round_robin_in_users_order_after_the_last_one_skipping_a_used_up_purchase_order()
    {
        _answer = (false, null);
        // The procedure's organisations for the unit's state and NIC sector; CO_D has no site verification.
        _offered.AddRange([("CO_A", "Alpha Consultants", 3, true), ("CO_B", "Beta Advisory", 5, true), ("CO_C", "Gamma Partners", 9, true), ("CO_D", "Delta", 7, false)]);
        _lastRoundRobin = "CO_A";   // next in Users.Id order is CO_B, whose PO is used up: CO_C

        var outcome = await RunAsync();

        Assert.Equal(new HandholdingAutoAllotment.Outcome(HandholdingAutoAllotment.Way.RoundRobin, "CO_C", "Gamma Partners"), outcome);
        Assert.Equal(Me, FakeSql.Arg(Assert.Single(Calls("SP_ASSESSMENT_AGENCIES_TO_ALLOT")).Args, "ZedId"));
        Assert.Equal("CO_C", FakeSql.Arg(Assert.Single(Calls("SP_ASSESSMENT_ALLOT_TO_AGENCY")).Args, "CertificationBodyUserId"));
        var mark = Assert.Single(Calls(HandholdingAutoAllotment.MarkSql));
        Assert.Equal("RoundRobin", FakeSql.Arg(mark.Args, "Type"));
        Assert.Equal("Milestone 1 allotted by round robin to Gamma Partners (CO_C)", FakeSql.Arg(mark.Args, "Descrip"));
        var history = Assert.Single(Calls(HandholdingAutoAllotment.HistorySql));
        Assert.Equal(HandholdingAutoAllotment.AutoType, FakeSql.Arg(history.Args, "AllotType"));
        Assert.Equal("CO_C", FakeSql.Arg(history.Args, "Agency"));
        Assert.Equal("Silver", FakeSql.Arg(history.Args, "Certification"));
        Assert.Single(_host.Email.Sent, m => m.To == "co_c@co.test");

        // The next unit: after CO_C comes the first one again.
        _host.Sql.Calls.Clear();
        _lastRoundRobin = "CO_C";
        Assert.Equal("CO_A", (await RunAsync())!.Organisation);
    }

    [Fact]
    public async Task A_named_organisation_that_cannot_be_allotted_any_more_falls_back_to_the_round_robin()
    {
        _answer = (true, "CO_B");   // its PO got used up after the order
        _offered.Add(("CO_A", "Alpha Consultants", 3, true));

        var outcome = await RunAsync();

        Assert.Equal(HandholdingAutoAllotment.Way.RoundRobin, outcome!.Way);
        Assert.Equal("CO_A", FakeSql.Arg(Assert.Single(Calls("SP_ASSESSMENT_ALLOT_TO_AGENCY")).Args, "CertificationBodyUserId"));
        Assert.Contains("the organisation the unit chose, CO_B, could not be allotted", FakeSql.Arg(Assert.Single(Calls(HandholdingAutoAllotment.MarkSql)).Args, "Descrip"));
    }

    [Fact]
    public async Task With_no_eligible_organisation_milestone_1_waits_and_the_zed_team_is_told()
    {
        _answer = (false, null);
        _offered.Add(("CO_B", "Beta Advisory", 5, true));   // PO used up: nobody left

        var outcome = await RunAsync();

        Assert.Equal(HandholdingAutoAllotment.Way.NoEligible, outcome!.Way);
        Assert.Empty(Calls("SP_ASSESSMENT_ALLOT_TO_AGENCY"));
        Assert.Empty(Calls(HandholdingAutoAllotment.HistorySql));
        Assert.Equal("NoEligible", FakeSql.Arg(Assert.Single(Calls(HandholdingAutoAllotment.MarkSql)).Args, "Type"));
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("team@zed.test", mail.To);
        Assert.Equal($"Handholding Support (Milestone 1) waiting for allotment: no eligible Consultant Organisation - {Me}", mail.Subject);
        Assert.Contains("Acme Castings", mail.HtmlBody);
        Assert.Contains("Allot Consultancy", mail.HtmlBody);
    }

    [Theory]
    [InlineData(2, null)]          // milestones 2 and 3 follow the previous organisation (the procedures)
    [InlineData(3, "CO_A")]
    [InlineData(1, "CO_A")]        // already allotted (e.g. the Master Admin was quicker)
    public async Task Milestones_2_and_3_and_allotted_rows_are_left_alone(int milestone, string? co)
    {
        _milestoneRow = milestone;
        _rowCo = co;
        _answer = (false, null);
        _offered.Add(("CO_A", "Alpha Consultants", 3, true));

        Assert.Null(await RunAsync());

        Assert.Empty(Calls("SP_ASSESSMENT_AGENCIES_TO_ALLOT"));
        Assert.Empty(Calls("SP_ASSESSMENT_ALLOT_TO_AGENCY"));
        Assert.Empty(Calls(HandholdingAutoAllotment.MarkSql));
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task A_failing_allotment_is_logged_and_never_fails_the_payment()
    {
        _answer = (false, null);
        _offered.Add(("CO_A", "Alpha Consultants", 3, true));
        _host.Sql.Procs["SP_ASSESSMENT_ALLOT_TO_AGENCY"] = _ => throw new InvalidOperationException("database down");

        Assert.Null(await RunAsync());
        Assert.Empty(Calls(HandholdingAutoAllotment.MarkSql));
    }

    // ----- at the payment -----

    [Fact]
    public async Task The_list_offers_the_active_organisations_without_a_used_up_purchase_order_only_at_milestone_1()
    {
        var client = await SignedInAsync();

        var list = await client.GetFromJsonAsync<JsonElement>($"{Api}/Silver/consultant-organisations");

        Assert.Equal(new string?[] { "CO_A", "CO_C" }, list.EnumerateArray().Select(o => o.GetProperty("userId").GetString()).ToArray());
        Assert.Equal("Alpha Consultants", list[0].GetProperty("name").GetString());
        // Active ones only (the query; checked on the real database).
        Assert.Contains("IsActive = 1", HandholdingCoChoice.ActiveSql);
        Assert.Contains("RoleId = 2", HandholdingCoChoice.ActiveSql);

        // Milestone 1 paid and accepted: milestone 2 is next.
        _host.Sql.Procs["SP_CONSULTANCY_APP_MSME_STATUS"] = _ => FakeSql.Sets([HandholdingTests.Status(silverStarted: 1, silverCompletion: [100, 0, 0])]);
        var later = await client.GetAsync($"{Api}/Silver/consultant-organisations");
        Assert.Equal(HttpStatusCode.BadRequest, later.StatusCode);
        Assert.Equal("The Consultant Organisation is asked only at the payment of milestone 1.", await later.ProblemTitle());
    }

    [Theory]
    [InlineData(null, null, HandholdingCoChoice.Required)]
    [InlineData(true, null, HandholdingCoChoice.ChooseOne)]
    [InlineData(true, "CO_B", HandholdingCoChoice.NotAvailable)]      // its purchase order is used up
    [InlineData(true, "CO_X", HandholdingCoChoice.NotAvailable)]      // not an active organisation
    public async Task Milestone_1_checkout_refuses_a_missing_or_invalid_answer(bool? assisted, string? co, string message)
    {
        var client = await SignedInAsync();

        var r = await client.PostAsJsonAsync($"{Api}/Silver/checkout", Checkout(assisted, co));

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal(message, await r.ProblemTitle());
        Assert.Empty(Calls("SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS"));
    }

    [Theory]
    [InlineData(true, "co_c", true, "CO_C")]
    [InlineData(false, "CO_A", false, null)]   // No: no organisation kept
    public async Task Milestone_1_checkout_keeps_the_answer_with_the_order(bool assisted, string co, bool keptAssisted, string? keptCo)
    {
        var client = await SignedInAsync();

        var r = await client.PostAsJsonAsync($"{Api}/Silver/checkout", Checkout(assisted, co));

        Assert.Equal("gateway", (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString());
        var orderId = FakeSql.Arg(Assert.Single(Calls("SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS")).Args, "TransactionId");
        var kept = Assert.Single(Calls(HandholdingCoChoice.OrderSql));
        Assert.Equal(orderId, FakeSql.Arg(kept.Args, "TransactionId"));
        Assert.Equal(Me, FakeSql.Arg(kept.Args, "ZedId"));
        Assert.Equal(keptAssisted.ToString(), FakeSql.Arg(kept.Args, "Assisted"));
        Assert.Equal(keptCo, FakeSql.Arg(kept.Args, "CoId"));
    }

    // ----- the ZED MSME app -----

    private WebApplicationFactory<Program> App() => _host.WithWebHostBuilder(b =>
    {
        b.UseSetting("CcAvenue:MobileAccessCode", "AVMOBILE");
        b.UseSetting("CcAvenue:MobileWorkingKey", "0011223344556677889900AABBCCDDEE");
        b.UseSetting("Mobile:DeviceBinding", "Monitor");
        b.ConfigureTestServices(s =>
        {
            s.RemoveAll<ICcAvenueMobileClient>();
            s.AddSingleton<ICcAvenueMobileClient>(new MobileGateway());
        });
    });

    private static Dictionary<string, string> AppRequest(string? assisted, string? co) => new()
    {
        ["ZedId"] = Me, ["Certification"] = "Silver", ["UseCoupon"] = "No", ["UnitGstin"] = "No", ["TdsDeductible"] = "No",
        ["PaymentRefId"] = "30", ["Amount"] = "23600.00", ["AssistedByCo"] = assisted ?? "", ["AssistedCoId"] = co ?? "", ["deviceInfo.deviceId"] = "device-1",
    };

    private static async Task<JsonElement> Json(HttpResponseMessage r) => JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;

    [Fact]
    public async Task The_app_gets_the_same_list_and_its_payment_request_must_carry_a_valid_answer()
    {
        var app = App().CreateClient();
        var list = await Json(await app.PostAsync("/ConsultancyPay/GetConsultantOrganisations",
            new FormUrlEncodedContent(new Dictionary<string, string> { ["zedId"] = Me, ["certification"] = "Silver", ["deviceInfo.deviceId"] = "device-1" })));
        Assert.Equal("1", list.GetProperty("status").GetString());
        Assert.Equal(new string?[] { "CO_A", "CO_C" }, list.GetProperty("organisations").EnumerateArray().Select(o => o.GetProperty("userId").GetString()).ToArray());
        Assert.Equal("Gamma Partners", list.GetProperty("organisations")[1].GetProperty("userName").GetString());

        var missing = await Json(await app.PostAsync("/ConsultancyPay/GetToken", new FormUrlEncodedContent(AppRequest(null, null))));
        Assert.Equal("0", missing.GetProperty("status").GetString());
        Assert.Equal(HandholdingCoChoice.Required, missing.GetProperty("errorMessage").GetString());
        var usedUp = await Json(await app.PostAsync("/ConsultancyPay/GetToken", new FormUrlEncodedContent(AppRequest("Yes", "CO_B"))));
        Assert.Equal(HandholdingCoChoice.NotAvailable, usedUp.GetProperty("errorMessage").GetString());
        Assert.Empty(Calls("SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS"));

        var ok = await Json(await app.PostAsync("/ConsultancyPay/GetToken", new FormUrlEncodedContent(AppRequest("Yes", "CO_C"))));
        Assert.Equal("1", ok.GetProperty("status").GetString());
        var kept = Assert.Single(Calls(HandholdingCoChoice.OrderSql));
        Assert.Equal(ok.GetProperty("orderId").GetString(), FakeSql.Arg(kept.Args, "TransactionId"));
        Assert.Equal("CO_C", FakeSql.Arg(kept.Args, "CoId"));

        var bound = typeof(ConsultancyMobilePaymentController).GetMethod(nameof(ConsultancyMobilePaymentController.GetConsultantOrganisations))!
            .GetCustomAttribute<DeviceBoundAttribute>();
        Assert.Equal(["zedId"], bound!.UserFields);
    }

    /// <summary>2026-11-21: the app's handholding screen asks which levels are open and which milestone can be paid.</summary>
    [Fact]
    public async Task The_app_reads_the_handholding_levels_and_the_milestone_due()
    {
        var app = App().CreateClient();
        async Task<JsonElement> Silver()
        {
            var r = await Json(await app.PostAsync("/ConsultancyPay/GetHandholdingStatus",
                new FormUrlEncodedContent(new Dictionary<string, string> { ["zedId"] = Me, ["deviceInfo.deviceId"] = "device-1" })));
            Assert.Equal("1", r.GetProperty("status").GetString());
            return r.GetProperty("levels").EnumerateArray().Single(l => l.GetProperty("certification").GetString() == "Silver");
        }

        var due = await Silver();
        Assert.Equal("Silver", due.GetProperty("name").GetString());
        Assert.Equal(1, due.GetProperty("nextMilestone").GetInt32());
        Assert.True(due.GetProperty("canPay").GetBoolean());
        Assert.Equal(JsonValueKind.Null, due.GetProperty("refusal").ValueKind);

        // Milestone 1 waits for the unit's acceptance: milestone 2 cannot be paid yet.
        _host.Sql.Procs["SP_CONSULTANCY_APP_MSME_STATUS"] = _ => FakeSql.Sets([HandholdingTests.Status(silverStarted: 1, silverCompletion: [16, 0, 0])]);
        var waiting = await Silver();
        Assert.Equal(2, waiting.GetProperty("nextMilestone").GetInt32());
        Assert.False(waiting.GetProperty("canPay").GetBoolean());
        Assert.Contains("Milestone 1 must be completed and accepted", waiting.GetProperty("refusal").GetString());
        Assert.Equal(1, waiting.GetProperty("awaitingAcceptance").GetInt32());

        var bound = typeof(ConsultancyMobilePaymentController).GetMethod(nameof(ConsultancyMobilePaymentController.GetHandholdingStatus))!
            .GetCustomAttribute<DeviceBoundAttribute>();
        Assert.Equal(["zedId"], bound!.UserFields);
    }

    /// <summary>2026-11-21: the app's "Accept Milestone n" (HandholdingAcceptance, as the web page's).</summary>
    [Fact]
    public async Task The_app_accepts_a_milestone_and_is_told_to_pay_the_next_one()
    {
        var app = App().CreateClient();
        Task<JsonElement> Accept(int milestone) => app.PostAsync("/ConsultancyPay/AcceptMilestone", new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["zedId"] = Me, ["certification"] = "Silver", ["milestone"] = milestone.ToString(System.Globalization.CultureInfo.InvariantCulture), ["deviceInfo.deviceId"] = "device-1",
        })).ContinueWith(t => Json(t.Result)).Unwrap();

        var early = await Accept(1);
        Assert.Equal("0", early.GetProperty("status").GetString());
        Assert.Equal("Milestone 1 is not waiting for your acceptance.", early.GetProperty("errorMessage").GetString());

        var status = HandholdingTests.Status(silverStarted: 1, silverCompletion: [16, 0, 0]);
        _host.Sql.Procs["SP_CONSULTANCY_APP_MSME_STATUS"] = _ => FakeSql.Sets([status]);
        _host.Sql.Procs["SP_MONITORING_RA_APPLICANT_ACCEPTANCE"] = _ => { status = HandholdingTests.Status(silverStarted: 1, silverCompletion: [100, 0, 0]); return FakeSql.Sets(); };
        var ok = await Accept(1);
        Assert.Equal("1", ok.GetProperty("status").GetString());
        Assert.Equal("Pay", ok.GetProperty("next").GetString());
        Assert.Equal(2, ok.GetProperty("nextMilestone").GetInt32());
        Assert.Contains("Please pay for Milestone 2", ok.GetProperty("message").GetString());

        var bound = typeof(ConsultancyMobilePaymentController).GetMethod(nameof(ConsultancyMobilePaymentController.AcceptMilestone))!
            .GetCustomAttribute<DeviceBoundAttribute>();
        Assert.Equal(["zedId"], bound!.UserFields);
    }

    private sealed class MobileGateway : ICcAvenueMobileClient
    {
        public Task<SecureTokenResponse?> GetSecureTokenAsync(string orderId, CancellationToken ct) =>
            Task.FromResult<SecureTokenResponse?>(new SecureTokenResponse { responseStatus = "Successful", secureToken = "TOKEN" });

        public Task<string> GetRsaKeyAsync(string orderId, CancellationToken ct) => Task.FromResult("KEY");
    }
}
