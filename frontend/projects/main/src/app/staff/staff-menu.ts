import { PORTAL_SYSTEM, PortalSystem } from '../portal-system';
import { INCENTIVE_TYPES } from './schemes/incentives.api';

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
  /** Query parameters of `route` (e.g. the incentive type). */
  queryParams?: Record<string, string>;
  roles: number[];
  /** All of these sub-roles are required (UserHelper.CheckSubRole). */
  subRoles?: SubRole[];
  /** At least one of these sub-roles is required. */
  anySubRole?: SubRole[];
  /**
   * Drop-down this entry belongs to in the menu bar (the old layout grouped the long menus the same way, e.g.
   * MasterAdmin's "Assessment"); the drop-down stands where its first entry is.
   */
  group?: string;
}

/** A menu bar entry: a link, or a drop-down of links. */
export type StaffMenuEntry = { item: StaffMenuItem } | { group: string; items: StaffMenuItem[] };

/** Folds the entries of each group into one drop-down, keeping the menu order. */
export function menuEntries(items: readonly StaffMenuItem[]): StaffMenuEntry[] {
  const entries: StaffMenuEntry[] = [];
  const groups = new Map<string, StaffMenuItem[]>();
  for (const item of items) {
    if (!item.group) {
      entries.push({ item });
      continue;
    }
    const existing = groups.get(item.group);
    if (existing) existing.push(item);
    else {
      const list = [item];
      groups.set(item.group, list);
      entries.push({ group: item.group, items: list });
    }
  }
  return entries;
}

const R = StaffRole;

/**
 * Main's staff menu per role, as in the role branches of Views/Shared/_Layout.cshtml. Screens are moved from
 * `legacyPath` to `route` as they are migrated (see docs/MIGRATION-PLAN.md, phase 4).
 */
