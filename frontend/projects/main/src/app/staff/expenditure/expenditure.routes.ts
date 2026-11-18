import { Routes } from '@angular/router';
import { authGuard } from '@zed/shared';
import { StaffRole } from '../staff-menu';

/**
 * 2026-11-18 (approved design "Expenditure monitoring"), children of `staff`, mounted at `staff/expenditure` (main and
 * Consultancy): the Expenditure tab (Admin on main, master admins) and the agency's / consultant organisation's own
 * Expenditure page with its monthly invoices. The API checks the roles again.
 */
export const EXPENDITURE_ROUTES: Routes = [
  {
    path: '',
    title: 'ZED | Expenditure',
    canActivate: [authGuard('/staff', [StaffRole.Admin, StaffRole.MasterAdmin])],
    loadComponent: () => import('./expenditure').then((m) => m.ExpenditurePage),
  },
  {
    // 2026-11-18 (the user): the agency's (organisation's) Expenditure page: its figures, POs, months and invoices (the URL stays).
    path: 'invoices',
    title: 'ZED | Expenditure',
    canActivate: [authGuard('/staff', [StaffRole.Agency])],
    loadComponent: () => import('./my-invoices').then((m) => m.MyInvoicesPage),
  },
];
