import { Routes } from '@angular/router';
import { authGuard } from '@zed/shared';
import { StaffRole } from '../staff-menu';

const masterAdmin = authGuard('/staff', [StaffRole.MasterAdmin]);
const agency = authGuard('/staff', [StaffRole.Agency]);
const agencyOrMaster = authGuard('/staff', [StaffRole.Agency, StaffRole.MasterAdmin]);

/**
 * User management screens (children of `staff`, mounted at `staff/users`). The API checks the roles
 * again; the guards only keep other roles off pages they cannot use.
 */
export const USERS_ROUTES: Routes = [
  {
    path: 'agencies',
    title: 'ZED | Assessment Agencies',
    canActivate: [masterAdmin],
    data: { mode: 'all' },
    loadComponent: () => import('./agencies').then((m) => m.AgenciesPage),
  },
  {
    path: 'bronze-agencies',
    title: 'ZED | Bronze Assessment Agencies',
    canActivate: [masterAdmin],
    data: { mode: 'bronze' },
    loadComponent: () => import('./agencies').then((m) => m.AgenciesPage),
  },
  {
    path: 'agencies/new',
    title: 'ZED | Add Assessment Agency',
    canActivate: [masterAdmin],
    loadComponent: () => import('./agency-form').then((m) => m.AgencyFormPage),
  },
  {
    path: 'agencies/:userId',
    title: 'ZED | Assessment Agency',
    canActivate: [masterAdmin],
    loadComponent: () => import('./agency-form').then((m) => m.AgencyFormPage),
  },
  {
    path: 'assessors',
    title: 'ZED | Assessors',
    canActivate: [masterAdmin],
    loadComponent: () => import('./assessor-list').then((m) => m.AssessorListPage),
  },
  {
    path: 'my-assessors',
    title: 'ZED | Assessors',
    canActivate: [agency],
    loadComponent: () => import('./my-assessors').then((m) => m.MyAssessorsPage),
  },
  {
    path: 'assessors/new',
    title: 'ZED | Add Assessor',
    canActivate: [agency],
    loadComponent: () => import('./assessor-form').then((m) => m.AssessorFormPage),
  },
  {
    path: 'assessors/:userId',
    title: 'ZED | Assessor',
    canActivate: [agencyOrMaster],
    loadComponent: () => import('./assessor-form').then((m) => m.AssessorFormPage),
  },
];
