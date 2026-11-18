import { Routes } from '@angular/router';
import { authGuard } from '@zed/shared';
import { StaffRole } from '../staff-menu';

/**
 * 2026-11-18 (approved design "Expenditure monitoring"), children of `staff`, mounted at `staff/expenditure` (main and
 * Consultancy): the Expenditure tab (Admin on main, master admins) and the agency's / consultant organisation's monthly
 * invoices. The API checks the roles again.
 */
export const EXPENDITURE_ROUTES: Routes = [
  {
    path: '',
    title: 'ZED | Expenditure',
    canActivate: [authGuard('/staff', [StaffRole.Admin, StaffRole.MasterAdmin])],
    loadComponent: () => import('./expenditure').then((m) => m.ExpenditurePage),
  },
  {
    path: 'invoices',
    title: 'ZED | Invoices',
    canActivate: [authGuard('/staff', [StaffRole.Agency])],
    loadComponent: () => import('./my-invoices').then((m) => m.MyInvoicesPage),
  },
];
