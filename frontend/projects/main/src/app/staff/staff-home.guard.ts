import { inject } from '@angular/core';
import { CanActivateFn, Route, Router } from '@angular/router';
import { AuthService } from '@zed/shared';
import { DASHBOARD_ROLE_IDS, INCENTIVES_DASHBOARD_ROUTE, STAFF_ROLE_IDS, homeFor } from './staff-menu';
import { dashboardPortals } from './admin-portal';

/**
 * 2026-11-27 (permissions review): a Dashboard Admin's screens in the menu's order, with their pages. One whose ticks leave out both
 * dashboard tabs opened /staff/dashboard after signing in and got "You do not have access to this screen": it opens its first
 * ticked screen instead.
 */
const DASHBOARD_ADMIN_SCREENS: readonly (readonly [string, string])[] = [
  ['registered-msme', '/staff/registered-msme'], ['failed-transactions', '/staff/failed-transactions'],
  ['financial-support', '/staff/financial-support'], ['incentive-submissions', '/staff/incentives/submissions'],
  ['reports', '/staff/reports'], ['history', '/staff/history'], ['documents', '/staff/documents'],
];

/** MSME role id (Users.RoleId 5). */
const MSME_ROLE = 5;

/** Sends a role to its landing page of the old login (dashboard, fee master, ...); the others get the card home. */
export const staffHomeRedirect: CanActivateFn = () => {
  const user = inject(AuthService).currentUser();
  const home = user ? homeFor(user.roleId, undefined, user.subRoles ?? []) : null;
  return home ? inject(Router).parseUrl(home) : true;
};

/**
 * 2026-11-27 (UI review: an MSME DFO opening /staff/dashboard saw a bare "Forbidden"): a role without the staff dashboard goes to its
 * own home (its landing page or the card home) instead.
 */
export const staffDashboardGuard: CanActivateFn = () => {
  const user = inject(AuthService).currentUser();
  if (!user) return true;
  // The incentive logins (Incentives Master Admin, incentive verification agencies) have the incentives dashboard instead.
  const home = homeFor(user.roleId, undefined, user.subRoles ?? []);
  if (home === INCENTIVES_DASHBOARD_ROUTE) return inject(Router).parseUrl(home);
  if (user.roleId === 10 && user.screens && dashboardPortals(user, ['dash-registered', 'dash-certified']).length === 0) {
    const first = DASHBOARD_ADMIN_SCREENS.find(([key]) => dashboardPortals(user, [key]).length > 0);
    if (first) return inject(Router).parseUrl(first[1]);
  }
  return DASHBOARD_ROLE_IDS.includes(user.roleId) ? true : inject(Router).parseUrl(home ?? '/staff');
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
