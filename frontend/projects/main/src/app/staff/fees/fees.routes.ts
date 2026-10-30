import { Routes } from '@angular/router';
import { authGuard } from '@zed/shared';
import { PORTAL_SYSTEM } from '../../portal-system';
import { StaffRole } from '../staff-menu';

const admin = authGuard('/staff', [StaffRole.Admin]);

/**
 * Assessment fee master (children of `staff`, mounted at `staff/fees`): the Fee Structure on Main and Surveillance,
 * Consultancy's handholding fee per milestone (on main, the Admin's portal switch picks which). The API checks the role again.
 */
export const FEES_ROUTES: Routes = [
  {
    path: '', title: PORTAL_SYSTEM === 'consultancy' ? 'ZED | Handholding Payments' : PORTAL_SYSTEM === 'main' ? 'ZED | Payments' : 'ZED | Fee Structure',
    canActivate: [admin], loadComponent: () => import('./fees-host').then((m) => m.FeesHostPage),
  },
];
