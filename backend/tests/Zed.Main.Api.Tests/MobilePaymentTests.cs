using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Zed.Core.Mobile;
using Zed.Core.Payments;
using Zed.Portal.Features.Payments.Mobile;

namespace Zed.Main.Api.Tests;

/// <summary>The MSME app's payment actions on the portal (Pay/GetToken, GetTokenRSA, successtransmobile, ...).</summary>
public sealed class MobilePaymentTests : IDisposable
{
    private const string Me = "ZEDMSME000001";
    private const string Gstin = "09ABCDE1234F1Z5";      // PAN ABCDE1234F
    private const string MobileKey = "0011223344556677889900AABBCCDDEE";
    private const string SurveillanceOrders = "SELECT ZedId, Certification, Amount, PaymentStatus FROM ZED_SURVEILLANCE.dbo.PaymentGatewayTransactions";
    private const string CertificationOrders = "SELECT ZedId, Certification, Amount, PaymentStatus FROM PaymentGatewayTransactions";
    private const string SurveillanceOrderId = "5f0c2b7e-0d5e-4d43-9d0a-2b4c7e1f9a10";

    private readonly TestHost _host = new();
    private readonly FakeMobileGateway _gateway = new();
    private readonly WebApplicationFactory<Program> _app;
    private readonly ConcurrentDictionary<string, bool> _surveillanceOpen = new(StringComparer.OrdinalIgnoreCase) { ["Bronze"] = true };
    private bool _zeroRecorded = true;

    public MobilePaymentTests()
    {
        _app = App("Monitor");

        _host.Sql.Procs["SP_MSME_GET_DETAILS"] = _ => FakeSql.Sets(
            [new { ZedId = Me, PledgeEmailId = "pledge@acme.test", EnterpriseName = "Acme", BronzeDashboardSurStatus = 1, SilverDashboardSurStatus = 0, GoldDashboardSurStatus = 0 }],
            [new { UdyogAadharNo = "UDYAM-UP-29-0003915", MobileNo = "9999999999", EnterpriseTypee = "Micro", CertOrReCert = "Certification", PaymentReceiptName = "_Payment_Receipt.pdf" }],
            [], [],
            [new { Total = "11800.00", UseCoupon = "No", Subsidy = "9440", SubsidyLabel = "(80%)", StateSubsidy = "0", ApplicantContributionAfterSubsidy = "2360.00", SubsidyAmount = "2000.00", GstAfterSubsidy = "360.00", TdsDeductible = "No" }]);
        _host.Sql.Procs["SP_MSME_GET_PAYMENT_DETAILS"] = _ => FakeSql.Sets(
            [new { Id = 11, Total = "11800.00", Coupon = "10000", ApplicantContributionAfterSubsidy = "0.00", NetPaybleTds15 = "0.00", NetPaybleTds75 = "0.00", UdyamPanNo = "ABCDE1234F" }],
            [new { Id = 12, Total = "11800.00", ApplicantContributionAfterSubsidy = "2360.00", NetPaybleTds15 = "2320.00", NetPaybleTds75 = "2160.00", UdyamPanNo = "ABCDE1234F" }],
            [new { IsCouponUsed = 0 }]);
        _host.Sql.Procs["SP_MSME_PAYMENT_BASIC_DETAILS"] = args => FakeSql.Sets([new
        {
            AmountToBePaid = FakeSql.Arg(args, "Tds") switch { "1.5" => "2320.00", "7.5" => "2160.00", _ => "2360.00" },
            TransactionId = "100001", MerchantParam3 = "Certification", EnterpriseName = "Acme", MobileNo = "9999999999",
        }]);
        _host.Sql.Queries["SELECT ZedId FROM Msme WHERE ZedId = @ZedId AND Is"] = _ => _zeroRecorded ? [Me] : [];

        _host.Sql.Procs["SP_SURVEILLANCE_MSME_GET_PAYMENT_STATUS"] = args =>
            FakeSql.Sets([new { PaymentStatus = _surveillanceOpen.GetValueOrDefault(FakeSql.Arg(args, "Certification")!) ? 1 : 0 }]);
        SetSurveillanceFees("1180.00");
        _host.Sql.Procs["SP_SURVEILLANCE_MSME_PAYMENT_BASIC_DETAILS"] = args => FakeSql.Sets([new
        {
            AmountToBePaid = "1180.00", TransactionId = FakeSql.Arg(args, "TransactionId"), MerchantParam3 = "Surveillance 1",
        }]);
        _host.Sql.Procs["SP_SURVEILLANCE_MSME_ZERO_PAYMENT_DETAILS"] = args =>
        {
            _surveillanceOpen[FakeSql.Arg(args, "Certification")!] = false;
            return FakeSql.Sets();
        };
        _host.Sql.Procs["SP_SURVEILLANCE_MSME_GET_DETAILS"] = _ => FakeSql.Sets(
            [new { ZedId = Me, PledgeEmailId = "pledge@acme.test", MobileNo = "9999999999", EnterpriseName = "Acme", MileStoneNo = 0 }],
            [new { PaymentReceiptName = "Bronze_Milestone0_Payment_Receipt.pdf", SurveOrReSurve = "Surveillance" }],
            [], [],
            [new { Total = "2360.00", UseCoupon = "No", ApplicantContributionAfterSubsidy = "1180.00", TdsDeductible = "No" }]);
    }

