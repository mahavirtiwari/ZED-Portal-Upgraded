import { Route, Routes, UrlMatcher } from '@angular/router';
import { authGuard } from '@zed/shared';
import { STAFF_ROLE_IDS } from './staff/staff-menu';
import { staffHomeRedirect } from './staff/staff-home.guard';
import { ASSESSMENT_LEGACY_REDIRECTS, ASSESSMENT_ROUTES } from './staff/assessment/assessment.routes';
import { VERIFY_ROUTES } from './verify/verify.routes';
import { SITE_REVIEW_LEGACY_REDIRECTS, SITE_REVIEW_ROUTES } from './staff/site-review/site-review.routes';
import { MSME_SCHEME_ROUTES, PUBLIC_INCENTIVE_ROUTES, SCHEME_LEGACY_REDIRECTS } from './msme/schemes/schemes.routes';
import { MILESTONE_LEGACY_REDIRECTS, MILESTONE_ROUTES } from './staff/consultancy/milestones/milestones.routes';
import { PORTAL_SYSTEM } from './portal-system';
import { PORTAL_LABELS } from './portal-labels';

/** MSME role id (Users.RoleId 5, "Ulb" in the legacy enum). */
const MSME = 5;

/** Staff "View Profile" of a unit (all three systems; replaces the legacy Msme/Profile/{zedId} page). */
const STAFF_MSME_PROFILE: Route = {
  path: 'msme-profile/:zedId',
  title: 'ZED | MSME Profile',
  loadComponent: () => import('./staff/msme-profile/msme-profile').then((m) => m.StaffMsmeProfilePage),
};

