using System.Collections.Concurrent;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Jobs;

namespace Zed.Jobs.Tests;

public sealed class JobScheduleTests
{
    private static JobDefinition Daily(params string[] times) => new() { Name = "J", Procedure = "SP_JOB_X", DailyAt = [.. times], Enabled = true };

    [Fact]
    public void A_daily_job_is_due_once_its_time_has_passed_and_not_again_the_same_day()
    {
        var job = Daily("02:00", "14:30");
        var at = new DateTime(2026, 10, 21, 14, 31, 0);
        Assert.Equal(new DateTime(2026, 10, 21, 14, 30, 0), JobSchedule.LatestOccurrence(job, at));
        Assert.True(JobSchedule.IsDue(job, at, lastStartLocal: new DateTime(2026, 10, 21, 2, 0, 5)));
        Assert.False(JobSchedule.IsDue(job, at, lastStartLocal: new DateTime(2026, 10, 21, 14, 30, 10)));
        // Before 02:00 the latest occurrence is yesterday's 14:30.
        Assert.Equal(new DateTime(2026, 10, 20, 14, 30, 0), JobSchedule.LatestOccurrence(job, new DateTime(2026, 10, 21, 1, 0, 0)));
    }

    [Fact]
    public void An_interval_job_runs_on_the_interval_from_midnight()
    {
        var job = new JobDefinition { Name = "J", Procedure = "SP_X", EveryMinutes = 15, Enabled = true };
        Assert.Equal(new DateTime(2026, 10, 21, 10, 45, 0), JobSchedule.LatestOccurrence(job, new DateTime(2026, 10, 21, 10, 59, 59)));
        Assert.False(JobSchedule.IsDue(job, new DateTime(2026, 10, 21, 10, 59, 0), new DateTime(2026, 10, 21, 10, 45, 1)));
        Assert.True(JobSchedule.IsDue(job, new DateTime(2026, 10, 21, 11, 0, 0), new DateTime(2026, 10, 21, 10, 45, 1)));
    }

    [Theory]
    [InlineData("SP_X; DROP TABLE Users", "02:00", null)]
    [InlineData("SP_X", "25:00", null)]
    [InlineData("SP_X", null, null)]
    [InlineData("SP_X", "02:00", 10)]
    [InlineData("SP_X", null, 0)]
    public void Bad_job_definitions_are_refused(string procedure, string? time, int? every)
    {
        var job = new JobDefinition { Name = "J", Procedure = procedure, DailyAt = time is null ? [] : [time], EveryMinutes = every, Enabled = true };
        Assert.NotEmpty(JobSchedule.Validate(job));
    }

    [Fact]
    public void The_shipped_schedules_are_valid_once_given_a_time()
    {
        var options = new ConfigurationBuilder()
            .AddJsonFile(Path.Combine(AppContext.BaseDirectory, "appsettings.json"))
            .Build().GetSection(JobsOptions.Section).Get<JobsOptions>()!;
        Assert.NotEmpty(options.Schedules);
        Assert.All(options.Schedules, j => Assert.False(j.Enabled));
        // The production Agent jobs (export of 2026-10-21) carry their own times; the others are given one.
        Assert.Contains(options.Schedules, j => j.Name == "AutoReject" && j.Steps.Count == 2 && j.Steps[0].RetryAttempts == 2);
        Assert.All(options.Schedules.Where(j => j.Note?.Contains("SQL Agent job") == true), j => Assert.True(j.DailyAt.Count > 0 || j.EveryMinutes is not null, j.Name));
        Assert.DoesNotContain(options.Schedules, j => JobSchedule.Calls(j).Any(c => c.Procedure == "SP_JOB_TO_CREATE_RENAMING_BATCH_FILES"));
        Assert.All(options.Schedules, j =>
        {
            if (j.DailyAt.Count == 0 && j.EveryMinutes is null) j.DailyAt = ["02:00"];
            j.Enabled = true;
            Assert.Empty(JobSchedule.Validate(j));
        });
    }
}

public sealed class MailOutboxTests
{
    private sealed class FakeDb : ISqlExecutor
    {
        public List<OutboxMail> Pending { get; } = [];
        public List<EmailTemplateOverride> Templates { get; } = [];
        public ConcurrentQueue<(string Sql, object? Args)> Executed { get; } = new();

