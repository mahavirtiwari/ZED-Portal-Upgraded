using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Zed.Core.Data;
using Zed.Core.Http;

namespace Zed.Core.Security;

/// <summary>
/// Server-side end of sessions (audit M12): <c>Users.SessionStamp</c> (migration 0040, a column of the legacy table in each
/// of the three databases). Sign-in copies the user's stamp into the cookie (<see cref="ZedClaims.SessionStamp"/>);
/// <see cref="SessionStampValidator"/> compares it on every request and ends the session when it differs. Wherever a
/// user's access changes (password, block, role or sub-roles, deactivation) the portal calls <see cref="BumpAsync"/> or
/// <see cref="EndSessionsAsync"/>, which set a new value: every session of that user, on every server and browser, ends
/// within <see cref="SessionStampValidator.DefaultCacheLifetime"/>.
/// <para>
/// NULL (never changed) and a missing row read as "". Until 0040 is deployed the column does not exist: the statements
/// check for it, so reads give "" and bumps do nothing, without an error (deploy order).
/// </para>
/// </summary>
public static class SessionStamps
{
    /// <summary>One user's stamp (parameter <c>@UserId</c>): always one row, NULL when there is none or before 0040.</summary>
    public const string SelectSql =
        "DECLARE @Stamp varchar(36); " +
        "IF COL_LENGTH('dbo.Users', 'SessionStamp') IS NOT NULL " +
        "EXEC sp_executesql N'SELECT TOP (1) @Stamp = CONVERT(varchar(36), SessionStamp) FROM dbo.Users WHERE UserId = @UserId " +
        "ORDER BY CASE WHEN IsActive = 1 THEN 0 ELSE 1 END, Id DESC;', " +
        "N'@UserId varchar(50), @Stamp varchar(36) OUTPUT', @UserId = @UserId, @Stamp = @Stamp OUTPUT; " +
        "SELECT @Stamp AS SessionStamp;";

    /// <summary>A new stamp for every row of <c>@UserId</c> (one value: a UserId can appear more than once in Users).</summary>
    public const string BumpSql =
        "DECLARE @Stamp uniqueidentifier = NEWID(); " +
        "IF COL_LENGTH('dbo.Users', 'SessionStamp') IS NOT NULL " +
        "EXEC sp_executesql N'UPDATE dbo.Users SET SessionStamp = @Stamp WHERE UserId = @UserId;', " +
        "N'@UserId varchar(50), @Stamp uniqueidentifier', @UserId = @UserId, @Stamp = @Stamp;";

    /// <summary>
    /// A new stamp for the assessors (and Consultancy technical experts) an agency created: main's and ZED_CONSULTANT's
    /// SP_UPDATE_USER copy the agency's verification types (their sub-roles) to them.
    /// </summary>
    public const string BumpAssessorsSql =
        "DECLARE @Stamp uniqueidentifier = NEWID(); " +
        "IF COL_LENGTH('dbo.Users', 'SessionStamp') IS NOT NULL " +
        "EXEC sp_executesql N'UPDATE dbo.Users SET SessionStamp = @Stamp WHERE CreatedBy = @UserId AND RoleId IN (3, 33);', " +
        "N'@UserId varchar(50), @Stamp uniqueidentifier', @UserId = @UserId, @Stamp = @Stamp;";

    /// <summary>
    /// Main host: the same for the account's copy in ZED_SURVEILLANCE. Main's procedures write the agencies' and assessors'
    /// rows there too (SP_INSERT_USER / SP_UPDATE_USER / SP_BLOCK_UNBLOCK_USER) and, after the switch to hashed passwords,
    /// the Surveillance portal signs them in with main's password (PasswordStore).
    /// </summary>
    public const string BumpSurveillanceCopySql =
        "DECLARE @Stamp uniqueidentifier = NEWID(); " +
        "IF EXISTS (SELECT 1 FROM ZED_SURVEILLANCE.sys.columns WHERE object_id = OBJECT_ID('ZED_SURVEILLANCE.dbo.Users') AND name = 'SessionStamp') " +
        "EXEC ZED_SURVEILLANCE.sys.sp_executesql N'UPDATE dbo.Users SET SessionStamp = @Stamp WHERE UserId = @UserId;', " +
        "N'@UserId varchar(50), @Stamp uniqueidentifier', @UserId = @UserId, @Stamp = @Stamp;";

