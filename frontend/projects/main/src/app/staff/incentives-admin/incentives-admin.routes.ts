import { Routes } from '@angular/router';
import { authGuard } from '@zed/shared';
import { StaffRole } from '../staff-menu';

const admin = authGuard('/staff', [StaffRole.Admin]);

/**
 * Admin → Incentives → Incentive Schemes (2026-11-20, approved design). Children of `staff`, mounted at
 * `staff/incentives/schemes` (before `incentives/:group`). The API checks the role and the main portal again.
 */
export const INCENTIVES_ADMIN_ROUTES: Routes = [
  { path: '', title: 'ZED | Incentive Schemes', canActivate: [admin], loadComponent: () => import('./schemes-list').then((m) => m.SchemesListPage) },
  { path: ':code', title: 'ZED | Incentive Scheme', canActivate: [admin], loadComponent: () => import('./scheme-editor').then((m) => m.SchemeEditorPage) },
];
