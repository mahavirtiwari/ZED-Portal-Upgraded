import { Routes } from '@angular/router';
import { StaffRole as R } from '../staff-menu';
import { staffScreenGuard } from './assessment-shared';

/**
 * Desktop-assessment screens, as children of the `staff` route (paths below `/staff/assessment/...`).
 * Each screen is limited to the roles (and sub-roles) of its menu entry; the API checks the same.
 */
export const ASSESSMENT_ROUTES: Routes = [
  {
    path: 'assessment/allot',
    title: 'ZED | Allot Assessment',
    canActivate: [staffScreenGuard([R.MasterAdmin])],
    loadComponent: () => import('./allot').then((m) => m.AllotPage),
  },
  {
    path: 'assessment/da-allotment',
    title: 'ZED | DA Allotment',
    canActivate: [staffScreenGuard([R.Agency], ['DesktopVerification'])],
    loadComponent: () => import('./da-allotment').then((m) => m.DaAllotmentPage),
  },
  {
    path: 'assessment/da-verification',
    title: 'ZED | Desktop Verification',
    canActivate: [staffScreenGuard([R.DesktopAssessor], ['DesktopVerification'])],
    loadComponent: () => import('./da-verification').then((m) => m.DaVerificationPage),
  },
  {
    path: 'assessment/non-conformances',
    title: 'ZED | Non-Conformances',
    canActivate: [staffScreenGuard([R.DesktopAssessor])],
    loadComponent: () => import('./non-conformances').then((m) => m.NonConformancesPage),
  },
  {
    path: 'assessment/completed',
    title: 'ZED | Completed Assessment',
    data: { kind: 'completed' },
    canActivate: [staffScreenGuard([R.MasterAdmin, R.Agency, R.DesktopAssessor])],
    loadComponent: () => import('./assessment-results').then((m) => m.AssessmentResultsPage),
  },
  {
    path: 'assessment/rejected',
    title: 'ZED | Rejected Certification',
    data: { kind: 'rejected' },
    canActivate: [staffScreenGuard([R.MasterAdmin, R.Agency, R.DesktopAssessor])],
    loadComponent: () => import('./assessment-results').then((m) => m.AssessmentResultsPage),
  },
  {
    path: 'assessment/da-details/:zedId/:certification',
    title: 'ZED | Assessment Details',
    canActivate: [staffScreenGuard([R.MasterAdmin, R.Agency, R.DesktopAssessor, R.SuperAdmin, R.Ministry, R.CitizenFeedback, R.QC])],
    loadComponent: () => import('./da-details').then((m) => m.DaDetailsPage),
  },
];

/**
 * Old MVC addresses of these screens (bookmarks, e-mails), as top-level redirects for app.routes.ts.
 * Assessment/DaDetails took ?zedId=...&Certification=... query parameters.
 */
export const ASSESSMENT_LEGACY_REDIRECTS: Routes = [
  { path: 'Assessment/Allot', redirectTo: 'staff/assessment/allot' },
  { path: 'Assessment/DaAllotment', redirectTo: 'staff/assessment/da-allotment' },
  { path: 'Assessment/DaVerification', redirectTo: 'staff/assessment/da-verification' },
  { path: 'Assessment/NonConfirmances', redirectTo: 'staff/assessment/non-conformances' },
  { path: 'Assessment/Completed', redirectTo: 'staff/assessment/completed' },
  { path: 'Assessment/Rejected', redirectTo: 'staff/assessment/rejected' },
  {
    path: 'Assessment/DaDetails',
    redirectTo: ({ queryParams }) =>
      `/staff/assessment/da-details/${encodeURIComponent(queryParams['zedId'] ?? '')}/${encodeURIComponent(queryParams['Certification'] ?? queryParams['certification'] ?? '')}`,
  },
];
