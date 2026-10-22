using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Zed.Core.Email;

namespace Zed.Jobs.Tests;

/// <summary>Zed.Jobs refuses to start outside Production without the staging mail rule, and with it in Production (Program.cs).</summary>
public sealed class StagingMailRuleTests
{
    private sealed class Env(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "Zed.Jobs";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    private static IConfiguration Shipped(Dictionary<string, string?>? extra = null) => new ConfigurationBuilder()
        .AddJsonFile(Path.Combine(AppContext.BaseDirectory, "appsettings.json"))
        .AddInMemoryCollection(extra ?? [])
        .Build();

    [Fact]
    public void The_shipped_settings_pass_in_production_and_are_refused_on_staging()
    {
        Assert.Empty(MailSafety.Problems(Shipped(), new Env("Production")));
        Assert.Contains(MailSafety.Problems(Shipped(), new Env("Staging")), p => p.StartsWith("Email:RedirectAllTo or Email:AllowedRecipientDomains"));
        Assert.Empty(MailSafety.Problems(Shipped(), new Env("Development")));
    }

    [Fact]
    public void Staging_runs_with_a_redirect_and_production_refuses_it()
    {
        var staging = Shipped(new() { ["Email:RedirectAllTo"] = "testers@qcin.org" });
        Assert.Empty(MailSafety.Problems(staging, new Env("Staging")));
        Assert.Contains(MailSafety.Problems(staging, new Env("Production")), p => p.StartsWith("Email:RedirectAllTo is set"));
        Assert.Empty(MailSafety.Problems(Shipped(new() { ["Email:AllowedRecipientDomains"] = "qcin.org" }), new Env("Staging")));
    }
}
