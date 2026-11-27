import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';

/**
 * 2026-11-20 (incentive schemes): the applicant's scheme pages. Mounted by the integrator as `incentive-schemes` among the
 * children of the signed-in `msme` route (the MSME layout): /msme/incentive-schemes/{code}.
 */
export const INCENTIVE_SCHEME_ROUTES: Routes = [
  // 2026-11-27 (UI review: /msme/incentive-schemes was a blank page): the schemes are listed on the dashboard.
  { path: '', pathMatch: 'full', redirectTo: () => inject(Router).createUrlTree(['/msme/dashboard'], { fragment: 'incentives' }) },
  {
    path: ':code',
    title: 'ZED | Incentive Scheme',
    loadComponent: () => import('./incentive-scheme').then((m) => m.IncentiveSchemePage),
  },
];
