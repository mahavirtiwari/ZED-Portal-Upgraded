import { Routes } from '@angular/router';
import { staffScreenGuard } from '../../assessment/assessment-shared';
import { StaffRole as R } from '../../staff-menu';

/**
 * The handholding milestone page (Consultancy build only), as children of the `staff` route. The API checks the
 * roles, the allotment (lead, co-consultants, CO) and the milestone status.
 */
export const MILESTONE_ROUTES: Routes = [
  {
    path: 'consultancy/milestones/:zedId/:certification',
    title: 'ZED | Consultancy Details',
    canActivate: [staffScreenGuard([R.MasterAdmin, R.Agency, R.DesktopAssessor, R.SuperAdmin, R.Ministry])],
    loadComponent: () => import('./milestone-details').then((m) => m.MilestoneDetailsPage),
  },
];

/** Old consultancy address /Consultancy/Assessment/SaDetails?zedId=..&Certification=.. (links in lists and mails). */
export const MILESTONE_LEGACY_REDIRECTS: Routes = [
  {
    path: 'Assessment/SaDetails',
    redirectTo: ({ queryParams }) =>
      `/staff/consultancy/milestones/${encodeURIComponent(queryParams['zedId'] ?? '')}/${encodeURIComponent(queryParams['Certification'] ?? queryParams['certification'] ?? '')}`,
  },
];
