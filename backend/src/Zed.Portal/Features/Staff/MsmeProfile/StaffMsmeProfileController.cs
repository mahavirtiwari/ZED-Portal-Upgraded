using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Staff.Assessment;
using Zed.Portal.Features.Staff.Masters;
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
/// Only the fields of the old page are returned; the PAN is masked. The SuperAdmin can also edit the names, e-mail, unit
/// name and NIC codes (Main only, <see cref="Update"/>).
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

    // ---- SuperAdmin "EDIT PROFILE" (Main only) ----------------------------------------------------------------

    /// <summary>NIC 2-digit options of the edit form, as the legacy drop-down ("{SectorCode}-{SectorName}" of SP_MASTER_GET_SECTORS).</summary>
    [HttpGet("sectors")]
    [StaffRoles(UserRole.SuperAdmin)]
    [SystemOnly(PortalSystem.Main)]
    public async Task<IReadOnlyList<string>> Sectors(CancellationToken ct) => await LoadSectorsAsync(ct);

    public sealed record UpdateRequest(
        string? OwnerName, string? EnterpriseName, string? EmailId, string? PUnitName,
        string? TwoDigitActivity, string? FourDigitActivity, string? FiveDigitActivity);

    /// <summary>Current values of the editable fields (the page shows the names and e-mail of MsmeBasicInformation).</summary>
    private sealed class EditableValues
    {
        public string? OwnerName { get; init; }
        public string? EnterpriseName { get; init; }
        public string? EmailId { get; init; }
        public string? PUnitName { get; init; }
        public string? TwoDigitActivity { get; init; }
        public string? FourDigitActivity { get; init; }
        public string? FiveDigitActivity { get; init; }
    }

    /// <summary>
    /// Port of MsmeController.UpdateProfile (SP_MSME_UPDATE_PROFILE), the SuperAdmin's EDIT PROFILE on Msme/Profile. The
    /// procedure copies the unit to MsmeUpdatedRecords / MsmeBasicInformationUpdatedRecords, updates Msme,
    /// MsmeBasicInformation and the MSME login, and the same unit in ZED_CONSULTANT and ZED_SURVEILLANCE; it does nothing
    /// for any other RoleId. Only the main database has this version, hence Main only. The legacy action had no role
    /// check of its own and no validation; here the fields are checked as the old inputs (maxlength) and the procedure's
    /// parameter sizes, and an empty NIC field keeps the stored code, as the procedure does.
    /// </summary>
    [HttpPut("{zedId}")]
    [StaffRoles(UserRole.SuperAdmin)]
    [SystemOnly(PortalSystem.Main)]
    public async Task<ActionResult<MessageResponse>> Update(string zedId, UpdateRequest req, CancellationToken ct)
    {
        if (!AssessmentInput.IsId(zedId) || AssessmentInput.BaseZedId(zedId) != zedId) return this.Problem400("Invalid ZED ID.");
        if (!StaffUserRules.TryText(req.OwnerName, 200, true, false, out var owner)) return this.Problem400("Please enter the Owner Name (up to 200 characters).");
        if (!StaffUserRules.TryText(req.EnterpriseName, 250, true, false, out var enterprise)) return this.Problem400("Please enter the Enterprise Name (up to 250 characters).");
        var email = req.EmailId?.Trim();
        if (!StaffUserRules.IsEmail(email)) return this.Problem400("Please enter a valid Email Id.");
        if (!StaffUserRules.TryText(req.PUnitName, 250, true, false, out var unitName)) return this.Problem400("Please enter the Unit Name (up to 250 characters).");
        if (!StaffUserRules.TryText(req.FourDigitActivity, 250, false, false, out var four)) return this.Problem400("NIC 4 Digit must be at most 250 characters.");
        if (!StaffUserRules.TryText(req.FiveDigitActivity, 250, false, false, out var five)) return this.Problem400("NIC 5 Digit must be at most 250 characters.");

        var current = (await db.QuerySqlAsync<EditableValues>(
            "SELECT b.OwnerName, b.EnterpriseName, b.EmailId, m.PUnitName, m.TwoDigitActivity, m.FourDigitActivity, m.FiveDigitActivity " +
            "FROM Msme m LEFT JOIN MsmeBasicInformation b ON b.ZedId = m.ZedId WHERE m.ZedId = @ZedId",
            new { ZedId = AssessmentInput.Ansi(zedId) }, ct)).FirstOrDefault();
        if (current is null) return NotFound();

        // NIC 2 digit: one of the sectors of the drop-down (or the unit's present value, which may predate the master).
        var two = string.IsNullOrWhiteSpace(req.TwoDigitActivity) ? null : req.TwoDigitActivity.Trim();
        if (two is not null && two != current.TwoDigitActivity?.Trim() && !(await LoadSectorsAsync(ct)).Contains(two))
            return this.Problem400("Please select a valid NIC 2 Digit sector.");

        await db.ExecuteProcAsync("SP_MSME_UPDATE_PROFILE", new
        {
            UserId, RoleId = RoleId.ToString(), ZedId = zedId, OwnerName = owner, EnterpriseName = enterprise, EmailId = email,
            PUnitName = unitName, TwoDigitActivity = two, FourDigitActivity = four, FiveDigitActivity = five,
        }, ct);

        // Who changed what (the procedure keeps the previous rows in the *UpdatedRecords tables).
        var changed = new (string Field, string? Before, string? After)[]
            {
                ("OwnerName", current.OwnerName, owner), ("EnterpriseName", current.EnterpriseName, enterprise), ("EmailId", current.EmailId, email),
                ("PUnitName", current.PUnitName, unitName), ("TwoDigitActivity", current.TwoDigitActivity, two ?? current.TwoDigitActivity),
                ("FourDigitActivity", current.FourDigitActivity, four ?? current.FourDigitActivity),
                ("FiveDigitActivity", current.FiveDigitActivity, five ?? current.FiveDigitActivity),
            }
            .Where(c => !string.Equals(c.Before?.Trim() ?? "", c.After ?? "", StringComparison.Ordinal)).Select(c => c.Field).ToList();
        log.LogWarning("{UserId} (role {RoleId}) updated the profile of {ZedId}; changed: {Fields}",
            UserId, RoleId, zedId, changed.Count == 0 ? "nothing" : string.Join(", ", changed));
        return new MessageResponse("Profile updated.");
    }

    private async Task<List<string>> LoadSectorsAsync(CancellationToken ct) =>
        (await db.QueryProcMultipleAsync("SP_MASTER_GET_SECTORS", null, ct))[0]
            .Select(r => r.Text("SectorCode") + "-" + r.Text("SectorName")).Where(s => s.Length > 1).ToList();

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
