using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Finance;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Dashboard;

/// <summary>
/// Payment lists of the staff dashboard. Port of DashboardController.FailedTransactions / GetFailedTransactions
/// (SP_DASHBOARD_PAYMENT_FAILED_TRANSACTIONS) with its "Update payment status" pop-up
/// (SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS_WITH_INFO, then the ERP postings), and of
/// PaymentReceived / GetPaymentTransactions (SP_DASHBOARD_PAYMENT_TRANSACTIONS).
/// The pages page and search in the browser, as before; only the shown columns are sent.
/// </summary>
[Route("api/staff/dashboard")]
public sealed partial class PaymentsDashboardController(ISqlExecutor db, IBackgroundWork background, ILogger<PaymentsDashboardController> log)
    : StaffApiController
{
    /// <summary>Columns of Views/Dashboard/FailedTransactions.cshtml, including its pop-up (GSTIN, PAN, TAN of the payer).</summary>
    public static readonly string[] FailedColumns =
    [
        "RowNumber", "ZedId", "Certification", "TransactionDate", "PUnitName", "TransactionId", "EnterpriseTypee", "Gender",
        "SocialCategoryName", "IsCouponUsed", "UseCoupon", "AllowManualUpdate", "PStateName", "PDistrictName", "FinalAmountPaid",
        "Tds", "SubsidyPercentage", "GstinNumber", "TanNumber", "Gstin", "PanNo", "TanNo",
    ];

    /// <summary>Columns of Views/Dashboard/PaymentReceived.cshtml.</summary>
    public static readonly string[] ReceivedColumns =
    [
        "RowNumber", "ZedId", "Certification", "PUnitName", "EnterpriseTypee", "Gender", "SocialCategoryName", "IsCouponUsed",
        "PStateName", "PDistrictName", "Tds", "SubsidyPercentage", "GstinNumber", "TanNumber", "FinalAmountPaid",
    ];

    /// <summary>PG Type drop-down of the pop-up (value stored in PaymentGatewayTransactions.PgType).</summary>
    public static readonly string[] PgTypes = ["Unified Payments", "Debit Card", "Credit Card", "Net Banking"];

    [HttpGet("failed-transactions")]
    [StaffRoles(UserRole.SuperAdmin)]
    public async Task<ActionResult<List<Dictionary<string, object?>>>> FailedTransactions(
        string? state, string? certification, string? size, string? gender, CancellationToken ct)
    {
        if (Filters(state, certification, size, gender) is not { } f) return this.Problem400("Invalid filter.");
        return DashboardFilters.Pick(await LoadFailed(f, ct), FailedColumns);
    }

    [HttpGet("payments-received")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<List<Dictionary<string, object?>>>> PaymentsReceived(
        string? state, string? certification, string? size, string? gender, CancellationToken ct)
    {
        if (Filters(state, certification, size, gender) is not { } f) return this.Problem400("Invalid filter.");
        // The legacy action passed PageNo/PageSize, which this procedure does not declare; only its own parameters are sent.
        var sets = await db.QueryProcMultipleAsync("SP_DASHBOARD_PAYMENT_TRANSACTIONS", new
        {
            Status = "0", State = f.State, UserId, RoleId = RoleId.ToString(), CertificationType = f.Certification,
            Gender = f.Gender, MsmeSize = f.Size,
        }, ct);
        return DashboardFilters.Pick(sets[0], ReceivedColumns);
    }

    public sealed record UpdatePaymentRequest(
        string? ZedId, string? TransactionId, string? Certification, string? PgType, string? TrackingId,
        string? BankRefNumber, string? BankCode, string? PaymentReceivedDate, string? GstNumber, string? PaymentRemarks);

    /// <summary>
    /// "UPDATE PAYMENT STATUS": records a gateway payment that the bank confirmed but the portal never received.
    /// The page posted to Dashboard/UpdatePaymentDetailsWithInfo, which is missing from the legacy source
    /// (only UpdatePaymentDetails exists, without any authentication filter); this is rebuilt from the
    /// procedure the page's fields belong to. The transaction must be one the failed list offers for update.
    /// </summary>
    [HttpPost("failed-transactions/update-payment")]
    [StaffRoles(UserRole.SuperAdmin)]
    public async Task<ActionResult<MessageResponse>> UpdatePayment(UpdatePaymentRequest req, CancellationToken ct)
    {
        if (ValidateUpdate(req) is { } error) return this.Problem400(error);
        var zedId = req.ZedId!.Trim();
        var transactionId = req.TransactionId!.Trim();
        var cert = DashboardFilters.Certifications.First(c => c.Equals(req.Certification, StringComparison.OrdinalIgnoreCase));

        var failed = await LoadFailed(new ListFilters(null, cert, null, null), ct);
        var row = failed.FirstOrDefault(r =>
            string.Equals(r.Text("ZedId"), zedId, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(r.Text("TransactionId"), transactionId, StringComparison.Ordinal));
        if (row is null) return this.Problem400("This transaction is not in the list of failed transactions.");
        if (row.Text("AllowManualUpdate") != "1" || (IsTrue(row.Text("IsCouponUsed")) && row.Text("UseCoupon") == "Yes"))
            return this.Problem400("The payment status of this transaction cannot be updated.");

        var date = DateOnly.ParseExact(req.PaymentReceivedDate!, "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var gst = string.IsNullOrWhiteSpace(req.GstNumber) || !string.IsNullOrEmpty(row.Text("Gstin")) ? null : req.GstNumber.Trim().ToUpperInvariant();

        await db.ExecuteProcAsync("SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS_WITH_INFO", new
        {
            ZedId = row.Text("ZedId"), TransactionId = transactionId, PgType = req.PgType, BankRefNumber = req.BankRefNumber!.Trim(),
            BankCode = string.IsNullOrWhiteSpace(req.BankCode) ? null : req.BankCode.Trim(),
            // The procedure adds 5h30 ("incoming UTC date to IST"), as the AngularJS page sent the date picker's
            // local midnight in UTC. Send the same instant so the stored date is the day that was picked.
            PaymentReceivedDate = date.ToDateTime(TimeOnly.MinValue).AddMinutes(-330),
            Userid = UserId, RoleId = RoleId.ToString(), Certification = cert, PaymentRemarks = req.PaymentRemarks!.Trim(),
            TrackingId = req.TrackingId, GstNumber = gst,
        }, ct);
        log.LogWarning("{UserId} manually marked payment {TransactionId} of {ZedId}/{Certification} as successful",
            UserId, transactionId, zedId, cert);

        // As PayController.SubmiCustomerDataToApi / SubmiInvoiceDataToApi / SubmiReceiptDataToApi after the update.
        var erpZedId = row.Text("ZedId");
        background.Enqueue($"ERP {erpZedId}/{cert} (manual payment update)", async (sp, token) =>
        {
            var erp = sp.GetRequiredService<IErpFinanceService>();
            foreach (var document in new[] { ErpDocument.Customer, ErpDocument.Invoice, ErpDocument.Receipt })
                await erp.PushAsync(new ErpPush(erpZedId, cert, document), token);
        });
        return new MessageResponse("Payment status updated.");
    }

    private static string? ValidateUpdate(UpdatePaymentRequest r)
    {
        if (!DashboardFilters.IsZedId(r.ZedId?.Trim())) return "Invalid ZED ID.";
        if (string.IsNullOrWhiteSpace(r.TransactionId) || r.TransactionId.Trim().Length > 50) return "Invalid transaction.";
        if (!DashboardFilters.Certifications.Contains(r.Certification ?? "", StringComparer.OrdinalIgnoreCase)) return "Invalid certification.";
        if (!PgTypes.Contains(r.PgType)) return "PG Type is required.";
        if (r.TrackingId is null || !TrackingIdPattern().IsMatch(r.TrackingId)) return "CC Avenue Ref No. must be exactly 12 numeric digits.";
        if (string.IsNullOrWhiteSpace(r.BankRefNumber) || r.BankRefNumber.Trim().Length > 50) return "Bank Ref Number is required.";
        if (r.BankCode?.Trim().Length > 50) return "Bank Code must be at most 50 characters.";
        if (!DateOnly.TryParseExact(r.PaymentReceivedDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
            return "Payment Received Date is required.";
        if (date > DateOnly.FromDateTime(DateTime.UtcNow.AddMinutes(330)) || date.Year < 2020) return "Invalid Payment Received Date.";
        if (!string.IsNullOrWhiteSpace(r.GstNumber) && !GstinPattern().IsMatch(r.GstNumber.Trim()))
            return "Invalid GSTIN format (e.g., 22AAAAA0000A1Z5).";
        if (string.IsNullOrWhiteSpace(r.PaymentRemarks)) return "Remarks are required.";
        if (r.PaymentRemarks.Trim().Length > 2000) return "Remarks must be at most 2000 characters.";
        return null;
    }

    private async Task<IReadOnlyList<IDictionary<string, object?>>> LoadFailed(ListFilters f, CancellationToken ct) =>
        (await db.QueryProcMultipleAsync("SP_DASHBOARD_PAYMENT_FAILED_TRANSACTIONS", new
        {
            State = f.State, UserId, RoleId = RoleId.ToString(), CertificationType = f.Certification, Gender = f.Gender, MsmeSize = f.Size,
        }, ct))[0];

    private sealed record ListFilters(string? State, string? Certification, string? Size, string? Gender);

    private static ListFilters? Filters(string? state, string? certification, string? size, string? gender)
    {
        var invalid = false;
        var f = new ListFilters(
            DashboardFilters.Pick(state, DashboardFilters.States.Keys, ref invalid),
            DashboardFilters.Pick(certification, DashboardFilters.Certifications, ref invalid),
            DashboardFilters.Pick(size, DashboardFilters.Sizes, ref invalid),
            DashboardFilters.Pick(gender, DashboardFilters.Genders, ref invalid));
        return invalid ? null : f;
    }

    private static bool IsTrue(string v) => v == "1" || v.Equals("true", StringComparison.OrdinalIgnoreCase);

    [GeneratedRegex(@"^\d{12}$")]
    private static partial Regex TrackingIdPattern();

    [GeneratedRegex("^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z]{1}[1-9A-Za-z]{1}[Zz][0-9A-Za-z]{1}$")]
    private static partial Regex GstinPattern();
}
