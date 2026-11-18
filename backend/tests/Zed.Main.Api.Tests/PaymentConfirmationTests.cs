using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Zed.Main.Api.Tests;

/// <summary>
/// 2026-11-17 (the user's payment confirmation design): the confirmation's details, the receipt and tax invoice downloads and
/// "E-mail a copy" (PaymentConfirmationController), for certification and surveillance payments.
/// </summary>
public sealed class PaymentConfirmationTests : IDisposable
{
    private const string Me = "ZEDMSME000001";
    private const string Other = "ZEDMSME000002";
    private const string Site = "https://loginzed.example.test";
    private readonly TestHost _host = new();

    public PaymentConfirmationTests()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = _ =>
            FakeSql.Sets([new { UserId = Me, UserName = "Acme", RoleId = 5, Email = "a@acme.test" }], [new { ERRORMSG = "SUCCESS" }]);
        SetPayment(invoiceNo: "ZED/2526/41");
        _host.Sql.Procs["SP_SURVEILLANCE_MSME_GET_DETAILS"] = _ => FakeSql.Sets(
            [new { ZedId = Me, PledgeEmailId = "pledge@acme.test", EnterpriseName = "Acme", MileStoneNo = 0 }],
            [new { PaymentReceiptName = "Silver_Milestone0_Payment_Receipt.pdf" }],
            [], [],
            [new { Certification = "Silver", Total = "2360.00", UseCoupon = "No", Subsidy = "1180", SubsidyLabel = "(50%)", ApplicantContributionAfterSubsidy = "1180.00",
                SubsidyPer = "1000.00", GstAfterSubsidy = "180.00", TdsDeductible = "No", TaDaInvoiceNo = "SUR/2526/7" }]);
        _host.Sql.Procs["SP_MSME_GET_MY_DOCUMENTS"] = _ => FakeSql.Sets(
            [], [new { ZedId = Me }], [new { ZedId = Me }],
            [
                // Newest first, as the procedure orders them: the ERP receipt, an older invoice, this payment's invoice.
                new { TadaInvoiceNo = "ZED/2526/41", InvoicePath = $"{Site}/ReceiptInvoice/ZED/2526/41_{Me}_Receipt.pdf", DocumentType = "Receipt", ModuleName = "ZED", Certification = "Bronze", MileStoneNo = "" },
                new { TadaInvoiceNo = "ZED/2425/9", InvoicePath = $"{Site}/ReceiptInvoice/ZED/2425/9_{Me}_Invoice.pdf", DocumentType = "Invoice", ModuleName = "ZED", Certification = "Bronze", MileStoneNo = "" },
                new { TadaInvoiceNo = "ZED/2526/41", InvoicePath = $"{Site}/ReceiptInvoice\\ZED\\2526\\41_{Me}_Invoice.pdf", DocumentType = "Invoice", ModuleName = "ZED", Certification = "Bronze", MileStoneNo = "" },
                new { TadaInvoiceNo = "SUR/2526/7", InvoicePath = $"{Site}/ReceiptInvoice/SUR/2526/7_{Me}_Invoice.pdf", DocumentType = "Invoice", ModuleName = "SURVEILLANCE", Certification = "Silver", MileStoneNo = "" },
            ]);
        _host.Sql.Queries["SELECT TOP (1) TransactionId, TrackingId"] = args => FakeSql.Arg(args, "Certification") == "Bronze"
            ? [new { TransactionId = "100001", TrackingId = "113000000042", Amount = 2360.00m, UpdatedDate = new DateTime(2026, 11, 17, 6, 25, 0), PgType = (string?)null,
                PaymentResponse = "order_id=100001&tracking_id=113000000042&order_status=Success&payment_mode=UPI&amount=2360.00" }]
            : [];
    }

    public void Dispose() => _host.Dispose();

    private void SetPayment(string? invoiceNo, string? email = "pledge@acme.test", bool paid = true) =>
        _host.Sql.Procs["SP_MSME_GET_DETAILS"] = _ => FakeSql.Sets(
            [new { ZedId = Me, PledgeEmailId = email, EnterpriseName = "Acme" }],
            [new { CertOrReCert = "Certification", PaymentReceiptName = "_Payment_Receipt.pdf" }],
            [], [],
            paid
                ? [new { Certification = "Bronze", Total = "11800.00", UseCoupon = "No", Subsidy = "9440", SubsidyLabel = "(80%)", StateSubsidy = "0", ApplicantContributionAfterSubsidy = "2360.00",
                    SubsidyAmount = "2000.00", GstAfterSubsidy = "360.00", TdsDeductible = "No", PaymentType = "PaymentGateway", AmountPaid = "2360.00", TadaInvoiceNo = invoiceNo }]
                : []);

    private void WriteFile(string relative, string content = "%PDF-1.4 test")
    {
        var path = Path.Combine(_host.StorageRoot, relative.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
    }

    private async Task<HttpClient> SignedInAsync()
    {
        var client = await _host.CreateBrowserAsync();
        (await client.PostAsJsonAsync("/api/msme/auth/login", new { userId = Me, password = "Right#Pass1" })).EnsureSuccessStatusCode();
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        return client;
    }

    [Fact]
    public async Task Confirmation_endpoints_require_a_signed_in_msme()
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/msme/payments/Bronze/confirmation")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/msme/payments/Bronze/invoice")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/msme/payments/Bronze/receipt")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/api/msme/payments/Bronze/email-copy", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/api/msme/surveillance-payments/Silver/email-copy", null)).StatusCode);
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Confirmation_shows_the_paid_order_the_receipt_the_invoice_and_the_full_email()
    {
        WriteFile($"PDFs/SA/{Me}/Bronze_Payment_Receipt.pdf");
        WriteFile($"ReceiptInvoice/ZED/2526/41_{Me}_Invoice.pdf");
        var client = await SignedInAsync();

        var json = await client.GetFromJsonAsync<JsonElement>("/api/msme/payments/bronze/confirmation");

        Assert.Equal("Bronze", json.GetProperty("certification").GetString());
        Assert.Equal(2360.00m, json.GetProperty("amount").GetDecimal());
        Assert.Equal("100001", json.GetProperty("orderId").GetString());
        Assert.Equal("113000000042", json.GetProperty("transactionId").GetString());
        Assert.Equal("UPI", json.GetProperty("method").GetString());
        Assert.StartsWith("2026-11-17T06:25:00", json.GetProperty("paidOn").GetString());
        Assert.Equal("/api/msme/payments/Bronze/receipt", json.GetProperty("receiptUrl").GetString());
        // This payment's invoice (its TadaInvoiceNo), not the ERP receipt nor the older invoice of the level.
        Assert.Equal($"/api/msme/files/ReceiptInvoice/ZED/2526/41_{Me}_Invoice.pdf", json.GetProperty("invoiceUrl").GetString());
        Assert.Equal("ZED/2526/41", json.GetProperty("invoiceNo").GetString());
        // 2026-11-18 (the user): the registered e-mail in full (never masked on signed-in pages).
        Assert.Equal("pledge@acme.test", json.GetProperty("email").GetString());

        // The links work: the receipt here, the invoice through My Documents' files.
        var receipt = await client.GetAsync("/api/msme/payments/Bronze/receipt");
        Assert.Equal(HttpStatusCode.OK, receipt.StatusCode);
        Assert.Equal("application/pdf", receipt.Content.Headers.ContentType?.MediaType);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(json.GetProperty("invoiceUrl").GetString())).StatusCode);

        var order = Assert.Single(_host.Sql.Calls, c => c.Name.StartsWith("SELECT TOP (1) TransactionId", StringComparison.Ordinal));
        Assert.Contains("FROM PaymentGatewayTransactions", order.Name);
        Assert.Equal(Me, FakeSql.Arg(order.Args, "ZedId"));
    }

    [Fact]
    public async Task Invoice_is_not_offered_until_the_erp_has_sent_it()
    {
        var client = await SignedInAsync();

        // Listed, but the file is not stored yet.
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/payments/Bronze/invoice")).StatusCode);
        var json = await client.GetFromJsonAsync<JsonElement>("/api/msme/payments/Bronze/confirmation");
        Assert.Equal(JsonValueKind.Null, json.GetProperty("invoiceUrl").ValueKind);
        Assert.Equal(JsonValueKind.Null, json.GetProperty("receiptUrl").ValueKind);

        // The payment has no invoice number yet (ERP posting off or pending): the older invoice of the level is not shown.
        WriteFile($"ReceiptInvoice/ZED/2425/9_{Me}_Invoice.pdf");
        SetPayment(invoiceNo: null);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/payments/Bronze/invoice")).StatusCode);

        // Once it is stored: its link.
        SetPayment(invoiceNo: "ZED/2526/41");
        WriteFile($"ReceiptInvoice/ZED/2526/41_{Me}_Invoice.pdf");
        var invoice = await client.GetFromJsonAsync<JsonElement>("/api/msme/payments/Bronze/invoice");
        Assert.Equal($"/api/msme/files/ReceiptInvoice/ZED/2526/41_{Me}_Invoice.pdf", invoice.GetProperty("url").GetString());
    }

    [Fact]
    public async Task Invoice_naming_another_unit_is_never_offered()
    {
        _host.Sql.Procs["SP_MSME_GET_MY_DOCUMENTS"] = _ => FakeSql.Sets([], [], [],
            [new { TadaInvoiceNo = "ZED/2526/41", InvoicePath = $"{Site}/ReceiptInvoice/ZED/2526/41_{Other}_Invoice.pdf", DocumentType = "Invoice", ModuleName = "ZED", Certification = "Bronze" }]);
        WriteFile($"ReceiptInvoice/ZED/2526/41_{Other}_Invoice.pdf");
        var client = await SignedInAsync();

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/payments/Bronze/invoice")).StatusCode);
    }

    [Fact]
    public async Task Without_a_payment_there_is_no_confirmation_and_no_mail()
    {
        SetPayment(invoiceNo: null, paid: false);
        var client = await SignedInAsync();

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/payments/Bronze/confirmation")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/msme/payments/Bronze/receipt")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync("/api/msme/payments/Bronze/email-copy", null)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/msme/payments/Nope/confirmation")).StatusCode);
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Email_copy_goes_to_the_registered_email_only_with_the_receipt_and_the_invoice()
    {
        WriteFile($"PDFs/SA/{Me}/Bronze_Payment_Receipt.pdf");
        WriteFile($"ReceiptInvoice/ZED/2526/41_{Me}_Invoice.pdf");
        var client = await SignedInAsync();

        // An address in the request is ignored: the copy goes to the unit's registered e-mail.
        var r = await client.PostAsJsonAsync("/api/msme/payments/Bronze/email-copy", new { email = "someone@else.test", zedId = Other });

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("pledge@acme.test", (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("sentTo").GetString());
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("pledge@acme.test", mail.To);
        Assert.Equal($"ZED Certification Payment Confirmation Details - {Me}", mail.Subject);
        Assert.True(mail.Cc is null || mail.Cc.Count == 0);
        Assert.Equal(["Bronze_Payment_Receipt.pdf", $"41_{Me}_Invoice.pdf"], mail.Attachments!.Select(a => a.FileName));
    }

    [Fact]
    public async Task Email_copy_draws_the_receipt_when_it_is_not_stored_and_refuses_without_an_email()
    {
        var client = await SignedInAsync();
        (await client.PostAsync("/api/msme/payments/Bronze/email-copy", null)).EnsureSuccessStatusCode();
        var mail = Assert.Single(_host.Email.Sent);
        var receipt = Assert.Single(mail.Attachments!);
        Assert.Equal("Bronze_Payment_Receipt.pdf", receipt.FileName);
        Assert.StartsWith("%PDF", System.Text.Encoding.ASCII.GetString(receipt.Content, 0, 4));

        SetPayment(invoiceNo: null, email: null);
        var r = await client.PostAsync("/api/msme/payments/Bronze/email-copy", null);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Single(_host.Email.Sent);
    }

    [Fact]
    public async Task Email_copy_reports_a_mail_server_failure()
    {
        _host.Email.Fail = new InvalidOperationException("SMTP down");
        var client = await SignedInAsync();
        var r = await client.PostAsync("/api/msme/payments/Bronze/email-copy", null);
        Assert.Equal(HttpStatusCode.BadGateway, r.StatusCode);
        Assert.Equal("The e-mail could not be sent. Please try again later.", await r.ProblemTitle());
    }

    [Fact]
    public async Task Surveillance_confirmation_invoice_and_email_copy_read_the_surveillance_payment()
    {
        WriteFile($"PDFs/SA/{Me}/Silver_Milestone0_Payment_Receipt.pdf");
        WriteFile($"ReceiptInvoice/SUR/2526/7_{Me}_Invoice.pdf");
        var client = await SignedInAsync();

        var json = await client.GetFromJsonAsync<JsonElement>("/api/msme/surveillance-payments/Silver/confirmation");
        Assert.Equal("/api/msme/surveillance-payments/Silver/receipt", json.GetProperty("receiptUrl").GetString());
        Assert.Equal($"/api/msme/files/ReceiptInvoice/SUR/2526/7_{Me}_Invoice.pdf", json.GetProperty("invoiceUrl").GetString());
        Assert.Contains(_host.Sql.Calls, c => c.Name.Contains("FROM ZED_SURVEILLANCE.dbo.PaymentGatewayTransactions", StringComparison.Ordinal));
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/msme/surveillance-payments/Silver/receipt")).StatusCode);

        (await client.PostAsync("/api/msme/surveillance-payments/Silver/email-copy", null)).EnsureSuccessStatusCode();
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("pledge@acme.test", mail.To);
        Assert.Equal($"ZED Surveillance Assessment fee Payment Confirmation Details - {Me}", mail.Subject);
        Assert.Equal(["Silver_Milestone0_Payment_Receipt.pdf", $"7_{Me}_Invoice.pdf"], mail.Attachments!.Select(a => a.FileName));
    }

    [Theory]
    [InlineData(" kavita@gmail.com ", "kavita@gmail.com")]
    [InlineData("ab@x.in", "ab@x.in")]
    [InlineData("", null)]
    [InlineData("  ", null)]
    public void Email_is_shown_in_full(string email, string? expected) =>
        Assert.Equal(expected, Zed.Portal.Features.Payments.PaymentConfirmationController.Email(email));

    [Theory]
    [InlineData("order_id=1&payment_mode=Net Banking&amount=1.00", "Net Banking")]
    [InlineData("order_id=1&payment_mode=null", null)]
    [InlineData(null, null)]
    public void Payment_mode_comes_from_the_gateway_response(string? response, string? expected) =>
        Assert.Equal(expected, Zed.Portal.Features.Payments.PaymentConfirmationController.PaymentMode(response));
}
