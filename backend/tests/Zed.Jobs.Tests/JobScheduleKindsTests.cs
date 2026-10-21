using System.Diagnostics;
using Microsoft.Extensions.Configuration;
using Zed.Jobs;

namespace Zed.Jobs.Tests;

public sealed class JobScheduleKindsTests
{
    private static JobDefinition Job(Action<JobDefinition> set)
    {
        var job = new JobDefinition { Name = "J", Procedure = "SP_JOB_X", Enabled = true };
        set(job);
        return job;
    }

    [Fact]
    public void A_weekly_job_runs_only_on_its_days()
    {
        // 2026-10-19 is a Monday.
        var job = Job(j => { j.DailyAt = ["06:00"]; j.DaysOfWeek = ["Monday", "thursday"]; });
        Assert.Empty(JobSchedule.Validate(job));
        Assert.Equal(new DateTime(2026, 10, 19, 6, 0, 0), JobSchedule.LatestOccurrence(job, new DateTime(2026, 10, 21, 12, 0, 0)));
        Assert.Equal(new DateTime(2026, 10, 22, 6, 0, 0), JobSchedule.LatestOccurrence(job, new DateTime(2026, 10, 22, 6, 0, 0)));
        Assert.False(JobSchedule.IsDue(job, new DateTime(2026, 10, 21, 12, 0, 0), new DateTime(2026, 10, 19, 6, 0, 3)));
    }

    [Fact]
    public void A_monthly_job_runs_on_its_day_and_skips_months_without_it()
    {
        var job = Job(j => { j.DailyAt = ["03:00"]; j.DaysOfMonth = [1]; });
        Assert.Equal(new DateTime(2026, 10, 1, 3, 0, 0), JobSchedule.LatestOccurrence(job, new DateTime(2026, 10, 21, 0, 0, 0)));
        var on31 = Job(j => { j.DailyAt = ["03:00"]; j.DaysOfMonth = [31]; });
        // No 31st in November 2026; the latest is 31 October.
        Assert.Equal(new DateTime(2026, 10, 31, 3, 0, 0), JobSchedule.LatestOccurrence(on31, new DateTime(2026, 11, 30, 23, 0, 0)));
    }

    [Fact]
    public void An_interval_job_keeps_to_its_window()
    {
        var job = Job(j => { j.EveryMinutes = 30; j.WindowStart = "08:15"; j.WindowEnd = "20:00"; });
        Assert.Empty(JobSchedule.Validate(job));
        Assert.Equal(new DateTime(2026, 10, 21, 10, 45, 0), JobSchedule.LatestOccurrence(job, new DateTime(2026, 10, 21, 10, 50, 0)));
        // Before the window: yesterday's last run (19:45, the last start not after 20:00).
        Assert.Equal(new DateTime(2026, 10, 20, 19, 45, 0), JobSchedule.LatestOccurrence(job, new DateTime(2026, 10, 21, 7, 0, 0)));
        Assert.Equal(new DateTime(2026, 10, 21, 19, 45, 0), JobSchedule.LatestOccurrence(job, new DateTime(2026, 10, 21, 23, 0, 0)));
        // Every 2 hours (Agent freq_subday_type 8) is EveryMinutes 120.
        var hours = Job(j => j.EveryMinutes = 120);
        Assert.Equal(new DateTime(2026, 10, 21, 22, 0, 0), JobSchedule.LatestOccurrence(hours, new DateTime(2026, 10, 21, 23, 59, 0)));
    }

    [Theory]
    [InlineData("days-both")]
    [InlineData("bad-day")]
    [InlineData("bad-month-day")]
    [InlineData("window-without-interval")]
    [InlineData("window-reversed")]
    [InlineData("bad-window")]
    [InlineData("procedure-and-steps")]
    [InlineData("bad-step")]
    [InlineData("bad-parameter-name")]
    public void Bad_new_settings_are_refused(string kind)
    {
        var job = Job(j =>
        {
            j.DailyAt = ["02:00"];
            switch (kind)
            {
                case "days-both": j.DaysOfWeek = ["Monday"]; j.DaysOfMonth = [1]; break;
                case "bad-day": j.DaysOfWeek = ["Mondy"]; break;
                case "bad-month-day": j.DaysOfMonth = [32]; break;
                case "window-without-interval": j.WindowStart = "08:00"; break;
                case "window-reversed": j.DailyAt = []; j.EveryMinutes = 10; j.WindowStart = "20:00"; j.WindowEnd = "08:00"; break;
                case "bad-window": j.DailyAt = []; j.EveryMinutes = 10; j.WindowEnd = "8pm"; break;
                case "procedure-and-steps": j.Steps = [new JobStep { Procedure = "SP_Y" }]; break;
                case "bad-step": j.Procedure = ""; j.Steps = [new JobStep { Procedure = "SP_Y;DROP" }]; break;
                case "bad-parameter-name": j.Parameters["State Name"] = "x"; break;
            }
        });
        Assert.NotEmpty(JobSchedule.Validate(job));
    }