export const MAIN_MENU: StaffMenuItem[] = [
  // Dashboards and reports
  { label: 'Failed Transactions', legacyPath: '/Dashboard/FailedTransactions', route: '/staff/failed-transactions', roles: [R.SuperAdmin] },
  { label: 'Registered MSMEs', legacyPath: '/Dashboard/RegisteredMsme', route: '/staff/registered-msme', roles: [R.SuperAdmin, R.CitizenFeedback, R.QC, R.Ministry] },
  { label: 'Financial Support', legacyPath: '/Dashboard/FinancialSupport', route: '/staff/financial-support', roles: [R.SuperAdmin, R.CitizenFeedback] },
  { label: 'Reports', legacyPath: '/DynamicReports/Index', route: '/staff/reports', roles: [R.SuperAdmin, R.CitizenFeedback, R.Ministry, R.Agency, R.StateCoordinator] },

  // Master admin: agencies, assessors and allocation
  // The live "Assessment" drop-down (Frontend/Shared/_Layout.cshtml, MasterAdmin), its labels and order; then the V4 additions.
  { label: 'Assessment Agencies', legacyPath: '/User/AssessmentAgencies', route: '/staff/users/agencies', roles: [R.MasterAdmin], group: 'Assessment' },
  { label: 'Bronze Agencies', legacyPath: '/User/BronzeAssessmentAgencies', route: '/staff/users/bronze-agencies', roles: [R.MasterAdmin], group: 'Assessment' },
  { label: 'Assessors', legacyPath: '/User/AssessorList', route: '/staff/users/assessors', roles: [R.MasterAdmin], group: 'Assessment' },
  { label: 'Payment Received', legacyPath: '/Dashboard/PaymentReceived', route: '/staff/payments-received', roles: [R.MasterAdmin], group: 'Assessment' },
  { label: 'Allot Assessment', legacyPath: '/Assessment/Allot', route: '/staff/assessment/allot', roles: [R.MasterAdmin], group: 'Assessment' },
  { label: 'Assessment Monitoring', legacyPath: '/Monitoring/Index', route: '/staff/monitoring', roles: [R.MasterAdmin], group: 'Assessment' },
  { label: 'Assessment Completed', legacyPath: '/Assessment/Completed', route: '/staff/assessment/completed', roles: [R.MasterAdmin], group: 'Assessment' },
  { label: 'Rejected Certification', legacyPath: '/Assessment/Rejected', route: '/staff/assessment/rejected', roles: [R.MasterAdmin], group: 'Assessment' },
  { label: 'Password Reset Link', route: '/staff/users/password-reset', roles: [R.MasterAdmin], group: 'Assessment' },
  { label: 'ZED ID History', legacyPath: '/Msme/History', route: '/staff/history', roles: [R.MasterAdmin], group: 'Assessment' },

  // Assessment workflow
  { label: 'Monitoring', legacyPath: '/Monitoring/Index', route: '/staff/monitoring', roles: [R.Agency], anySubRole: ['SiteVerification', 'DesktopVerification'] },
  { label: 'Assessors', legacyPath: '/User/Assessors', route: '/staff/users/my-assessors', roles: [R.Agency] },
  { label: 'DA Allotment', legacyPath: '/Assessment/DaAllotment', route: '/staff/assessment/da-allotment', roles: [R.Agency], subRoles: ['DesktopVerification'] },
  { label: 'SA Allotment', legacyPath: '/Assessment/SaAllotment', route: '/staff/sa-allotment', roles: [R.Agency], subRoles: ['SiteVerification'] },
  { label: 'Desktop Verification', legacyPath: '/Assessment/DaVerification', route: '/staff/assessment/da-verification', roles: [R.DesktopAssessor], subRoles: ['DesktopVerification'] },
  { label: 'Non-Conformances', legacyPath: '/Assessment/NonConfirmances', route: '/staff/assessment/non-conformances', roles: [R.DesktopAssessor] },
  { label: 'Remote Assessments', legacyPath: '/Assessment/RemoteAssessments', route: '/staff/remote-assessments', roles: [R.DesktopAssessor], subRoles: ['SiteVerification'] },
  { label: 'Completed', legacyPath: '/Assessment/Completed', route: '/staff/assessment/completed', roles: [R.DesktopAssessor] },
  { label: 'Completed', legacyPath: '/Assessment/Completed', route: '/staff/assessment/completed', roles: [R.Agency], anySubRole: ['SiteVerification', 'DesktopVerification'] },
  { label: 'Rejected Certification', legacyPath: '/Assessment/Rejected', route: '/staff/assessment/rejected', roles: [R.DesktopAssessor] },
  { label: 'Rejected Certification', legacyPath: '/Assessment/Rejected', route: '/staff/assessment/rejected', roles: [R.Agency], anySubRole: ['SiteVerification', 'DesktopVerification'] },

  // Schemes and finance
  { label: 'Financial Assistance', legacyPath: '/FinancialAssistance/Submissions', route: '/staff/financial-assistance', roles: [R.MasterAdmin] },
  { label: 'Financial Assistance', legacyPath: '/FinancialAssistance/Submissions', route: '/staff/financial-assistance', roles: [R.Agency, R.DesktopAssessor], subRoles: ['FinancialVerification'] },
  { label: 'Incentive Submissions', legacyPath: '/Incentive/Submissions', route: '/staff/incentives/submissions', roles: [R.SuperAdmin] },
  { label: 'Upload API Incentives', legacyPath: '/Incentive/UploadIncentives', route: '/staff/incentives/upload', roles: [R.MasterAdmin] },
  { label: 'NEFT: New Transactions', legacyPath: '/Neft/NewTransactions', route: '/staff/neft/new', roles: [R.StateCoordinator] },
  { label: 'NEFT: Approved Transactions', legacyPath: '/Neft/ApprovedTransactions', route: '/staff/neft/approved', roles: [R.StateCoordinator] },
  { label: 'NEFT: Rejected Transactions', legacyPath: '/Neft/RejectedTransactions', route: '/staff/neft/rejected', roles: [R.StateCoordinator] },

  // Admin: as the live layout (Frontend/Shared/_Layout.cshtml, Admin), labels, order and drop-downs.
  { label: 'Upload Image', legacyPath: '/Home/PageSettings', route: '/staff/masters/page-settings', roles: [R.Admin] },
  { label: 'My Documents', legacyPath: '/MyDocuments/Index', route: '/staff/masters/documents', roles: [R.Admin] },
  { label: 'Sectors', legacyPath: '/Sector/List', route: '/staff/masters/sectors', roles: [R.Admin] },
  { label: 'Payments', legacyPath: '/Assessment/PaymentDetails', route: '/staff/fees', roles: [R.Admin] },
  ...(['Bronze', 'Silver', 'Gold'] as const).map((level) => ({
    label: level, legacyPath: `/Questionaire/Index?SectionType=${level}`, route: `/staff/masters/parameters/${level}`, roles: [R.Admin as number], group: 'Questionnaire',
  })),
  { label: 'Categories', legacyPath: '/Category/list', route: '/staff/masters/categories', roles: [R.Admin], group: 'Technology Upgradation' },
  { label: 'Technologies', legacyPath: '/Technology/list', route: '/staff/masters/technologies', roles: [R.Admin], group: 'Technology Upgradation' },
  ...INCENTIVE_TYPES.map((t) => ({
    label: t.label, legacyPath: '/Incentive/Index', route: '/staff/incentives', queryParams: { type: t.value }, roles: [R.Admin as number], group: 'Incentives',
  })),
  { label: 'Captcha Settings', route: '/staff/settings/captcha', roles: [R.Admin] }, // new in V4
];

