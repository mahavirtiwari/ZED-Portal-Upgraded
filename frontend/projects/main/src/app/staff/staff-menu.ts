/** Users.RoleId values of the staff roles (legacy UserRoleEnum). */
export const StaffRole = {
  Admin: 1,
  Agency: 2,
  DesktopAssessor: 3,
  StateCoordinator: 6,
  MasterAdmin: 7,
  Ministry: 8,
  SuperAdmin: 10,
  CitizenFeedback: 11,
  QC: 17,
} as const;

export const STAFF_ROLE_IDS: number[] = Object.values(StaffRole);

export type SubRole = 'DesktopVerification' | 'SiteVerification' | 'FinancialVerification';

export interface StaffMenuItem {
  label: string;
  /** Route in this app once the screen is migrated. */
  route?: string;
  /** Address on the old portal until then (relative to legacyPortalUrl). */
  legacyPath?: string;
  roles: number[];
  /** All of these sub-roles are required (UserHelper.CheckSubRole). */
  subRoles?: SubRole[];
  /** At least one of these sub-roles is required. */
  anySubRole?: SubRole[];
}

const R = StaffRole;

/**
 * Staff menu per role, as in the role branches of Views/Shared/_Layout.cshtml. Screens are moved from
 * `legacyPath` to `route` as they are migrated (see docs/MIGRATION-PLAN.md, phase 4).
 */