    [Fact]
    public void Steps_take_the_jobs_database_unless_they_name_one()
    {
        var job = Job(j =>
        {
            j.Procedure = "";
            j.Database = "Surveillance";
            j.DailyAt = ["06:00"];
            j.Steps = [new JobStep { Procedure = "SP_A" }, new JobStep { Database = "Main", Procedure = "SP_B", ContinueOnFailure = true }];
        });
        Assert.Empty(JobSchedule.Validate(job));
        var calls = JobSchedule.Calls(job);
        Assert.Equal([("Surveillance", "SP_A", false), ("Main", "SP_B", true)], calls.Select(c => (c.Database, c.Procedure, c.ContinueOnFailure)));
        var single = JobSchedule.Calls(Job(j => j.Parameters["StateName"] = "ASSAM"));
        Assert.Equal("ASSAM", Assert.Single(single).Parameters["StateName"]);
    }

    [Fact]
    public void Retries_are_kept_per_step_and_checked()
    {
        var job = Job(j =>
        {
            j.Procedure = "";
            j.DailyAt = ["00:00"];
            j.Steps = [new JobStep { Procedure = "SP_A", RetryAttempts = 2, RetryIntervalMinutes = 30 }, new JobStep { Database = "Surveillance", Procedure = "SP_A" }];
        });
        Assert.Empty(JobSchedule.Validate(job));
        Assert.Equal([(2, 30), (0, 0)], JobSchedule.Calls(job).Select(c => (c.RetryAttempts, c.RetryIntervalMinutes)));

        var single = Job(j => { j.RetryAttempts = 2; j.RetryIntervalMinutes = 30; });
        Assert.Equal((2, 30), JobSchedule.Calls(single).Select(c => (c.RetryAttempts, c.RetryIntervalMinutes)).Single());

        Assert.Empty(JobSchedule.Validate(Job(j => { j.DailyAt = ["00:00"]; j.RetryAttempts = 10; j.RetryIntervalMinutes = 1440; })));
        Assert.Contains(JobSchedule.Validate(Job(j => { j.DailyAt = ["00:00"]; j.RetryAttempts = 11; })), e => e.Contains("RetryAttempts"));
        Assert.Contains(JobSchedule.Validate(Job(j => { j.DailyAt = ["00:00"]; j.RetryIntervalMinutes = -1; })), e => e.Contains("RetryIntervalMinutes"));
        Assert.Contains(JobSchedule.Validate(Job(j => { j.DailyAt = ["00:00"]; j.Procedure = ""; j.Steps = [new JobStep { Procedure = "SP_A", RetryIntervalMinutes = 2000 }]; })),
            e => e.Contains("RetryIntervalMinutes"));
    }

    [Fact]
    public void The_old_settings_format_binds_and_new_options_bind_from_json()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Jobs:Schedules:0:Name"] = "Old",
            ["Jobs:Schedules:0:Procedure"] = "SP_JOB_X",
            ["Jobs:Schedules:0:DailyAt:0"] = "02:00",
            ["Jobs:Schedules:1:Name"] = "New",
            ["Jobs:Schedules:1:Database"] = "Surveillance",
            ["Jobs:Schedules:1:Steps:0:Procedure"] = "SP_APPLY",
            ["Jobs:Schedules:1:Steps:0:Parameters:StateName"] = "ASSAM",
            ["Jobs:Schedules:1:EveryMinutes"] = "60",
            ["Jobs:Schedules:1:WindowStart"] = "06:00",
            ["Jobs:Schedules:1:DaysOfWeek:0"] = "Friday",
        }).Build();
        var o = config.GetSection(JobsOptions.Section).Get<JobsOptions>()!;
        Assert.All(o.Schedules, j => Assert.Empty(JobSchedule.Validate(j)));
        Assert.Equal("ASSAM", o.Schedules[1].Steps[0].Parameters["StateName"]);
        Assert.Equal("every 60 min 06:00-23:59 on Friday", JobSchedule.Describe(o.Schedules[1]));
    }
}

