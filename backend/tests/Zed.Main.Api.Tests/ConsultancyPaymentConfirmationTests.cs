using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Zed.Portal.Features.Payments.Consultancy;

namespace Zed.Main.Api.Tests;

/// <summary>
/// 2026-11-17 (the user's payment confirmation design): the handholding milestone payment's confirmation, receipt and tax invoice
/// downloads and "E-mail a copy" (ConsultancyConfirmationController), as PaymentConfirmationTests for certification and surveillance.
/// </summary>
public sealed class ConsultancyPaymentConfirmationTests : IDisposable
{
    private const string Me = "ZEDMSME000001";
    private const string Other = "ZEDMSME000002";
    private const string Site = "https://loginzed.example.test";
    private const string Api = "/api/msme/consultancy-payments";
    private readonly TestHost _host = new();

    public ConsultancyPaymentConfirmationTests()
    {
        _host.Sql.Procs["SP_GET_USER_DETAILS"] = _ =>
            FakeSql.Sets([new { UserId = Me, UserName = "Acme", RoleId = 5, Email = "a@acme.test" }], [new { ERRORMSG = "SUCCESS" }]);
        SetPayment(invoiceNo: "HH/2526/12");
        _host.Sql.Procs["SP_MSME_GET_MY_DOCUMENTS"] = _ => FakeSql.Sets(
            [], [new { ZedId = Me }], [new { ZedId = Me }],
            [
                // Newest first: the ERP receipt, this payment's invoice under another module, milestone 1's invoice, then this one.
                new { TadaInvoiceNo = "HH/2526/12", InvoicePath = $"{Site}/ReceiptInvoice/HH/2526/12_{Me}_Receipt.pdf", DocumentType = "Receipt", ModuleName = "HANDHOLDING", Certification = "Silver", MileStoneNo = "2" },
                new { TadaInvoiceNo = "HH/2526/12", InvoicePath = $"{Site}/ReceiptInvoice/ZED/2526/12_{Me}_Invoice.pdf", DocumentType = "Invoice", ModuleName = "ZED", Certification = "Silver", MileStoneNo = "" },
                new { TadaInvoiceNo = "HH/2526/12", InvoicePath = $"{Site}/ReceiptInvoice/HH/2526/12_{Me}_M1_Invoice.pdf", DocumentType = "Invoice", ModuleName = "HANDHOLDING", Certification = "Silver", MileStoneNo = "1" },
                new { TadaInvoiceNo = "HH/2526/12", InvoicePath = $"{Site}/ReceiptInvoice\\HH\\2526\\12_{Me}_Invoice.pdf", DocumentType = "Invoice", ModuleName = "HANDHOLDING", Certification = "Silver", MileStoneNo = "2" },
            ]);
        _host.Sql.Queries[ConsultancyConfirmationController.OrderSql] = args =>
            FakeSql.Arg(args, "Certification") == "Silver" && FakeSql.Arg(args, "Milestone") == "2"
                ? [new { TransactionId = "200002", TrackingId = "114000000077", Amount = 23600.00m, UpdatedDate = new DateTime(2026, 11, 17, 9, 5, 0), PgType = (string?)null,
                    PaymentResponse = "order_id=200002&tracking_id=114000000077&order_status=Success&payment_mode=Net Banking&amount=23600.00" }]
                : [];
    }

    public void Dispose() => _host.Dispose();

