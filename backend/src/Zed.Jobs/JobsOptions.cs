namespace Zed.Jobs;

/// <summary>
/// Replaces SQL Agent and Database Mail, which SQL Server Express does not have: sends the mail the procedures
/// queue in dbo.V4MailOutbox (database/migrations/0003_mail_outbox.sql) and runs the SP_JOB_* / SP_DAILY_*
/// procedures on the schedules the old Agent jobs had.
/// </summary>
public sealed class JobsOptions
{
    public const string Section = "Jobs";

    /// <summary>Databases to serve, by connection string name (ConnectionStrings:Main, ...).</summary>
    public List<string> Databases { get; set; } = ["Main", "Consultancy", "Surveillance"];

    public int MailPollSeconds { get; set; } = 30;
    public int MailBatchSize { get; set; } = 20;

    /// <summary>A mail that failed this many times is left in the outbox with its LastError (retried every 10 minutes until then).</summary>
    public int MailMaxAttempts { get; set; } = 5;

    /// <summary>Database Mail profile name used by the procedures → Email:Profiles entry. Unknown names use Default.</summary>
    public Dictionary<string, string> MailProfiles { get; set; } = new(StringComparer.OrdinalIgnoreCase) { ["ZedAdmin"] = "Default" };

    /// <summary>Time zone the schedules are written in (the old server ran on IST).</summary>
    public string TimeZone { get; set; } = "Asia/Kolkata";

    public int CommandTimeoutSeconds { get; set; } = 1800;

    public List<JobDefinition> Schedules { get; set; } = [];
}

/// <summary>
/// One former SQL Agent job: one procedure (<see cref="Procedure"/>) or several run in order (<see cref="Steps"/>),
/// on a schedule. A schedule is DailyAt or EveryMinutes, optionally limited to DaysOfWeek or DaysOfMonth.
/// </summary>
public sealed class JobDefinition
{
    public string Name { get; set; } = "";

    /// <summary>Connection string name: Main, Consultancy or Surveillance. Also the default for the steps.</summary>
    public string Database { get; set; } = "Main";

    /// <summary>A one-step job's procedure. Leave empty when <see cref="Steps"/> is used.</summary>
    public string Procedure { get; set; } = "";

    /// <summary>Fixed parameter values of <see cref="Procedure"/>, by name (with or without @). Converted to the
    /// procedure's declared types (int, date "yyyy-MM-dd", ...); "{NULL}" passes NULL.</summary>
    public Dictionary<string, string?> Parameters { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Several procedures run in order; the job stops at the first failure (Agent's "quit reporting
    /// failure") unless that step has ContinueOnFailure.</summary>
    public List<JobStep> Steps { get; set; } = [];

    /// <summary>Local times of day, "HH:mm".</summary>
    public List<string> DailyAt { get; set; } = [];

    /// <summary>Alternatively, run every N minutes (1 to 1440), from WindowStart (default midnight) up to WindowEnd.</summary>
    public int? EveryMinutes { get; set; }

    /// <summary>With EveryMinutes: first run of the day, "HH:mm" (Agent's active_start_time). Default 00:00.</summary>
    public string? WindowStart { get; set; }

    /// <summary>With EveryMinutes: no run after this time, "HH:mm" (Agent's active_end_time). Default 23:59.</summary>
    public string? WindowEnd { get; set; }

    /// <summary>Only on these days ("Monday", ...). Empty = every day.</summary>
    public List<string> DaysOfWeek { get; set; } = [];

    /// <summary>Only on these days of the month (1 to 31; a day the month does not have is skipped). Empty = every day.</summary>
    public List<int> DaysOfMonth { get; set; } = [];

    public bool Enabled { get; set; }

    /// <summary>Free text for the people editing the settings (where the entry came from); not used.</summary>
    public string? Note { get; set; }
}

public sealed class JobStep
{
    /// <summary>Connection string name; empty = the job's Database.</summary>
    public string? Database { get; set; }

    public string Procedure { get; set; } = "";

    /// <inheritdoc cref="JobDefinition.Parameters"/>
    public Dictionary<string, string?> Parameters { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Go on with the next step when this one fails (Agent's "go to the next step" on failure).</summary>
    public bool ContinueOnFailure { get; set; }
}
