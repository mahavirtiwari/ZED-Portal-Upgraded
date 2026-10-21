using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Core.Payments;

namespace Zed.Main.Api.Tests;

public sealed class CcAvenueCryptoTests
{
    // Produced by the vendor library the MVC site uses (MCPG.CCA.Util.dll, CCA.Util.CCACrypto).
    private const string Key = "ABCDEF0123456789ABCDEF0123456789";
    private const string Plain = "order_id=1234&amount=10.00&currency=INR&merchant_param1=ZEDMSME000002&billing_name=Acme & Sons=";
    private const string Cipher = "1ad67b5c00a259e4fe47923f3042dd7d918f4d38094cc6f23b029035fd1a9041903ef20b61998f09fb53d1d5656d81edad2b71e9a20a0d9d59ec980cbee1a8691fb50e98cebf8354e0ac96a839edbc83f2fff15588a4162acd900aef7970c89c";

    [Fact]
    public void Encrypt_matches_the_vendor_library() => Assert.Equal(Cipher, CcAvenueCrypto.Encrypt(Plain, Key));

    [Fact]
    public void Decrypt_matches_the_vendor_library() => Assert.Equal(Plain, CcAvenueCrypto.Decrypt(Cipher, Key));

    [Fact]
    public void Checksum_matches_the_vendor_library() =>
        Assert.Equal("2215056900", CcAvenueCrypto.Checksum("12345", "1234", "10.00", "https://test.ccavenue.com/x", Key));

    [Fact]
    public void Wrong_key_does_not_decrypt() =>
        Assert.ThrowsAny<System.Security.Cryptography.CryptographicException>(() => CcAvenueCrypto.Decrypt(Cipher, "0000000000000000000000000000000X"));

    [Fact]
    public void Request_values_cannot_inject_parameters()
    {
        var request = CcAvenueCrypto.BuildRequest([new("billing_name", "Acme&amount=1.00"), new("amount", "100.00")]);
        Assert.Equal("billing_name=Acmeamount1.00&amount=100.00", request);
    }

    [Fact]
    public void Response_values_keep_everything_after_the_first_equals()
    {
        var r = CcAvenueCrypto.ParseResponse("order_id=7&status_message=Y=N&amount=10.00");
        Assert.Equal("Y=N", r["status_message"]);
        Assert.Equal("10.00", r["amount"]);
    }
}

public sealed class PaymentTests : IDisposable
{
    private const string Me = "ZEDMSME000001";
    private const string Gstin = "09ABCDE1234F1Z5";      // PAN ABCDE1234F
    private readonly TestHost _host = new();

