import { InjectionToken } from '@angular/core';
import { PORTAL_SYSTEM, PortalSystem } from '../portal-system';
import { INCENTIVE_GROUPS } from './schemes/incentives.api';

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
  /** Shown only to a user whose screens (permissionRoutes) do not include this route (2026-11-07). */
  onlyWithout?: string;
  /**
   * Drop-down this entry belongs to in the menu bar (the old layout grouped the long menus the same way, e.g.
   * MasterAdmin's "Assessment"); the drop-down stands where its first entry is. Inside a `menu`, it is a heading.
   */
  group?: string;
  /**
   * V4: the menu bar's drop-down for this entry when the role has many screens (e.g. the Admin's "Masters"): the
   * entry's `group`, if any, becomes a heading inside it.
   */
  menu?: string;
}

/** A heading (or none) inside a drop-down, with its links. */
export interface StaffMenuSection {
  heading: string | null;
  items: StaffMenuItem[];
}

/** A menu bar entry: a link, or a drop-down of links (in sections under headings). */
export type StaffMenuEntry = { item: StaffMenuItem } | { group: string; items: StaffMenuItem[]; sections: StaffMenuSection[] };

/**
 * Folds the entries of each menu (or group) into one drop-down, keeping the menu order; inside a menu, the entries of a
 * group are under its heading. A drop-down with a single entry is a plain link (e.g. a sub-user given one screen).
 */
