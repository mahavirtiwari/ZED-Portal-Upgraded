import { InjectionToken } from '@angular/core';
import { PORTAL_SYSTEM, PortalSystem } from '../portal-system';
import { LABELS } from '../portal-labels';
import { INCENTIVE_GROUPS, groupText } from './schemes/incentives.api';
import { allLevels, isLegacyLevel, levelName } from '../msme/shared/levels';
import { t } from '../content/page-text';

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

/**
 * 2026-11-20 (incentive schemes, phase 2): the pseudo sub-role of an onsite verification agency (Users.AgencyKind 'SchemeOnsite'),
 * its sub-users and its assessors, added at sign-in (IncentiveAgencies.OnsiteSubRole). They see only the entries for `onsite`.
 */
export const ONSITE_SUB_ROLE = 'SchemeOnsite';

/**
 * 2026-11-20 (the product owner): the pseudo sub-role of a desktop verification agency (Users.AgencyKind 'SchemeDesktop'), its
 * sub-users and its assessors, added at sign-in (IncentiveAgencies.DesktopSubRole). They see only the entries for `desktop`.
 */
export const DESKTOP_SCHEME_SUB_ROLE = 'SchemeDesktop';

/**
 * The kind of agency an agency user (or an assessor, by its agency) is: an assessment agency, or an incentive verification agency
 * (desktop / onsite), from the sign-in's sub-roles.
 */
export type AgencyKind = 'assessment' | 'desktop' | 'onsite';