    public PaymentTests()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = _ =>
            FakeSql.Sets([new { UserId = Me, UserName = "Acme", RoleId = 5, Email = "a@acme.test" }], [new { ERRORMSG = "SUCCESS" }]);
        _host.Sql.Procs["SP_MSME_GET_DETAILS"] = _ => FakeSql.Sets(
            [new { ZedId = Me, PledgeEmailId = "pledge@acme.test", EnterpriseName = "Acme" }],
            [new { UdyogAadharNo = "UDYAM-UP-29-0003915", MobileNo = "9999999999", EnterpriseTypee = "Micro", CertOrReCert = "Certification", PaymentReceiptName = "_Payment_Receipt.pdf" }],
            [], [],
            [new { Total = "11800.00", UseCoupon = "No", Subsidy = "9440", SubsidyLabel = "(80%)", StateSubsidy = "0", ApplicantContributionAfterSubsidy = "2360.00", SubsidyAmount = "2000.00", GstAfterSubsidy = "360.00", TdsDeductible = "No" }]);
        SetFees(payable: "2360.00", rewardUsed: false);
        // Like the procedure: the amount follows the fee row and the TDS choice.
        _host.Sql.Procs["SP_MSME_PAYMENT_BASIC_DETAILS"] = args => FakeSql.Sets([new
        {
            AmountToBePaid = FakeSql.Arg(args, "Tds") switch { "1.5" => "2320.00", "7.5" => "2160.00", _ => "2360.00" }, TransactionId = "100001", MerchantParam3 = "Certification", EnterpriseName = "Acme & Co",
            PAddress = "Plot 4", MobileNo = "9999999999", PledgeEmailId = "pledge@acme.test", PStateName = "UP", PDistrictName = "Kanpur", PPin = "208001",
        }]);
    }

    public void Dispose() => _host.Dispose();

    private void SetFees(string payable, bool rewardUsed) =>
        _host.Sql.Procs["SP_MSME_GET_PAYMENT_DETAILS"] = _ => FakeSql.Sets(
            [new { Id = 11, Total = "11800.00", Coupon = "10000", TotalAfterCoupon = "1800.00", ApplicantContributionAfterSubsidy = "0.00", NetPaybleTds15 = "0.00", NetPaybleTds75 = "0.00", UdyamPanNo = "ABCDE1234F" }],
            [new { Id = 12, Total = "11800.00", ApplicantContributionAfterSubsidy = payable, NetPaybleTds15 = "2320.00", NetPaybleTds75 = "2160.00", UdyamPanNo = "ABCDE1234F" }],
            [new { IsCouponUsed = rewardUsed ? 1 : 0 }]);

    private async Task<HttpClient> SignedInAsync()
    {
        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = Me, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        return client;
    }

    private static object Choices(bool reward = false, bool gstin = false, bool tds = false) => new
    {
        useReward = reward, gstinApplicable = gstin, gstin = gstin ? Gstin : null,
        tdsDeductible = tds, tds = tds ? "1.5" : null, tan = tds ? "ABCD12345E" : null,
        // Ignored by the API: the fee row, amount and ZED ID come from the database and the cookie.
        paymentRefId = "1", amount = "1.00", zedId = "ZEDMSME999999",
    };

    [Fact]
    public async Task Payment_endpoints_require_a_signed_in_msme()
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/msme/payments/Bronze/options")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/msme/payments/Bronze/checkout", Choices())).StatusCode);
    }

    [Fact]
    public async Task Options_refresh_the_enterprise_type_from_udyam_and_return_the_fee_rows()
    {
        _host.Udyam.Result = _host.Udyam.Result with { BasicDetails = new(_host.Udyam.Result.BasicDetails) { ["EnterpriseType"] = "Small" } };
        var client = await SignedInAsync();

        var json = await client.GetFromJsonAsync<JsonElement>("/api/msme/payments/bronze/options");

        Assert.Equal("Bronze", json.GetProperty("certification").GetString());
        Assert.True(json.GetProperty("rewardAvailable").GetBoolean());
        Assert.Equal("2360.00", json.GetProperty("withoutReward").GetProperty("ApplicantContributionAfterSubsidy").GetString());
        var update = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_UPDATE_UDYAM_DETAILS");
        Assert.Equal("Small", FakeSql.Arg(update.Args, "EnterpriseType"));
        Assert.Equal(Me, FakeSql.Arg(update.Args, "ZedId"));
    }

    [Fact]
    public async Task Checkout_builds_an_encrypted_gateway_request_from_database_values()
    {
        var client = await SignedInAsync();
        var r = await client.PostAsJsonAsync("/api/msme/payments/Bronze/checkout", Choices());
        var json = await r.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal("gateway", json.GetProperty("status").GetString());
        Assert.Equal("AVTEST", json.GetProperty("accessCode").GetString());
        var request = CcAvenueCrypto.ParseResponse(CcAvenueCrypto.Decrypt(json.GetProperty("encRequest").GetString()!, TestHost.WorkingKey));
        Assert.Equal("100001", request["order_id"]);
        Assert.Equal("2360.00", request["amount"]);
        Assert.Equal(Me, request["merchant_param1"]);
        Assert.Equal("Bronze", request["merchant_param2"]);
        Assert.Equal("Acme  Co", request["billing_name"]);
        Assert.EndsWith("/api/payments/ccavenue/response", request["redirect_url"]);

        var basic = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_PAYMENT_BASIC_DETAILS");
        Assert.Equal("12", FakeSql.Arg(basic.Args, "PaymentRefId"));
        Assert.Equal(Me, FakeSql.Arg(basic.Args, "ZedId"));
    }

    [Fact]
    public async Task Checkout_refuses_when_the_procedure_amount_differs_from_the_fee_row()
    {
        _host.Sql.Procs["SP_MSME_PAYMENT_BASIC_DETAILS"] = _ => FakeSql.Sets([new { AmountToBePaid = "1.00", TransactionId = "100002" }]);
        var client = await SignedInAsync();
        var r = await client.PostAsJsonAsync("/api/msme/payments/Bronze/checkout", Choices());
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.StartsWith("The payment amount could not be confirmed", await r.ProblemTitle());
    }

    [Fact]
    public async Task Zero_amount_checkout_is_only_possible_when_the_fee_row_is_really_zero()
    {
        var client = await SignedInAsync();

        // With the reward the applicant contribution is 0, so the zero-payment path is used.
        var r = await client.PostAsJsonAsync("/api/msme/payments/Bronze/checkout", Choices(reward: true));
        Assert.Equal("paid", (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString());
        var zero = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_ZERO_PAYMENT_DETAILS");
        Assert.Equal("11", FakeSql.Arg(zero.Args, "PaymentRefId"));
        Assert.Equal("Yes", FakeSql.Arg(zero.Args, "UseCoupon"));
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MSME_PAYMENT_BASIC_DETAILS");

        // Receipt written where My Documents serves it, confirmation mailed.
        Assert.True(File.Exists(Path.Combine(_host.StorageRoot, "PDFs", "SA", Me, "Bronze_Payment_Receipt.pdf")));
        Assert.Contains(_host.Email.Sent, m => m.Subject == $"ZED Certification Payment Confirmation Details - {Me}");
    }

    [Fact]
    public async Task Used_reward_cannot_be_applied_again()
    {
        SetFees(payable: "2360.00", rewardUsed: true);
        var client = await SignedInAsync();
        var r = await client.PostAsJsonAsync("/api/msme/payments/Bronze/checkout", Choices(reward: true));
        Assert.Equal("The joining reward is not available.", await r.ProblemTitle());
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MSME_ZERO_PAYMENT_DETAILS");
    }

    [Fact]
    public async Task Gstin_must_be_verified_and_match_the_udyam_pan()
    {
        var client = await SignedInAsync();

        var unverified = await client.PostAsJsonAsync("/api/msme/payments/Bronze/checkout", Choices(gstin: true));
        Assert.Equal("Please verify the GSTIN first.", await unverified.ProblemTitle());

        var verify = await client.PostAsJsonAsync("/api/msme/payments/gstin", new { certification = "Bronze", gstin = Gstin });
        Assert.True((await verify.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("panMatches").GetBoolean());

        var ok = await client.PostAsJsonAsync("/api/msme/payments/Bronze/checkout", Choices(gstin: true, tds: true));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var basic = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_PAYMENT_BASIC_DETAILS");
        Assert.Equal(Gstin, FakeSql.Arg(basic.Args, "Gstin"));
        Assert.Equal("1.5", FakeSql.Arg(basic.Args, "Tds"));
    }

    [Fact]
    public async Task Pan_correction_needs_a_verified_gstin_and_its_pan()
    {
        var client = await SignedInAsync();
        Assert.Equal("Please verify the GSTIN first.",
            await (await client.PostAsJsonAsync("/api/msme/payments/pan", new { certification = "Bronze", gstin = "09PQRST6789K1Z2", pan = "PQRST6789K" })).ProblemTitle());

        await client.PostAsJsonAsync("/api/msme/payments/gstin", new { certification = "Bronze", gstin = "09PQRST6789K1Z2" });
        Assert.Equal("Please enter the correct PAN associated with that GSTIN.",
            await (await client.PostAsJsonAsync("/api/msme/payments/pan", new { certification = "Bronze", gstin = "09PQRST6789K1Z2", pan = "ZZZZZ9999Z" })).ProblemTitle());

        var ok = await client.PostAsJsonAsync("/api/msme/payments/pan", new { certification = "Bronze", gstin = "09PQRST6789K1Z2", pan = "PQRST6789K" });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var update = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MESE_UPDATE_PAN");
        Assert.Equal("ABCDE1234F", FakeSql.Arg(update.Args, "PanNo"));
        Assert.Equal("PQRST6789K", FakeSql.Arg(update.Args, "UpdatedPanNo"));
    }

    // ----- gateway callbacks -----

    private void PendingOrder(string orderId = "100001", decimal amount = 2360.00m, string? status = null) =>
        _host.Sql.Queries["SELECT ZedId, Certification, Amount, PaymentStatus FROM PaymentGatewayTransactions"] = args =>
            FakeSql.Arg(args, "TransactionId") == orderId
                ? [new { ZedId = Me, Certification = "Bronze", Amount = amount, PaymentStatus = status }]
                : [];

    private static FormUrlEncodedContent Encrypted(string plain, string key = TestHost.WorkingKey) =>
        new(new Dictionary<string, string> { ["encResp"] = CcAvenueCrypto.Encrypt(plain, key) });

    private HttpClient Gateway() => _host.CreateClient(new() { AllowAutoRedirect = false });

    [Fact]
    public async Task Successful_callback_records_payment_and_sends_the_browser_to_the_result_page()
    {
        PendingOrder();
        var r = await Gateway().PostAsync("/api/payments/ccavenue/response",
            Encrypted($"order_id=100001&tracking_id=999&order_status=Success&amount=2360.00&merchant_param1={Me}&merchant_param2=Bronze"));

        Assert.Equal(HttpStatusCode.SeeOther, r.StatusCode);
        Assert.Equal("/msme/payment/result?status=success&certification=Bronze", r.Headers.Location!.OriginalString);
        var call = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_PAYMENT_GATEWAY_DETAILS");
        Assert.Equal("Success", FakeSql.Arg(call.Args, "PaymentStatus"));
        Assert.Equal(Me, FakeSql.Arg(call.Args, "ZedId"));
        Assert.Contains(_host.Email.Sent, m => m.Subject.Contains("Payment Confirmation"));
    }

    [Fact]
    public async Task Callback_with_a_different_amount_is_recorded_as_failed()
    {
        PendingOrder(amount: 2360.00m);
        var r = await Gateway().PostAsync("/api/payments/ccavenue/response",
            Encrypted($"order_id=100001&order_status=Success&amount=1.00&merchant_param1={Me}&merchant_param2=Bronze"));

        Assert.StartsWith("/msme/payment/result?status=failure", r.Headers.Location!.OriginalString);
        var call = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_PAYMENT_GATEWAY_DETAILS");
        Assert.Equal("AmountMismatch", FakeSql.Arg(call.Args, "PaymentStatus"));
        Assert.Empty(_host.Email.Sent);
    }

    [Theory]
    [InlineData("order_id=555&order_status=Success&amount=2360.00&merchant_param1=ZEDMSME000001&merchant_param2=Bronze")] // unknown order
    [InlineData("order_id=100001&order_status=Success&amount=2360.00&merchant_param1=ZEDMSME999999&merchant_param2=Bronze")] // other unit
    [InlineData("order_id=100001&order_status=Success&amount=2360.00&merchant_param1=ZEDMSME000001&merchant_param2=Gold")]   // other level
    public async Task Callback_that_does_not_match_an_order_changes_nothing(string plain)
    {
        PendingOrder();
        var r = await Gateway().PostAsync("/api/payments/ccavenue/response", Encrypted(plain));
        Assert.StartsWith("/msme/payment/result?status=failure", r.Headers.Location!.OriginalString);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MSME_PAYMENT_GATEWAY_DETAILS");
    }

    [Fact]
    public async Task Forged_or_wrongly_encrypted_callbacks_are_rejected()
    {
        PendingOrder();
        var forged = await Gateway().PostAsync("/api/payments/ccavenue/response", new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["order_id"] = "100001", ["order_status"] = "Success", ["merchant_param1"] = Me, ["encResp"] = "not-hex",
        }));
        var wrongKey = await Gateway().PostAsync("/api/payments/ccavenue/response",
            Encrypted($"order_id=100001&order_status=Success&amount=2360.00&merchant_param1={Me}&merchant_param2=Bronze", "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"));

        Assert.StartsWith("/msme/payment/result?status=failure", forged.Headers.Location!.OriginalString);
        Assert.StartsWith("/msme/payment/result?status=failure", wrongKey.Headers.Location!.OriginalString);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == "SP_MSME_PAYMENT_GATEWAY_DETAILS");
    }

    [Fact]
    public async Task Failed_payment_is_recorded_and_shows_the_gateway_message()
    {
        PendingOrder();
        var r = await Gateway().PostAsync("/api/payments/ccavenue/response",
            Encrypted($"order_id=100001&order_status=Failure&status_message=Card declined&amount=2360.00&merchant_param1={Me}&merchant_param2=Bronze"));
        Assert.Equal("/msme/payment/result?status=failure&certification=Bronze&message=Card%20declined", r.Headers.Location!.OriginalString);
        Assert.Equal("Failure", FakeSql.Arg(Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_PAYMENT_GATEWAY_DETAILS").Args, "PaymentStatus"));
    }

    [Fact]
    public async Task Reconciliation_uses_its_own_key_and_maps_shipped_to_success()
    {
        _host.Sql.Procs["SP_MSME_PAYMENT_GATEWAY_DETAILS_RECONCILIATION"] = _ => FakeSql.Sets([new { ModuleName = "ZED" }]);
        var plain = $"order_id=100001&order_status=Shipped&order_mer_param1={Me}&order_mer_param2=Bronze";

        var wrong = await Gateway().PostAsync("/Pay/UpdatePaymentReconciliationStatus", Encrypted(plain, TestHost.WorkingKey));
        Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);

        var ok = await Gateway().PostAsync("/Pay/UpdatePaymentReconciliationStatus", Encrypted(plain, TestHost.ReconciliationKey));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var call = Assert.Single(_host.Sql.Calls, c => c.Name == "SP_MSME_PAYMENT_GATEWAY_DETAILS_RECONCILIATION");
        Assert.Equal("Success", FakeSql.Arg(call.Args, "PaymentStatus"));
        Assert.Equal("RECONCILIATION", FakeSql.Arg(call.Args, "ApiType"));
    }
}
