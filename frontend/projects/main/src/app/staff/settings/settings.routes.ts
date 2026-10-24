import { Routes } from '@angular/router';
import { authGuard } from '@zed/shared';
import { StaffRole } from '../staff-menu';

const admin = authGuard('/staff', [StaffRole.Admin]);

/** Admin settings (children of `staff`, mounted at `staff/settings`). The API checks the role again. */
export const SETTINGS_ROUTES: Routes = [
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
];
