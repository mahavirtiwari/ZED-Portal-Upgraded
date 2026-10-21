import { Routes } from '@angular/router';
import { authGuard } from '@zed/shared';
import { StaffRole } from '../staff-menu';
import { PORTAL_SYSTEM } from '../../portal-system';

const admin = authGuard('/staff', [StaffRole.Admin]);

/** Admin master data screens (children of `staff`, mounted at `staff/masters`). The API checks the role again. */
const ALL_MASTERS_ROUTES: Routes = [
  {
    path: 'sectors',
    title: 'ZED | Sectors',
    canActivate: [admin],
    data: { kind: 'sectors' },
    loadComponent: () => import('./code-names').then((m) => m.CodeNamesPage),
  },
  {
    path: 'categories',
    title: 'ZED | Categories',
    canActivate: [admin],
    data: { kind: 'categories' },
    loadComponent: () => import('./code-names').then((m) => m.CodeNamesPage),
  },
  { path: 'technologies', title: 'ZED | Technologies', canActivate: [admin], loadComponent: () => import('./technologies').then((m) => m.TechnologiesPage) },
  {
    path: 'technologies/new',
    title: 'ZED | Add Technology',
    canActivate: [admin],
    loadComponent: () => import('./technology-form').then((m) => m.TechnologyFormPage),
  },
  {
    path: 'technologies/:id',
    title: 'ZED | Technology',
    canActivate: [admin],
    loadComponent: () => import('./technology-form').then((m) => m.TechnologyFormPage),
  },
  { path: 'documents', title: 'ZED | Documents', canActivate: [admin], loadComponent: () => import('./documents').then((m) => m.DocumentsAdminPage) },
  {
    path: 'page-settings',
    title: 'ZED | Home Page Settings',
    canActivate: [admin],
    loadComponent: () => import('./page-settings').then((m) => m.PageSettingsPage),
  },
  { path: 'parameters', pathMatch: 'full', redirectTo: 'parameters/Bronze' },
  {
    path: 'parameters/:sectionType',
    title: 'ZED | Questionnaire',
    canActivate: [admin],
    loadComponent: () => import('./parameters').then((m) => m.ParametersPage),
  },
];

/** Consultancy has no category or technology masters (their procedures are not in ZED_CONSULTANT). */
export const MASTERS_ROUTES: Routes =
  PORTAL_SYSTEM === 'main' ? ALL_MASTERS_ROUTES : ALL_MASTERS_ROUTES.filter((r) => !/^(categories|technologies)/.test(r.path ?? ''));
