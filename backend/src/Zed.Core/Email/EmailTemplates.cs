using System.Collections;
using System.Globalization;
using System.Net;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;
using Zed.Core.Data;

namespace Zed.Core.Email;

/// <summary>
/// The Admin's version of an e-mail (Admin → Email Templates, dbo.V4EmailTemplates, migration 0015): sent or not, and
/// optionally its own subject and HTML body with {{Placeholder}} fields. Key: the Razor template's name for the
/// portal's mails, "db:&lt;procedure&gt;" for the database procedures' mails (sent by Zed.Jobs).
/// </summary>
public sealed record EmailTemplateOverride(string TemplateKey, bool Enabled, string? Subject, string? BodyHtml, string? UpdatedBy, DateTime? UpdatedOn);

public interface IEmailTemplateStore
{
    Task<EmailTemplateOverride?> GetAsync(string key, CancellationToken ct = default);

    Task<IReadOnlyList<EmailTemplateOverride>> ListAsync(CancellationToken ct = default);

    Task SaveAsync(string key, bool enabled, string? subject, string? bodyHtml, string userId, CancellationToken ct = default);

    /// <summary>Back to the standard e-mail (the row is removed).</summary>
    Task ResetAsync(string key, CancellationToken ct = default);
}

public sealed class SqlEmailTemplateStore(ISqlExecutor db, ILogger<SqlEmailTemplateStore> log) : IEmailTemplateStore
{
    internal const string SelectSql = "SELECT TemplateKey, Enabled, Subject, BodyHtml, UpdatedBy, UpdatedOn FROM dbo.V4EmailTemplates;";
    private static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(30);
    private sealed record Cached(IReadOnlyDictionary<string, EmailTemplateOverride> Rows, DateTime Until);
    private volatile Cached? cached;

    public async Task<EmailTemplateOverride?> GetAsync(string key, CancellationToken ct = default) =>
        (await AllAsync(ct)).GetValueOrDefault(key);

    public async Task<IReadOnlyList<EmailTemplateOverride>> ListAsync(CancellationToken ct = default) => (await AllAsync(ct)).Values.ToList();

    public async Task SaveAsync(string key, bool enabled, string? subject, string? bodyHtml, string userId, CancellationToken ct = default)
    {
        await db.ExecuteSqlAsync(
            "MERGE dbo.V4EmailTemplates AS t USING (SELECT @TemplateKey AS TemplateKey) AS s ON t.TemplateKey = s.TemplateKey " +
            "WHEN MATCHED THEN UPDATE SET Enabled = @Enabled, Subject = @Subject, BodyHtml = @BodyHtml, UpdatedBy = @UpdatedBy, UpdatedOn = SYSUTCDATETIME() " +
            "WHEN NOT MATCHED THEN INSERT (TemplateKey, Enabled, Subject, BodyHtml, UpdatedBy) VALUES (@TemplateKey, @Enabled, @Subject, @BodyHtml, @UpdatedBy);",
            new { TemplateKey = key, Enabled = enabled, Subject = Blank(subject), BodyHtml = Blank(bodyHtml), UpdatedBy = userId.Length <= 50 ? userId : userId[..50] }, ct);
        cached = null;
    }

    public async Task ResetAsync(string key, CancellationToken ct = default)
    {
        await db.ExecuteSqlAsync("DELETE FROM dbo.V4EmailTemplates WHERE TemplateKey = @TemplateKey;", new { TemplateKey = key }, ct);
        cached = null;
    }