/**
 * Consultancy (handholding) menu: ZEDCS_CONSULTANCY Views/Shared/_Layout.cshtml and the role table of
 * docs/systems/CONSULTANCY-ANALYSIS.md 1.1. Agencies are Consultant Organisations, assessors Consultants/Experts.
 */
export const CONSULTANCY_MENU: StaffMenuItem[] = [
  // SuperAdmin's (and Ministry's) as in the live layout; MasterAdmin does not have them there.
  { label: 'Failed Transactions', route: '/staff/failed-transactions', roles: [R.SuperAdmin] },
  { label: 'Registered MSME', route: '/staff/registered-msme', roles: [R.SuperAdmin, R.Ministry] },
  { label: 'Reports', route: '/staff/reports', roles: [R.SuperAdmin, R.Ministry] },

  // Admin: as the live layout; its Incentives drop-down is not ported (ZED_CONSULTANT incentives are not served here).
  { label: 'Upload Image', route: '/staff/masters/page-settings', roles: [R.Admin] },
  { label: 'My Documents', route: '/staff/masters/documents', roles: [R.Admin] },
  { label: 'Sectors', route: '/staff/masters/sectors', roles: [R.Admin] },
  { label: 'Payments', route: '/staff/fees', roles: [R.Admin] },
  ...(['Bronze', 'Silver', 'Gold'] as const).map((level) => ({
    label: level, route: `/staff/masters/parameters/${level}`, roles: [R.Admin as number], group: 'Questionnaire',
  })),
  { label: 'Captcha Settings', route: '/staff/settings/captcha', roles: [R.Admin] }, // new in V4

  // MasterAdmin: allotment and consultancy monitoring
  // As the live layout (ZEDCS_CONSULTANCY Frontend/Shared/_Layout.cshtml): "Allot Consultancy", then the "Consultancy
  // Monitoring" drop-down (its labels and order), then the V4 addition.
  { label: 'Allot Consultancy', route: '/staff/assessment/allot', roles: [R.MasterAdmin] },
  { label: 'Consultant Organisations', route: '/staff/users/agencies', roles: [R.MasterAdmin], group: 'Consultancy Monitoring' },
  { label: 'Consultants', route: '/staff/users/assessors', roles: [R.MasterAdmin], group: 'Consultancy Monitoring' },
  { label: 'Payment Received', route: '/staff/payments-received', roles: [R.MasterAdmin], group: 'Consultancy Monitoring' },
  { label: 'Monitoring', route: '/staff/monitoring', roles: [R.MasterAdmin], group: 'Consultancy Monitoring' },
  { label: 'Consultancy Completed', route: '/staff/assessment/completed', roles: [R.MasterAdmin], group: 'Consultancy Monitoring' },
  { label: 'Password Reset Link', route: '/staff/users/password-reset', roles: [R.MasterAdmin], group: 'Consultancy Monitoring' },
  { label: 'Technology Upgradation', route: '/staff/consultancy/technology', roles: [R.MasterAdmin] },

  // Consultant Organisation (Agency)
  { label: 'Consultancy Completed', route: '/staff/assessment/completed', roles: [R.Agency], subRoles: ['SiteVerification'] },
  { label: 'Allot Consultancy', route: '/staff/site-assessment/co-allotment', roles: [R.Agency], subRoles: ['SiteVerification'] },
  { label: 'Consultancy Monitoring', route: '/staff/monitoring', roles: [R.Agency], subRoles: ['SiteVerification'] },
  { label: 'Consultants/Experts', route: '/staff/users/my-assessors', roles: [R.Agency] },
  { label: 'Reports', route: '/staff/reports', roles: [R.Agency] },
  { label: 'Technology Upgradation', route: '/staff/consultancy/technology', roles: [R.Agency], subRoles: ['FinancialVerification'] },

  // Consultant / expert (DesktopAssessor)
  { label: 'Milestone 1', route: '/staff/site-assessment/milestones/1', roles: [R.DesktopAssessor], subRoles: ['SiteVerification'] },
  { label: 'Milestone 2', route: '/staff/site-assessment/milestones/2', roles: [R.DesktopAssessor], subRoles: ['SiteVerification'] },
  { label: 'Milestone 3', route: '/staff/site-assessment/milestones/3', roles: [R.DesktopAssessor], subRoles: ['SiteVerification'] },
  { label: 'Completed', route: '/staff/assessment/completed', roles: [R.DesktopAssessor], subRoles: ['SiteVerification'] },
  { label: 'Technology Upgradation', route: '/staff/consultancy/technology', roles: [R.DesktopAssessor], subRoles: ['FinancialVerification'] },

  // State coordinator: TU reimbursements
  { label: 'New Transactions', route: '/staff/neft/new', roles: [R.StateCoordinator] },
  { label: 'Approved Transactions', route: '/staff/neft/approved', roles: [R.StateCoordinator] },
  { label: 'Reports', route: '/staff/reports', roles: [R.StateCoordinator] },
];

