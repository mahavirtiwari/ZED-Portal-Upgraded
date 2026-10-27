using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Masters;

/// <summary>
/// Admin → Masters → Subsidy Regions (new in V4): the regions whose MSMEs get the ZED scheme's additional subsidy:
/// aspirational districts, LWE districts, Himalayan states, island territories and the North Eastern Region
/// (dbo.V4SpecialRegions, migration 0024), each entry enabled or disabled. The payment procedures read
/// Districts.IsAspirationalDt (SP_MSME_GET_PAYMENT_DETAILS: special category 1), so after every change that flag is set
/// for exactly the districts an enabled entry covers: a district entry, or a whole state. Main only.
/// </summary>
[Route("api/staff/masters/regions")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main)]
public sealed class SpecialRegionsController(ISqlExecutor db, ILogger<SpecialRegionsController> log) : StaffApiController
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

    public sealed record RegionRow(string Category, string StateCode, string DistrictCode, bool Enabled, string? Source, string? UpdatedBy,
        DateTime? UpdatedOn, string? StateName, string? DistrictName);

    public sealed record Option(string Code, string Name);

    public sealed record RegionsResponse(IReadOnlyList<Category> Categories, IReadOnlyList<RegionRow> Regions, IReadOnlyList<Option> States, int SubsidyDistricts);

    internal const string RegionsSql =
        "SELECT r.Category, r.StateCode, r.DistrictCode, r.Enabled, r.Source, r.UpdatedBy, r.UpdatedOn, s.StateName, d.DistrictName " +
        "FROM dbo.V4SpecialRegions r " +
        "OUTER APPLY (SELECT TOP 1 StateName FROM dbo.States WHERE LTRIM(RTRIM(StateCode)) = r.StateCode) s " +
        "OUTER APPLY (SELECT TOP 1 DistrictName FROM dbo.Districts WHERE r.DistrictCode <> '' AND LTRIM(RTRIM(DistrictCode)) = r.DistrictCode) d " +
        "ORDER BY r.Category, s.StateName, d.DistrictName;";

    internal const string StatesSql = "SELECT LTRIM(RTRIM(StateCode)) AS Code, StateName AS Name FROM dbo.States WHERE ISNULL(IsActive, 1) = 1 ORDER BY StateName;";

    internal const string CountSql = "SELECT COUNT(*) AS Total FROM dbo.Districts WHERE IsAspirationalDt = 1;";

    /// <summary>Sets Districts.IsAspirationalDt to whether an enabled entry covers the district (only rows that change).</summary>
    internal const string RecomputeSql =
        "UPDATE d SET IsAspirationalDt = x.Flag FROM dbo.Districts d " +
        "CROSS APPLY (SELECT CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.V4SpecialRegions r WHERE r.Enabled = 1 AND r.StateCode = LTRIM(RTRIM(d.StateCode)) " +
        "AND (r.DistrictCode = '' OR r.DistrictCode = LTRIM(RTRIM(d.DistrictCode)))) THEN 1 ELSE 0 END AS bit) AS Flag) x " +
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
            log.LogError(ex, "Could not read dbo.V4SpecialRegions (is migration 0024 applied?)");
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

    /// <summary>Adds a state or district to a category (enabled or not).</summary>
    [HttpPost]
    public async Task<ActionResult<MessageResponse>> Add(RegionRequest req, CancellationToken ct)
    {
        var (key, error) = await CheckAsync(req, ct);
        if (error is not null) return this.Problem400(error);
        var existing = await db.QuerySqlAsync<RegionRow>(RegionsSql, null, ct);
        if (existing.Any(r => r.Category == key.Category && r.StateCode == key.State && r.DistrictCode == key.District))
            return this.Problem400("It is already in this list.");
        await db.ExecuteSqlAsync(
            "INSERT INTO dbo.V4SpecialRegions (Category, StateCode, DistrictCode, Enabled, Source, UpdatedBy) VALUES (@Category, @StateCode, @DistrictCode, @Enabled, N'Added by the Admin', @UpdatedBy);",
            new { key.Category, StateCode = key.State, DistrictCode = key.District, req.Enabled, UpdatedBy = UserId }, ct);
        return await AppliedAsync($"Added to {CategoryName(key.Category)}.", key, "added", ct);
    }

    /// <summary>Enables or disables an entry.</summary>
    [HttpPut]
    public async Task<ActionResult<MessageResponse>> Set(RegionRequest req, CancellationToken ct)
    {
        if (Key(req) is not { } key) return this.Problem400("Please choose the region.");
        var changed = await db.ExecuteSqlAsync(
            "UPDATE dbo.V4SpecialRegions SET Enabled = @Enabled, UpdatedBy = @UpdatedBy, UpdatedOn = SYSUTCDATETIME() WHERE Category = @Category AND StateCode = @StateCode AND DistrictCode = @DistrictCode;",
            new { req.Enabled, UpdatedBy = UserId, key.Category, StateCode = key.State, DistrictCode = key.District }, ct);
        if (changed == 0) return NotFound();
        return await AppliedAsync(req.Enabled ? "Enabled: its MSMEs get the additional subsidy." : "Disabled: its MSMEs no longer get the additional subsidy.", key,
            req.Enabled ? "enabled" : "disabled", ct);
    }

    [HttpDelete]
    public async Task<ActionResult<MessageResponse>> Remove([FromQuery] string? category, [FromQuery] string? stateCode, [FromQuery] string? districtCode, CancellationToken ct)
    {
        if (Key(new RegionRequest(category, stateCode, districtCode, false)) is not { } key) return this.Problem400("Please choose the region.");
        var changed = await db.ExecuteSqlAsync(
            "DELETE FROM dbo.V4SpecialRegions WHERE Category = @Category AND StateCode = @StateCode AND DistrictCode = @DistrictCode;",
            new { key.Category, StateCode = key.State, DistrictCode = key.District }, ct);
        if (changed == 0) return NotFound();
        return await AppliedAsync("Removed from the list.", key, "removed", ct);
    }

    private sealed record RegionKey(string Category, string State, string District);

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
