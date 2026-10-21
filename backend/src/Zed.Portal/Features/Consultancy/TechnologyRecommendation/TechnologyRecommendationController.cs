using System.Data.Common;
using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Schemes;

namespace Zed.Portal.Features.Consultancy.TechnologyRecommendation;

/// <summary>
/// "Recommend / View Recommended Technologies" after Handholding milestone 3 (consultancy TechnologyController,
/// Frontend/Technology/Index.cshtml, opened from the Completed list): the unit's lead consultant picks 1 to 10 of the
/// technologies for the unit's sector (SP_TECHNOLOGIES_GET_LIST); SP_TECHNOLOGIES_INSERT_TECHNOLOGIES_FOR_UNIT writes
/// RecommandedTechnologies, sets Msme.TechnologyUpgradation = 1 and MsmeCertifications.TuStatus = 1, records the
/// history and mails the unit itself (SP_SEND_AUTO_MAIL_TO_UNIT_FOR_TECHNOLOGY_UPGRADATIONS, Database Mail), which
/// opens the TU application on main. The CO of the unit and the master admin see the recommendation afterwards.
/// <para>
/// The legacy actions had no filter (finding #89): anyone could replace any unit's recommendation (the gate for the
/// TU subsidy) by passing a ZED ID, certification and CertId. Here the milestone-3 record is read on the server, only
/// its lead consultant may recommend, only once, only after the MSME accepted milestone 3 (CertificationStatus 100,
/// as the legacy button), only while no other TU application of the unit is in progress, and only codes the
/// procedure offers for the unit.
/// </para>
/// </summary>
[Route("api/staff/consultancy/technology")]
[StaffRoles(UserRole.MasterAdmin, UserRole.Agency, UserRole.DesktopAssessor)]
[PortalSystems(PortalSystem.Consultancy)]
public sealed class TechnologyRecommendationController(ISqlExecutor db, ILogger<TechnologyRecommendationController> log) : StaffApiController
{
    public const int MaxSelection = 10;
    /// <summary>MsmeCertifications.CertificationStatus once the MSME accepted the milestone (SP_MONITORING_RA_APPLICANT_ACCEPTANCE).</summary>
    public const int Accepted = 100;

    /// <summary>The milestone-3 handholding record of the unit (no procedure returns it with the CO and the lead consultant).</summary>
    public const string MilestoneSql =
        "SELECT TOP 1 Id, ZedId, Certification, NcCount, CertificationStatus, TuStatus, SiteAssessorId, CertificationBodyUserId " +
        "FROM MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Certification AND NcCount = 3 ORDER BY Id DESC";

    public sealed class MilestoneRow
    {
        public int Id { get; set; }
        public string? ZedId { get; set; }
        public string? Certification { get; set; }
        public int? NcCount { get; set; }
        public int? CertificationStatus { get; set; }
        public int? TuStatus { get; set; }
        public string? SiteAssessorId { get; set; }
        public string? CertificationBodyUserId { get; set; }
    }

    public sealed record TechnologyDto(string Code, string Name, string? Description, bool Selected);

    public sealed record PageResponse(
        string ZedId, string Certification, bool Recommended, bool CanRecommend, string? Message, int MaxSelection,
        IReadOnlyList<TechnologyDto> Technologies);

    /// <summary>GET api/staff/consultancy/technology/{zedId}/{level} — the technologies offered for the unit, and what was recommended.</summary>
    [HttpGet("{zedId}/{level}")]
    public async Task<ActionResult<PageResponse>> Get(string zedId, string level, CancellationToken ct)
    {
        var (m, refused) = await MilestoneAsync(zedId, level, ct);
        if (m is null) return refused!;
        var (list, inProgress) = await ListAsync(m, ct);
        var recommended = m.TuStatus is > 0 || list.Any(t => t.Selected);
        var (can, message) = CanRecommend(m, recommended, inProgress);
        // Before the recommendation only the lead consultant sees the list (the procedure returns it to others once TuStatus is 1).
        var shown = recommended ? list.Where(t => t.Selected).ToList() : can || IsLead(m) ? list : [];
        return new PageResponse(m.ZedId ?? zedId, m.Certification ?? level, recommended, can, message, MaxSelection, shown);
    }

    public sealed record RecommendRequest(IReadOnlyList<string>? Codes, bool Confirmed);

