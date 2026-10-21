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

/// <summary>One former SQL Agent job: a procedure without parameters, run on a schedule.</summary>
public sealed class JobDefinition
{
    public string Name { get; set; } = "";

    /// <summary>Connection string name: Main, Consultancy or Surveillance.</summary>
    public string Database { get; set; } = "Main";

    public string Procedure { get; set; } = "";

    /// <summary>Local times of day, "HH:mm".</summary>
    public List<string> DailyAt { get; set; } = [];

    /// <summary>Alternatively, run every N minutes (from midnight).</summary>
    public int? EveryMinutes { get; set; }

    public bool Enabled { get; set; }
}