/** Main's staff screens (children of `staff`). */
const MAIN_STAFF_CHILDREN: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'ZED | Home',
    canActivate: [staffHomeRedirect],
    loadComponent: () => import('./staff/staff-home').then((m) => m.StaffHomePage),
  },
  { path: 'dashboard', title: 'ZED | Dashboard', loadComponent: () => import('./staff/dashboard/staff-dashboard').then((m) => m.StaffDashboardPage) },
  { path: 'registered-msme', title: 'ZED | Registered MSME', loadComponent: () => import('./staff/dashboard/registered-msme').then((m) => m.RegisteredMsmePage) },
  {
    path: 'failed-transactions',
    title: 'ZED | Failed Transactions',
    loadComponent: () => import('./staff/dashboard/failed-transactions').then((m) => m.FailedTransactionsPage),
  },
  {
    path: 'payments-received',
    title: 'ZED | Payment Received',
    loadComponent: () => import('./staff/dashboard/payments-received').then((m) => m.PaymentsReceivedPage),
  },
  {
    path: 'financial-support',
    title: 'ZED | Financial Support',
    loadComponent: () => import('./staff/dashboard/financial-support').then((m) => m.FinancialSupportPage),
  },
  { path: 'reports', title: 'ZED | Reports', loadComponent: () => import('./staff/reports/reports').then((m) => m.ReportsPage) },
  { path: 'history', title: 'ZED | Certification History', loadComponent: () => import('./staff/history/zed-history').then((m) => m.ZedHistoryPage) },
  { path: 'users', loadChildren: () => import('./staff/users/users.routes').then((m) => m.USERS_ROUTES) },
  { path: 'masters', loadChildren: () => import('./staff/masters/masters.routes').then((m) => m.MASTERS_ROUTES) },
  ...ASSESSMENT_ROUTES,
  ...SITE_REVIEW_ROUTES,
  { path: 'questionnaire', loadChildren: () => import('./staff/questionnaire/questionnaire.routes').then((m) => m.QUESTIONNAIRE_ROUTES) },
  { path: 'fees', loadChildren: () => import('./staff/fees/fees.routes').then((m) => m.FEES_ROUTES) },
  { path: 'settings', loadChildren: () => import('./staff/settings/settings.routes').then((m) => m.SETTINGS_ROUTES) },
  { path: 'user-management', loadChildren: () => import('./staff/user-management/user-management.routes').then((m) => m.USER_MANAGEMENT_ROUTES) },
  { path: 'sub-users', loadChildren: () => import('./staff/user-management/user-management.routes').then((m) => m.SUB_USERS_ROUTES) },
  { path: 'remote', loadChildren: () => import('./staff/remote/remote.routes').then((m) => m.REMOTE_ROUTES) },
  {
    path: 'neft/new',
    title: 'ZED | NEFT New Transactions',
    data: { list: 'new' },
    loadComponent: () => import('./staff/neft/neft-transactions').then((m) => m.NeftTransactionsPage),
  },
  {
    path: 'neft/approved',
    title: 'ZED | NEFT Approved Transactions',
    data: { list: 'approved' },
    loadComponent: () => import('./staff/neft/neft-transactions').then((m) => m.NeftTransactionsPage),
  },
  {
    path: 'neft/rejected',
    title: 'ZED | NEFT Rejected Transactions',
    data: { list: 'rejected' },
    loadComponent: () => import('./staff/neft/neft-transactions').then((m) => m.NeftTransactionsPage),
  },
  {
    path: 'financial-assistance',
    title: 'ZED | Financial Assistance',
    loadComponent: () => import('./staff/schemes/fa-submissions').then((m) => m.FaSubmissionsPage),
  },
  {
    path: 'financial-assistance/:zedId',
    title: 'ZED | Financial Assistance',
    loadComponent: () => import('./staff/schemes/fa-verification').then((m) => m.FaVerificationPage),
  },
  {
    path: 'incentives/submissions',
    title: 'ZED | Incentive Submissions',
    loadComponent: () => import('./staff/schemes/incentive-submissions').then((m) => m.IncentiveSubmissionsPage),
  },
  {
    path: 'incentives/upload',
    title: 'ZED | Upload API Incentives',
    loadComponent: () => import('./staff/schemes/incentive-upload').then((m) => m.IncentiveUploadPage),
  },
  { path: 'incentives', title: 'ZED | Incentives', loadComponent: () => import('./staff/schemes/incentive-master').then((m) => m.IncentiveMasterPage) },
  {
    path: 'change-password',
    title: 'ZED | Change Password',
    data: { loginUrl: '/login' },
    loadComponent: () => import('./msme/change-password/change-password').then((m) => m.ChangePasswordPage),
  },
  { path: 'monitoring', title: 'ZED | Assessment Monitoring', loadComponent: () => import('./staff/monitoring/monitoring').then((m) => m.MonitoringPage) },
  { path: 'sa-allotment', title: 'ZED | SA Allotment', loadComponent: () => import('./staff/site-assessment/sa-allotment').then((m) => m.SaAllotmentPage) },
  {
    path: 'remote-assessments',
    title: 'ZED | Remote Assessments',
    loadComponent: () => import('./staff/site-assessment/remote-assessments').then((m) => m.RemoteAssessmentsPage),
  },
  STAFF_MSME_PROFILE,
];