    private void SetPayment(string? invoiceNo, string? email = "pledge@acme.test", bool paid = true, string paymentType = "PaymentGateway") =>
        _host.Sql.Procs["SP_CONSULTANCY_MSME_GET_DETAILS"] = _ => FakeSql.Sets(
            [new { ZedId = Me, PledgeEmailId = email, EnterpriseName = "Acme", Address = "Plot 4", MileStoneNo = 2 }],
            [new { UdyogAadharNo = "UDYAM-UP-29-0003915" }],
            [], [],
            paid
                ? [new { Certification = "Silver", Total = "200000.00", Subsidy = "160000", SubsidyLabel = "(80%)", StateSubsidy = "0", ApplicantContributionAfterSubsidy = "23600.00",
                    SubsidyAmount = "20000.00", GstAfterSubsidy = "3600.00", TdsDeductible = "No", MileStoneNum = 2, PaymentType = paymentType, AmountPaid = "23600.00", TadaInvoiceNo = invoiceNo }]
                : [],
            [new { AutoEmailForAgency = "agency@consultant.test" }]);

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
    public async Task Handholding_confirmation_endpoints_require_a_signed_in_msme()
    {
        var client = await _host.CreateBrowserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync($"{Api}/Silver/confirmation")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync($"{Api}/Silver/invoice")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync($"{Api}/Silver/receipt")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync($"{Api}/Silver/email-copy", null)).StatusCode);
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Handholding_confirmation_shows_the_milestone_order_receipt_invoice_and_masked_email()
    {
        WriteFile($"PDFs/SA/{Me}/Silver_Milestone2_Payment_Receipt.pdf");
        WriteFile($"ReceiptInvoice/HH/2526/12_{Me}_Invoice.pdf");
        WriteFile($"ReceiptInvoice/HH/2526/12_{Me}_M1_Invoice.pdf");
        WriteFile($"ReceiptInvoice/ZED/2526/12_{Me}_Invoice.pdf");
        var client = await SignedInAsync();

        var json = await client.GetFromJsonAsync<JsonElement>($"{Api}/silver/confirmation?milestone=2");

        Assert.Equal("Silver", json.GetProperty("certification").GetString());
        Assert.Equal(2, json.GetProperty("milestone").GetInt32());
        Assert.Equal(23600.00m, json.GetProperty("amount").GetDecimal());
        Assert.Equal("200002", json.GetProperty("orderId").GetString());
        Assert.Equal("114000000077", json.GetProperty("transactionId").GetString());
        Assert.Equal("Net Banking", json.GetProperty("method").GetString());
        Assert.StartsWith("2026-11-17T09:05:00", json.GetProperty("paidOn").GetString());
        Assert.StartsWith($"{Api}/Silver/receipt", json.GetProperty("receiptUrl").GetString());
        // This payment's invoice: its TadaInvoiceNo, module HANDHOLDING, level and milestone (not the receipt, another module or milestone 1).
        Assert.Equal($"/api/msme/files/ReceiptInvoice/HH/2526/12_{Me}_Invoice.pdf", json.GetProperty("invoiceUrl").GetString());
        Assert.Equal("HH/2526/12", json.GetProperty("invoiceNo").GetString());
        Assert.Equal("pl•••@acme.test", json.GetProperty("email").GetString());

        var receipt = await client.GetAsync(json.GetProperty("receiptUrl").GetString());
        Assert.Equal(HttpStatusCode.OK, receipt.StatusCode);
        Assert.Equal("application/pdf", receipt.Content.Headers.ContentType?.MediaType);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(json.GetProperty("invoiceUrl").GetString())).StatusCode);

        var order = _host.Sql.Calls.First(c => c.Name == ConsultancyConfirmationController.OrderSql);
        Assert.Contains("FROM ZED_CONSULTANT.dbo.PaymentGatewayTransactions", order.Name);
        Assert.Equal(Me, FakeSql.Arg(order.Args, "ZedId"));
        Assert.All(_host.Sql.Calls.Where(c => c.Name == "SP_CONSULTANCY_MSME_GET_DETAILS"), c => Assert.Equal(Me, FakeSql.Arg(c.Args, "ZedId")));
    }

    [Fact]
    public async Task Handholding_invoice_is_not_offered_until_the_erp_has_sent_it()
    {
        var client = await SignedInAsync();

        // Listed, but not stored yet.
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"{Api}/Silver/invoice")).StatusCode);
        var json = await client.GetFromJsonAsync<JsonElement>($"{Api}/Silver/confirmation");
        Assert.Equal(JsonValueKind.Null, json.GetProperty("invoiceUrl").ValueKind);
        Assert.Equal(JsonValueKind.Null, json.GetProperty("receiptUrl").ValueKind);

        // No invoice number on the payment yet.
        WriteFile($"ReceiptInvoice/HH/2526/12_{Me}_Invoice.pdf");
        SetPayment(invoiceNo: null);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"{Api}/Silver/invoice")).StatusCode);

        SetPayment(invoiceNo: "HH/2526/12");
        var invoice = await client.GetFromJsonAsync<JsonElement>($"{Api}/Silver/invoice");
        Assert.Equal($"/api/msme/files/ReceiptInvoice/HH/2526/12_{Me}_Invoice.pdf", invoice.GetProperty("url").GetString());
    }

    [Fact]
    public async Task Handholding_invoice_naming_another_unit_is_never_offered()
    {
        _host.Sql.Procs["SP_MSME_GET_MY_DOCUMENTS"] = _ => FakeSql.Sets([], [], [],
            [new { TadaInvoiceNo = "HH/2526/12", InvoicePath = $"{Site}/ReceiptInvoice/HH/2526/12_{Other}_Invoice.pdf", DocumentType = "Invoice", ModuleName = "HANDHOLDING", Certification = "Silver", MileStoneNo = "2" }]);
        WriteFile($"ReceiptInvoice/HH/2526/12_{Other}_Invoice.pdf");
        var client = await SignedInAsync();

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"{Api}/Silver/invoice")).StatusCode);
    }

    [Fact]
    public async Task Handholding_without_a_payment_or_for_another_milestone_there_is_no_confirmation_and_no_mail()
    {
        var client = await SignedInAsync();
        // The latest payment is milestone 2's.
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"{Api}/Silver/confirmation?milestone=3")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync($"{Api}/Silver/email-copy?milestone=1", null)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync($"{Api}/Nope/confirmation")).StatusCode);

        SetPayment(invoiceNo: null, paid: false);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"{Api}/Silver/confirmation")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"{Api}/Silver/receipt")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync($"{Api}/Silver/email-copy", null)).StatusCode);
        Assert.Empty(_host.Email.Sent);
    }

    [Fact]
    public async Task Handholding_zero_amount_and_paid_at_milestone_1_say_so()
    {
        var client = await SignedInAsync();
        SetPayment(invoiceNo: null, paymentType: "ZeroAmount");
        Assert.Equal("Zero amount", (await client.GetFromJsonAsync<JsonElement>($"{Api}/Silver/confirmation")).GetProperty("method").GetString());
        SetPayment(invoiceNo: null, paymentType: "PaidAtMilestone1");
        Assert.Equal("Paid at milestone 1", (await client.GetFromJsonAsync<JsonElement>($"{Api}/Silver/confirmation")).GetProperty("method").GetString());
    }

    [Fact]
    public async Task Handholding_email_copy_goes_to_the_registered_email_only_with_the_receipt_and_the_invoice()
    {
        WriteFile($"PDFs/SA/{Me}/Silver_Milestone2_Payment_Receipt.pdf");
        WriteFile($"ReceiptInvoice/HH/2526/12_{Me}_Invoice.pdf");
        var client = await SignedInAsync();

        var r = await client.PostAsJsonAsync($"{Api}/Silver/email-copy", new { email = "someone@else.test", zedId = Other });

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("pl•••@acme.test", (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("sentTo").GetString());
        // Only the unit's copy: no agency mail, no office copy, nothing posted again.
        var mail = Assert.Single(_host.Email.Sent);
        Assert.Equal("pledge@acme.test", mail.To);
        Assert.Equal($"ZED Handholding Support (Milestone 2) Payment Confirmation Details - {Me}", mail.Subject);
        Assert.True(mail.Cc is null || mail.Cc.Count == 0);
        Assert.Equal(["Silver_Milestone2_Payment_Receipt.pdf", $"12_{Me}_Invoice.pdf"], mail.Attachments!.Select(a => a.FileName));
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == ConsultancyParameters.RemoveSql);
    }

    [Fact]
    public async Task Handholding_email_copy_draws_the_receipt_when_it_is_not_stored_and_refuses_without_an_email()
    {
        var client = await SignedInAsync();
        (await client.PostAsync($"{Api}/Silver/email-copy", null)).EnsureSuccessStatusCode();
        var receipt = Assert.Single(Assert.Single(_host.Email.Sent).Attachments!);
        Assert.Equal("Silver_Milestone2_Payment_Receipt.pdf", receipt.FileName);
        Assert.StartsWith("%PDF", System.Text.Encoding.ASCII.GetString(receipt.Content, 0, 4));

        SetPayment(invoiceNo: null, email: null);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync($"{Api}/Silver/email-copy", null)).StatusCode);
        Assert.Single(_host.Email.Sent);
    }

    [Fact]
    public async Task Handholding_email_copy_reports_a_mail_server_failure()
    {
        _host.Email.Fail = new InvalidOperationException("SMTP down");
        var client = await SignedInAsync();
        var r = await client.PostAsync($"{Api}/Silver/email-copy", null);
        Assert.Equal(HttpStatusCode.BadGateway, r.StatusCode);
        Assert.Equal("The e-mail could not be sent. Please try again later.", await r.ProblemTitle());
    }
}
