using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Users;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Staff.PasswordReset;

/// <summary>Settings <c>StaffPasswordReset:*</c> (docs/PASSWORDS.md, "Staff password reset"). Read on every call.</summary>
public sealed class StaffPasswordResetOptions
{
    public const string Section = "StaffPasswordReset";

    /// <summary>Off: "Forgot password?" and the administrator links are refused on this portal.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>How long a link works (1 to 1440 minutes).</summary>
    public int ValidMinutes { get; set; } = 30;

    /// <summary>Self-service requests per account and hour; links sent by an administrator are not counted.</summary>
    public int MaxRequestsPerHour { get; set; } = 3;

    /// <summary>
    /// Users.RoleId values (comma-separated) that cannot reset through their e-mail alone: MasterAdmin (7) and
    /// SuperAdmin (10) by default. Another MasterAdmin sends them a link instead.
    /// </summary>
    public string ExcludedRoles { get; set; } = "7,10";

    /// <summary>Surveillance: the main portal's address for accounts whose password main holds; empty = PublicBaseUrl without Portal:PathBase.</summary>
    public string? MainPortalUrl { get; set; }

    public IReadOnlySet<int> ExcludedRoleIds =>
        (ExcludedRoles ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => int.TryParse(s, out var r) ? r : -1).Where(r => r > 0).ToHashSet();

    public static StaffPasswordResetOptions Read(IConfiguration config) =>
        config.GetSection(Section).Get<StaffPasswordResetOptions>() ?? new();
}