export function agencyKindOf(subRoles: readonly string[]): AgencyKind {
  return subRoles.includes(ONSITE_SUB_ROLE) ? 'onsite' : subRoles.includes(DESKTOP_SCHEME_SUB_ROLE) ? 'desktop' : 'assessment';
}

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
   * V4: the menu bar's drop-down for this entry when the role has many screens (e.g. the Admin's "Master"): the
   * entry's `group`, if any, becomes a heading inside it.
   */
  menu?: string;
  /**
   * 2026-11-08: a placeholder the menu expands into one entry per certification level (Administration → Certification
   * Levels, api/public/levels/all, disabled levels too): `{level}` in the label and route is the level's name and code.
   */
  perLevel?: boolean;
  /**
   * 2026-11-20: the kinds of agency (and their assessors) the entry is for ({@link agencyKindOf}); without it, the assessment
   * agencies only. The incentive verification agencies (desktop, onsite) see only the entries listing their kind.
   */
  agencyKinds?: readonly AgencyKind[];
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
const ALL_KINDS: readonly AgencyKind[] = ['assessment', 'desktop', 'onsite'];
const ASSESSMENT_ONLY: readonly AgencyKind[] = ['assessment'];

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
  { label: 'Assessors', legacyPath: '/User/Assessors', route: '/staff/users/my-assessors', roles: [R.Agency], agencyKinds: ALL_KINDS },
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
  // 2026-11-20: the incentive schemes the Admin defines (verified like the assessment). 2026-11-20 (the product owner): desktop and
  // onsite are done by separate agencies the Master Admin adds (Incentive Verification Agencies, by state and district), never by the
  // assessment agencies: the desktop agency's allotment and QC, its assessors' verification; the onsite agency's onsite allotment and
  // final QC (its assessors verify in the app).
  { label: 'Scheme Applications', route: '/staff/schemes-verify/applications', roles: [R.MasterAdmin], group: 'Schemes' },
  { label: 'Incentive Verification Agencies', route: '/staff/scheme-agencies', roles: [R.MasterAdmin], group: 'Schemes' },
  { label: 'Scheme Allotment', route: '/staff/schemes-verify/allotment', roles: [R.Agency], group: 'Schemes', agencyKinds: ['desktop'] },
  { label: 'Scheme QC', route: '/staff/schemes-verify/qc', roles: [R.Agency], group: 'Schemes', agencyKinds: ['desktop'] },
  { label: 'Scheme Verification', route: '/staff/schemes-verify/verification', roles: [R.DesktopAssessor], agencyKinds: ['desktop'] },
  { label: 'Scheme Onsite Allotment', route: '/staff/scheme-onsite/allotment', roles: [R.Agency], group: 'Schemes', agencyKinds: ['onsite'] },
  { label: 'Scheme Onsite QC', route: '/staff/scheme-onsite/qc', roles: [R.Agency], group: 'Schemes', agencyKinds: ['onsite'] },
  { label: 'NEFT: New Transactions', legacyPath: '/Neft/NewTransactions', route: '/staff/neft/new', roles: [R.StateCoordinator] },
  { label: 'NEFT: Approved Transactions', legacyPath: '/Neft/ApprovedTransactions', route: '/staff/neft/approved', roles: [R.StateCoordinator] },
  { label: 'NEFT: Rejected Transactions', legacyPath: '/Neft/RejectedTransactions', route: '/staff/neft/rejected', roles: [R.StateCoordinator] },

  // Admin: as the live layout (Frontend/Shared/_Layout.cshtml, Admin), labels and order; Questionnaire and Technology
  // Upgradation are drop-downs of their own rather than headings under Masters (V4, 2026-10-27).
  // 2026-11-14 (approved frame A): every Admin screen as tiles in groups, with a search (the staff home page).
  { label: 'All settings', route: '/staff/administration', roles: [R.Admin] },
  { label: 'Upload Image', legacyPath: '/Home/PageSettings', route: '/staff/masters/page-settings', roles: [R.Admin], menu: 'Master' },
  { label: 'Documents/Videos', legacyPath: '/MyDocuments/Index', route: '/staff/masters/documents', roles: [R.Admin], menu: 'Master' },
  { label: 'Sectors', legacyPath: '/Sector/List', route: '/staff/masters/sectors', roles: [R.Admin], menu: 'Master' },
  { label: 'Payments', legacyPath: '/Assessment/PaymentDetails', route: '/staff/fees', roles: [R.Admin], menu: 'Master' },
  { label: 'Expenditure Rates', route: '/staff/fees/expenditure-rates', roles: [R.Admin], menu: 'Master' },
  // New in V4: the regions of the additional subsidy, and the states and districts from the LG Directory.
  { label: 'Subsidy Regions', route: '/staff/masters/regions', roles: [R.Admin], menu: 'Master' },
  { label: 'LG Directory', route: '/staff/masters/lgd', roles: [R.Admin], menu: 'Master' },
  // A questionnaire per level: Bronze, Silver, Gold, ZED-X (NIC sector-wise) and the levels the Admin adds (2026-11-08).
  {
    label: '{level}', legacyPath: '/Questionaire/Index?SectionType={level}', route: '/staff/masters/parameters/{level}', roles: [R.Admin],
    menu: 'Questionnaire', perLevel: true,
  },
  // New in V4: the ESG checklist of the MSME app's assessment (before, a fixed file).
  { label: 'ESG Checklist', route: '/staff/settings/esg-checklist', roles: [R.Admin], menu: 'Questionnaire' },
  { label: 'Categories', legacyPath: '/Category/list', route: '/staff/masters/categories', roles: [R.Admin], menu: 'Technology Upgradation' },
  { label: 'Technologies', legacyPath: '/Technology/list', route: '/staff/masters/technologies', roles: [R.Admin], menu: 'Technology Upgradation' },
  // The four groups of incentives (V4, as the LEAN portal; the old menu listed every type and each state).
  ...INCENTIVE_GROUPS.map((g) => ({ label: g.label, legacyPath: '/Incentive/Index', route: `/staff/incentives/${g.key}`, roles: [R.Admin as number], group: 'Incentives' })),
  // New in V4: "My Incentives" of the MSME dashboard (the built-in cards and the incentives put there).
  { label: 'Main Dashboard Cards', route: '/staff/incentives/dashboard-cards', roles: [R.Admin], group: 'Incentives' },
  { label: 'Incentive Schemes', route: '/staff/incentives/schemes', roles: [R.Admin], group: 'Incentives' },
  // New in V4: the Admin's logins (Master Admin, Ministry, MSME DFO, dashboard), a tab of its own, and the settings.
  { label: 'User Management', route: '/staff/user-management', roles: [R.Admin] },
  { label: 'Captcha Settings', route: '/staff/settings/captcha', roles: [R.Admin], menu: 'Administration' },
  { label: 'Email Settings', route: '/staff/settings/email', roles: [R.Admin], menu: 'Administration' },
  // 2026-11-13: how agencies' certified professionals are verified (per portal).
  { label: 'Professional Verification', route: '/staff/settings/professional-verification', roles: [R.Admin], menu: 'Administration' },
  // New in V4: the CCAvenue account and the invoice switch (main portal only: payments run there).
  { label: 'Payment Gateway and Invoices', route: '/staff/settings/payment-gateway', roles: [R.Admin], menu: 'Administration' },
  { label: 'Email Templates', route: '/staff/settings/email-templates', roles: [R.Admin], menu: 'Administration' },
  // 2026-11-21 (the user: "add logger"): the portal's warnings and errors, readable without access to the server.
  { label: 'Server Logs', route: '/staff/settings/server-logs', roles: [R.Admin], menu: 'Administration' },
  // 2026-11-15: each portal and app up or down (main portal only).
  { label: 'Maintenance mode', route: '/staff/settings/maintenance', roles: [R.Admin], menu: 'Administration' },
  // 2026-11-15: the logos and colour themes of each portal and app (main portal only).
  { label: 'Branding', route: '/staff/settings/branding', roles: [R.Admin], menu: 'Administration' },
  { label: 'Texts', route: '/staff/settings/texts', roles: [R.Admin], menu: 'Administration' },
  { label: 'App Forms', route: '/staff/settings/app-forms', roles: [R.Admin], menu: 'Administration' },
  // New in V4: the site tour sections of the site assessor app (main and surveillance only).
  { label: 'Site Tour Sections', route: '/staff/settings/site-tour-sections', roles: [R.Admin], menu: 'Administration' },
  // 2026-11-17 (approved): what is ticked before a final submit / quality check, and the quality observation reasons (each portal's).
  { label: 'Submission Checklists', route: '/staff/settings/submission-checklists', roles: [R.Admin], menu: 'Administration' },
  { label: 'Observation Reasons', route: '/staff/settings/observation-reasons', roles: [R.Admin], menu: 'Administration' },
  // 2026-11-19 (approved): the reasons an agency picks when it rejects a unit allotted to it (each portal's, main and surveillance).
  { label: 'Rejection Reasons', route: '/staff/settings/rejection-reasons', roles: [R.Admin], menu: 'Administration' },
  // 2026-11-18: turnaround times per status and between statuses, per module (portal switch); the monitoring pages' delays.
  { label: 'TAT (Turnaround Time)', route: '/staff/settings/tat', roles: [R.Admin], menu: 'Administration' },
  // New in V4: the partners calling ZED's APIs, with a switch per partner and per API.
  { label: 'API Integrations', route: '/staff/settings/api-integrations', roles: [R.Admin], menu: 'Administration' },
  // New in V4: where "Contact ZED" goes (the ZED website's contact page).
  { label: 'Links', route: '/staff/settings/links', roles: [R.Admin], menu: 'Administration' },
  // New in V4: the certification levels' boxes (ZED-X included) and their certificate settings.
  { label: 'Certification Levels', route: '/staff/settings/levels', roles: [R.Admin], menu: 'Administration' },
  // New in V4: the documents and videos the Admin gave to the account type.
  // 2026-11-18 (approved design "Expenditure monitoring"): cases, payable, POs and invoices; the agencies' monthly invoices.
  { label: 'Expenditure', route: '/staff/expenditure', roles: [R.MasterAdmin, R.Admin] },
  { label: 'Expenditure', route: '/staff/expenditure/invoices', roles: [R.Agency] },
  { label: 'Documents', route: '/staff/documents', roles: [R.MasterAdmin, R.Agency, R.DesktopAssessor, R.StateCoordinator, R.Ministry, R.SuperAdmin, R.CitizenFeedback, R.QC] },
  // New in V4: the owners' own logins (sub-users work as their owner on the screens it gives them).
  // 2026-11-16: the ZED team's quality observations, their dashboard and ranking; agencies reply there.
  { label: 'Quality Observations', route: '/staff/quality-observations', roles: [R.MasterAdmin, R.Agency] },
  { label: 'Operation Admins', route: '/staff/sub-users', roles: [R.MasterAdmin] },
  { label: 'Sub-Users', route: '/staff/sub-users', roles: [R.Agency], agencyKinds: ALL_KINDS },
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
  // 2026-11-14 (approved frame A): every Admin screen as tiles in groups, with a search (the staff home page).
  { label: 'All settings', route: '/staff/administration', roles: [R.Admin] },
  { label: 'Upload Image', route: '/staff/masters/page-settings', roles: [R.Admin], menu: 'Master' },
  { label: 'Documents/Videos', route: '/staff/masters/documents', roles: [R.Admin], menu: 'Master' },
  { label: 'Sectors', route: '/staff/masters/sectors', roles: [R.Admin], menu: 'Master' },
  { label: 'Payments', route: '/staff/fees', roles: [R.Admin], menu: 'Master' },
  // No Questionnaire: the live menu had it, but ZED_CONSULTANT has no section tables, so its pages failed.
  // New in V4: the Admin's logins (Master Admin, Ministry, MSME DFO, dashboard), a tab of its own, and the settings.
  { label: 'User Management', route: '/staff/user-management', roles: [R.Admin] },
  { label: 'Captcha Settings', route: '/staff/settings/captcha', roles: [R.Admin], menu: 'Administration' },
  { label: 'Email Settings', route: '/staff/settings/email', roles: [R.Admin], menu: 'Administration' },
  // 2026-11-13: how agencies' certified professionals are verified (per portal).
  { label: 'Professional Verification', route: '/staff/settings/professional-verification', roles: [R.Admin], menu: 'Administration' },
  { label: 'Email Templates', route: '/staff/settings/email-templates', roles: [R.Admin], menu: 'Administration' },
  // 2026-11-21 (the user: "add logger"): the portal's warnings and errors, readable without access to the server.
  { label: 'Server Logs', route: '/staff/settings/server-logs', roles: [R.Admin], menu: 'Administration' },
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
  { label: 'Expenditure', route: '/staff/expenditure', roles: [R.MasterAdmin] },
  { label: 'Expenditure', route: '/staff/expenditure/invoices', roles: [R.Agency] },
  { label: 'Documents', route: '/staff/documents', roles: [R.MasterAdmin, R.Agency, R.DesktopAssessor, R.StateCoordinator, R.Ministry, R.SuperAdmin, R.CitizenFeedback, R.QC] },
  // New in V4: the owners' own logins (sub-users work as their owner on the screens it gives them).
  // 2026-11-16: the ZED team's quality observations, their dashboard and ranking; agencies reply there.
  { label: 'Quality Observations', route: '/staff/quality-observations', roles: [R.MasterAdmin, R.Agency] },
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

  // 2026-11-14 (approved frame A): every Admin screen as tiles in groups, with a search (the staff home page).
  { label: 'All settings', route: '/staff/administration', roles: [R.Admin] },
  { label: 'Payments', route: '/staff/fees', roles: [R.Admin], menu: 'Master' },
  { label: 'Sectors', route: '/staff/masters/sectors', roles: [R.Admin], menu: 'Master' },
  { label: '{level}', route: '/staff/masters/parameters/{level}', roles: [R.Admin], menu: 'Questionnaire', perLevel: true },
  // New in V4: the ESG checklist of the surveillance app's assessment (before, a fixed file).
  { label: 'ESG Checklist', route: '/staff/settings/esg-checklist', roles: [R.Admin], menu: 'Questionnaire' },
  // New in V4: the Admin's logins (Master Admin, Ministry, MSME DFO, dashboard), a tab of its own, and the settings.
  { label: 'User Management', route: '/staff/user-management', roles: [R.Admin] },
  { label: 'Captcha Settings', route: '/staff/settings/captcha', roles: [R.Admin], menu: 'Administration' },
  { label: 'Email Settings', route: '/staff/settings/email', roles: [R.Admin], menu: 'Administration' },
  // 2026-11-13: how agencies' certified professionals are verified (per portal).
  { label: 'Professional Verification', route: '/staff/settings/professional-verification', roles: [R.Admin], menu: 'Administration' },
  { label: 'Email Templates', route: '/staff/settings/email-templates', roles: [R.Admin], menu: 'Administration' },
  // 2026-11-21 (the user: "add logger"): the portal's warnings and errors, readable without access to the server.
  { label: 'Server Logs', route: '/staff/settings/server-logs', roles: [R.Admin], menu: 'Administration' },
  { label: 'Texts', route: '/staff/settings/texts', roles: [R.Admin], menu: 'Administration' },
  { label: 'App Forms', route: '/staff/settings/app-forms', roles: [R.Admin], menu: 'Administration' },
  // New in V4: the site tour sections of the site assessor app (main and surveillance only).
  { label: 'Site Tour Sections', route: '/staff/settings/site-tour-sections', roles: [R.Admin], menu: 'Administration' },
  // 2026-11-19 (approved): the reasons an agency picks when it rejects a unit allotted to it.
  { label: 'Rejection Reasons', route: '/staff/settings/rejection-reasons', roles: [R.Admin], menu: 'Administration' },
  { label: 'Certification Levels', route: '/staff/settings/levels', roles: [R.Admin], menu: 'Administration' },

  // MasterAdmin
  // As the live layout (ZEDCS_SURVEILLANCE Frontend/Shared/_Layout.cshtml): "Allot Surveillance", then the "Surveillance
  // Monitoring" drop-down; Assessors (commented out there) and Password Reset Link are V4's.
  { label: 'Allot Surveillance', route: '/staff/assessment/allot', roles: [R.MasterAdmin] },
  // 2026-11-19 (the user could not find Block): every agency is on this list (block / unblock, Bronze surveillance), so it is
  // named and grouped as on the main portal ("Agencies": Assessment Agencies, Assessors); before, "Bronze Surveillance Agencies".
  { label: 'Assessment Agencies', route: '/staff/users/surveillance-agencies', roles: [R.MasterAdmin], group: 'Agencies' },
  { label: 'Assessors', route: '/staff/users/surveillance-assessors', roles: [R.MasterAdmin], group: 'Agencies' },
  { label: 'Surveillance Payment Received', route: '/staff/payments-received', roles: [R.MasterAdmin], group: 'Surveillance Monitoring' },
  { label: 'Surveillance Monitoring', route: '/staff/monitoring', roles: [R.MasterAdmin], group: 'Surveillance Monitoring' },
  { label: 'Surveillance Completed', route: '/staff/assessment/completed', roles: [R.MasterAdmin], group: 'Surveillance Monitoring' },
  { label: 'Surveillance Rejected', route: '/staff/assessment/rejected', roles: [R.MasterAdmin], group: 'Surveillance Monitoring' },
  { label: 'Password Reset Link', route: '/staff/users/password-reset', roles: [R.MasterAdmin], group: 'Surveillance Monitoring' },

  // Agency
  { label: 'Monitoring', route: '/staff/monitoring', roles: [R.Agency], anySubRole: ['SiteVerification', 'DesktopVerification'], group: 'Surveillance' },
  { label: 'Surveillance Completed', route: '/staff/assessment/completed', roles: [R.Agency], anySubRole: ['SiteVerification', 'DesktopVerification'], group: 'Surveillance' },
  // 2026-11-19: every surveillance agency manages (and blocks) its assessors; before, Bronze (desktop) agencies only.
  { label: 'Assessors', route: '/staff/users/surveillance-assessors', roles: [R.Agency], anySubRole: ['SiteVerification', 'DesktopVerification'] },
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
  // 2026-11-16: the ZED team's quality observations, their dashboard and ranking; agencies reply there.
  { label: 'Quality Observations', route: '/staff/quality-observations', roles: [R.MasterAdmin, R.Agency] },
  { label: 'Operation Admins', route: '/staff/sub-users', roles: [R.MasterAdmin] },
  { label: 'Sub-Users', route: '/staff/sub-users', roles: [R.Agency] },
  // 2026-11-08: the documents and videos the Admin gives to Surveillance accounts.
  { label: 'Documents', route: '/staff/documents', roles: [R.MasterAdmin, R.Agency, R.DesktopAssessor, R.Ministry, R.SuperAdmin] },
];

