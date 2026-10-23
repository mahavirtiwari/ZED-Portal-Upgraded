using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Jobs;

// Replaces SQL Agent and Database Mail (not in SQL Server Express): sends queued procedure mail and runs
// the former Agent jobs. Runs as a console app or a Windows service (sc.exe create ZedJobs binPath= ...).
// "Zed.Jobs --check" checks every entry of Jobs:Schedules against the databases, prints the result and exits
// (non-zero when an enabled job has a problem); run it before enabling jobs on a server.
var check = args.Contains("--check", StringComparer.OrdinalIgnoreCase);
var builder = Host.CreateApplicationBuilder(args.Where(a => !a.Equals("--check", StringComparison.OrdinalIgnoreCase)).ToArray());
// The outbox worker mails what the procedures queue: outside Production that must not reach real people (staging runs
// on copies of production data), and a staging mail setting must never be active in Production.
// A database prefix (a second, prefixed set of test databases) is refused in Production.
if (MailSafety.Problems(builder.Configuration, builder.Environment).Where(_ => !check)
        .Concat(ZedDatabaseNames.Problems(builder.Configuration, builder.Environment)).ToList() is { Count: > 0 } startProblems)
    throw new InvalidOperationException($"Zed.Jobs cannot start in {builder.Environment.EnvironmentName}:" + Environment.NewLine +
        string.Join(Environment.NewLine, startProblems.Select(p => " - " + p)));
ZedDatabaseNames.Configure(builder.Configuration);
builder.Services.AddWindowsService(o => o.ServiceName = "ZedJobs");

builder.Services.Configure<JobsOptions>(builder.Configuration.GetSection(JobsOptions.Section));
builder.Services.Configure<EmailOptions>(builder.Configuration.GetSection(EmailOptions.Section));
builder.Services.AddSingleton<IEmailSender, SmtpEmailSender>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<IJobDatabases, JobDatabases>();
builder.Services.AddSingleton<IProcedureCatalog, SqlProcedureCatalog>();
builder.Services.AddSingleton<JobChecker>();
builder.Services.AddSingleton<FolderRenameChecker>();
if (!check)
{
    builder.Services.AddSingleton<MailOutboxSender>();
    builder.Services.AddHostedService<MailOutboxWorker>();
    builder.Services.AddHostedService<ProcedureJobWorker>();
    builder.Services.AddSingleton<FolderRenamer>();
    builder.Services.AddHostedService<FolderRenameWorker>();
}

var host = builder.Build();
if (check)
{
    var jobs = host.Services.GetRequiredService<IOptions<JobsOptions>>().Value;
    var code = await host.Services.GetRequiredService<JobChecker>().ReportAsync(jobs.Schedules, Console.Out, CancellationToken.None);
    var folders = await host.Services.GetRequiredService<FolderRenameChecker>().ReportAsync(jobs.FolderRename, Console.Out, CancellationToken.None);
    return Math.Max(code, folders);
}
host.Run();
return 0;
