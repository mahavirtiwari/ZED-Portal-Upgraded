using System.Data.Common;
using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Schemes;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Staff.Neft;

/// <summary>
/// NEFT reimbursement of financial assistance (StateCoordinator landing pages). Port of NeftController
/// (Views/Neft/NewTransactions, ApprovedTransactions, RejectedTransactions) over
/// SP_NEFT_TRANSACTIONS_BY_STATUS and SP_NEFT_UPDATE_TRANSACTION_STATUS.
/// <para>
/// "Transactions" are FinancialAssistance rows whose verification the agency approved
/// (VerificationStatus 4). Approving one records the NEFT payment details and moves it to 6
/// (reimbursed), then mails the MSME.
/// </para>
/// <para>Differences from the MVC actions (see the security notes in the report):</para>
/// <list type="bullet">
/// <item>The procedure lists every state's applications; here a coordinator sees and approves only units
/// whose state (Msme.StateId or PStateId) is the StateCode of their sign-in. User ids listed under
/// <c>Neft:AllStatesUserIds</c> see all states (the legacy national NEFT desk).</item>
/// <item>The browser no longer chooses the status: the only action is "approve", allowed once, for an
/// application still at VerificationStatus 4 and not already approved or rejected. The ZED ID,
/// certification and row are taken from the procedure's list, not from the request.</item>
/// <item><c>SendMail</c> was a public action (any coordinator could trigger mails for any ZED ID); it is
/// no longer reachable. The legacy reject path also sent the "reimbursed" mail; reject was hidden in
/// the legacy page and is not offered.</item>
/// <item>Who approved is recorded in MsmeHistory and the log.</item>
/// </list>
/// </summary>
[Route("api/staff/neft")]
[StaffRoles(UserRole.StateCoordinator)]
public sealed partial class NeftController(
    ISqlExecutor db,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal,
    IOptions<EmailOptions> emailOptions,
    IConfiguration config,
    ILogger<NeftController> log) : StaffApiController
{
    public const int ApprovedByAgency = 4;
    public const int Reimbursed = 6;
    public const int TransactionApproved = 1;
    public const int TransactionRejected = 2;

    /// <summary>Columns shown on the three pages (the procedure returns Msme.* and FinancialAssistance.*).</summary>
    public static readonly string[] Columns =
    [
        "TransactionId", "ZedId", "PUnitName", "EnterpriseName", "StateName", "PStateName", "CertificationType",
        "CategoryOfCertificate", "NameOfCertficate", "CertificationAgency", "CertficateNumber", "DateOfIssue", "ValidityOfCertificate",
        "ExpenditureCertficate", "AgencyOrSupplier", "InvoiceNo", "InvoiceBillDate", "AmountPaid", "EligibleAmount", "ModeOfPayment",
        "AccountNo", "IfscCode", "BranchAddress", "BankName", "VerificationStatus", "TransactionStatus",
        "ApproverDateOfReceiptOfPayment", "ApproverReferenceNo", "ApproverAmount", "Comments",
    ];

    public enum NeftList { New, Approved, Rejected }

    public sealed record TransactionsResponse(IReadOnlyList<Dictionary<string, object?>> Transactions);

    /// <summary>GET api/staff/neft/transactions?list=new|approved|rejected</summary>
    [HttpGet("transactions")]
    public async Task<ActionResult<TransactionsResponse>> Transactions([FromQuery] string? list, CancellationToken ct)
    {
        if (!Enum.TryParse<NeftList>(list ?? "new", ignoreCase: true, out var which) || !Enum.IsDefined(which))
            return this.Problem400("Invalid list.");

        var rows = await LoadAsync(which == NeftList.Approved ? "1" : "0", ct);
        var selected = rows.Where(r => which switch
        {
            NeftList.Approved => SchemeRows.Int(r, "VerificationStatus") == Reimbursed,
            NeftList.Rejected => SchemeRows.Int(r, "VerificationStatus") == ApprovedByAgency && SchemeRows.Int(r, "TransactionStatus") == TransactionRejected,
            _ => SchemeRows.Int(r, "VerificationStatus") == ApprovedByAgency && SchemeRows.Int(r, "TransactionStatus") is not (TransactionApproved or TransactionRejected),
        });
        return new TransactionsResponse(selected.Select(r => SchemeRows.Pick(r, Columns)).ToList());
    }

    public sealed record ApproveRequest(string? ZedId, string? DateOfReceiptOfPayment, string? ReferenceNo, string? Amount);

    /// <summary>POST api/staff/neft/transactions/{id}/approve — records the NEFT payment of one reimbursement.</summary>
    [HttpPost("transactions/{id:int}/approve")]
    public async Task<ActionResult<MessageResponse>> Approve(int id, ApproveRequest req, CancellationToken ct)
    {
        if (!DateOnly.TryParseExact(req.DateOfReceiptOfPayment?.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var paidOn) ||
            paidOn > DateOnly.FromDateTime(DateTime.Now) || paidOn.Year < 2020)
            return this.Problem400("Please enter a valid date of receipt of payment (not in the future).");
        var reference = req.ReferenceNo?.Trim() ?? "";
        if (!ReferencePattern().IsMatch(reference))
            return this.Problem400("Please enter a valid reference number (letters, digits, - / . _ up to 100 characters).");
        if (!decimal.TryParse(req.Amount?.Trim(), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var amount) ||
            amount <= 0 || amount > 100_000_000m || decimal.Round(amount, 2) != amount)
            return this.Problem400("Please enter a valid amount (up to 2 decimals).");

        using (await SchemeLocks.EnterAsync(ct))
        {
            // Re-read the list inside the lock: the row, its unit and its current status come from the database.
            var row = (await LoadAsync("0", ct)).FirstOrDefault(r => SchemeRows.Int(r, "TransactionId") == id);
            if (row is null || !SchemeRows.Same(row.Text("ZedId"), req.ZedId))
            {
                log.LogWarning("NEFT approve refused for {UserId}: transaction {Id} not found in scope", UserId, id);
                return NotFound();
            }
            if (SchemeRows.Int(row, "VerificationStatus") != ApprovedByAgency ||
                SchemeRows.Int(row, "TransactionStatus") is TransactionApproved or TransactionRejected)
                return this.Problem400("This transaction has already been processed.");

            var paid = SchemeRows.Decimal(row, "AmountPaid");
            if (paid is > 0 && amount > paid)
                return this.Problem400($"The amount cannot be more than the amount paid by the unit (Rs. {paid.Value.ToString("0.##", CultureInfo.InvariantCulture)}).");

            var zedId = row.Text("ZedId");
            var certification = row.Text("CertificationType");
            try
            {
                await db.ExecuteProcAsync("SP_NEFT_UPDATE_TRANSACTION_STATUS", new
                {
                    ZedId = zedId,
                    TransactionId = id.ToString(CultureInfo.InvariantCulture),
                    Status = TransactionApproved.ToString(CultureInfo.InvariantCulture),
                    DateOfReceiptOfPayment = paidOn.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    ApproverReferenceNo = reference,
                    ApproverAmount = amount.ToString("0.00", CultureInfo.InvariantCulture),
                    Comments = (string?)null,
                }, ct);
            }
            catch (DbException ex)
            {
                log.LogError(ex, "SP_NEFT_UPDATE_TRANSACTION_STATUS failed for {ZedId} transaction {Id}", zedId, id);
                return this.Problem400("The transaction could not be updated. Please try again.");
            }

            await SchemeRows.AuditAsync(db, log, zedId, certification,
                $"Financial assistance reimbursement approved (NEFT) by {UserId}: ref {reference}, Rs. {amount.ToString("0.00", CultureInfo.InvariantCulture)}, paid on {paidOn:yyyy-MM-dd}", ct);

            var mailer = new SchemeMailer(db, email, templates, portal, emailOptions, log);
            var details = await mailer.DetailsAsync(zedId, certification, ct);
            await mailer.SendAsync<StaffNeftReimbursementEmail>(details?.Text("EmailId"),
                $"Reimbursement towards the Certification Cost for Financial Assistance on {details?.Text("CategoryOfCertificate")} - {zedId}",
                new()
                {
                    [nameof(StaffNeftReimbursementEmail.ZedId)] = zedId,
                    [nameof(StaffNeftReimbursementEmail.UnitName)] = details?.Text("EnterpriseName") ?? "",
                    [nameof(StaffNeftReimbursementEmail.CategoryOfCertificate)] = details?.Text("CategoryOfCertificate") ?? "",
                    [nameof(StaffNeftReimbursementEmail.Certification)] = certification,
                    [nameof(StaffNeftReimbursementEmail.Amount)] = amount.ToString("0.00", CultureInfo.InvariantCulture),
                    [nameof(StaffNeftReimbursementEmail.PaymentDate)] = paidOn.ToString("dd-MMM-yyyy", CultureInfo.InvariantCulture),
                    [nameof(StaffNeftReimbursementEmail.ReferenceNo)] = reference,
                }, ct);
        }
        return new MessageResponse("Transaction Approved.");
    }

    /// <summary>The procedure's rows limited to the coordinator's state.</summary>
    private async Task<IEnumerable<IDictionary<string, object?>>> LoadAsync(string status, CancellationToken ct)
    {
        var rows = (await db.QueryProcMultipleAsync("SP_NEFT_TRANSACTIONS_BY_STATUS", new { Status = status }, ct))[0];
        if (SeesAllStates()) return rows;
        var state = NormaliseState(CurrentUser.StateCode);
        if (state is null)
        {
            log.LogWarning("State coordinator {UserId} has no StateCode; NEFT list is empty", UserId);
            return [];
        }
        return rows.Where(r => NormaliseState(r.Text("StateId")) == state || NormaliseState(r.Text("PStateId")) == state);
    }

    private bool SeesAllStates() =>
        (config.GetSection("Neft:AllStatesUserIds").Get<string[]>() ?? [])
        .Any(u => string.Equals(u?.Trim(), UserId, StringComparison.OrdinalIgnoreCase));

    /// <summary>State codes are LGD numbers ("9", "09"); compare them as numbers.</summary>
    public static string? NormaliseState(string? code) =>
        int.TryParse(code?.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var n) && n > 0 ? n.ToString(CultureInfo.InvariantCulture) : null;

    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9 ./_\-]{0,99}$")]
    private static partial Regex ReferencePattern();
}
