using Microsoft.Extensions.Options;
using Zed.Core.Email;
using Zed.Jobs;

// Replaces SQL Agent and Database Mail (not in SQL Server Express): sends queued procedure mail and runs
// the former Agent jobs. Runs as a console app or a Windows service (sc.exe create ZedJobs binPath= ...).
// "Zed.Jobs --check" checks every entry of Jobs:Schedules against the databases, prints the result and exits
// (non-zero when an enabled job has a problem); run it before enabling jobs on a server.
var check = args.Contains("--check", StringComparer.OrdinalIgnoreCase);
var builder = Host.CreateApplicationBuilder(args.Where(a => !a.Equals("--check", StringComparison.OrdinalIgnoreCase)).ToArray());
builder.Services.AddWindowsService(o => o.ServiceName = "ZedJobs");

builder.Services.Configure<JobsOptions>(builder.Configuration.GetSection(JobsOptions.Section));
builder.Services.Configure<EmailOptions>(builder.Configuration.GetSection(EmailOptions.Section));
builder.Services.AddSingleton<IEmailSender, SmtpEmailSender>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<IJobDatabases, JobDatabases>();
builder.Services.AddSingleton<IProcedureCatalog, SqlProcedureCatalog>();
builder.Services.AddSingleton<JobChecker>();
if (!check)
{
    builder.Services.AddSingleton<MailOutboxSender>();
    builder.Services.AddHostedService<MailOutboxWorker>();
    builder.Services.AddHostedService<ProcedureJobWorker>();
}

var host = builder.Build();
if (check)
{
    var jobs = host.Services.GetRequiredService<IOptions<JobsOptions>>().Value.Schedules;
    return await host.Services.GetRequiredService<JobChecker>().ReportAsync(jobs, Console.Out, CancellationToken.None);
}
host.Run();
return 0;
