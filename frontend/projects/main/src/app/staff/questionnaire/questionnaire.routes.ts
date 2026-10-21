import { Routes } from '@angular/router';
import { authGuard } from '@zed/shared';
import { StaffRole } from '../staff-menu';

const admin = authGuard('/staff', [StaffRole.Admin]);

/** Questionnaire screens (children of `staff`, mounted at `staff/questionnaire`). The API checks the role again. */
export const QUESTIONNAIRE_ROUTES: Routes = [
  {
    path: ':sectionType/:sectionCode',
    title: 'ZED | Requirements',
    canActivate: [admin],
    loadComponent: () => import('./requirements').then((m) => m.RequirementsPage),
  },
];
