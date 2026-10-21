using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Assessment;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Portal.Features.Staff.MsmeProfile;

/// <summary>
/// Staff "View Profile" of a unit: port of MsmeController.Profile / GetProfileDetails (SP_ASSESSMENT_VIEW_PROFILE), which
/// all three legacy portals had and which V4's staff lists still opened on the old site. Served by every host (the
/// procedure is identical in the three databases).
/// <para>
/// Who may see a unit, as on the DA details page (<see cref="CertificationRecord.CanView"/>): MasterAdmin, SuperAdmin,
/// Ministry, CitizenFeedback and QC any unit; an agency only units allotted to it; an assessor only units it is desktop,
/// site or co-assessor of (on Consultancy also a co-consultant or technical expert of the allotment). The legacy action
/// only required a sign-in: Admin and StateCoordinator accounts could read any unit, and its procedure was the only check.
/// Only the fields of the old page are returned; the PAN is masked.
/// </para>
/// </summary>
[Route("api/staff/msme-profile")]
[StaffRoles(UserRole.MasterAdmin, UserRole.SuperAdmin, UserRole.Ministry, UserRole.CitizenFeedback, UserRole.QC, UserRole.Agency, UserRole.DesktopAssessor)]
[PortalSystems(PortalSystem.Main, PortalSystem.Consultancy, PortalSystem.Surveillance)]
public sealed class StaffMsmeProfileController(ISqlExecutor db, PortalHost host, ILogger<StaffMsmeProfileController> log) : StaffApiController
{
    /// <summary>Unit fields of Views/Msme/Profile.cshtml (Msme).</summary>
    public static readonly string[] UnitFields =
    [
        "ZedId", "PUnitName", "PAddress", "PDistrictName", "PStateName", "PPin", "Activity", "TwoDigitActivity", "FourDigitActivity",
        "FiveDigitActivity", "IncorporationDate", "WhetherProdCommenced",
    ];

    /// <summary>Enterprise fields of the page (MsmeBasicInformation).</summary>
    public static readonly string[] BasicFields =
    [
        "UdyogAadharNo", "EnterpriseName", "OwnerName", "OrganisationTypeName", "SocialCategoryName", "Gender", "PH", "Address",
        "StateName", "DistrictName", "Pincode", "MobileNo", "EmailId", "MajorActivityName", "EnterpriseTypee", "CommmenceDate",
        "TotalEmp", "DicName", "AppliedDate",
    ];

    public sealed record ProfileResponse(Dictionary<string, object?> Unit, Dictionary<string, object?> Enterprise, IReadOnlyList<string> Certifications);

    private sealed class Allotment
    {
        public string? Certification { get; init; }
        public string? CertificationBodyUserId { get; init; }
        public string? DesktopAssessorId { get; init; }
        public string? SiteAssessorId { get; init; }
        public string? CoAssessorId { get; init; }
    }

