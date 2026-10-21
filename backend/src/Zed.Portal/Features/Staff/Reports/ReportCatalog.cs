using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Reports;

public sealed record ReportDefinition(string Id, string Name, string Procedure);

/// <summary>
/// The only reports that can be run: the per-role list of Views/DynamicReports/Index.cshtml.
/// The legacy page posted the procedure name (SpName) from a hidden field and DynamicReportsController ran
/// whatever it received, so any signed-in user of those roles could execute any stored procedure taking
/// RoleId/UserId/UlbCode. Here the browser sends only a report id; the procedure comes from this list and
/// receives the signed-in user's own RoleId and UserId (the procedures scope by them).
/// <para>
/// Each system has its own list (its DynamicReports/Index.cshtml; every procedure checked to exist in that database with
/// @UlbCode, @Userid, @RoleId): ConsultancyEntries and SurveillanceEntries.
/// </para>
/// </summary>
public static class ReportCatalog
{
    private static readonly (UserRole Role, string Name, string Procedure)[] Entries =
    [
        (UserRole.SuperAdmin, "List Of ZED Assessement Agencies", "SP_DYNAMIC_REPORT_LIST_OF_ASSESSMENT_AGENCIES"),
        (UserRole.SuperAdmin, "List Of ZED Asssessors", "SP_DYNAMIC_REPORT_LIST_OF_ZED_ASSESSORS"),
        (UserRole.SuperAdmin, "List of ZED Payment Received", "SP_DYNAMIC_REPORT_LIST_OF_PAYMENT_RECEIVED"),
        (UserRole.SuperAdmin, "List of ZED Payment Failed", "SP_DYNAMIC_REPORT_LIST_OF_PAYMENT_FAILED_TRANSACTIONS"),
        (UserRole.SuperAdmin, "List Of ZED Registered Msme", "SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME"),
        (UserRole.SuperAdmin, "List of ZED Certified MSME", "SP_DYNAMIC_REPORT_LIST_OF_CERTIFIED_MSME"),
        (UserRole.SuperAdmin, "ZED Status Report", "SP_DYNAMIC_REPORT_ZEDID_STATUS"),
        (UserRole.SuperAdmin, "List Of ZED Rejected MSME", "SP_DYNAMIC_REPORT_LIST_OF_REJECTED_MSME"),
        (UserRole.SuperAdmin, "List Of ZED Financial Support", "SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS"),
        (UserRole.SuperAdmin, "List Of ZED Financial Support WITH DATES", "SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_WITH_DATES"),
        (UserRole.SuperAdmin, "List Of ZED Financial and Technology upgrade Support", "SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_AND_TECH_SUPPORT_ZEDIDS_WITH_DATES"),
        (UserRole.SuperAdmin, "List Of ZED Financial Support 2022-23", "SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2022_23"),
        (UserRole.SuperAdmin, "List Of ZED Financial Support 2023-24", "SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2023_24"),
        (UserRole.SuperAdmin, "List Of ZED Financial Support 2024-25", "SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2024_25"),
        (UserRole.SuperAdmin, "List Of ZED Financial Support 2025-26", "SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2025_26"),
        (UserRole.SuperAdmin, "List Of ZED Financial Support 2026-27", "SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2026_27"),
        (UserRole.SuperAdmin, "List Of ZED Financial Support Silver", "SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_CERT_SILVER"),
        (UserRole.SuperAdmin, "List Of ZED Financial Support Gold", "SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_CERT_GOLD"),
        (UserRole.SuperAdmin, "List Of Handholding Financial Support", "SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_CONSULTANCY"),
        (UserRole.SuperAdmin, "List Of Surveillance Financial Support", "SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_SURVEILLANCE"),
        (UserRole.SuperAdmin, "List Of ZED Financial Support Bronze Surveillance", "SP_DYNAMIC_REPORT_BRONZE_SURVEILLANCE_2025_26"),
        (UserRole.SuperAdmin, "List Of ZED Financial Support Paid MSMEs All", "SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_PAID_ZEDIDS_ALL_TIME"),
        (UserRole.SuperAdmin, "List Of ZED Financial Support Recertification Records", "SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_APPLIED_FOR_RECERTIFICATION"),
        (UserRole.SuperAdmin, "ZED BASIC INFO YEAR 2022-2023", "SP_DYNAMIC_REPORT_ZED_BASIC_INFO_2022_2023"),
        (UserRole.SuperAdmin, "ZED BASIC INFO YEAR 2024-2025", "SP_DYNAMIC_REPORT_ZED_BASIC_INFO_2024_2025"),
        (UserRole.SuperAdmin, "List Of KAWACH Registered Msme", "SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME_KAWACH"),
        (UserRole.SuperAdmin, "List of KAWACH Certified MSME", "SP_DYNAMIC_REPORT_LIST_OF_CERTIFIED_MSME_KAWACH"),
        (UserRole.SuperAdmin, "List Of KAWACH Assessement Agencies", "SP_DYNAMIC_REPORT_LIST_OF_ASSESSMENT_AGENCIES_KAWACH"),
        (UserRole.SuperAdmin, "List Of KAWACH Asssessors", "SP_DYNAMIC_REPORT_LIST_OF_ZED_ASSESSORS_KAWACH"),
        (UserRole.SuperAdmin, "List of KAWACH Payment Received", "SP_DYNAMIC_REPORT_LIST_OF_PAYMENT_RECEIVED_KAWACH"),
        (UserRole.SuperAdmin, "List of Certified Candidates in Zed Monitoring", "SP_DYNAMIC_REPORT_LIST_OF_CERTIFIED_CANDIDATES_ZED_MONITORING"),
        (UserRole.SuperAdmin, "List of Units with Same Udyam and Address", "SP_DYNAMIC_REPORT_LIST_OF_DUPLICATE_UDYAM_PADDRESS"),
        (UserRole.SuperAdmin, "ESG Checklist", "SP_DYNAMIC_REPORT_ESG_CHECK_LIST"),
        (UserRole.SuperAdmin, "Assessor Remarks", "SP_DYNAMIC_REPORT_ASSESSOR_COMMENTS"),
        (UserRole.SuperAdmin, "List of Suspended ZEDIDs", "SP_DYNAMIC_REPORT_LIST_OF_SUSPENDED_MSME"),
        (UserRole.SuperAdmin, "List Of ZED Financial Support WITH DATES and AssessmentDate", "SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_WITH_DATES_ASSESSMENT"),
        (UserRole.SuperAdmin, "New Status Report Of Bronze 2022-23 with Dates", "SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2022_23"),
        (UserRole.SuperAdmin, "New Status Report Of Bronze 2023-24 with Dates", "SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2023_24"),
        (UserRole.SuperAdmin, "New Status Report Of Bronze 2024-25 with Dates", "SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2024_25"),
        (UserRole.SuperAdmin, "New Status Report Of Bronze 2025-26 with Dates", "SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2025_26"),
        (UserRole.SuperAdmin, "New Status Report Of Bronze 2026-27 with Dates", "SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2026_27"),
        (UserRole.SuperAdmin, "New Status Report Of Silver with Dates", "SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_SILVER"),
        (UserRole.SuperAdmin, "New Status Report Of Gold with Dates", "SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_GOLD"),

        (UserRole.CitizenFeedback, "List Of ZED Registered Msme", "SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME"),
        (UserRole.CitizenFeedback, "List of ZED Certified MSME", "SP_DYNAMIC_REPORT_LIST_OF_CERTIFIED_MSME"),
        (UserRole.CitizenFeedback, "List of ZED Payment Received", "SP_DYNAMIC_REPORT_LIST_OF_PAYMENT_RECEIVED"),
        (UserRole.CitizenFeedback, "List of ZED Payment Received who paid through paymentGateway", "SP_DYNAMIC_REPORT_LIST_OF_PAYMENT_RECEIVED_PAID"),
        (UserRole.CitizenFeedback, "List Of ZED Rejected MSME", "SP_DYNAMIC_REPORT_LIST_OF_REJECTED_MSME"),
        (UserRole.CitizenFeedback, "List Of ZED Financial Support", "SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_WITH_DATES"),
        (UserRole.CitizenFeedback, "List Of KAWACH Registered Msme", "SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME_KAWACH"),
        (UserRole.CitizenFeedback, "List Of ZED Assessement Agencies", "SP_DYNAMIC_REPORT_LIST_OF_ASSESSMENT_AGENCIES_MINISTRY"),
        (UserRole.CitizenFeedback, "List Of ZED Asssessors", "SP_DYNAMIC_REPORT_LIST_OF_ZED_ASSESSORS_MINISTRY"),
        (UserRole.CitizenFeedback, "Master Report", "SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY"),
        (UserRole.CitizenFeedback, "Master Report 2022-2023", "SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY_2022-2023"),
        (UserRole.CitizenFeedback, "Master Report 2023-2024", "SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY_2023-2024"),
        (UserRole.CitizenFeedback, "Master Report 2024-2025", "SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY_2024-2025"),
        (UserRole.CitizenFeedback, "Master Report 2025-2026", "SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY_2025-2026"),
        (UserRole.CitizenFeedback, "Master Report 2026-2027", "SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY_2026-2027"),
        // These three were on the page but do not exist in the reference database (ZEDCS_V2_LIVE copy); kept
        // because the page listed them: running one where it is missing fails with "report not available".
        (UserRole.CitizenFeedback, "Master Report Of All Certified Units (All Years)", "SP_DYNAMIC_REPORT_LIST_OF_CERTIFIED_UNITS_MINISTRY"),
        (UserRole.CitizenFeedback, "Master Report Of Registered Units (Up to 2025-26)", "SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_UNITS_MINISTRY_UPTO_2025_26"),
        (UserRole.CitizenFeedback, "Master Report Of Registered Units (From 2026-27)", "SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_UNITS_MINISTRY_FROM_2026_27"),

        (UserRole.Ministry, "List Of ZED Registered Msme", "SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME"),
        (UserRole.Ministry, "List of ZED Certified MSME", "SP_DYNAMIC_REPORT_LIST_OF_CERTIFIED_MSME"),
        (UserRole.Ministry, "List Of KAWACH Registered Msme", "SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME_KAWACH"),
        (UserRole.Ministry, "List of KAWACH Certified MSME", "SP_DYNAMIC_REPORT_LIST_OF_CERTIFIED_MSME_KAWACH"),

        (UserRole.Agency, "List Of ZED Cases In-Progress", "SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME"),
        (UserRole.Agency, "List Of ZED Certified MSME", "SP_DYNAMIC_REPORT_LIST_OF_CERTIFIED_MSME"),
        (UserRole.Agency, "List Of ZED Rejected MSME", "SP_DYNAMIC_REPORT_LIST_OF_REJECTED_MSME"),

        (UserRole.StateCoordinator, "List Of New Transactions", "SP_DYNAMIC_REPORT_LIST_OF_NEW_TRANSACTIONS"),
        (UserRole.StateCoordinator, "List Of Approved Transactions", "SP_DYNAMIC_REPORT_LIST_OF_APPROVED_TRANSACTIONS"),
    ];

