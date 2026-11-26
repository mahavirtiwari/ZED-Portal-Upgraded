using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Portal.Features.Staff.Schemes;
using Zed.Portal.Templates;
using static Zed.Portal.Features.Incentives.SchemeApplications;

namespace Zed.Portal.Features.Incentives.Staff;

/// <summary>
/// The mails of the scheme verification (templates Msme/StaffScheme*Email, one per step, editable under Admin → Email Templates → Incentive mails). A mail failure
/// is logged and never undoes the action (as <see cref="SchemeMailer"/>, which sends them).
/// </summary>
internal sealed class SchemeNotifier(
    ISqlExecutor db, SchemeStore store, IEmailSender email, IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal, IOptions<EmailOptions> emailOptions, EmailAddresses addresses, ILogger<SchemeNotifier> log)
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

    /// <summary>Phase 2: to the onsite agency the application is allotted to for the onsite verification (round robin or the Master Admin).</summary>
    public Task OnsiteAllottedToAgencyAsync(SchemeCase c, CancellationToken ct) => SafeAsync(async () =>
    {
        var (unit, scheme) = await BasicsAsync(c, ct);
        await Mailer.SendAsync<StaffSchemeOnsiteAllotAgencyEmail>(await EmailOfAsync(c.OnsiteAgency, ct), $"Allocation of Application for Onsite Verification: {scheme} – {c.ZedId}", new()
        {
            [nameof(StaffSchemeOnsiteAllotAgencyEmail.ZedId)] = c.ZedId,
            [nameof(StaffSchemeOnsiteAllotAgencyEmail.UnitName)] = unit?.Name ?? "",
            [nameof(StaffSchemeOnsiteAllotAgencyEmail.Address)] = unit?.Address ?? "",
            [nameof(StaffSchemeOnsiteAllotAgencyEmail.SchemeName)] = scheme,
        }, ct);
    }, c.Id);

    /// <summary>
    /// Phase 2: to the onsite assessor the onsite agency named, and to the unit that a visit is due (with the assessor's name and
    /// mobile). The visit is done in the assessor app; its day is the date of verification.
    /// </summary>
    public async Task OnsiteAllottedToAssessorAsync(SchemeCase c, CancellationToken ct)
    {
        await SafeAsync(async () =>
        {
            var (unit, scheme) = await BasicsAsync(c, ct);
            await Mailer.SendAsync<StaffSchemeOnsiteAllotAssessorEmail>(await EmailOfAsync(c.OnsiteAssessor, ct), $"Allocation of Application for Onsite Verification: {scheme} – {c.ZedId}", new()
            {
                [nameof(StaffSchemeOnsiteAllotAssessorEmail.ZedId)] = c.ZedId,
                [nameof(StaffSchemeOnsiteAllotAssessorEmail.UnitName)] = unit?.Name ?? "",
                [nameof(StaffSchemeOnsiteAllotAssessorEmail.Address)] = unit?.Address ?? "",
                [nameof(StaffSchemeOnsiteAllotAssessorEmail.SchemeName)] = scheme,
                [nameof(StaffSchemeOnsiteAllotAssessorEmail.AssessorUserId)] = c.OnsiteAssessor ?? "",
            }, ct);
        }, c.Id);
        await SafeAsync(async () =>
        {
            var (unit, scheme) = await BasicsAsync(c, ct);
            var assessor = await UserOfAsync(c.OnsiteAssessor, ct);
            var agency = await UserOfAsync(c.OnsiteAgency, ct);
            await Mailer.SendAsync<MsmeSchemeVisitDueEmail>(unit?.EmailId, $"Onsite verification of your application: {scheme} – {c.ZedId}", new()
            {
                [nameof(MsmeSchemeVisitDueEmail.ZedId)] = c.ZedId,
                [nameof(MsmeSchemeVisitDueEmail.UnitName)] = unit?.Name ?? "",
                [nameof(MsmeSchemeVisitDueEmail.SchemeName)] = scheme,
                [nameof(MsmeSchemeVisitDueEmail.AssessorName)] = assessor?.UserName ?? c.OnsiteAssessor ?? "",
                [nameof(MsmeSchemeVisitDueEmail.AssessorMobile)] = assessor?.MobileNo ?? "",
                [nameof(MsmeSchemeVisitDueEmail.AgencyName)] = agency?.UserName ?? "",
            }, ct);
        }, c.Id);
    }

    /// <summary>Desktop flow: to the desktop agency when its assessor recommends (its QC is due).</summary>
    public Task QcDueAsync(SchemeCase c, CancellationToken ct) => SafeAsync(async () =>
    {
        var (unit, scheme) = await BasicsAsync(c, ct);
        await Mailer.SendAsync<StaffSchemeQcDueEmail>(await EmailOfAsync(c.Agency, ct), $"Application recommended for QC: {scheme} – {c.ZedId}", new()
        {
            [nameof(StaffSchemeQcDueEmail.ZedId)] = c.ZedId,
            [nameof(StaffSchemeQcDueEmail.UnitName)] = unit?.Name ?? "",
            [nameof(StaffSchemeQcDueEmail.SchemeName)] = scheme,
            [nameof(StaffSchemeQcDueEmail.AssessorUserId)] = c.Assessor ?? "",
            [nameof(StaffSchemeQcDueEmail.ClaimAmount)] = c.Row.ClaimAmount is { } a ? SchemeCases.Money(a) : "",
            [nameof(StaffSchemeQcDueEmail.EligibleAmount)] = c.EligibleAmount ?? "",
        }, ct);
    }, c.Id);

    /// <summary>Phase 2: to the onsite agency when its assessor submits the visit with a recommendation (its final QC is due).</summary>
    public Task OnsiteSubmittedAsync(SchemeCase c, CancellationToken ct) => SafeAsync(async () =>
    {
        var (unit, scheme) = await BasicsAsync(c, ct);
        await Mailer.SendAsync<StaffSchemeOnsiteSubmittedEmail>(await EmailOfAsync(c.OnsiteAgency, ct), $"Onsite verification submitted: {scheme} – {c.ZedId}", new()
        {
            [nameof(StaffSchemeOnsiteSubmittedEmail.ZedId)] = c.ZedId,
            [nameof(StaffSchemeOnsiteSubmittedEmail.UnitName)] = unit?.Name ?? "",
            [nameof(StaffSchemeOnsiteSubmittedEmail.SchemeName)] = scheme,
            [nameof(StaffSchemeOnsiteSubmittedEmail.AssessorUserId)] = c.OnsiteAssessor ?? "",
            [nameof(StaffSchemeOnsiteSubmittedEmail.VisitDate)] = Day(c.Row.VisitStartedOn),
            [nameof(StaffSchemeOnsiteSubmittedEmail.VerifiedClaim)] = c.Row.OnsiteVerifiedClaim is { } v ? SchemeCases.Money(v) : "",
            [nameof(StaffSchemeOnsiteSubmittedEmail.EligibleAmount)] = c.EligibleAmount ?? "",
        }, ct);
    }, c.Id);

    public const string DesktopStage = "Desktop verification";
    public const string OnsiteStage = "Onsite verification";
    public const string NoDesktopAgency = "No desktop verification agency serves this scheme in the unit's state and district.";
    public const string NoOnsiteAgency = "No onsite verification agency covers the unit's state and district, or automatic allotment is off for this scheme.";
    public const string AutoAllotOff = "Automatic allotment is off for this scheme.";

    /// <summary>Where a resumed application continues, in words (the resumed mail's Status row).</summary>
    public static string StageWords(string status) => status switch
    {
        Submitted => "Waiting for allotment of the verification agency",
        WithAgency => "With the verification agency",
        WithAssessor or Verifying => "Desktop verification",
        Correction => "Correction (please answer it by the due date)",
        Qc => "Quality check by the agency",
        OnsiteAllot => "Waiting for allotment of the onsite verification agency",
        OnsiteWithAgency => "With the onsite verification agency",
        OnsiteWithAssessor or OnsiteVisit => "Onsite verification",
        Approved => "Approved, waiting for payment",
        _ => status,
    };

    /// <summary>To the ZED team inbox (Admin → Settings → E-mail addresses): the application waits for the Master Admin's allotment.</summary>
    public Task ManualAllotAsync(SchemeCase c, string stage, string reason, CancellationToken ct) => SafeAsync(async () =>
    {
        var (unit, scheme) = await BasicsAsync(c, ct);
        await Mailer.SendAsync<StaffSchemeManualAllotEmail>(await TeamInboxAsync(ct), $"Application waiting for allotment ({stage}): {scheme} – {c.ZedId}", new()
        {
            [nameof(StaffSchemeManualAllotEmail.ZedId)] = c.ZedId,
            [nameof(StaffSchemeManualAllotEmail.UnitName)] = unit?.Name ?? "",
            [nameof(StaffSchemeManualAllotEmail.SchemeName)] = scheme,
            [nameof(StaffSchemeManualAllotEmail.Stage)] = stage,
            [nameof(StaffSchemeManualAllotEmail.Reason)] = reason,
        }, ct);
    }, c.Id);

    /// <summary>To the unit and the ZED team inbox: the application is on hold (certificate suspended or withdrawn).</summary>
    public async Task OnHoldAsync(SchemeCase c, CancellationToken ct)
    {
        await SafeAsync(async () =>
        {
            var (unit, scheme) = await BasicsAsync(c, ct);
            await Mailer.SendAsync<MsmeSchemeOnHoldEmail>(unit?.EmailId, $"Application on hold: {scheme} – {c.ZedId}", new()
            {
                [nameof(MsmeSchemeOnHoldEmail.ZedId)] = c.ZedId,
                [nameof(MsmeSchemeOnHoldEmail.UnitName)] = unit?.Name ?? "",
                [nameof(MsmeSchemeOnHoldEmail.SchemeName)] = scheme,
                [nameof(MsmeSchemeOnHoldEmail.HoldReason)] = c.HoldReason ?? "",
            }, ct);
        }, c.Id);
        await SafeAsync(async () =>
        {
            var (unit, scheme) = await BasicsAsync(c, ct);
            await Mailer.SendAsync<StaffSchemeOnHoldEmail>(await TeamInboxAsync(ct), $"Application on hold: {scheme} – {c.ZedId}", new()
            {
                [nameof(StaffSchemeOnHoldEmail.ZedId)] = c.ZedId,
                [nameof(StaffSchemeOnHoldEmail.UnitName)] = unit?.Name ?? "",
                [nameof(StaffSchemeOnHoldEmail.SchemeName)] = scheme,
                [nameof(StaffSchemeOnHoldEmail.HoldReason)] = c.HoldReason ?? "",
            }, ct);
        }, c.Id);
    }

    /// <summary>To the unit: the Master Admin resumed its application on hold (<paramref name="stage"/> = where it continues).</summary>
    public Task ResumedAsync(SchemeCase c, string stage, CancellationToken ct) => SafeAsync(async () =>
    {
        var (unit, scheme) = await BasicsAsync(c, ct);
        await Mailer.SendAsync<MsmeSchemeResumedEmail>(unit?.EmailId, $"Application resumed: {scheme} – {c.ZedId}", new()
        {
            [nameof(MsmeSchemeResumedEmail.ZedId)] = c.ZedId,
            [nameof(MsmeSchemeResumedEmail.UnitName)] = unit?.Name ?? "",
            [nameof(MsmeSchemeResumedEmail.SchemeName)] = scheme,
            [nameof(MsmeSchemeResumedEmail.Stage)] = stage,
        }, ct);
    }, c.Id);

    /// <summary>To the desktop agency: its assessor returned the application.</summary>
    public Task ReturnedByAssessorAsync(SchemeCase c, string assessor, string reason, CancellationToken ct) => SafeAsync(async () =>
    {
        var (unit, scheme) = await BasicsAsync(c, ct);
        await Mailer.SendAsync<StaffSchemeReturnedByAssessorEmail>(await EmailOfAsync(c.Agency, ct), $"Returned by the verification officer: {scheme} – {c.ZedId}", new()
        {
            [nameof(StaffSchemeReturnedByAssessorEmail.ZedId)] = c.ZedId,
            [nameof(StaffSchemeReturnedByAssessorEmail.UnitName)] = unit?.Name ?? "",
            [nameof(StaffSchemeReturnedByAssessorEmail.SchemeName)] = scheme,
            [nameof(StaffSchemeReturnedByAssessorEmail.AssessorUserId)] = assessor,
            [nameof(StaffSchemeReturnedByAssessorEmail.Reason)] = reason,
        }, ct);
    }, c.Id);

    /// <summary>To the desktop assessor: the unit answered the correction round.</summary>
    public Task CorrectionReceivedAsync(SchemeCase c, int round, CancellationToken ct) => SafeAsync(async () =>
    {
        var (unit, scheme) = await BasicsAsync(c, ct);
        await Mailer.SendAsync<StaffSchemeCorrectionReceivedEmail>(await EmailOfAsync(c.Assessor, ct), $"Correction received: {scheme} – {c.ZedId}", new()
        {
            [nameof(StaffSchemeCorrectionReceivedEmail.ZedId)] = c.ZedId,
            [nameof(StaffSchemeCorrectionReceivedEmail.UnitName)] = unit?.Name ?? "",
            [nameof(StaffSchemeCorrectionReceivedEmail.SchemeName)] = scheme,
            [nameof(StaffSchemeCorrectionReceivedEmail.Round)] = round.ToString(System.Globalization.CultureInfo.InvariantCulture),
        }, ct);
    }, c.Id);

    /// <summary>To the desktop assessor: the agency sent the application back from QC.</summary>
    public Task QcSentBackAsync(SchemeCase c, string remarks, CancellationToken ct) => SafeAsync(async () =>
    {
        var (unit, scheme) = await BasicsAsync(c, ct);
        await Mailer.SendAsync<StaffSchemeQcSentBackEmail>(await EmailOfAsync(c.Assessor, ct), $"Sent back from QC: {scheme} – {c.ZedId}", new()
        {
            [nameof(StaffSchemeQcSentBackEmail.ZedId)] = c.ZedId,
            [nameof(StaffSchemeQcSentBackEmail.UnitName)] = unit?.Name ?? "",
            [nameof(StaffSchemeQcSentBackEmail.SchemeName)] = scheme,
            [nameof(StaffSchemeQcSentBackEmail.Remarks)] = remarks,
        }, ct);
    }, c.Id);

    /// <summary>Phase 2: to the onsite assessor: the onsite agency sent the application back from the final QC.</summary>
    public Task OnsiteQcSentBackAsync(SchemeCase c, string remarks, CancellationToken ct) => SafeAsync(async () =>
    {
        var (unit, scheme) = await BasicsAsync(c, ct);
        await Mailer.SendAsync<StaffSchemeOnsiteQcSentBackEmail>(await EmailOfAsync(c.OnsiteAssessor, ct), $"Sent back from onsite QC: {scheme} – {c.ZedId}", new()
        {
            [nameof(StaffSchemeOnsiteQcSentBackEmail.ZedId)] = c.ZedId,
            [nameof(StaffSchemeOnsiteQcSentBackEmail.UnitName)] = unit?.Name ?? "",
            [nameof(StaffSchemeOnsiteQcSentBackEmail.SchemeName)] = scheme,
            [nameof(StaffSchemeOnsiteQcSentBackEmail.Remarks)] = remarks,
        }, ct);
    }, c.Id);

    private static string Day(DateTime? d) => d?.ToString("dd-MMM-yyyy", System.Globalization.CultureInfo.InvariantCulture) ?? "";

    private async Task<SchemeCases.UserRow?> UserOfAsync(string? userId, CancellationToken ct)
    {
        try { return string.IsNullOrWhiteSpace(userId) ? null : await SchemeCases.UserAsync(db, userId, ct); }
        catch (Exception ex) when (ex is not OperationCanceledException) { log.LogWarning(ex, "User {UserId} not read for a scheme mail", userId); return null; }
    }

    private async Task<string> TeamInboxAsync(CancellationToken ct) =>
        await addresses.GetAsync(EmailAddresses.ZedTeamInbox, ct) is { Length: > 0 } inbox ? inbox : EmailAddresses.LegacyTeamInbox;

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
