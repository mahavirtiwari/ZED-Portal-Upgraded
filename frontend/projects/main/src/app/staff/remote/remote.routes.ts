import { Routes } from '@angular/router';
import { StaffRole } from '../staff-menu';
import { staffScreenGuard } from '../assessment/assessment-shared';

/**
 * Remote (video) assessment screen (children of `staff`, mounted at `staff/remote`), opened from the
 * ASSESS link of the Remote/Onsite Assessment list. Desktop assessors with the site verification
 * sub-role, as the list; the API checks the allotment again.
 */
export const REMOTE_ROUTES: Routes = [
  {
    path: ':zedId/:certification',
    title: 'ZED | Remote Assessment',
    canActivate: [staffScreenGuard([StaffRole.DesktopAssessor], ['SiteVerification'])],
    loadComponent: () => import('./remote-assessment').then((m) => m.RemoteAssessmentPage),
  },
];
