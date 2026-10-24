import { Routes } from '@angular/router';
import { authGuard } from '@zed/shared';
import { StaffRole } from '../staff-menu';

const admin = authGuard('/staff', [StaffRole.Admin]);
const owner = authGuard('/staff', [StaffRole.MasterAdmin, StaffRole.Agency]);

/** Admin → User Management (mounted at `staff/user-management`). The API checks the role again. */
export const USER_MANAGEMENT_ROUTES: Routes = [
  { path: '', title: 'ZED | User Management', canActivate: [admin], loadComponent: () => import('./accounts').then((m) => m.AccountsPage) },
];

/** Operation Admins / Sub-Users of MasterAdmins and agencies (mounted at `staff/sub-users`); the API refuses sub-users here. */
export const SUB_USERS_ROUTES: Routes = [
  { path: '', title: 'ZED | Sub-Users', canActivate: [owner], loadComponent: () => import('./sub-users').then((m) => m.SubUsersPage) },
];
