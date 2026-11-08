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
/// <param name="environment">Nothing is sent unless the service's environment was set on purpose (<see cref="JobsEnvironment"/>).</param>
public sealed class MailOutboxSender(IJobDatabases databases, IEmailSender email, IOptions<JobsOptions> options, ILogger<MailOutboxSender> log,
    JobsEnvironment environment)
{
    // Claims a batch; a claim older than 10 minutes (crash, or a failed attempt) is taken again. Each mail's claim is
    // renewed just before it is sent (RenewSql), so a slow batch does not let another instance take it meanwhile.
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

    /// <summary>Renews this run's claim just before sending: no row when another instance claimed the mail since (its
    /// claim raised Attempts) or it was sent.</summary>
    internal const string RenewSql = "UPDATE dbo.V4MailOutbox SET ClaimedAt = SYSDATETIME() WHERE Id = @Id AND SentAt IS NULL AND Attempts = @Attempts";

    internal const string NoReportRecipientsSql =
        "UPDATE dbo.V4MailOutbox SET SentAt = SYSDATETIME(), LastError = 'Not sent: no Daily status report recipients in Email Settings' WHERE Id = @Id";

    /// <summary>Mails sent whose "sent" mark failed (database, mail Id): never sent again by this service; marked at the
    /// next run.</summary>
    private readonly HashSet<(string Database, long Id)> sentNotMarked = [];

    private bool refusalLogged;

    /// <summary>Sends one batch from every database; returns how many were sent.</summary>
    public async Task<int> SendBatchAsync(CancellationToken ct)
    {
        if (!environment.IsExplicit)
        {
            if (!refusalLogged)
                log.LogError("The mail outbox sends nothing: no environment is set for Zed.Jobs (neither {Dotnet} nor {AspNetCore}, nor {CommandLine}), " +
                    "so .NET runs it as Production and its mails would reach real people, also on a test server with a copy of production data. " +
                    "Set DOTNET_ENVIRONMENT in the service's environment (Production on the live server; the test server's value there: docs/JOBS.md) " +
                    "and restart the service. The queued mail waits in dbo.V4MailOutbox; the other jobs run",
                    JobsEnvironment.DotnetVariable, JobsEnvironment.AspNetCoreVariable, JobsEnvironment.CommandLine);
            refusalLogged = true;
            return 0;
        }
        var o = options.Value;
        var sent = 0;
        foreach (var name in databases.Names)
        {
            var db = databases[name];
            if (!await MarkSentAsync(name, db, ct)) continue;
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
            // The Admin's mail server for database mails (module Database, else Default); none: the configured profiles.
            var servers = batch.Count > 0 ? await SqlSmtpServers.ReadAsync(db, log, ct) : [];
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
                    if (IsLegacyStatusReport(mail) && string.IsNullOrWhiteSpace(settings?.GetValueOrDefault(EmailAddresses.DbReportRecipients)))
                    {
                        await db.ExecuteSqlAsync(NoReportRecipientsSql, new { mail.Id }, ct);
                        log.LogWarning("Mail {Id} from {Database} (the daily status report) not sent: no recipients are set in Admin > Settings > " +
                            "Email Settings, Daily status report (the old procedure's fixed addresses are outside addresses and are never used)",
                            mail.Id, name);
                        continue;
                    }
                    var message = ToMessage(mail, o, settings, template) with { Server = SqlSmtpServers.Resolve(servers, EmailProfiles.Database) };
                    if (await db.ExecuteSqlAsync(RenewSql, new { mail.Id, mail.Attempts }, ct) == 0)
                    {
                        log.LogInformation("Mail {Id} from {Database} left alone: another instance has claimed it since, or it was sent", mail.Id, name);
                        continue;
                    }
                    await email.SendAsync(message, ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    var error = ex.Message.Length > 1000 ? ex.Message[..1000] : ex.Message;
                    log.LogWarning(ex, "Mail {Id} from {Database} failed (attempt {Attempt})", mail.Id, name, mail.Attempts);
                    await db.ExecuteSqlAsync(FailedSql, new { mail.Id, Error = error }, ct);
                    continue;
                }
                sent++;
                try
                {
                    await db.ExecuteSqlAsync(SentSql, new { mail.Id }, ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    // Not released for a retry: it went out. It stays claimed and is marked at the next run.
                    sentNotMarked.Add((name, mail.Id));
                    log.LogError(ex, "Mail {Id} from {Database} was sent but could not be marked sent: this service does not send it again " +
                        "and marks it at its next run (if the service restarts before that, set SentAt on that row by hand so it is not sent twice)",
                        mail.Id, name);
                }
            }
        }
        return sent;
    }

    /// <summary>Marks the mails of <paramref name="name"/> that were sent but whose mark failed; false while it still
    /// cannot (that database's outbox then waits for the next run).</summary>
    private async Task<bool> MarkSentAsync(string name, ISqlExecutor db, CancellationToken ct)
    {
        foreach (var key in sentNotMarked.Where(k => k.Database == name).ToList())
        {
            try
            {
                await db.ExecuteSqlAsync(SentSql, new { key.Id }, ct);
                sentNotMarked.Remove(key);
                log.LogInformation("Mail {Id} from {Database}, sent earlier, is now marked sent", key.Id, name);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Mail {Id} from {Database} is still not marked sent; that database's outbox waits for the next run", key.Id, name);
                return false;
            }
        }
        return true;
    }

    /// <summary>The daily status report of SP_SEND_MAIL_STATUS_COUNTS_AGENCY: a mail addressed only to the old procedure's
    /// fixed outside addresses (<see cref="LegacyReportRecipients"/>), which are never mailed.</summary>
    internal static bool IsLegacyStatusReport(OutboxMail mail) =>
        EmailAddresses.Split(mail.Recipients) is { Count: > 0 } to
        && to.All(a => LegacyReportRecipients.Contains(a, StringComparer.OrdinalIgnoreCase));

    /// <summary>Fixed recipients of SP_SEND_MAIL_STATUS_COUNTS_AGENCY (the daily status report) in the old procedure:
    /// outside addresses, replaced by the Admin's "Daily status report" recipients; without those the report is not sent.</summary>
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
        if (IsLegacyStatusReport(mail))
            recipients = settings?.GetValueOrDefault(EmailAddresses.DbReportRecipients) is { } report && !string.IsNullOrWhiteSpace(report)
                ? report
                : throw new InvalidOperationException("The daily status report has no recipients: set them in Email Settings (Daily status report).");
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
            // 2026-11-08: {{To}} and {{ZedId}} (the first ZED ID the procedure's subject or text names).
            var fields = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase) { ["To"] = to, ["ZedId"] = ZedIdIn(subject + " " + (mail.Body ?? "")) };
            if (!string.IsNullOrWhiteSpace(template.Subject)) subject = EmailPlaceholders.Fill(template.Subject, fields, html: false, raw);
            if (!string.IsNullOrWhiteSpace(template.BodyHtml)) body = EmailPlaceholders.Fill(template.BodyHtml, fields, html: true, raw);
        }
        return new EmailMessage(to, subject, body, profile,
            Cc: string.IsNullOrWhiteSpace(mail.CopyRecipients) || ReferenceEquals(to, mail.CopyRecipients) ? null : [mail.CopyRecipients],
            Bcc: Bcc(string.IsNullOrWhiteSpace(mail.BlindCopyRecipients) || ReferenceEquals(to, mail.BlindCopyRecipients) ? null : mail.BlindCopyRecipients,
                settings?.GetValueOrDefault(EmailAddresses.DbMailBcc)));
    }

    /// <summary>The first ZED ID in a text (ZEDMSME000123, ZEDXMSME…, UC3250522285 …), or "".</summary>
    internal static string ZedIdIn(string text) =>
        System.Text.RegularExpressions.Regex.Match(text, @"\b(ZED[A-Z]*\d{3,}|UC\d{6,})\b", System.Text.RegularExpressions.RegexOptions.None, TimeSpan.FromMilliseconds(200)) is { Success: true } m ? m.Value : "";

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
