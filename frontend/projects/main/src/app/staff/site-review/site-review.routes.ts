import { Routes } from '@angular/router';
import { staffScreenGuard } from '../assessment/assessment-shared';
import { StaffRole as R } from '../staff-menu';

/**
 * Site-assessment review screens, as children of the `staff` route (spread next to ASSESSMENT_ROUTES).
 * The API checks the same roles, the allotment and the record state.
 */
export const SITE_REVIEW_ROUTES: Routes = [
  {
    path: 'assessment/sa-details/:zedId/:certification',
    title: 'ZED | Assessment Details',
    canActivate: [staffScreenGuard([R.MasterAdmin, R.Agency, R.DesktopAssessor, R.SuperAdmin, R.Ministry, R.CitizenFeedback, R.QC])],
    loadComponent: () => import('./sa-details').then((m) => m.SaDetailsPage),
  },
  {
    path: 'assessment/site-verification',
    title: 'ZED | SA Verification',
    canActivate: [staffScreenGuard([R.DesktopAssessor])],
    loadComponent: () => import('./site-verification').then((m) => m.SiteVerificationPage),
  },
];

/** Old MVC addresses (bookmarks, links in e-mails), as top-level redirects for app.routes.ts. */
export const SITE_REVIEW_LEGACY_REDIRECTS: Routes = [
  {
    path: 'Assessment/SaDetails',
    redirectTo: ({ queryParams }) =>
      `/staff/assessment/sa-details/${encodeURIComponent(queryParams['zedId'] ?? '')}/${encodeURIComponent(queryParams['Certification'] ?? queryParams['certification'] ?? '')}`,
  },
  { path: 'Assessment/SiteVerification', redirectTo: 'staff/assessment/site-verification' },
];
