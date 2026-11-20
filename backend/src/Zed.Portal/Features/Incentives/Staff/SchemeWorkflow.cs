using Zed.Core.Data;

namespace Zed.Portal.Features.Incentives.Staff;

/// <summary>
/// The staff side of the applicant's hand-off (<see cref="ISchemeWorkflow"/>, registered scoped in PortalSetup): after a submission
/// the history entry, the confirmation mail to the unit and, when the scheme's Verification.AutoAllot is on, the round robin
/// (<see cref="SchemeAllotment"/>); after a correction round is answered the history entry and a mail to the assessor. Failures
/// are logged and never undo the applicant's action.
/// </summary>
public sealed class SchemeWorkflow(ISqlExecutor db, IServiceProvider services, ILogger<SchemeWorkflow> log) : ISchemeWorkflow
{
    public async Task AfterSubmitAsync(int id, CancellationToken ct)
    {
        try
        {
            var c = await SchemeCases.LoadAsync(db, id, ct);
            if (c is null) { log.LogWarning("Scheme application {Id} not found after its submission", id); return; }
            await SchemeCases.HistoryAsync(db, log, c, "Scheme application submitted by the unit", ct);
            await SchemeServices.Get<SchemeNotifier>(services).SubmittedAsync(c, ct);
            var allotment = SchemeServices.Get<SchemeAllotment>(services);
            if (c.Status == SchemeApplications.Submitted && await allotment.AutoAllotOnAsync(c.Code, ct))
                await allotment.AutoAllotAsync(id, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "After the submission of scheme application {Id}", id);
        }
    }

    public async Task AfterCorrectionAsync(int id, CancellationToken ct)
    {
        try
        {
            var c = await SchemeCases.LoadAsync(db, id, ct);
            if (c is null) { log.LogWarning("Scheme application {Id} not found after its correction", id); return; }
            var round = c.CorrectionRound ?? 1;
            await SchemeCases.HistoryAsync(db, log, c, $"Correction round {round} answered by the unit", ct);
            await SchemeServices.Get<SchemeNotifier>(services).NoticeAsync(c, c.Assessor, "Correction received",
                $"The unit has answered correction round {round} of its application. Please check the corrected answers and documents again.", ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "After the correction of scheme application {Id}", id);
        }
    }
}