public sealed class ProcedureChecksTests
{
    [Fact]
    public void Defaults_are_read_from_the_header_ignoring_comments_and_execute_as()
    {
        const string definition = """
            -- EXEC SP_X @StateName = 'ASSAM'  (example call, not a default)
            CREATE PROCEDURE [dbo].[SP_X]
                @StateName varchar(100),          /* no default = here */
                @District  varchar(100) = NULL,
                @Days      int = 7, @Note nvarchar(50) = N'a=b, @Fake',
                @Result    int OUTPUT
            WITH EXECUTE AS OWNER
            AS
            BEGIN
                SET @Result = 1; DECLARE @x int = 5;
            END
            """;
        var names = new[] { "@StateName", "@District", "@Days", "@Note", "@Result" };
        var withDefault = ProcedureHeader.ParametersWithDefault(definition, names);
        Assert.Equal(["@Days", "@District", "@Note"], withDefault.Order(StringComparer.Ordinal));
    }

    [Theory]
    [InlineData("int", 4, "42", 42)]
    [InlineData("bit", 1, "true", true)]
    [InlineData("varchar", 100, "ASSAM", "ASSAM")]
    [InlineData("nvarchar", -1, "long text", "long text")]
    public void Values_are_converted_to_the_declared_type(string type, int maxLength, string value, object expected)
    {
        Assert.True(ParameterValues.TryConvert(new ProcedureParameter("P", type, maxLength, false, false, false), value, out var converted, out _));
        Assert.Equal(expected, converted);
    }

    [Fact]
    public void Dates_nulls_and_bad_values()
    {
        var date = new ProcedureParameter("D", "date", 3, false, false, false);
        Assert.True(ParameterValues.TryConvert(date, "2026-10-01", out var d, out _));
        Assert.Equal(new DateTime(2026, 10, 1), d);
        Assert.True(ParameterValues.TryConvert(date, ParameterValues.Null, out var n, out _));
        Assert.Equal(DBNull.Value, n);
        Assert.False(ParameterValues.TryConvert(date, "01/10/2026", out _, out _));
        Assert.False(ParameterValues.TryConvert(new ProcedureParameter("I", "int", 4, false, false, false), "seven", out _, out _));
        Assert.False(ParameterValues.TryConvert(new ProcedureParameter("S", "varchar", 3, false, false, false), "ASSAM", out _, out _));
        Assert.False(ParameterValues.TryConvert(new ProcedureParameter("X", "xml", -1, false, false, false), "<a/>", out _, out _));
    }

    private sealed class FakeCatalog : IProcedureCatalog
    {
        public Dictionary<string, ProcedureInfo> Procedures { get; } = new(StringComparer.OrdinalIgnoreCase);
        public HashSet<string> Down { get; } = new(StringComparer.OrdinalIgnoreCase);

        public Task<ProcedureInfo?> GetAsync(string database, string procedure, CancellationToken ct)
        {
            if (Down.Contains(database)) throw new InvalidOperationException("network error");
            return Task.FromResult(Procedures.GetValueOrDefault(database + "." + procedure));
        }
    }

    private sealed class Dbs : IJobDatabases
    {
        public IReadOnlyList<string> Names { get; } = ["Main", "Surveillance"];
        public Zed.Core.Data.ISqlExecutor this[string name] => throw new NotSupportedException();
    }

    private static (JobChecker Checker, FakeCatalog Catalog) Checker()
    {
        var catalog = new FakeCatalog();
        catalog.Procedures["Main.SP_JOB_X"] = new([], true);
        catalog.Procedures["Surveillance.SP_APPLY"] = new(
            [new("StateName", "varchar", 100, false, false, HasDefault: false), new("Limit", "int", 4, false, false, HasDefault: true)], true);
        return (new JobChecker(catalog, new Dbs()), catalog);
    }

    private static JobDefinition Apply(params (string Name, string? Value)[] parameters)
    {
        var job = new JobDefinition { Name = "Apply", Database = "Surveillance", Procedure = "SP_APPLY", DailyAt = ["03:00"], Enabled = true };
        foreach (var (name, value) in parameters) job.Parameters[name] = value;
        return job;
    }

    [Fact]
    public async Task A_job_with_its_required_parameters_is_prepared_with_typed_values()
    {
        var (checker, _) = Checker();
        var check = await checker.CheckAsync(Apply(("@StateName", "ASSAM"), ("Limit", "200")), CancellationToken.None);
        Assert.Equal(JobCheckState.Ok, check.State);
        var call = Assert.Single(check.Calls);
        Assert.Equal([new("StateName", (object)"ASSAM"), new("Limit", 200)], call.Parameters);
    }