    public void Dispose() => _host.Dispose();

    private WebApplicationFactory<Program> App(string deviceBinding) => _host.WithWebHostBuilder(b =>
    {
        b.UseSetting("CcAvenue:MobileAccessCode", "AVMOBILE");
        b.UseSetting("CcAvenue:MobileWorkingKey", MobileKey);
        b.UseSetting("Mobile:DeviceBinding", deviceBinding);
        b.ConfigureTestServices(s =>
        {
            s.RemoveAll<ICcAvenueMobileClient>();
            s.AddSingleton<ICcAvenueMobileClient>(_gateway);
        });
    });

    private HttpClient Client() => _app.CreateClient(new() { AllowAutoRedirect = false });

    private void SetSurveillanceFees(string payable) =>
        _host.Sql.Procs["SP_SURVEILLANCE_MSME_GET_PAYMENT_DETAILS"] = _ => FakeSql.Sets(
            [new { Id = 21, Total = "2360.00", ApplicantContributionAfterSubsidy = "0.00", NetPaybleTds15 = "0.00", NetPaybleTds75 = "0.00", UdyamPanNo = "ABCDE1234F" }],
            [new { Id = 22, Total = "2360.00", ApplicantContributionAfterSubsidy = payable, NetPaybleTds15 = "1156.40", NetPaybleTds75 = "1092.50", UdyamPanNo = "ABCDE1234F", CertGstNo = Gstin }],
            [new { IsCouponUsed = 0 }]);

    private static Dictionary<string, string> Request(string level = "Bronze", string useCoupon = "No", string? paymentRefId = "12", string? amount = null) => new()
    {
        ["ZedId"] = Me, ["Certification"] = level, ["UseCoupon"] = useCoupon, ["UnitGstin"] = "No", ["TdsDeductible"] = "No",
        ["PaymentRefId"] = paymentRefId ?? "", ["Amount"] = amount ?? "", ["deviceInfo.deviceId"] = "device-1",
    };

    private bool Called(string proc) => _host.Sql.Calls.Any(c => c.Name == proc);

    private static async Task<JsonElement> Json(HttpResponseMessage r) => JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;

    // ----- GetToken -----

    [Fact]
    public async Task GetToken_returns_what_the_sdk_needs_with_the_amount_and_order_from_the_server()
    {
        var r = await Client().PostAsync("/Pay/GetToken", new FormUrlEncodedContent(Request(amount: "2360.00")));

        Assert.Equal("application/json", r.Content.Headers.ContentType!.MediaType);
        var json = await Json(r);
        Assert.Equal("1", json.GetProperty("status").GetString());
        Assert.Equal("100001", json.GetProperty("orderId").GetString());
        Assert.Equal("2360.00", json.GetProperty("amount").GetString());
        Assert.Equal("AVMOBILE", json.GetProperty("accessCode").GetString());
        Assert.Equal("12345", json.GetProperty("merchantId").GetString());
        Assert.Equal(MobilePaymentHashes.Sha512("100001INR2360.00" + FakeMobileGateway.Token), json.GetProperty("requestHash").GetString());
        // Legacy RequestHashResponse layout: base fields present, as null.
        Assert.Equal(JsonValueKind.Null, json.GetProperty("errorMessage").ValueKind);
        Assert.True(json.TryGetProperty("refId", out _));
        Assert.True(json.TryGetProperty("token", out _));

        Assert.Equal(["100001"], _gateway.TokenOrders);
        var basic = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_PAYMENT_BASIC_DETAILS");
        Assert.Equal(Me, FakeSql.Arg(basic.Args, "ZedId"));
        Assert.Equal("12", FakeSql.Arg(basic.Args, "PaymentRefId"));
        Assert.Equal("No", FakeSql.Arg(basic.Args, "UseCoupon"));
    }

