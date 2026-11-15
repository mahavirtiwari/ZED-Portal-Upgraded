using Microsoft.AspNetCore.Mvc;
using Zed.Core.Forms;
using Zed.Core.Http;

namespace Zed.Portal.Features.Remote;

/// <summary>
/// V4 (migration 0080): "Basic Information · to validate" on the lead assessor's review (remote, or onsite after the app's
/// closing meeting): the answers to the Admin's "Validation required" fields, for the levels whose NCs are raised at the
/// site final submit (levels with a visit, by the level's flow; <see cref="AppFormStages"/>). In an NC round: the answers whose NC was raised in it.
/// </summary>
public sealed partial class RemoteAssessmentController
{
    /// <param name="Applies">This review checks the level's answers (Main, a level with a visit).</param>
    /// <param name="CanCheck">The signed-in user is the lead assessor and the assessment (or the answered NC round) is open.</param>
    public sealed record FormChecksResponse(bool Applies, bool CanCheck, int Round, bool NcRound, IReadOnlyList<AppFormCheckItem> Items);

    /// <param name="Status">"Yes" (Valid) or "No" (Not valid: <paramref name="Remarks"/> required).</param>
    public sealed record FormCheckRequest(string? Form, string? Key, string? Status, string? Remarks);

    private AppFormChecks Checks => HttpContext.RequestServices.GetRequiredService<AppFormChecks>();

    private static AppFormCheckRound SiteRound(RemoteRecord record) => new(AppFormStages.Site, record.NcCount ?? 0, InNcRound(record));

    private bool SiteChecks(string level) => host.System == PortalSystem.Main && AppFormStages.For(level) == AppFormStages.Site;

    [HttpGet("form-checks")]
    public async Task<ActionResult<FormChecksResponse>> FormChecks(string zedId, string certification, CancellationToken ct)
    {
        var (level, record, error) = await ForViewer(zedId, certification, ct);
        if (error is not null) return error;
        var round = SiteRound(record!);
        if (!SiteChecks(level!)) return new FormChecksResponse(false, false, round.Round, round.NcRound, []);
        return new FormChecksResponse(true, CanAssess(record!), round.Round, round.NcRound, await Checks.ItemsAsync(host.System, zedId, level!, round, ct));
    }

    [HttpPost("form-checks")]
    public async Task<ActionResult<MessageResponse>> SaveFormCheck(string zedId, string certification, FormCheckRequest req, CancellationToken ct)
    {
        var (level, record, error) = await ForAssessor(zedId, certification, ct, roundWork: true);
        if (error is not null) return error;
        if (!SiteChecks(level!)) return this.Problem400("The answers of this level are checked by the desktop assessor.");
        if (await Checks.SaveAsync(host.System, zedId, level!, SiteRound(record!), req.Form, req.Key, req.Status, req.Remarks, UserId, ct) is { } invalid)
            return this.Problem400(invalid);
        return new MessageResponse("Data Updated");
    }

    /// <summary>The final submit needs every answer of the round checked; a Not valid one raises an NC (the procedure does it, 0080).</summary>
    private async Task<FinalSubmitCheck> WithFormChecks(FinalSubmitCheck check, string zedId, string level, RemoteRecord record, CancellationToken ct)
    {
        if (!check.Allowed || !SiteChecks(level)) return check;
        var (open, notValid) = await Checks.SummaryAsync(host.System, zedId, level, SiteRound(record), ct);
        if (AppFormChecks.UncheckedMessage(open) is { } message) return check with { Allowed = false, Message = message };
        return notValid > 0 ? check with { RaisesNc = true } : check;
    }
}
