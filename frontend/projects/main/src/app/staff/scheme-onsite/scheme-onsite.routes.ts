import { Routes } from '@angular/router';
import { authGuard } from '@zed/shared';
import { StaffRole } from '../staff-menu';
import { staffMenuGuard } from '../assessment/assessment-shared';

const masterAdmin = authGuard('/staff', [StaffRole.MasterAdmin]);
const agency = authGuard('/staff', [StaffRole.Agency]);

const list = () => import('../scheme-verification/scheme-list').then((m) => m.SchemeListPage);
const detail = () => import('../scheme-verification/scheme-detail').then((m) => m.SchemeDetailPage);

/**
 * 2026-11-20 (the product owner), children of `staff` at `staff/scheme-agencies`: the Master Admin's Incentive Verification Agencies
 * (desktop and onsite verification agencies; it was "Onsite Verification Agencies" at `staff/scheme-onsite/agencies`, which redirects
 * here). The API checks the role again.
 */
export const SCHEME_AGENCY_ROUTES: Routes = [
  {
    path: '',
    canActivate: [masterAdmin],
    children: [
      { path: '', title: 'ZED | Incentive Verification Agencies', loadComponent: () => import('./incentive-agencies').then((m) => m.IncentiveAgenciesPage) },
      { path: 'new', title: 'ZED | Add Incentive Verification Agency', loadComponent: () => import('./incentive-agency-form').then((m) => m.IncentiveAgencyFormPage) },
      { path: ':userId', title: 'ZED | Edit Incentive Verification Agency', loadComponent: () => import('./incentive-agency-form').then((m) => m.IncentiveAgencyFormPage) },
    ],
  },
];

/**
 * 2026-11-20 (incentive schemes, phase 2: onsite verification), children of `staff` at `staff/scheme-onsite`: the onsite verification
 * agency's onsite allotment and onsite QC (the scheme verification list and detail pages in their onsite modes); the old address of the
 * Master Admin's agencies page redirects to `staff/scheme-agencies`. The API checks the role and the agency kind again.
 */
export const SCHEME_ONSITE_ROUTES: Routes = [
  { path: 'agencies', pathMatch: 'full', redirectTo: '/staff/scheme-agencies' },
  { path: 'agencies/new', pathMatch: 'full', redirectTo: '/staff/scheme-agencies/new' },
  { path: 'agencies/:userId', pathMatch: 'full', redirectTo: '/staff/scheme-agencies/:userId' },
  {
    path: 'allotment',
    canActivate: [agency],
    children: [
      { path: '', title: 'ZED | Scheme Onsite Allotment', data: { mode: 'onsiteAllotment' }, canActivate: [staffMenuGuard('/staff/scheme-onsite/allotment')], loadComponent: list },
      { path: ':id', title: 'ZED | Scheme Application', data: { mode: 'onsiteAllotment' }, loadComponent: detail },
    ],
  },
  {
    path: 'qc',
    canActivate: [agency],
    children: [
      { path: '', title: 'ZED | Scheme Onsite QC', data: { mode: 'onsiteQc' }, canActivate: [staffMenuGuard('/staff/scheme-onsite/qc')], loadComponent: list },
      { path: ':id', title: 'ZED | Scheme Application', data: { mode: 'onsiteQc' }, loadComponent: detail },
    ],
  },
];