export function menuEntries(items: readonly StaffMenuItem[]): StaffMenuEntry[] {
  const entries: StaffMenuEntry[] = [];
  const dropDowns = new Map<string, { group: string; items: StaffMenuItem[]; sections: StaffMenuSection[] }>();
  for (const item of items) {
    const name = item.menu ?? item.group;
    if (!name) {
      entries.push({ item });
      continue;
    }
    let entry = dropDowns.get(name);
    if (!entry) {
      entry = { group: name, items: [], sections: [] };
      dropDowns.set(name, entry);
      entries.push(entry);
    }
    entry.items.push(item);
    const heading = item.menu ? (item.group ?? null) : null;
    let section = entry.sections.find((x) => x.heading === heading);
    if (!section) {
      section = { heading, items: [] };
      entry.sections.push(section);
    }
    section.items.push(item);
  }
  return entries.map((e) => ('group' in e && e.items.length === 1 ? { item: e.items[0] } : e));
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
  // New in V4: the dashboard logins' customer (ZED ID) history across the three systems.
  // Customer History is reached from Registered MSMEs (each ZED ID links to its history), 2026-10-27.
  // A Dashboard Admin given History without Registered MSMEs (2026-11-07) still needs a way in; the menu shows it only then.
  { label: 'Customer History', route: '/staff/history', roles: [R.SuperAdmin], onlyWithout: '/staff/registered-msme' },

  // Master admin: agencies, assessors and allocation
  // The live "Assessment" drop-down (Frontend/Shared/_Layout.cshtml, MasterAdmin), its labels and order; then the V4 additions.
  { label: 'Assessment Agencies', legacyPath: '/User/AssessmentAgencies', route: '/staff/users/agencies', roles: [R.MasterAdmin], group: 'Agencies' },
  { label: 'Agency Level Allocation', legacyPath: '/User/BronzeAssessmentAgencies', route: '/staff/users/bronze-agencies', roles: [R.MasterAdmin], group: 'Agencies' },
  { label: 'Assessors', legacyPath: '/User/AssessorList', route: '/staff/users/assessors', roles: [R.MasterAdmin], group: 'Agencies' },
  { label: 'Payment Received', legacyPath: '/Dashboard/PaymentReceived', route: '/staff/payments-received', roles: [R.MasterAdmin], group: 'Assessment' },
  { label: 'Allot Assessment', legacyPath: '/Assessment/Allot', route: '/staff/assessment/allot', roles: [R.MasterAdmin], group: 'Assessment' },
  { label: 'Assessment Monitoring', legacyPath: '/Monitoring/Index', route: '/staff/monitoring', roles: [R.MasterAdmin], group: 'Assessment' },
  { label: 'Assessment Completed', legacyPath: '/Assessment/Completed', route: '/staff/assessment/completed', roles: [R.MasterAdmin], group: 'Assessment' },
  { label: 'Rejected Certification', legacyPath: '/Assessment/Rejected', route: '/staff/assessment/rejected', roles: [R.MasterAdmin], group: 'Assessment' },
  { label: 'Password Reset Link', route: '/staff/users/password-reset', roles: [R.MasterAdmin], group: 'Agencies' },
  // One NEFT Admin for financial assistance and Technology Upgradation, assigned by the Master Admin (2026-11-07).
  { label: 'NEFT Admins', route: '/staff/users/neft-admins', roles: [R.MasterAdmin], group: 'Agencies' },
  { label: 'ZED ID History', legacyPath: '/Msme/History', route: '/staff/history', roles: [R.MasterAdmin], group: 'Assessment' },

  // Assessment workflow
  { label: 'Monitoring', legacyPath: '/Monitoring/Index', route: '/staff/monitoring', roles: [R.Agency], anySubRole: ['SiteVerification', 'DesktopVerification'], group: 'Assessment' },
  { label: 'Assessors', legacyPath: '/User/Assessors', route: '/staff/users/my-assessors', roles: [R.Agency] },
  { label: 'DA Allotment', legacyPath: '/Assessment/DaAllotment', route: '/staff/assessment/da-allotment', roles: [R.Agency], subRoles: ['DesktopVerification'], group: 'Allotment' },
  { label: 'SA Allotment', legacyPath: '/Assessment/SaAllotment', route: '/staff/sa-allotment', roles: [R.Agency], subRoles: ['SiteVerification'], group: 'Allotment' },
  { label: 'Desktop Verification', legacyPath: '/Assessment/DaVerification', route: '/staff/assessment/da-verification', roles: [R.DesktopAssessor], subRoles: ['DesktopVerification'] },
  { label: 'Non-Conformances', legacyPath: '/Assessment/NonConfirmances', route: '/staff/assessment/non-conformances', roles: [R.DesktopAssessor] },
  { label: 'Remote Assessments', legacyPath: '/Assessment/RemoteAssessments', route: '/staff/remote-assessments', roles: [R.DesktopAssessor], subRoles: ['SiteVerification'] },
  { label: 'Completed', legacyPath: '/Assessment/Completed', route: '/staff/assessment/completed', roles: [R.DesktopAssessor] },
  { label: 'Completed', legacyPath: '/Assessment/Completed', route: '/staff/assessment/completed', roles: [R.Agency], anySubRole: ['SiteVerification', 'DesktopVerification'], group: 'Assessment' },
  { label: 'Rejected Certification', legacyPath: '/Assessment/Rejected', route: '/staff/assessment/rejected', roles: [R.DesktopAssessor] },
  { label: 'Rejected Certification', legacyPath: '/Assessment/Rejected', route: '/staff/assessment/rejected', roles: [R.Agency], anySubRole: ['SiteVerification', 'DesktopVerification'], group: 'Assessment' },

  // Schemes and finance
  { label: 'Financial Assistance', legacyPath: '/FinancialAssistance/Submissions', route: '/staff/financial-assistance', roles: [R.MasterAdmin], group: 'Schemes' },
  { label: 'Financial Assistance', legacyPath: '/FinancialAssistance/Submissions', route: '/staff/financial-assistance', roles: [R.Agency, R.DesktopAssessor], subRoles: ['FinancialVerification'] },
  { label: 'Incentive Submissions', legacyPath: '/Incentive/Submissions', route: '/staff/incentives/submissions', roles: [R.SuperAdmin] },
  { label: 'Upload API Incentives', legacyPath: '/Incentive/UploadIncentives', route: '/staff/incentives/upload', roles: [R.MasterAdmin], group: 'Schemes' },
  { label: 'NEFT: New Transactions', legacyPath: '/Neft/NewTransactions', route: '/staff/neft/new', roles: [R.StateCoordinator] },
  { label: 'NEFT: Approved Transactions', legacyPath: '/Neft/ApprovedTransactions', route: '/staff/neft/approved', roles: [R.StateCoordinator] },
  { label: 'NEFT: Rejected Transactions', legacyPath: '/Neft/RejectedTransactions', route: '/staff/neft/rejected', roles: [R.StateCoordinator] },

  // Admin: as the live layout (Frontend/Shared/_Layout.cshtml, Admin), labels and order; Questionnaire and Technology
  // Upgradation are drop-downs of their own rather than headings under Masters (V4, 2026-10-27).
  { label: 'Upload Image', legacyPath: '/Home/PageSettings', route: '/staff/masters/page-settings', roles: [R.Admin], menu: 'Masters' },
  { label: 'Documents/Videos', legacyPath: '/MyDocuments/Index', route: '/staff/masters/documents', roles: [R.Admin], menu: 'Masters' },
  { label: 'Sectors', legacyPath: '/Sector/List', route: '/staff/masters/sectors', roles: [R.Admin], menu: 'Masters' },
  { label: 'Payments', legacyPath: '/Assessment/PaymentDetails', route: '/staff/fees', roles: [R.Admin], menu: 'Masters' },
  // New in V4: the regions of the additional subsidy, and the states and districts from the LG Directory.
  { label: 'Subsidy Regions', route: '/staff/masters/regions', roles: [R.Admin], menu: 'Masters' },
  { label: 'LG Directory', route: '/staff/masters/lgd', roles: [R.Admin], menu: 'Masters' },
  ...(['Bronze', 'Silver', 'Gold'] as const).map((level) => ({
    label: level, legacyPath: `/Questionaire/Index?SectionType=${level}`, route: `/staff/masters/parameters/${level}`, roles: [R.Admin as number], menu: 'Questionnaire',
  })),
  // New in V4: the ZED-X level (Administration → Certification Levels); its parameters are NIC sector-wise.
  { label: 'ZED-X', route: '/staff/masters/parameters/ZEDX', roles: [R.Admin], menu: 'Questionnaire' },
  // New in V4: the ESG checklist of the MSME app's assessment (before, a fixed file).
  { label: 'ESG Checklist', route: '/staff/settings/esg-checklist', roles: [R.Admin], menu: 'Questionnaire' },
  { label: 'Categories', legacyPath: '/Category/list', route: '/staff/masters/categories', roles: [R.Admin], menu: 'Technology Upgradation' },
  { label: 'Technologies', legacyPath: '/Technology/list', route: '/staff/masters/technologies', roles: [R.Admin], menu: 'Technology Upgradation' },
  // The four groups of incentives (V4, as the LEAN portal; the old menu listed every type and each state).
  ...INCENTIVE_GROUPS.map((g) => ({ label: g.label, legacyPath: '/Incentive/Index', route: `/staff/incentives/${g.key}`, roles: [R.Admin as number], group: 'Incentives' })),
  // New in V4: "My Incentives" of the MSME dashboard (the built-in cards and the incentives put there).
  { label: 'Main Dashboard Cards', route: '/staff/incentives/dashboard-cards', roles: [R.Admin], group: 'Incentives' },
  // New in V4: the Admin's logins (Master Admin, Ministry, MSME DFO, dashboard), a tab of its own, and the settings.
  { label: 'User Management', route: '/staff/user-management', roles: [R.Admin] },
  { label: 'Captcha Settings', route: '/staff/settings/captcha', roles: [R.Admin], menu: 'Administration' },
  { label: 'Email Settings', route: '/staff/settings/email', roles: [R.Admin], menu: 'Administration' },
  // New in V4: the CCAvenue account and the invoice switch (main portal only: payments run there).
  { label: 'Payment Gateway and Invoices', route: '/staff/settings/payment-gateway', roles: [R.Admin], menu: 'Administration' },
  { label: 'Email Templates', route: '/staff/settings/email-templates', roles: [R.Admin], menu: 'Administration' },
  { label: 'Texts', route: '/staff/settings/texts', roles: [R.Admin], menu: 'Administration' },
  { label: 'App Forms', route: '/staff/settings/app-forms', roles: [R.Admin], menu: 'Administration' },
  // New in V4: the site tour sections of the site assessor app (main and surveillance only).
  { label: 'Site Tour Sections', route: '/staff/settings/site-tour-sections', roles: [R.Admin], menu: 'Administration' },
  // New in V4: the partners calling ZED's APIs, with a switch per partner and per API.
  { label: 'API Integrations', route: '/staff/settings/api-integrations', roles: [R.Admin], menu: 'Administration' },
  // New in V4: where "Contact ZED" goes (the ZED website's contact page).
  { label: 'Links', route: '/staff/settings/links', roles: [R.Admin], menu: 'Administration' },
  // New in V4: the certification levels' boxes (ZED-X included) and their certificate settings.
  { label: 'Certification Levels', route: '/staff/settings/levels', roles: [R.Admin], menu: 'Administration' },
  // New in V4: the documents and videos the Admin gave to the account type.
  { label: 'Documents', route: '/staff/documents', roles: [R.MasterAdmin, R.Agency, R.DesktopAssessor, R.StateCoordinator, R.Ministry, R.SuperAdmin, R.CitizenFeedback, R.QC] },
  // New in V4: the owners' own logins (sub-users work as their owner on the screens it gives them).
  { label: 'Operation Admins', route: '/staff/sub-users', roles: [R.MasterAdmin] },
  { label: 'Sub-Users', route: '/staff/sub-users', roles: [R.Agency] },
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
  // Customer History: from Registered MSME for SuperAdmin; Citizen Feedback and QC have no list here, so they keep the item.
  { label: 'Customer History', route: '/staff/history', roles: [R.CitizenFeedback, R.QC] },

  // Admin: as the live layout; its Incentives drop-down is not ported (ZED_CONSULTANT incentives are not served here).
  { label: 'Upload Image', route: '/staff/masters/page-settings', roles: [R.Admin], menu: 'Masters' },
  { label: 'Documents/Videos', route: '/staff/masters/documents', roles: [R.Admin], menu: 'Masters' },
  { label: 'Sectors', route: '/staff/masters/sectors', roles: [R.Admin], menu: 'Masters' },
  { label: 'Payments', route: '/staff/fees', roles: [R.Admin], menu: 'Masters' },
  // No Questionnaire: the live menu had it, but ZED_CONSULTANT has no section tables, so its pages failed.
  // New in V4: the Admin's logins (Master Admin, Ministry, MSME DFO, dashboard), a tab of its own, and the settings.
  { label: 'User Management', route: '/staff/user-management', roles: [R.Admin] },
  { label: 'Captcha Settings', route: '/staff/settings/captcha', roles: [R.Admin], menu: 'Administration' },
  { label: 'Email Settings', route: '/staff/settings/email', roles: [R.Admin], menu: 'Administration' },
  { label: 'Email Templates', route: '/staff/settings/email-templates', roles: [R.Admin], menu: 'Administration' },
  { label: 'Texts', route: '/staff/settings/texts', roles: [R.Admin], menu: 'Administration' },
  { label: 'App Forms', route: '/staff/settings/app-forms', roles: [R.Admin], menu: 'Administration' },

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
  { label: 'Consultancy Completed', route: '/staff/assessment/completed', roles: [R.Agency], subRoles: ['SiteVerification'], group: 'Consultancy' },
  { label: 'Allot Consultancy', route: '/staff/site-assessment/co-allotment', roles: [R.Agency], subRoles: ['SiteVerification'], group: 'Consultancy' },
  { label: 'Consultancy Monitoring', route: '/staff/monitoring', roles: [R.Agency], subRoles: ['SiteVerification'], group: 'Consultancy' },
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
  // New in V4: the documents and videos the Admin gave to the account type.
  { label: 'Documents', route: '/staff/documents', roles: [R.MasterAdmin, R.Agency, R.DesktopAssessor, R.StateCoordinator, R.Ministry, R.SuperAdmin, R.CitizenFeedback, R.QC] },
  // New in V4: the owners' own logins (sub-users work as their owner on the screens it gives them).
  { label: 'Operation Admins', route: '/staff/sub-users', roles: [R.MasterAdmin] },
  { label: 'Sub-Users', route: '/staff/sub-users', roles: [R.Agency] },
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
  // Customer History: from Registered MSME for SuperAdmin and Citizen Feedback; QC has no list here, so it keeps the item.
  { label: 'Customer History', route: '/staff/history', roles: [R.QC] },

  { label: 'Payments', route: '/staff/fees', roles: [R.Admin], menu: 'Masters' },
  { label: 'Sectors', route: '/staff/masters/sectors', roles: [R.Admin], menu: 'Masters' },
  ...(['Bronze', 'Silver', 'Gold'] as const).map((level) => ({
    label: level, route: `/staff/masters/parameters/${level}`, roles: [R.Admin as number], menu: 'Questionnaire',
  })),
  { label: 'ZED-X', route: '/staff/masters/parameters/ZEDX', roles: [R.Admin], menu: 'Questionnaire' },
  // New in V4: the ESG checklist of the surveillance app's assessment (before, a fixed file).
  { label: 'ESG Checklist', route: '/staff/settings/esg-checklist', roles: [R.Admin], menu: 'Questionnaire' },
  // New in V4: the Admin's logins (Master Admin, Ministry, MSME DFO, dashboard), a tab of its own, and the settings.
  { label: 'User Management', route: '/staff/user-management', roles: [R.Admin] },
  { label: 'Captcha Settings', route: '/staff/settings/captcha', roles: [R.Admin], menu: 'Administration' },
  { label: 'Email Settings', route: '/staff/settings/email', roles: [R.Admin], menu: 'Administration' },
  { label: 'Email Templates', route: '/staff/settings/email-templates', roles: [R.Admin], menu: 'Administration' },
  { label: 'Texts', route: '/staff/settings/texts', roles: [R.Admin], menu: 'Administration' },
  { label: 'App Forms', route: '/staff/settings/app-forms', roles: [R.Admin], menu: 'Administration' },
  // New in V4: the site tour sections of the site assessor app (main and surveillance only).
  { label: 'Site Tour Sections', route: '/staff/settings/site-tour-sections', roles: [R.Admin], menu: 'Administration' },
  { label: 'Certification Levels', route: '/staff/settings/levels', roles: [R.Admin], menu: 'Administration' },

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
  { label: 'Monitoring', route: '/staff/monitoring', roles: [R.Agency], anySubRole: ['SiteVerification', 'DesktopVerification'], group: 'Surveillance' },
  { label: 'Surveillance Completed', route: '/staff/assessment/completed', roles: [R.Agency], anySubRole: ['SiteVerification', 'DesktopVerification'], group: 'Surveillance' },
  { label: 'Assessors', route: '/staff/users/surveillance-assessors', roles: [R.Agency], subRoles: ['DesktopVerification'] },
  { label: 'Allot Surveillance', route: '/staff/assessment/da-allotment', roles: [R.Agency], subRoles: ['DesktopVerification'], group: 'Allotment' },
  { label: 'Allot Surveillance (Site)', route: '/staff/sa-allotment', roles: [R.Agency], subRoles: ['SiteVerification'], group: 'Allotment' },
  { label: 'Surveillance Rejected', route: '/staff/assessment/rejected', roles: [R.Agency], anySubRole: ['SiteVerification', 'DesktopVerification'], group: 'Surveillance' },
  { label: 'Reports', route: '/staff/reports', roles: [R.Agency] },

  // Assessor
  { label: 'Surveillance Assessments', route: '/staff/assessment/da-verification', roles: [R.DesktopAssessor], subRoles: ['DesktopVerification'] },
  // Shown to every assessor, as the live layout does (no sub-role check on these two).
  { label: 'Completed', route: '/staff/assessment/completed', roles: [R.DesktopAssessor] },
  { label: 'Non-Conformances', route: '/staff/assessment/non-conformances', roles: [R.DesktopAssessor] },
  { label: 'Surveillance Assessments (Site)', route: '/staff/remote-assessments', roles: [R.DesktopAssessor], subRoles: ['SiteVerification'] },
  { label: 'Surveillance Rejected', route: '/staff/assessment/rejected', roles: [R.DesktopAssessor] },
  // New in V4: the owners' own logins (sub-users work as their owner on the screens it gives them).
  { label: 'Operation Admins', route: '/staff/sub-users', roles: [R.MasterAdmin] },
  { label: 'Sub-Users', route: '/staff/sub-users', roles: [R.Agency] },
];

