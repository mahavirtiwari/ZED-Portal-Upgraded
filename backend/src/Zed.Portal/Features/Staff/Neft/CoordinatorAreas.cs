using System.Data.Common;
using Zed.Core.Data;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Portal.Features.Staff.Neft;

/// <summary>
/// The units an MSME DFO (StateCoordinator, Users.RoleId 6) works with (2026-11-07, at the Admin's request): its states
/// (dbo.Users.ScopeStates; before, the one Users.StateCode), the districts among them (dbo.Users.ScopeDistricts, migration
/// 0059; none = every district) and its category (Users.SectorActivity: Manufacturing, Services or both). The NEFT Admin
/// (state "ALL") and the user ids under Neft:AllStatesUserIds see every unit.
/// </summary>
public sealed class CoordinatorArea
{
    public bool Everything { get; init; }
    public IReadOnlyList<string> States { get; init; } = [];
    public IReadOnlyList<string> Districts { get; init; } = [];
    public IReadOnlyList<string> DistrictNames { get; init; } = [];
    public string? Sector { get; init; }
    public IReadOnlyDictionary<string, string> SectorTypes { get; init; } = new Dictionary<string, string>();

    /// <summary>A row with the unit's columns (Msme: StateId / PStateId, PLgDistrictCode / PDistrictName, Activity, TwoDigitActivity).</summary>
    public bool Contains(IDictionary<string, object?> row)
    {
        if (Everything) return true;
        var state = NeftController.NormaliseState(row.Text("PStateId")) ?? NeftController.NormaliseState(row.Text("StateId"));
        var office = NeftController.NormaliseState(row.Text("StateId"));
        if (!States.Contains(state ?? "") && !States.Contains(office ?? "")) return false;
        if (Districts.Count > 0)
        {
            var code = row.Text("PLgDistrictCode").Trim();
            var name = row.Text("PDistrictName").Trim();
            if (!Districts.Contains(code, StringComparer.OrdinalIgnoreCase) && !DistrictNames.Contains(name, StringComparer.OrdinalIgnoreCase)) return false;
        }
        if (Sector is LoginScope.Manufacturing or LoginScope.Services)
        {
            var category = UserSectorActivity.UnitCategory(row.Text("Activity"), row.Text("TwoDigitActivity"), SectorTypes);
            if (category is not null && category != Sector) return false;
        }
        return true;
    }
}

public static class CoordinatorAreas
{
    internal const string DistrictNamesSql = "SELECT DistrictCode, DistrictName FROM Districts WHERE DistrictCode IN @Codes;";

    private sealed record DistrictRow(string? DistrictCode, string? DistrictName);

    public static async Task<CoordinatorArea> ForAsync(HttpContext http, IConfiguration config, ISqlExecutor db, ZedUser user, CancellationToken ct)
    {
        if (NeftController.SeesAllStates(config, user.UserId, user.StateCode)) return new CoordinatorArea { Everything = true };
        var scope = await http.LoginScopeAsync(ct);
        var states = (scope.StateCodes.Count > 0 ? scope.StateCodes : [user.StateCode ?? ""])
            .Select(NeftController.NormaliseState).OfType<string>().Distinct().ToList();
        IReadOnlyList<string> names = [];
        if (scope.Districts.Count > 0)
        {
            try
            {
                names = (await db.QuerySqlAsync<DistrictRow>(DistrictNamesSql, new { Codes = scope.Districts.ToArray() }, ct))
                    .Select(d => d.DistrictName?.Trim()).OfType<string>().Where(n => n.Length > 0).ToList();
            }
            catch (DbException) { /* codes only */ }
        }
        var log = http.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Zed.Neft");
        return new CoordinatorArea
        {
            States = states,
            Districts = scope.Districts,
            DistrictNames = names,
            Sector = scope.OneSector,
            SectorTypes = scope.OneSector is null ? new Dictionary<string, string>() : await UserSectorActivity.SectorTypesAsync(db, log, ct),
        };
    }

    /// <summary>The NEFT lists an MSME DFO was given ("{portal}:neft" in Users.ScreenAccess); none stored = its own portal's.</summary>
    public static bool HasList(ZedUser user, Zed.Core.Http.PortalSystem system) =>
        NeftController.AllStates.Equals(user.StateCode?.Trim(), StringComparison.OrdinalIgnoreCase)
        || user.Screens is null
        || DashboardScreens.Parse(user.Screens)!.Contains(DashboardScreens.KeyOf(system) + ":neft");
}