    private const string Site = SubRoles.SiteVerification;
    private const string Financial = SubRoles.FinancialVerification;

    /// <summary>
    /// ZEDCS_CONSULTANCY's list. An agency (Consultant Organisation) with Site verification gets the milestone lists; one
    /// with Financial (Technology Upgradation) verification but not Site the TU status list (the page's if / else-if).
    /// </summary>
    private static readonly (UserRole Role, string Name, string Procedure, string? SubRole, string? NotSubRole)[] ConsultancyEntries =
    [
        (UserRole.SuperAdmin, "List Of Consultant Organisations", "SP_DYNAMIC_REPORT_LIST_OF_ASSESSMENT_AGENCIES", null, null),
        (UserRole.SuperAdmin, "List Of Consultants", "SP_DYNAMIC_REPORT_LIST_OF_ZED_ASSESSORS", null, null),
        (UserRole.SuperAdmin, "List of Consultancy Payment Received", "SP_DYNAMIC_REPORT_LIST_OF_PAYMENT_RECEIVED", null, null),
        (UserRole.SuperAdmin, "List of Consultancy Payment Failed", "SP_DYNAMIC_REPORT_LIST_OF_PAYMENT_FAILED_TRANSACTIONS", null, null),
        (UserRole.SuperAdmin, "List Of Consultancy", "SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME", null, null),
        (UserRole.SuperAdmin, "List Of Consultancy latest status only", "SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME_LATEST_RECORDS", null, null),
        (UserRole.SuperAdmin, "Basic Info of OCCUPATIONAL (WORKPLACE) SAFETY", "SP_DYNAMIC_REPORT_BASIC_INFO_PARAMETER_01", null, null),
        (UserRole.SuperAdmin, "Basic Info of MEASUREMENT OF TIMELY DELIVERY", "SP_DYNAMIC_REPORT_BASIC_INFO_PARAMETER_02", null, null),
        (UserRole.SuperAdmin, "Basic Info of PLANNED MAINTENANCE & CALIBRATION", "SP_DYNAMIC_REPORT_BASIC_INFO_PARAMETER_03", null, null),
        (UserRole.SuperAdmin, "Basic Info of ENERGY MANAGEMENT", "SP_DYNAMIC_REPORT_BASIC_INFO_PARAMETER_04", null, null),
        (UserRole.SuperAdmin, "Basic Info of ENVIRONMENT MANAGEMENT", "SP_DYNAMIC_REPORT_BASIC_INFO_PARAMETER_05", null, null),
        (UserRole.SuperAdmin, "Basic Info of HUMAN RESOURCE MANAGEMENT", "SP_DYNAMIC_REPORT_BASIC_INFO_PARAMETER_06", null, null),
        (UserRole.SuperAdmin, "Basic Info of MEASUREMENT & ANALYSIS", "SP_DYNAMIC_REPORT_BASIC_INFO_PARAMETER_07", null, null),
        (UserRole.SuperAdmin, "Basic Info of NATURAL RESOURCES MANAGEMENT", "SP_DYNAMIC_REPORT_BASIC_INFO_PARAMETER_08", null, null),
        (UserRole.SuperAdmin, "Basic Info of FINANCIAL PERFORMANCE (PREVIOUS FINANCIAL YEAR)", "SP_DYNAMIC_REPORT_BASIC_INFO_PARAMETER_09", null, null),
        (UserRole.SuperAdmin, "List Of Technolgy Upgradation Statuses", "SP_DYNAMIC_REPORT_LIST_TECH_UPGRADE_STATUSES", null, null),

        (UserRole.StateCoordinator, "List Of New Transactions", "SP_DYNAMIC_REPORT_LIST_OF_NEW_TRANSACTIONS", null, null),
        (UserRole.StateCoordinator, "List Of Approved Transactions", "SP_DYNAMIC_REPORT_LIST_OF_APPROVED_TRANSACTIONS", null, null),

        (UserRole.Agency, "List Of Milestone 1 In-Progress", "SP_DYNAMIC_REPORT_LIST_OF_MILESTONE1_INPROGRESS", Site, null),
        (UserRole.Agency, "List Of Milestone 1 Completed", "SP_DYNAMIC_REPORT_LIST_OF_MILESTONE1_COMPLETED", Site, null),
        (UserRole.Agency, "List Of Milestone 2 In-Progress", "SP_DYNAMIC_REPORT_LIST_OF_MILESTONE2_INPROGRESS", Site, null),
        (UserRole.Agency, "List Of Milestone 2 Completed", "SP_DYNAMIC_REPORT_LIST_OF_MILESTONE2_COMPLETED", Site, null),
        (UserRole.Agency, "List Of Milestone 3 In-Progress", "SP_DYNAMIC_REPORT_LIST_OF_MILESTONE3_INPROGRESS", Site, null),
        (UserRole.Agency, "List Of Milestone 3 Completed", "SP_DYNAMIC_REPORT_LIST_OF_MILESTONE3_COMPLETED", Site, null),
        (UserRole.Agency, "List Of Technology Upgradation Statuses", "SP_DYNAMIC_REPORT_LIST_TECH_UPGRADE_STATUSES", Financial, Site),
    ];

