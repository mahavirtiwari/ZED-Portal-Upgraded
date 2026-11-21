using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Finance;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Portal.Features.Staff.Dashboard;

/// <summary>
/// Payment lists of the staff dashboard. Port of DashboardController.FailedTransactions / GetFailedTransactions
/// (SP_DASHBOARD_PAYMENT_FAILED_TRANSACTIONS) with its "Update payment status" pop-up
/// (SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS_WITH_INFO, then the ERP postings), and of
/// PaymentReceived / GetPaymentTransactions (SP_DASHBOARD_PAYMENT_TRANSACTIONS).
/// The pages page and search in the browser, as before; only the shown columns are sent.
/// <para>
/// Also served by Consultancy and Surveillance, where the MasterAdmin may also open the failed transactions (legacy
/// filter "|SuperAdmin|MasterAdmin|"), Consultancy adds the milestone column, and a manual update is NOT posted to the ERP:
/// the old Consultancy and Surveillance portals did not post either, and main's ERP module reads its invoice and receipt
/// data with procedures that exist only in ZEDCS_V2_LIVE (SP_API_FINANCE_CONSULTANCY_* / _SURVEILLANCE_*). The update is
/// logged so the finance team can post it from main.
/// </para>
/// </summary>
[Route("api/staff/dashboard")]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed partial class PaymentsDashboardController(ISqlExecutor db, PortalHost host, IBackgroundWork background, ILogger<PaymentsDashboardController> log)
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
        // 2026-11-17 (approved redesign): how it was paid (PaymentGateway, NEFT, ZeroAmount for a 100% subsidy, PaidAtMilestone1).
        "PaymentType",
        // 2026-11-18 (the user: staff pages 'not aligned with SVG files'): the design's "Paid on" column, when the payment was
        // recorded (MsmePaymentInfo.CreatedDate of the row; the procedure returns its Id as TransactionId but no date).
        "PaidOn",
    ];

    /// <summary>PG Type drop-down of the pop-up (value stored in PaymentGatewayTransactions.PgType).</summary>
    public static readonly string[] PgTypes = ["Unified Payments", "Debit Card", "Credit Card", "Net Banking"];

    /// <summary>Consultancy: milestone of the payment (SP_DASHBOARD_PAYMENT_FAILED_TRANSACTIONS / _TRANSACTIONS of ZED_CONSULTANT).</summary>
    public const string ConsultancyFailedMilestone = "MileStoneNumber";
    public const string ConsultancyReceivedMilestone = "MileStoneNum";

    /// <summary>Main: SuperAdmin only; Consultancy and Surveillance: also the MasterAdmin.</summary>
    private bool MayUseFailedTransactions => IsRole(UserRole.SuperAdmin) || (host.System != PortalSystem.Main && IsRole(UserRole.MasterAdmin));

    [HttpGet("failed-transactions")]
    [StaffRoles(UserRole.SuperAdmin, UserRole.MasterAdmin)]
    public async Task<ActionResult<List<Dictionary<string, object?>>>> FailedTransactions(
        string? state, string? certification, string? size, string? gender, CancellationToken ct)
    {
        if (!MayUseFailedTransactions) return Forbid();
        if (Filters(state, certification, size, gender) is not { } f) return this.Problem400("Invalid filter.");
        return DashboardFilters.Pick(await ScopeFilter.ApplyAsync(HttpContext, await LoadFailed(f, ct), ct),
            host.System == PortalSystem.Consultancy ? [.. FailedColumns, ConsultancyFailedMilestone] : FailedColumns);
    }

    [HttpGet("payments-received")]
    [StaffRoles(UserRole.MasterAdmin)]
    public async Task<ActionResult<List<Dictionary<string, object?>>>> PaymentsReceived(
        string? state, string? certification, string? size, string? gender, string? paidFrom, string? paidTo, CancellationToken ct)
    {
        if (Filters(state, certification, size, gender) is not { } f) return this.Problem400("Invalid filter.");
        // 2026-11-18 (the user: staff pages 'not aligned with SVG files'): the design's "Paid between" filter (yyyy-MM-dd, both ends kept).
        if (!PaidDate(paidFrom, out var from) || !PaidDate(paidTo, out var to) || (from is { } a && to is { } b && a > b))
            return this.Problem400("Invalid payment dates.");
        // The legacy action passed PageNo/PageSize, which this procedure does not declare; only its own parameters are sent.
        // Consultancy: the level filter is applied after the level is read from the milestone row (MapHandholdingAsync).
        var consultancy = host.System == PortalSystem.Consultancy;
        var sets = await db.QueryProcMultipleAsync("SP_DASHBOARD_PAYMENT_TRANSACTIONS", new
        {
            Status = "0", State = f.State, UserId, RoleId = RoleId.ToString(), CertificationType = consultancy ? null : f.Certification,
            Gender = f.Gender, MsmeSize = f.Size,
        }, ct);
        var raw = await ScopeFilter.ApplyAsync(HttpContext, sets[0], ct);
        var rows = DashboardFilters.Pick(raw, consultancy ? [.. ReceivedColumns, ConsultancyReceivedMilestone] : ReceivedColumns);
        await AddPaidOnAsync(raw, rows, ct);
        if (consultancy)
        {
            await MapHandholdingAsync(raw, rows, ct);
            if (f.Certification is { } level)
                rows = rows.Where(r => string.Equals(r["Certification"]?.ToString(), level, StringComparison.OrdinalIgnoreCase)).ToList();
        }
        if (from is null && to is null) return rows;
        return rows.Where(r => r["PaidOn"] is DateTime d &&
            (from is null || DateOnly.FromDateTime(d) >= from) && (to is null || DateOnly.FromDateTime(d) <= to)).ToList();
    }

    /// <summary>
    /// 2026-11-21 (UI audit: the only handholding payment showed Level "Bronze" and "MileStone 5" while Monitoring had the case
    /// at Silver, milestone 1): SP_DASHBOARD_PAYMENT_TRANSACTIONS of ZED_CONSULTANT prints the payment record's own
    /// Certification and MileStoneNum, which handholding never has as Bronze or beyond milestone 3. Each payment's level and
    /// milestone are read from the milestone row it opened: the row linked to the record (MsmePaymentInfo.MsmePmtCertId,
    /// set by the payment procedures), else, for a record whose level or milestone is not a handholding one, the unit's
    /// handholding milestone row written with it (created within 10 minutes of the record).
    /// </summary>
    internal const string HandholdingMilestoneSql =
        "SELECT P.Id, LTRIM(RTRIM(H.Certification)) AS Level, H.NcCount AS MileStone " +
        "FROM dbo.MsmePaymentInfo P " +
        "CROSS APPLY (SELECT TOP (1) C.Certification, C.NcCount FROM dbo.MsmeCertifications C " +
        "WHERE C.ZedId = P.ZedId AND LTRIM(RTRIM(C.Certification)) IN ('Silver', 'Gold', 'ZEDX') AND C.NcCount BETWEEN 1 AND 3 " +
        "AND (C.Id = P.MsmePmtCertId OR ((P.MsmePmtCertId IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.MsmeCertifications L WHERE L.Id = P.MsmePmtCertId)) " +
        "AND (ISNULL(LTRIM(RTRIM(P.Certification)), '') NOT IN ('Silver', 'Gold', 'ZEDX') OR ISNULL(P.MileStoneNum, 0) NOT BETWEEN 1 AND 3) " +
        "AND ABS(DATEDIFF(SECOND, C.CreatedDate, P.CreatedDate)) <= 600)) " +
        "ORDER BY CASE WHEN C.Id = P.MsmePmtCertId THEN 0 ELSE 1 END, ABS(DATEDIFF(SECOND, C.CreatedDate, P.CreatedDate))) H " +
        "WHERE P.Id IN @Ids;";

    public sealed record HandholdingMilestoneRow(int Id, string? Level, int MileStone);

    private async Task MapHandholdingAsync(IReadOnlyList<IDictionary<string, object?>> raw, List<Dictionary<string, object?>> rows, CancellationToken ct)
    {
        var ids = raw.Select(r => int.TryParse(r.Text("TransactionId"), out var id) ? id : 0).ToList();
        var wanted = ids.Where(id => id > 0).Distinct().ToList();
        if (wanted.Count == 0) return;
        var found = new Dictionary<int, HandholdingMilestoneRow>();
        try
        {
            foreach (var chunk in wanted.Chunk(1000))
                foreach (var m in await db.QuerySqlAsync<HandholdingMilestoneRow>(HandholdingMilestoneSql, new { Ids = chunk }, ct))
                    found[m.Id] = m;
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "Milestone rows of the payments received list could not be read; the payment records' levels are shown");
            return;
        }
        for (var i = 0; i < rows.Count && i < ids.Count; i++)
        {
            if (!found.TryGetValue(ids[i], out var m) || string.IsNullOrEmpty(m.Level)) continue;
            var milestone = $"MileStone {m.MileStone}";
            if (!string.Equals(rows[i]["Certification"]?.ToString(), m.Level, StringComparison.OrdinalIgnoreCase) ||
                !string.Equals(rows[i][ConsultancyReceivedMilestone]?.ToString(), milestone, StringComparison.OrdinalIgnoreCase))
                log.LogWarning("Payment record {Id} of {ZedId} says {Certification} {Milestone}; its milestone row is {Level} milestone {MileStone}",
                    ids[i], rows[i]["ZedId"], rows[i]["Certification"], rows[i][ConsultancyReceivedMilestone], m.Level, m.MileStone);
            rows[i]["Certification"] = m.Level;
            rows[i][ConsultancyReceivedMilestone] = milestone;
        }
    }

    /// <summary>When each payment of the list was recorded: MsmePaymentInfo.CreatedDate by the row's Id (TransactionId).</summary>
    internal const string PaidOnSql = "SELECT Id, CreatedDate AS PaidOn FROM dbo.MsmePaymentInfo WHERE Id IN @Ids;";

    public sealed record PaidRow(int Id, DateTime? PaidOn);

    /// <summary>
    /// Sets PaidOn on each shown row from its procedure row (same order). Null when the payment row has no date or the table
    /// cannot be read: the page then shows "—" rather than a guessed date.
    /// </summary>
    private async Task AddPaidOnAsync(IReadOnlyList<IDictionary<string, object?>> raw, List<Dictionary<string, object?>> rows, CancellationToken ct)
    {
        var ids = raw.Select(r => int.TryParse(r.Text("TransactionId"), out var id) ? id : 0).ToList();
        var wanted = ids.Where(id => id > 0).Distinct().ToList();
        if (wanted.Count == 0) return;
        var paid = new Dictionary<int, DateTime>();
        try
        {
            // In chunks: SQL Server takes at most 2,100 parameters.
            foreach (var chunk in wanted.Chunk(1000))
                foreach (var p in await db.QuerySqlAsync<PaidRow>(PaidOnSql, new { Ids = chunk }, ct))
                    if (p.PaidOn is { } d) paid[p.Id] = d;
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "Payment dates of the payments received list could not be read");
            return;
        }
        for (var i = 0; i < rows.Count && i < ids.Count; i++)
            if (paid.TryGetValue(ids[i], out var d)) rows[i]["PaidOn"] = d;
    }

    private static bool PaidDate(string? value, out DateOnly? date)
    {
        date = null;
        if (string.IsNullOrWhiteSpace(value)) return true;
        if (!DateOnly.TryParseExact(value.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) return false;
        date = d;
        return true;
    }

    public sealed record UpdatePaymentRequest(
        string? ZedId, string? TransactionId, string? Certification, string? PgType, string? TrackingId,
        string? BankRefNumber, string? BankCode, string? PaymentReceivedDate, string? GstNumber, string? PaymentRemarks);

    /// <summary>
    /// "UPDATE PAYMENT STATUS": records a gateway payment that the bank confirmed but the portal never received.
    /// The page posted to Dashboard/UpdatePaymentDetailsWithInfo, which is missing from the legacy source
    /// (only UpdatePaymentDetails exists, without any authentication filter); this is rebuilt from the
    /// procedure the page's fields belong to. The transaction must be one the failed list offers for update.
    /// The module steps of a gateway payment apply too: the milestone check before a handholding payment is recorded, and
    /// the V4 paid steps after it (ZED-X certification on main, ZED-X surveillance on Surveillance, the consultancy parameters).
    /// </summary>
    [HttpPost("failed-transactions/update-payment")]
    [StaffRoles(UserRole.SuperAdmin, UserRole.MasterAdmin)]
    [Users.DashboardEdit]
    public async Task<ActionResult<MessageResponse>> UpdatePayment(UpdatePaymentRequest req, CancellationToken ct)
    {
        if (!MayUseFailedTransactions) return Forbid();
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

        // Consultancy: the gateway callback's milestone check (ConsultancyGateway). The procedure opens the next milestone for
        // whatever order it is given, so an old order of a milestone already paid would open the following one unpaid.
        if (host.System == PortalSystem.Consultancy &&
            await Payments.Consultancy.ConsultancyGateway.VerifyMilestoneAsync(db, transactionId, new Dictionary<string, string>(), ct) is not null)
        {
            log.LogWarning("{UserId}: manual payment update of {TransactionId} ({ZedId}/{Certification}) refused: not the milestone due, or that milestone is paid",
                UserId, transactionId, zedId, cert);
            return this.Problem400("This transaction is not for the milestone due now, or that milestone is already paid. Its status cannot be updated.");
        }

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
        if (host.System == PortalSystem.Main) await Payments.CertificationPaid.RunAsync(db, row.Text("ZedId"), cert, log, ct);
        if (host.System == PortalSystem.Consultancy) await Payments.Consultancy.ConsultancyParameters.ApplyAsync(db, row.Text("ZedId"), cert, log, ct);
        // V4 levels (ZED-X): the surveillance paid steps the legacy procedures do not do (as SurveillancePaymentCompletion).
        if (host.System == PortalSystem.Surveillance) await Payments.LevelSurveillance.PaidAsync(db, row.Text("ZedId"), cert, log, ct);

        if (host.System != PortalSystem.Main)
        {
            log.LogWarning("{System}: manual payment update of {ZedId}/{Certification} ({TransactionId}) is not posted to the ERP from this portal",
                host.System, zedId, cert, transactionId);
            return new MessageResponse("Payment status updated.");
        }

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

    /// <summary>The page's filters; the level among this portal's levels (Consultancy: the handholding levels, 2026-11-21).</summary>
    private ListFilters? Filters(string? state, string? certification, string? size, string? gender)
    {
        var invalid = false;
        var f = new ListFilters(
            DashboardFilters.Pick(state, DashboardFilters.States.Keys, ref invalid),
            DashboardFilters.Pick(certification,
                host.System == PortalSystem.Consultancy ? [.. Zed.Core.Data.LevelRegistry.Handholding] : DashboardFilters.Certifications, ref invalid),
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
