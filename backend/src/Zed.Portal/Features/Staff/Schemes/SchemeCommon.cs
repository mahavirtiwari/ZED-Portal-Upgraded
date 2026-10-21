using System.Globalization;
using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;

namespace Zed.Portal.Features.Staff.Schemes;

/// <summary>
/// Serialises the state changes of the financial assistance (FA) and NEFT reimbursement workflow, so a
/// double click or two reviewers acting at once cannot both pass the "current status" check before
/// either procedure has run (the legacy procedures update unconditionally). Single API server; for a
/// web farm the checks would need a conditional UPDATE in the procedures.
/// </summary>
internal static class SchemeLocks
{
    public static readonly SemaphoreSlim Workflow = new(1, 1);

    public static async Task<IDisposable> EnterAsync(CancellationToken ct)
    {
        await Workflow.WaitAsync(ct);
        return new Releaser();
    }

    private sealed class Releaser : IDisposable
    {
        private int _done;
        public void Dispose() { if (Interlocked.Exchange(ref _done, 1) == 0) Workflow.Release(); }
    }
}

/// <summary>Small helpers shared by the scheme and NEFT staff endpoints.</summary>
internal static class SchemeRows
{
    /// <summary>Only the named columns of a row (the procedures select whole Msme / FinancialAssistance rows).</summary>
    public static Dictionary<string, object?> Pick(IDictionary<string, object?> row, IEnumerable<string> columns)
    {
        var result = new Dictionary<string, object?>();
        foreach (var c in columns)
            result[c] = row.TryGetValue(c, out var v) && v is not null and not DBNull ? v : null;
        return result;
    }

    public static int? Int(IDictionary<string, object?> row, string column) =>
        int.TryParse(row.Text(column), NumberStyles.Integer, CultureInfo.InvariantCulture, out var i) ? i : null;

    public static decimal? Decimal(IDictionary<string, object?> row, string column) =>
        decimal.TryParse(row.Text(column), NumberStyles.Number, CultureInfo.InvariantCulture, out var d) ? d : null;

    public static bool Same(string? a, string? b) =>
        !string.IsNullOrWhiteSpace(a) && string.Equals(a.Trim(), b?.Trim(), StringComparison.OrdinalIgnoreCase);

    /// <summary>Free text from a reviewer: trimmed, control characters (other than new lines) removed, length capped.</summary>
    public static string? CleanText(string? value, int max)
    {
        if (value is null) return null;
        var s = new string(value.Where(c => !char.IsControl(c) || c is '\n' or '\r' or '\t').ToArray()).Trim();
        return s.Length == 0 ? null : s.Length <= max ? s : null;
    }

    /// <summary>ZED IDs are letters and digits (ZEDMSME000123); anything else is refused before reaching SQL or a path.</summary>
    public static bool IsZedId(string? value) =>
        !string.IsNullOrEmpty(value) && value.Length <= 50 && value.All(char.IsAsciiLetterOrDigit);

    /// <summary>
    /// Records a reviewer's action in MsmeHistory (the procedures of this workflow record nothing about who
    /// acted). Inline SQL because no procedure exists for it; a failure is logged, not shown.
    /// </summary>
    public static async Task AuditAsync(ISqlExecutor db, ILogger log, string zedId, string? certification, string description, CancellationToken ct)
    {
        log.LogInformation("Scheme audit {ZedId}/{Certification}: {Description}", zedId, certification, description);
        try
        {
            await db.ExecuteSqlAsync(
                "INSERT INTO MsmeHistory (ZedId, Descrip, CreatedDate, CertificationType, StatusType) VALUES (@ZedId, @Descrip, GETDATE(), @CertificationType, @StatusType)",
                new { ZedId = zedId, Descrip = description.Length > 2000 ? description[..2000] : description, CertificationType = certification, StatusType = "StaffAction" }, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Could not record the audit entry for {ZedId}", zedId);
        }
    }
}

/// <summary>
/// Sends the workflow e-mails (port of the SendMail methods of FinancialAssistanceController and
/// NeftController). Values are HTML-encoded by Razor; the legacy views inserted them as is, and the
/// assessor allocation mail included the assessor's password, which is no longer sent.
/// A mail failure never undoes or fails the action that triggered it.
/// </summary>
internal sealed class SchemeMailer(
    ISqlExecutor db, IEmailSender email, IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal, IOptions<EmailOptions> emailOptions, ILogger log)
{
    public string PublicBaseUrl => portal.Value.PublicBaseUrl;

    /// <summary>SP_EMAIL_GET_DETAILS_FA: MSME, agency and assessor contacts of the latest FA application.</summary>
    public async Task<IDictionary<string, object?>?> DetailsAsync(string zedId, string certification, CancellationToken ct)
    {
        try
        {
            return (await db.QueryProcMultipleAsync("SP_EMAIL_GET_DETAILS_FA", new { ZedId = zedId, Certification = certification }, ct))[0].FirstOrDefault();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "SP_EMAIL_GET_DETAILS_FA failed for {ZedId}/{Certification}", zedId, certification);
            return null;
        }
    }

    public async Task SendAsync<TComponent>(string? to, string subject, Dictionary<string, object?> parameters, CancellationToken ct)
        where TComponent : IComponent
    {
        if (string.IsNullOrWhiteSpace(to))
        {
            log.LogWarning("No recipient for '{Subject}'; mail not sent", subject);
            return;
        }
        try
        {
            parameters["PublicBaseUrl"] = portal.Value.PublicBaseUrl;
            var html = await templates.RenderAsync<TComponent>(parameters);
            var cc = emailOptions.Value.RegistrationCc is { Length: > 0 } c ? new[] { c } : null;
            await email.SendAsync(new EmailMessage(to.Trim(), subject, html, EmailProfiles.Default, cc), ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Mail '{Subject}' to {To} failed", subject, to);
        }
    }
}
