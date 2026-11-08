using System.Data.Common;
using Microsoft.Extensions.Caching.Memory;
using Zed.Core.Data;
using Zed.Portal.Features.Staff.Dashboard;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// The scope of a Master Admin or Ministry login (2026-11-07, migration 0057; Admin → User Management): the MSME category
/// (Manufacturing, Services or both), the certification levels and, for a Master Admin, the plant states. The login sees only
/// the MSMEs and applications inside it, and the users it creates cannot be given more. Empty parts = no limit (today's
/// logins). A sub-user works as its owner (<see cref="Zed.Core.Security.ZedUser.UserId"/> is the owner's), so it has the
/// owner's scope.
/// </summary>
public sealed record LoginScope(string? Sector, IReadOnlyList<string> Levels, IReadOnlyList<string> StateCodes)
{
    public static readonly LoginScope None = new(null, [], []);

    /// <summary>An MSME DFO's districts among its states (dbo.Users.ScopeDistricts, migration 0059); empty = every district.</summary>
    public IReadOnlyList<string> Districts { get; init; } = [];

    public const string Manufacturing = "Manufacturing";
    public const string Services = "Services";

    /// <summary>The level codes a scope can name (dbo.SectionTypes codes; ZED-X is "ZEDX").</summary>
    public static readonly string[] AllLevels = ["Bronze", "Silver", "Gold", "ZEDX"];

    /// <summary>Manufacturing or Services; null when both.</summary>
    public string? OneSector => Sector is Manufacturing or Services ? Sector : null;

    public bool IsLimited => OneSector is not null || Levels.Count > 0 || StateCodes.Count > 0;

    /// <summary>The state names (Msme.PStateName) of <see cref="StateCodes"/>.</summary>
    public IReadOnlyList<string> StateNames =>
        StateCodes.Select(c => DashboardFilters.States.TryGetValue(c, out var n) ? n : null).OfType<string>().ToList();