    [Fact]
    public void Secure_token_hash_is_the_legacy_lower_case_sha512() =>
        Assert.Equal(
            "ee26b0dd4af7e749aa1a8ee3c10ae9923f618980772e473f8819a5d4940e0db27ac185f8a0e1d5f84f88bc887fd67b143732c304cc5fa9ad8e6f57f50028a8ff",
            MobilePaymentHashes.Sha512("test"));

    [Theory]
    [InlineData("Yes", Gstin)]   // web convention: UnitGstin Yes/No, number in Gst
    [InlineData(Gstin, "Yes")]   // swapped (handled inside the procedure)
    public async Task GetToken_accepts_json_and_both_gstin_conventions_and_tds(string unitGstin, string gst)
    {
        var r = await Client().PostAsJsonAsync("/Pay/GetToken", new
        {
            zedId = Me, certification = "bronze", useCoupon = "No", unitGstin, gst, tdsDeductible = "Yes", tds = "15", tan = "abcd12345e",
            paymentRefId = 12, deviceInfo = new { deviceId = "device-1" },
        });

        var json = await Json(r);
        Assert.Equal("1", json.GetProperty("status").GetString());
        Assert.Equal("2320.00", json.GetProperty("amount").GetString());
        var basic = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_PAYMENT_BASIC_DETAILS");
        Assert.Equal("Yes", FakeSql.Arg(basic.Args, "UnitGstin"));
        Assert.Equal(Gstin, FakeSql.Arg(basic.Args, "Gstin"));
        Assert.Equal("1.5", FakeSql.Arg(basic.Args, "Tds"));
        Assert.Equal("ABCD12345E", FakeSql.Arg(basic.Args, "Tan"));
        Assert.Equal("Bronze", FakeSql.Arg(basic.Args, "Certification"));
    }

    [Theory]
    [InlineData("11", null)]        // another fee row (the reward row) without the reward
    [InlineData("1", null)]         // any other AssessmentFee row
    [InlineData("12", "1.00")]      // the ₹1 amount
    [InlineData("12", "abc")]
    public async Task GetToken_refuses_a_tampered_fee_row_or_amount(string paymentRefId, string? amount)
    {
        var r = await Client().PostAsync("/Pay/GetToken", new FormUrlEncodedContent(Request(paymentRefId: paymentRefId, amount: amount)));

        Assert.Equal("text/html", r.Content.Headers.ContentType!.MediaType);
        var json = await Json(r);
        Assert.Equal("0", json.GetProperty("status").GetString());
        Assert.Equal("The fee details have changed. Please open the payment screen again.", json.GetProperty("errorMessage").GetString());
        Assert.False(Called("SP_MSME_PAYMENT_BASIC_DETAILS"));
        Assert.Empty(_gateway.TokenOrders);
    }

    [Fact]
    public async Task GetToken_refuses_when_the_procedure_amount_differs_from_the_fee_row()
    {
        _host.Sql.Procs["SP_MSME_PAYMENT_BASIC_DETAILS"] = _ => FakeSql.Sets([new { AmountToBePaid = "1.00", TransactionId = "100002" }]);
        var json = await Json(await Client().PostAsync("/Pay/GetToken", new FormUrlEncodedContent(Request())));
        Assert.Equal("0", json.GetProperty("status").GetString());
        Assert.StartsWith("The payment amount could not be confirmed", json.GetProperty("errorMessage").GetString());
        Assert.Empty(_gateway.TokenOrders);
    }