/**
 * The menu's wording the Admin can change (Administration → Texts → Page wording). The code keeps the English labels
 * (grouping, icons and tracking use them); menuText() / menuGroupText() give the wording shown. A label not listed here
 * (level names) is shown as it is; the incentive groups show groupText(key).label.
 */
const MENU_TEXTS: Readonly<Record<string, () => string>> = {
  'Failed Transactions': () => t('staff.menu.item.failedTransactionsLabel', 'Failed Transactions'),
  'Registered MSMEs': () => t('staff.menu.item.registeredMsmesLabel', 'Registered MSMEs'),
  'Financial Support': () => t('staff.menu.item.financialSupportLabel', 'Financial Support'),
  'Reports': () => t('staff.menu.item.reportsLabel', 'Reports'),
  'Customer History': () => t('staff.menu.item.customerHistoryLabel', 'Customer History'),
  'Assessment Agencies': () => t('staff.menu.item.assessmentAgenciesLabel', 'Assessment Agencies'),
  'Agency Level Allocation': () => t('staff.menu.item.agencyLevelAllocationLabel', 'Agency Level Allocation'),
  'Assessors': () => t('staff.menu.item.assessorsLabel', 'Assessors'),
  'Payment Received': () => t('staff.menu.item.paymentReceivedLabel', 'Payment Received'),
  'Allot Assessment': () => t('staff.menu.item.allotAssessmentLabel', 'Allot Assessment'),
  'Assessment Monitoring': () => t('staff.menu.item.assessmentMonitoringLabel', 'Assessment Monitoring'),
  'Assessment Completed': () => t('staff.menu.item.assessmentCompletedLabel', 'Assessment Completed'),
  'Rejected Certification': () => t('staff.menu.item.rejectedCertificationLabel', 'Rejected Certification'),
  'Password Reset Link': () => t('staff.menu.item.passwordResetLinkLabel', 'Password Reset Link'),
  'NEFT Admins': () => t('staff.menu.item.neftAdminsLabel', 'NEFT Admins'),
  'ZED ID History': () => t('staff.menu.item.zedIdHistoryLabel', 'ZED ID History'),
  'Monitoring': () => t('staff.menu.item.monitoringLabel', 'Monitoring'),
  'DA Allotment': () => t('staff.menu.item.daAllotmentLabel', 'DA Allotment'),
  'SA Allotment': () => t('staff.menu.item.saAllotmentLabel', 'SA Allotment'),
  'Desktop Verification': () => t('staff.menu.item.desktopVerificationLabel', 'Desktop Verification'),
  'Non-Conformances': () => t('staff.menu.item.nonConformancesLabel', 'Non-Conformances'),
  'Remote Assessments': () => t('staff.menu.item.remoteAssessmentsLabel', 'Remote Assessments'),
  'Completed': () => t('staff.menu.item.completedLabel', 'Completed'),
  'Financial Assistance': () => t('staff.menu.item.financialAssistanceLabel', 'Financial Assistance'),
  'Incentive Submissions': () => t('staff.menu.item.incentiveSubmissionsLabel', 'Incentive Submissions'),
  'Upload API Incentives': () => t('staff.menu.item.uploadApiIncentivesLabel', 'Upload API Incentives'),
  'NEFT: New Transactions': () => t('staff.menu.item.neftNewTransactionsLabel', 'NEFT: New Transactions'),
  'NEFT: Approved Transactions': () => t('staff.menu.item.neftApprovedTransactionsLabel', 'NEFT: Approved Transactions'),
  'NEFT: Rejected Transactions': () => t('staff.menu.item.neftRejectedTransactionsLabel', 'NEFT: Rejected Transactions'),
  'All settings': () => t('staff.menu.item.allSettingsLabel', 'All settings'),
  'Upload Image': () => t('staff.menu.item.uploadImageLabel', 'Upload Image'),
  'Documents/Videos': () => t('staff.menu.item.documentsVideosLabel', 'Documents/Videos'),
  'Sectors': () => t('staff.menu.item.sectorsLabel', 'Sectors'),
  'Payments': () => t('staff.menu.item.paymentsLabel', 'Payments'),
  'Expenditure Rates': () => t('staff.menu.item.expenditureRatesLabel', 'Expenditure Rates'),
  'Subsidy Regions': () => t('staff.menu.item.subsidyRegionsLabel', 'Subsidy Regions'),
  'LG Directory': () => t('staff.menu.item.lgDirectoryLabel', 'LG Directory'),
  'ESG Checklist': () => t('staff.menu.item.esgChecklistLabel', 'ESG Checklist'),
  'Categories': () => t('staff.menu.item.categoriesLabel', 'Categories'),
  'Technologies': () => t('staff.menu.item.technologiesLabel', 'Technologies'),
  'Main Dashboard Cards': () => t('staff.menu.item.mainDashboardCardsLabel', 'Main Dashboard Cards'),
  'Incentive Schemes': () => t('staff.menu.item.incentiveSchemesLabel', 'Incentive Schemes'),
  'Scheme Applications': () => t('staff.menu.item.schemeApplicationsLabel', 'Scheme Applications'),
  'Scheme Allotment': () => t('staff.menu.item.schemeAllotmentLabel', 'Scheme Allotment'),
  'Scheme QC': () => t('staff.menu.item.schemeQcLabel', 'Scheme QC'),
  'Scheme Verification': () => t('staff.menu.item.schemeVerificationLabel', 'Scheme Verification'),
  'Incentive Verification Agencies': () => t('staff.menu.item.incentiveVerificationAgenciesLabel', 'Incentive Verification Agencies'),
  'Scheme Onsite Allotment': () => t('staff.menu.item.schemeOnsiteAllotmentLabel', 'Scheme Onsite Allotment'),
  'Scheme Onsite QC': () => t('staff.menu.item.schemeOnsiteQcLabel', 'Scheme Onsite QC'),
  'User Management': () => t('staff.menu.item.userManagementLabel', 'User Management'),
  'Captcha Settings': () => t('staff.menu.item.captchaSettingsLabel', 'Captcha Settings'),
  'Email Settings': () => t('staff.menu.item.emailSettingsLabel', 'Email Settings'),
  'Professional Verification': () => t('staff.menu.item.professionalVerificationLabel', 'Professional Verification'),
  'Payment Gateway and Invoices': () => t('staff.menu.item.paymentGatewayAndInvoicesLabel', 'Payment Gateway and Invoices'),
  'Email Templates': () => t('staff.menu.item.emailTemplatesLabel', 'Email Templates'),
  'Server Logs': () => t('staff.menu.item.serverLogsLabel', 'Server Logs'),
  'Maintenance mode': () => t('staff.menu.item.maintenanceModeLabel', 'Maintenance mode'),
  'Branding': () => t('staff.menu.item.brandingLabel', 'Branding'),
  'Texts': () => t('staff.menu.item.textsLabel', 'Texts'),
  'App Forms': () => t('staff.menu.item.appFormsLabel', 'App Forms'),
  'Site Tour Sections': () => t('staff.menu.item.siteTourSectionsLabel', 'Site Tour Sections'),
  'Submission Checklists': () => t('staff.menu.item.submissionChecklistsLabel', 'Submission Checklists'),
  'Observation Reasons': () => t('staff.menu.item.observationReasonsLabel', 'Observation Reasons'),
  'Rejection Reasons': () => t('staff.menu.item.rejectionReasonsLabel', 'Rejection Reasons'),
  'TAT (Turnaround Time)': () => t('staff.menu.item.tatTurnaroundTimeLabel', 'TAT (Turnaround Time)'),
  'API Integrations': () => t('staff.menu.item.apiIntegrationsLabel', 'API Integrations'),
  'Links': () => t('staff.menu.item.linksLabel', 'Links'),
  'Certification Levels': () => t('staff.menu.item.certificationLevelsLabel', 'Certification Levels'),
  'Expenditure': () => t('staff.menu.item.expenditureLabel', 'Expenditure'),
  'Documents': () => t('staff.menu.item.documentsLabel', 'Documents'),
  'Quality Observations': () => t('staff.menu.item.qualityObservationsLabel', 'Quality Observations'),
  'Operation Admins': () => t('staff.menu.item.operationAdminsLabel', 'Operation Admins'),
  'Sub-Users': () => t('staff.menu.item.subUsersLabel', 'Sub-Users'),
  'Registered MSME': () => t('staff.menu.item.registeredMsmeLabel', 'Registered MSME'),
  'Allot Consultancy': () => t('staff.menu.item.allotConsultancyLabel', 'Allot Consultancy'),
  'Consultant Organisations': () => t('staff.menu.item.consultantOrganisationsLabel', 'Consultant Organisations'),
  'Consultants': () => t('staff.menu.item.consultantsLabel', 'Consultants'),
  'Consultancy Completed': () => t('staff.menu.item.consultancyCompletedLabel', 'Consultancy Completed'),
  'Technology Upgradation': () => t('staff.menu.item.technologyUpgradationLabel', 'Technology Upgradation'),
  'Consultancy Monitoring': () => t('staff.menu.item.consultancyMonitoringLabel', 'Consultancy Monitoring'),
  'Consultants/Experts': () => t('staff.menu.item.consultantsExpertsLabel', 'Consultants/Experts'),
  'Milestone 1': () => t('staff.menu.item.milestone1Label', 'Milestone 1'),
  'Milestone 2': () => t('staff.menu.item.milestone2Label', 'Milestone 2'),
  'Milestone 3': () => t('staff.menu.item.milestone3Label', 'Milestone 3'),
  'New Transactions': () => t('staff.menu.item.newTransactionsLabel', 'New Transactions'),
  'Approved Transactions': () => t('staff.menu.item.approvedTransactionsLabel', 'Approved Transactions'),
  'Allot Surveillance': () => t('staff.menu.item.allotSurveillanceLabel', 'Allot Surveillance'),
  'Surveillance Payment Received': () => t('staff.menu.item.surveillancePaymentReceivedLabel', 'Surveillance Payment Received'),
  'Surveillance Monitoring': () => t('staff.menu.item.surveillanceMonitoringLabel', 'Surveillance Monitoring'),
  'Surveillance Completed': () => t('staff.menu.item.surveillanceCompletedLabel', 'Surveillance Completed'),
  'Surveillance Rejected': () => t('staff.menu.item.surveillanceRejectedLabel', 'Surveillance Rejected'),
  'Allot Surveillance (Site)': () => t('staff.menu.item.allotSurveillanceSiteLabel', 'Allot Surveillance (Site)'),
  'Surveillance Assessments': () => t('staff.menu.item.surveillanceAssessmentsLabel', 'Surveillance Assessments'),
  'Surveillance Assessments (Site)': () => t('staff.menu.item.surveillanceAssessmentsSiteLabel', 'Surveillance Assessments (Site)'),
  // The four incentive groups: the wording of the incentive pages (staff.incentives.group.*.label).
  ...Object.fromEntries(INCENTIVE_GROUPS.map((g) => [g.label, () => groupText(g.key).label])),
};