    /// <summary>ZEDCS_SURVEILLANCE's list (its commented-out entries are not offered).</summary>
    private static readonly (UserRole Role, string Name, string Procedure, string? SubRole, string? NotSubRole)[] SurveillanceEntries =
    [
        (UserRole.SuperAdmin, "List of ZED Payment Received", "SP_DYNAMIC_REPORT_LIST_OF_PAYMENT_RECEIVED", null, null),
        (UserRole.SuperAdmin, "List Of ZED Registered Msme", "SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME", null, null),
        (UserRole.SuperAdmin, "List of ZED Certified MSME", "SP_DYNAMIC_REPORT_LIST_OF_CERTIFIED_MSME", null, null),
        (UserRole.SuperAdmin, "List Of ZED Rejected MSME", "SP_DYNAMIC_REPORT_LIST_OF_REJECTED_MSME", null, null),
        (UserRole.SuperAdmin, "List Of 1st Suveillance Payment Records who applied for 2nd", "SP_DYNAMIC_REPORT_SECOND_SURVELLIANCE", null, null),
        (UserRole.SuperAdmin, "ZED Surveillance Report", "SP_DYNAMIC_REPORT_ZED_SURVEILLANCE_REPORT", null, null),

        (UserRole.CitizenFeedback, "List Of Surveillance Inprogress", "SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME", null, null),
        (UserRole.CitizenFeedback, "List of Surveillance Completed", "SP_DYNAMIC_REPORT_LIST_OF_CERTIFIED_MSME", null, null),
        (UserRole.CitizenFeedback, "List of ZED Payment Received", "SP_DYNAMIC_REPORT_LIST_OF_PAYMENT_RECEIVED", null, null),
        (UserRole.CitizenFeedback, "List Of ZED Rejected MSME", "SP_DYNAMIC_REPORT_LIST_OF_REJECTED_MSME", null, null),
        (UserRole.CitizenFeedback, "List Of ZED Financial Support", "SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS", null, null),
        (UserRole.CitizenFeedback, "List Of KAWACH Registered Msme", "SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME_KAWACH", null, null),
        (UserRole.CitizenFeedback, "List Of ZED Assessement Agencies", "SP_DYNAMIC_REPORT_LIST_OF_ASSESSMENT_AGENCIES_MINISTRY", null, null),
        (UserRole.CitizenFeedback, "List Of ZED Asssessors", "SP_DYNAMIC_REPORT_LIST_OF_ZED_ASSESSORS_MINISTRY", null, null),

        (UserRole.Ministry, "List Of Surveillance Inprogress", "SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME", null, null),
        (UserRole.Ministry, "List of Surveillance Completed", "SP_DYNAMIC_REPORT_LIST_OF_CERTIFIED_MSME", null, null),
        (UserRole.Ministry, "List Of KAWACH Registered Msme", "SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME_KAWACH", null, null),
        (UserRole.Ministry, "List of KAWACH Certified MSME", "SP_DYNAMIC_REPORT_LIST_OF_CERTIFIED_MSME_KAWACH", null, null),

        (UserRole.Agency, "List Of ZED Cases In-Progress", "SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME", null, null),
        (UserRole.Agency, "List Of ZED Certified MSME", "SP_DYNAMIC_REPORT_LIST_OF_CERTIFIED_MSME", null, null),
        (UserRole.Agency, "List Of ZED Rejected MSME", "SP_DYNAMIC_REPORT_LIST_OF_REJECTED_MSME", null, null),
    ];