/** Main (ZEDCS) routes: the MSME portal, the staff screens and the old MVC addresses. */
const MAIN_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'msme/login' },

  // Public MSME pages
  { path: 'msme/login', title: 'ZED | Login', loadComponent: () => import('./msme/login/login').then((m) => m.LoginPage) },
  { path: 'msme/register', title: 'ZED | Registration', loadComponent: () => import('./msme/register/register').then((m) => m.RegisterPage) },
  { path: 'contact', title: 'ZED | Contact', loadComponent: () => import('./msme/public-layout/public-layout').then((m) => m.PublicContactPage) },
  {
    path: 'msme/reset-password',
    title: 'ZED | Change Password',
    loadComponent: () => import('./msme/reset-password/reset-password').then((m) => m.ResetPasswordPage),
  },

  // Udyami Bharat portal hand-over (old MVC address, query applicationNo & token).
  {
    path: 'Msme/ZedDashboard',
    title: 'ZED | Udyami Bharat',
    loadComponent: () => import('./msme/udyami-signin/udyami-signin').then((m) => m.UdyamiSignInPage),
  },
  ...PUBLIC_INCENTIVE_ROUTES,
  { path: 'privacy-policy', title: 'ZED | Privacy Policy', loadComponent: () => import('./public/privacy-policy').then((m) => m.PrivacyPolicyPage) },

  // Signed-in MSME area
  {
    path: 'msme',
    canActivate: [authGuard('/msme/login', [MSME])],
    loadComponent: () => import('./msme/layout/msme-layout').then((m) => m.MsmeLayout),
    children: [
      { path: 'dashboard', title: 'ZED | Dashboard', loadComponent: () => import('./msme/dashboard/dashboard').then((m) => m.DashboardPage) },
      { path: 'profile', title: 'ZED | Profile', loadComponent: () => import('./msme/profile/profile').then((m) => m.ProfilePage) },
      { path: 'edit-history', title: 'ZED | Edit History', loadComponent: () => import('./msme/edit-history/edit-history').then((m) => m.EditHistoryPage) },
      { path: 'documents', title: 'ZED | My Documents', loadComponent: () => import('./msme/documents/documents').then((m) => m.DocumentsPage) },
      {
        path: 'certification/:certification',
        title: 'ZED | Certification',
        loadComponent: () => import('./msme/certification/certification-details').then((m) => m.CertificationDetailsPage),
      },
      {
        path: 'status/:certification',
        title: 'ZED | Status',
        loadComponent: () => import('./msme/certification/view-status').then((m) => m.ViewStatusPage),
      },
      {
        path: 'change-password',
        title: 'ZED | Change Password',
        loadComponent: () => import('./msme/change-password/change-password').then((m) => m.ChangePasswordPage),
      },
      {
        path: 'surveillance-payment/:certification',
        title: 'ZED | Surveillance Payment',
        loadComponent: () => import('./msme/payment/surveillance-payment').then((m) => m.SurveillancePaymentPage),
      },
      {
        path: 'payment/result',
        title: 'ZED | Payment',
        loadComponent: () => import('./msme/payment/payment-result').then((m) => m.PaymentResultPage),
      },
      {
        path: 'assessment/basic-info/:certification',
        title: 'ZED | Basic Information',
        loadComponent: () => import('./msme/assessment/assessment-report').then((m) => m.BasicInfoPage),
      },
      {
        path: 'assessment/non-conformances/:certification',
        title: 'ZED | Non-Conformances',
        loadComponent: () => import('./msme/assessment/assessment-report').then((m) => m.NonConformancesPage),
      },
      {
        path: 'site-assessment/:certification',
        title: 'ZED | Site Assessment',
        loadComponent: () => import('./msme/site-assessment/site-assessment').then((m) => m.SiteAssessmentPage),
      },
      { path: 'handholding', title: 'ZED | Handholding Support', loadComponent: () => import('./msme/handholding/handholding').then((m) => m.HandholdingPage) },
      {
        path: 'handholding/:certification/payment',
        title: 'ZED | Handholding Payment',
        loadComponent: () => import('./msme/payment/consultancy-payment').then((m) => m.ConsultancyPaymentPage),
      },
      {
        path: 'payment/consultancy-result',
        title: 'ZED | Payment',
        loadComponent: () => import('./msme/payment/consultancy-result').then((m) => m.ConsultancyResultPage),
      },
      ...MSME_SCHEME_ROUTES,
      { path: 'contact', title: 'ZED | Contact', loadComponent: () => import('./msme/contact/contact').then((m) => m.ContactPage) },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },

  // Staff, agencies and assessors
  { path: 'login', title: 'ZED | User Login', loadComponent: () => import('./staff/staff-login').then((m) => m.StaffLoginPage) },
  { path: 'forgot-password', title: 'ZED | Forgot Password', loadComponent: () => import('./staff/password-reset/staff-forgot-password').then((m) => m.StaffForgotPasswordPage) },
  { path: 'reset-password', title: 'ZED | Set a New Password', loadComponent: () => import('./staff/password-reset/staff-reset-password').then((m) => m.StaffResetPasswordPage) },
  {
    path: 'staff',
    canActivate: [authGuard('/login', STAFF_ROLE_IDS)],
    loadComponent: () => import('./staff/staff-layout').then((m) => m.StaffLayout),
    children: MAIN_STAFF_CHILDREN,
  },

  // Old MVC addresses that appear in e-mails already sent and in bookmarks.
  { path: 'Home', pathMatch: 'full', redirectTo: '' },
  { path: 'Home/Index', redirectTo: '' },
  { path: 'Home/PrivacyPolicy', redirectTo: 'privacy-policy' },
  // The old Home/Contact was public: the public page (signed-in MSMEs also have msme/contact in their menu).
  { path: 'Home/Contact', redirectTo: 'contact' },
  { path: 'User/Login', redirectTo: 'login' },
  { path: 'Monitoring/Index', redirectTo: 'staff/monitoring' },
  { path: 'Dashboard', pathMatch: 'full', redirectTo: 'staff/dashboard' },
  { path: 'Dashboard/Index', redirectTo: 'staff/dashboard' },
  { path: 'Dashboard/RegisteredMsme', redirectTo: 'staff/registered-msme' },
  { path: 'Dashboard/FailedTransactions', redirectTo: 'staff/failed-transactions' },
  { path: 'Dashboard/PaymentReceived', redirectTo: 'staff/payments-received' },
  { path: 'Dashboard/FinancialSupport', redirectTo: 'staff/financial-support' },
  { path: 'DynamicReports', pathMatch: 'full', redirectTo: 'staff/reports' },
  { path: 'DynamicReports/Index', redirectTo: 'staff/reports' },
  { path: 'Msme/History', redirectTo: 'staff/history' },
  { path: 'User/AssessmentAgencies', redirectTo: 'staff/users/agencies' },
  { path: 'User/BronzeAssessmentAgencies', redirectTo: 'staff/users/bronze-agencies' },
  { path: 'User/CertificationBodies', redirectTo: 'staff/users/agencies' },
  { path: 'User/AssessorList', redirectTo: 'staff/users/assessors' },
  { path: 'User/Assessors', redirectTo: 'staff/users/my-assessors' },
  { path: 'User/Assessor', redirectTo: 'staff/users/my-assessors' },
  { path: 'Home/PageSettings', redirectTo: 'staff/masters/page-settings' },
  { path: 'MyDocuments/Index', redirectTo: 'staff/masters/documents' },
  { path: 'Sector/List', redirectTo: 'staff/masters/sectors' },
  { path: 'Category/List', redirectTo: 'staff/masters/categories' },
  { path: 'Category/list', redirectTo: 'staff/masters/categories' },
  { path: 'Technology/List', redirectTo: 'staff/masters/technologies' },
  { path: 'Technology/list', redirectTo: 'staff/masters/technologies' },
  { path: 'Technology/Create', redirectTo: 'staff/masters/technologies/new' },
  {
    path: 'Questionaire/Index',
    redirectTo: ({ queryParams }) => `/staff/masters/parameters/${encodeURIComponent(queryParams['SectionType'] ?? 'Bronze')}`,
  },
  { path: 'Assessment/SaAllotment', redirectTo: 'staff/sa-allotment' },
  { path: 'Assessment/RemoteAssessments', redirectTo: 'staff/remote-assessments' },
  { path: 'Msme/Login', redirectTo: 'msme/login' },
  { path: 'Msme/Register', redirectTo: 'msme/register' },
  { path: 'Msme/Dashboard', redirectTo: 'msme/dashboard' },
  { path: 'Msme/MyDocuments', redirectTo: 'msme/documents' },
  { path: 'Msme/ViewProfile', redirectTo: 'msme/profile' },
  { path: 'Msme/CertificationDetails/:certification', redirectTo: 'msme/certification/:certification' },
  { path: 'Msme/BasicInfo/:certification', redirectTo: 'msme/assessment/basic-info/:certification' },
  { path: 'Msme/NonConformances/:certification', redirectTo: 'msme/assessment/non-conformances/:certification' },
  { path: 'Msme/NonConformancesSa/:certification', redirectTo: 'msme/assessment/non-conformances/:certification' },
  { path: 'Msme/HandholdingSupport', redirectTo: 'msme/handholding' },
  { path: 'Msme/SiteAssessmentInfo/:certification', redirectTo: 'msme/site-assessment/:certification' },
  { path: 'Msme/ViewStatus', redirectTo: ({ queryParams }) => `/msme/status/${encodeURIComponent(queryParams['certification'] ?? '')}` },
  { path: 'SurveillancePay/Index/:certification', redirectTo: 'msme/surveillance-payment/:certification' },
  // Links of the legacy reset (?code=…) no longer work: the page explains and offers a new link; the code is dropped.
  { path: 'Msme/ChangePassword', redirectTo: '/msme/reset-password' },

  { path: 'Neft/Index', redirectTo: 'staff/neft/new' },
  { path: 'Neft/NewTransactions', redirectTo: 'staff/neft/new' },
  { path: 'Neft/ApprovedTransactions', redirectTo: 'staff/neft/approved' },
  { path: 'Neft/RejectedTransactions', redirectTo: 'staff/neft/rejected' },
  { path: 'FinancialAssistance/Submissions', redirectTo: 'staff/financial-assistance' },
  {
    path: 'FinancialAssistance/Verification',
    redirectTo: ({ queryParams }) =>
      `/staff/financial-assistance/${encodeURIComponent(queryParams['zedId'] ?? '')}?certification=${encodeURIComponent(queryParams['Certification'] ?? '')}`,
  },
  { path: 'Incentive/Submissions', redirectTo: 'staff/incentives/submissions' },
  { path: 'Incentive/UploadIncentives', redirectTo: 'staff/incentives/upload' },
  { path: 'Incentive/Index', redirectTo: ({ queryParams }) => `/staff/incentives?type=${encodeURIComponent(queryParams['incentiveType'] ?? 'Common')}` },
  ...ASSESSMENT_LEGACY_REDIRECTS,
  ...SITE_REVIEW_LEGACY_REDIRECTS,
  ...SCHEME_LEGACY_REDIRECTS,
  {
    path: 'Questionaire/Requirements',
    redirectTo: ({ queryParams }) =>
      `/staff/questionnaire/${encodeURIComponent(queryParams['sectionType'] ?? 'Bronze')}/${encodeURIComponent(queryParams['sid'] ?? '')}`,
  },
  { path: 'Assessment/PaymentDetails', redirectTo: 'staff/fees' },
  {
    path: 'Remote/Index',
    redirectTo: ({ queryParams }) =>
      `/staff/remote/${encodeURIComponent(queryParams['zedId'] ?? '')}/${encodeURIComponent(queryParams['Certification'] ?? '')}`,
  },

  { path: 'Msme/Profile/:zedId', redirectTo: 'staff/msme-profile/:zedId' },

  // Public certificate verification (QR codes) and old report links from e-mails.
  ...VERIFY_ROUTES,

  { path: '**', redirectTo: 'msme/login' },
];

