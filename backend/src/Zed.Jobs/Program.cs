using Microsoft.Extensions.Options;
using Zed.Core.Email;
using Zed.Jobs;

// Replaces SQL Agent and Database Mail (not in SQL Server Express): sends queued procedure mail and runs
// the former Agent jobs. Runs as a console app or a Windows service (sc.exe create ZedJobs binPath= ...).
var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddWindowsService(o => o.ServiceName = "ZedJobs");

builder.Services.Configure<JobsOptions>(builder.Configuration.GetSection(JobsOptions.Section));
builder.Services.Configure<EmailOptions>(builder.Configuration.GetSection(EmailOptions.Section));
builder.Services.AddSingleton<IEmailSender, SmtpEmailSender>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<IJobDatabases, JobDatabases>();
builder.Services.AddSingleton<MailOutboxSender>();
builder.Services.AddHostedService<MailOutboxWorker>();
builder.Services.AddHostedService<ProcedureJobWorker>();

var host = builder.Build();
host.Run();
