using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;
using Zed.Core.Data;

namespace Zed.Core.Email;

/// <summary>A group of mails that can have its own mail server (Admin → Settings → Email Settings).</summary>
public sealed record MailModule(string Key, string Label, string Help);

/// <summary>
/// The modules of Admin → Settings → Email Settings → Mail servers. Their keys are the <see cref="EmailProfiles"/> the
/// mails name; a module without a mail server of its own uses Default.
/// </summary>
public static class MailModules
{
    public static readonly IReadOnlyList<MailModule> All =
    [
        new(EmailProfiles.Default, "Default", "Every mail of a module below that has no mail server of its own, and the other mails."),
        new(EmailProfiles.Registration, "Registration", "MSME registration and pledge certificate mails."),
        new(EmailProfiles.Otp, "OTP", "One-time passwords sent by e-mail (registration)."),
        new(EmailProfiles.Login, "Login details and password reset", "New login details, password reset links and changed passwords (portal and app)."),
        new(EmailProfiles.Payment, "Payment confirmation", "Certification, surveillance and handholding payment confirmations."),
        new(EmailProfiles.DocumentUpload, "Document upload", "Basic information and document upload confirmations sent from the mobile app."),
        new(EmailProfiles.Allocation, "Allotment", "Allotment of desktop, site and surveillance assessments and handholding to agencies and assessors."),
        new(EmailProfiles.Certification, "Certificates and rejections", "Certificates, assessment reports, rejections and handholding milestone completion."),
        new(EmailProfiles.Schemes, "Financial assistance and technology upgradation", "Scheme applications and their verification mails."),
        new(EmailProfiles.Contact, "Contact ZED queries", "The queries sent from the Contact ZED page."),
        new(EmailProfiles.Database, "Database mails", "Mails of the database procedures (allotments, reminders, daily report), sent by the ZED jobs service."),
    ];

    public static MailModule? Find(string? key) => All.FirstOrDefault(m => m.Key.Equals(key, StringComparison.OrdinalIgnoreCase));
}

/// <summary>A row of dbo.V4SmtpServers (migration 0018): the Admin's mail server of one module.</summary>
public sealed record SmtpServerRow(
    string Module, string Host, int Port, bool UseStartTls, string FromAddress, string? UserName, string? PasswordProtected,
    string? UpdatedBy = null, DateTime? UpdatedOn = null)
{
    public SmtpProfile ToProfile(string? password) => new()
    {
        Host = Host, Port = Port, UseStartTls = UseStartTls, From = FromAddress, UserName = UserName, Password = password,
    };
}

/// <summary>
/// The mail passwords in dbo.V4SmtpServers, encrypted with Windows DPAPI for the machine: every application of the server
/// (portals, mobile API, Zed.Jobs) can read them, a copy of the database cannot. On another server they must be entered
/// again.
/// </summary>
public static class SmtpSecret
{
    private const string Prefix = "dpapi1:";
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Zed.V4SmtpServers.Password");

    public static string Protect(string password)
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) throw new PlatformNotSupportedException("Mail passwords can only be saved on Windows.");
        return Prefix + Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(password), Entropy, DataProtectionScope.LocalMachine));
    }

    /// <summary>The password, or null when there is none; throws when it cannot be read on this machine.</summary>
    public static string? Unprotect(string? stored, string module)
    {
        if (string.IsNullOrEmpty(stored)) return null;
        try
        {
            if (!stored.StartsWith(Prefix, StringComparison.Ordinal) || !RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
                throw new CryptographicException("unknown format");
            return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(stored[Prefix.Length..]), Entropy, DataProtectionScope.LocalMachine));
        }
        catch (Exception ex) when (ex is CryptographicException or FormatException or PlatformNotSupportedException)
        {
            throw new InvalidOperationException(
                $"The mail password of the module {module} cannot be read on this server (saved on another server?). Enter it again on Admin → Settings → Email Settings.", ex);
        }
    }
}

/// <summary>The Admin's mail servers per module (dbo.V4SmtpServers of this system's database).</summary>
public interface ISmtpServers
{
    Task<IReadOnlyList<SmtpServerRow>> ListAsync(CancellationToken ct = default);

    /// <summary>The mail server for a mail of <paramref name="profile"/>: its module's, else Default's; null when the Admin set neither.</summary>
    Task<SmtpProfile?> FindAsync(string profile, CancellationToken ct = default);

