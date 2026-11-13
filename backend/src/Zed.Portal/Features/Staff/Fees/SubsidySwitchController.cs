using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Portal.Features.Staff.Fees;

/// <summary>
/// Switching a subsidy category off and on again (2026-11-13; Masters → Payments, Disable / Enable on a category). A
/// switched-off category is left out by dbo.FN_V4_SUBSIDY_CATEGORY (migration 0070), so the payment procedures charge the
/// unit's next eligible category (General when none); payments already made do not change. General (0) cannot be switched
/// off. One switch covers the three portals: dbo.AssessmentFee of ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE
/// (SubsidyOff, SubsidyOffReason, SubsidyOffBy, SubsidyOffOn on every row of the category). A database this host's login
/// cannot change, or one without migration 0070, is named in the answer; the others are switched.
/// </summary>
[Route("api/staff/fees/subsidy-switches")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class SubsidySwitchController(ISqlExecutor db, ILogger<SubsidySwitchController> log) : StaffApiController
{
    /// <summary>The three portals' fee tables (names mapped to a prefixed set by the executor).</summary>
    public static readonly (string Database, string Portal)[] Databases =
    [
        ("ZEDCS_V2_LIVE", "ZED Certification"), ("ZED_CONSULTANT", "Handholding"), ("ZED_SURVEILLANCE", "Surveillance"),
    ];

    /// <summary>The special categories (AssessmentFee.SpecialCategory, migration 0041) and their names.</summary>
    public static readonly IReadOnlyDictionary<int, string> Categories = new Dictionary<int, string>
    {
        [1] = "SC-owned", [2] = "Woman-owned", [3] = "ST-owned", [4] = "Aspirational district", [5] = "LWE district",
        [6] = "Himalayan region", [7] = "Island territory", [8] = "North Eastern Region",
    };

    /// <summary>A switched-off category of this portal's fee table: why, by whom and when.</summary>
    public sealed record OffCategory(int Category, string? Reason, string? By, DateTime? On);

    /// <param name="Ready">False before migration 0070 (the page then offers no switch).</param>
    public sealed record SwitchesResponse(bool Ready, IReadOnlyList<OffCategory> Off);

    internal const string OffSql =
        "SELECT SpecialCategory AS Category, MAX(SubsidyOffReason) AS Reason, MAX(SubsidyOffBy) AS [By], MAX(SubsidyOffOn) AS [On] " +
        "FROM dbo.AssessmentFee WHERE SubsidyOff = 1 AND SpecialCategory > 0 GROUP BY SpecialCategory;";

    [HttpGet]
    public async Task<SwitchesResponse> Get(CancellationToken ct)
    {
        try
        {
            return new SwitchesResponse(true, await db.QuerySqlAsync<OffCategory>(OffSql, null, ct));
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Subsidy switches not readable (is migration 0070 applied?)");
            return new SwitchesResponse(false, []);
        }
    }

    public sealed record SwitchRequest(bool Off, string? Reason);

    internal static string SwitchSql(string database) =>
        $"UPDATE {database}.dbo.AssessmentFee SET SubsidyOff = CASE WHEN @Off = 1 THEN 1 END, " +
        "SubsidyOffReason = CASE WHEN @Off = 1 THEN @Reason END, SubsidyOffBy = @Actor, SubsidyOffOn = GETDATE() " +
        "WHERE SpecialCategory = @Category;";

    [HttpPut("{category:int}")]
    public async Task<ActionResult<MessageResponse>> Switch(int category, SwitchRequest req, CancellationToken ct)
    {
        if (!Categories.TryGetValue(category, out var name)) return this.Problem400("General cannot be switched off; please choose a subsidy category.");
        string? reason = null;
        if (req.Off && !StaffUserRules.TryText(req.Reason, 500, required: true, multiline: true, out reason))
            return this.Problem400("Please enter the reason (up to 500 characters).");

        var done = new List<string>();
        var failed = new List<string>();
        foreach (var (database, portal) in Databases)
        {
            try
            {
                await db.ExecuteSqlAsync(SwitchSql(database), new { Off = req.Off, Reason = reason, Actor = UserId, Category = category }, ct);
                done.Add(portal);
            }
            catch (DbException ex)
            {
                log.LogError(ex, "Subsidy category {Category} not switched {State} on {Database}", category, req.Off ? "off" : "on", database);
                failed.Add(portal);
            }
        }
        log.LogInformation("Subsidy category {Category} switched {State} by {Actor} on {Portals} (reason: {Reason})",
            category, req.Off ? "off" : "on", UserId, string.Join(", ", done), reason);
        if (done.Count == 0)
            return this.Problem400("The subsidy could not be switched. Please ask the administrator to apply database migration 0070.");
        var message = $"The {name} subsidy is switched {(req.Off ? "off" : "on")} on {Join(done)}.";
        if (failed.Count > 0) message += $" It could not be changed on {Join(failed)}: please ask the administrator to apply database migration 0070 there.";
        return new MessageResponse(message);
    }

    private static string Join(List<string> names) =>
        names.Count <= 1 ? string.Join("", names) : string.Join(", ", names[..^1]) + " and " + names[^1];
}
