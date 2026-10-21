using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Assessment;
using static Zed.Portal.Features.Staff.SiteAssessment.AssessmentInputs;

namespace Zed.Portal.Features.Staff.SiteAssessment;

/// <summary>
/// Handholding (ZEDCS_CONSULTANCY, ZED_CONSULTANT): the Consultant Organisation (CO, role Agency with the site
/// verification sub-role) accepts or rejects a unit's milestone and names the consultancy team, and the consultants
/// list their milestone 1/2/3 units. Port of the consultancy AssessmentController.SaAllotment (GetList allotmentType
/// SA), AcceptUnitForSa, RejectUnitForSa and RemoteAssessments/{n} (GetList allotmentType RA, @MileStone), all on
/// SP_ASSESSMENT_ALLOT_LIST, SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA and SP_ASSESSMENT_REJECT_UNIT_FOR_SA of ZED_CONSULTANT.
/// <para>
/// What differs from the site allotment of the other systems (<see cref="SiteAssessmentController"/>): one lead
/// consultant, any number of co-consultants (second result set: the CO's consultants) and technical experts (third
/// set: the CO's RoleId 33 users), Baseline Diagnostic Study dates and, for milestone 1 only, Handholding Action Plan
/// dates instead of one assessment date; the mode is always "Onsite Assessment". The old actions had no role check,
/// took every value from the browser and updated any ZED ID; here the unit must be in the signed-in CO's list, every
/// person must be the CO's own user, the lead cannot also be a co-consultant, and the dates are checked. The old mails
/// sent each co-consultant's password (#35); these do not.
/// </para>
/// <para>
/// The milestone lists close C9 for the list itself: the RA branch matches co-consultants with
/// <c>CoAssessorId LIKE '%'+@UserId+'%'</c>, so ZEDCC101 also saw ZEDCC1019's units; rows are kept only when the
/// signed-in consultant is the lead or exactly one of the comma-separated co-consultants.
/// </para>
/// </summary>
[Route("api/staff/site-assessment/consultancy")]
[PortalSystems(PortalSystem.Consultancy)]
public sealed class ConsultancyAllotmentController(ISqlExecutor db, ILogger<ConsultancyAllotmentController> log) : StaffApiController
{
    /// <summary>MsmeCertifications.CoAssessorId is varchar(1000), and so is the procedure's @CoAssessorId.</summary>
    public const int MaxCoConsultantsCsv = 1000;

    /// <summary>MsmeCertifications.TechExpert is varchar(100) (the procedure's @TechnicalExperts allows 1000, the UPDATE would fail).</summary>
    public const int MaxTechnicalExpertsCsv = 100;

    /// <summary>SP_ASSESSMENT_REJECT_UNIT_FOR_SA @ReasonForRejection is varchar(100).</summary>
    public const int MaxReason = 100;

    private static readonly string[] AllotmentFields =
    [
        "ZedId", "Certification", "NcCount", "PUnitName", "EnterpriseName", "UnitAddress",
        "UnitSpocName", "UnitSpocMobileNo", "UnitSpocEmailId",
        "SiteAssessorId", "SaAssessorName", "CoAssessorId", "TechExpert",
        "BdsFromDate", "BdsToDate", "HapFromDate", "HapToDate",
        "ReasonForRejection", "CertificationStatus", "RowNumber",
    ];

    private static readonly string[] MilestoneFields =
    [
        "ZedId", "Certification", "NcCount", "EnterpriseName", "PUnitName", "UnitAddress",
        "UnitSpocName", "UnitSpocMobileNo", "UnitSpocEmailId",
        "AgencyName", "CertificationBodyUserId", "ModeOfAssessment", "AssessmentDate",
        "BdsFromDate", "BdsToDate", "HapFromDate", "HapToDate", "CertificationStatus", "RowNumber",
    ];

    /// <summary>The units the consultant may see in a milestone list (exact lead or co-consultant id checked in code).</summary>
    public const string MilestoneMembershipSql =
        "SELECT ZedId, Certification, SiteAssessorId, CoAssessorId FROM MsmeCertifications " +
        "WHERE NcCount = @Milestone AND (SiteAssessorId = @UserId OR CoAssessorId LIKE @CoPattern)";

    public sealed record Person(string UserId, string UserName);

    public sealed record AllotmentsResponse(
        IReadOnlyList<Dictionary<string, object?>> Units, IReadOnlyList<Person> Consultants, IReadOnlyList<Person> TechnicalExperts);

