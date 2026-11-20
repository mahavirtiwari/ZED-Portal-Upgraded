using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Portal.Features.Staff.Schemes;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Incentives.Staff;

/// <summary>
/// The mails of the scheme verification (templates Msme/StaffScheme*Email, editable under Admin → Email Templates). A mail failure
/// is logged and never undoes the action (as <see cref="SchemeMailer"/>, which sends them).
/// </summary>
internal sealed class SchemeNotifier(
    ISqlExecutor db, SchemeStore store, IEmailSender email, IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal, IOptions<EmailOptions> emailOptions, ILogger<SchemeNotifier> log)
{
    private SchemeMailer Mailer => new(db, email, templates, portal, emailOptions, log);

    public async Task<string> SchemeNameAsync(string code, CancellationToken ct) =>
        (await store.FindAsync(code, ct))?.Name is { Length: > 0 } n ? n : code;

    private async Task<(SchemeCases.UnitRow? Unit, string Scheme)> BasicsAsync(SchemeCase c, CancellationToken ct)
    {
        SchemeCases.UnitRow? unit = null;
        try { unit = await SchemeCases.UnitAsync(db, c.ZedId, ct); }
        catch (Exception ex) when (ex is not OperationCanceledException) { log.LogWarning(ex, "Unit {ZedId} not read for a scheme mail", c.ZedId); }
        return (unit, await SchemeNameAsync(c.Code, ct));
    }

    private async Task SafeAsync(Func<Task> send, int id)
    {
        try { await send(); }
        catch (Exception ex) when (ex is not OperationCanceledException) { log.LogError(ex, "Scheme application {Id}: mail not sent", id); }
    }

    private async Task<string?> EmailOfAsync(string? userId, CancellationToken ct)
    {
        try { return (await SchemeCases.UserAsync(db, userId, ct))?.Email; }
        catch (Exception ex) when (ex is not OperationCanceledException) { log.LogWarning(ex, "E-mail of {UserId} not read", userId); return null; }
    }

    public Task SubmittedAsync(SchemeCase c, CancellationToken ct) => SafeAsync(async () =>
    {
        var (unit, scheme) = await BasicsAsync(c, ct);
        await Mailer.SendAsync<MsmeSchemeSubmittedEmail>(unit?.EmailId, $"Application submitted: {scheme} – {c.ZedId}", new()
        {
            [nameof(MsmeSchemeSubmittedEmail.ZedId)] = c.ZedId,
            [nameof(MsmeSchemeSubmittedEmail.UnitName)] = unit?.Name ?? "",
            [nameof(MsmeSchemeSubmittedEmail.SchemeName)] = scheme,
            [nameof(MsmeSchemeSubmittedEmail.ClaimAmount)] = c.Row.ClaimAmount is { } a ? SchemeCases.Money(a) : "",
        }, ct);
    }, c.Id);

    public Task AllottedToAgencyAsync(SchemeCase c, CancellationToken ct) => SafeAsync(async () =>
    {
        var (unit, scheme) = await BasicsAsync(c, ct);
        await Mailer.SendAsync<StaffSchemeAllotAgencyEmail>(await EmailOfAsync(c.Agency, ct), $"Allocation of Application for Verification: {scheme} – {c.ZedId}", new()
        {
            [nameof(StaffSchemeAllotAgencyEmail.ZedId)] = c.ZedId,
            [nameof(StaffSchemeAllotAgencyEmail.UnitName)] = unit?.Name ?? "",
            [nameof(StaffSchemeAllotAgencyEmail.Address)] = unit?.Address ?? "",
            [nameof(StaffSchemeAllotAgencyEmail.SchemeName)] = scheme,
        }, ct);
    }, c.Id);

    public Task AllottedToAssessorAsync(SchemeCase c, CancellationToken ct) => SafeAsync(async () =>
    {
        var (unit, scheme) = await BasicsAsync(c, ct);
        await Mailer.SendAsync<StaffSchemeAllotAssessorEmail>(await EmailOfAsync(c.Assessor, ct), $"Allocation of Application for Verification: {scheme} – {c.ZedId}", new()
        {
            [nameof(StaffSchemeAllotAssessorEmail.ZedId)] = c.ZedId,
            [nameof(StaffSchemeAllotAssessorEmail.UnitName)] = unit?.Name ?? "",
            [nameof(StaffSchemeAllotAssessorEmail.SchemeName)] = scheme,
            [nameof(StaffSchemeAllotAssessorEmail.AssessorUserId)] = c.Assessor ?? "",
        }, ct);
    }, c.Id);

    /// <summary>A short notice to a staff user (the assessor returned it, the agency sent it back, the unit answered a correction).</summary>
    public Task NoticeAsync(SchemeCase c, string? toUserId, string subject, string notice, CancellationToken ct) => SafeAsync(async () =>
    {
        var (unit, scheme) = await BasicsAsync(c, ct);
        await Mailer.SendAsync<StaffSchemeNoticeEmail>(await EmailOfAsync(toUserId, ct), $"{subject}: {scheme} – {c.ZedId}", new()
        {
            [nameof(StaffSchemeNoticeEmail.ZedId)] = c.ZedId,
            [nameof(StaffSchemeNoticeEmail.UnitName)] = unit?.Name ?? "",
            [nameof(StaffSchemeNoticeEmail.SchemeName)] = scheme,
            [nameof(StaffSchemeNoticeEmail.Notice)] = notice,
        }, ct);
    }, c.Id);

    public Task CorrectionAsync(SchemeCase c, int rounds, string remarks, CancellationToken ct) => SafeAsync(async () =>
    {
        var (unit, scheme) = await BasicsAsync(c, ct);
        await Mailer.SendAsync<MsmeSchemeCorrectionEmail>(unit?.EmailId, $"Correction needed in your application: {scheme} – {c.ZedId}", new()
        {
            [nameof(MsmeSchemeCorrectionEmail.ZedId)] = c.ZedId,
            [nameof(MsmeSchemeCorrectionEmail.UnitName)] = unit?.Name ?? "",
            [nameof(MsmeSchemeCorrectionEmail.SchemeName)] = scheme,
            [nameof(MsmeSchemeCorrectionEmail.Round)] = (c.CorrectionRound ?? 1).ToString(System.Globalization.CultureInfo.InvariantCulture),
            [nameof(MsmeSchemeCorrectionEmail.Rounds)] = rounds.ToString(System.Globalization.CultureInfo.InvariantCulture),
            [nameof(MsmeSchemeCorrectionEmail.DueOn)] = c.CorrectionDueOn?.ToString("dd-MMM-yyyy", System.Globalization.CultureInfo.InvariantCulture) ?? "",
            [nameof(MsmeSchemeCorrectionEmail.Remarks)] = remarks,
        }, ct);
    }, c.Id);

    public Task RejectedAsync(SchemeCase c, string reason, CancellationToken ct) => SafeAsync(async () =>
    {
        var (unit, scheme) = await BasicsAsync(c, ct);
        await Mailer.SendAsync<MsmeSchemeRejectedEmail>(unit?.EmailId, $"Application rejected: {scheme} – {c.ZedId}", new()
        {
            [nameof(MsmeSchemeRejectedEmail.ZedId)] = c.ZedId,
            [nameof(MsmeSchemeRejectedEmail.UnitName)] = unit?.Name ?? "",
            [nameof(MsmeSchemeRejectedEmail.SchemeName)] = scheme,
            [nameof(MsmeSchemeRejectedEmail.Reason)] = reason,
        }, ct);
    }, c.Id);

    public Task ApprovedAsync(SchemeCase c, CancellationToken ct) => SafeAsync(async () =>
    {
        var (unit, scheme) = await BasicsAsync(c, ct);
        await Mailer.SendAsync<MsmeSchemeApprovedEmail>(unit?.EmailId, $"Application approved: {scheme} – {c.ZedId}", new()
        {
            [nameof(MsmeSchemeApprovedEmail.ZedId)] = c.ZedId,
            [nameof(MsmeSchemeApprovedEmail.UnitName)] = unit?.Name ?? "",
            [nameof(MsmeSchemeApprovedEmail.SchemeName)] = scheme,
            [nameof(MsmeSchemeApprovedEmail.Amount)] = c.ApprovedAmount is { } a ? SchemeCases.Money(a) : "",
        }, ct);
    }, c.Id);
}

/// <summary>Resolves the staff side's services whether or not they are registered (the integrator registers them in PortalSetup).</summary>
internal static class SchemeServices
{
    public static T Get<T>(IServiceProvider sp) where T : class => ActivatorUtilities.GetServiceOrCreateInstance<T>(sp);
}