    [HttpGet("{zedId}")]
    public async Task<ActionResult<ProfileResponse>> Get(string zedId, CancellationToken ct)
    {
        if (!AssessmentInput.IsId(zedId)) return this.Problem400("Invalid ZED ID.");
        var id = AssessmentInput.BaseZedId(zedId);

        var allotments = await db.QuerySqlAsync<Allotment>(
            "SELECT Certification, CertificationBodyUserId, DesktopAssessorId, SiteAssessorId, CoAssessorId FROM MsmeCertifications WHERE ZedId = @ZedId",
            new { ZedId = AssessmentInput.Ansi(id) }, ct);
        var access = await AccessAsync(id, allotments, ct);
        if (access == Access.None)
        {
            log.LogWarning("{UserId} (role {RoleId}) was refused the profile of {ZedId}", UserId, RoleId, id);
            return NotFound();
        }

        IDictionary<string, object?>? unit, basic;
        if (access == Access.Procedure)
        {
            var sets = await db.QueryProcMultipleAsync("SP_ASSESSMENT_VIEW_PROFILE", new { ZedId = id, UserId, RoleId = RoleId.ToString() }, ct);
            (unit, basic) = (sets[0].FirstOrDefault(), sets[1].FirstOrDefault());
        }
        else
        {
            // The procedure only knows the lead / single co-assessor columns of MsmeCertifications and would blank the
            // unit for the other co-consultants and technical experts; read the same columns directly.
            var p = new { ZedId = AssessmentInput.Ansi(id) };
            unit = ToRow((await db.QuerySqlAsync<object>(
                "SELECT " + string.Join(", ", UnitFields) + " FROM Msme WHERE ZedId = @ZedId", p, ct)).FirstOrDefault());
            basic = ToRow((await db.QuerySqlAsync<object>(
                "SELECT " + string.Join(", ", BasicFields.Append("PanNo")) + " FROM MsmeBasicInformation WHERE ZedId = @ZedId", p, ct)).FirstOrDefault());
        }
        if (unit is null || !string.Equals(unit.Text("ZedId"), id, StringComparison.OrdinalIgnoreCase)) return NotFound();

        var enterprise = StaffUserRules.Pick(basic ?? new Dictionary<string, object?>(), BasicFields);
        enterprise["PanNo"] = StaffUserRules.MaskIdProof(basic?.Text("PanNo"));
        return new ProfileResponse(StaffUserRules.Pick(unit, UnitFields), enterprise,
            allotments.Select(a => a.Certification ?? "").Where(c => c.Length > 0).Distinct().ToList());
    }

    private enum Access { None, Procedure, CoConsultant }

    /// <summary>A row of an untyped inline query (Dapper's row is a dictionary).</summary>
    private static IDictionary<string, object?>? ToRow(object? row) => row switch
    {
        IDictionary<string, object?> d => d,
        System.Text.Json.JsonElement { ValueKind: System.Text.Json.JsonValueKind.Object } e =>
            e.EnumerateObject().ToDictionary(p => p.Name, p => (object?)(p.Value.ValueKind == System.Text.Json.JsonValueKind.Null ? null : p.Value.ToString())),
        _ => null,
    };

    private async Task<Access> AccessAsync(string zedId, IReadOnlyList<Allotment> allotments, CancellationToken ct)
    {
        var user = CurrentUser;
        if ((UserRole)user.RoleId is UserRole.MasterAdmin or UserRole.SuperAdmin or UserRole.Ministry or UserRole.CitizenFeedback or UserRole.QC)
            return Access.Procedure;
        static bool Is(string? column, string userId) =>
            !string.IsNullOrEmpty(column) && string.Equals(column.Trim(), userId, StringComparison.OrdinalIgnoreCase);
        if (allotments.Any(a => user.RoleId == (int)UserRole.Agency
                ? Is(a.CertificationBodyUserId, user.UserId)
                : Is(a.DesktopAssessorId, user.UserId) || Is(a.SiteAssessorId, user.UserId) || Is(a.CoAssessorId, user.UserId)))
            return Access.Procedure;
        if (host.System != PortalSystem.Consultancy || user.RoleId != (int)UserRole.DesktopAssessor) return Access.None;

        // Consultancy: further co-consultants and technical experts of the allotment (exact ids, not LIKE).
        var extra = await db.QuerySqlAsync<int>(
            "SELECT (SELECT COUNT(*) FROM AllotedCoAssessors WHERE ZedId = @ZedId AND CoAssessorId = @UserId) + " +
            "(SELECT COUNT(*) FROM AllotedTechExperts WHERE ZedId = @ZedId AND TechExpertId = @UserId)",
            new { ZedId = AssessmentInput.Ansi(zedId), UserId = AssessmentInput.Ansi(user.UserId) }, ct);
        return extra.FirstOrDefault() > 0 ? Access.CoConsultant : Access.None;
    }
}
