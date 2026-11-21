using System.Data.Common;
using Zed.Core.Data;
using Zed.Portal.Features.Payments.Consultancy;

namespace Zed.Portal.Features.Msme.Handholding;

/// <summary>
/// "ACCEPT MILESTONE n" of handholding (web page and ZED MSME app). SP_MONITORING_RA_APPLICANT_ACCEPTANCE marks the milestone that
/// waits for the unit's acceptance (status 16) as accepted (100); then (2026-11-21, the user: "when there is only one payment in
/// the milestone, this button only automatically direct to the allocation. In case of each milestone payment, the accept button
/// will route to the payment screen for the next milestone"):
/// <list type="bullet">
/// <item>milestone 3: Handholding Support of the level is complete (<see cref="Next.Completed"/>);</item>
/// <item>the unit paid all three milestones at milestone 1 (the next milestone's fee row is "paid at milestone 1", nothing to pay):
/// the next milestone is started at once, as its Rs 0 payment (SP_CONSULTANCY_MSME_ZERO_PAYMENT_DETAILS, the checkout's way), which
/// opens it with the same Consultant Organisation (<see cref="Next.Started"/>), then the completion steps of a payment;</item>
/// <item>else the next milestone is paid on its payment page (<see cref="Next.Pay"/>), where the web page and the app go.</item>
/// </list>
/// When the next milestone cannot be started (the zero procedure refused, the status says it cannot be paid yet) the acceptance stands
/// and the unit is sent to the payment page, which tells why.
/// </summary>
public static class HandholdingAcceptance
{
    public enum Next { Completed, Started, Pay }

    /// <param name="Error">Why the milestone was not accepted (nothing changed); null when accepted.</param>
    public sealed record Result(string? Error, string Message, Next Next, int? NextMilestone);

    public const string NotWaiting = "Milestone {0} is not waiting for your acceptance.";
    public const string Failed = "The milestone could not be accepted. Please try again.";

    public static async Task<Result> AcceptAsync(ISqlExecutor db, IServiceProvider services, string zedId, string level, int milestone, ILogger log, CancellationToken ct)
    {
        var status = await HandholdingEligibility.StatusAsync(db, zedId, log, ct);
        if (HandholdingEligibility.Int(status, HandholdingEligibility.CompletionColumn(level, milestone)) != HandholdingEligibility.AwaitingAcceptance)
            return new Result(string.Format(System.Globalization.CultureInfo.InvariantCulture, NotWaiting, milestone), "", Next.Pay, null);

        try
        {
            await db.ExecuteProcAsync("SP_MONITORING_RA_APPLICANT_ACCEPTANCE", new { UserId = zedId, ZedId = zedId, CertificationType = level }, ct);
        }
        catch (DbException ex)
        {
            log.LogError(ex, "SP_MONITORING_RA_APPLICANT_ACCEPTANCE failed for {ZedId}/{Level} milestone {Milestone}", zedId, level, milestone);
            return new Result(Failed, "", Next.Pay, null);
        }
        log.LogInformation("{ZedId} accepted {Level} handholding milestone {Milestone}", zedId, level, milestone);

        var name = HandholdingEligibility.Display(level);
        if (milestone >= HandholdingEligibility.Milestones)
            return new Result(null, $"Milestone {milestone} accepted. {name} Handholding Support is complete.", Next.Completed, null);

        var next = milestone + 1;
        var accepted = $"Milestone {milestone} accepted.";
        try
        {
            var state = HandholdingEligibility.Evaluate(await ConsultancyPaymentController.StatusRowAsync(db, zedId, ct), level);
            if (!state.CanPay || state.NextMilestone != next) return new Result(null, accepted, Next.Pay, next);

            var fee = (await ConsultancyFees.LoadAsync(db, zedId, level, ct)).WithoutReward;
            if (fee is null || !ConsultancyFees.IsPaidAtMilestone1(fee) || fee.Due is not <= 0m)
                return new Result(null, $"{accepted} Please pay for Milestone {next} to start it.", Next.Pay, next);

            // One payment for all three milestones (made at milestone 1): the next milestone starts now, with nothing to pay.
            var choices = new ConsultancyChoices(zedId, level, fee, UseReward: false, GstinApplicable: false, Gstin: null, TdsDeductible: false, Tds: null, Tan: null);
            if (await ConsultancyZeroPayment.RecordAsync(db, choices, next, log, ct) is { } refused)
            {
                log.LogWarning("Handholding {ZedId}/{Level}: milestone {Next} (paid at milestone 1) was not started after the acceptance: {Refused}", zedId, level, next, refused);
                return new Result(null, accepted, Next.Pay, next);
            }
            await ConsultancyPaymentCompletion.Create(services).CompleteAsync(zedId, level, gateway: false, ct);
            log.LogInformation("Handholding {ZedId}/{Level}: milestone {Next} started on acceptance (paid at milestone 1)", zedId, level, next);
            return new Result(null, $"{accepted} Milestone {next} has started with your Consultant Organisation (already paid with milestone 1).", Next.Started, next);
        }
        catch (Exception ex) when (ex is DbException or InvalidOperationException)
        {
            log.LogError(ex, "Handholding {ZedId}/{Level}: the next milestone after the acceptance of {Milestone} could not be prepared", zedId, level, milestone);
            return new Result(null, accepted, Next.Pay, next);
        }
    }
}
