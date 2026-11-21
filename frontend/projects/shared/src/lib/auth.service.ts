import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

export interface CurrentUser {
  userId: string;
  userName: string;
  roleId: number;
  role: string;
  email?: string | null;
  mobileNo?: string | null;
  unitName?: string | null;
  /** Agency/assessor sub-roles: DesktopVerification, SiteVerification, FinancialVerification. */
  subRoles?: string[];
  /** The NEFT Admin (MSME DFO of every state): its NEFT pages switch between financial assistance and TU (2026-11-07). */
  isNeftAdmin?: boolean;
  /** A Dashboard Admin's ticked screens, "{portal}:{key}" (2026-11-07); null/absent = every screen. */
  screens?: string[] | null;
  /** A sub-user working as the owner above (userId, userName and role are the owner's): its own ID and name. */
  actingUserId?: string | null;
  actingUserName?: string | null;
  /** A sub-user's screens (staff routes); null for everyone else. */
  permissionRoutes?: string[] | null;
}

/** Signed-in user, held in a signal. The session itself is an HttpOnly cookie set by the API. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly user = signal<CurrentUser | null>(null);
  private loaded: Promise<void> | null = null;

  readonly currentUser = this.user.asReadonly();
  readonly isSignedIn = computed(() => this.user() !== null);

  /** Asks the API who is signed in. Runs once per page load; also fetches the XSRF cookie. A failed call is tried again next time. */
  ensureLoaded(): Promise<void> {
    this.loaded ??= this.refresh().catch((err: unknown) => {
      this.loaded = null;
      throw err;
    });
    return this.loaded;
  }

  async refresh(): Promise<void> {
    const me = await firstValueFrom(this.http.get<CurrentUser | null>('/api/auth/me'));
    this.user.set(me ?? null);
  }

  setUser(user: CurrentUser | null): void {
    this.user.set(user);
    this.loaded = Promise.resolve();
  }

  /** The server ended the session (401): forget the user; the login page asks the server again. */
  forget(): void {
    this.user.set(null);
    this.loaded = null;
  }

  /** Signs out on the server; this page forgets the user even when that call fails (e.g. an expired session). */
  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/auth/logout', null));
    } catch {
      // The session is gone or unusable either way: the login page asks the server again.
    } finally {
      this.user.set(null);
      this.loaded = null;
    }
  }
}

/** The staff pages' refusal page (staff/sub-user-screens.ts NoAccessPage). */
export const STAFF_NO_ACCESS_URL = '/staff/no-access';

/**
 * Route guard: requires a signed-in user, optionally with one of the given role ids. A signed-out user goes to
 * <code>loginUrl</code>. 2026-11-21 (Assessment Agency UI audit, item 11): a signed-in staff user whose role may not open a
 * staff screen (a guard sending back to <code>/staff</code>) gets the staff "no access" page naming the screen, instead of
 * landing on its dashboard without a word; the MSME and public guards keep sending back to their own page.
 */
export function authGuard(loginUrl: string, roleIds?: number[]): CanActivateFn {
  return async (_route, state) => {
    const auth = inject(AuthService);
    const router = inject(Router);
    await auth.ensureLoaded().catch(() => undefined);
    const user = auth.currentUser();
    if (!user) return router.parseUrl(loginUrl);
    if (roleIds && !roleIds.includes(user.roleId)) {
      const screen = (state?.url ?? '').split(/[?#]/)[0];
      const staffGuard = loginUrl === '/staff' || loginUrl.startsWith('/staff/');
      if (staffGuard && screen.startsWith('/staff/') && screen !== STAFF_NO_ACCESS_URL)
        return router.createUrlTree([STAFF_NO_ACCESS_URL], { queryParams: { screen, reason: 'role' } });
      return router.parseUrl(loginUrl);
    }
    return true;
  };
}