    [Theory]
    [InlineData("", "Bronze", "Invalid details.")]
    [InlineData(Me, "Platinum", "Invalid details.")]
    public async Task GetToken_needs_a_zed_id_and_a_level(string zedId, string level, string message)
    {
        var request = Request(level: level);
        request["ZedId"] = zedId;
        var json = await Json(await Client().PostAsync("/Pay/GetToken", new FormUrlEncodedContent(request)));
        Assert.Equal("0", json.GetProperty("status").GetString());
        Assert.Equal(message, json.GetProperty("errorMessage").GetString());
    }

    [Fact]
    public async Task GetToken_does_not_create_an_order_when_nothing_is_due()
    {
        var json = await Json(await Client().PostAsync("/Pay/GetToken", new FormUrlEncodedContent(Request(useCoupon: "Yes", paymentRefId: "11"))));
        Assert.Equal("No payment is due for this certification.", json.GetProperty("errorMessage").GetString());
        Assert.False(Called("SP_MSME_PAYMENT_BASIC_DETAILS"));
    }

    [Fact]
    public async Task GetToken_reports_a_gateway_refusal_in_the_legacy_shape()
    {
        _gateway.TokenStatus = "Failure";
        var r = await Client().PostAsync("/Pay/GetToken", new FormUrlEncodedContent(Request()));
        Assert.Equal("application/json", r.Content.Headers.ContentType!.MediaType);
        var json = await Json(r);
        Assert.Equal("0", json.GetProperty("status").GetString());
        Assert.Equal("Failure", json.GetProperty("errorMessage").GetString());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("requestHash").ValueKind);
    }

    [Fact]
    public async Task Surveillance_GetToken_uses_a_server_order_id_and_checks_eligibility()
    {
        var json = await Json(await Client().PostAsync("/SurveillancePay/GetToken", new FormUrlEncodedContent(Request(paymentRefId: "22"))));
        Assert.Equal("1", json.GetProperty("status").GetString());
        Assert.Equal("1180.00", json.GetProperty("amount").GetString());
        var orderId = json.GetProperty("orderId").GetString()!;
        Assert.True(Guid.TryParse(orderId, out _));
        var basic = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_SURVEILLANCE_MSME_PAYMENT_BASIC_DETAILS");
        Assert.Equal(orderId, FakeSql.Arg(basic.Args, "TransactionId"));
        Assert.Equal("22", FakeSql.Arg(basic.Args, "PaymentRefId"));

        // Already paid (or not certified): refused before any order is created.
        _surveillanceOpen["Bronze"] = false;
        var refused = await Json(await Client().PostAsync("/SurveillancePay/GetToken", new FormUrlEncodedContent(Request(paymentRefId: "22"))));
        Assert.Equal("Surveillance payment is not available for this certification.", refused.GetProperty("errorMessage").GetString());
        Assert.Single(_host.Sql.Calls, c => c.Name == "SP_SURVEILLANCE_MSME_PAYMENT_BASIC_DETAILS");
    }

    // ----- GetTokenRSA -----

    [Fact]
    public async Task GetTokenRSA_returns_the_gateway_key_only_for_a_pending_order_of_this_portal()
    {
        var status = (string?)null;
        _host.Sql.Queries["SELECT TransactionId, PaymentStatus FROM PaymentGatewayTransactions"] = args =>
            FakeSql.Arg(args, "TransactionId") == "100001" ? [new { TransactionId = "100001", PaymentStatus = status }] : [];

        var ok = await Client().GetAsync("/Pay/GetTokenRSA?orderId=100001");
        Assert.Equal("text/html", ok.Content.Headers.ContentType!.MediaType);
        Assert.Equal(FakeMobileGateway.RsaKey, await ok.Content.ReadAsStringAsync());
        var posted = await Client().PostAsync("/pay/gettokenrsa", new FormUrlEncodedContent(new Dictionary<string, string> { ["orderId"] = "100001" }));
        Assert.Equal(FakeMobileGateway.RsaKey, await posted.Content.ReadAsStringAsync());

        Assert.Contains("ERROR", await (await Client().GetAsync("/Pay/GetTokenRSA?orderId=999")).Content.ReadAsStringAsync());
        Assert.Contains("ERROR", await (await Client().GetAsync("/Pay/GetTokenRSA?orderId=" + Uri.EscapeDataString("100001&access_code=X"))).Content.ReadAsStringAsync());
        Assert.Contains("ERROR", await (await Client().GetAsync("/Pay/GetTokenRSA")).Content.ReadAsStringAsync());
        status = "Success";
        Assert.Contains("ERROR", await (await Client().GetAsync("/Pay/GetTokenRSA?orderId=100001")).Content.ReadAsStringAsync());

        Assert.Equal(["100001", "100001"], _gateway.RsaOrders);
    }

    [Fact]
    public async Task Surveillance_GetTokenRSA_looks_in_the_surveillance_orders()
    {
        _host.Sql.Queries["SELECT TransactionId, PaymentStatus FROM ZED_SURVEILLANCE.dbo.PaymentGatewayTransactions"] = args =>
            FakeSql.Arg(args, "TransactionId") == SurveillanceOrderId ? [new { TransactionId = SurveillanceOrderId, PaymentStatus = (string?)null }] : [];

        Assert.Equal(FakeMobileGateway.RsaKey, await (await Client().GetAsync("/SurveillancePay/GetTokenRSA?orderId=" + SurveillanceOrderId)).Content.ReadAsStringAsync());
        Assert.Contains("ERROR", await (await Client().GetAsync("/SurveillancePay/GetTokenRSA?orderId=100001")).Content.ReadAsStringAsync());
    }

    // ----- successtransmobile / failuretransmobile -----

    private void PendingOrder(string orderId = "100001", decimal amount = 2360.00m, string? status = null) =>
        _host.Sql.Queries[CertificationOrders] = args =>
            FakeSql.Arg(args, "TransactionId") == orderId
                ? [new { ZedId = Me, Certification = "Bronze", Amount = amount, PaymentStatus = status }]
                : [];

    private static FormUrlEncodedContent Encrypted(string plain, string key = MobileKey) =>
        new(new Dictionary<string, string> { ["encResp"] = CcAvenueCrypto.Encrypt(plain, key) });

    private static string Response(string status = "Success", string amount = "2360.00", string zedId = Me, string level = "Bronze", string orderId = "100001") =>
        $"order_id={orderId}&tracking_id=3100123&order_status={status}&amount={amount}&merchant_param1={zedId}&merchant_param2={level}&status_message=Gateway says {status}";

    private static (string? TrackingId, string? OrderStatus) Table(string html)
    {
        string? Cell(string name) => Regex.Match(html, $@"<td>{name}</td>\s*<td>(.*?)</td>") is { Success: true } m ? m.Groups[1].Value : null;
        return (Cell("tracking_id"), Cell("order_status"));
    }

    [Theory]
    [InlineData("/Pay/successtransmobile")]
    [InlineData("/Pay/failuretransmobile")]
    public async Task Successful_mobile_response_is_verified_recorded_and_shows_the_success_page(string path)
    {
        PendingOrder();
        var r = await Client().PostAsync(path, Encrypted(Response()));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("text/html", r.Content.Headers.ContentType!.MediaType);
        var html = await r.Content.ReadAsStringAsync();
        Assert.Contains("Registration Successful!", html);
        Assert.Equal(("3100123", "Success"), Table(html));
        var call = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_PAYMENT_GATEWAY_DETAILS");
        Assert.Equal("Success", FakeSql.Arg(call.Args, "PaymentStatus"));
        Assert.Equal(Me, FakeSql.Arg(call.Args, "ZedId"));
        Assert.Contains(_host.Email.Sent, m => m.Subject == $"ZED Certification Payment Confirmation Details - {Me}");
    }

    [Fact]
    public async Task Aborted_payment_is_recorded_and_shows_the_failure_page_with_the_gateway_status()
    {
        PendingOrder();
        var html = await (await Client().PostAsync("/Pay/failuretransmobile", Encrypted(Response(status: "Aborted")))).Content.ReadAsStringAsync();

        Assert.Contains("Payment Failed", html);
        Assert.Contains("Gateway says Aborted", html);
        Assert.Equal(("3100123", "Aborted"), Table(html));
        Assert.Equal("Aborted", FakeSql.Arg(Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_PAYMENT_GATEWAY_DETAILS").Args, "PaymentStatus"));
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Forged_garbled_or_web_key_responses_change_nothing()
    {
        PendingOrder();
        var forged = new FormUrlEncodedContent(new Dictionary<string, string> { ["order_id"] = "100001", ["order_status"] = "Success", ["merchant_param1"] = Me, ["encResp"] = "not-hex" });
        var garbled = new FormUrlEncodedContent(new Dictionary<string, string> { ["encResp"] = "00ff00ff00ff00ff00ff00ff00ff00ff" });
        var responses = new[]
        {
            await Client().PostAsync("/Pay/successtransmobile", forged),
            await Client().PostAsync("/Pay/successtransmobile", garbled),
            await Client().PostAsync("/Pay/successtransmobile", Encrypted(Response(), TestHost.WorkingKey)),   // web key
            await Client().PostAsync("/Pay/successtransmobile", new StringContent("")),
        };

        foreach (var r in responses)
        {
            var html = await r.Content.ReadAsStringAsync();
            Assert.Contains("Payment Failed", html);
            Assert.Equal("Failure", Table(html).OrderStatus);
        }
        Assert.False(Called("SP_MSME_PAYMENT_GATEWAY_DETAILS"));
        Assert.Empty(_host.Email.Sent);

        // And the mobile key does not open the web callback.
        var web = await Client().PostAsync("/api/payments/ccavenue/response", Encrypted(Response()));
        Assert.StartsWith("/msme/payment/result?status=failure", web.Headers.Location!.OriginalString);
        Assert.False(Called("SP_MSME_PAYMENT_GATEWAY_DETAILS"));
    }

    [Fact]
    public async Task Different_amount_is_recorded_as_failed_and_shown_as_failure()
    {
        PendingOrder(amount: 2360.00m);
        var html = await (await Client().PostAsync("/Pay/successtransmobile", Encrypted(Response(amount: "1.00")))).Content.ReadAsStringAsync();

        Assert.Equal(("3100123", "Failure"), Table(html));
        Assert.Equal("AmountMismatch", FakeSql.Arg(Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_PAYMENT_GATEWAY_DETAILS").Args, "PaymentStatus"));
        Assert.Empty(_host.Email.Sent);
    }

    [Theory]
    [InlineData("555", Me, "Bronze")]                // unknown order
    [InlineData("100001", "ZEDMSME999999", "Bronze")] // other unit
    [InlineData("100001", Me, "Gold")]               // other level
    public async Task Response_for_another_order_unit_or_level_changes_nothing(string orderId, string zedId, string level)
    {
        PendingOrder();
        var html = await (await Client().PostAsync("/Pay/successtransmobile", Encrypted(Response(orderId: orderId, zedId: zedId, level: level)))).Content.ReadAsStringAsync();
        Assert.Equal("Failure", Table(html).OrderStatus);
        Assert.Contains("could not be matched", html);
        Assert.False(Called("SP_MSME_PAYMENT_GATEWAY_DETAILS"));
    }

    [Fact]
    public async Task Replayed_response_is_idempotent()
    {
        PendingOrder(status: "Success");
        var html = await (await Client().PostAsync("/Pay/successtransmobile", Encrypted(Response()))).Content.ReadAsStringAsync();
        Assert.Equal(("3100123", "Success"), Table(html));
        Assert.False(Called("SP_MSME_PAYMENT_GATEWAY_DETAILS"));
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Surveillance_mobile_response_uses_the_surveillance_orders_and_procedure()
    {
        _host.Sql.Queries[SurveillanceOrders] = args =>
            FakeSql.Arg(args, "TransactionId") == SurveillanceOrderId
                ? [new { ZedId = Me, Certification = "Bronze", Amount = 1180.00m, PaymentStatus = (string?)null }]
                : [];

        var html = await (await Client().PostAsync("/SurveillancePay/successtransmobile",
            Encrypted(Response(amount: "1180.00", orderId: SurveillanceOrderId)))).Content.ReadAsStringAsync();

        Assert.Equal(("3100123", "Success"), Table(html));
        var call = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_SURVEILLANCE_MSME_PAYMENT_GATEWAY_DETAILS");
        Assert.Equal(SurveillanceOrderId, FakeSql.Arg(call.Args, "TransactionId"));
        Assert.False(Called("SP_MSME_PAYMENT_GATEWAY_DETAILS"));

        // A certification order id is not a surveillance order.
        PendingOrder();
        var other = await (await Client().PostAsync("/SurveillancePay/failuretransmobile", Encrypted(Response()))).Content.ReadAsStringAsync();
        Assert.Equal("Failure", Table(other).OrderStatus);
        Assert.False(Called("SP_MSME_PAYMENT_GATEWAY_DETAILS"));
    }

    // ----- SubmitZeroPaymentDetails -----

    [Fact]
    public async Task Zero_payment_is_recorded_only_when_the_server_fee_row_is_zero()
    {
        var r = await Client().PostAsync("/Pay/SubmitZeroPaymentDetails", new FormUrlEncodedContent(Request(useCoupon: "Yes", paymentRefId: "11", amount: "0.00")));

        Assert.Equal("text/html", r.Content.Headers.ContentType!.MediaType);
        var json = await Json(r);
        Assert.Equal("1", json.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("errorMessage").ValueKind);
        var zero = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_ZERO_PAYMENT_DETAILS");
        Assert.Equal("11", FakeSql.Arg(zero.Args, "PaymentRefId"));
        Assert.Equal("Yes", FakeSql.Arg(zero.Args, "UseCoupon"));
        Assert.Equal(Me, FakeSql.Arg(zero.Args, "ZedId"));
        Assert.Contains(_host.Email.Sent, m => m.Subject == $"ZED Certification Payment Confirmation Details - {Me}");
    }

    [Theory]
    [InlineData("No", "12")]   // the fee row has 2360 to pay
    [InlineData("No", "11")]   // claims the zero row without the reward
    [InlineData("No", "")]
    public async Task Zero_payment_is_refused_when_something_is_due(string useCoupon, string paymentRefId)
    {
        var json = await Json(await Client().PostAsync("/Pay/SubmitZeroPaymentDetails", new FormUrlEncodedContent(Request(useCoupon: useCoupon, paymentRefId: paymentRefId))));
        Assert.Equal("0", json.GetProperty("status").GetString());
        Assert.False(Called("SP_MSME_ZERO_PAYMENT_DETAILS"));
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Zero_payment_the_procedure_did_not_record_is_not_reported_as_paid()
    {
        _zeroRecorded = false;
        var json = await Json(await Client().PostAsync("/Pay/SubmitZeroPaymentDetails", new FormUrlEncodedContent(Request(useCoupon: "Yes", paymentRefId: "11"))));
        Assert.Equal("0", json.GetProperty("status").GetString());
        Assert.StartsWith("The payment could not be recorded", json.GetProperty("errorMessage").GetString());
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Surveillance_zero_payment_checks_eligibility_and_confirms_the_record()
    {
        SetSurveillanceFees("0.00");
        var ok = await Json(await Client().PostAsync("/SurveillancePay/SubmitZeroPaymentDetails", new FormUrlEncodedContent(Request(paymentRefId: "22"))));
        Assert.Equal("1", ok.GetProperty("status").GetString());
        Assert.Equal("22", FakeSql.Arg(Assert.Single(_host.Sql.Calls, c => c.Name == "SP_SURVEILLANCE_MSME_ZERO_PAYMENT_DETAILS").Args, "PaymentRefId"));

        // Now paid: not eligible any more.
        var again = await Json(await Client().PostAsync("/SurveillancePay/SubmitZeroPaymentDetails", new FormUrlEncodedContent(Request(paymentRefId: "22"))));
        Assert.Equal("Surveillance payment is not available for this certification.", again.GetProperty("errorMessage").GetString());
        Assert.Single(_host.Sql.Calls, c => c.Name == "SP_SURVEILLANCE_MSME_ZERO_PAYMENT_DETAILS");
    }

    // ----- fee lists -----

    [Fact]
    public async Task Fee_lists_keep_the_named_dataset_layout()
    {
        var r = await Client().PostAsync("/Msme/GetPaymentDetailsByType",
            new FormUrlEncodedContent(new Dictionary<string, string> { ["certification"] = "Bronze", ["zedId"] = Me }));
        Assert.Equal("text/html", r.Content.Headers.ContentType!.MediaType);
        var json = await Json(r);
        Assert.Equal(11, json.GetProperty("WithCoupon")[0].GetProperty("Id").GetInt32());
        Assert.Equal("2360.00", json.GetProperty("WithOutCoupon")[0].GetProperty("ApplicantContributionAfterSubsidy").GetString());
        Assert.Equal(0, json.GetProperty("CouponStatus")[0].GetProperty("IsCouponUsed").GetInt32());

        var surveillance = await Json(await Client().PostAsync("/SurveillancePay/GetSurveillancePaymentDetailsByType",
            new FormUrlEncodedContent(new Dictionary<string, string> { ["certification"] = "Bronze", ["zedId"] = Me })));
        Assert.Equal(22, surveillance.GetProperty("WithOutCoupon")[0].GetProperty("Id").GetInt32());

        var empty = await Json(await Client().PostAsync("/Msme/GetPaymentDetailsByType", new FormUrlEncodedContent(new Dictionary<string, string>())));
        Assert.Equal(0, empty.GetProperty("WithCoupon").GetArrayLength());
    }

    // ----- device binding -----

    [Theory]
    [InlineData(nameof(MobilePaymentController.GetToken))]
    [InlineData(nameof(MobilePaymentController.SurveillanceGetToken))]
    [InlineData(nameof(MobilePaymentController.SubmitZeroPaymentDetails))]
    [InlineData(nameof(MobilePaymentController.SurveillanceSubmitZeroPaymentDetails))]
    [InlineData(nameof(MobilePaymentController.GetPaymentDetailsByType))]
    [InlineData(nameof(MobilePaymentController.GetSurveillancePaymentDetailsByType))]
    public void Unit_actions_are_device_bound_to_the_zed_id(string action)
    {
        var bound = typeof(MobilePaymentController).GetMethod(action)!.GetCustomAttribute<DeviceBoundAttribute>();
        Assert.NotNull(bound);
        Assert.Equal(MobileApps.Msme, bound.App);
        Assert.Equal(["zedId"], bound.UserFields);
    }

    [Fact]
    public async Task Enforced_device_binding_refuses_an_unknown_device()
    {
        _host.Sql.Queries["SELECT DeviceId FROM dbo.MobileDeviceBindings"] = _ => ["device-1"];
        var client = App("Enforce").CreateClient();

        var stranger = Request();
        stranger["deviceInfo.deviceId"] = "someone-else";
        var refused = await Json(await client.PostAsync("/Pay/GetToken", new FormUrlEncodedContent(stranger)));
        Assert.Equal("0", refused.GetProperty("status").GetString());
        Assert.Equal("This device is not registered for your account. Please login again.", refused.GetProperty("errorMessage").GetString());
        Assert.False(Called("SP_MSME_PAYMENT_BASIC_DETAILS"));

        var zero = Request(useCoupon: "Yes", paymentRefId: "11");
        zero["deviceInfo.deviceId"] = "someone-else";
        Assert.Equal("0", (await Json(await client.PostAsync("/Pay/SubmitZeroPaymentDetails", new FormUrlEncodedContent(zero)))).GetProperty("status").GetString());
        Assert.False(Called("SP_MSME_ZERO_PAYMENT_DETAILS"));

        var own = await Json(await client.PostAsync("/Pay/GetToken", new FormUrlEncodedContent(Request())));
        Assert.Equal("1", own.GetProperty("status").GetString());
    }

    private sealed class FakeMobileGateway : ICcAvenueMobileClient
    {
        public const string Token = "SECURE-TOKEN-1";
        public const string RsaKey = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtest";
        public string TokenStatus { get; set; } = "Successful";
        public ConcurrentQueue<string> TokenCalls { get; } = new();
        public ConcurrentQueue<string> RsaCalls { get; } = new();
        public string[] TokenOrders => [.. TokenCalls];
        public string[] RsaOrders => [.. RsaCalls];

        public Task<SecureTokenResponse?> GetSecureTokenAsync(string orderId, CancellationToken ct)
        {
            TokenCalls.Enqueue(orderId);
            return Task.FromResult<SecureTokenResponse?>(new SecureTokenResponse { responseStatus = TokenStatus, secureToken = TokenStatus == "Successful" ? Token : null });
        }

        public Task<string> GetRsaKeyAsync(string orderId, CancellationToken ct)
        {
            RsaCalls.Enqueue(orderId);
            return Task.FromResult(RsaKey);
        }
    }
}
