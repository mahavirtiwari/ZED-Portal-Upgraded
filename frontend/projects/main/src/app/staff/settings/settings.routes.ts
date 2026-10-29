import { Routes } from '@angular/router';
import { authGuard } from '@zed/shared';
import { StaffRole } from '../staff-menu';

const admin = authGuard('/staff', [StaffRole.Admin]);

/** Admin settings (children of `staff`, mounted at `staff/settings`). The API checks the role again. */
export const SETTINGS_ROUTES: Routes = [
  // New in V4: where "Contact ZED" goes.
  { path: 'links', title: 'ZED | Links', canActivate: [admin], loadComponent: () => import('./links').then((m) => m.LinksPage) },
  // New in V4: the certification levels' boxes (ZED-X included) and their certificate settings.
  { path: 'levels', title: 'ZED | Certification Levels', canActivate: [admin], loadComponent: () => import('./certification-levels').then((m) => m.CertificationLevelsPage) },
  {
    path: 'captcha',
    title: 'ZED | Captcha Settings',
    canActivate: [admin],
    loadComponent: () => import('./captcha-settings').then((m) => m.CaptchaSettingsPage),
  },
  {
    path: 'email',
    title: 'ZED | Email Settings',
    canActivate: [admin],
    loadComponent: () => import('./email-settings').then((m) => m.EmailSettingsPage),
  },
  {
    path: 'email-templates',
    title: 'ZED | Email Templates',
    canActivate: [admin],
    loadComponent: () => import('./email-templates').then((m) => m.EmailTemplatesPage),
  },
  {
    path: 'texts',
    title: 'ZED | Texts',
    canActivate: [admin],
    loadComponent: () => import('./texts').then((m) => m.TextsPage),
  },
  {
    path: 'app-forms',
    title: 'ZED | App Forms',
    canActivate: [admin],
    loadComponent: () => import('./app-forms').then((m) => m.AppFormsPage),
  },
  {
    path: 'esg-checklist',
    title: 'ZED | ESG Checklist',
    canActivate: [admin],
    loadComponent: () => import('./esg-checklist').then((m) => m.EsgChecklistPage),
  },
  {
    path: 'api-integrations',
    title: 'ZED | API Integrations',
    canActivate: [admin],
    loadComponent: () => import('./api-integrations').then((m) => m.ApiIntegrationsPage),
  },
];
