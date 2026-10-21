using System.Net;
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

public sealed record OutboxMail(long Id, string? ProfileName, string? Recipients, string? CopyRecipients,
    string? BlindCopyRecipients, string? Subject, string? Body, string? BodyFormat, int Attempts);

/// <summary>Sends what the procedures queued in dbo.V4MailOutbox through the portal's SMTP settings.</summary>
public sealed class MailOutboxSender(IJobDatabases databases, IEmailSender email, IOptions<JobsOptions> options, ILogger<MailOutboxSender> log)
{
    // Claims a batch; a claim older than 10 minutes (crash, or a failed attempt) is taken again.
    internal const string ClaimSql = """
        UPDATE TOP (@Batch) o SET ClaimedAt = SYSDATETIME(), Attempts = Attempts + 1
        OUTPUT inserted.Id, inserted.ProfileName, inserted.Recipients, inserted.CopyRecipients, inserted.BlindCopyRecipients,
               inserted.Subject, inserted.Body, inserted.BodyFormat, inserted.Attempts
        FROM dbo.V4MailOutbox o WITH (READPAST, ROWLOCK, UPDLOCK)
        WHERE o.SentAt IS NULL AND o.Attempts < @MaxAttempts
          AND (o.ClaimedAt IS NULL OR o.ClaimedAt < DATEADD(minute, -10, SYSDATETIME()))
        """;

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
                batch = await db.QuerySqlAsync<OutboxMail>(ClaimSql, new { Batch = o.MailBatchSize, MaxAttempts = o.MailMaxAttempts }, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Could not read the mail outbox of {Database}", name);
                continue;
            }
            foreach (var mail in batch)
            {
                try
                {
                    await email.SendAsync(ToMessage(mail, o), ct);
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

    internal static EmailMessage ToMessage(OutboxMail mail, JobsOptions options)
    {
        var to = string.IsNullOrWhiteSpace(mail.Recipients) ? mail.CopyRecipients ?? mail.BlindCopyRecipients ?? "" : mail.Recipients;
        if (string.IsNullOrWhiteSpace(to)) throw new InvalidOperationException("The mail has no recipients.");
        var profile = mail.ProfileName is { Length: > 0 } p && options.MailProfiles.TryGetValue(p, out var mapped) ? mapped : EmailProfiles.Default;
        var body = string.Equals(mail.BodyFormat, "HTML", StringComparison.OrdinalIgnoreCase)
            ? mail.Body ?? ""
            : "<pre style=\"font-family: inherit; white-space: pre-wrap\">" + WebUtility.HtmlEncode(mail.Body ?? "") + "</pre>";
        return new EmailMessage(to, mail.Subject ?? "", body, profile,
            Cc: string.IsNullOrWhiteSpace(mail.CopyRecipients) || ReferenceEquals(to, mail.CopyRecipients) ? null : [mail.CopyRecipients],
            Bcc: string.IsNullOrWhiteSpace(mail.BlindCopyRecipients) || ReferenceEquals(to, mail.BlindCopyRecipients) ? null : [mail.BlindCopyRecipients]);
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
