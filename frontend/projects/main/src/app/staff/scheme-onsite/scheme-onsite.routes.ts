import { Routes } from '@angular/router';
import { authGuard } from '@zed/shared';
import { StaffRole } from '../staff-menu';

const masterAdmin = authGuard('/staff', [StaffRole.MasterAdmin]);
const agency = authGuard('/staff', [StaffRole.Agency]);

const list = () => import('../scheme-verification/scheme-list').then((m) => m.SchemeListPage);
const detail = () => import('../scheme-verification/scheme-detail').then((m) => m.SchemeDetailPage);

/**
 * 2026-11-20 (incentive schemes, phase 2: onsite verification), children of `staff` at `staff/scheme-onsite`: the Master Admin's
 * Onsite Verification Agencies, and the onsite verification agency's onsite allotment and onsite QC (the scheme verification list
 * and detail pages in their onsite modes). The API checks the role and the agency kind again.
 */
export const SCHEME_ONSITE_ROUTES: Routes = [
  {
    path: 'agencies',
    canActivate: [masterAdmin],
    children: [
      { path: '', title: 'ZED | Onsite Verification Agencies', loadComponent: () => import('./onsite-agencies').then((m) => m.OnsiteAgenciesPage) },
      { path: 'new', title: 'ZED | Add Onsite Agency', loadComponent: () => import('./onsite-agency-form').then((m) => m.OnsiteAgencyFormPage) },
      { path: ':userId', title: 'ZED | Edit Onsite Agency', loadComponent: () => import('./onsite-agency-form').then((m) => m.OnsiteAgencyFormPage) },
    ],
  },
  {
    path: 'allotment',
    canActivate: [agency],
    children: [
      { path: '', title: 'ZED | Scheme Onsite Allotment', data: { mode: 'onsiteAllotment' }, loadComponent: list },
      { path: ':id', title: 'ZED | Scheme Application', data: { mode: 'onsiteAllotment' }, loadComponent: detail },
    ],
  },
  {
    path: 'qc',
    canActivate: [agency],
    children: [
      { path: '', title: 'ZED | Scheme Onsite QC', data: { mode: 'onsiteQc' }, loadComponent: list },
      { path: ':id', title: 'ZED | Scheme Application', data: { mode: 'onsiteQc' }, loadComponent: detail },
    ],
  },
];