// ============================================================================================================
// Consultancy and Surveillance builds (PORTAL_SYSTEM). Staff-only portals: the root opens the staff login, no MSME
// pages are routed, and the old addresses under /Consultancy/... and /surveillance/... (the build's baseHref) redirect.
// ============================================================================================================

/** Screens of main reused unchanged (or with per-system switches inside) by both systems. */
const SYSTEM_COMMON_STAFF_CHILDREN: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'ZED | Home',
    canActivate: [staffHomeRedirect],
    loadComponent: () => import('./staff/staff-home').then((m) => m.StaffHomePage),
  },
  { path: 'dashboard', title: 'ZED | Dashboard', loadComponent: () => import('./staff/dashboard/staff-dashboard').then((m) => m.StaffDashboardPage) },
  { path: 'registered-msme', title: 'ZED | Registered MSME', loadComponent: () => import('./staff/dashboard/registered-msme').then((m) => m.RegisteredMsmePage) },
  {
    path: 'failed-transactions',
    title: 'ZED | Failed Transactions',
    loadComponent: () => import('./staff/dashboard/failed-transactions').then((m) => m.FailedTransactionsPage),
  },
  {
    path: 'payments-received',
    title: 'ZED | Payment Received',
    loadComponent: () => import('./staff/dashboard/payments-received').then((m) => m.PaymentsReceivedPage),
  },
  { path: 'reports', title: 'ZED | Reports', loadComponent: () => import('./staff/reports/reports').then((m) => m.ReportsPage) },
  { path: 'history', title: 'ZED | Customer History', loadComponent: () => import('./staff/history/zed-history').then((m) => m.ZedHistoryPage) },
  { path: 'users', loadChildren: () => import('./staff/users/users.routes').then((m) => m.USERS_ROUTES) },
  { path: 'fees', loadChildren: () => import('./staff/fees/fees.routes').then((m) => m.FEES_ROUTES) },
  { path: 'settings', loadChildren: () => import('./staff/settings/settings.routes').then((m) => m.SETTINGS_ROUTES) },
  { path: 'user-management', loadChildren: () => import('./staff/user-management/user-management.routes').then((m) => m.USER_MANAGEMENT_ROUTES) },
  { path: 'sub-users', loadChildren: () => import('./staff/user-management/user-management.routes').then((m) => m.SUB_USERS_ROUTES) },
  {
    path: 'change-password',
    title: 'ZED | Change Password',
    data: { loginUrl: '/login' },
    loadComponent: () => import('./msme/change-password/change-password').then((m) => m.ChangePasswordPage),
  },
  { path: 'monitoring', title: 'ZED | Monitoring', loadComponent: () => import('./staff/monitoring/monitoring').then((m) => m.MonitoringPage) },
  ...ASSESSMENT_ROUTES,
  ...SITE_REVIEW_ROUTES,
  STAFF_MSME_PROFILE,
];