    /// <summary>
    /// Saves a module's mail server. <paramref name="newPassword"/> null keeps the saved password, "" removes it.
    /// </summary>
    Task SaveAsync(SmtpServerRow row, string? newPassword, string userId, CancellationToken ct = default);

    Task DeleteAsync(string module, CancellationToken ct = default);
}

public sealed class SqlSmtpServers(ISqlExecutor db, ILogger<SqlSmtpServers> log) : ISmtpServers
{
    internal const string SelectSql =
        "SELECT Module, Host, Port, UseStartTls, FromAddress, UserName, PasswordProtected, UpdatedBy, UpdatedOn FROM dbo.V4SmtpServers;";
    private static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(30);
    private sealed record Cached(IReadOnlyList<SmtpServerRow> Rows, DateTime Until);
    private volatile Cached? cached;

    public async Task<IReadOnlyList<SmtpServerRow>> ListAsync(CancellationToken ct = default)
    {
        if (cached is not { } c || c.Until <= DateTime.UtcNow)
        {
            c = new Cached(await ReadAsync(db, log, ct), DateTime.UtcNow + Lifetime);
            cached = c;
        }
        return c.Rows;
    }

    public async Task<SmtpProfile?> FindAsync(string profile, CancellationToken ct = default) => Resolve(await ListAsync(ct), profile);

    public async Task SaveAsync(SmtpServerRow row, string? newPassword, string userId, CancellationToken ct = default)
    {
        var keep = newPassword is null;
        await db.ExecuteSqlAsync(
            "MERGE dbo.V4SmtpServers AS t USING (SELECT @Module AS Module) AS s ON t.Module = s.Module " +
            "WHEN MATCHED THEN UPDATE SET Host = @Host, Port = @Port, UseStartTls = @UseStartTls, FromAddress = @FromAddress, UserName = @UserName, " +
            "PasswordProtected = CASE WHEN @KeepPassword = 1 THEN t.PasswordProtected ELSE @PasswordProtected END, UpdatedBy = @UpdatedBy, UpdatedOn = SYSUTCDATETIME() " +
            "WHEN NOT MATCHED THEN INSERT (Module, Host, Port, UseStartTls, FromAddress, UserName, PasswordProtected, UpdatedBy) " +
            "VALUES (@Module, @Host, @Port, @UseStartTls, @FromAddress, @UserName, @PasswordProtected, @UpdatedBy);",
            new
            {
                row.Module, row.Host, row.Port, row.UseStartTls, row.FromAddress, row.UserName,
                KeepPassword = keep,
                PasswordProtected = string.IsNullOrEmpty(newPassword) ? null : SmtpSecret.Protect(newPassword),
                UpdatedBy = userId.Length <= 50 ? userId : userId[..50],
            }, ct);
        cached = null;
    }

    public async Task DeleteAsync(string module, CancellationToken ct = default)
    {
        await db.ExecuteSqlAsync("DELETE FROM dbo.V4SmtpServers WHERE Module = @Module;", new { Module = module }, ct);
        cached = null;
    }

    /// <summary>All rows of <paramref name="database"/>, none when the table is missing (also used by Zed.Jobs for each database).</summary>
    public static async Task<IReadOnlyList<SmtpServerRow>> ReadAsync(ISqlExecutor database, ILogger log, CancellationToken ct)
    {
        try
        {
            return await database.QuerySqlAsync<SmtpServerRow>(SelectSql, null, ct);
        }
        catch (SqlException ex)
        {
            log.LogWarning(ex, "Could not read dbo.V4SmtpServers (is migration 0018 applied?); the configured mail servers are used");
            return [];
        }
    }

    /// <summary>The row of the mail's module, else Default's, as a profile; null when neither is set.</summary>
    public static SmtpProfile? Resolve(IReadOnlyList<SmtpServerRow> rows, string profile)
    {
        var row = rows.FirstOrDefault(r => r.Module.Equals(profile, StringComparison.OrdinalIgnoreCase))
                  ?? rows.FirstOrDefault(r => r.Module.Equals(EmailProfiles.Default, StringComparison.OrdinalIgnoreCase));
        return row is null || string.IsNullOrWhiteSpace(row.Host) ? null : row.ToProfile(SmtpSecret.Unprotect(row.PasswordProtected, row.Module));
    }
}
