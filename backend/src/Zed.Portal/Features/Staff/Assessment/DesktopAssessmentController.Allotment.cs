using System.Globalization;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Assessment;

/// <summary>
/// 2026-11-18 (the user: "show assessment detail during the allocation in the login of assessment agency"): the agency may
/// open the details page of a unit allotted to it before it accepts it (allots it to a desktop assessor) or rejects it, as a
/// read-only preview of what the applicant submitted in the ZED MSME app. <see cref="DaDetailsResponse.Allotment"/> says so,
/// and carries what the page's banner needs (allotted on, the assessor's answer, the applicant's contact in full, which of
/// Accept / Re-allot and Reject apply). The unit must be in the agency's own "DA" allotment list (SP_ASSESSMENT_ALLOT_LIST,
/// scoped by UserId: main, its units at status &lt; 3 not yet accepted by an assessor; Surveillance, its Bronze units at
/// status 1 not yet started in the app), the same rule as the list's Accept and Reject (<see cref="DesktopAllotmentController"/>).
/// Reading needs nothing new (an agency already sees the units allotted to it, <see cref="CertificationRecord.CanView"/>);
/// every change of the page stays the accepted desktop assessor's (the write actions are limited to that role).
/// <para>2026-11-18 (the user: "accept, reject, view details ... similar to combination one"): the same for a unit waiting in
/// the agency's site-assessment allotment list (SP_ASSESSMENT_ALLOT_LIST 'SA': its non-Bronze units at status 6 / 8 on main,
/// Silver/Gold surveillance on Surveillance) that it has not rejected, with the site actions (SiteAssessmentController:
/// allot / re-allot to a site assessor, reject). A unit with no desktop step (Remote only / Onsite only levels) is the same
/// read-only preview; one with a desktop assessment shows it (<see cref="AgencyAllotment.Preview"/> false).</para>
/// </summary>
public sealed partial class DesktopAssessmentController
{
    /// <param name="Kind">"desktop" (the DA allotment list, desktop assessor) or "site" (the SA allotment list, site assessor).</param>
    /// <param name="Preview">The page hides the assessors' verdicts: nothing assessed yet (always for "desktop"; for "site", no desktop step).</param>
    /// <param name="Stage">"pending" (no assessor yet), "allotted" (given to an assessor: desktop, not accepted yet; site, not started) or "rejected" (the desktop assessor rejected it).</param>
    /// <param name="AllottedOn">When the unit was allotted to the agency ("18 Nov 2026"), when known.</param>
    /// <param name="CanAllot">Accept / Re-allot: allot it to one of the agency's desktop assessors (da-allotment/allot).</param>
    /// <param name="CanReject">Reject it back to the ZED team with a reason (da-allotment/reject).</param>
    /// <param name="Mobile">The applicant's contact in full (2026-11-18, the user: nothing masked in the signed-in portal).</param>
    public sealed record AgencyAllotment(
        string Kind,
        bool Preview,
        string Stage,
        string? AllottedOn,
        string? AssessorId,
        string? AssessorName,
        string? AssessorReason,
        bool CanAllot,
        bool CanReject,
        string? SpocName,
        string? Mobile,
        string? Email,
        string? Pan);

    /// <summary>The last allotment of the unit's level to this agency (manual, auto or the applicant's choice).</summary>
    internal const string AllottedOnSql =
        "SELECT TOP 1 CreatedDate FROM AgencyAllotmentHistory WHERE AgencyId = @AgencyId AND ZedId = @ZedId AND CertificationType = @Certification " +
        // 2026-11-21: not a handholding milestone 1 allotment (the same table keeps the Consultant Organisations' round robin).
        "AND ISNULL(AllotType, '') NOT LIKE 'Handholding%' ORDER BY CreatedDate DESC";

    internal const string PanSql = "SELECT TOP 1 PanNo FROM MsmeBasicInformation WHERE ZedId = @ZedId";

    private sealed class DateRow
    {
        public DateTime? CreatedDate { get; init; }
    }

    private sealed class PanRow
    {
        public string? PanNo { get; init; }
    }

    /// <summary>The preview block for the agency of a unit waiting in its DA allotment list; null for anyone else and any other stage.</summary>
    private async Task<AgencyAllotment?> AgencyAllotmentAsync(string zedId, string level, CertificationRecord record, ZedUser user, CancellationToken ct)
    {
        if (user.RoleId != (int)UserRole.Agency || !record.CanView(user)) return null;
        return (user.HasSubRole(SubRoles.DesktopVerification) ? await DesktopAllotmentAsync(zedId, level, record, ct) : null)
               ?? (user.HasSubRole(SubRoles.SiteVerification) && level != "Bronze" ? await SiteAllotmentAsync(zedId, level, record, ct) : null);
    }

