using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Masters;

/// <summary>
/// Admin → Masters → Subsidy Regions (new in V4): the regions whose MSMEs get the ZED scheme's additional subsidy:
/// aspirational districts, LWE districts, Himalayan states, island territories and the North Eastern Region, each entry
/// enabled or disabled. Kept in the existing tables (migration 0024): a column per region on dbo.Districts (a district
/// entry) and on dbo.States (a whole state) - NULL not listed, 0 listed and off, 1 listed and on. The payment
/// procedures read Districts.IsAspirationalDt (SP_MSME_GET_PAYMENT_DETAILS: special category 1), so after every change
/// that flag is set for exactly the districts an enabled entry covers: their own column or their state's. Main only.
/// </summary>
[Route("api/staff/masters/regions")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main)]
public sealed partial class SpecialRegionsController(ISqlExecutor db, ILogger<SpecialRegionsController> log) : StaffApiController
{
    /// <param name="Level">"district": entries are districts; "state": whole states (a district may be added too).</param>
    public sealed record Category(string Key, string Name, string Description, string Level);

    public static readonly IReadOnlyList<Category> Categories =
    [
        new("ASPIRATIONAL", "Aspirational Districts", "Districts of the Aspirational Districts Programme (NITI Aayog).", "district"),
        new("LWE", "LWE Districts", "Districts affected by Left Wing Extremism as notified by the Ministry of Home Affairs (none since April 2026).", "district"),
        new("HIMALAYAN", "Himalayan Region", "States and UTs of the Himalayan region.", "state"),
        new("ISLAND", "Island Territories", "Andaman and Nicobar Islands and Lakshadweep.", "state"),
        new("NER", "North Eastern Region", "The eight North Eastern states.", "state"),
    ];

    /// <summary>The column of each region on dbo.Districts and dbo.States (fixed names, never taken from the request).</summary>
    private static readonly IReadOnlyDictionary<string, string> Columns = new Dictionary<string, string>
    {
        ["ASPIRATIONAL"] = "SubsidyAspirational", ["LWE"] = "SubsidyLwe", ["HIMALAYAN"] = "SubsidyHimalayan", ["ISLAND"] = "SubsidyIsland",
        ["NER"] = "SubsidyNer",
    };

    public sealed record RegionRow(string Category, string StateCode, string DistrictCode, bool Enabled, string? UpdatedBy,
        DateTime? UpdatedOn, string? StateName, string? DistrictName);

    public sealed record Option(string Code, string Name);

    public sealed record RegionsResponse(IReadOnlyList<Category> Categories, IReadOnlyList<RegionRow> Regions, IReadOnlyList<Option> States, int SubsidyDistricts);

    /// <summary>Every listed entry: the region columns of States (whole states) and of Districts, one row per region set.</summary>
    internal const string RegionsSql =
        "SELECT x.Category, x.StateCode, x.DistrictCode, x.Enabled, x.UpdatedBy, x.UpdatedOn, x.StateName, x.DistrictName FROM (" +
        "SELECT c.Category, LTRIM(RTRIM(s.StateCode)) AS StateCode, '' AS DistrictCode, c.Enabled, s.SubsidyUpdatedBy AS UpdatedBy, " +
        "s.SubsidyUpdatedOn AS UpdatedOn, s.StateName, CAST(NULL AS varchar(200)) AS DistrictName FROM dbo.States s " +
        "CROSS APPLY (VALUES ('ASPIRATIONAL', s.SubsidyAspirational), ('LWE', s.SubsidyLwe), ('HIMALAYAN', s.SubsidyHimalayan), " +
        "('ISLAND', s.SubsidyIsland), ('NER', s.SubsidyNer)) c(Category, Enabled) WHERE c.Enabled IS NOT NULL " +
        "UNION ALL " +
        "SELECT c.Category, LTRIM(RTRIM(d.StateCode)), LTRIM(RTRIM(d.DistrictCode)), c.Enabled, d.SubsidyUpdatedBy, d.SubsidyUpdatedOn, " +
        "ISNULL((SELECT TOP 1 StateName FROM dbo.States WHERE LTRIM(RTRIM(StateCode)) = LTRIM(RTRIM(d.StateCode))), d.StateName), d.DistrictName " +
        "FROM dbo.Districts d " +
        "CROSS APPLY (VALUES ('ASPIRATIONAL', d.SubsidyAspirational), ('LWE', d.SubsidyLwe), ('HIMALAYAN', d.SubsidyHimalayan), " +
        "('ISLAND', d.SubsidyIsland), ('NER', d.SubsidyNer)) c(Category, Enabled) WHERE c.Enabled IS NOT NULL" +
        ") x ORDER BY x.Category, x.StateName, x.DistrictName;";