    /// <summary>POST api/staff/consultancy/technology/{zedId}/{level} — the lead consultant's recommendation (SP_TECHNOLOGIES_INSERT_TECHNOLOGIES_FOR_UNIT).</summary>
    [HttpPost("{zedId}/{level}")]
    [StaffRoles(UserRole.DesktopAssessor)]
    public async Task<ActionResult<MessageResponse>> Recommend(string zedId, string level, RecommendRequest req, CancellationToken ct)
    {
        if (!req.Confirmed) return this.Problem400("Please confirm the declaration.");
        var codes = (req.Codes ?? []).Select(c => c?.Trim() ?? "").Where(c => c.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (codes.Count is 0 or > MaxSelection) return this.Problem400("Select minimum 1 and maximum 10 technologies for recommendation.");

        using (await SchemeLocks.EnterAsync(ct))
        {
            var (m, refused) = await MilestoneAsync(zedId, level, ct);
            if (m is null) return refused!;
            var (list, inProgress) = await ListAsync(m, ct);
            var (can, message) = CanRecommend(m, m.TuStatus is > 0 || list.Any(t => t.Selected), inProgress);
            if (!can) return this.Problem400(message ?? "Technologies cannot be recommended for this unit.");
            var offered = list.ToDictionary(t => t.Code, StringComparer.OrdinalIgnoreCase);
            if (codes.Any(c => !offered.ContainsKey(c))) return this.Problem400("Please select valid technologies.");
            var selected = string.Join(',', codes.Select(c => offered[c].Code));
            if (selected.Length > 500) return this.Problem400("Please select fewer technologies.");

            try
            {
                await db.ExecuteProcAsync("SP_TECHNOLOGIES_INSERT_TECHNOLOGIES_FOR_UNIT", new
                {
                    ZedId = m.ZedId,
                    Certification = m.Certification,
                    CertId = m.Id.ToString(CultureInfo.InvariantCulture),
                    SelectedCode = selected,
                    UserId,
                    Roleid = RoleId.ToString(CultureInfo.InvariantCulture),
                }, ct);
            }
            catch (DbException ex)
            {
                log.LogError(ex, "SP_TECHNOLOGIES_INSERT_TECHNOLOGIES_FOR_UNIT failed for {ZedId}/{Level}", m.ZedId, m.Certification);
                return this.Problem400("The technologies could not be saved. Please try again.");
            }
            log.LogInformation("Technologies {Codes} recommended for {ZedId}/{Level} by {UserId}", selected, m.ZedId, m.Certification, UserId);
        }
        return new MessageResponse("Selected Technologies updated.");
    }

    private bool IsLead(MilestoneRow m) =>
        RoleId == (int)UserRole.DesktopAssessor && SchemeRows.Same(m.SiteAssessorId, UserId);

    private (bool Can, string? Message) CanRecommend(MilestoneRow m, bool recommended, string? inProgress)
    {
        if (!IsLead(m)) return (false, recommended ? null : "The technologies have not been recommended yet.");
        if (recommended) return (false, null);
        if (m.CertificationStatus != Accepted) return (false, "Technologies can be recommended once the unit has accepted Milestone 3.");
        if (m.TuStatus is >= 98) return (false, "Technologies cannot be recommended for this unit.");
        if (!string.IsNullOrWhiteSpace(inProgress)) return (false, inProgress);
        return (true, null);
    }

    /// <summary>The unit's milestone-3 record, if the signed-in user is its lead consultant, its CO or the master admin.</summary>
    private async Task<(MilestoneRow? Row, ActionResult? Refused)> MilestoneAsync(string zedId, string level, CancellationToken ct)
    {
        if (!SchemeRows.IsZedId(zedId) || FaApplications.Canonical(level) is not { } cert) return (null, NotFound());
        var user = CurrentUser;
        if (user.RoleId != (int)UserRole.MasterAdmin && !user.HasSubRole(SubRoles.SiteVerification)) return (null, Forbid());
        var m = (await db.QuerySqlAsync<MilestoneRow>(MilestoneSql, new { ZedId = zedId, Certification = cert }, ct)).FirstOrDefault();
        if (m is null || m.NcCount != 3) return (null, NotFound());
        var allowed = user.RoleId switch
        {
            (int)UserRole.MasterAdmin => true,
            (int)UserRole.Agency => SchemeRows.Same(m.CertificationBodyUserId, user.UserId),
            (int)UserRole.DesktopAssessor => SchemeRows.Same(m.SiteAssessorId, user.UserId),
            _ => false,
        };
        if (!allowed)
        {
            log.LogWarning("Technology recommendation of {ZedId}/{Level} refused for {UserId}", zedId, cert, user.UserId);
            return (null, NotFound());
        }
        m.ZedId ??= zedId;
        m.Certification ??= cert;
        return (m, null);
    }

    /// <summary>SP_TECHNOLOGIES_GET_LIST: set 0 the technologies (IsSelected Yes/No), set 1 PreviousRecomInProgress.</summary>
    private async Task<(List<TechnologyDto> List, string? InProgress)> ListAsync(MilestoneRow m, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_TECHNOLOGIES_GET_LIST", new
        {
            ZedId = m.ZedId,
            Certification = m.Certification,
            CertId = m.Id.ToString(CultureInfo.InvariantCulture),
            UserId,
            Roleid = RoleId.ToString(CultureInfo.InvariantCulture),
        }, ct);
        var list = sets[0]
            .Select(r => new TechnologyDto(r.Text("TechnologyCode"), r.Text("TechnologyName"),
                r.Text("Description") is { Length: > 0 } d ? d : null, r.Text("IsSelected") == "Yes"))
            .Where(t => t.Code.Length > 0)
            .ToList();
        return (list, sets[1].FirstOrDefault()?.Text("PreviousRecomInProgress"));
    }
}