    private async Task<AgencyAllotment?> DesktopAllotmentAsync(string zedId, string level, CertificationRecord record, CancellationToken ct)
    {
        var sets = await AllotmentLists.List(db, UserId, RoleId, "DA", zedId, AllotmentLists.Filter.None with { Certification = level }, ct);
        var row = sets[0].FirstOrDefault(r => AllotmentLists.Same(r, "ZedId", zedId) && AllotmentLists.Same(r, "Certification", level));
        if (row is null || row.Text("ReasonForRejection").Length > 0) return null;

        var assessor = row.Text("DesktopAssessorId").Trim();
        var reason = row.Text("DesktopReasonForRejection");
        var surveillance = host.System == PortalSystem.Surveillance;
        // The list's rules (da-allotment.ts canReallot / menu, DesktopAllotmentController.AgencyReject).
        var canAllot = assessor.Length == 0 ||
                       (surveillance ? record.Status < 2 : reason.Length > 0 || !AllotmentLists.Flag(row, "DesktopAccepted"));
        var canReject = assessor.Length == 0 || reason.Length > 0;
        var stage = assessor.Length == 0 ? "pending" : reason.Length > 0 ? "rejected" : "allotted";

        return new AgencyAllotment(
            "desktop",
            true,
            stage,
            await AllottedOnAsync(zedId, level, ct),
            assessor.Length > 0 ? assessor : null,
            row.Text("DaAssessorName") is { Length: > 0 } name ? name : null,
            reason.Length > 0 ? reason : null,
            canAllot,
            canReject,
            Blank(row.Text("UnitSpocName")),
            Blank(row.Text("UnitSpocMobileNo")),
            Blank(row.Text("UnitSpocEmailId")),
            await PanAsync(zedId, ct));
    }

    /// <summary>The unit in the agency's SA allotment list, not rejected by it (the list's Allot / Re-allot and Reject rules).</summary>
    private async Task<AgencyAllotment?> SiteAllotmentAsync(string zedId, string level, CertificationRecord record, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_ASSESSMENT_ALLOT_LIST", new
        {
            UserId,
            RoleId = ((int)UserRole.Agency).ToString(CultureInfo.InvariantCulture),
            AllotmentType = "SA",
            ZedId = zedId,
            CertificationType = level,
        }, ct);
        var row = sets[0].FirstOrDefault(r => AllotmentLists.Same(r, "ZedId", zedId) && AllotmentLists.Same(r, "Certification", level));
        // A certified record is no allotment (main's list also holds non-Bronze levels certified at the desktop, status 6).
        if (row is null || row.Text("ReasonForRejection").Length > 0 || record.IsCertified) return null;

        var assessor = row.Text("SiteAssessorId").Trim();
        return new AgencyAllotment(
            "site",
            string.IsNullOrWhiteSpace(record.DesktopAssessorId),
            assessor.Length == 0 ? "pending" : "allotted",
            await AllottedOnAsync(zedId, level, ct),
            assessor.Length > 0 ? assessor : null,
            Blank(row.Text("SaAssessorName")),
            null,
            true,
            assessor.Length == 0,
            Blank(row.Text("UnitSpocName")),
            Blank(row.Text("UnitSpocMobileNo")),
            Blank(row.Text("UnitSpocEmailId")),
            await PanAsync(zedId, ct));
    }

    private async Task<string?> AllottedOnAsync(string zedId, string level, CancellationToken ct)
    {
        try
        {
            var rows = await db.QuerySqlAsync<DateRow>(AllottedOnSql,
                new { AgencyId = AssessmentInput.Ansi(UserId), ZedId = AssessmentInput.Ansi(zedId), Certification = AssessmentInput.Ansi(level) }, ct);
            return rows.FirstOrDefault()?.CreatedDate?.ToString("d MMM yyyy", CultureInfo.InvariantCulture);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Agency allotment date of {ZedId} {Certification} could not be read", zedId, level);
            return null;
        }
    }

    private async Task<string?> PanAsync(string zedId, CancellationToken ct)
    {
        try
        {
            var rows = await db.QuerySqlAsync<PanRow>(PanSql, new { ZedId = AssessmentInput.Ansi(AssessmentInput.BaseZedId(zedId)) }, ct);
            return Blank(rows.FirstOrDefault()?.PanNo);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "PAN of {ZedId} could not be read for the agency's preview", zedId);
            return null;
        }
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