    /// <summary>Main host: <see cref="BumpAssessorsSql"/> for the copies in ZED_SURVEILLANCE.</summary>
    public const string BumpSurveillanceAssessorsSql =
        "DECLARE @Stamp uniqueidentifier = NEWID(); " +
        "IF EXISTS (SELECT 1 FROM ZED_SURVEILLANCE.sys.columns WHERE object_id = OBJECT_ID('ZED_SURVEILLANCE.dbo.Users') AND name = 'SessionStamp') " +
        "EXEC ZED_SURVEILLANCE.sys.sp_executesql N'UPDATE dbo.Users SET SessionStamp = @Stamp WHERE CreatedBy = @UserId AND RoleId = 3;', " +
        "N'@UserId varchar(50), @Stamp uniqueidentifier', @UserId = @UserId, @Stamp = @Stamp;";

    /// <summary>The user's stamp in <paramref name="db"/>: "" when NULL, without a row, or before migration 0040.</summary>
    public static async Task<string> ReadAsync(ISqlExecutor db, string userId, CancellationToken ct)
    {
        try
        {
            var rows = await db.QuerySqlAsync<string?>(SelectSql, new { UserId = userId }, ct);
            return rows.FirstOrDefault()?.Trim() ?? "";
        }
        catch (SqlException ex) when (ex.Number is 207 or 208)
        {
            // Invalid column / object name: the column (or the table, in a test database) is not there yet.
            return "";
        }
    }

    /// <summary>Sets a new stamp (NEWID()) for <paramref name="userId"/> in <paramref name="db"/>; nothing before migration 0040.</summary>
    public static Task BumpAsync(ISqlExecutor db, string userId, CancellationToken ct) =>
        db.ExecuteSqlAsync(BumpSql, new { UserId = userId }, ct);

    /// <summary>
    /// Ends every web session of <paramref name="userId"/> on the portal of <paramref name="system"/> (its host database
    /// <paramref name="db"/>); on main also on the Surveillance portal (<see cref="BumpSurveillanceCopySql"/>). With
    /// <paramref name="withAssessors"/> also those of the assessors the agency created (their sub-roles follow the
    /// agency's). Never throws for a database error: the change it follows is already saved, so a failure is logged.
    /// </summary>
    public static async Task EndSessionsAsync(ISqlExecutor db, PortalSystem system, string userId, ILogger log, CancellationToken ct,
        bool withAssessors = false)
    {
        if (string.IsNullOrWhiteSpace(userId)) return;
        try
        {
            await BumpAsync(db, userId, ct);
            if (withAssessors) await db.ExecuteSqlAsync(BumpAssessorsSql, new { UserId = userId }, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "The sessions of {UserId} could not be ended (session stamp not changed)", userId);
            return;
        }
        if (system != PortalSystem.Main) return;
        try
        {
            await db.ExecuteSqlAsync(BumpSurveillanceCopySql, new { UserId = userId }, ct);
            if (withAssessors) await db.ExecuteSqlAsync(BumpSurveillanceAssessorsSql, new { UserId = userId }, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "The Surveillance portal's sessions of {UserId} could not be ended (ZED_SURVEILLANCE not reachable from main)", userId);
        }
    }
}

/// <summary>
/// Checks the cookie's <see cref="ZedClaims.SessionStamp"/> against <see cref="SessionStamps"/> on every request
/// (<c>CookieAuthenticationEvents.OnValidatePrincipal</c>); a session whose stamp differs is rejected and signed out, so
/// the API answers 401. The database's value is kept for <see cref="DefaultCacheLifetime"/> per user
/// (<c>Security:SessionStampCacheSeconds</c>, 0 = no cache), and read again before a session is refused.
/// <para>
/// The Admin's sessions on the Consultancy and Surveillance portals come from the main portal's hand-over
/// (<see cref="ZedClaims.SessionStampSource"/> = <see cref="MainSource"/>): their stamp is main's, read through the
/// read-only connection to the main database (ConnectionStrings:Main, or a keyed "Main" executor). Everyone else's is
/// in the host's own database (a sub-user's is its owner's: <see cref="ZedClaims.UserId"/>).
/// </para>
/// </summary>
public sealed class SessionStampValidator
{
    public const string CacheSetting = "Security:SessionStampCacheSeconds";
    public static readonly TimeSpan DefaultCacheLifetime = TimeSpan.FromSeconds(60);

    /// <summary>Value of <see cref="ZedClaims.SessionStampSource"/> for a session handed over from the main portal.</summary>
    public const string MainSource = "Main";

