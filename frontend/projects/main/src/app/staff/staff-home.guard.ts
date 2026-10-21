import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '@zed/shared';
import { DASHBOARD_ROLE_IDS } from './staff-menu';

/** Sends roles that have a dashboard there, as the old Home page did; the others get the card home. */
export const staffHomeRedirect: CanActivateFn = () => {
  const user = inject(AuthService).currentUser();
  return user && DASHBOARD_ROLE_IDS.includes(user.roleId) ? inject(Router).parseUrl('/staff/dashboard') : true;
};