export const MENUS: Record<PortalSystem, StaffMenuItem[]> = { main: MAIN_MENU, consultancy: CONSULTANCY_MENU, surveillance: SURVEILLANCE_MENU };

/** The system of this build for the staff pages that differ per portal (a token, so specs can render each variant). */
/**
 * The role as people say it (2026-11-08): Dashboard Admin (RoleId 10), NEFT Admin or MSME DFO (RoleId 6), otherwise the role
 * name with spaces ("MasterAdmin" -> "Master Admin").
 */
export function staffRoleName(user: { roleId: number; role?: string | null; isNeftAdmin?: boolean } | null | undefined): string {
  if (!user) return '';
  if (user.roleId === 10) return 'Dashboard Admin';
  if (user.roleId === 6) return user.isNeftAdmin ? 'NEFT Admin' : 'MSME DFO';
  return (user.role ?? '').replace(/([a-z])([A-Z])/g, '$1 $2');
}

export const STAFF_SYSTEM = new InjectionToken<PortalSystem>('STAFF_SYSTEM', { providedIn: 'root', factory: () => PORTAL_SYSTEM });

/** The menu of this build. */
export const STAFF_MENU: StaffMenuItem[] = MENUS[PORTAL_SYSTEM];

/**
 * Roles whose legacy home page was Dashboard/Index, and (new in V4) the Admin, who gets MasterAdmin's dashboard on
 * every system; the others keep the card home.
 */