    [Fact]
    public async Task Missing_unknown_and_bad_parameters_and_missing_procedures_are_errors()
    {
        var (checker, _) = Checker();
        var missing = await checker.CheckAsync(Apply(), CancellationToken.None);
        Assert.Equal(JobCheckState.Invalid, missing.State);
        Assert.Contains(missing.Errors, e => e.Contains("@StateName (varchar) has no default"));

        var unknown = await checker.CheckAsync(Apply(("StateName", "ASSAM"), ("Stat", "x")), CancellationToken.None);
        Assert.Contains(unknown.Errors, e => e.Contains("has no parameter @Stat"));

        var bad = await checker.CheckAsync(Apply(("StateName", "ASSAM"), ("Limit", "lots")), CancellationToken.None);
        Assert.Contains(bad.Errors, e => e.Contains("@Limit expects a whole number"));

        var nothing = await checker.CheckAsync(new JobDefinition { Name = "N", Procedure = "SP_GONE", DailyAt = ["01:00"], Enabled = true }, CancellationToken.None);
        Assert.Contains(nothing.Errors, e => e.Contains("dbo.SP_GONE does not exist"));

        var noDb = await checker.CheckAsync(new JobDefinition { Name = "C", Database = "Consultancy", Procedure = "SP_X", DailyAt = ["01:00"], Enabled = true }, CancellationToken.None);
        Assert.Contains(noDb.Errors, e => e.Contains("ConnectionStrings:Consultancy is not configured"));
    }

    [Fact]
    public async Task An_unreachable_database_keeps_the_job_for_a_check_at_run_time()
    {
        var (checker, catalog) = Checker();
        catalog.Down.Add("Surveillance");
        var check = await checker.CheckAsync(Apply(("StateName", "ASSAM")), CancellationToken.None);
        Assert.Equal(JobCheckState.Unreachable, check.State);
        Assert.Empty(check.Errors);
        Assert.Empty(check.Calls);
    }

    [Fact]
    public async Task Every_step_of_a_multi_step_job_is_checked()
    {
        var (checker, _) = Checker();
        var job = new JobDefinition
        {
            Name = "Two", Database = "Main", DailyAt = ["01:00"], Enabled = true,
            Steps = [new JobStep { Procedure = "SP_JOB_X" }, new JobStep { Database = "Surveillance", Procedure = "SP_APPLY" }],
        };
        var check = await checker.CheckAsync(job, CancellationToken.None);
        Assert.Contains(check.Errors, e => e.StartsWith("Step 2 (Surveillance.SP_APPLY)") && e.Contains("@StateName"));
        job.Steps[1].Parameters["StateName"] = "ASSAM";
        Assert.Equal(2, (await checker.CheckAsync(job, CancellationToken.None)).Calls.Count);
    }

    [Fact]
    public async Task The_check_report_fails_only_for_enabled_jobs_with_problems()
    {
        var (checker, _) = Checker();
        var disabled = Apply();
        disabled.Enabled = false;
        disabled.DailyAt = [];
        var output = new StringWriter();
        Assert.Equal(0, await checker.ReportAsync([new JobDefinition { Name = "Ok", Procedure = "SP_JOB_X", DailyAt = ["01:00"], Enabled = true }, disabled], output, CancellationToken.None));
        Assert.Contains("(disabled) ERROR", output.ToString());
        Assert.Contains("No problems in enabled jobs.", output.ToString());

        output = new StringWriter();
        Assert.Equal(1, await checker.ReportAsync([Apply()], output, CancellationToken.None));
        Assert.Contains("1 enabled job(s) have problems", output.ToString());
    }
}