/** Consultancy (handholding) staff screens. */
const CONSULTANCY_STAFF_CHILDREN: Routes = [
  ...SYSTEM_COMMON_STAFF_CHILDREN,
  { path: 'masters', loadChildren: () => import('./staff/masters/masters.routes').then((m) => m.MASTERS_ROUTES) },
  { path: 'questionnaire', loadChildren: () => import('./staff/questionnaire/questionnaire.routes').then((m) => m.QUESTIONNAIRE_ROUTES) },
  {
    path: 'neft/new',
    title: 'ZED | NEFT New Transactions',
    data: { list: 'new' },
    loadComponent: () => import('./staff/neft/neft-transactions').then((m) => m.NeftTransactionsPage),
  },
  {
    path: 'neft/approved',
    title: 'ZED | NEFT Approved Transactions',
    data: { list: 'approved' },
    loadComponent: () => import('./staff/neft/neft-transactions').then((m) => m.NeftTransactionsPage),
  },
  // CO allotment and the consultants' Milestone 1-3 lists (site-assessment package; pages in staff/site-assessment).
  {
    path: 'site-assessment/co-allotment',
    title: 'ZED | Allot Consultancy',
    loadComponent: () => import('./staff/site-assessment/co-allotment').then((m) => m.CoAllotmentPage),
  },
  {
    path: 'site-assessment/milestones/:milestone',
    title: 'ZED | Milestone',
    loadComponent: () => import('./staff/site-assessment/remote-assessments').then((m) => m.RemoteAssessmentsPage),
  },
  // Milestone review page and Technology Upgradation (consultancy packages).
  ...MILESTONE_ROUTES,
  { path: 'consultancy/technology', loadChildren: () => import('./staff/consultancy/technology/technology.routes').then((m) => m.TECHNOLOGY_ROUTES) },
  // >>> Further Consultancy staff routes of other packages go here.
];