    public sealed record AllotRequest(
        string? ZedId, string? Certification, string? LeadConsultantId,
        IReadOnlyList<string>? CoConsultantIds, IReadOnlyList<string>? TechnicalExpertIds,
        string? BdsFromDate, string? BdsToDate, string? HapFromDate, string? HapToDate);

    public sealed record RejectRequest(string? ZedId, string? Certification, string? ReasonForRejection);

    /// <summary>Units allotted to the signed-in CO and waiting for (re-)allotment of their milestone, with the CO's team.</summary>
    [HttpGet("allotments")]
    [StaffRoles(UserRole.Agency)]
    [SubRole(SubRoles.SiteVerification)]
    public async Task<ActionResult<AllotmentsResponse>> Allotments(CancellationToken ct)
    {
        var sets = await ListAsync(null, null, ct);
        var consultants = People(sets[1]);
        var experts = People(sets[2]);
        var units = sets[0].Select(r =>
        {
            var d = Pick([r], AllotmentFields)[0];
            var co = SplitIds(r.Text("CoAssessorId"));
            var te = SplitIds(r.Text("TechExpert"));
            d["CoConsultantIds"] = co;
            d["TechnicalExpertIds"] = te;
            d["CoConsultantNames"] = Names(co, consultants);
            d["TechnicalExpertNames"] = Names(te, experts);
            return d;
        }).ToList();
        return new AllotmentsResponse(units, consultants, experts);
    }

    /// <summary>Accepts the unit's current milestone and names the consultancy team (also used to re-allot).</summary>
    [HttpPost("allotments")]
    [StaffRoles(UserRole.Agency)]
    [SubRole(SubRoles.SiteVerification)]
    public async Task<ActionResult<MessageResponse>> Allot(AllotRequest req, CancellationToken ct)
    {
        var zedId = req.ZedId?.Trim();
        var certification = Level(req.Certification, SiteLevels);
        var lead = req.LeadConsultantId?.Trim();
        if (!IsId(zedId) || certification is null || !IsId(lead))
            return this.Problem400("Please select required data.");
        if ((req.CoConsultantIds?.Count ?? 0) > 50 || (req.TechnicalExpertIds?.Count ?? 0) > 50)
            return this.Problem400("Too many consultants selected.");
        var co = Ids(req.CoConsultantIds);
        var experts = Ids(req.TechnicalExpertIds);
        if (co is null || experts is null)
            return this.Problem400("Please select valid data.");
        if (co.Contains(lead!, StringComparer.OrdinalIgnoreCase))
            return this.Problem400("The Lead Consultant cannot also be a Co-consultant.");

        var sets = await ListAsync(zedId, certification, ct);
        var unit = sets[0].FirstOrDefault(r => Same(r, "ZedId", zedId!) && Same(r, "Certification", certification));
        if (unit is null)
            return NotFound();
        if (unit.Text("SiteAssessorId").Length == 0 && unit.Text("ReasonForRejection").Length > 0)
            return this.Problem400("This unit has been rejected and cannot be allotted.");
        var milestone = Int(unit, "NcCount");
        if (milestone is < 1 or > 3)
            return this.Problem400("This unit cannot be allotted.");

        var (dates, dateError) = Dates(req, milestone);
        if (dateError is not null) return this.Problem400(dateError);

        var consultants = People(sets[1]);
        var technical = People(sets[2]);
        if (!Contains(consultants, lead!) || co.Any(c => !Contains(consultants, c)))
            return this.Problem400("Please select consultants of your Consultant Organisation.");
        if (experts.Any(e => !Contains(technical, e)))
            return this.Problem400("Please select technical experts of your Consultant Organisation.");

        // The procedure stores the lists as CSV in MsmeCertifications and splits them into AllotedCoAssessors / AllotedTechExperts.
        var coCsv = co.Count == 0 ? null : string.Join(',', co.Select(c => Canonical(consultants, c)));
        var expertsCsv = experts.Count == 0 ? null : string.Join(',', experts.Select(e => Canonical(technical, e)));
        if (coCsv?.Length > MaxCoConsultantsCsv) return this.Problem400("Too many co-consultants selected.");
        if (expertsCsv?.Length > MaxTechnicalExpertsCsv) return this.Problem400("Too many technical experts selected.");

        try
        {
            await db.ExecuteProcAsync("SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA", new
            {
                ZedId = zedId,
                Certification = certification,
                SiteAssessorId = Canonical(consultants, lead!),
                CoAssessorId = coCsv,
                TechnicalExperts = expertsCsv,
                BdsFromDate = dates!.BdsFrom,
                BdsToDate = dates.BdsTo,
                HapFromDate = dates.HapFrom,
                HapToDate = dates.HapTo,
                ModeOfAssessment = SiteAssessmentController.Onsite,
            }, ct);
        }
        catch (Microsoft.Data.SqlClient.SqlException ex)
        {
            log.LogError(ex, "Consultancy allotment failed for {ZedId} {Certification} milestone {Milestone}", zedId, certification, milestone);
            return this.Problem400("Unable to allot the unit. Please try again.");
        }

        log.LogInformation("CO {UserId} allotted {ZedId} {Certification} milestone {Milestone} to {Lead} (+{Co} co-consultants, {Experts} experts)",
            UserId, zedId, certification, milestone, lead, co.Count, experts.Count);
        await ConsultancyAllotmentEmails.Create(HttpContext.RequestServices).SendAllottedAsync(zedId!, certification, ct);
        return new MessageResponse("Unit allotted.");
    }

