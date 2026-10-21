import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '@zed/shared';
import { homeFor } from './staff-menu';

/** Sends a role to its landing page of the old login (dashboard, fee master, ...); the others get the card home. */
export const staffHomeRedirect: CanActivateFn = () => {
  const user = inject(AuthService).currentUser();
  const home = user ? homeFor(user.roleId) : null;
  return home ? inject(Router).parseUrl(home) : true;
};
