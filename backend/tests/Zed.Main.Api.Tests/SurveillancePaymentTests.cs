using System.Collections.Concurrent;
using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Zed.Core.Finance;
using Zed.Core.Payments;

namespace Zed.Main.Api.Tests;

public sealed class SurveillancePaymentTests : IDisposable
{
    private const string Me = "ZEDMSME000001";
    private const string Gstin = "09ABCDE1234F1Z5";      // PAN ABCDE1234F
    private const string Api = "/api/msme/surveillance-payments";
    private const string Callback = "/api/payments/ccavenue/surveillance-response";
    private const string Orders = "SELECT ZedId, Certification, Amount, PaymentStatus FROM ZED_SURVEILLANCE.dbo.PaymentGatewayTransactions";
    private readonly TestHost _host = new();

    /// <summary>Levels whose surveillance fee is unpaid (SP_SURVEILLANCE_MSME_GET_PAYMENT_STATUS = 1).</summary>
    private readonly ConcurrentDictionary<string, bool> _open = new(StringComparer.OrdinalIgnoreCase) { ["Bronze"] = true, ["Silver"] = true };

    public SurveillancePaymentTests()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = _ =>
            FakeSql.Sets([new { UserId = Me, UserName = "Acme", RoleId = 5, Email = "a@acme.test" }], [new { ERRORMSG = "SUCCESS" }]);
        SetDashboard(bronze: 1, silver: 0);
        _host.Sql.Procs["SP_SURVEILLANCE_MSME_GET_PAYMENT_STATUS"] = args =>
            FakeSql.Sets([new { PaymentStatus = _open.GetValueOrDefault(FakeSql.Arg(args, "Certification")!) ? 1 : 0 }]);
        SetFees(payable: "1180.00");
        // Like the procedure: the amount follows the fee row and the TDS choice; the order id is the caller's.
        _host.Sql.Procs["SP_SURVEILLANCE_MSME_PAYMENT_BASIC_DETAILS"] = args => FakeSql.Sets([new
        {
            AmountToBePaid = FakeSql.Arg(args, "Tds") switch { "1.5" => "1156.40", "7.5" => "1092.50", _ => "1180.00" },
            TransactionId = FakeSql.Arg(args, "TransactionId"), MerchantParam3 = "Surveillance 1", EnterpriseName = "Acme & Co",
            PAddress = "Plot 4", MobileNo = "9999999999", PledgeEmailId = "pledge@acme.test", PStateName = "UP", PDistrictName = "Kanpur", PPin = "208001",
        }]);
        _host.Sql.Procs["SP_SURVEILLANCE_MSME_ZERO_PAYMENT_DETAILS"] = args =>
        {
            _open[FakeSql.Arg(args, "Certification")!] = false;
            return FakeSql.Sets();
        };
        _host.Sql.Procs["SP_SURVEILLANCE_MSME_GET_DETAILS"] = _ => FakeSql.Sets(
            [new { ZedId = Me, PledgeEmailId = "pledge@acme.test", MobileNo = "9999999999", EnterpriseName = "Acme", MileStoneNo = 0 }],
            [new { PaymentReceiptName = "Bronze_Milestone0_Payment_Receipt.pdf", SurveOrReSurve = "Surveillance" }],
            [], [],
            [new { Total = "2360.00", UseCoupon = "No", Subsidy = "1180", SubsidyLabel = "(50%)", ApplicantContributionAfterSubsidy = "1180.00", SubsidyPer = "1000.00", GstAfterSubsidy = "180.00", TdsDeductible = "No" }]);
    }

    public void Dispose() => _host.Dispose();

    private void SetDashboard(int bronze, int silver) =>
        _host.Sql.Procs["SP_MSME_GET_DETAILS"] = _ => FakeSql.Sets(
            [new { ZedId = Me, PledgeEmailId = "pledge@acme.test", BronzeDashboardSurStatus = bronze, SilverDashboardSurStatus = silver, GoldDashboardSurStatus = 0 }],
            [new { UdyogAadharNo = "UDYAM-UP-29-0003915", MobileNo = "9999999999", EnterpriseTypee = "Micro" }]);

    private void SetFees(string payable, bool rewardUsed = false) =>
        _host.Sql.Procs["SP_SURVEILLANCE_MSME_GET_PAYMENT_DETAILS"] = _ => FakeSql.Sets(
            [new { Id = 21, Total = "2360.00", Coupon = "2000", TotalAfterCoupon = "360.00", ApplicantContributionAfterSubsidy = "0.00", NetPaybleTds15 = "0.00", NetPaybleTds75 = "0.00", UdyamPanNo = "ABCDE1234F" }],
            [new
            {
                Id = 22, Total = "2360.00", ApplicantContributionAfterSubsidy = payable, NetPaybleTds15 = "1156.40", NetPaybleTds75 = "1092.50", UdyamPanNo = "ABCDE1234F",
                CertUnitGstin = "Yes", CertGstNo = "09abcde1234f1z5", CertTdsDeductable = "Yes", CertTds = "7.5", CertTanNo = "abcd12345e",
            }],
            [new { IsCouponUsed = rewardUsed ? 1 : 0 }]);

    private async Task<HttpClient> SignedInAsync()
    {
        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = Me, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        return client;
    }

    private static object Choices(bool reward = false, bool gstin = false, string? tds = null) => new
    {
        useReward = reward, gstinApplicable = gstin, gstin = gstin ? Gstin : null,
        tdsDeductible = tds is not null, tds, tan = tds is not null ? "ABCD12345E" : null,
        // Ignored by the API: the fee row, amount, order id and ZED ID come from the database and the cookie.
        paymentRefId = "1", amount = "1.00", zedId = "ZEDMSME999999", transactionId = "1",
    };

    private bool Called(string proc) => _host.Sql.Calls.Any(c => c.Name == proc);

    // ----- signed-in endpoints -----

    [Fact]
    public async Task Surveillance_payment_endpoints_require_a_signed_in_msme()
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync($"{Api}/Bronze/status")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync($"{Api}/Bronze/options")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync($"{Api}/gstin", new { certification = "Bronze", gstin = Gstin })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync($"{Api}/Bronze/checkout", Choices())).StatusCode);
        Assert.False(Called("SP_SURVEILLANCE_MSME_PAYMENT_BASIC_DETAILS"));
    }

    [Fact]
    public async Task Status_follows_the_dashboard_flag_and_the_payment_status_procedure()
    {
        var client = await SignedInAsync();
        Assert.True((await client.GetFromJsonAsync<JsonElement>($"{Api}/bronze/status")).GetProperty("eligible").GetBoolean());
        Assert.False((await client.GetFromJsonAsync<JsonElement>($"{Api}/Silver/status")).GetProperty("eligible").GetBoolean()); // SilverDashboardSurStatus = 0
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync($"{Api}/Platinum/status")).StatusCode);

        _open["Bronze"] = false; // already paid
        Assert.False((await client.GetFromJsonAsync<JsonElement>($"{Api}/Bronze/status")).GetProperty("eligible").GetBoolean());
        Assert.All(_host.Sql.Calls.Where(c => c.Name == "SP_SURVEILLANCE_MSME_GET_PAYMENT_STATUS"), c => Assert.Equal(Me, FakeSql.Arg(c.Args, "ZedId")));
    }

    [Fact]
    public async Task Options_refresh_the_enterprise_type_and_return_fees_and_the_previous_payment_choices()
    {
        _host.Udyam.Result = _host.Udyam.Result with { BasicDetails = new(_host.Udyam.Result.BasicDetails) { ["EnterpriseType"] = "Small" } };
        var client = await SignedInAsync();

        var json = await client.GetFromJsonAsync<JsonElement>($"{Api}/bronze/options");

        Assert.Equal("Bronze", json.GetProperty("certification").GetString());
        Assert.True(json.GetProperty("rewardAvailable").GetBoolean());
        Assert.Equal("1180.00", json.GetProperty("withoutReward").GetProperty("ApplicantContributionAfterSubsidy").GetString());
        Assert.False(json.GetProperty("withoutReward").TryGetProperty("CertGstNo", out _));
        var prefill = json.GetProperty("prefill");
        Assert.Equal("Yes", prefill.GetProperty("unitGstin").GetString());
        Assert.Equal(Gstin, prefill.GetProperty("gstin").GetString());
        Assert.Equal("7.5", prefill.GetProperty("tds").GetString());
        Assert.Equal("ABCD12345E", prefill.GetProperty("tan").GetString());

        var update = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_UPDATE_UDYAM_DETAILS");
        Assert.Equal("SURVEILLANCE", FakeSql.Arg(update.Args, "PaymentModule"));
        Assert.Equal("Small", FakeSql.Arg(update.Args, "EnterpriseType"));
        Assert.Equal(Me, FakeSql.Arg(Assert.Single(_host.Sql.Calls, c => c.Name == "SP_SURVEILLANCE_MSME_GET_PAYMENT_DETAILS").Args, "ZedId"));
    }

    [Theory]
    [InlineData("Silver", false)] // dashboard flag off (no certificate, surveillance not enabled, expired or withdrawn)
    [InlineData("Bronze", true)]  // surveillance fee already paid
    public async Task Ineligible_msme_cannot_see_fees_or_check_out(string level, bool alreadyPaid)
    {
        if (alreadyPaid) _open["Bronze"] = false;
        var client = await SignedInAsync();

        var options = await client.GetAsync($"{Api}/{level}/options");
        Assert.Equal("Surveillance payment is not available for this certification.", await options.ProblemTitle());
        foreach (var choices in new[] { Choices(), Choices(reward: true) })
        {
            var r = await client.PostAsJsonAsync($"{Api}/{level}/checkout", choices);
            Assert.Equal("Surveillance payment is not available for this certification.", await r.ProblemTitle());
        }
        Assert.False(Called("SP_SURVEILLANCE_MSME_GET_PAYMENT_DETAILS"));
        Assert.False(Called("SP_SURVEILLANCE_MSME_PAYMENT_BASIC_DETAILS"));
        Assert.False(Called("SP_SURVEILLANCE_MSME_ZERO_PAYMENT_DETAILS"));
    }

    [Fact]
    public async Task Checkout_builds_an_encrypted_gateway_request_from_database_values()
    {
        var client = await SignedInAsync();
        var r = await client.PostAsJsonAsync($"{Api}/Bronze/checkout", Choices());
        var json = await r.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal("gateway", json.GetProperty("status").GetString());
        Assert.Equal("AVTEST", json.GetProperty("accessCode").GetString());
        var basic = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_SURVEILLANCE_MSME_PAYMENT_BASIC_DETAILS");
        Assert.Equal("22", FakeSql.Arg(basic.Args, "PaymentRefId"));
        Assert.Equal(Me, FakeSql.Arg(basic.Args, "ZedId"));
        Assert.Equal("No", FakeSql.Arg(basic.Args, "UseCoupon"));
        var orderId = FakeSql.Arg(basic.Args, "TransactionId")!;
        Assert.True(Guid.TryParse(orderId, out _));

        var request = CcAvenueCrypto.ParseResponse(CcAvenueCrypto.Decrypt(json.GetProperty("encRequest").GetString()!, TestHost.WorkingKey));
        Assert.Equal(orderId, request["order_id"]);
        Assert.Equal("1180.00", request["amount"]);
        Assert.Equal(Me, request["merchant_param1"]);
        Assert.Equal("Bronze", request["merchant_param2"]);
        Assert.Equal("Surveillance 1", request["merchant_param3"]);
        Assert.Equal("Acme  Co", request["billing_name"]);
        Assert.EndsWith(Callback, request["redirect_url"]);
        Assert.EndsWith(Callback, request["cancel_url"]);
        Assert.False(Called("SP_SURVEILLANCE_MSME_ZERO_PAYMENT_DETAILS"));
    }

    [Fact]
    public async Task Checkout_refuses_when_the_procedure_amount_differs_from_the_fee_row()
    {
        _host.Sql.Procs["SP_SURVEILLANCE_MSME_PAYMENT_BASIC_DETAILS"] = args =>
            FakeSql.Sets([new { AmountToBePaid = "1.00", TransactionId = FakeSql.Arg(args, "TransactionId") }]);
        var client = await SignedInAsync();
        var r = await client.PostAsJsonAsync($"{Api}/Bronze/checkout", Choices());
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.StartsWith("The payment amount could not be confirmed", await r.ProblemTitle());
    }

    [Fact]
    public async Task Checkout_reports_an_already_paid_level()
    {
        _host.Sql.Procs["SP_SURVEILLANCE_MSME_PAYMENT_BASIC_DETAILS"] = _ => FakeSql.Sets([]); // ZedId '0000' branch: no row
        var client = await SignedInAsync();
        var r = await client.PostAsJsonAsync($"{Api}/Bronze/checkout", Choices());
        Assert.Equal("Payment is already done for this certification.", await r.ProblemTitle());
    }

    [Fact]
    public async Task Zero_amount_checkout_is_only_possible_when_the_fee_row_is_really_zero()
    {
        var client = await SignedInAsync();

        // Without the reward there is something to pay: the gateway path, never the zero path.
        var pay = await client.PostAsJsonAsync($"{Api}/Bronze/checkout", Choices());
        Assert.Equal("gateway", (await pay.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString());
        Assert.False(Called("SP_SURVEILLANCE_MSME_ZERO_PAYMENT_DETAILS"));

        // With the reward the applicant contribution is 0.
        var r = await client.PostAsJsonAsync($"{Api}/Bronze/checkout", Choices(reward: true));
        Assert.Equal("paid", (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString());
        var zero = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_SURVEILLANCE_MSME_ZERO_PAYMENT_DETAILS");
        Assert.Equal("21", FakeSql.Arg(zero.Args, "PaymentRefId"));
        Assert.Equal("Yes", FakeSql.Arg(zero.Args, "UseCoupon"));
        Assert.Equal(Me, FakeSql.Arg(zero.Args, "ZedId"));

        // Receipt where GenerateReceipt wrote it, confirmation mailed.
        Assert.True(File.Exists(Path.Combine(_host.StorageRoot, "PDFs", "SA", Me, "Bronze_Milestone0_Payment_Receipt.pdf")));
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal($"ZED Surveillance Assessment fee Payment Confirmation Details - {Me}", mail.Subject);
        Assert.Contains("Surveillance Assessment Fee", mail.HtmlBody);
    }

    [Fact]
    public async Task Zero_payment_that_the_procedure_skipped_is_not_reported_as_paid()
    {
        // ZED_SURVEILLANCE SP_MSME_ZERO_PAYMENT_DETAILS silently does nothing once IsBronzePaymentDone is set.
        _host.Sql.Procs["SP_SURVEILLANCE_MSME_ZERO_PAYMENT_DETAILS"] = _ => FakeSql.Sets();
        var client = await SignedInAsync();
        var r = await client.PostAsJsonAsync($"{Api}/Bronze/checkout", Choices(reward: true));
        Assert.StartsWith("The payment could not be recorded", await r.ProblemTitle());
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Used_reward_cannot_be_applied_again()
    {
        SetFees(payable: "1180.00", rewardUsed: true);
        var client = await SignedInAsync();
        var r = await client.PostAsJsonAsync($"{Api}/Bronze/checkout", Choices(reward: true));
        Assert.Equal("The joining reward is not available.", await r.ProblemTitle());
        Assert.False(Called("SP_SURVEILLANCE_MSME_ZERO_PAYMENT_DETAILS"));
    }

    [Fact]
    public async Task Gstin_must_be_verified_and_match_the_udyam_pan()
    {
        var client = await SignedInAsync();

        var unverified = await client.PostAsJsonAsync($"{Api}/Bronze/checkout", Choices(gstin: true));
        Assert.Equal("Please verify the GSTIN first.", await unverified.ProblemTitle());

        // A GSTIN verified on the certification payment page does not count here.
        await client.PostAsJsonAsync("/api/msme/payments/gstin", new { certification = "Bronze", gstin = "09PQRST6789K1Z2" });
        var other = await client.PostAsJsonAsync($"{Api}/Bronze/checkout", new { useReward = false, gstinApplicable = true, gstin = "09PQRST6789K1Z2", tdsDeductible = false });
        Assert.Equal("Please verify the GSTIN first.", await other.ProblemTitle());

        var verify = await client.PostAsJsonAsync($"{Api}/gstin", new { certification = "Bronze", gstin = Gstin });
        Assert.True((await verify.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("panMatches").GetBoolean());

        var ok = await client.PostAsJsonAsync($"{Api}/Bronze/checkout", Choices(gstin: true, tds: "7.5"));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var basic = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_SURVEILLANCE_MSME_PAYMENT_BASIC_DETAILS");
        Assert.Equal(Gstin, FakeSql.Arg(basic.Args, "Gstin"));
        Assert.Equal("7.5", FakeSql.Arg(basic.Args, "Tds"));
        Assert.Equal("ABCD12345E", FakeSql.Arg(basic.Args, "Tan"));
        var request = CcAvenueCrypto.ParseResponse(CcAvenueCrypto.Decrypt(
            (await ok.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("encRequest").GetString()!, TestHost.WorkingKey));
        Assert.Equal("1092.50", request["amount"]);
    }

    [Fact]
    public async Task Pan_correction_needs_a_verified_gstin_and_uses_the_pan_from_the_database()
    {
        var client = await SignedInAsync();
        Assert.Equal("Please verify the GSTIN first.",
            await (await client.PostAsJsonAsync($"{Api}/pan", new { certification = "Bronze", gstin = "09PQRST6789K1Z2", pan = "PQRST6789K" })).ProblemTitle());

        await client.PostAsJsonAsync($"{Api}/gstin", new { certification = "Bronze", gstin = "09PQRST6789K1Z2" });
        Assert.Equal("Please enter the correct PAN associated with that GSTIN.",
            await (await client.PostAsJsonAsync($"{Api}/pan", new { certification = "Bronze", gstin = "09PQRST6789K1Z2", pan = "ZZZZZ9999Z" })).ProblemTitle());

        var ok = await client.PostAsJsonAsync($"{Api}/pan", new { certification = "Bronze", gstin = "09PQRST6789K1Z2", pan = "PQRST6789K", zedId = "ZEDMSME999999", panNo = "XXXXX0000X" });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var update = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MESE_UPDATE_PAN");
        Assert.Equal(Me, FakeSql.Arg(update.Args, "ZedId"));
        Assert.Equal("ABCDE1234F", FakeSql.Arg(update.Args, "PanNo"));
        Assert.Equal("PQRST6789K", FakeSql.Arg(update.Args, "UpdatedPanNo"));
    }

    // ----- gateway callback -----

    private const string OrderId = "5f0c2b7e-0d5e-4d43-9d0a-2b4c7e1f9a10";

    private void PendingOrder(decimal amount = 1180.00m, string? status = null) =>
        _host.Sql.Queries[Orders] = args =>
            FakeSql.Arg(args, "TransactionId") == OrderId
                ? [new { ZedId = Me, Certification = "Bronze", Amount = amount, PaymentStatus = status }]
                : [];

    private static FormUrlEncodedContent Encrypted(string plain, string key = TestHost.WorkingKey) =>
        new(new Dictionary<string, string> { ["encResp"] = CcAvenueCrypto.Encrypt(plain, key) });

    private static string Paid(string orderId = OrderId, string amount = "1180.00", string zedId = Me, string level = "Bronze", string status = "Success") =>
        $"order_id={orderId}&tracking_id=999&order_status={status}&amount={amount}&merchant_param1={zedId}&merchant_param2={level}&merchant_param3=Surveillance 1";

    private HttpClient Gateway() => _host.CreateClient(new() { AllowAutoRedirect = false });

    [Fact]
    public async Task Successful_callback_records_payment_and_sends_the_browser_to_the_surveillance_result()
    {
        PendingOrder();
        var r = await Gateway().PostAsync(Callback, Encrypted(Paid()));

        Assert.Equal(HttpStatusCode.SeeOther, r.StatusCode);
        Assert.Equal("/msme/payment/result?status=success&certification=Bronze&kind=surveillance", r.Headers.Location!.OriginalString);
        var call = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_SURVEILLANCE_MSME_PAYMENT_GATEWAY_DETAILS");
        Assert.Equal("Success", FakeSql.Arg(call.Args, "PaymentStatus"));
        Assert.Equal(Me, FakeSql.Arg(call.Args, "ZedId"));
        Assert.Equal(OrderId, FakeSql.Arg(call.Args, "TransactionId"));
        Assert.False(Called("SP_MSME_PAYMENT_GATEWAY_DETAILS"));
        Assert.Contains(_host.Email.Sent, m => m.Subject == $"ZED Surveillance Assessment fee Payment Confirmation Details - {Me}");
        Assert.True(File.Exists(Path.Combine(_host.StorageRoot, "PDFs", "SA", Me, "Bronze_Milestone0_Payment_Receipt.pdf")));
    }

    [Fact]
    public async Task Callback_with_a_different_amount_is_recorded_as_failed()
    {
        PendingOrder(amount: 1180.00m);
        var r = await Gateway().PostAsync(Callback, Encrypted(Paid(amount: "1.00")));

        Assert.StartsWith("/msme/payment/result?status=failure&certification=Bronze&kind=surveillance", r.Headers.Location!.OriginalString);
        var call = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_SURVEILLANCE_MSME_PAYMENT_GATEWAY_DETAILS");
        Assert.Equal("AmountMismatch", FakeSql.Arg(call.Args, "PaymentStatus"));
        Assert.Empty(_host.Email.Sent);
    }

    [Theory]
    [InlineData("00000000-0000-0000-0000-000000000000", Me, "Bronze")]   // unknown order (e.g. a ZED certification order)
    [InlineData(OrderId, "ZEDMSME999999", "Bronze")]                     // other unit
    [InlineData(OrderId, Me, "Silver")]                                  // other level
    public async Task Callback_that_does_not_match_an_order_changes_nothing(string orderId, string zedId, string level)
    {
        PendingOrder();
        var r = await Gateway().PostAsync(Callback, Encrypted(Paid(orderId, zedId: zedId, level: level)));
        Assert.StartsWith("/msme/payment/result?status=failure", r.Headers.Location!.OriginalString);
        Assert.Contains("kind=surveillance", r.Headers.Location!.OriginalString);
        Assert.False(Called("SP_SURVEILLANCE_MSME_PAYMENT_GATEWAY_DETAILS"));
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Forged_or_wrongly_encrypted_callbacks_are_rejected()
    {
        PendingOrder();
        var forged = await Gateway().PostAsync(Callback, new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["order_id"] = OrderId, ["order_status"] = "Success", ["merchant_param1"] = Me, ["encResp"] = "not-hex",
        }));
        var wrongKey = await Gateway().PostAsync(Callback, Encrypted(Paid(), "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"));
        var reconciliationKey = await Gateway().PostAsync(Callback, Encrypted(Paid(), TestHost.ReconciliationKey));

        foreach (var r in new[] { forged, wrongKey, reconciliationKey })
            Assert.StartsWith("/msme/payment/result?status=failure", r.Headers.Location!.OriginalString);
        Assert.False(Called("SP_SURVEILLANCE_MSME_PAYMENT_GATEWAY_DETAILS"));
    }

    [Fact]
    public async Task Repeated_callbacks_are_idempotent()
    {
        // Already recorded (e.g. by the reconciliation): nothing is recorded or mailed again.
        PendingOrder(status: "Success");
        var again = await Gateway().PostAsync(Callback, Encrypted(Paid()));
        Assert.Equal("/msme/payment/result?status=success&certification=Bronze&kind=surveillance", again.Headers.Location!.OriginalString);
        Assert.False(Called("SP_SURVEILLANCE_MSME_PAYMENT_GATEWAY_DETAILS"));
        Assert.Empty(_host.Email.Sent);

        // A repeated failure response the procedure refuses (it raises for duplicates) still answers cleanly.
        PendingOrder();
        _host.Sql.Procs["SP_SURVEILLANCE_MSME_PAYMENT_GATEWAY_DETAILS"] = _ => throw new DuplicateResponse();
        var refused = await Gateway().PostAsync(Callback, Encrypted(Paid(status: "Failure") + "&status_message=Cancelled"));
        Assert.Equal("/msme/payment/result?status=failure&certification=Bronze&kind=surveillance&message=Cancelled", refused.Headers.Location!.OriginalString);
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Successful_callback_queues_the_surveillance_invoice_and_receipt_for_the_erp()
    {
        var erp = new FakeErp();
        using var host = _host.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<IErpFinanceService>();
            s.AddSingleton<IErpFinanceService>(erp);
        }));
        PendingOrder();

        await host.CreateClient(new() { AllowAutoRedirect = false }).PostAsync(Callback, Encrypted(Paid()));

        var pushes = await erp.WaitAsync(2);
        Assert.Equal([ErpDocument.Invoice, ErpDocument.Receipt], pushes.Select(p => p.Document));
        Assert.All(pushes, p =>
        {
            Assert.Equal("SURVEILLANCE", p.ModuleName);
            Assert.Equal(Me, p.ZedId);
            Assert.Equal("Bronze", p.Certification);
        });
    }

    [Fact]
    public async Task Reconciliation_at_the_old_surveillance_address_uses_the_reconciliation_key_and_the_routing_procedure()
    {
        _host.Sql.Procs["SP_MSME_PAYMENT_GATEWAY_DETAILS_RECONCILIATION"] = _ => FakeSql.Sets([new { ModuleName = "SURVEILLANCE" }]);
        var plain = $"order_id={OrderId}&order_status=Shipped&order_mer_param1={Me}&order_mer_param2=Bronze&order_amt=1180.00";

        var webKey = await Gateway().PostAsync("/SurveillancePay/UpdatePaymentReconciliationStatus", Encrypted(plain, TestHost.WorkingKey));
        Assert.Equal(HttpStatusCode.BadRequest, webKey.StatusCode);
        Assert.False(Called("SP_MSME_PAYMENT_GATEWAY_DETAILS_RECONCILIATION"));

        var ok = await Gateway().PostAsync("/SurveillancePay/UpdatePaymentReconciliationStatus", Encrypted(plain, TestHost.ReconciliationKey));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var call = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_PAYMENT_GATEWAY_DETAILS_RECONCILIATION");
        Assert.Equal("Success", FakeSql.Arg(call.Args, "PaymentStatus"));
        Assert.Equal("RECONCILIATION", FakeSql.Arg(call.Args, "ApiType"));
        Assert.Equal(Me, FakeSql.Arg(call.Args, "ZedId"));
        Assert.Equal(OrderId, FakeSql.Arg(call.Args, "TransactionId"));
        // As before: no mail, no receipt and no ERP posting from the reconciliation.
        Assert.False(Called("SP_SURVEILLANCE_MSME_PAYMENT_GATEWAY_DETAILS"));
        Assert.False(Called("SP_SURVEILLANCE_MSME_GET_DETAILS"));
        Assert.Empty(_host.Email.Sent);
    }

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
}

/// <summary>ErpFinanceService: procedures per module (ZED unchanged, SURVEILLANCE added).</summary>
public sealed class ErpFinanceModuleTests
{
    private readonly FakeSql _sql = new();
    private readonly List<Uri> _posted = [];

    private ErpFinanceService Service() => new(
        new HttpClient(new StubHandler(_posted)), _sql,
        Options.Create(new ErpOptions { Enabled = true, TenantId = "tenant", ClientId = "id", ClientSecret = "secret", CompanyBaseUrl = "https://erp.example.test/company" }),
        NullLogger<ErpFinanceService>.Instance);

    public ErpFinanceModuleTests()
    {
        foreach (var proc in new[]
        {
            "SP_API_FINANCE_GET_UNIT_DETAILS", "SP_API_FINANCE_GET_INVOICE_DETAILS", "SP_API_FINANCE_GET_RECEIPT_DETAILS",
            "SP_API_FINANCE_SURVEILLANCE_GET_INVOICE_DETAILS", "SP_API_FINANCE_SURVEILLANCE_GET_RECEIPT_DETAILS",
        })
            _sql.Procs[proc] = _ => FakeSql.Sets([new { Invoice_No = "INV1", Quantity = 1, Amount_Received = 1180.00m }]);
    }

    [Theory]
    [InlineData("SURVEILLANCE", ErpDocument.Invoice, "SP_API_FINANCE_SURVEILLANCE_GET_INVOICE_DETAILS", "Import_Invoice_Data_Excel")]
    [InlineData("SURVEILLANCE", ErpDocument.Receipt, "SP_API_FINANCE_SURVEILLANCE_GET_RECEIPT_DETAILS", "Import_Receipt_Data_Excel")]
    [InlineData("ZED", ErpDocument.Customer, "SP_API_FINANCE_GET_UNIT_DETAILS", "Import_Customer_Data_Excel")]
    [InlineData("ZED", ErpDocument.Invoice, "SP_API_FINANCE_GET_INVOICE_DETAILS", "Import_Invoice_Data_Excel")]
    [InlineData("ZED", ErpDocument.Receipt, "SP_API_FINANCE_GET_RECEIPT_DETAILS", "Import_Receipt_Data_Excel")]
    public async Task Each_module_loads_its_own_finance_data(string module, ErpDocument document, string procedure, string endpoint)
    {
        await Service().PushAsync(new ErpPush("ZEDMSME000001", "Bronze", document, module));

        var load = Assert.Single(_sql.Calls, c => c.Name.StartsWith("SP_API_FINANCE_", StringComparison.Ordinal) && c.Name != "SP_API_FINANCE_UNIT_DETAILS_RESPONSE");
        Assert.Equal(procedure, load.Name);
        Assert.EndsWith("/" + endpoint, Assert.Single(_posted).AbsolutePath);
        var log = Assert.Single(_sql.Calls, c => c.Name == "SP_API_FINANCE_UNIT_DETAILS_RESPONSE");
        Assert.Equal(module, FakeSql.Arg(log.Args, "ModuleName"));
        Assert.Equal("OK", FakeSql.Arg(log.Args, "StatusCode"));
    }

    [Fact]
    public async Task Surveillance_has_no_customer_posting()
    {
        await Service().PushAsync(new ErpPush("ZEDMSME000001", "Bronze", ErpDocument.Customer, "SURVEILLANCE"));
        Assert.Empty(_sql.Calls);
        Assert.Empty(_posted);
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