/** Surveillance staff screens. */
const SURVEILLANCE_STAFF_CHILDREN: Routes = [
  ...SYSTEM_COMMON_STAFF_CHILDREN,
  {
    path: 'financial-support',
    title: 'ZED | Financial Support',
    loadComponent: () => import('./staff/dashboard/financial-support').then((m) => m.FinancialSupportPage),
  },
  { path: 'sa-allotment', title: 'ZED | Allot Surveillance', loadComponent: () => import('./staff/site-assessment/sa-allotment').then((m) => m.SaAllotmentPage) },
  {
    path: 'remote-assessments',
    title: 'ZED | Surveillance Assessments',
    loadComponent: () => import('./staff/site-assessment/remote-assessments').then((m) => m.RemoteAssessmentsPage),
  },
  { path: 'remote', loadChildren: () => import('./staff/remote/remote.routes').then((m) => m.REMOTE_ROUTES) },
  // >>> Further Surveillance staff routes of other packages go here.
];

/** Old MVC paths (lower-case) of the staff screens of these portals, and their new address. */
const SYSTEM_LEGACY_PATHS: Record<string, string> = {
  '': '/login',
  home: '/login',
  'home/index': '/login',
  'user/login': '/login',
  'user/logout': '/login',
  'user/index': '/login',
  'user/changepassword': '/staff/change-password',
  dashboard: '/staff/dashboard',
  'dashboard/index': '/staff/dashboard',
  'dashboard/registeredmsme': '/staff/registered-msme',
  'dashboard/failedtransactions': '/staff/failed-transactions',
  'dashboard/paymentreceived': '/staff/payments-received',
  'dashboard/financialsupport': '/staff/financial-support',
  dynamicreports: '/staff/reports',
  'dynamicreports/index': '/staff/reports',
  'monitoring/index': '/staff/monitoring',
  'assessment/allot': '/staff/assessment/allot',
  'assessment/completed': '/staff/assessment/completed',
  'assessment/rejected': '/staff/assessment/rejected',
  'assessment/daallotment': '/staff/assessment/da-allotment',
  'assessment/daverification': '/staff/assessment/da-verification',
  'assessment/nonconfirmances': '/staff/assessment/non-conformances',
  'assessment/paymentdetails': '/staff/fees',
  'user/assessors': '/staff/users/my-assessors',
  'neft/index': '/staff/neft/new',
  'neft/newtransactions': '/staff/neft/new',
  'neft/approvedtransactions': '/staff/neft/approved',
  'home/pagesettings': '/staff/masters/page-settings',
  'mydocuments/index': '/staff/masters/documents',
  'sector/list': '/staff/masters/sectors',
  ...(PORTAL_SYSTEM === 'consultancy'
    ? {
        'user/assessmentagencies': '/staff/users/agencies',
        'user/certificationbodies': '/staff/users/agencies',
        'user/assessorlist': '/staff/users/assessors',
        'user/assessor': '/staff/users/my-assessors',
        'assessment/saallotment': '/staff/site-assessment/co-allotment',
        'assessment/remoteassessments': '/staff/site-assessment/milestones/1',
        'assessment/remoteassessments/1': '/staff/site-assessment/milestones/1',
        'assessment/remoteassessments/2': '/staff/site-assessment/milestones/2',
        'assessment/remoteassessments/3': '/staff/site-assessment/milestones/3',
        'financialassistance/submissions': '/staff/consultancy/technology',
      }
    : {
        'user/assessmentagencies': '/staff/users/surveillance-agencies',
        'user/certificationbodies': '/staff/users/surveillance-agencies',
        'user/assessorlist': '/staff/users/surveillance-assessors',
        'user/assessor': '/staff/users/surveillance-assessors',
        'assessment/saallotment': '/staff/sa-allotment',
        'assessment/remoteassessments': '/staff/remote-assessments',
      }),
};

