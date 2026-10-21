using System.Collections.Concurrent;
using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Zed.Core.Finance;
using Zed.Core.Mobile;
using Zed.Core.Payments;
using Zed.Portal.Features.Payments.Consultancy;
using Zed.Portal.Features.Payments.Mobile;

namespace Zed.Main.Api.Tests;

/// <summary>Handholding (consultancy) milestone payment: web checkout, CCAvenue callback, app actions.</summary>
public sealed class ConsultancyPaymentTests : IDisposable
{
    private const string Me = "ZEDMSME000001";
    private const string Gstin = "09ABCDE1234F1Z5";      // PAN ABCDE1234F
    private const string Api = "/api/msme/consultancy-payments";
    private const string Callback = "/api/payments/ccavenue/consultancy-response";
    private const string Orders = "SELECT ZedId, Certification, Amount, PaymentStatus FROM ZED_CONSULTANT.dbo.PaymentGatewayTransactions";
    private const string MobileKey = "0011223344556677889900AABBCCDDEE";
    private const string OrderId = "7a1c2b7e-0d5e-4d43-9d0a-2b4c7e1f9a10";

    private readonly TestHost _host = new();
    private Dictionary<string, object?> _status = HandholdingTests.Status(silverStarted: 1, silverCompletion: [100, 0, 0]);
    private int _dueMilestone = 2;
    private int _milestonePayments;

