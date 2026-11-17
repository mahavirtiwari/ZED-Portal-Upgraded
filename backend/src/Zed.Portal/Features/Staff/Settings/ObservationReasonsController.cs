using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Quality;

namespace Zed.Portal.Features.Staff.Settings;

/// <summary>
/// Admin → Observation reasons (2026-11-17, approved): the reasons the operation admins pick for a quality observation and the
/// severity each carries, per system (<see cref="ObservationReasons"/>), through the portal switch of the main portal. The page
/// shows how often each reason was used (the observations keep the wording they were raised with).
/// </summary>
[Route("api/staff/settings/observation-reasons")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class ObservationReasonsController(IPortalSettings settings, ISqlExecutor db, PortalHost host, ILogger<ObservationReasonsController> log)
    : StaffApiController
{
    /// <param name="Used">Observations raised with each wording (case-insensitive).</param>
    public sealed record ReasonsResponse(IReadOnlyList<ObservationReason> Reasons, IReadOnlyList<string> Severities, IReadOnlyDictionary<string, int> Used,
        bool Customised, bool Handholding);

    public sealed record ReasonsRequest(IReadOnlyList<ObservationReason>? Reasons);

    public sealed record UsedRow(string? Category, int Count);

    internal const string UsedSql =
        "SELECT QoCategory AS Category, COUNT(*) AS Count FROM dbo.AssessorComments WHERE AssessmentType = 'QualityObs' GROUP BY QoCategory;";

    private bool Handholding => host.System == PortalSystem.Consultancy;

    [HttpGet]
    public async Task<ReasonsResponse> Get(CancellationToken ct)
    {
        var used = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var r in await db.QuerySqlAsync<UsedRow>(UsedSql, null, ct))
                if (!string.IsNullOrWhiteSpace(r.Category)) used[r.Category.Trim()] = used.GetValueOrDefault(r.Category.Trim()) + r.Count;
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "Quality observations not readable (is migration 0088 applied?)");
        }
        return new ReasonsResponse(await ObservationReasons.LoadAsync(settings, Handholding, ct), QualityObservations.Severities, used,
            !string.IsNullOrWhiteSpace(await settings.GetAsync(ObservationReasons.Key, ct)), Handholding);
    }

    [HttpPut]
    public async Task<ActionResult<MessageResponse>> Save(ReasonsRequest req, CancellationToken ct)
    {
        if (ObservationReasons.Problem(req.Reasons) is { } problem) return this.Problem400(problem);
        try
        {
            await ObservationReasons.SaveAsync(settings, req.Reasons!, UserId, ct);
        }
        catch (SqlException ex)
        {
            log.LogError(ex, "Could not save the observation reasons (is migration 0011 applied?)");
            return this.Problem400("The reasons could not be saved. Please ask the administrator to apply database migration 0011.");
        }
        log.LogInformation("Observation reasons saved by {UserId}: {Count} reasons, {Active} in use", UserId, req.Reasons!.Count, req.Reasons.Count(r => r.Active));
        return new MessageResponse("Observation reasons saved.");
    }

    [HttpDelete]
    public async Task<ActionResult<MessageResponse>> Reset(CancellationToken ct)
    {
        await settings.SetAsync(ObservationReasons.Key, null, UserId, ct);
        log.LogInformation("Observation reasons reset to the standard ones by {UserId}", UserId);
        return new MessageResponse("Observation reasons reset to the standard ones.");
    }
}