        public Task<IReadOnlyList<T>> QuerySqlAsync<T>(string sql, object? parameters = null, CancellationToken ct = default)
        {
            if (sql == MailOutboxSender.TemplatesSql) return Task.FromResult<IReadOnlyList<T>>(Templates.Cast<T>().ToList());
            var batch = Pending.Cast<T>().ToList();
            Pending.Clear();
            return Task.FromResult<IReadOnlyList<T>>(batch);
        }

        public Task<int> ExecuteSqlAsync(string sql, object? parameters = null, CancellationToken ct = default)
        {
            Executed.Enqueue((sql, parameters));
            return Task.FromResult(1);
        }

        public Task<IReadOnlyList<T>> QueryProcAsync<T>(string procedure, object? parameters = null, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ResultSets> QueryProcMultipleAsync(string procedure, object? parameters = null, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<int> ExecuteProcAsync(string procedure, object? parameters = null, CancellationToken ct = default) => throw new NotSupportedException();
    }

    private sealed class Databases(Dictionary<string, ISqlExecutor> dbs) : IJobDatabases
    {
        public IReadOnlyList<string> Names => dbs.Keys.ToList();
        public ISqlExecutor this[string name] => dbs[name];
    }

    private sealed class FakeEmail : IEmailSender
    {
        public List<EmailMessage> Sent { get; } = [];
        public Func<EmailMessage, bool> Fail { get; set; } = _ => false;

        public Task SendAsync(EmailMessage message, CancellationToken ct = default)
        {
            if (Fail(message)) throw new InvalidOperationException("SMTP said no");
            Sent.Add(message);
            return Task.CompletedTask;
        }
    }

    [Fact]
    public async Task Queued_mail_from_every_database_is_sent_and_marked()
    {
        var main = new FakeDb();
        main.Pending.Add(new OutboxMail(1, "ZedAdmin", "a@x.test;b@x.test", null, null, "Allotted", "<b>Hi</b>", "HTML", 1));
        var surv = new FakeDb();
        surv.Pending.Add(new OutboxMail(7, null, "c@x.test", "d@x.test", null, "Plain", "1 < 2\nline", "TEXT", 1));
        var email = new FakeEmail();
        var sender = new MailOutboxSender(new Databases(new() { ["Main"] = main, ["Surveillance"] = surv }), email,
            Options.Create(new JobsOptions()), NullLogger<MailOutboxSender>.Instance);

        Assert.Equal(2, await sender.SendBatchAsync(CancellationToken.None));
        var html = email.Sent.Single(m => m.Subject == "Allotted");
        Assert.Equal("a@x.test;b@x.test", html.To);
        Assert.Equal("<b>Hi</b>", html.HtmlBody);
        Assert.Equal(EmailProfiles.Default, html.Profile);
        var text = email.Sent.Single(m => m.Subject == "Plain");
        Assert.Contains("1 &lt; 2", text.HtmlBody);
        Assert.Equal(["d@x.test"], text.Cc!);
        Assert.Contains(main.Executed, e => e.Sql == MailOutboxSender.SentSql);
        Assert.Contains(surv.Executed, e => e.Sql == MailOutboxSender.SentSql);
    }

    [Fact]
    public async Task A_failed_send_is_recorded_and_left_for_a_retry()
    {
        var main = new FakeDb();
        main.Pending.Add(new OutboxMail(3, "ZedAdmin", "a@x.test", null, null, "S", "B", "HTML", 2));
        var email = new FakeEmail { Fail = _ => true };
        var sender = new MailOutboxSender(new Databases(new() { ["Main"] = main }), email,
            Options.Create(new JobsOptions()), NullLogger<MailOutboxSender>.Instance);

        Assert.Equal(0, await sender.SendBatchAsync(CancellationToken.None));
        var (sql, args) = Assert.Single(main.Executed);
        Assert.Equal(MailOutboxSender.FailedSql, sql);
        Assert.Equal("SMTP said no", args!.GetType().GetProperty("Error")!.GetValue(args));
    }

    [Fact]
    public void Admin_email_settings_copy_every_database_mail_and_redirect_the_status_report()
    {
        var settings = new Dictionary<string, string>
        {
            [EmailAddresses.DbMailBcc] = "monitor@zed.test",
            [EmailAddresses.DbReportRecipients] = "reports@zed.test; head@zed.test",
        };
        var report = MailOutboxSender.ToMessage(
            new OutboxMail(1, "ZedAdmin", "keerthisreenu@gmail.com;ks@geostat.in", null, null, "Daily Skill Express Status Report", "<b>r</b>", "HTML", 1),
            new JobsOptions(), settings);
        Assert.Equal("reports@zed.test; head@zed.test", report.To);
        Assert.Equal(["monitor@zed.test"], report.Bcc!);

        var other = MailOutboxSender.ToMessage(new OutboxMail(2, "ZedAdmin", "msme@x.test", null, "b@x.test", "S", "B", "HTML", 1), new JobsOptions(), settings);
        Assert.Equal("msme@x.test", other.To);
        Assert.Equal(["b@x.test", "monitor@zed.test"], other.Bcc!);

        // Without settings: as the procedure queued it.
        var plain = MailOutboxSender.ToMessage(new OutboxMail(3, "ZedAdmin", "ks@geostat.in;keerthisreenu@gmail.com", null, null, "S", "B", "HTML", 1), new JobsOptions());
        Assert.Equal("ks@geostat.in;keerthisreenu@gmail.com", plain.To);
        Assert.Null(plain.Bcc);
    }

    [Fact]
    public async Task Email_Templates_switch_a_procedures_mail_off_or_rewrite_it()
    {
        var main = new FakeDb();
        main.Pending.Add(new OutboxMail(1, "ZedAdmin", "a@x.test", null, null, "Reminder", "<p>Apply</p>", "HTML", 1, "SP_JOB_TO_SEND_APPLY_FOR_SURVEILLANCE_MAIL_REM1"));
        main.Pending.Add(new OutboxMail(2, "ZedAdmin", "b@x.test", null, null, "Allotted", "<p>Agency</p>", "HTML", 1, "SP_SEND_MAIL_AUTO_ALLOT_AGENCY"));
        main.Pending.Add(new OutboxMail(3, "ZedAdmin", "c@x.test", null, null, "Other", "1 < 2", "TEXT", 1, "SP_SEND_MAIL_STATUS_COUNTS_AGENCY"));
        main.Pending.Add(new OutboxMail(4, "ZedAdmin", "d@x.test", null, null, "Untagged", "<p>Old</p>", "HTML", 1));
        main.Templates.Add(new EmailTemplateOverride("db:SP_JOB_TO_SEND_APPLY_FOR_SURVEILLANCE_MAIL_REM1", false, null, null, "ADMIN1", null));
        main.Templates.Add(new EmailTemplateOverride("db:SP_SEND_MAIL_AUTO_ALLOT_AGENCY", true, "ZED: {{StandardSubject}}", "<h1>Note</h1>{{StandardBody}}", "ADMIN1", null));
        main.Templates.Add(new EmailTemplateOverride("db:SP_SEND_MAIL_STATUS_COUNTS_AGENCY", true, null, "<div>{{StandardBody}}</div>", "ADMIN1", null));
        var email = new FakeEmail();
        var sender = new MailOutboxSender(new Databases(new() { ["Main"] = main }), email,
            Options.Create(new JobsOptions()), NullLogger<MailOutboxSender>.Instance);

        Assert.Equal(3, await sender.SendBatchAsync(CancellationToken.None));
        Assert.DoesNotContain(email.Sent, m => m.To == "a@x.test");
        Assert.Contains(main.Executed, e => e.Sql == MailOutboxSender.SkippedSql && Equals(e.Args!.GetType().GetProperty("Id")!.GetValue(e.Args), 1L));
        var allotted = email.Sent.Single(m => m.To == "b@x.test");
        Assert.Equal("ZED: Allotted", allotted.Subject);
        Assert.Equal("<h1>Note</h1><p>Agency</p>", allotted.HtmlBody);
        var text = email.Sent.Single(m => m.To == "c@x.test");
        Assert.Equal("Other", text.Subject);
        Assert.StartsWith("<div><pre", text.HtmlBody);
        Assert.Contains("1 &lt; 2", text.HtmlBody);
        Assert.Equal("<p>Old</p>", email.Sent.Single(m => m.To == "d@x.test").HtmlBody);
    }

    [Fact]
    public void The_claim_takes_only_unsent_mail_and_skips_rows_locked_by_another_instance()
    {
        Assert.Contains("SentAt IS NULL", MailOutboxSender.ClaimSql);
        Assert.Contains("READPAST", MailOutboxSender.ClaimSql);
        Assert.Contains("Attempts < @MaxAttempts", MailOutboxSender.ClaimSql);
    }
}
