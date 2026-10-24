using System.Net;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;

namespace Zed.Jobs;

/// <summary>Connection to each served database.</summary>
public interface IJobDatabases
{
    IReadOnlyList<string> Names { get; }
    ISqlExecutor this[string name] { get; }
}

public sealed class JobDatabases : IJobDatabases
{
    private readonly Dictionary<string, ISqlExecutor> executors = new(StringComparer.OrdinalIgnoreCase);

    public JobDatabases(IConfiguration config, IOptions<JobsOptions> options)
    {
        foreach (var name in options.Value.Databases)
            if (config.GetConnectionString(name) is { Length: > 0 } cs)
                executors[name] = new SqlExecutor(cs, options.Value.CommandTimeoutSeconds);
        Names = executors.Keys.ToList();
    }

    public IReadOnlyList<string> Names { get; }

    public ISqlExecutor this[string name] => executors.TryGetValue(name, out var e)
        ? e
        : throw new InvalidOperationException($"ConnectionStrings:{name} is not configured.");
}

/// <param name="Source">The procedure that queued it (migration 0003, current version); null for older rows.</param>
public sealed record OutboxMail(long Id, string? ProfileName, string? Recipients, string? CopyRecipients,
    string? BlindCopyRecipients, string? Subject, string? Body, string? BodyFormat, int Attempts, string? Source = null);

/// <summary>Sends what the procedures queued in dbo.V4MailOutbox through the portal's SMTP settings.</summary>
public sealed class MailOutboxSender(IJobDatabases databases, IEmailSender email, IOptions<JobsOptions> options, ILogger<MailOutboxSender> log)
{
    // Claims a batch; a claim older than 10 minutes (crash, or a failed attempt) is taken again.
    internal const string ClaimSql = """
        UPDATE TOP (@Batch) o SET ClaimedAt = SYSDATETIME(), Attempts = Attempts + 1
        OUTPUT inserted.Id, inserted.ProfileName, inserted.Recipients, inserted.CopyRecipients, inserted.BlindCopyRecipients,
               inserted.Subject, inserted.Body, inserted.BodyFormat, inserted.Attempts, inserted.Source
        FROM dbo.V4MailOutbox o WITH (READPAST, ROWLOCK, UPDLOCK)
        WHERE o.SentAt IS NULL AND o.Attempts < @MaxAttempts
          AND (o.ClaimedAt IS NULL OR o.ClaimedAt < DATEADD(minute, -10, SYSDATETIME()))
        """;

    /// <summary>The claim for an outbox made by an earlier 0003 (no Source column): mails go out as the procedures wrote them.</summary>
    internal static readonly string ClaimSqlWithoutSource = ClaimSql.Replace("inserted.Attempts, inserted.Source", "inserted.Attempts, CAST(NULL AS sysname) AS Source");

    internal const string TemplatesSql =
        "SELECT TemplateKey, Enabled, Subject, BodyHtml, UpdatedBy, UpdatedOn FROM dbo.V4EmailTemplates WHERE TemplateKey LIKE 'db:%';";

    internal const string SkippedSql = "UPDATE dbo.V4MailOutbox SET SentAt = SYSDATETIME(), LastError = 'Not sent: switched off in Email Templates' WHERE Id = @Id";

    /// <summary>Databases whose outbox has no Source column yet (0003 not run again).</summary>
    private readonly HashSet<string> withoutSource = new(StringComparer.OrdinalIgnoreCase);

    internal const string SentSql = "UPDATE dbo.V4MailOutbox SET SentAt = SYSDATETIME(), LastError = NULL WHERE Id = @Id";
    internal const string FailedSql = "UPDATE dbo.V4MailOutbox SET LastError = @Error WHERE Id = @Id";

