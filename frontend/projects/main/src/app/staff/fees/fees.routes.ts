import { Routes } from '@angular/router';
import { authGuard } from '@zed/shared';
import { PORTAL_SYSTEM } from '../../portal-system';
import { StaffRole } from '../staff-menu';

const admin = authGuard('/staff', [StaffRole.Admin]);

/**
 * Assessment fee master (children of `staff`, mounted at `staff/fees`): the Fee Structure on Main and Surveillance,
 * Consultancy's handholding fee per milestone. The API checks the role again.
 */
export const FEES_ROUTES: Routes = [
  PORTAL_SYSTEM === 'consultancy'
    ? { path: '', title: 'ZED | Handholding Payments', canActivate: [admin], loadComponent: () => import('./assessment-fees').then((m) => m.AssessmentFeesPage) }
    : { path: '', title: 'ZED | Fee Structure', canActivate: [admin], loadComponent: () => import('./fee-structure').then((m) => m.FeeStructurePage) },
];