    /// <summary>Returns a unit's milestone to the programme team (only before the CO has allotted it).</summary>
    [HttpPost("allotments/reject")]
    [StaffRoles(UserRole.Agency)]
    [SubRole(SubRoles.SiteVerification)]
    public async Task<ActionResult<MessageResponse>> Reject(RejectRequest req, CancellationToken ct)
    {
        var zedId = req.ZedId?.Trim();
        var certification = Level(req.Certification, SiteLevels);
        var reason = req.ReasonForRejection?.Trim();
        if (!IsId(zedId) || certification is null)
            return this.Problem400("Please select valid data.");
        if (string.IsNullOrEmpty(reason))
            return this.Problem400("Please enter the reason for rejection.");
        if (reason.Any(c => char.IsControl(c) && c is not '\r' and not '\n'))
            return this.Problem400("Please enter a valid reason for rejection.");
        if (reason.Length > MaxReason)
            return this.Problem400($"The reason can be at most {MaxReason} characters.");

        var sets = await ListAsync(zedId, certification, ct);
        var unit = sets[0].FirstOrDefault(r => Same(r, "ZedId", zedId!) && Same(r, "Certification", certification));
        if (unit is null)
            return NotFound();
        // The old page offered REJECT only before the first allotment and only once.
        if (unit.Text("SiteAssessorId").Length > 0 || unit.Text("ReasonForRejection").Length > 0)
            return this.Problem400("This unit can no longer be rejected.");

        await db.ExecuteProcAsync("SP_ASSESSMENT_REJECT_UNIT_FOR_SA", new { ZedId = zedId, Certification = certification, ReasonForRejection = reason }, ct);
        log.LogInformation("CO {UserId} rejected {ZedId} {Certification} milestone {Milestone}", UserId, zedId, certification, unit.Text("NcCount"));
        await ConsultancyAllotmentEmails.Create(HttpContext.RequestServices)
            .SendRejectedAsync(zedId!, certification, UserId, unit.Text("NcCount"), reason, ct);
        return new MessageResponse("Unit rejected.");
    }

    /// <summary>Milestone n units of the signed-in consultant (lead or co-consultant), not yet final-submitted (status &lt; 15).</summary>
    [HttpGet("milestones/{milestone:int}")]
    [StaffRoles(UserRole.DesktopAssessor)]
    [SubRole(SubRoles.SiteVerification)]
    public async Task<ActionResult<IReadOnlyList<Dictionary<string, object?>>>> Milestone(int milestone, CancellationToken ct)
    {
        if (milestone is < 1 or > 3) return NotFound();
        var sets = await db.QueryProcMultipleAsync("SP_ASSESSMENT_ALLOT_LIST",
            new { UserId, RoleId = ((int)UserRole.DesktopAssessor).ToString(), AllotmentType = "RA", Milestone = milestone }, ct);

        var members = await db.QuerySqlAsync<MembershipRow>(MilestoneMembershipSql, new
        {
            Milestone = milestone,
            UserId = AssessmentInput.Ansi(UserId),
            CoPattern = AssessmentInput.Ansi("%" + UserId + "%", 60),
        }, ct);
        var roles = new Dictionary<(string, string), string>();
        foreach (var m in members)
        {
            var key = ((m.ZedId ?? "").Trim().ToUpperInvariant(), (m.Certification ?? "").Trim().ToUpperInvariant());
            if (string.Equals(m.SiteAssessorId?.Trim(), UserId, StringComparison.OrdinalIgnoreCase)) roles[key] = "Lead Consultant";
            else if (SplitIds(m.CoAssessorId).Contains(UserId, StringComparer.OrdinalIgnoreCase)) roles.TryAdd(key, "Co-consultant");
        }

        return sets[0]
            .Where(r => roles.ContainsKey((r.Text("ZedId").Trim().ToUpperInvariant(), r.Text("Certification").Trim().ToUpperInvariant())))
            .Select(r =>
            {
                var d = Pick([r], MilestoneFields)[0];
                d["ConsultantRole"] = roles[(r.Text("ZedId").Trim().ToUpperInvariant(), r.Text("Certification").Trim().ToUpperInvariant())];
                return d;
            }).ToList();
    }