/**
 * Surveillance menu: ZEDCS_SURVEILLANCE Views/Shared/_Layout.cshtml and docs/systems/SURVEILLANCE-ANALYSIS.md 1.1.
 * Not ported: NEFT and Financial Assistance (dead there), the MSME menu, API Incentives (data in main).
 */
export const SURVEILLANCE_MENU: StaffMenuItem[] = [
  // SuperAdmin's (and Ministry's, CitizenFeedback's) as in the live layout; MasterAdmin's link is commented out there.
  { label: 'Failed Transactions', route: '/staff/failed-transactions', roles: [R.SuperAdmin] },
  { label: 'Registered MSME', route: '/staff/registered-msme', roles: [R.SuperAdmin, R.CitizenFeedback, R.Ministry] },
  { label: 'Financial Support', route: '/staff/financial-support', roles: [R.SuperAdmin, R.CitizenFeedback] },
  { label: 'Reports', route: '/staff/reports', roles: [R.SuperAdmin, R.CitizenFeedback, R.Ministry] },

  { label: 'Payments', route: '/staff/fees', roles: [R.Admin] },
  { label: 'Sectors', route: '/staff/masters/sectors', roles: [R.Admin] },
  ...(['Bronze', 'Silver', 'Gold'] as const).map((level) => ({
    label: level, route: `/staff/masters/parameters/${level}`, roles: [R.Admin as number], group: 'Questionnaire',
  })),
  { label: 'Captcha Settings', route: '/staff/settings/captcha', roles: [R.Admin] }, // new in V4

  // MasterAdmin
  // As the live layout (ZEDCS_SURVEILLANCE Frontend/Shared/_Layout.cshtml): "Allot Surveillance", then the "Surveillance
  // Monitoring" drop-down; Assessors (commented out there) and Password Reset Link are V4's.
  { label: 'Allot Surveillance', route: '/staff/assessment/allot', roles: [R.MasterAdmin] },
  { label: 'Bronze Surveillance Agencies', route: '/staff/users/surveillance-agencies', roles: [R.MasterAdmin], group: 'Surveillance Monitoring' },
  { label: 'Assessors', route: '/staff/users/surveillance-assessors', roles: [R.MasterAdmin], group: 'Surveillance Monitoring' },
  { label: 'Surveillance Payment Received', route: '/staff/payments-received', roles: [R.MasterAdmin], group: 'Surveillance Monitoring' },
  { label: 'Surveillance Monitoring', route: '/staff/monitoring', roles: [R.MasterAdmin], group: 'Surveillance Monitoring' },
  { label: 'Surveillance Completed', route: '/staff/assessment/completed', roles: [R.MasterAdmin], group: 'Surveillance Monitoring' },
  { label: 'Surveillance Rejected', route: '/staff/assessment/rejected', roles: [R.MasterAdmin], group: 'Surveillance Monitoring' },
  { label: 'Password Reset Link', route: '/staff/users/password-reset', roles: [R.MasterAdmin], group: 'Surveillance Monitoring' },

  // Agency
  { label: 'Monitoring', route: '/staff/monitoring', roles: [R.Agency], anySubRole: ['SiteVerification', 'DesktopVerification'] },
  { label: 'Surveillance Completed', route: '/staff/assessment/completed', roles: [R.Agency], anySubRole: ['SiteVerification', 'DesktopVerification'] },
  { label: 'Assessors', route: '/staff/users/surveillance-assessors', roles: [R.Agency], subRoles: ['DesktopVerification'] },
  { label: 'Allot Surveillance', route: '/staff/assessment/da-allotment', roles: [R.Agency], subRoles: ['DesktopVerification'] },
  { label: 'Allot Surveillance (Site)', route: '/staff/sa-allotment', roles: [R.Agency], subRoles: ['SiteVerification'] },
  { label: 'Surveillance Rejected', route: '/staff/assessment/rejected', roles: [R.Agency], anySubRole: ['SiteVerification', 'DesktopVerification'] },
  { label: 'Reports', route: '/staff/reports', roles: [R.Agency] },

  // Assessor
  { label: 'Surveillance Assessments', route: '/staff/assessment/da-verification', roles: [R.DesktopAssessor], subRoles: ['DesktopVerification'] },
  { label: 'Completed', route: '/staff/assessment/completed', roles: [R.DesktopAssessor], subRoles: ['DesktopVerification'] },
  { label: 'Non-Conformances', route: '/staff/assessment/non-conformances', roles: [R.DesktopAssessor], subRoles: ['DesktopVerification'] },
  { label: 'Surveillance Assessments (Site)', route: '/staff/remote-assessments', roles: [R.DesktopAssessor], subRoles: ['SiteVerification'] },
  { label: 'Surveillance Rejected', route: '/staff/assessment/rejected', roles: [R.DesktopAssessor] },
];