    private readonly IServiceProvider services;
    private readonly IMemoryCache cache;
    private readonly ILogger<SessionStampValidator> log;
    private readonly TimeSpan lifetime;
    private readonly PortalSystem system;
    private ISqlExecutor? mainConnection;

    public SessionStampValidator(IServiceProvider services, IMemoryCache cache, IConfiguration config, ILogger<SessionStampValidator> log)
    {
        this.services = services;
        this.cache = cache;
        this.log = log;
        lifetime = int.TryParse(config[CacheSetting], out var seconds) && seconds >= 0 ? TimeSpan.FromSeconds(seconds) : DefaultCacheLifetime;
        system = services.GetService<PortalHost>()?.System ?? PortalSystem.Main;
    }

    /// <summary>
    /// At sign-in: adds the user's current stamp (and, for a hand-over, its source) to <paramref name="principal"/>.
    /// <paramref name="onMain"/>: the stamp is main's (the Admin signed in from the main portal).
    /// </summary>
    public async Task StampAsync(ClaimsPrincipal principal, string userId, bool onMain, CancellationToken ct)
    {
        if (principal.Identity is not ClaimsIdentity identity || string.IsNullOrEmpty(userId)) return;
        onMain = onMain && system != PortalSystem.Main;
        var stamp = Database(onMain) is { } db ? await SessionStamps.ReadAsync(db, userId, ct) : "";
        Remember(onMain, userId, stamp);
        if (stamp.Length > 0) identity.AddClaim(new Claim(ZedClaims.SessionStamp, stamp));
        if (onMain) identity.AddClaim(new Claim(ZedClaims.SessionStampSource, MainSource));
    }

    /// <summary>OnValidatePrincipal: keeps the session while its stamp is the database's, else rejects it and signs out.</summary>
    public async Task ValidateAsync(CookieValidatePrincipalContext context)
    {
        var principal = context.Principal;
        var userId = principal?.FindFirst(ZedClaims.UserId)?.Value;
        if (principal is null || string.IsNullOrEmpty(userId)) return;
        var claimed = principal.FindFirst(ZedClaims.SessionStamp)?.Value ?? "";
        var onMain = system != PortalSystem.Main && principal.FindFirst(ZedClaims.SessionStampSource)?.Value == MainSource;
        if (lifetime > TimeSpan.Zero && cache.TryGetValue(Key(onMain, userId), out string? cached) && Same(cached, claimed)) return;

        string current;
        try
        {
            if (Database(onMain) is not { } db)
            {
                log.LogWarning("Session of {UserId} ended: its stamp is on the main database, which this portal cannot read", userId);
                await RejectAsync(context);
                return;
            }
            current = await SessionStamps.ReadAsync(db, userId, context.HttpContext.RequestAborted);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The database is not answering: the request fails anyway at its first query; the session is not ended for it.
            log.LogWarning(ex, "Session stamp of {UserId} could not be read; the session is kept", userId);
            return;
        }
        Remember(onMain, userId, current);
        if (Same(current, claimed)) return;

        log.LogInformation("Session of {UserId} ended: the account's access changed since sign-in", userId);
        await RejectAsync(context);
    }

    private static async Task RejectAsync(CookieValidatePrincipalContext context)
    {
        context.RejectPrincipal();
        await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    }

    private void Remember(bool onMain, string userId, string stamp)
    {
        if (lifetime > TimeSpan.Zero) cache.Set(Key(onMain, userId), stamp, lifetime);
    }

    private static string Key(bool onMain, string userId) => "session-stamp:" + (onMain ? "main:" : "own:") + userId.Trim().ToUpperInvariant();

    private static bool Same(string? a, string? b) => string.Equals(a ?? "", b ?? "", StringComparison.OrdinalIgnoreCase);

    /// <summary>The host's database, or for <paramref name="onMain"/> the read-only main connection (null when not configured).</summary>
    private ISqlExecutor? Database(bool onMain)
    {
        if (!onMain) return services.GetRequiredService<ISqlExecutor>();
        if (mainConnection is not null) return mainConnection;
        var name = new PortalHost(PortalSystem.Main).Database;
        if (services.GetKeyedService<ISqlExecutor>(name) is { } keyed) return mainConnection = keyed;
        if (services.GetRequiredService<IConfiguration>().GetConnectionString(name) is not { Length: > 0 } cs) return null;
        // Read intent, as the hand-over's Accept: only the SELECT of SessionStamps runs there.
        return mainConnection = new SqlExecutor(new SqlConnectionStringBuilder(cs) { ApplicationIntent = ApplicationIntent.ReadOnly }.ConnectionString);
    }
}