    internal const string StatesSql = "SELECT LTRIM(RTRIM(StateCode)) AS Code, StateName AS Name FROM dbo.States WHERE ISNULL(IsActive, 1) = 1 ORDER BY StateName;";

    internal const string CountSql = "SELECT COUNT(*) AS Total FROM dbo.Districts WHERE IsAspirationalDt = 1;";

    /// <summary>
    /// Sets Districts.IsAspirationalDt to whether an enabled entry covers the district: one of its own region columns or
    /// of its state's (only the rows that change).
    /// </summary>
    internal const string RecomputeSql =
        "UPDATE d SET IsAspirationalDt = x.Flag FROM dbo.Districts d " +
        "OUTER APPLY (SELECT MAX(CASE WHEN 1 IN (ISNULL(s.SubsidyAspirational, 0), ISNULL(s.SubsidyLwe, 0), ISNULL(s.SubsidyHimalayan, 0), " +
        "ISNULL(s.SubsidyIsland, 0), ISNULL(s.SubsidyNer, 0)) THEN 1 ELSE 0 END) AS StateFlag " +
        "FROM dbo.States s WHERE LTRIM(RTRIM(s.StateCode)) = LTRIM(RTRIM(d.StateCode))) st " +
        "CROSS APPLY (SELECT CAST(CASE WHEN ISNULL(st.StateFlag, 0) = 1 OR 1 IN (ISNULL(d.SubsidyAspirational, 0), ISNULL(d.SubsidyLwe, 0), " +
        "ISNULL(d.SubsidyHimalayan, 0), ISNULL(d.SubsidyIsland, 0), ISNULL(d.SubsidyNer, 0)) THEN 1 ELSE 0 END AS bit) AS Flag) x " +
        "WHERE ISNULL(d.IsAspirationalDt, 0) <> x.Flag;";

    public sealed record CountRow(int Total);

    [HttpGet]
    public async Task<ActionResult<RegionsResponse>> Get(CancellationToken ct)
    {
        try
        {
            var regions = await db.QuerySqlAsync<RegionRow>(RegionsSql, null, ct);
            return new RegionsResponse(Categories, regions, await db.QuerySqlAsync<Option>(StatesSql, null, ct), await CountAsync(ct));
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not read the subsidy region columns of Districts / States (is migration 0024 applied?)");
            return this.Problem400("The subsidy regions cannot be read. Please ask the administrator to apply database migration 0024.");
        }
    }

    [HttpGet("districts")]
    public async Task<IReadOnlyList<Option>> Districts([FromQuery] string? state, CancellationToken ct) =>
        string.IsNullOrWhiteSpace(state) || state.Length > 10
            ? []
            : await db.QuerySqlAsync<Option>(
                "SELECT LTRIM(RTRIM(DistrictCode)) AS Code, DistrictName AS Name FROM dbo.Districts WHERE LTRIM(RTRIM(StateCode)) = @State AND ISNULL(IsActive, 1) = 1 ORDER BY DistrictName;",
                new { State = state.Trim() }, ct);

    public sealed record RegionRequest(string? Category, string? StateCode, string? DistrictCode, bool Enabled);

    /// <summary>Adds a state or district to a category (enabled or not): its column goes from NULL to 0 or 1.</summary>
    [HttpPost]
    public async Task<ActionResult<MessageResponse>> Add(RegionRequest req, CancellationToken ct)
    {
        var (key, error) = await CheckAsync(req, ct);
        if (error is not null) return this.Problem400(error);
        var existing = await db.QuerySqlAsync<RegionRow>(RegionsSql, null, ct);
        if (existing.Any(r => r.Category == key.Category && r.StateCode == key.State && r.DistrictCode == key.District))
            return this.Problem400("It is already in this list.");
        await db.ExecuteSqlAsync(SetSql(key, "IS NULL"), new { Value = req.Enabled, UpdatedBy = UserId, StateCode = key.State, DistrictCode = key.District }, ct);
        return await AppliedAsync($"Added to {CategoryName(key.Category)}.", key, "added", ct);
    }