/// <summary>Runs tools/jobs/Convert-AgentJobs.ps1 on its sample export and checks the result binds and validates.</summary>
public sealed class AgentJobConverterTests
{
    private static string? RepoRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
            if (File.Exists(Path.Combine(dir.FullName, "tools", "jobs", "Convert-AgentJobs.ps1"))) return dir.FullName;
        return null;
    }

    private static (int ExitCode, string Output, JobsOptions Options) Convert(string root, params string[] samples)
    {
        var dir = Directory.CreateTempSubdirectory("zed-agent-jobs-");
        var outFile = Path.Combine(dir.FullName, "out.json");
        var paths = string.Join(",", samples.Select(s => Path.Combine(root, "tools", "jobs", "sample", s)));
        var psi = new ProcessStartInfo("powershell.exe",
            ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", Path.Combine(root, "tools", "jobs", "Convert-AgentJobs.ps1"),
             "-Path", paths, "-OutFile", outFile, "-Today", "20261021",
             "-CompareSettings", Path.Combine(root, "backend", "src", "Zed.Jobs", "appsettings.json")])
        { RedirectStandardOutput = true, RedirectStandardError = true };
        using var p = Process.Start(psi)!;
        var output = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
        p.WaitForExit();
        Assert.True(File.Exists(outFile), output);
        var options = new ConfigurationBuilder().AddJsonFile(outFile).Build().GetSection(JobsOptions.Section).Get<JobsOptions>()!;
        dir.Delete(recursive: true);
        return (p.ExitCode, output, options);
    }

    [Fact]
    public void The_sample_export_converts_to_valid_schedules_and_reports_the_rest()
    {
        if (!OperatingSystem.IsWindows() || RepoRoot() is not { } root) return;
        var (exit, output, o) = Convert(root, "agent-schedules.csv", "agent-steps.csv");

        Assert.Equal(2, exit);   // 2 = some jobs need a hand-made setup (listed in the report)
        Assert.Equal(11, o.Schedules.Count);
        Assert.All(o.Schedules.Where(j => j.Enabled), j => Assert.Empty(JobSchedule.Validate(j)));
        Assert.All(o.Schedules.Where(j => !j.Enabled && j.DailyAt.Count + (j.EveryMinutes ?? 0) > 0), j => Assert.Empty(JobSchedule.Validate(j)));

        JobDefinition Get(string name) => o.Schedules.Single(j => j.Name == name);
        Assert.Equal(["01:30"], Get("ZED - Update latest certification").DailyAt);
        var reminders = Get("ZED - Surveillance reminder mails");
        Assert.Equal(["09:00", "15:00"], reminders.DailyAt);
        Assert.Equal([false, true, false], reminders.Steps.Select(s => s.ContinueOnFailure));
        var counts = Get("ZED - Agency status counts");
        Assert.Equal((30, "08:00", "20:00", "Main"), (counts.EveryMinutes!.Value, counts.WindowStart, counts.WindowEnd, counts.Database));
        Assert.False(Get("ZED - ERP reconciliation").Enabled);
        Assert.Equal(120, Get("ZED - ERP reconciliation").EveryMinutes);
        var surv = Get("SURV - Insert surveillance data");
        Assert.Equal(["Monday", "Thursday"], surv.DaysOfWeek);
        Assert.All(surv.Steps, s => Assert.Equal("Surveillance", s.Database));
        var bronze = Get("SURV - Bronze by state ASSAM");
        Assert.Equal(("ASSAM", 1), (bronze.Parameters["StateName"], bronze.DaysOfMonth.Single()));
        Assert.Equal(["00:05"], Get("ZED - Website counts").DailyAt);
        Assert.False(Get("ZED - Renaming batch files").Enabled);
        var secret = Get("ZED - ERP push");
        Assert.False(secret.Enabled);
        Assert.StartsWith("<SET-ME", secret.Parameters["ApiKey"]);
        Assert.False(Get("ZED - Manual re-certification").Enabled);
        Assert.False(Get("ZED - Old withdrawal mails").Enabled);

        Assert.Contains("Not converted (4)", output);
        Assert.Contains("'ZED - Cleanup temp': step 1: 2 statements", output);
        Assert.Contains("'ZED - Copy backup files': step 1: CmdExec step", output);
        Assert.Contains("monthly relative", output);
        Assert.Contains("positional or unnamed argument", output);
        Assert.DoesNotContain("sample-not-a-real-key", output);
        Assert.Contains("SP_AUTO_FINAL_REJECT_EXPIRED_NC is listed there but no Agent job runs it", output);
    }

    [Fact]
    public void The_older_single_query_export_converts_too()
    {
        if (!OperatingSystem.IsWindows() || RepoRoot() is not { } root) return;
        var (exit, _, o) = Convert(root, "agent-jobs-joined.csv");
        Assert.Equal(0, exit);
        var job = Assert.Single(o.Schedules);
        Assert.Equal(["SP_JOB_TO_SEND_AUTO_MAIL_FOR_CERTIFICATE_RECERTIFICATION", "SP_JOB_TO_SEND_AUTO_MAIL_FOR_CERTIFICATE_SUSPENSION"], job.Steps.Select(s => s.Procedure));
        Assert.Equal(["09:30"], job.DailyAt);
        Assert.True(job.Enabled);
        Assert.Empty(JobSchedule.Validate(job));
    }
}
