import { inject } from '@angular/core';
import { CanActivateFn, Route, Router } from '@angular/router';
import { AuthService } from '@zed/shared';
import { STAFF_ROLE_IDS, homeFor } from './staff-menu';

/** MSME role id (Users.RoleId 5). */
const MSME_ROLE = 5;

/** Sends a role to its landing page of the old login (dashboard, fee master, ...); the others get the card home. */
export const staffHomeRedirect: CanActivateFn = () => {
  const user = inject(AuthService).currentUser();
  const home = user ? homeFor(user.roleId) : null;
  return home ? inject(Router).parseUrl(home) : true;
};

/**
 * An address no route has (the last route of the portal). 2026-11-19 (admin audit: /documents sent a signed-in Admin to
 * /msme/login): a signed-in staff user goes to the same address under /staff (/documents → /staff/documents; one that is not
 * a staff screen either opens their home), an MSME to its dashboard, anyone else to <code>loginUrl</code> as before.
 */
export function unknownAddressRedirect(loginUrl: string): CanActivateFn {
  return async (_route, state) => {
    const auth = inject(AuthService);
    const router = inject(Router);
    await auth.ensureLoaded().catch(() => undefined);
    const user = auth.currentUser();
    if (user && STAFF_ROLE_IDS.includes(user.roleId)) {
      const path = state.url.split(/[?#]/)[0];
      return router.parseUrl(path === '/staff' || path.startsWith('/staff/') ? '/staff' : '/staff' + state.url);
    }
    if (user?.roleId === MSME_ROLE) return router.parseUrl('/msme/dashboard');
    return router.parseUrl(loginUrl);
  };
}

/**
 * The last route under /staff: a staff address that is not a screen of this portal (or not deployed) opens the user's home
 * instead of falling through to the portal's login page.
 */
export const STAFF_UNKNOWN_ROUTE: Route = { path: '**', redirectTo: '' };