    /// <summary>Enables or disables an entry.</summary>
    [HttpPut]
    public async Task<ActionResult<MessageResponse>> Set(RegionRequest req, CancellationToken ct)
    {
        if (Key(req) is not { } key) return this.Problem400("Please choose the region.");
        var changed = await db.ExecuteSqlAsync(SetSql(key, "IS NOT NULL"),
            new { Value = req.Enabled, UpdatedBy = UserId, StateCode = key.State, DistrictCode = key.District }, ct);
        if (changed == 0) return NotFound();
        return await AppliedAsync(req.Enabled ? "Enabled: its MSMEs get the additional subsidy." : "Disabled: its MSMEs no longer get the additional subsidy.", key,
            req.Enabled ? "enabled" : "disabled", ct);
    }

    /// <summary>Takes an entry off its list (its column back to NULL); the district or state itself stays.</summary>
    [HttpDelete]
    public async Task<ActionResult<MessageResponse>> Remove([FromQuery] string? category, [FromQuery] string? stateCode, [FromQuery] string? districtCode, CancellationToken ct)
    {
        if (Key(new RegionRequest(category, stateCode, districtCode, false)) is not { } key) return this.Problem400("Please choose the region.");
        var changed = await db.ExecuteSqlAsync(SetSql(key, "IS NOT NULL"),
            new { Value = (bool?)null, UpdatedBy = UserId, StateCode = key.State, DistrictCode = key.District }, ct);
        if (changed == 0) return NotFound();
        return await AppliedAsync("Removed from the list.", key, "removed", ct);
    }

    private sealed record RegionKey(string Category, string State, string District);

    /// <summary>
    /// Sets the region's column of the district (dbo.Districts) or, for a whole state, of the state (dbo.States) to @Value,
    /// where that column currently <paramref name="currently"/> ("IS NULL": adding; "IS NOT NULL": changing or removing).
    /// The column name comes from <see cref="Columns"/>.
    /// </summary>
    private static string SetSql(RegionKey key, string currently)
    {
        var column = Columns[key.Category];
        return key.District.Length == 0
            ? $"UPDATE dbo.States SET {column} = @Value, SubsidyUpdatedBy = @UpdatedBy, SubsidyUpdatedOn = SYSUTCDATETIME() " +
              $"WHERE LTRIM(RTRIM(StateCode)) = @StateCode AND {column} {currently};"
            : $"UPDATE dbo.Districts SET {column} = @Value, SubsidyUpdatedBy = @UpdatedBy, SubsidyUpdatedOn = SYSUTCDATETIME() " +
              $"WHERE LTRIM(RTRIM(StateCode)) = @StateCode AND LTRIM(RTRIM(DistrictCode)) = @DistrictCode AND {column} {currently};";
    }

    private static RegionKey? Key(RegionRequest req)
    {
        var category = Categories.FirstOrDefault(c => string.Equals(c.Key, req.Category?.Trim(), StringComparison.OrdinalIgnoreCase))?.Key;
        var state = req.StateCode?.Trim() ?? "";
        var district = req.DistrictCode?.Trim() ?? "";
        if (category is null || state.Length is 0 or > 10 || district.Length > 10 || !state.All(char.IsAsciiDigit) || !district.All(char.IsAsciiDigit)) return null;
        return new RegionKey(category, state, district);
    }

    private async Task<(RegionKey Key, string? Error)> CheckAsync(RegionRequest req, CancellationToken ct)
    {
        if (Key(req) is not { } key) return (null!, "Please choose the category and the state.");
        var category = Categories.First(c => c.Key == key.Category);
        if (category.Level == "district" && key.District.Length == 0) return (key, $"{category.Name} are districts: please choose the district.");
        if ((await db.QuerySqlAsync<Option>(StatesSql, null, ct)).All(s => s.Code != key.State)) return (key, "Please choose a valid state.");
        if (key.District.Length > 0 && (await Districts(key.State, ct)).All(d => d.Code != key.District)) return (key, "Please choose a district of that state.");
        return (key, null);
    }

    private async Task<ActionResult<MessageResponse>> AppliedAsync(string message, RegionKey key, string action, CancellationToken ct)
    {
        var flagged = await db.ExecuteSqlAsync(RecomputeSql, null, ct);
        log.LogWarning("Subsidy region {Category} {State}/{District} {Action} by {Actor}; {Flagged} district flag(s) changed",
            key.Category, key.State, key.District.Length == 0 ? "(state)" : key.District, action, UserId, flagged);
        return new MessageResponse($"{message} {await CountAsync(ct)} districts now get the additional subsidy.");
    }

    private async Task<int> CountAsync(CancellationToken ct) => (await db.QuerySqlAsync<CountRow>(CountSql, null, ct)).FirstOrDefault()?.Total ?? 0;

    private static string CategoryName(string key) => Categories.First(c => c.Key == key).Name;
}