export const DASHBOARD_ROLE_IDS: number[] = [R.SuperAdmin, R.MasterAdmin, R.Admin, R.Ministry, R.Agency, R.DesktopAssessor, R.CitizenFeedback, R.QC];

/**
 * Where the old login sent a role on each system (UserController.Login), when not to the dashboard. The Admin's old
 * landing pages (Consultancy's Bronze questionnaire, Surveillance's fee master) give way to the dashboard.
 */
export const HOME_ROUTES: Record<PortalSystem, Partial<Record<number, string>>> = {
  main: {},
  consultancy: { [R.StateCoordinator]: '/staff/neft/new' },
  surveillance: {},
};

/** The landing page of a role after sign-in, or null for the card home. */
export function homeFor(roleId: number, system: PortalSystem = PORTAL_SYSTEM): string | null {
  return HOME_ROUTES[system][roleId] ?? (DASHBOARD_ROLE_IDS.includes(roleId) ? '/staff/dashboard' : null);
}

/**
 * The menu of a role. A sub-user (operation admin, agency sub-user) gets its owner's menu limited to the screens its owner
 * gave it (`permissionRoutes`, from the sign-in); the API checks them again.
 */
export function menuFor(
  roleId: number,
  subRoles: readonly string[],
  system: PortalSystem = PORTAL_SYSTEM,
  permissionRoutes?: readonly string[] | null,
): StaffMenuItem[] {
  return MENUS[system].filter(
    (i) =>
      i.roles.includes(roleId) &&
      (i.subRoles ?? []).every((s) => subRoles.includes(s)) &&
      (!i.anySubRole || i.anySubRole.some((s) => subRoles.includes(s))) &&
      (!permissionRoutes || (!!i.route && permissionRoutes.some((r) => i.route === r || i.route!.startsWith(r + '/')))) &&
      (!i.onlyWithout || (!!permissionRoutes && !permissionRoutes.includes(i.onlyWithout))),
  );
}
