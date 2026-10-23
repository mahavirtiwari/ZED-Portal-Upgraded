using System.Net;
using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;

namespace Zed.Main.Api.Tests;

/// <summary>Startup configuration check, Data Protection keys and health endpoints (docs/CUTOVER.md).</summary>
public sealed class ProductionHostingTests : IDisposable
{
    private readonly string folder = Directory.CreateTempSubdirectory("zed-prod-tests-").FullName;

    public void Dispose()
    {
        try { Directory.Delete(folder, recursive: true); } catch (IOException) { }
    }

    private sealed class Env(string name, string root) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "Zed.Tests";
        public string ContentRootPath { get; set; } = root;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    private Dictionary<string, string?> CompleteMain() => new()
    {
        ["ConnectionStrings:Main"] = "Server=db;Database=ZEDCS_V2_LIVE",
        ["ConnectionStrings:Consultancy"] = "Server=db;Database=ZED_CONSULTANT",
        ["ConnectionStrings:Surveillance"] = "Server=db;Database=ZED_SURVEILLANCE",
        ["Portal:PublicBaseUrl"] = "https://loginzed.msme.gov.in",
        ["Portal:StorageRoot"] = folder,
        ["DataProtection:KeysPath"] = folder,
        ["Email:Profiles:Default:Host"] = "smtp.example.test",
        ["Email:Profiles:Default:From"] = "zed@example.test",
        ["Recaptcha:SiteKey"] = "site",
        ["Recaptcha:SecretKey"] = "secret",
        ["Recaptcha:AppSecretKey"] = "app-secret",
        ["CcAvenue:MerchantId"] = "1",
        ["CcAvenue:AccessCode"] = "a",
        ["CcAvenue:WorkingKey"] = "w",
        ["CcAvenue:ReconciliationWorkingKey"] = "r",
        ["CcAvenue:GatewayUrl"] = "https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction",
        ["Udyam:AccessKey"] = "u",
        ["ProteanGstin:Url"] = "https://gst.example.test",
        ["ProteanGstin:UserId"] = "p",
        ["ProteanGstin:Password"] = "p",
    };

    /// <summary>A complete main configuration for a test environment: its own addresses, not the live site's.</summary>
    private Dictionary<string, string?> StagingMain() => new(CompleteMain())
    {
        ["Portal:PublicBaseUrl"] = "https://zedv3.qci.org.in",
        ["Portal:LegacyBaseUrl"] = "https://zedv3.qci.org.in",
    };

    private IReadOnlyList<string> Check(Dictionary<string, string?> settings, PortalSystem system = PortalSystem.Main,
        ZedHostKind kind = ZedHostKind.Portal, string environment = "Production") =>
        ZedConfigurationCheck.Problems(new ConfigurationBuilder().AddInMemoryCollection(settings).Build(),
            new Env(environment, folder), system, kind);

    [Fact]
    public void Complete_main_configuration_passes()
    {
        Assert.Empty(Check(CompleteMain()));
    }

    [Fact]
    public void Empty_main_configuration_lists_every_missing_setting()
    {
        var problems = string.Join("\n", Check([]));
        foreach (var key in new[]
                 {
                     "ConnectionStrings:Main", "ConnectionStrings:Consultancy", "ConnectionStrings:Surveillance",
                     "DataProtection:KeysPath", "Email:Profiles:Default:Host", "Recaptcha:SecretKey", "Recaptcha:AppSecretKey",
                     "CcAvenue:WorkingKey", "CcAvenue:ReconciliationWorkingKey", "Udyam:AccessKey", "ProteanGstin:Password",
                 })
            Assert.Contains(key, problems);
        // The default storage folder (App_Data/storage under the content root) does not exist here.
        Assert.Contains("Portal:StorageRoot: folder", problems);
    }

    [Fact]
    public void Wrong_values_are_reported()
    {
        var s = CompleteMain();
        s["Portal:PublicBaseUrl"] = "http://loginzed.msme.gov.in";
        s["Portal:StorageRoot"] = Path.Combine(folder, "missing");
        s["CcAvenue:GatewayUrl"] = "https://test.ccavenue.com/transaction/transaction.do";
        s["Erp:Enabled"] = "true";
        var problems = Check(s);
        Assert.Contains(problems, p => p.StartsWith("Portal:PublicBaseUrl"));
        Assert.Contains(problems, p => p.StartsWith("Portal:StorageRoot: folder"));
        Assert.Contains(problems, p => p.Contains("test gateway"));
        Assert.Contains(problems, p => p.StartsWith("Erp:ClientSecret"));
    }