/** The system's own folder name as the first segment (/consultancy/... when the browser's case differs from baseHref). */
const SYSTEM_FOLDER = PORTAL_SYSTEM === 'consultancy' ? 'consultancy' : 'surveillance';

/**
 * Matches an old address case-insensitively (IIS was case-insensitive): optionally prefixed by the system folder,
 * then one of SYSTEM_LEGACY_PATHS, or Msme/Profile/{zedId}.
 */
export function systemLegacyTarget(segments: string[]): string | null {
  const parts = segments[0]?.toLowerCase() === SYSTEM_FOLDER ? segments.slice(1) : segments;
  const key = parts.join('/').toLowerCase();
  if (key in SYSTEM_LEGACY_PATHS) return SYSTEM_LEGACY_PATHS[key];
  if (parts.length === 3 && parts[0].toLowerCase() === 'msme' && parts[1].toLowerCase() === 'profile') return `/staff/msme-profile/${encodeURIComponent(parts[2])}`;
  return null;
}

const legacyMatcher: UrlMatcher = (segments) =>
  segments.length > 0 && systemLegacyTarget(segments.map((s) => s.path)) !== null ? { consumed: segments } : null;

/** Surveillance: old addresses with query parameters (site review and the remote assessment page). */
const SURVEILLANCE_LEGACY_REDIRECTS: Routes = [
  ...SITE_REVIEW_LEGACY_REDIRECTS,
  {
    path: 'Remote/Index',
    redirectTo: ({ queryParams }) =>
      `/staff/remote/${encodeURIComponent(queryParams['zedId'] ?? '')}/${encodeURIComponent(queryParams['Certification'] ?? '')}`,
  },
];

