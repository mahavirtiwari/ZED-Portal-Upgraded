import { Routes } from '@angular/router';
import { authGuard } from '@zed/shared';
import { StaffRole } from '../staff-menu';
import { staffMenuGuard } from '../assessment/assessment-shared';

const masterAdmin = authGuard('/staff', [StaffRole.MasterAdmin]);
const agency = authGuard('/staff', [StaffRole.Agency]);
const assessor = authGuard('/staff', [StaffRole.DesktopAssessor]);

const list = () => import('./scheme-list').then((m) => m.SchemeListPage);
const detail = () => import('./scheme-detail').then((m) => m.SchemeDetailPage);

/**
 * 2026-11-20 (incentive schemes, Part C): the staff verification screens, children of `staff` (the integrator mounts them, e.g. at
 * `staff/schemes-verify`). The API checks the roles again; the guards only keep other roles off pages they cannot use.
 * 2026-11-21 (Assessor UI audit): each list also only for the logins its menu entry is for (the desktop verification agencies and
 * their assessors), as the menu; the application pages opened from the lists keep the role check.
 */
export const SCHEME_VERIFICATION_ROUTES: Routes = [
  {
    path: 'applications',
    canActivate: [masterAdmin],
    children: [
      { path: '', title: 'ZED | Scheme Applications', data: { mode: 'admin' }, loadComponent: list },
      { path: ':id', title: 'ZED | Scheme Application', data: { mode: 'admin' }, loadComponent: detail },
    ],
  },
  {
    path: 'allotment',
    canActivate: [agency],
    children: [
      { path: '', title: 'ZED | Scheme Allotment', data: { mode: 'allotment' }, canActivate: [staffMenuGuard('/staff/schemes-verify/allotment')], loadComponent: list },
      { path: ':id', title: 'ZED | Scheme Application', data: { mode: 'allotment' }, loadComponent: detail },
    ],
  },
  {
    path: 'qc',
    canActivate: [agency],
    children: [
      { path: '', title: 'ZED | Scheme QC', data: { mode: 'qc' }, canActivate: [staffMenuGuard('/staff/schemes-verify/qc')], loadComponent: list },
      { path: ':id', title: 'ZED | Scheme Application', data: { mode: 'qc' }, loadComponent: detail },
    ],
  },
  {
    path: 'verification',
    canActivate: [assessor],
    children: [
      { path: '', title: 'ZED | Scheme Verification', data: { mode: 'assessor' }, canActivate: [staffMenuGuard('/staff/schemes-verify/verification')], loadComponent: list },
      { path: ':id', title: 'ZED | Verify Scheme Application', loadComponent: () => import('./scheme-verify').then((m) => m.SchemeVerifyPage) },
    ],
  },
];