    [Fact]
    public void Mail_pickup_folder_is_refused_in_production_only()
    {
        var s = StagingMain();
        s.Remove("Email:Profiles:Default:Host");
        s.Remove("Email:Profiles:Default:From");
        s["Email:PickupDirectory"] = folder;
        Assert.Contains(Check(new Dictionary<string, string?>(s) { ["Portal:PublicBaseUrl"] = "https://loginzed.msme.gov.in", ["Portal:LegacyBaseUrl"] = null }),
            p => p.StartsWith("Email:PickupDirectory"));
        Assert.Empty(Check(s, environment: "Staging"));
    }

    [Theory]
    [InlineData(ZedHostKind.Portal)]
    [InlineData(ZedHostKind.Mobile)]
    public void Staging_must_not_mail_real_people_and_production_must_not_carry_staging_settings(ZedHostKind kind)
    {
        var s = StagingMain();
        s["Mobile:StorageRoot"] = folder;
        // Staging without any of the three: refused (portal and mobile host).
        Assert.Contains(Check(s, kind: kind, environment: "Staging"), p => p.StartsWith("Email:RedirectAllTo or Email:AllowedRecipientDomains"));
        foreach (var (key, value) in new[] { ("Email:RedirectAllTo", "testers@qcin.org"), ("Email:AllowedRecipientDomains", "qcin.org") })
        {
            var staging = new Dictionary<string, string?>(s) { [key] = value, ["Portal:EnvironmentLabel"] = "STAGING" };
            Assert.Empty(Check(staging, kind: kind, environment: "Staging"));
            // The same settings in Production: refused, label included.
            var live = new Dictionary<string, string?>(s) { [key] = value, ["Portal:EnvironmentLabel"] = "STAGING" };
            var problems = Check(live, kind: kind);
            Assert.Contains(problems, p => p.StartsWith(key + " is set"));
            Assert.Contains(problems, p => p.StartsWith("Portal:EnvironmentLabel is set"));
        }
        Assert.Contains(Check(new Dictionary<string, string?>(s) { ["Email:RedirectAllTo"] = "not an address" }, kind: kind, environment: "Staging"),
            p => p.Contains("is not an e-mail address"));
        // Production with the live addresses and no staging settings passes.
        var live2 = CompleteMain();
        live2["Mobile:StorageRoot"] = folder;
        Assert.Empty(Check(live2, kind: kind));
    }

    [Theory]
    [InlineData(ZedHostKind.Portal)]
    [InlineData(ZedHostKind.Mobile)]
    public void A_test_environment_may_not_point_at_the_live_site(ZedHostKind kind)
    {
        var s = StagingMain();
        s["Mobile:StorageRoot"] = folder;
        s["Email:RedirectAllTo"] = "testers@qcin.org";
        Assert.Empty(Check(s, kind: kind, environment: "Staging"));

        s["Portal:PublicBaseUrl"] = "https://loginzed.msme.gov.in";
        s.Remove("Portal:LegacyBaseUrl"); // the shipped default is the live site too
        var problems = Check(s, kind: kind, environment: "Staging");
        Assert.Contains(problems, p => p.StartsWith("Portal:PublicBaseUrl points at the live site"));
        Assert.Contains(problems, p => p.StartsWith("Portal:LegacyBaseUrl points at the live site"));
    }

    [Theory]
    [InlineData(ZedHostKind.Portal)]
    [InlineData(ZedHostKind.Mobile)]
    public void A_database_prefix_is_for_test_environments_only(ZedHostKind kind)
    {
        var s = StagingMain();
        s["Mobile:StorageRoot"] = folder;
        s["Email:RedirectAllTo"] = "testers@qcin.org";
        s["Database:Prefix"] = "ZEDV4_";
        Assert.Empty(Check(s, kind: kind, environment: "Staging"));
        Assert.Contains(Check(new Dictionary<string, string?>(s) { ["Database:Prefix"] = "ZED V4;" }, kind: kind, environment: "Staging"),
            p => p.StartsWith("Database:Prefix 'ZED V4;'"));

        var live = CompleteMain();
        live["Mobile:StorageRoot"] = folder;
        live["Database:Prefix"] = "ZEDV4_";
        Assert.Contains(Check(live, kind: kind), p => p.StartsWith("Database:Prefix is set"));
    }

    [Fact]
    public void Disabled_recaptcha_needs_no_keys()
    {
        var s = CompleteMain();
        s.Remove("Recaptcha:SiteKey");
        s.Remove("Recaptcha:SecretKey");
        s["Recaptcha:Enabled"] = "false";
        Assert.Empty(Check(s));
    }

    [Fact]
    public void Consultancy_needs_its_own_and_mains_database_but_no_payment_keys()
    {
        var problems = Check(new()
        {
            ["Portal:PublicBaseUrl"] = "https://loginzed.msme.gov.in/Consultancy",
            ["Portal:StorageRoot"] = folder,
            ["DataProtection:KeysPath"] = folder,
            ["Recaptcha:Enabled"] = "false",
            ["Email:Profiles:Default:Host"] = "smtp.example.test",
            ["Email:Profiles:Default:From"] = "zed@example.test",
        }, PortalSystem.Consultancy);
        Assert.Equal(["ConnectionStrings:Consultancy is not set", "ConnectionStrings:Main is not set"], problems);
    }