    private async Task<IReadOnlyDictionary<string, EmailTemplateOverride>> AllAsync(CancellationToken ct)
    {
        if (cached is { } c && c.Until > DateTime.UtcNow) return c.Rows;
        IReadOnlyDictionary<string, EmailTemplateOverride> rows;
        try
        {
            rows = (await db.QuerySqlAsync<EmailTemplateOverride>(SelectSql, null, ct)).ToDictionary(r => r.TemplateKey, StringComparer.OrdinalIgnoreCase);
        }
        catch (SqlException ex)
        {
            log.LogWarning(ex, "Could not read dbo.V4EmailTemplates (is migration 0015 applied?); the standard e-mails are sent.");
            rows = new Dictionary<string, EmailTemplateOverride>();
        }
        cached = new Cached(rows, DateTime.UtcNow + Lifetime);
        return rows;
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}

/// <summary>
/// {{Placeholder}} fields of the Admin's subjects and bodies. A template's parameters are its placeholders;
/// {{StandardBody}} and {{StandardSubject}} give the standard e-mail, so an Admin can add text around it.
/// </summary>
public static partial class EmailPlaceholders
{
    public const string StandardBody = "StandardBody";
    public const string StandardSubject = "StandardSubject";

    [GeneratedRegex(@"\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}")] private static partial Regex Pattern();

    /// <summary>Replaces the placeholders; values are HTML-encoded in a body, plain in a subject. Unknown ones stay empty.</summary>
    public static string Fill(string text, IReadOnlyDictionary<string, object?> values, bool html, IReadOnlyDictionary<string, string>? raw = null) =>
        Pattern().Replace(text, m =>
        {
            var name = m.Groups[1].Value;
            if (raw is not null && raw.TryGetValue(name, out var r)) return r;
            var match = values.FirstOrDefault(v => string.Equals(v.Key, name, StringComparison.OrdinalIgnoreCase));
            var s = Format(match.Value);
            return html ? WebUtility.HtmlEncode(s) : s;
        });

    public static IEnumerable<string> Used(string? text) =>
        text is null ? [] : Pattern().Matches(text).Select(m => m.Groups[1].Value).Distinct(StringComparer.OrdinalIgnoreCase);

    private static string Format(object? value) => value switch
    {
        null => "",
        string s => s,
        bool b => b ? "Yes" : "No",
        DateTime d => d.ToString("dd-MM-yyyy", CultureInfo.InvariantCulture),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        IEnumerable => "",
        _ => value.ToString() ?? "",
    };
}

/// <summary>
/// The template a body was rendered from: <see cref="HtmlTemplateRenderer"/> notes it when it renders a template, and
/// <see cref="TemplatedEmailSender"/> applies the Admin's choice (not sent, own subject) when a message with exactly that
/// body (the same string) goes out. A body changed or wrapped after rendering is sent as it is. Entries go with their body.
/// </summary>
public static class EmailTemplateContext
{
    public sealed record Current(string Key, IReadOnlyDictionary<string, object?> Values, EmailTemplateOverride? Override);

    private static readonly ConditionalWeakTable<string, Current> rendered = new();

    internal static void Note(string body, Current current) => rendered.AddOrUpdate(body, current);

    public static Current? Of(string? body) => body is not null && rendered.TryGetValue(body, out var c) ? c : null;
}

/// <summary>
/// Wraps the SMTP sender (<paramref name="inner"/>): a message rendered from a template the Admin switched off is not sent (logged), and the Admin's
/// subject replaces the standard one.
/// </summary>
public sealed class TemplatedEmailSender(IEmailSender inner, ILogger<TemplatedEmailSender> log) : IEmailSender
{
    public Task SendAsync(EmailMessage message, CancellationToken ct = default)
    {
        var context = EmailTemplateContext.Of(message.HtmlBody);
        if (context?.Override is { } o)
        {
            if (!o.Enabled)
            {
                log.LogInformation("E-mail {Template} not sent: switched off in Email Templates", context.Key);
                return Task.CompletedTask;
            }
            if (!string.IsNullOrWhiteSpace(o.Subject))
                message = message with
                {
                    Subject = EmailPlaceholders.Fill(o.Subject, context.Values, html: false,
                        new Dictionary<string, string> { [EmailPlaceholders.StandardSubject] = message.Subject }),
                };
        }
        return inner.SendAsync(message, ct);
    }
}
