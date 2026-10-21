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
}

/** Signed-in user, held in a signal. The session itself is an HttpOnly cookie set by the API. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly user = signal<CurrentUser | null>(null);
  private loaded: Promise<void> | null = null;

  readonly currentUser = this.user.asReadonly();
  readonly isSignedIn = computed(() => this.user() !== null);

  /** Asks the API who is signed in. Runs once per page load; also fetches the XSRF cookie. */
  ensureLoaded(): Promise<void> {
    this.loaded ??= this.refresh();
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

  async logout(): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/logout', null));
    this.user.set(null);
  }
}

/** Route guard: requires a signed-in user, optionally with one of the given role ids. */
export function authGuard(loginUrl: string, roleIds?: number[]): CanActivateFn {
  return async () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    await auth.ensureLoaded().catch(() => undefined);
    const user = auth.currentUser();
    if (!user) return router.parseUrl(loginUrl);
    if (roleIds && !roleIds.includes(user.roleId)) return router.parseUrl(loginUrl);
    return true;
  };
}