const MENU_GROUP_TEXTS: Readonly<Record<string, () => string>> = {
  'Agencies': () => t('staff.menu.group.agenciesLabel', 'Agencies'),
  'Assessment': () => t('staff.menu.group.assessmentLabel', 'Assessment'),
  'Allotment': () => t('staff.menu.group.allotmentLabel', 'Allotment'),
  'Schemes': () => t('staff.menu.group.schemesLabel', 'Schemes'),
  'Master': () => t('staff.menu.group.masterLabel', 'Master'),
  'Questionnaire': () => t('staff.menu.group.questionnaireLabel', 'Questionnaire'),
  'Technology Upgradation': () => t('staff.menu.group.technologyUpgradationLabel', 'Technology Upgradation'),
  'Incentives': () => t('staff.menu.group.incentivesLabel', 'Incentives'),
  'Administration': () => t('staff.menu.group.administrationLabel', 'Administration'),
  'Consultancy Monitoring': () => t('staff.menu.group.consultancyMonitoringLabel', 'Consultancy Monitoring'),
  'Consultancy': () => t('staff.menu.group.consultancyLabel', 'Consultancy'),
  'Surveillance Monitoring': () => t('staff.menu.group.surveillanceMonitoringLabel', 'Surveillance Monitoring'),
  'Surveillance': () => t('staff.menu.group.surveillanceLabel', 'Surveillance'),
};