/// <summary>
/// Password reset for staff accounts (every Users row that is not an MSME): "Forgot password?" on the staff login of each
/// portal, and links sent by an administrator from the user screens. The old sites had neither.
/// <para>
/// Links carry a 256-bit random token; only its SHA-256 is stored (dbo.V4PasswordResets, migration 0008). A link works
/// once, for <see cref="StaffPasswordResetOptions.ValidMinutes"/>, and stops working when a newer one is sent or another
/// one is used. The self-service request runs in the background, so the answer, and its timing, are the same whether
/// or not the account exists, has an e-mail address, is blocked or excluded. The new password goes through
/// <see cref="PasswordStore"/> (Security:Passwords).
/// </para>
/// </summary>
public sealed partial class StaffPasswordResets(
    ISqlExecutor db,
    IServiceProvider services,
    IConfiguration config,
    PortalHost host,
    IEmailSender email,
    IHtmlTemplateRenderer templates,
    IOptions<PortalOptions> portal,
    IDistributedCache cache,
    ILoggerFactory loggers)
{
    public const string AuditCategory = "Zed.Audit.PasswordReset";
    public const string InvalidLink = "This reset link is invalid, has expired or has already been used. Please request a new one.";
    public const string ManagedByMain = "This account's password is managed on the main ZED portal. Please reset it there.";

    private readonly ILogger audit = loggers.CreateLogger(AuditCategory);

    public StaffPasswordResetOptions Options => StaffPasswordResetOptions.Read(config);

    public sealed record Account(string UserId, string UserName, int RoleId, string? Email, bool IsActive);

    /// <summary>Result of an administrator's request: <see cref="Error"/> is null on success.</summary>
    public sealed record AdminResult(string? Message, string? Error, bool NotFound = false);

    // ------------------------------------------------------------------ Self-service

    /// <summary>"Forgot password?" (runs in the background; every outcome is only written to the audit log).</summary>
    public async Task RequestAsync(string typedUserId, string? ip, CancellationToken ct)
    {
        var o = Options;
        var userId = Clean(typedUserId);
        if (!o.Enabled) { Audit("refused (switched off)", userId, ip); return; }

        var account = await FindAccountAsync(userId, ct);
        if (account is null) { Audit("no staff account", userId, ip); return; }
        if (!account.IsActive) { Audit("account blocked", account.UserId, ip); return; }
        if (o.ExcludedRoleIds.Contains(account.RoleId)) { Audit($"role {account.RoleId} excluded from self-service", account.UserId, ip); return; }
        if (MailAddress(account) is not { } to) { Audit("no valid e-mail address", account.UserId, ip); return; }

        if (await PasswordStore.For(db, services).IsManagedByMainAsync(account.UserId, ct))
        {
            await SendMainPortalHintAsync(account, to, ip, ct);
            return;
        }

        var token = SecureRandom.Token(32);
        if (!await CreateAsync(account.UserId, token, o, requestedBy: null, ip, ct))
        {
            Audit($"refused (more than {o.MaxRequestsPerHour} requests in an hour)", account.UserId, ip);
            return;
        }
        await SendLinkAsync(account, to, token, o, sentBy: null, ct);
        Audit("link sent", account.UserId, ip);
    }

    /// <summary>The account of an open link, or null.</summary>
    public async Task<Account?> FindByTokenAsync(string? token, CancellationToken ct)
    {
        if (!IsToken(token)) return null;
        var row = (await db.QueryProcMultipleAsync("SP_V4_STAFF_RESET_FIND", new { TokenHash = HashToken(token!) }, ct))[0].FirstOrDefault();
        return row is null ? null : ToAccount(row, active: true);
    }

    /// <summary>Sets the new password through an open link; returns an error message or null.</summary>
    public async Task<string?> ResetAsync(string? token, string newPassword, string? ip, CancellationToken ct)
    {
        var account = await FindByTokenAsync(token, ct);
        if (account is null) return InvalidLink;

        var passwords = PasswordStore.For(db, services);
        if (await passwords.IsManagedByMainAsync(account.UserId, ct)) return ManagedByMain;

        // Marks the link used first, so it can set a password once only (and clears the lock-out of failed logins).
        var used = (await db.QueryProcMultipleAsync("SP_V4_STAFF_RESET_USE", new { TokenHash = HashToken(token!) }, ct))[0].FirstOrDefault();
        if (used is null) return InvalidLink;
        var user = ToAccount(used, active: true);

        await passwords.SetAsync(user.UserId, newPassword, ct);
        await db.ExecuteSqlAsync("UPDATE Users SET Password = @Password WHERE UserId = @UserId AND ISNULL(RoleId, 0) <> 5",
            new { Password = passwords.StoredValueFor(newPassword), user.UserId }, ct);
        Audit("password reset", user.UserId, ip);

        if (MailAddress(user) is { } to)
        {
            try
            {
                var html = await templates.RenderAsync<PasswordChangedEmail>(new Dictionary<string, object?>
                {
                    [nameof(PasswordChangedEmail.UserName)] = user.UserName,
                    [nameof(PasswordChangedEmail.UserId)] = user.UserId,
                    [nameof(PasswordChangedEmail.IsMsme)] = false,
                    [nameof(PasswordChangedEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
                });
                await email.SendAsync(new EmailMessage(to, "New Login Details - " + user.UserName, html), ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                audit.LogWarning(ex, "Password of {UserId} reset but the confirmation mail failed", user.UserId);
            }
        }
        return null;
    }

    // ------------------------------------------------------------------ Administrator

    /// <summary>
    /// Sends a reset link to <paramref name="userId"/>'s registered e-mail on behalf of <paramref name="actor"/> (who has
    /// already been checked to manage that user). The administrator never sees or sets the password.
    /// </summary>
    public async Task<AdminResult> SendByAdminAsync(string userId, ZedUser actor, string? ip, CancellationToken ct)
    {
        var o = Options;
        if (!o.Enabled) return new(null, "Password reset is switched off on this portal.");
        var account = await FindAccountAsync(Clean(userId), ct);
        if (account is null) return new(null, "User not found.", NotFound: true);
        if (string.Equals(account.UserId, actor.UserId, StringComparison.OrdinalIgnoreCase))
            return new(null, "Please use Change Password for your own account.");
        if (!account.IsActive) return new(null, "This user is blocked. Unblock the account first.");
        if (o.ExcludedRoleIds.Contains(account.RoleId) && actor.RoleId != (int)UserRole.MasterAdmin)
            return new(null, "Only a MasterAdmin can send a reset link to this account.");
        if (MailAddress(account) is not { } to) return new(null, "This user has no valid registered e-mail address. Update it first.");
        if (await PasswordStore.For(db, services).IsManagedByMainAsync(account.UserId, ct))
            return new(null, "This account's password is managed on the main ZED portal. Send the link from there.");

        var token = SecureRandom.Token(32);
        if (!await CreateAsync(account.UserId, token, o, requestedBy: actor.UserId, ip, ct))
            return new(null, "The reset link could not be created. Please try again.");
        try
        {
            await SendLinkAsync(account, to, token, o, sentBy: actor.UserId, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            audit.LogError(ex, "Reset link for {UserId} requested by {Actor} could not be mailed", account.UserId, actor.UserId);
            return new(null, "The reset link could not be e-mailed. Please try again.");
        }
        audit.LogInformation("Staff password reset: link sent to {UserId} by {Actor} from {Ip}", account.UserId, actor.UserId, ip);
        return new($"A password reset link has been sent to the user's registered e-mail address ({Mask(to)}).", null);
    }

    // ------------------------------------------------------------------ Helpers

    public static byte[] HashToken(string token) => SHA256.HashData(Encoding.ASCII.GetBytes(token));

    /// <summary>A token as <see cref="SecureRandom.Token"/> makes it from 32 bytes (43 URL-safe characters).</summary>
    public static bool IsToken(string? token) => token is not null && TokenPattern().IsMatch(token);

    private async Task<Account?> FindAccountAsync(string userId, CancellationToken ct)
    {
        if (userId.Length == 0) return null;
        var row = (await db.QueryProcMultipleAsync("SP_V4_STAFF_RESET_ACCOUNT", new { UserId = userId }, ct))[0].FirstOrDefault();
        return row is null ? null : ToAccount(row, active: StaffUserRules.Bool(row, "IsActive"));
    }

    private async Task<bool> CreateAsync(string userId, string token, StaffPasswordResetOptions o, string? requestedBy, string? ip, CancellationToken ct)
    {
        var row = (await db.QueryProcMultipleAsync("SP_V4_STAFF_RESET_CREATE", new
        {
            UserId = userId,
            TokenHash = HashToken(token),
            ValidMinutes = Math.Clamp(o.ValidMinutes, 1, 1440),
            MaxPerHour = Math.Max(o.MaxRequestsPerHour, 1),
            RequestedBy = requestedBy,
            RequestIp = ip is { Length: <= 45 } ? ip : null,
        }, ct))[0].FirstOrDefault();
        return row is not null && StaffUserRules.Bool(row, "Created");
    }

    private async Task SendLinkAsync(Account account, string to, string token, StaffPasswordResetOptions o, string? sentBy, CancellationToken ct)
    {
        // The token is in the fragment: browsers do not send it to the server, so it stays out of IIS logs and referrers.
        var url = $"{portal.Value.PublicBaseUrl.TrimEnd('/')}/reset-password#token={token}";
        var html = await templates.RenderAsync<StaffPasswordResetEmail>(new Dictionary<string, object?>
        {
            [nameof(StaffPasswordResetEmail.UserName)] = account.UserName,
            [nameof(StaffPasswordResetEmail.UserId)] = account.UserId,
            [nameof(StaffPasswordResetEmail.ResetUrl)] = url,
            [nameof(StaffPasswordResetEmail.ValidMinutes)] = Math.Clamp(o.ValidMinutes, 1, 1440),
            [nameof(StaffPasswordResetEmail.SentBy)] = sentBy,
            [nameof(StaffPasswordResetEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
        });
        await email.SendAsync(new EmailMessage(to, "ZED Password Reset - " + account.UserId, html), ct);
    }

    /// <summary>Surveillance accounts whose password main holds (#111): a pointer to main's reset, at most every 15 minutes.</summary>
    private async Task SendMainPortalHintAsync(Account account, string to, string? ip, CancellationToken ct)
    {
        var key = "staff-reset-hint:" + host.System + ":" + account.UserId.ToUpperInvariant();
        if (await cache.GetAsync(key, ct) is not null) { Audit("refused (main portal hint sent recently)", account.UserId, ip); return; }
        await cache.SetAsync(key, [1], new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(15) }, ct);

        var html = await templates.RenderAsync<StaffPasswordResetMainPortalEmail>(new Dictionary<string, object?>
        {
            [nameof(StaffPasswordResetMainPortalEmail.UserName)] = account.UserName,
            [nameof(StaffPasswordResetMainPortalEmail.UserId)] = account.UserId,
            [nameof(StaffPasswordResetMainPortalEmail.MainLoginUrl)] = MainPortalUrl().TrimEnd('/') + "/login",
            [nameof(StaffPasswordResetMainPortalEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
        });
        await email.SendAsync(new EmailMessage(to, "ZED Password Reset - " + account.UserId, html), ct);
        Audit("main portal hint sent (password managed on main)", account.UserId, ip);
    }

    private string MainPortalUrl()
    {
        if (Options.MainPortalUrl is { Length: > 0 } configured) return configured;
        var publicUrl = portal.Value.PublicBaseUrl.TrimEnd('/');
        var pathBase = config["Portal:PathBase"]?.TrimEnd('/');
        return pathBase is { Length: > 1 } && publicUrl.EndsWith(pathBase, StringComparison.OrdinalIgnoreCase)
            ? publicUrl[..^pathBase.Length]
            : publicUrl;
    }

    private static Account ToAccount(IDictionary<string, object?> row, bool active) =>
        new(row.Text("UserId"), row.Text("UserName"), int.TryParse(row.Text("RoleId"), out var r) ? r : 0, row.Text("Email"), active);

    private static string? MailAddress(Account a) => a.Email?.Trim() is { } e && StaffUserRules.IsEmail(e) ? e : null;

    private static string Clean(string? typed)
    {
        var id = (typed ?? "").Trim();
        return id.Length is > 0 and <= 50 && !id.Any(char.IsControl) ? id : "";
    }

    private static string Mask(string address)
    {
        var at = address.IndexOf('@');
        return at <= 1 ? "***" + address[Math.Max(at, 0)..] : address[0] + new string('*', Math.Min(at - 1, 6)) + address[at..];
    }

    private void Audit(string outcome, string userId, string? ip) =>
        audit.LogInformation("Staff password reset request for {UserId} from {Ip}: {Outcome}", userId.Length == 0 ? "(invalid)" : userId, ip, outcome);

    [GeneratedRegex("^[A-Za-z0-9_-]{43}$")] private static partial Regex TokenPattern();
}