    /// <summary>A level inside the scope (an empty list = every level). Surveillance / milestone names count as their level.</summary>
    public bool AllowsLevel(string? certification)
    {
        if (Levels.Count == 0) return true;
        var level = BaseLevel(certification);
        return level is null || Levels.Contains(level, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>A unit's category inside the scope; an unknown category is not hidden.</summary>
    public bool AllowsSector(string? category)
    {
        if (OneSector is not { } one || string.IsNullOrWhiteSpace(category)) return true;
        var c = category.Trim();
        var isService = c.StartsWith("Serv", StringComparison.OrdinalIgnoreCase);
        var isManufacturing = c.StartsWith("Manu", StringComparison.OrdinalIgnoreCase);
        if (!isService && !isManufacturing) return true;
        return one == Services ? isService : isManufacturing;
    }

    /// <summary>A plant state (name or code) inside the scope; an unknown state is hidden only when states are limited.</summary>
    public bool AllowsState(string? state)
    {
        if (StateCodes.Count == 0) return true;
        if (string.IsNullOrWhiteSpace(state)) return false;
        var s = state.Trim();
        return StateCodes.Contains(s, StringComparer.OrdinalIgnoreCase) || StateNames.Contains(s, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>Whether <paramref name="inner"/> stays within this scope (the users a scoped login creates).</summary>
    public bool Contains(LoginScope inner) =>
        (OneSector is null || inner.OneSector == OneSector)
        && (Levels.Count == 0 || (inner.Levels.Count > 0 && inner.Levels.All(l => Levels.Contains(l, StringComparer.OrdinalIgnoreCase))))
        && (StateCodes.Count == 0 || (inner.StateCodes.Count > 0 && inner.StateCodes.All(s => StateCodes.Contains(s, StringComparer.OrdinalIgnoreCase))));

    /// <summary>"Bronze" of "BronzeSurveillance", "SilverMilestone1", "Gold"; null when not a level name.</summary>
    public static string? BaseLevel(string? certification)
    {
        var c = certification?.Trim() ?? "";
        return AllLevels.FirstOrDefault(l => c.StartsWith(l, StringComparison.OrdinalIgnoreCase));
    }

    public static IReadOnlyList<string> Split(string? stored) =>
        (stored ?? "").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

    public static string? Join(IEnumerable<string> values) => values.Any() ? string.Join(',', values) : null;
}

/// <summary>Reads the scope of a login (dbo.Users, migration 0057), kept for a minute; an edit forgets it at once.</summary>
public sealed class LoginScopes(ISqlExecutor db, IMemoryCache cache, ILogger<LoginScopes> log, IServiceProvider services)
{
    private static readonly TimeSpan Keep = TimeSpan.FromMinutes(1);

    internal const string Sql = "SELECT TOP (1) SectorActivity, ScopeLevels, ScopeStates, ScopeDistricts FROM dbo.Users WHERE UserId = @UserId ORDER BY CASE WHEN IsActive = 1 THEN 0 ELSE 1 END;";

    private sealed record Row(string? SectorActivity, string? ScopeLevels, string? ScopeStates, string? ScopeDistricts = null);

    /// <summary>The roles that can have a scope.</summary>
    public static bool CanHaveScope(int roleId) =>
        roleId is (int)Zed.Core.Security.UserRole.MasterAdmin or (int)Zed.Core.Security.UserRole.Ministry or (int)Zed.Core.Security.UserRole.SuperAdmin
            or (int)Zed.Core.Security.UserRole.StateCoordinator;

    /// <summary>Master Admin, Dashboard Admin and MSME DFO: also the plant states.</summary>
    public static bool HasStateScope(int roleId) =>
        roleId is (int)Zed.Core.Security.UserRole.MasterAdmin or (int)Zed.Core.Security.UserRole.SuperAdmin or (int)Zed.Core.Security.UserRole.StateCoordinator;

    public async Task<LoginScope> ForAsync(string userId, int roleId, CancellationToken ct)
    {
        if (!CanHaveScope(roleId) || string.IsNullOrEmpty(userId)) return LoginScope.None;
        var key = Key(userId);
        if (cache.TryGetValue(key, out LoginScope? kept) && kept is not null) return kept;
        LoginScope scope;
        try
        {
            // Dashboard Admin and MSME DFO are kept on main (2026-11-08: main first, so a copy of the row in this portal's
            // database cannot narrow or widen a handed-over login); a login of this portal only (an old DFO) has its own row.
            Row? row = null;
            if (roleId is (int)Zed.Core.Security.UserRole.SuperAdmin or (int)Zed.Core.Security.UserRole.StateCoordinator
                && Documents.SystemDatabases.Open(services, Zed.Core.Http.PortalSystem.Main) is { } main && !ReferenceEquals(main, db))
                row = (await main.QuerySqlAsync<Row>(Sql, new { UserId = userId }, ct)).FirstOrDefault();
            row ??= (await db.QuerySqlAsync<Row>(Sql, new { UserId = userId }, ct)).FirstOrDefault();
            scope = row is null ? LoginScope.None : new LoginScope(
                row.SectorActivity?.Trim() is { Length: > 0 } s ? s : null,
                LoginScope.Split(row.ScopeLevels),
                HasStateScope(roleId) ? LoginScope.Split(row.ScopeStates) : [])
            {
                Districts = roleId == (int)Zed.Core.Security.UserRole.StateCoordinator ? LoginScope.Split(row.ScopeDistricts) : [],
            };
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Login scope of {UserId} not read (is migration 0057 applied?)", userId);
            scope = LoginScope.None;
        }
        cache.Set(key, scope, Keep);
        return scope;
    }

    public void Forget(string userId) => cache.Remove(Key(userId));

    private static string Key(string userId) => "login-scope:" + userId.ToUpperInvariant();
}

public static class LoginScopeExtensions
{
    /// <summary>The scope of the signed-in login (its owner's for a sub-user); none for other roles.</summary>
    public static Task<LoginScope> LoginScopeAsync(this HttpContext http, CancellationToken ct)
    {
        var user = Zed.Core.Security.ZedUser.FromPrincipal(http.User);
        return user is null
            ? Task.FromResult(LoginScope.None)
            : http.RequestServices.GetRequiredService<LoginScopes>().ForAsync(user.UserId, user.RoleId, ct);
    }
}