    /// <summary>Sends one batch from every database; returns how many were sent.</summary>
    public async Task<int> SendBatchAsync(CancellationToken ct)
    {
        var o = options.Value;
        var sent = 0;
        foreach (var name in databases.Names)
        {
            var db = databases[name];
            IReadOnlyList<OutboxMail> batch;
            try
            {
                var args = new { Batch = o.MailBatchSize, MaxAttempts = o.MailMaxAttempts };
                try
                {
                    batch = await db.QuerySqlAsync<OutboxMail>(withoutSource.Contains(name) ? ClaimSqlWithoutSource : ClaimSql, args, ct);
                }
                catch (SqlException ex) when (ex.Number == 207 && !withoutSource.Contains(name))
                {
                    log.LogWarning("The mail outbox of {Database} has no Source column: run migration 0003 again so the Admin's Email Templates apply to database mails", name);
                    withoutSource.Add(name);
                    batch = await db.QuerySqlAsync<OutboxMail>(ClaimSqlWithoutSource, args, ct);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Could not read the mail outbox of {Database}", name);
                continue;
            }
            // The Admin's Email Settings of this database (copy of every mail, report recipients).
            var settings = batch.Count > 0 ? await PortalSettings.ReadAsync(db, log, ct) : null;
            // The Admin's Email Templates for the procedures' mails ("db:<procedure>").
            var templates = batch.Count > 0 ? await ReadTemplatesAsync(db, ct) : null;
            foreach (var mail in batch)
            {
                try
                {
                    var template = mail.Source is { Length: > 0 } src ? templates?.GetValueOrDefault("db:" + src) : null;
                    if (template is { Enabled: false })
                    {
                        await db.ExecuteSqlAsync(SkippedSql, new { mail.Id }, ct);
                        log.LogInformation("Mail {Id} from {Database} ({Source}) not sent: switched off in Email Templates", mail.Id, name, mail.Source);
                        continue;
                    }
                    await email.SendAsync(ToMessage(mail, o, settings, template), ct);
                    await db.ExecuteSqlAsync(SentSql, new { mail.Id }, ct);
                    sent++;
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    var error = ex.Message.Length > 1000 ? ex.Message[..1000] : ex.Message;
                    log.LogWarning(ex, "Mail {Id} from {Database} failed (attempt {Attempt})", mail.Id, name, mail.Attempts);
                    await db.ExecuteSqlAsync(FailedSql, new { mail.Id, Error = error }, ct);
                }
            }
        }
        return sent;
    }

    /// <summary>Fixed recipients of SP_SEND_MAIL_STATUS_COUNTS_AGENCY (the daily status report) in the old procedure.</summary>
    internal static readonly string[] LegacyReportRecipients = ["ks@geostat.in", "keerthisreenu@gmail.com"];

    private async Task<IReadOnlyDictionary<string, EmailTemplateOverride>> ReadTemplatesAsync(ISqlExecutor db, CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<EmailTemplateOverride>(TemplatesSql, null, ct)).ToDictionary(t => t.TemplateKey, StringComparer.OrdinalIgnoreCase);
        }
        catch (SqlException ex)
        {
            log.LogWarning(ex, "Could not read dbo.V4EmailTemplates (is migration 0015 applied?); database mails go out as written");
            return new Dictionary<string, EmailTemplateOverride>();
        }
    }

    /// <param name="template">The Admin's version of this procedure's mail: its subject and body may wrap the standard ones
    /// ({{StandardSubject}}, {{StandardBody}}).</param>
    internal static EmailMessage ToMessage(OutboxMail mail, JobsOptions options, IReadOnlyDictionary<string, string>? settings = null,
        EmailTemplateOverride? template = null)
    {
        var recipients = mail.Recipients;
        if (settings?.GetValueOrDefault(EmailAddresses.DbReportRecipients) is { Length: > 0 } report
            && EmailAddresses.Split(recipients).Order(StringComparer.OrdinalIgnoreCase)
                .SequenceEqual(LegacyReportRecipients.Order(StringComparer.OrdinalIgnoreCase), StringComparer.OrdinalIgnoreCase))
            recipients = report;
        var to = string.IsNullOrWhiteSpace(recipients) ? mail.CopyRecipients ?? mail.BlindCopyRecipients ?? "" : recipients;
        if (string.IsNullOrWhiteSpace(to)) throw new InvalidOperationException("The mail has no recipients.");
        var profile = mail.ProfileName is { Length: > 0 } p && options.MailProfiles.TryGetValue(p, out var mapped) ? mapped : EmailProfiles.Default;
        var body = string.Equals(mail.BodyFormat, "HTML", StringComparison.OrdinalIgnoreCase)
            ? mail.Body ?? ""
            : "<pre style=\"font-family: inherit; white-space: pre-wrap\">" + WebUtility.HtmlEncode(mail.Body ?? "") + "</pre>";
        var subject = mail.Subject ?? "";
        if (template is { Enabled: true })
        {
            var raw = new Dictionary<string, string> { [EmailPlaceholders.StandardSubject] = subject, [EmailPlaceholders.StandardBody] = body };
            var none = new Dictionary<string, object?>();
            if (!string.IsNullOrWhiteSpace(template.Subject)) subject = EmailPlaceholders.Fill(template.Subject, none, html: false, raw);
            if (!string.IsNullOrWhiteSpace(template.BodyHtml)) body = EmailPlaceholders.Fill(template.BodyHtml, none, html: true, raw);
        }
        return new EmailMessage(to, subject, body, profile,
            Cc: string.IsNullOrWhiteSpace(mail.CopyRecipients) || ReferenceEquals(to, mail.CopyRecipients) ? null : [mail.CopyRecipients],
            Bcc: Bcc(string.IsNullOrWhiteSpace(mail.BlindCopyRecipients) || ReferenceEquals(to, mail.BlindCopyRecipients) ? null : mail.BlindCopyRecipients,
                settings?.GetValueOrDefault(EmailAddresses.DbMailBcc)));
    }

    private static IReadOnlyList<string>? Bcc(params string?[] lists)
    {
        var all = lists.Where(l => !string.IsNullOrWhiteSpace(l)).Select(l => l!).ToList();
        return all.Count > 0 ? all : null;
    }
}

public sealed class MailOutboxWorker(MailOutboxSender sender, IOptions<JobsOptions> options, ILogger<MailOutboxWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var delay = TimeSpan.FromSeconds(Math.Max(5, options.Value.MailPollSeconds));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                // Keep going while there is a backlog.
                while (await sender.SendBatchAsync(stoppingToken) >= options.Value.MailBatchSize) { }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Mail outbox run failed");
            }
            await Task.Delay(delay, stoppingToken);
        }
    }
}
