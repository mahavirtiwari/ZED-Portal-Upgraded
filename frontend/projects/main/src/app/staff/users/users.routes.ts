import { Routes } from '@angular/router';
import { authGuard } from '@zed/shared';
import { StaffRole } from '../staff-menu';
import { PORTAL_SYSTEM } from '../../portal-system';

const masterAdmin = authGuard('/staff', [StaffRole.MasterAdmin]);
const agency = authGuard('/staff', [StaffRole.Agency]);
const agencyOrMaster = authGuard('/staff', [StaffRole.Agency, StaffRole.MasterAdmin]);

/**
 * User management screens (children of `staff`, mounted at `staff/users`). The API checks the roles
 * again; the guards only keep other roles off pages they cannot use.
 */
const MAIN_USERS_ROUTES: Routes = [
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
  {
    path: 'password-reset',
    title: 'ZED | Password Reset Link',
    canActivate: [masterAdmin],
    loadComponent: () => import('./password-reset-link').then((m) => m.PasswordResetLinkPage),
  },
];

/** Surveillance: agencies and assessors are mastered in main; this portal only views and blocks them. */
const SURVEILLANCE_USERS_ROUTES: Routes = [
  {
    path: 'surveillance-agencies',
    title: 'ZED | Bronze Surveillance Agencies',
    canActivate: [masterAdmin],
    data: { kind: 'agencies' },
    loadComponent: () => import('./surveillance-users').then((m) => m.SurveillanceUsersPage),
  },
  {
    path: 'surveillance-assessors',
    title: 'ZED | Assessors',
    canActivate: [agencyOrMaster],
    data: { kind: 'assessors' },
    loadComponent: () => import('./surveillance-users').then((m) => m.SurveillanceUsersPage),
  },
  {
    path: 'password-reset',
    title: 'ZED | Password Reset Link',
    canActivate: [masterAdmin],
    loadComponent: () => import('./password-reset-link').then((m) => m.PasswordResetLinkPage),
  },
];

/**
 * The user screens of this build. Consultancy: the same pages for Consultant Organisations and Consultants/Experts,
 * without Bronze assessment agencies.
 */
export const USERS_ROUTES: Routes =
  PORTAL_SYSTEM === 'surveillance'
    ? SURVEILLANCE_USERS_ROUTES
    : PORTAL_SYSTEM === 'consultancy'
      ? MAIN_USERS_ROUTES.filter((r) => r.path !== 'bronze-agencies')
      : MAIN_USERS_ROUTES;
