using Microsoft.AspNetCore.Mvc;
using Zed.Core.Forms;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Assessment;

/// <summary>
/// V4 (migration 0080): "Basic Information · to validate" on the desktop-assessment page: the answers to the Admin's
/// "Validation required" fields, checked by the desktop assessor for a level certified at the desktop (the level's flow,
/// <see cref="AppFormStages"/>). Levels with a visit: the lead assessor checks them (RemoteAssessmentController).
/// </summary>
public sealed partial class DesktopAssessmentController
{
    /// <param name="Applies">This page checks the level's answers (Main, a level certified at the desktop).</param>
    /// <param name="CanCheck">The signed-in user is the desktop assessor and the verification is open.</param>
    public sealed record FormChecksResponse(bool Applies, bool CanCheck, int Round, bool NcRound, IReadOnlyList<AppFormCheckItem> Items);

    /// <param name="Status">"Yes" (Valid) or "No" (Not valid: <paramref name="Remarks"/> required).</param>
    public sealed record FormCheckRequest(string? Form, string? Key, string? Status, string? Remarks);

    private AppFormChecks Checks => HttpContext.RequestServices.GetRequiredService<AppFormChecks>();

    private static AppFormCheckRound DesktopRound(CertificationRecord record) => new(AppFormStages.Desktop, record.Nc, record.Nc > 0);

    private bool DesktopChecks(string level) => host.System == PortalSystem.Main && AppFormStages.For(level) == AppFormStages.Desktop;

    [HttpGet("form-checks")]
    public async Task<ActionResult<FormChecksResponse>> FormChecks(string zedId, string certification, CancellationToken ct)
    {
        var level = AssessmentInput.Level(certification);
        if (!AssessmentInput.IsId(zedId) || level is null) return this.Problem400("Invalid request.");
        var record = await AssessmentRecords.CertificationAsync(db, zedId, level, ct);
        if (record is null || !record.CanView(CurrentUser)) return NotFound();
        if (!DesktopChecks(level)) return new FormChecksResponse(false, false, record.Nc, record.Nc > 0, []);
        var round = DesktopRound(record);
        return new FormChecksResponse(true, record.CanAssess(CurrentUser), round.Round, round.NcRound,
            await Checks.ItemsAsync(host.System, zedId, level, round, ct));
    }

    [HttpPost("form-checks")]
    [StaffRoles(UserRole.DesktopAssessor)]
    [SubRole(SubRoles.DesktopVerification)]
    public async Task<ActionResult<MessageResponse>> SaveFormCheck(string zedId, string certification, FormCheckRequest req, CancellationToken ct)
    {
        var (level, record, error) = await ForAssessor(zedId, certification, ct);
        if (error is not null) return error;
        if (!DesktopChecks(level!)) return this.Problem400("The answers of this level are checked by the lead assessor of the site assessment.");
        if (await Checks.SaveAsync(host.System, zedId, level!, DesktopRound(record!), req.Form, req.Key, req.Status, req.Remarks, UserId, ct) is { } invalid)
            return this.Problem400(invalid);
        return new MessageResponse("Saved.");
    }

    /// <summary>The final submit needs every answer of the round checked; a Not valid one raises an NC (the procedure does it, 0080).</summary>
    private async Task<FinalSubmitCheck> WithFormChecks(FinalSubmitCheck check, string zedId, string level, CertificationRecord record, CancellationToken ct)
    {
        if (!check.Allowed || !DesktopChecks(level)) return check;
        var (open, notValid) = await Checks.SummaryAsync(host.System, zedId, level, DesktopRound(record), ct);
        if (AppFormChecks.UncheckedMessage(open) is { } message) return check with { Allowed = false, Message = message };
        return notValid > 0 ? check with { RaisesNc = true } : check;
    }
}