export const MENUS: Record<PortalSystem, StaffMenuItem[]> = { main: MAIN_MENU, consultancy: CONSULTANCY_MENU, surveillance: SURVEILLANCE_MENU };

/** The menu of this build. */
export const STAFF_MENU: StaffMenuItem[] = MENUS[PORTAL_SYSTEM];

/** Roles whose legacy home page was Dashboard/Index; the others keep the card home. */
export const DASHBOARD_ROLE_IDS: number[] = [R.SuperAdmin, R.MasterAdmin, R.Ministry, R.Agency, R.DesktopAssessor, R.CitizenFeedback, R.QC];

/** Where the old login sent a role on each system (UserController.Login), when not to the dashboard. */
export const HOME_ROUTES: Record<PortalSystem, Partial<Record<number, string>>> = {
  main: {},
  consultancy: { [R.Admin]: '/staff/masters/parameters/Bronze', [R.StateCoordinator]: '/staff/neft/new' },
  surveillance: { [R.Admin]: '/staff/fees' },
};

/** The landing page of a role after sign-in, or null for the card home. */
export function homeFor(roleId: number, system: PortalSystem = PORTAL_SYSTEM): string | null {
  return HOME_ROUTES[system][roleId] ?? (DASHBOARD_ROLE_IDS.includes(roleId) ? '/staff/dashboard' : null);
}

export function menuFor(roleId: number, subRoles: readonly string[], system: PortalSystem = PORTAL_SYSTEM): StaffMenuItem[] {
  return MENUS[system].filter(
    (i) =>
      i.roles.includes(roleId) &&
      (i.subRoles ?? []).every((s) => subRoles.includes(s)) &&
      (!i.anySubRole || i.anySubRole.some((s) => subRoles.includes(s))),
  );
}