    /// <summary>Reports of a role on a system, filtered by the user's sub-roles where the old page did.</summary>
    public static IReadOnlyList<ReportDefinition> For(PortalSystem system, int roleId, IReadOnlyCollection<string> subRoles)
    {
        if (system == PortalSystem.Main) return For(roleId);
        var entries = system == PortalSystem.Consultancy ? ConsultancyEntries : SurveillanceEntries;
        return entries
            .Where(e => (int)e.Role == roleId && (e.SubRole is null || subRoles.Contains(e.SubRole)) && (e.NotSubRole is null || !subRoles.Contains(e.NotSubRole)))
            .Select(e => new ReportDefinition(IdOf(e.Procedure), e.Name, e.Procedure)).ToList();
    }

    public static ReportDefinition? Find(PortalSystem system, int roleId, IReadOnlyCollection<string> subRoles, string id) =>
        For(system, roleId, subRoles).FirstOrDefault(r => string.Equals(r.Id, id, StringComparison.Ordinal));

    /// <summary>Every allow-listed procedure of a system (for tests).</summary>
    public static IEnumerable<string> AllProceduresOf(PortalSystem system) => system switch
    {
        PortalSystem.Consultancy => ConsultancyEntries.Select(e => e.Procedure).Distinct(),
        PortalSystem.Surveillance => SurveillanceEntries.Select(e => e.Procedure).Distinct(),
        _ => AllProcedures,
    };

    /// <summary>Roles that have the Reports page (legacy AuthenticationFilter of DynamicReportsController.Index).</summary>
    public static readonly UserRole[] Roles = [UserRole.SuperAdmin, UserRole.CitizenFeedback, UserRole.Ministry, UserRole.Agency, UserRole.StateCoordinator];

    /// <summary>Stable id of a report: the procedure name without its prefix, e.g. "list-of-registered-msme".</summary>
    public static string IdOf(string procedure) =>
        procedure.Replace("SP_DYNAMIC_REPORT_", "", StringComparison.Ordinal).Replace('_', '-').ToLowerInvariant();

    public static IReadOnlyList<ReportDefinition> For(int roleId) =>
        Entries.Where(e => (int)e.Role == roleId).Select(e => new ReportDefinition(IdOf(e.Procedure), e.Name, e.Procedure)).ToList();

    public static ReportDefinition? Find(int roleId, string id) =>
        For(roleId).FirstOrDefault(r => string.Equals(r.Id, id, StringComparison.Ordinal));

    /// <summary>Every allow-listed procedure (for tests).</summary>
    public static IEnumerable<string> AllProcedures => Entries.Select(e => e.Procedure).Distinct();
}
