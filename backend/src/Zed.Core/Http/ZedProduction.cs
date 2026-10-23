using System.Runtime.InteropServices;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Hosting;
using Zed.Core.Data;

namespace Zed.Core.Http;

/// <summary>What a production server needs beyond the development defaults (docs/CUTOVER.md).</summary>
public static class ZedProduction
{
    public const string KeysPathSetting = "DataProtection:KeysPath";
    public const string CacheTableSetting = "Cache:SqlServerTable";

    /// <summary>
    /// Sign-in cookies and anti-forgery tokens are protected with Data Protection keys. Without a key folder the
    /// keys live in the app pool's profile (or only in memory), so a recycle or a second server signs everyone out.
    /// The application name keeps the systems apart: a main cookie cannot be replayed on Consultancy.
    /// </summary>
    public static IServiceCollection AddZedDataProtection(this IServiceCollection services, IConfiguration config, string applicationName)
    {
        var dp = services.AddDataProtection().SetApplicationName(applicationName);
        if (config[KeysPathSetting] is { Length: > 0 } path)
        {
            dp.PersistKeysToFileSystem(new DirectoryInfo(path));
            // Keys at rest are encrypted for the machine; the folder ACL limits who can read them.
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows) && config.GetValue("DataProtection:ProtectWithDpapi", true))
                dp.ProtectKeysWithDpapi(protectToLocalMachine: true);
        }
        return services;
    }

    /// <summary>
    /// Registration sessions and payment order state use the distributed cache. In memory on one server;
    /// <c>Cache:SqlServerTable</c> (e.g. <c>dbo.V4Cache</c>, migration 0006) shares it between servers.
    /// </summary>
    public static IServiceCollection AddZedDistributedCache(this IServiceCollection services, IConfiguration config, string defaultDatabase)
    {
        if (config[CacheTableSetting] is { Length: > 0 } table)
        {
            var parts = table.Split('.', 2);
            services.AddDistributedSqlServerCache(o =>
            {
                o.ConnectionString = config.RequireConnectionString(defaultDatabase);
                o.SchemaName = parts.Length == 2 ? parts[0] : "dbo";
                o.TableName = parts.Length == 2 ? parts[1] : parts[0];
            });
        }
        else
        {
            services.AddDistributedMemoryCache();
        }
        return services;
    }

    /// <summary>Stops a non-development host at startup when required settings are missing, listing all of them.</summary>
    public static void EnsureZedConfiguration(this WebApplicationBuilder builder, PortalSystem system, ZedHostKind kind)
    {
        if (builder.Environment.IsDevelopment()) return;
        var problems = ZedConfigurationCheck.Problems(builder.Configuration, builder.Environment, system, kind);
        if (problems.Count > 0)
            throw new InvalidOperationException(
                $"The {system} {(kind == ZedHostKind.Mobile ? "mobile API" : "portal")} cannot start in {builder.Environment.EnvironmentName}: " +
                "settings are missing or wrong (set them as environment variables, e.g. ConnectionStrings__Main):" +
                Environment.NewLine + string.Join(Environment.NewLine, problems.Select(p => " - " + p)));
    }
}

public enum ZedHostKind { Portal, Mobile }

public static class ZedConfigurationCheck
{
    /// <summary>The live portal's host, the shipped default of the Portal addresses.</summary>
    public const string LiveHost = "loginzed.msme.gov.in";

    private static string? DefaultFor(string key) => key switch
    {
        "Portal:PublicBaseUrl" => new PortalOptions().PublicBaseUrl,
        "Portal:LegacyBaseUrl" => new PortalOptions().LegacyBaseUrl,
        _ => null,
    };