export const STAFF_MENU: StaffMenuItem[] = [
  // Dashboards and reports
  { label: 'Dashboard', legacyPath: '/Dashboard/Index', route: '/staff/dashboard', roles: [R.SuperAdmin, R.MasterAdmin, R.Ministry, R.Agency, R.DesktopAssessor, R.CitizenFeedback, R.QC] },
  { label: 'Failed Transactions', legacyPath: '/Dashboard/FailedTransactions', route: '/staff/failed-transactions', roles: [R.SuperAdmin] },
  { label: 'Registered MSMEs', legacyPath: '/Dashboard/RegisteredMsme', route: '/staff/registered-msme', roles: [R.SuperAdmin, R.CitizenFeedback, R.QC, R.Ministry] },
  { label: 'Financial Support', legacyPath: '/Dashboard/FinancialSupport', route: '/staff/financial-support', roles: [R.SuperAdmin, R.CitizenFeedback] },
  { label: 'Payments Received', legacyPath: '/Dashboard/PaymentReceived', route: '/staff/payments-received', roles: [R.MasterAdmin] },
  { label: 'Reports', legacyPath: '/DynamicReports/Index', route: '/staff/reports', roles: [R.SuperAdmin, R.CitizenFeedback, R.Ministry, R.Agency, R.StateCoordinator] },
  { label: 'ZED ID History', legacyPath: '/Msme/History', route: '/staff/history', roles: [R.MasterAdmin] },

  // Master admin: agencies, assessors and allocation
  { label: 'Assessment Agencies', legacyPath: '/User/AssessmentAgencies', route: '/staff/users/agencies', roles: [R.MasterAdmin] },
  { label: 'Bronze Assessment Agencies', legacyPath: '/User/BronzeAssessmentAgencies', route: '/staff/users/bronze-agencies', roles: [R.MasterAdmin] },
  { label: 'Assessors', legacyPath: '/User/AssessorList', route: '/staff/users/assessors', roles: [R.MasterAdmin] },
  { label: 'Allot', legacyPath: '/Assessment/Allot', route: '/staff/assessment/allot', roles: [R.MasterAdmin] },

  // Assessment workflow
  { label: 'Monitoring', legacyPath: '/Monitoring/Index', route: '/staff/monitoring', roles: [R.MasterAdmin] },
  { label: 'Monitoring', legacyPath: '/Monitoring/Index', route: '/staff/monitoring', roles: [R.Agency], anySubRole: ['SiteVerification', 'DesktopVerification'] },
  { label: 'Assessors', legacyPath: '/User/Assessors', route: '/staff/users/my-assessors', roles: [R.Agency] },
  { label: 'DA Allotment', legacyPath: '/Assessment/DaAllotment', route: '/staff/assessment/da-allotment', roles: [R.Agency], subRoles: ['DesktopVerification'] },
  { label: 'SA Allotment', legacyPath: '/Assessment/SaAllotment', route: '/staff/sa-allotment', roles: [R.Agency], subRoles: ['SiteVerification'] },
  { label: 'Desktop Verification', legacyPath: '/Assessment/DaVerification', route: '/staff/assessment/da-verification', roles: [R.DesktopAssessor], subRoles: ['DesktopVerification'] },
  { label: 'Non-Conformances', legacyPath: '/Assessment/NonConfirmances', route: '/staff/assessment/non-conformances', roles: [R.DesktopAssessor] },
  { label: 'Remote Assessments', legacyPath: '/Assessment/RemoteAssessments', route: '/staff/remote-assessments', roles: [R.DesktopAssessor], subRoles: ['SiteVerification'] },
  { label: 'Completed', legacyPath: '/Assessment/Completed', route: '/staff/assessment/completed', roles: [R.MasterAdmin, R.DesktopAssessor] },
  { label: 'Completed', legacyPath: '/Assessment/Completed', route: '/staff/assessment/completed', roles: [R.Agency], anySubRole: ['SiteVerification', 'DesktopVerification'] },
  { label: 'Rejected Certification', legacyPath: '/Assessment/Rejected', route: '/staff/assessment/rejected', roles: [R.MasterAdmin, R.DesktopAssessor] },
  { label: 'Rejected Certification', legacyPath: '/Assessment/Rejected', route: '/staff/assessment/rejected', roles: [R.Agency], anySubRole: ['SiteVerification', 'DesktopVerification'] },

  // Schemes and finance
  { label: 'Financial Assistance', legacyPath: '/FinancialAssistance/Submissions', route: '/staff/financial-assistance', roles: [R.MasterAdmin] },
  { label: 'Financial Assistance', legacyPath: '/FinancialAssistance/Submissions', route: '/staff/financial-assistance', roles: [R.Agency, R.DesktopAssessor], subRoles: ['FinancialVerification'] },
  { label: 'Incentive Submissions', legacyPath: '/Incentive/Submissions', route: '/staff/incentives/submissions', roles: [R.SuperAdmin] },
  { label: 'Upload API Incentives', legacyPath: '/Incentive/UploadIncentives', route: '/staff/incentives/upload', roles: [R.MasterAdmin] },
  { label: 'NEFT: New Transactions', legacyPath: '/Neft/NewTransactions', route: '/staff/neft/new', roles: [R.StateCoordinator] },
  { label: 'NEFT: Approved Transactions', legacyPath: '/Neft/ApprovedTransactions', route: '/staff/neft/approved', roles: [R.StateCoordinator] },
  { label: 'NEFT: Rejected Transactions', legacyPath: '/Neft/RejectedTransactions', route: '/staff/neft/rejected', roles: [R.StateCoordinator] },

  // Admin: content and masters
  { label: 'Questionnaire', legacyPath: '/Questionaire/Index?SectionType=Bronze', route: '/staff/masters/parameters/Bronze', roles: [R.Admin] },
  { label: 'Payment Details', legacyPath: '/Assessment/PaymentDetails', route: '/staff/fees', roles: [R.Admin] },
  { label: 'Home Page Settings', legacyPath: '/Home/PageSettings', route: '/staff/masters/page-settings', roles: [R.Admin] },
  { label: 'Documents', legacyPath: '/MyDocuments/Index', route: '/staff/masters/documents', roles: [R.Admin] },
  { label: 'Sectors', legacyPath: '/Sector/List', route: '/staff/masters/sectors', roles: [R.Admin] },
  { label: 'Categories', legacyPath: '/Category/list', route: '/staff/masters/categories', roles: [R.Admin] },
  { label: 'Technologies', legacyPath: '/Technology/list', route: '/staff/masters/technologies', roles: [R.Admin] },
  { label: 'Incentives', legacyPath: '/Incentive/Index', route: '/staff/incentives', roles: [R.Admin] },
];

/** Roles whose legacy home page was Dashboard/Index; the others keep the card home. */
export const DASHBOARD_ROLE_IDS: number[] = [R.SuperAdmin, R.MasterAdmin, R.Ministry, R.Agency, R.DesktopAssessor, R.CitizenFeedback, R.QC];

export function menuFor(roleId: number, subRoles: readonly string[]): StaffMenuItem[] {
  return STAFF_MENU.filter(
    (i) =>
      i.roles.includes(roleId) &&
      (i.subRoles ?? []).every((s) => subRoles.includes(s)) &&
      (!i.anySubRole || i.anySubRole.some((s) => subRoles.includes(s))),
  );
}
