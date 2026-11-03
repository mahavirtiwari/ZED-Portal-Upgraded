using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.SubUsers;
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
/// <see cref="PasswordStore"/> (Security:Passwords) and ends the account's sessions (<see cref="SessionStamps"/>).
/// </para>
/// <para>
/// New staff accounts and sub-users get a link of the same kind in their welcome mail, valid 24 hours, instead of a password
/// (<see cref="NewSetPasswordUrlAsync"/>, <see cref="StaffWelcomeLogin"/>); a sub-user's link sets its dbo.V4SubUsers hash.
/// </para>
/// </summary>
public sealed class StaffPasswordResets(
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
    public const string InvalidLink = PasswordResetTokens.InvalidLink;
    public const string ManagedByMain = "This account's password is managed on the main ZED portal. Please reset it there.";

    private readonly ILogger audit = loggers.CreateLogger(AuditCategory);

    public StaffPasswordResetOptions Options => StaffPasswordResetOptions.Read(config);

    /// <param name="SubUser">A sub-user (dbo.V4SubUsers) whose set-password link this is (<see cref="NewSetPasswordUrlAsync"/>).</param>
    public sealed record Account(string UserId, string UserName, int RoleId, string? Email, bool IsActive, bool SubUser = false);

    /// <summary>Result of an administrator's request: <see cref="Error"/> is null on success.</summary>
    public sealed record AdminResult(string? Message, string? Error, bool NotFound = false);

    // ------------------------------------------------------------------ Self-service

    /// <summary>
    /// "Forgot password?" (runs in the background; every outcome is only written to the audit log). <paramref name="onlyRoleId"/>:
    /// only an account of that Users.RoleId (the site assessor app's request, <c>AssessorAppController</c>).
    /// </summary>
    public async Task RequestAsync(string typedUserId, string? ip, CancellationToken ct, int? onlyRoleId = null)
    {
        var o = Options;
        var userId = Clean(typedUserId);
        if (!o.Enabled) { Audit("refused (switched off)", userId, ip); return; }

        var account = await FindAccountAsync(userId, ct);
        if (account is null) { Audit("no staff account", userId, ip); return; }
        if (onlyRoleId is { } role && account.RoleId != role) { Audit($"role {account.RoleId} refused (role {role} only here)", account.UserId, ip); return; }
        if (!account.IsActive) { Audit("account blocked", account.UserId, ip); return; }
        if (o.ExcludedRoleIds.Contains(account.RoleId)) { Audit($"role {account.RoleId} excluded from self-service", account.UserId, ip); return; }
        if (MailAddress(account) is not { } to) { Audit("no valid e-mail address", account.UserId, ip); return; }

        if (await PasswordStore.For(db, services).IsManagedByMainAsync(account.UserId, ct))
        {
            await SendMainPortalHintAsync(account, to, ip, ct);
            return;
        }

        var token = PasswordResetTokens.NewToken();
        if (!await CreateAsync(account.UserId, token, o, requestedBy: null, ip, ct))
        {
            Audit($"refused (more than {o.MaxRequestsPerHour} requests in an hour)", account.UserId, ip);
            return;
        }
        await SendLinkAsync(account, to, token, o, sentBy: null, ct);
        Audit("link sent", account.UserId, ip);
    }

    /// <summary>The account of an open link (a Users row, else a sub-user's set-password link), or null.</summary>
    public async Task<Account?> FindByTokenAsync(string? token, CancellationToken ct)
    {
        if (!IsToken(token)) return null;
        var row = (await db.QueryProcMultipleAsync("SP_V4_STAFF_RESET_FIND", new { TokenHash = HashToken(token!) }, ct))[0].FirstOrDefault();
        return row is not null ? ToAccount(row, active: true) : await FindSubUserByTokenAsync(token!, ct);
    }

    /// <summary>Sets the new password through an open link; returns an error message or null.</summary>
    public async Task<string?> ResetAsync(string? token, string newPassword, string? ip, CancellationToken ct)
    {
        var account = await FindByTokenAsync(token, ct);
        if (account is null) return InvalidLink;
        if (account.SubUser) return await ResetSubUserAsync(account, token!, newPassword, ip, ct);

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
        // M12: the account's sessions (on main also those of the Surveillance portal) end with the old password.
        await SessionStamps.EndSessionsAsync(db, host.System, user.UserId, audit, ct);
        await SendPasswordChangedAsync(user, ct);
        return null;
    }

    private async Task SendPasswordChangedAsync(Account user, CancellationToken ct)
    {
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
                await email.SendAsync(new EmailMessage(to, "New Login Details - " + user.UserName, html, EmailProfiles.Login), ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                audit.LogWarning(ex, "Password of {UserId} reset but the confirmation mail failed", user.UserId);
            }
        }
    }

    // ------------------------------------------------------------------ New accounts (set-password link)

    /// <summary>How long the set-password link of a new staff account works (the longest a link may: 24 hours).</summary>
    public const int SetPasswordValidMinutes = 1440;

    /// <summary>
    /// Whether new staff accounts get a set-password link instead of a password (<see cref="StaffPasswordResetOptions.Enabled"/>).
    /// Off: their welcome mail carries the password, as before.
    /// </summary>
    public bool SetPasswordLinksEnabled => Options.Enabled;

    /// <summary>
    /// A new staff account or sub-user (M2, V4): a one-time link to set its first password, valid
    /// <see cref="SetPasswordValidMinutes"/>, recorded as sent by <paramref name="createdBy"/>, who has just created the
    /// account. Unlike <see cref="SendByAdminAsync"/>, the Master Admin / Super Admin rule (<see cref="StaffPasswordResetOptions.ExcludedRoles"/>)
    /// does not apply. The link's address, or null when it could not be recorded (the mail then points to "Forgot password?").
    /// </summary>
    public async Task<string?> NewSetPasswordUrlAsync(string userId, string createdBy, string? ip, CancellationToken ct)
    {
        try
        {
            var token = PasswordResetTokens.NewToken();
            if (!await PasswordResetTokens.CreateAsync(db, userId, token, SetPasswordValidMinutes, 1, createdBy, ip, ct)) return null;
            audit.LogInformation("Staff password reset: set-password link for the new account {UserId} created by {Actor} from {Ip}", userId, createdBy, ip);
            return ResetUrl(token);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            audit.LogError(ex, "Set-password link for the new account {UserId} could not be created", userId);
            return null;
        }
    }

    /// <summary>A sub-user's open link (dbo.V4PasswordResets, the sub-user active), as SP_V4_STAFF_RESET_FIND for Users.</summary>
    internal const string FindSubUserSql =
        "SELECT TOP (1) S.UserId, S.UserName, S.Email FROM dbo.V4PasswordResets R " +
        "JOIN dbo.V4SubUsers S ON S.UserId = R.UserId AND S.IsActive = 1 " +
        "WHERE R.TokenHash = @TokenHash AND R.UsedAt IS NULL AND R.InvalidatedAt IS NULL AND R.ExpiresAt > SYSUTCDATETIME();";

    /// <summary>Uses a sub-user's open link, as SP_V4_STAFF_RESET_USE: marks it used (once) and closes its other links.</summary>
    internal const string UseSubUserSql =
        "SET NOCOUNT ON; SET XACT_ABORT ON; " +
        "DECLARE @Now datetime2(0) = SYSUTCDATETIME(); DECLARE @Used TABLE (UserId varchar(50)); " +
        "BEGIN TRAN; " +
        "UPDATE R SET UsedAt = @Now OUTPUT inserted.UserId INTO @Used FROM dbo.V4PasswordResets R WITH (UPDLOCK, HOLDLOCK) " +
        "WHERE R.TokenHash = @TokenHash AND R.UsedAt IS NULL AND R.InvalidatedAt IS NULL AND R.ExpiresAt > @Now " +
        "AND EXISTS (SELECT 1 FROM dbo.V4SubUsers S WHERE S.UserId = R.UserId AND S.IsActive = 1); " +
        "UPDATE R SET InvalidatedAt = @Now FROM dbo.V4PasswordResets R JOIN @Used U ON U.UserId = R.UserId " +
        "WHERE R.UsedAt IS NULL AND R.InvalidatedAt IS NULL; " +
        "COMMIT; " +
        "SELECT TOP (1) UserId FROM @Used;";

    public sealed record SubUserLink(string UserId, string? UserName, string? Email);

    private async Task<Account?> FindSubUserByTokenAsync(string token, CancellationToken ct)
    {
        try
        {
            var row = (await db.QuerySqlAsync<SubUserLink>(FindSubUserSql, new { TokenHash = HashToken(token) }, ct)).FirstOrDefault();
            return row is null ? null : new Account(row.UserId, row.UserName ?? row.UserId, 0, row.Email, true, SubUser: true);
        }
        catch (Microsoft.Data.SqlClient.SqlException ex)
        {
            audit.LogWarning(ex, "Sub-user reset links not read (is migration 0012 applied?)");
            return null;
        }
    }

    /// <summary>A sub-user sets its password through its link: the hash in dbo.V4SubUsers, which also ends its sessions.</summary>
    private async Task<string?> ResetSubUserAsync(Account account, string token, string newPassword, string? ip, CancellationToken ct)
    {
        // Marks the link used first, so it can set a password once only.
        var used = (await db.QuerySqlAsync<string>(UseSubUserSql, new { TokenHash = HashToken(token) }, ct)).FirstOrDefault();
        if (used is null || !string.Equals(used, account.UserId, StringComparison.OrdinalIgnoreCase)) return InvalidLink;
        await services.GetRequiredService<SubUserStore>().SetPasswordAsync(account.UserId, PasswordStore.Hash(newPassword), account.UserId, ct);
        Audit("password set (sub-user)", account.UserId, ip);
        await SendPasswordChangedAsync(account, ct);
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

        var token = PasswordResetTokens.NewToken();
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

    public static byte[] HashToken(string token) => PasswordResetTokens.Hash(token);

    public static bool IsToken(string? token) => PasswordResetTokens.IsToken(token);

    private async Task<Account?> FindAccountAsync(string userId, CancellationToken ct)
    {
        if (userId.Length == 0) return null;
        var row = (await db.QueryProcMultipleAsync("SP_V4_STAFF_RESET_ACCOUNT", new { UserId = userId }, ct))[0].FirstOrDefault();
        return row is null ? null : ToAccount(row, active: StaffUserRules.Bool(row, "IsActive"));
    }

    private Task<bool> CreateAsync(string userId, string token, StaffPasswordResetOptions o, string? requestedBy, string? ip, CancellationToken ct) =>
        PasswordResetTokens.CreateAsync(db, userId, token, o.ValidMinutes, o.MaxRequestsPerHour, requestedBy, ip, ct);

    private async Task SendLinkAsync(Account account, string to, string token, StaffPasswordResetOptions o, string? sentBy, CancellationToken ct)
    {
        var url = ResetUrl(token);
        var html = await templates.RenderAsync<StaffPasswordResetEmail>(new Dictionary<string, object?>
        {
            [nameof(StaffPasswordResetEmail.UserName)] = account.UserName,
            [nameof(StaffPasswordResetEmail.UserId)] = account.UserId,
            [nameof(StaffPasswordResetEmail.ResetUrl)] = url,
            [nameof(StaffPasswordResetEmail.ValidMinutes)] = Math.Clamp(o.ValidMinutes, 1, 1440),
            [nameof(StaffPasswordResetEmail.SentBy)] = sentBy,
            [nameof(StaffPasswordResetEmail.PublicBaseUrl)] = portal.Value.PublicBaseUrl,
        });
        await email.SendAsync(new EmailMessage(to, "ZED Password Reset - " + account.UserId, html, EmailProfiles.Login), ct);
    }

    /// <summary>The staff reset page. The token is in the fragment: browsers do not send it to the server, so it stays out of IIS logs and referrers.</summary>
    private string ResetUrl(string token) => $"{portal.Value.PublicBaseUrl.TrimEnd('/')}/reset-password#token={token}";

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
        await email.SendAsync(new EmailMessage(to, "ZED Password Reset - " + account.UserId, html, EmailProfiles.Login), ct);
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

}