const SYSTEM_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: 'login', title: PORTAL_LABELS.loginTitle, loadComponent: () => import('./staff/staff-login').then((m) => m.StaffLoginPage) },
  { path: 'forgot-password', title: 'ZED | Forgot Password', loadComponent: () => import('./staff/password-reset/staff-forgot-password').then((m) => m.StaffForgotPasswordPage) },
  { path: 'reset-password', title: 'ZED | Set a New Password', loadComponent: () => import('./staff/password-reset/staff-reset-password').then((m) => m.StaffResetPasswordPage) },
  {
    path: 'staff',
    canActivate: [authGuard('/login', STAFF_ROLE_IDS)],
    loadComponent: () => import('./staff/staff-layout').then((m) => m.StaffLayout),
    children: PORTAL_SYSTEM === 'consultancy' ? CONSULTANCY_STAFF_CHILDREN : SURVEILLANCE_STAFF_CHILDREN,
  },
  // Old addresses with query parameters (links in mails and lists).
  ...ASSESSMENT_LEGACY_REDIRECTS.filter((r) => r.path === 'Assessment/DaDetails'),
  ...(PORTAL_SYSTEM === 'consultancy' ? MILESTONE_LEGACY_REDIRECTS : SURVEILLANCE_LEGACY_REDIRECTS),
  { matcher: legacyMatcher, redirectTo: ({ url }) => systemLegacyTarget(url.map((s) => s.path)) ?? '/login' },
  { path: '**', redirectTo: 'login' },
];

/** The routes of this build (see portal-system.ts). */
export const routes: Routes = PORTAL_SYSTEM === 'main' ? MAIN_ROUTES : SYSTEM_ROUTES;