    public static IReadOnlyList<string> Problems(IConfiguration config, IHostEnvironment env, PortalSystem system, ZedHostKind kind)
    {
        var problems = new List<string>();
        void Require(string key, string? why = null)
        {
            if (string.IsNullOrWhiteSpace(config[key])) problems.Add(why is null ? $"{key} is not set" : $"{key} is not set ({why})");
        }
        void Folder(string key, string? fallback = null, bool optional = false)
        {
            var value = config[key];
            if (string.IsNullOrWhiteSpace(value)) value = fallback;
            if (string.IsNullOrWhiteSpace(value))
            {
                if (!optional) problems.Add($"{key} is not set");
                return;
            }
            var full = Path.GetFullPath(Path.IsPathRooted(value) ? value : Path.Combine(env.ContentRootPath, value));
            if (!Directory.Exists(full)) problems.Add($"{key}: folder {full} does not exist");
        }

        var database = new PortalHost(system).Database;
        Require($"ConnectionStrings:{database}");
        // Staging runs on copies of production data: no mail to real people, and never a staging setting in Production.
        problems.AddRange(Zed.Core.Email.MailSafety.Problems(config, env));
        problems.AddRange(ZedDatabaseNames.Problems(config, env));
        // The shipped defaults are the live addresses: a test environment must set its own, or its mail links and
        // "open in the old portal" links would send testers (and their actions) to the live site.
        if (!env.IsProduction())
            foreach (var key in new[] { "Portal:PublicBaseUrl", "Portal:LegacyBaseUrl" })
                if (Uri.TryCreate(config[key] ?? DefaultFor(key), UriKind.Absolute, out var u) && u.Host.Equals(LiveHost, StringComparison.OrdinalIgnoreCase))
                    problems.Add($"{key} points at the live site ({LiveHost}): set this environment's own address");

        if (kind == ZedHostKind.Mobile)
        {
            Folder("Mobile:StorageRoot", "App_Data/mobile-storage");
            return problems;
        }

        // Features that read the other systems' data (reports, certificates, main's units).
        if (system == PortalSystem.Main)
        {
            Require($"ConnectionStrings:{ZedDatabases.Consultancy}", "read-only, milestone reports");
            Require($"ConnectionStrings:{ZedDatabases.Surveillance}", "read-only, surveillance reports and certificates");
        }
        else
        {
            Require($"ConnectionStrings:{ZedDatabases.Main}");
        }

        if (!Uri.TryCreate(config["Portal:PublicBaseUrl"], UriKind.Absolute, out var publicUrl) || publicUrl.Scheme != Uri.UriSchemeHttps)
            problems.Add("Portal:PublicBaseUrl must be the https address of this portal (used in mail links)");
        Folder("Portal:StorageRoot", "App_Data/storage");
        Folder("Portal:AssessmentStorageRoot", optional: true);
        Folder("Consultancy:SharedStorageRoot", optional: true);
        Folder(ZedProduction.KeysPathSetting);

        if (!string.IsNullOrWhiteSpace(config["Email:PickupDirectory"]))
        {
            if (env.IsProduction()) problems.Add("Email:PickupDirectory is set: mail would be written to files, not sent");
        }
        else
        {
            Require("Email:Profiles:Default:Host");
            Require("Email:Profiles:Default:From");
        }

        if (config.GetValue("Recaptcha:Enabled", true))
        {
            Require("Recaptcha:SiteKey");
            Require("Recaptcha:SecretKey");
        }

        if (config.GetValue<bool>("Erp:Enabled"))
            foreach (var k in new[] { "TenantId", "ClientId", "ClientSecret", "CompanyBaseUrl" }) Require("Erp:" + k, "Erp:Enabled is true");

        if (system == PortalSystem.Main)
        {
            foreach (var k in new[] { "MerchantId", "AccessCode", "WorkingKey", "ReconciliationWorkingKey" }) Require("CcAvenue:" + k);
            if (env.IsProduction() && (config["CcAvenue:GatewayUrl"] ?? "").Contains("test.ccavenue.com", StringComparison.OrdinalIgnoreCase))
                problems.Add("CcAvenue:GatewayUrl points at the CCAvenue test gateway");
            Require("Udyam:AccessKey", "Udyam registration lookups");
            if (config.GetValue("Recaptcha:Enabled", true))
                Require("Recaptcha:AppSecretKey", "MSME app registration captcha, the Android reCAPTCHA key");
            foreach (var k in new[] { "Url", "UserId", "Password" }) Require("ProteanGstin:" + k, "GSTIN check at payment");
            if (config.GetValue<bool>("UdyamiBharat:Enabled"))
                foreach (var k in new[] { "TokenUrl", "VerifyUrl", "ClientId", "ClientSecret" }) Require("UdyamiBharat:" + k, "UdyamiBharat:Enabled is true");
        }
        return problems;
    }
}

/// <summary>Readiness: one cheap query on the host's own database. The response says only Healthy or Unhealthy.</summary>
public sealed class DatabaseHealthCheck(ISqlExecutor db) : IHealthCheck
{
    public const string Tag = "ready";

    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken ct = default)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        try
        {
            await db.QuerySqlAsync<int>("SELECT 1", ct: timeout.Token);
            return HealthCheckResult.Healthy();
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            // The exception goes to the log through the health check publisher, never to the caller.
            return HealthCheckResult.Unhealthy("database unreachable", ex);
        }
    }
}
