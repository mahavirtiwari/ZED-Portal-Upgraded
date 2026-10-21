import { Routes } from '@angular/router';
import { authGuard } from '@zed/shared';
import { StaffRole } from '../staff-menu';

const admin = authGuard('/staff', [StaffRole.Admin]);

/** Assessment fee master (children of `staff`, mounted at `staff/fees`). The API checks the role again. */
export const FEES_ROUTES: Routes = [
  { path: '', title: 'ZED | Certification Payments', canActivate: [admin], loadComponent: () => import('./assessment-fees').then((m) => m.AssessmentFeesPage) },
];