    public ConsultancyPaymentTests()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = args => FakeSql.Arg(args, "UserId") switch
        {
            Me => FakeSql.Sets([new { UserId = Me, UserName = "Acme", RoleId = 5, Email = "a@acme.test" }], [new { ERRORMSG = "SUCCESS" }]),
            "ASSESSOR1" => FakeSql.Sets([new { UserId = "ASSESSOR1", UserName = "Assessor", RoleId = 3, Email = "as@zed.test" }], [new { ERRORMSG = "SUCCESS" }]),
            _ => FakeSql.Sets([], [new { ERRORMSG = "INVALID CREDENTIAILS" }]),
        };
        _host.Sql.Procs["SP_GET_SUB_ROLE"] = _ => FakeSql.Sets([new { DesktopVerification = 1, SiteVerification = 1, FinancialVerification = 0 }]);
        _host.Sql.Procs["SP_CONSULTANCY_APP_MSME_STATUS"] = _ => FakeSql.Sets([_status]);
        SetFees(payable: "23600.00");
        // Like the procedure: the amount follows the fee row and the TDS choice; the order id is the caller's.
        _host.Sql.Procs["SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS"] = args => FakeSql.Sets([new
        {
            AmountToBePaid = FakeSql.Arg(args, "Tds") switch { "1.5" => "23200.00", "7.5" => "21600.00", _ => "23600.00" },
            TransactionId = FakeSql.Arg(args, "TransactionId"), MerchantParam3 = "Milestone 2", EnterpriseName = "Acme & Co",
            PAddress = "Plot 4", MobileNo = "9999999999", PledgeEmailId = "pledge@acme.test", PStateName = "UP", PDistrictName = "Kanpur", PPin = "208001",
        }]);
        _host.Sql.Procs["SP_CONSULTANCY_MSME_ZERO_PAYMENT_DETAILS"] = _ =>
        {
            _status = HandholdingTests.Status(silverStarted: 2, silverCompletion: [100, 0, 0]);
            return FakeSql.Sets();
        };
        _host.Sql.Procs["SP_CONSULTANCY_MSME_GET_DETAILS"] = _ => FakeSql.Sets(
            [new { ZedId = Me, PledgeEmailId = "pledge@acme.test", MobileNo = "9999999999", EnterpriseName = "Acme", Address = "Plot 4, Kanpur, UP-208001", MileStoneNo = 2 }],
            [new { UdyogAadharNo = "UDYAM-UP-29-0003915", MobileNo = "9999999999", EnterpriseTypee = "Micro" }],
            [], [],
            [new { Total = "200000.00", Subsidy = "160000", SubsidyLabel = "(80%)", StateSubsidy = "0", ApplicantContributionAfterSubsidy = "23600.00", SubsidyAmount = "20000.00", GstAfterSubsidy = "3600.00", TdsDeductible = "No", MileStoneNum = 2 }],
            [new { AutoEmailForAgency = "agency@consultant.test" }]);
        _host.Sql.Queries[Orders] = args =>
            FakeSql.Arg(args, "TransactionId") == OrderId ? [new { ZedId = Me, Certification = "Silver", Amount = 23600.00m, PaymentStatus = (string?)null }] : [];
        _host.Sql.Queries[ConsultancyGateway.MilestoneQuery] = args =>
            FakeSql.Arg(args, "TransactionId") == OrderId ? [new { OrderMilestone = (int?)2, DueMilestone = _dueMilestone, Payments = _milestonePayments }] : [];
    }

    public void Dispose() => _host.Dispose();

    private void SetFees(string payable, string? stateLabel = null, int rewardUsed = 0) =>
        // The procedure's two result sets are the same AssessmentFee row (Coupon IS NULL).
        _host.Sql.Procs["SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS"] = _ =>
        {
            var row = new Dictionary<string, object?>
            {
                ["Id"] = 31, ["Total"] = "200000.00", ["Coupon"] = null, ["ApplicantContributionAfterSubsidy"] = payable,
                ["NetPaybleTds15"] = "23200.00", ["NetPaybleTds75"] = "21600.00", ["UdyamPanNo"] = "abcde1234f", ["SubsidyLabel"] = "(80%)",
                ["MileStone"] = 2, ["IsActive"] = true,
            };
            if (stateLabel is not null) row["StateSubsidyLabel"] = stateLabel;
            return FakeSql.Sets([row], [row], [new { IsCouponUsed = rewardUsed }]);
        };

    private async Task<HttpClient> SignedInAsync()
    {
        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = Me, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        return client;
    }

    private static object Choices(bool reward = false, bool gstin = false, string? tds = null, int? milestone = 2) => new
    {
        useReward = reward, gstinApplicable = gstin, gstin = gstin ? Gstin : null,
        tdsDeductible = tds is not null, tds, tan = tds is not null ? "ABCD12345E" : null, milestone,
        // Ignored by the API: the fee row, amount, order id and ZED ID come from the database and the cookie.
        paymentRefId = "1", amount = "1.00", zedId = "ZEDMSME999999", transactionId = "1",
    };

    private bool Called(string proc) => _host.Sql.Calls.Any(c => c.Name == proc);

    // ----- signed-in endpoints -----

    [Fact]
    public async Task Endpoints_require_a_signed_in_msme()
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync($"{Api}/Silver/status")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync($"{Api}/Silver/options")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync($"{Api}/gstin", new { certification = "Silver", gstin = Gstin })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync($"{Api}/pan", new { certification = "Silver", gstin = Gstin, pan = "ABCDE1234F" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync($"{Api}/Silver/checkout", Choices())).StatusCode);
        Assert.False(Called("SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS"));

        (await client.PostAsJsonAsync("/api/staff/auth/login", new { userId = "ASSESSOR1", password = "Right#Pass1" })).EnsureSuccessStatusCode();
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync($"{Api}/Silver/options")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync($"{Api}/Silver/checkout", Choices())).StatusCode);
        Assert.False(Called("SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS"));
    }

    [Fact]
    public async Task Status_gives_the_milestone_due_for_the_signed_in_unit()
    {
        var client = await SignedInAsync();
        var json = await client.GetFromJsonAsync<JsonElement>($"{Api}/silver/status");
        Assert.True(json.GetProperty("canPay").GetBoolean());
        Assert.Equal(2, json.GetProperty("nextMilestone").GetInt32());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync($"{Api}/Bronze/status")).StatusCode);   // no Bronze handholding
        Assert.All(_host.Sql.Calls.Where(c => c.Name == "SP_CONSULTANCY_APP_MSME_STATUS"), c => Assert.Equal(Me, FakeSql.Arg(c.Args, "ZedId")));
    }

    [Fact]
    public async Task Options_refresh_the_enterprise_type_and_return_the_milestone_fees_without_a_reward()
    {
        _host.Udyam.Result = _host.Udyam.Result with { BasicDetails = new(_host.Udyam.Result.BasicDetails) { ["EnterpriseType"] = "Small" } };
        var client = await SignedInAsync();

        var json = await client.GetFromJsonAsync<JsonElement>($"{Api}/Silver/options");

        Assert.Equal("Silver", json.GetProperty("certification").GetString());
        Assert.Equal(2, json.GetProperty("milestone").GetInt32());
        Assert.Equal("ABCDE1234F", json.GetProperty("udyamPan").GetString());
        Assert.False(json.GetProperty("stateSubsidy").GetBoolean());
        // Both procedure rows are the Coupon IS NULL row: no reward to offer.
        Assert.False(json.GetProperty("rewardAvailable").GetBoolean());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("withReward").ValueKind);
        var fee = json.GetProperty("withoutReward");
        Assert.Equal("23600.00", fee.GetProperty("ApplicantContributionAfterSubsidy").GetString());
        foreach (var hidden in new[] { "Id", "UdyamPanNo", "MileStone", "IsActive" }) Assert.False(fee.TryGetProperty(hidden, out _), hidden);

        var update = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_UPDATE_UDYAM_DETAILS");
        Assert.Equal("ZED CONSULTANCY", FakeSql.Arg(update.Args, "PaymentModule"));
        Assert.Equal("Small", FakeSql.Arg(update.Args, "EnterpriseType"));
        Assert.Equal(Me, FakeSql.Arg(update.Args, "ZedId"));
        var fees = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS");
        Assert.Equal(Me, FakeSql.Arg(fees.Args, "ZedId"));
        Assert.Equal("Silver", FakeSql.Arg(fees.Args, "Certification"));
    }

    [Theory]
    [InlineData(new[] { 16, 0, 0 }, 1, "Milestone 1 must be completed and accepted before Milestone 2 can be paid.")]
    [InlineData(new[] { 100, 100, 100 }, 3, "All milestones of Handholding Support for this level have been paid.")]
    public async Task Milestone_that_cannot_be_paid_yet_is_refused_everywhere(int[] completion, int started, string message)
    {
        _status = HandholdingTests.Status(silverStarted: started, silverCompletion: completion);
        var client = await SignedInAsync();

        Assert.Equal(message, await (await client.GetAsync($"{Api}/Silver/options")).ProblemTitle());
        Assert.Equal(message, await (await client.PostAsJsonAsync($"{Api}/Silver/checkout", Choices())).ProblemTitle());
        Assert.Equal("Handholding Support is not available for this level.",
            await (await client.PostAsJsonAsync($"{Api}/Gold/checkout", Choices())).ProblemTitle());   // EnableGold = 0
        Assert.False(Called("SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS"));
        Assert.False(Called("SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS"));
        Assert.False(Called("SP_CONSULTANCY_MSME_ZERO_PAYMENT_DETAILS"));
    }

    [Fact]
    public async Task Fee_procedure_returning_nothing_while_a_milestone_is_in_progress_is_refused()
    {
        _host.Sql.Procs["SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS"] = _ => FakeSql.Sets();
        var client = await SignedInAsync();
        Assert.Equal("Fee details are not available for this milestone.", await (await client.GetAsync($"{Api}/Silver/options")).ProblemTitle());
        Assert.Equal("Fee details are not available for this milestone.", await (await client.PostAsJsonAsync($"{Api}/Silver/checkout", Choices())).ProblemTitle());
        Assert.False(Called("SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS"));
    }

    [Fact]
    public async Task Checkout_builds_an_encrypted_gateway_request_from_database_values()
    {
        var client = await SignedInAsync();
        var r = await client.PostAsJsonAsync($"{Api}/Silver/checkout", Choices());
        var json = await r.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal("gateway", json.GetProperty("status").GetString());
        Assert.Equal("AVTEST", json.GetProperty("accessCode").GetString());
        var basic = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS");
        Assert.Equal("31", FakeSql.Arg(basic.Args, "PaymentRefId"));
        Assert.Equal(Me, FakeSql.Arg(basic.Args, "ZedId"));
        Assert.Equal("Silver", FakeSql.Arg(basic.Args, "Certification"));
        Assert.Equal("No", FakeSql.Arg(basic.Args, "UseCoupon"));
        var orderId = FakeSql.Arg(basic.Args, "TransactionId")!;
        Assert.True(Guid.TryParse(orderId, out _));

        var request = CcAvenueCrypto.ParseResponse(CcAvenueCrypto.Decrypt(json.GetProperty("encRequest").GetString()!, TestHost.WorkingKey));
        Assert.Equal(orderId, request["order_id"]);
        Assert.Equal("23600.00", request["amount"]);
        Assert.Equal(Me, request["merchant_param1"]);
        Assert.Equal("Silver", request["merchant_param2"]);
        Assert.Equal("Milestone 2", request["merchant_param3"]);
        Assert.Equal("Acme  Co", request["billing_name"]);
        Assert.EndsWith(Callback, request["redirect_url"]);
        Assert.EndsWith(Callback, request["cancel_url"]);
        Assert.False(Called("SP_CONSULTANCY_MSME_ZERO_PAYMENT_DETAILS"));
    }

    [Theory]
    [InlineData("1.00", "Milestone 2")]     // the hard-coded ₹1 "test the payment gateway" list
    [InlineData("23600.00", "Milestone 1")] // fee row id looked up in another table (state fee rows)
    public async Task Checkout_refuses_when_the_procedure_disagrees_with_the_fee_row(string amount, string param3)
    {
        _host.Sql.Procs["SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS"] = args =>
            FakeSql.Sets([new { AmountToBePaid = amount, TransactionId = FakeSql.Arg(args, "TransactionId"), MerchantParam3 = param3 }]);
        var client = await SignedInAsync();
        var r = await client.PostAsJsonAsync($"{Api}/Silver/checkout", Choices());
        Assert.StartsWith("The payment amount could not be confirmed", await r.ProblemTitle());
    }

    [Fact]
    public async Task Checkout_refuses_a_stale_page_and_reports_an_already_paid_milestone()
    {
        var client = await SignedInAsync();
        Assert.Equal("The milestone due has changed. Please open the payment page again.",
            await (await client.PostAsJsonAsync($"{Api}/Silver/checkout", Choices(milestone: 1))).ProblemTitle());
        Assert.False(Called("SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS"));

        _host.Sql.Procs["SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS"] = _ => FakeSql.Sets([]); // ZedId '0000' branch: no row
        Assert.Equal("Payment is already done for this milestone.",
            await (await client.PostAsJsonAsync($"{Api}/Silver/checkout", Choices(milestone: null))).ProblemTitle());
    }

    [Fact]
    public async Task Reward_cannot_be_applied_to_handholding()
    {
        var client = await SignedInAsync();
        var r = await client.PostAsJsonAsync($"{Api}/Silver/checkout", Choices(reward: true));
        Assert.Equal("The joining reward is not available.", await r.ProblemTitle());
        Assert.False(Called("SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS"));
    }

    [Fact]
    public async Task Zero_amount_is_recorded_only_for_a_state_subsidy_row_with_nothing_to_pay()
    {
        // Nothing to pay but no state subsidy: refused (the old page sent ₹0 to the gateway).
        SetFees(payable: "0.00");
        var client = await SignedInAsync();
        var refused = await client.PostAsJsonAsync($"{Api}/Silver/checkout", Choices());
        Assert.StartsWith("The payment amount could not be confirmed", await refused.ProblemTitle());
        Assert.False(Called("SP_CONSULTANCY_MSME_ZERO_PAYMENT_DETAILS"));
        Assert.False(Called("SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS"));

        // Andhra Pradesh state subsidy row with nothing left to pay.
        SetFees(payable: "0.00", stateLabel: "(20%)");
        var r = await client.PostAsJsonAsync($"{Api}/Silver/checkout", Choices());
        Assert.Equal("paid", (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString());
        var zero = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_CONSULTANCY_MSME_ZERO_PAYMENT_DETAILS");
        Assert.Equal("31", FakeSql.Arg(zero.Args, "PaymentRefId"));
        Assert.Equal(Me, FakeSql.Arg(zero.Args, "ZedId"));
        Assert.Equal("Silver", FakeSql.Arg(zero.Args, "Certification"));
        Assert.False(Called("SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS"));

        Assert.True(File.Exists(Path.Combine(_host.StorageRoot, "PDFs", "SA", Me, "Silver_Milestone2_Payment_Receipt.pdf")));
        var mail = Assert.Single(_host.Email.Sent);   // no agency mail on the zero path, as before
        Assert.Equal($"ZED Handholding Support (Milestone 2) Payment Confirmation Details - {Me}", mail.Subject);
        Assert.Contains("Handholding Fee", mail.HtmlBody);
        Assert.DoesNotContain("Password", mail.HtmlBody, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Zero_payment_the_procedure_did_not_record_is_not_reported_as_paid()
    {
        SetFees(payable: "0.00", stateLabel: "(20%)");
        _host.Sql.Procs["SP_CONSULTANCY_MSME_ZERO_PAYMENT_DETAILS"] = _ => FakeSql.Sets();   // milestone not opened
        var client = await SignedInAsync();
        var r = await client.PostAsJsonAsync($"{Api}/Silver/checkout", Choices());
        Assert.StartsWith("The payment could not be recorded", await r.ProblemTitle());
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Gstin_must_be_verified_here_and_match_the_udyam_pan()
    {
        var client = await SignedInAsync();
        Assert.Equal("Please verify the GSTIN first.", await (await client.PostAsJsonAsync($"{Api}/Silver/checkout", Choices(gstin: true))).ProblemTitle());

        // A GSTIN verified on the certification payment page does not count here.
        await client.PostAsJsonAsync("/api/msme/payments/gstin", new { certification = "Silver", gstin = Gstin });
        Assert.Equal("Please verify the GSTIN first.", await (await client.PostAsJsonAsync($"{Api}/Silver/checkout", Choices(gstin: true))).ProblemTitle());

        var verify = await client.PostAsJsonAsync($"{Api}/gstin", new { certification = "Silver", gstin = Gstin });
        Assert.True((await verify.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("panMatches").GetBoolean());

        var ok = await client.PostAsJsonAsync($"{Api}/Silver/checkout", Choices(gstin: true, tds: "7.5"));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var basic = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS");
        Assert.Equal(Gstin, FakeSql.Arg(basic.Args, "Gstin"));
        Assert.Equal("Yes", FakeSql.Arg(basic.Args, "UnitGstin"));
        Assert.Equal("7.5", FakeSql.Arg(basic.Args, "Tds"));
        Assert.Equal("ABCD12345E", FakeSql.Arg(basic.Args, "Tan"));
        var request = CcAvenueCrypto.ParseResponse(CcAvenueCrypto.Decrypt(
            (await ok.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("encRequest").GetString()!, TestHost.WorkingKey));
        Assert.Equal("21600.00", request["amount"]);

        // A GSTIN of another PAN is refused at checkout even when verified.
        await client.PostAsJsonAsync($"{Api}/gstin", new { certification = "Silver", gstin = "09PQRST6789K1Z2" });
        var other = await client.PostAsJsonAsync($"{Api}/Silver/checkout", new { useReward = false, gstinApplicable = true, gstin = "09PQRST6789K1Z2", tdsDeductible = false });
        Assert.Equal("PAN registered in your Udyam portal is not matching with given GSTIN Number.", await other.ProblemTitle());
    }

    [Fact]
    public async Task Pan_correction_needs_a_verified_gstin_and_uses_the_pan_from_the_database()
    {
        var client = await SignedInAsync();
        Assert.Equal("Please verify the GSTIN first.",
            await (await client.PostAsJsonAsync($"{Api}/pan", new { certification = "Silver", gstin = "09PQRST6789K1Z2", pan = "PQRST6789K" })).ProblemTitle());

        await client.PostAsJsonAsync($"{Api}/gstin", new { certification = "Silver", gstin = "09PQRST6789K1Z2" });
        var ok = await client.PostAsJsonAsync($"{Api}/pan", new { certification = "Silver", gstin = "09PQRST6789K1Z2", pan = "PQRST6789K", zedId = "ZEDMSME999999", panNo = "XXXXX0000X" });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var update = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MESE_UPDATE_PAN");
        Assert.Equal(Me, FakeSql.Arg(update.Args, "ZedId"));
        Assert.Equal("ABCDE1234F", FakeSql.Arg(update.Args, "PanNo"));
        Assert.Equal("PQRST6789K", FakeSql.Arg(update.Args, "UpdatedPanNo"));
    }

    // ----- gateway callback -----

    private static FormUrlEncodedContent Encrypted(string plain, string key = TestHost.WorkingKey) =>
        new(new Dictionary<string, string> { ["encResp"] = CcAvenueCrypto.Encrypt(plain, key) });

    private static string Paid(string orderId = OrderId, string amount = "23600.00", string zedId = Me, string level = "Silver", string status = "Success", string param3 = "Milestone 2") =>
        $"order_id={orderId}&tracking_id=999&order_status={status}&amount={amount}&merchant_param1={zedId}&merchant_param2={level}&merchant_param3={param3}";

    private HttpClient Gateway() => _host.CreateClient(new() { AllowAutoRedirect = false });

    [Fact]
    public async Task Successful_callback_records_the_milestone_mails_the_unit_and_the_agency()
    {
        var r = await Gateway().PostAsync(Callback, Encrypted(Paid()));

        Assert.Equal(HttpStatusCode.SeeOther, r.StatusCode);
        Assert.Equal("/msme/payment/consultancy-result?status=success&certification=Silver&milestone=2", r.Headers.Location!.OriginalString);
        var call = Assert.Single(_host.Sql.Calls, c => c.Name == ConsultancyGateway.Procedure);
        Assert.Equal("Success", FakeSql.Arg(call.Args, "PaymentStatus"));
        Assert.Equal(Me, FakeSql.Arg(call.Args, "ZedId"));
        Assert.Equal("Silver", FakeSql.Arg(call.Args, "Certification"));
        Assert.Equal(OrderId, FakeSql.Arg(call.Args, "TransactionId"));
        Assert.False(Called("SP_MSME_PAYMENT_GATEWAY_DETAILS"));

        Assert.Contains(_host.Email.Sent, m => m.Subject == $"ZED Handholding Support (Milestone 2) Payment Confirmation Details - {Me}" && m.To == "pledge@acme.test");
        var agency = Assert.Single(_host.Email.Sent, m => m.To == "agency@consultant.test");
        Assert.StartsWith("Allocation of MSME for Handholding Support (Milestone 2)", agency.Subject);
        Assert.Contains("Implementation &amp; Progress Review 1", agency.HtmlBody);
        Assert.True(File.Exists(Path.Combine(_host.StorageRoot, "PDFs", "SA", Me, "Silver_Milestone2_Payment_Receipt.pdf")));
    }

    [Theory]
    [InlineData(3, 0, "Milestone 2")]   // another order already opened milestone 2
    [InlineData(2, 1, "Milestone 2")]   // milestone 2 already has a payment
    [InlineData(2, 0, "Milestone 3")]   // response says another milestone
    public async Task Callback_for_a_milestone_that_is_not_due_is_recorded_as_failed(int due, int payments, string param3)
    {
        _dueMilestone = due;
        _milestonePayments = payments;
        var r = await Gateway().PostAsync(Callback, Encrypted(Paid(param3: param3)));

        Assert.StartsWith("/msme/payment/consultancy-result?status=failure&certification=Silver", r.Headers.Location!.OriginalString);
        Assert.Contains("message=", r.Headers.Location!.OriginalString);
        var call = Assert.Single(_host.Sql.Calls, c => c.Name == ConsultancyGateway.Procedure);
        Assert.Equal(ConsultancyGateway.MilestoneMismatch, FakeSql.Arg(call.Args, "PaymentStatus"));
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Callback_with_a_different_amount_is_recorded_as_failed()
    {
        var r = await Gateway().PostAsync(Callback, Encrypted(Paid(amount: "1.00")));
        Assert.StartsWith("/msme/payment/consultancy-result?status=failure", r.Headers.Location!.OriginalString);
        var call = Assert.Single(_host.Sql.Calls, c => c.Name == ConsultancyGateway.Procedure);
        Assert.Equal("AmountMismatch", FakeSql.Arg(call.Args, "PaymentStatus"));
        Assert.Empty(_host.Email.Sent);
    }

    [Theory]
    [InlineData("00000000-0000-0000-0000-000000000000", Me, "Silver")]   // unknown order (e.g. a certification order)
    [InlineData(OrderId, "ZEDMSME999999", "Silver")]                     // other unit
    [InlineData(OrderId, Me, "Gold")]                                    // other level
    public async Task Callback_that_does_not_match_an_order_changes_nothing(string orderId, string zedId, string level)
    {
        var r = await Gateway().PostAsync(Callback, Encrypted(Paid(orderId, zedId: zedId, level: level)));
        Assert.StartsWith("/msme/payment/consultancy-result?status=failure", r.Headers.Location!.OriginalString);
        Assert.False(Called(ConsultancyGateway.Procedure));
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Forged_or_wrongly_encrypted_callbacks_are_rejected()
    {
        var forged = await Gateway().PostAsync(Callback, new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["order_id"] = OrderId, ["order_status"] = "Success", ["merchant_param1"] = Me, ["encResp"] = "not-hex",
        }));
        var wrongKey = await Gateway().PostAsync(Callback, Encrypted(Paid(), "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"));
        var mobileKey = await Gateway().PostAsync(Callback, Encrypted(Paid(), MobileKey));

        foreach (var r in new[] { forged, wrongKey, mobileKey })
            Assert.Equal("/msme/payment/consultancy-result?status=failure&certification=&message=Invalid%20response%20from%20the%20payment%20gateway.", r.Headers.Location!.OriginalString);
        Assert.False(Called(ConsultancyGateway.Procedure));
    }

    [Fact]
    public async Task Repeated_callbacks_are_idempotent()
    {
        _host.Sql.Queries[Orders] = _ => [new { ZedId = Me, Certification = "Silver", Amount = 23600.00m, PaymentStatus = "Success" }];
        _dueMilestone = 3;   // the first response already opened milestone 2
        var again = await Gateway().PostAsync(Callback, Encrypted(Paid()));
        Assert.Equal("/msme/payment/consultancy-result?status=success&certification=Silver&milestone=2", again.Headers.Location!.OriginalString);
        Assert.False(Called(ConsultancyGateway.Procedure));
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Aborted_payment_is_recorded_with_the_gateway_message()
    {
        _host.Sql.Procs[ConsultancyGateway.Procedure] = _ => throw new DuplicateResponse();   // the procedure may raise; still answered
        var r = await Gateway().PostAsync(Callback, Encrypted(Paid(status: "Aborted") + "&status_message=Cancelled by user"));
        Assert.Equal("/msme/payment/consultancy-result?status=failure&certification=Silver&milestone=2&message=Cancelled%20by%20user", r.Headers.Location!.OriginalString);
        Assert.Equal("Aborted", FakeSql.Arg(Assert.Single(_host.Sql.Calls, c => c.Name == ConsultancyGateway.Procedure).Args, "PaymentStatus"));
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Successful_callback_queues_the_consultancy_invoice_and_receipt_for_the_milestone()
    {
        var erp = new FakeErp();
        using var host = _host.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<IErpFinanceService>();
            s.AddSingleton<IErpFinanceService>(erp);
        }));

        await host.CreateClient(new() { AllowAutoRedirect = false }).PostAsync(Callback, Encrypted(Paid()));

        var pushes = await erp.WaitAsync(2);
        Assert.Equal([ErpDocument.Invoice, ErpDocument.Receipt], pushes.Select(p => p.Document));
        Assert.All(pushes, p =>
        {
            Assert.Equal("CONSULTANCY", p.ModuleName);
            Assert.Equal(Me, p.ZedId);
            Assert.Equal("Silver", p.Certification);
            Assert.Equal("2", p.MileStoneNo);
        });
    }

    // ----- mobile app -----

    private readonly FakeMobileGateway _mobile = new();

    private WebApplicationFactory<Program> App(string deviceBinding = "Monitor") => _host.WithWebHostBuilder(b =>
    {
        b.UseSetting("CcAvenue:MobileAccessCode", "AVMOBILE");
        b.UseSetting("CcAvenue:MobileWorkingKey", MobileKey);
        b.UseSetting("Mobile:DeviceBinding", deviceBinding);
        b.ConfigureTestServices(s =>
        {
            s.RemoveAll<ICcAvenueMobileClient>();
            s.AddSingleton<ICcAvenueMobileClient>(_mobile);
        });
    });

    private static Dictionary<string, string> AppRequest(string level = "Silver", string? paymentRefId = "31", string? amount = null) => new()
    {
        ["ZedId"] = Me, ["Certification"] = level, ["UseCoupon"] = "No", ["UnitGstin"] = "No", ["TdsDeductible"] = "No",
        ["PaymentRefId"] = paymentRefId ?? "", ["Amount"] = amount ?? "", ["deviceInfo.deviceId"] = "device-1",
    };

    private static async Task<JsonElement> Json(HttpResponseMessage r) => JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;

    [Fact]
    public async Task App_GetToken_creates_a_server_order_and_returns_what_the_sdk_needs()
    {
        var r = await App().CreateClient().PostAsync("/ConsultancyPay/GetToken", new FormUrlEncodedContent(AppRequest(amount: "23600.00")));

        var json = await Json(r);
        Assert.Equal("1", json.GetProperty("status").GetString());
        var orderId = json.GetProperty("orderId").GetString()!;
        Assert.True(Guid.TryParse(orderId, out _));
        Assert.Equal("23600.00", json.GetProperty("amount").GetString());
        Assert.Equal("AVMOBILE", json.GetProperty("accessCode").GetString());
        Assert.Equal(MobilePaymentHashes.Sha512(orderId + "INR23600.00" + FakeMobileGateway.Token), json.GetProperty("requestHash").GetString());
        var basic = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS");
        Assert.Equal(orderId, FakeSql.Arg(basic.Args, "TransactionId"));
        Assert.Equal("31", FakeSql.Arg(basic.Args, "PaymentRefId"));
        Assert.Equal([orderId], _mobile.TokenCalls.ToArray());
    }

    [Theory]
    [InlineData("7", null)]          // another fee row
    [InlineData("31", "1.00")]       // another amount
    public async Task App_GetToken_refuses_a_tampered_fee_row_or_amount(string paymentRefId, string? amount)
    {
        var json = await Json(await App().CreateClient().PostAsync("/ConsultancyPay/GetToken", new FormUrlEncodedContent(AppRequest(paymentRefId: paymentRefId, amount: amount))));
        Assert.Equal("0", json.GetProperty("status").GetString());
        Assert.Equal("The fee details have changed. Please open the payment screen again.", json.GetProperty("errorMessage").GetString());
        Assert.False(Called("SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS"));
    }

    [Fact]
    public async Task App_GetToken_checks_the_milestone_rules()
    {
        _status = HandholdingTests.Status(silverStarted: 1, silverCompletion: [16, 0, 0]);
        var json = await Json(await App().CreateClient().PostAsync("/ConsultancyPay/GetToken", new FormUrlEncodedContent(AppRequest())));
        Assert.Equal("Milestone 1 must be completed and accepted before Milestone 2 can be paid.", json.GetProperty("errorMessage").GetString());
        var bronze = await Json(await App().CreateClient().PostAsync("/ConsultancyPay/GetToken", new FormUrlEncodedContent(AppRequest(level: "Bronze"))));
        Assert.Equal("Invalid details.", bronze.GetProperty("errorMessage").GetString());
        Assert.False(Called("SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS"));
    }

    [Fact]
    public async Task App_GetTokenRSA_answers_only_for_a_pending_handholding_order()
    {
        _host.Sql.Queries["SELECT TransactionId, PaymentStatus FROM ZED_CONSULTANT.dbo.PaymentGatewayTransactions"] = args =>
            FakeSql.Arg(args, "TransactionId") == OrderId ? [new { TransactionId = OrderId, PaymentStatus = (string?)null }] : [];
        var client = App().CreateClient();

        Assert.Equal(FakeMobileGateway.RsaKey, await client.GetStringAsync($"/ConsultancyPay/GetTokenRSA?orderId={OrderId}"));
        Assert.Equal("!ERROR!Invalid order.", await client.GetStringAsync("/ConsultancyPay/GetTokenRSA?orderId=100001"));
        Assert.Equal("!ERROR!Invalid order.", await client.GetStringAsync("/ConsultancyPay/GetTokenRSA?orderId=../x"));
        Assert.Equal([OrderId], _mobile.RsaCalls.ToArray());
    }

    [Fact]
    public async Task App_response_is_verified_with_the_mobile_key_and_recorded_by_the_consultancy_procedure()
    {
        var client = App().CreateClient();

        var web = await client.PostAsync("/ConsultancyPay/successtransmobile", Encrypted(Paid(), TestHost.WorkingKey));
        Assert.Contains("<td>order_status</td>", await web.Content.ReadAsStringAsync());
        Assert.Contains("Payment Failed", await web.Content.ReadAsStringAsync());
        Assert.False(Called(ConsultancyGateway.Procedure));

        var ok = await client.PostAsync("/ConsultancyPay/successtransmobile", Encrypted(Paid(), MobileKey));
        var page = await ok.Content.ReadAsStringAsync();
        Assert.Contains("Registration Successful!", page);
        Assert.Contains("<td>Success</td>", page);
        var call = Assert.Single(_host.Sql.Calls, c => c.Name == ConsultancyGateway.Procedure);
        Assert.Equal("Success", FakeSql.Arg(call.Args, "PaymentStatus"));
        Assert.Contains(_host.Email.Sent, m => m.Subject.StartsWith("ZED Handholding Support (Milestone 2)", StringComparison.Ordinal));

        // The failure address records the consultancy order too (the old one wrote to the certification orders).
        _host.Sql.Calls.Clear();
        var failed = await client.PostAsync("/ConsultancyPay/failuretransmobile", Encrypted(Paid(status: "Failure"), MobileKey));
        Assert.Contains("<td>Failure</td>", await failed.Content.ReadAsStringAsync());
        Assert.Equal("Failure", FakeSql.Arg(Assert.Single(_host.Sql.Calls, c => c.Name == ConsultancyGateway.Procedure).Args, "PaymentStatus"));
        Assert.False(Called("SP_SA_PAYMENT_UPDATE_RESPONSE"));
    }

    [Fact]
    public async Task App_zero_payment_only_for_a_zero_state_subsidy_row()
    {
        var client = App().CreateClient();
        var due = await Json(await client.PostAsync("/ConsultancyPay/SubmitZeroPaymentDetails", new FormUrlEncodedContent(AppRequest())));
        Assert.Equal("Payment is due for this milestone. Please pay online.", due.GetProperty("errorMessage").GetString());
        Assert.False(Called("SP_CONSULTANCY_MSME_ZERO_PAYMENT_DETAILS"));

        SetFees(payable: "0.00", stateLabel: "(20%)");
        var ok = await Json(await client.PostAsync("/ConsultancyPay/SubmitZeroPaymentDetails", new FormUrlEncodedContent(AppRequest())));
        Assert.Equal("1", ok.GetProperty("status").GetString());
        Assert.Equal(Me, FakeSql.Arg(Assert.Single(_host.Sql.Calls, c => c.Name == "SP_CONSULTANCY_MSME_ZERO_PAYMENT_DETAILS").Args, "ZedId"));
        Assert.Single(_host.Email.Sent);
    }

    [Fact]
    public async Task App_fee_list_keeps_the_named_dataset_layout()
    {
        var client = App().CreateClient();
        var json = await Json(await client.PostAsync("/Msme/GetConsultancyPaymentDetailsByType",
            new FormUrlEncodedContent(new Dictionary<string, string> { ["zedId"] = Me, ["certification"] = "silver" })));
        Assert.Equal(31, json.GetProperty("WithOutCoupon")[0].GetProperty("Id").GetInt32());
        Assert.Equal(1, json.GetProperty("CouponStatus").GetArrayLength());
        Assert.Equal("Silver", FakeSql.Arg(Assert.Single(_host.Sql.Calls, c => c.Name == "SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS").Args, "Certification"));

        // Milestone in progress: the procedure returns no result sets (the old action failed).
        _host.Sql.Procs["SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS"] = _ => FakeSql.Sets();
        var empty = await Json(await client.PostAsync("/Msme/GetConsultancyPaymentDetailsByType",
            new FormUrlEncodedContent(new Dictionary<string, string> { ["zedId"] = Me, ["certification"] = "Silver" })));
        Assert.Equal(0, empty.GetProperty("WithCoupon").GetArrayLength());
    }

    [Theory]
    [InlineData(nameof(ConsultancyMobilePaymentController.GetToken))]
    [InlineData(nameof(ConsultancyMobilePaymentController.SubmitZeroPaymentDetails))]
    [InlineData(nameof(ConsultancyMobilePaymentController.GetConsultancyPaymentDetailsByType))]
    public void App_unit_actions_are_device_bound_to_the_zed_id(string action)
    {
        var bound = typeof(ConsultancyMobilePaymentController).GetMethod(action)!.GetCustomAttribute<DeviceBoundAttribute>();
        Assert.NotNull(bound);
        Assert.Equal(MobileApps.Msme, bound.App);
        Assert.Equal(["zedId"], bound.UserFields);
    }

    [Fact]
    public async Task Enforced_device_binding_refuses_an_unknown_device()
    {
        _host.Sql.Queries["SELECT DeviceId FROM dbo.MobileDeviceBindings"] = _ => ["device-1"];
        var stranger = AppRequest();
        stranger["deviceInfo.deviceId"] = "someone-else";
        var refused = await Json(await App("Enforce").CreateClient().PostAsync("/ConsultancyPay/GetToken", new FormUrlEncodedContent(stranger)));
        Assert.Equal("0", refused.GetProperty("status").GetString());
        Assert.False(Called("SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS"));
    }

    // ----- fakes -----

    private sealed class DuplicateResponse() : DbException("Conversion failed when converting the varchar value 'ABC' to data type bit.");

    private sealed class FakeErp : IErpFinanceService
    {
        private readonly ConcurrentQueue<ErpPush> _pushes = new();

        public Task PushAsync(ErpPush push, CancellationToken ct = default)
        {
            _pushes.Enqueue(push);
            return Task.CompletedTask;
        }

        public async Task<List<ErpPush>> WaitAsync(int count)
        {
            for (var i = 0; i < 100 && _pushes.Count < count; i++) await Task.Delay(50);
            return [.. _pushes];
        }
    }

    private sealed class FakeMobileGateway : ICcAvenueMobileClient
    {
        public const string Token = "SECURE-TOKEN-1";
        public const string RsaKey = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtest";
        public ConcurrentQueue<string> TokenCalls { get; } = new();
        public ConcurrentQueue<string> RsaCalls { get; } = new();

        public Task<SecureTokenResponse?> GetSecureTokenAsync(string orderId, CancellationToken ct)
        {
            TokenCalls.Enqueue(orderId);
            return Task.FromResult<SecureTokenResponse?>(new SecureTokenResponse { responseStatus = "Successful", secureToken = Token });
        }

        public Task<string> GetRsaKeyAsync(string orderId, CancellationToken ct)
        {
            RsaCalls.Enqueue(orderId);
            return Task.FromResult(RsaKey);
        }
    }
}

/// <summary>ErpFinanceService: the CONSULTANCY module (invoice and receipt per milestone, no customer).</summary>
public sealed class ConsultancyPaymentErpTests
{
    private readonly FakeSql _sql = new();
    private readonly List<Uri> _posted = [];

    private ErpFinanceService Service() => new(
        new HttpClient(new StubHandler(_posted)), _sql,
        Options.Create(new ErpOptions { Enabled = true, TenantId = "tenant", ClientId = "id", ClientSecret = "secret", CompanyBaseUrl = "https://erp.example.test/company" }),
        NullLogger<ErpFinanceService>.Instance);

    public ConsultancyPaymentErpTests()
    {
        foreach (var proc in new[] { "SP_API_FINANCE_CONSULTANCY_GET_INVOICE_DETAILS", "SP_API_FINANCE_CONSULTANCY_GET_RECEIPT_DETAILS" })
            _sql.Procs[proc] = _ => FakeSql.Sets([new { Invoice_No = "INV1", Quantity = 1, Amount_Received = 23600.00m }]);
    }

    [Theory]
    [InlineData(ErpDocument.Invoice, "SP_API_FINANCE_CONSULTANCY_GET_INVOICE_DETAILS", "Import_Invoice_Data_Excel")]
    [InlineData(ErpDocument.Receipt, "SP_API_FINANCE_CONSULTANCY_GET_RECEIPT_DETAILS", "Import_Receipt_Data_Excel")]
    public async Task Consultancy_loads_its_own_data_for_the_milestone(ErpDocument document, string procedure, string endpoint)
    {
        await Service().PushAsync(new ErpPush("ZEDMSME000001", "Silver", document, "CONSULTANCY", "2"));

        var load = Assert.Single(_sql.Calls, c => c.Name == procedure);
        Assert.Equal("2", FakeSql.Arg(load.Args, "LatestMileStoneNo"));
        Assert.Equal("Silver", FakeSql.Arg(load.Args, "Certification"));
        Assert.EndsWith("/" + endpoint, Assert.Single(_posted).AbsolutePath);
        var log = Assert.Single(_sql.Calls, c => c.Name == "SP_API_FINANCE_UNIT_DETAILS_RESPONSE");
        Assert.Equal("CONSULTANCY", FakeSql.Arg(log.Args, "ModuleName"));
        Assert.Equal("2", FakeSql.Arg(log.Args, "LatestMileStoneNo"));
    }

    [Fact]
    public async Task Consultancy_has_no_customer_posting_and_other_modules_pass_no_milestone()
    {
        await Service().PushAsync(new ErpPush("ZEDMSME000001", "Silver", ErpDocument.Customer, "CONSULTANCY", "2"));
        Assert.Empty(_sql.Calls);
        Assert.Empty(_posted);

        _sql.Procs["SP_API_FINANCE_GET_INVOICE_DETAILS"] = _ => FakeSql.Sets([new { Invoice_No = "INV1" }]);
        await Service().PushAsync(new ErpPush("ZEDMSME000001", "Bronze", ErpDocument.Invoice));
        Assert.Null(FakeSql.Arg(Assert.Single(_sql.Calls, c => c.Name == "SP_API_FINANCE_GET_INVOICE_DETAILS").Args, "LatestMileStoneNo"));
    }

    private sealed class StubHandler(List<Uri> posted) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            if (request.RequestUri!.Host == "login.microsoftonline.com")
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(new { access_token = "token" }) });
            posted.Add(request.RequestUri);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{}") });
        }
    }
}