    [Fact]
    public void Mobile_host_needs_its_database_and_storage_folder()
    {
        Assert.Equal(
            ["ConnectionStrings:Surveillance is not set", $"Mobile:StorageRoot: folder {Path.Combine(folder, "missing")} does not exist"],
            Check(new() { ["Mobile:StorageRoot"] = Path.Combine(folder, "missing") }, PortalSystem.Surveillance, ZedHostKind.Mobile));
        Assert.Empty(Check(new() { ["ConnectionStrings:Main"] = "x", ["Mobile:StorageRoot"] = folder }, PortalSystem.Main, ZedHostKind.Mobile));
    }

    private sealed class ProductionHost : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Production");
            builder.UseSetting("ConnectionStrings:Main", "Server=unused;Database=unused");
        }
    }

    [Fact]
    public void Production_host_with_missing_settings_does_not_start()
    {
        using var host = new ProductionHost();
        var ex = Assert.ThrowsAny<Exception>(() => host.CreateClient());
        var message = ex is InvalidOperationException ? ex.Message : ex.InnerException?.Message ?? ex.Message;
        Assert.Contains("cannot start in Production", message);
        Assert.Contains("CcAvenue:WorkingKey", message);
        Assert.DoesNotContain("ConnectionStrings:Main is not set", message);
    }

    [Fact]
    public async Task Keys_are_written_to_the_configured_folder_and_protected_at_rest()
    {
        using var host = new TestHost().WithWebHostBuilder(b => b.UseSetting(ZedProduction.KeysPathSetting, folder));
        (await host.CreateClient().GetAsync("/api/auth/me")).EnsureSuccessStatusCode();

        var key = Assert.Single(Directory.GetFiles(folder, "key-*.xml"));
        if (OperatingSystem.IsWindows()) Assert.Contains("encryptedSecret", File.ReadAllText(key));
        Assert.Equal("zed.main", host.Services.GetRequiredService<IOptions<DataProtectionOptions>>().Value.ApplicationDiscriminator);
    }

    [Fact]
    public void Systems_sharing_a_key_folder_cannot_read_each_others_payloads()
    {
        IDataProtector Protector(string app)
        {
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { [ZedProduction.KeysPathSetting] = folder }).Build();
            var services = new ServiceCollection().AddZedDataProtection(config, app).BuildServiceProvider();
            return services.GetRequiredService<IDataProtectionProvider>().CreateProtector("cookie");
        }

        var main = Protector("zed.main");
        var payload = main.Protect("signed in");
        Assert.Equal("signed in", Protector("zed.main").Unprotect(payload));
        Assert.ThrowsAny<CryptographicException>(() => Protector("zed.consultancy").Unprotect(payload));
    }

    [Fact]
    public async Task Readiness_checks_the_database_without_revealing_the_error()
    {
        using var ok = new TestHost();
        var live = await ok.CreateClient().GetAsync("/api/health/ready");
        Assert.Equal(HttpStatusCode.OK, live.StatusCode);
        Assert.Equal("Healthy", await live.Content.ReadAsStringAsync());

        using var down = new TestHost().WithWebHostBuilder(b => b.ConfigureServices(s =>
        {
            s.RemoveAll<ISqlExecutor>();
            s.AddSingleton<ISqlExecutor>(new UnreachableSql());
        }));
        var client = down.CreateClient();
        var ready = await client.GetAsync("/api/health/ready");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, ready.StatusCode);
        Assert.Equal("Unhealthy", await ready.Content.ReadAsStringAsync());
        // Liveness does not touch the database.
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/health")).StatusCode);
    }

    private sealed class UnreachableSql : ISqlExecutor
    {
        private static Exception Fail() => new InvalidOperationException("server db-secret-name.example unreachable");
        public Task<IReadOnlyList<T>> QueryProcAsync<T>(string procedure, object? parameters = null, CancellationToken ct = default) => throw Fail();
        public Task<ResultSets> QueryProcMultipleAsync(string procedure, object? parameters = null, CancellationToken ct = default) => throw Fail();
        public Task<int> ExecuteProcAsync(string procedure, object? parameters = null, CancellationToken ct = default) => throw Fail();
        public Task<int> ExecuteSqlAsync(string sql, object? parameters = null, CancellationToken ct = default) => throw Fail();
        public Task<IReadOnlyList<T>> QuerySqlAsync<T>(string sql, object? parameters = null, CancellationToken ct = default) => throw Fail();
    }
}