    // ------------------------------------------------------------------ helpers

    public sealed class MembershipRow
    {
        public string? ZedId { get; init; }
        public string? Certification { get; init; }
        public string? SiteAssessorId { get; init; }
        public string? CoAssessorId { get; init; }
    }

    private sealed record DateValues(string BdsFrom, string BdsTo, string? HapFrom, string? HapTo);

    /// <summary>SA branch: CertificationBodyUserId = the signed-in CO, status below 9 (sets: units, consultants, technical experts).</summary>
    private Task<ResultSets> ListAsync(string? zedId, string? certification, CancellationToken ct) =>
        db.QueryProcMultipleAsync("SP_ASSESSMENT_ALLOT_LIST", new
        {
            UserId,
            RoleId = ((int)UserRole.Agency).ToString(),
            AllotmentType = "SA",
            ZedId = zedId,
            CertificationType = certification,
        }, ct);

    private static List<Person> People(IEnumerable<IDictionary<string, object?>> rows) =>
        rows.Select(r => new Person(r.Text("UserId"), r.Text("UserName"))).Where(p => p.UserId.Length > 0).ToList();

    private static bool Contains(IEnumerable<Person> people, string id) =>
        people.Any(p => string.Equals(p.UserId, id, StringComparison.OrdinalIgnoreCase));

    /// <summary>The id as the Users table spells it.</summary>
    private static string Canonical(IEnumerable<Person> people, string id) =>
        people.First(p => string.Equals(p.UserId, id, StringComparison.OrdinalIgnoreCase)).UserId;

    private static string Names(IEnumerable<string> ids, IReadOnlyList<Person> people) =>
        string.Join(", ", ids.Select(id => people.FirstOrDefault(p => string.Equals(p.UserId, id, StringComparison.OrdinalIgnoreCase))?.UserName is { Length: > 0 } n ? n : id));

    /// <summary>Trimmed, de-duplicated ids, or null when one is not an id.</summary>
    private static List<string>? Ids(IReadOnlyList<string>? values)
    {
        var list = new List<string>();
        foreach (var v in values ?? [])
        {
            var id = v?.Trim();
            if (string.IsNullOrEmpty(id)) continue;
            if (!IsId(id)) return null;
            if (!list.Contains(id, StringComparer.OrdinalIgnoreCase)) list.Add(id);
        }
        return list;
    }

    /// <summary>BDS from/to always; HAP from/to for milestone 1 only (the old pop-up hid them for 2 and 3). From today up to a year ahead.</summary>
    private static (DateValues? Dates, string? Error) Dates(AllotRequest req, int milestone)
    {
        var today = DateOnly.FromDateTime(DateTime.Now);
        bool InRange(DateOnly d) => d >= today && d <= today.AddYears(1);

        var bdsFrom = IsoDate(req.BdsFromDate);
        var bdsTo = IsoDate(req.BdsToDate);
        if (bdsFrom is null || bdsTo is null)
            return (null, "Please select the Baseline Diagnostic Study dates.");
        if (!InRange(bdsFrom.Value) || !InRange(bdsTo.Value) || bdsTo < bdsFrom)
            return (null, "Please select valid Baseline Diagnostic Study dates.");
        if (milestone != 1)
            return (new DateValues(bdsFrom.Value.ToString("yyyy-MM-dd"), bdsTo.Value.ToString("yyyy-MM-dd"), null, null), null);

        var hapFrom = IsoDate(req.HapFromDate);
        var hapTo = IsoDate(req.HapToDate);
        if (hapFrom is null || hapTo is null)
            return (null, "Please select the Handholding Action Plan dates.");
        if (!InRange(hapFrom.Value) || !InRange(hapTo.Value) || hapTo < hapFrom)
            return (null, "Please select valid Handholding Action Plan dates.");
        return (new DateValues(bdsFrom.Value.ToString("yyyy-MM-dd"), bdsTo.Value.ToString("yyyy-MM-dd"),
            hapFrom.Value.ToString("yyyy-MM-dd"), hapTo.Value.ToString("yyyy-MM-dd")), null);
    }
}