/** The wording shown for a menu entry's label (the Admin's, or the label itself). */
export function menuText(label: string): string {
  return MENU_TEXTS[label]?.() ?? label;
}

/** The wording shown for a drop-down's name or a heading inside one. */
export function menuGroupText(name: string | null | undefined): string {
  return name ? (MENU_GROUP_TEXTS[name]?.() ?? name) : '';
}

export const MENUS: Record<PortalSystem, StaffMenuItem[]> = { main: MAIN_MENU, consultancy: CONSULTANCY_MENU, surveillance: SURVEILLANCE_MENU };

/** The system of this build for the staff pages that differ per portal (a token, so specs can render each variant). */
/**
 * The role as people say it (2026-11-08): Dashboard Admin (RoleId 10), NEFT Admin or MSME DFO (RoleId 6), on Consultancy the
 * Consultant Organisation (2) and Consultant/Expert (3), otherwise the role name with spaces ("MasterAdmin" -> "Master Admin").
 */
export function staffRoleName(
  user: { roleId: number; role?: string | null; isNeftAdmin?: boolean; actingUserId?: string | null } | null | undefined,
  system: PortalSystem = PORTAL_SYSTEM,
): string {
  if (!user) return '';
  // 2026-11-16: a sub-user (it signs in as its owner) is named for itself: a Master Admin's are its Operation Admins.
  if (user.actingUserId) {
    if (user.roleId === R.MasterAdmin) return t('staff.menu.role.operationAdminLabel', 'Operation Admin');
    return t('staff.menu.role.subUserLabel', '{role} Sub-User', { role: staffRoleName({ ...user, actingUserId: null }, system) });
  }
  if (user.roleId === 10) return t('staff.menu.role.dashboardAdminLabel', 'Dashboard Admin');
  if (user.roleId === 6) return user.isNeftAdmin ? t('staff.menu.role.neftAdminLabel', 'NEFT Admin') : t('staff.menu.role.msmeDfoLabel', 'MSME DFO');
  // 2026-11-15: Consultancy's agencies and assessors are its Consultant Organisations and Consultants/Experts ("Desktop Assessor, ZED Handholding").
  if (system === 'consultancy' && (user.roleId === R.Agency || user.roleId === R.DesktopAssessor))
    return user.roleId === R.Agency ? LABELS.consultancy.agency : LABELS.consultancy.assessor;
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
 * The menu with its per-level placeholders expanded: one entry per level, in the Admin's order (the old portal's
 * questionnaire address for Bronze, Silver and Gold). Reads the levels' signal, so a computed menu follows them.
 */
