using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Portal.Features.Staff.Dashboard;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// What differs for user management on the Consultancy host (ZED_CONSULTANT, legacy ZEDCS_CONSULTANCY UserController /
/// UserHelper.AddAssessors):
/// <list type="bullet">
/// <item>agencies are "Consultant Organisations" (ZEDCO…), assessors are "Consultants" (RoleId 3, ZEDCC…, found through the
/// professional lookup like main's assessors) or "Technical Experts" (RoleId 33, ZEDCT…, typed in);</item>
/// <item>SP_INSERT_USER / SP_UPDATE_USER have no @AssessorType / @OrgPartnerId (passing them fails with "is not a
/// parameter") and take @TuPreferredState / @TuPreferredDistricts, the state (LGD code, matched against Msme.StateId)
/// and districts a CO with Technology Upgradation verification is auto-allotted from;</item>
/// <item>SP_BLOCK_UNBLOCK_USER and SP_BLOCK_UNBLOCK_BRONZE_AGENCY do not exist there: block / unblock is the legacy
/// inline UPDATE, limited to the user's own role; there are no Bronze assessments and no organising partners.</item>
/// </list>
/// </summary>
public static class ConsultancyUsers
{
    public const int ConsultantRole = 3;
    public const int TechnicalExpertRole = 33;
    public static readonly int[] AssessorRoles = [ConsultantRole, TechnicalExpertRole];

    public const string Consultant = "Consultant";
    public const string TechnicalExpert = "TechnicalExpert";

    /// <summary>@AssessorType the consultancy professional lookup expects for a consultant (the procedure tests <c>@AssessorType=3</c>).</summary>
    public const string LookupAssessorType = "3";

    public static bool IsConsultancy(this PortalHost host) => host.System == PortalSystem.Consultancy;

    public sealed record District(string DistrictCode, string DistrictName);

    /// <summary>States a CO can prefer for Technology Upgradation (value = LGD state code, as Msme.StateId).</summary>
    public static IReadOnlyList<KeyValuePair<string, string>> TuStates =>
        DashboardFilters.States.OrderBy(s => s.Value, StringComparer.Ordinal).ToList();

    /// <summary>Districts of a state (Districts table; the legacy page read it with string-built SQL).</summary>
    public static async Task<List<District>> DistrictsAsync(ISqlExecutor db, string stateCode, CancellationToken ct) =>
        (await db.QuerySqlAsync<District>(
            "SELECT DistrictCode, DistrictName FROM Districts WHERE StateCode = @StateCode ORDER BY DistrictName",
            new { StateCode = stateCode }, ct))
        .Where(d => !string.IsNullOrEmpty(d.DistrictCode)).ToList();

    /// <summary>The CO's Technology Upgradation districts (TuAgencyUserDistricts, written by SP_INSERT_USER / SP_UPDATE_USER).</summary>
    public static async Task<List<string>> TuDistrictsAsync(ISqlExecutor db, string userId, CancellationToken ct) =>
        (await db.QuerySqlAsync<string>(
            "SELECT Districts FROM TuAgencyUserDistricts WHERE UserId = @UserId AND IsActive = 1 ORDER BY Districts",
            new { UserId = userId }, ct))
        .Where(d => !string.IsNullOrEmpty(d)).ToList();

    /// <summary>
    /// Validates the Technology Upgradation preference. Only a CO with Financial (TU) verification has one (the procedures
    /// clear the state otherwise); districts must belong to the chosen state.
    /// </summary>
    public static async Task<(string? State, List<string> Districts, string? Error)> TuPreferenceAsync(
        ISqlExecutor db, bool financialVerification, string? state, IReadOnlyCollection<string>? districts, CancellationToken ct)
    {
        if (!financialVerification) return (null, [], null);
        var code = string.IsNullOrWhiteSpace(state) ? null : state.Trim();
        if (code is null)
            return (districts?.Any(d => !string.IsNullOrWhiteSpace(d)) == true ? (null, [], "Please select the applicable state for the districts.") : (null, [], null));
        if (!DashboardFilters.States.ContainsKey(code)) return (null, [], "Please select a valid applicable state.");
        var allowed = (await DistrictsAsync(db, code, ct)).Select(d => d.DistrictCode);
        var picked = StaffUserRules.OnlyAllowed(districts, allowed);
        return picked is null ? (null, [], "Please select valid districts of the applicable state.") : (code, picked, null);
    }

    /// <summary>
    /// ZED_CONSULTANT's SP_UPDATE_USER (RoleId 2) only updates when the CO keeps Site or Financial verification it already
    /// has; otherwise it deliberately fails ("CANNOT CHANGE THE USER ROLE NOW"). Checked first, with a readable message.
    /// </summary>
    public static string? AgencyUpdateError(ManagedUser existing, bool siteVerification, bool financialVerification) =>
        (StaffUserRules.Bool(existing.Row, "SiteVerification") && siteVerification) ||
        (StaffUserRules.Bool(existing.Row, "FinancialVerification") && financialVerification)
            ? null
            : "The activities of this Consultant Organisation cannot be changed now: keep Handholding Support or Technology Upgradation as it is.";

    /// <summary>Parameters of ZED_CONSULTANT's SP_INSERT_USER / SP_UPDATE_USER (exactly its parameter list).</summary>
    public static object Parameters(
        string? userId, string userName, string? password, int roleId, string? email, string? mobileNo, string createdBy,
        string? spocName, string? address, string? pinCode, IReadOnlyCollection<string> states, IReadOnlyCollection<string> nicSectors,
        IReadOnlyCollection<string> areasOfKnowledge, string? idProofType, string? idProofNumber, string? gstNumber,
        bool desktopVerification, bool siteVerification, bool financialVerification, string? reasonForRejection,
        string? tuPreferredState, IReadOnlyCollection<string> tuPreferredDistricts, string? certificateNo, string? professionalEmail) => new
    {
        UserId = userId,
        UserName = userName,
        Password = password,
        RoleId = roleId,
        Email = email,
        MobileNo = mobileNo,
        CreatedBy = createdBy,
        SpocName = spocName,
        Address = address,
        PinCode = pinCode,
        PreferredStates = StaffUserRules.Csv(states),
        NicSectors = StaffUserRules.Csv(nicSectors),
        AreaOfknowledge = StaffUserRules.Csv(areasOfKnowledge),
        IdProofType = idProofType,
        IdProofNumber = idProofNumber,
        GstNumber = gstNumber,
        DesktopVerification = desktopVerification,
        SiteVerification = siteVerification,
        FinancialVerification = financialVerification,
        ReasonForRejection = reasonForRejection,
        TuPreferredState = tuPreferredState,
        TuPreferredDistricts = StaffUserRules.Csv(tuPreferredDistricts),
        CertificateNo = certificateNo,
        ProfessionalEmail = professionalEmail,
    };

    /// <summary>
    /// Legacy UserHelper.BlockOrUnBlockUser (an inline UPDATE; ZED_CONSULTANT and ZED_SURVEILLANCE have no block procedure),
    /// now limited to the user's own role so it can never touch another kind of account. True when one row changed.
    /// </summary>
    public static async Task<bool> SetActiveAsync(ISqlExecutor db, string userId, string roleId, bool active, string reason, CancellationToken ct) =>
        await db.ExecuteSqlAsync(
            "UPDATE Users SET IsActive = @IsActive, ReasonForRejection = @ReasonForRejection WHERE UserId = @UserId AND RoleId = @RoleId",
            new { IsActive = active, ReasonForRejection = reason, UserId = userId, RoleId = int.Parse(roleId) }, ct) == 1;
}
