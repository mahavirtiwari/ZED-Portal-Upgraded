using Microsoft.Extensions.Options;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Payments;

/// <summary>
/// A unit's "PAN Mismatch Detected" correction is allowed (the PAN of any GSTIN verified with Protean replaces the PAN on
/// record, as on the old portal), but no longer silently: it is logged with both PANs, and the office mailbox of
/// payment mails (<see cref="EmailAddresses.RegistrationCc"/>) is told, so staff can spot a GSTIN of another company.
/// The edit history records it too (MsmeEditAudit on the actions).
/// </summary>
public sealed class PanCorrectionNotice(
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    EmailAddresses addresses,
    IOptions<PortalOptions> portal,
    ILogger<PanCorrectionNotice> log)
{
    public async Task RecordAsync(string zedId, string payment, string? oldPan, string newPan, string gstin, CancellationToken ct)
    {
        log.LogWarning("PAN of {ZedId} changed on the {Payment} payment page from {OldPan} to {NewPan} (GSTIN {Gstin})",
            zedId, payment, string.IsNullOrEmpty(oldPan) ? "(none)" : oldPan, newPan, gstin);
        if (string.Equals(oldPan, newPan, StringComparison.OrdinalIgnoreCase)) return;
        try
        {
            if (await addresses.GetAsync(EmailAddresses.RegistrationCc, ct) is not { } office) return;
            var html = await templates.RenderAsync<PanCorrectedEmail>(new Dictionary<string, object?>
            {
                [nameof(PanCorrectedEmail.ZedId)] = zedId,
                [nameof(PanCorrectedEmail.Payment)] = payment,
                [nameof(PanCorrectedEmail.OldPan)] = oldPan,
                [nameof(PanCorrectedEmail.NewPan)] = newPan,
                [nameof(PanCorrectedEmail.Gstin)] = gstin,
                [nameof(PanCorrectedEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
            });
            await email.SendAsync(new EmailMessage(office, "PAN changed on the payment page - " + zedId, html, EmailProfiles.Payment), ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The PAN is already changed: the unit carries on; the log above keeps the record.
            log.LogError(ex, "Office notice of the PAN change of {ZedId} failed", zedId);
        }
    }
}