export function expandLevels(items: readonly StaffMenuItem[]): StaffMenuItem[] {
  return items.flatMap((i) =>
    !i.perLevel
      ? [i]
      : allLevels().map((l) => {
          const { perLevel: _, legacyPath, ...item } = i;
          return {
            ...item,
            label: i.label.replace('{level}', levelName(l.code) || l.name),
            route: i.route?.replace('{level}', l.code),
            // The old portal had the pages of Bronze, Silver and Gold only.
            ...(legacyPath && isLegacyLevel(l.code) ? { legacyPath: legacyPath.replace('{level}', l.code) } : {}),
          };
        }),
  );
}

/**
 * The entry is for this login: its roles, its sub-roles (all of `subRoles`, one of `anySubRole`) and its kinds of agency.
 * 2026-11-21 (Assessor UI audit): also what the screens' route guards check ({@link menuScreenAllows}).
 */
export function menuItemAllows(
  item: Pick<StaffMenuItem, 'roles' | 'subRoles' | 'anySubRole' | 'agencyKinds'>,
  roleId: number,
  subRoles: readonly string[],
): boolean {
  return (
    item.roles.includes(roleId) &&
    (item.agencyKinds ?? ASSESSMENT_ONLY).includes(agencyKindOf(subRoles)) &&
    (item.subRoles ?? []).every((s) => subRoles.includes(s)) &&
    (!item.anySubRole || item.anySubRole.some((s) => subRoles.includes(s)))
  );
}

/**
 * 2026-11-21 (Assessor UI audit: an assessor without the sub-role opened Financial Assistance by its address): whether a menu
 * entry of this portal for the screen's route is for this login (the same check as the menu); null when this portal's menu has
 * no entry for it (the screen is opened from links only, and its route keeps its own role check).
 */
export function menuScreenAllows(route: string, roleId: number, subRoles: readonly string[], system: PortalSystem = PORTAL_SYSTEM): boolean | null {
  const entries = expandLevels(MENUS[system]).filter((i) => i.route === route);
  return entries.length ? entries.some((i) => menuItemAllows(i, roleId, subRoles)) : null;
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
  return expandLevels(MENUS[system]).filter(
    (i) =>
      menuItemAllows(i, roleId, subRoles) &&
      (!permissionRoutes || (!!i.route && permissionRoutes.some((r) => i.route === r || i.route!.startsWith(r + '/')))) &&
      (!i.onlyWithout || (!!permissionRoutes && !permissionRoutes.includes(i.onlyWithout))),
  );
}
