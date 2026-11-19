import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Component, Injectable, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { AuthService } from '@zed/shared';
import { catchError, filter, firstValueFrom, throwError } from 'rxjs';
import { apiBasePath } from './api-base';
import { PORTAL_SYSTEM } from './portal-system';
import { TextPipe } from './content/page-text';

/** Whether this portal is down (Admin → Settings → Maintenance mode), and its message. */
export interface MaintenanceInfo {
  message: string;
  /** yyyy-MM-ddTHH:mm, when it is expected back (the window's end). */
  until: string | null;
}

/**
 * 2026-11-15 (the user, design approved): Maintenance mode. The portal asks at start whether it is down
 * (/api/public/maintenance), and any call refused with 503 "maintenance" says so too; the app shell then shows the
 * maintenance page instead of the pages. The Admin (signed in on the main portal) keeps working, with a note on top.
 */
@Injectable({ providedIn: 'root' })
export class MaintenanceService {
  private readonly http = inject(HttpClient);
  readonly info = signal<MaintenanceInfo | null>(null);

  async check(): Promise<void> {
    try {
      const s = await firstValueFrom(this.http.get<{ down: boolean; message: string | null; until: string | null }>('/api/public/maintenance'));
      this.info.set(s.down ? { message: s.message ?? '', until: s.until } : null);
    } catch {
      // Unknown: the pages decide (a refused call still shows the page).
    }
  }
}

/** A call of this portal's API refused because the portal is down: the maintenance page is shown. */
export const maintenanceInterceptor: HttpInterceptorFn = (req, next) => {
  const maintenance = inject(MaintenanceService);
  const own = apiBasePath() + '/api/';
  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 503 && req.url.startsWith(own) && err.error?.maintenance) {
        maintenance.info.set({ message: String(err.error.title ?? ''), until: err.error.until ?? null });
      }
      return throwError(() => err);
    }),
  );
};

/** The maintenance page over the app, or the Admin's note; nothing while the portal is up. */
@Component({
  selector: 'zed-maintenance',
  imports: [DatePipe, RouterLink, TextPipe],
  template: `
    @if (info(); as m) {
      @if (isAdmin()) {
        <div class="mt-admin" role="status">
          {{ 'Maintenance mode: this portal is down for its users. You can work as the Admin.' | t: 'common.maintenance.adminNote' }}
          <a routerLink="/staff/settings/maintenance">{{ 'Maintenance mode' | t: 'common.maintenance.adminLink' }}</a>
        </div>
      } @else if (!onAdminLogin()) {
        <div class="mt-page" role="alert" aria-labelledby="mt-title">
          <div class="mt-card">
            <img src="Images/header/zed-logo.png" [alt]="'ZED' | t: 'common.maintenance.logoAlt'" class="mt-logo" />
            <h1 id="mt-title">{{ 'Under maintenance' | t: 'common.maintenance.title' }}</h1>
            <p class="mt-msg">{{ m.message || ('This portal is under maintenance. Please try again later.' | t: 'common.maintenance.text') }}</p>
            @if (until(); as u) { <p class="mt-until">{{ 'Expected back by {date}' | t: 'common.maintenance.untilNote' : { date: (u | date: 'dd-MM-yyyy, h:mm a') } }}</p> }
            <button type="button" class="btn btn-primary" (click)="retry()">{{ 'Try again' | t: 'common.maintenance.retryButton' }}</button>
            @if (mainPortal) { <p class="mt-staff"><a routerLink="/login">{{ 'Admin sign-in' | t: 'common.maintenance.adminLoginLink' }}</a></p> }
          </div>
        </div>
      }
    }
  `,
  styles: `
    .mt-page { position: fixed; inset: 0; z-index: 3000; display: flex; align-items: center; justify-content: center; padding: 16px;
      background: linear-gradient(160deg, #eef6f6, var(--zt-soft, #d9eef0)); }
    .mt-card { max-width: 520px; width: 100%; background: #fff; border-radius: 12px; border-top: 6px solid var(--zt-dark, #23656b); box-shadow: 0 8px 30px rgba(16,61,64,.12);
      padding: 28px 24px; text-align: center; }
    .mt-logo { height: 72px; margin-bottom: 12px; }
    h1 { font-size: 24px; font-weight: 700; color: #23474a; margin: 0 0 10px; }
    .mt-msg { font-size: 16px; color: #3b4b4c; margin: 0 0 8px; white-space: pre-line; }
    .mt-until { font-size: 14px; color: var(--zt-mid2, #2f7c83); font-weight: 600; margin: 0 0 16px; }
    .mt-staff { margin: 14px 0 0; font-size: 13px; }
    .mt-staff a { color: #5f6f70; }
    .mt-admin { position: sticky; top: 0; z-index: 3000; background: #fdf1dc; color: #7a4d0b; border-bottom: 1px solid #f0d49c;
      padding: 6px 16px; font-size: 13.5px; font-weight: 600; text-align: center; }
    .mt-admin a { margin-left: 8px; color: var(--zt-dark, #23656b); }
  `,
})
export class MaintenanceBanner {
  private readonly maintenance = inject(MaintenanceService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly info = this.maintenance.info;
  protected readonly mainPortal = PORTAL_SYSTEM === 'main';
  private readonly url = signal(this.router.url);
  protected readonly isAdmin = computed(() => this.mainPortal && this.auth.currentUser()?.roleId === 1);
  /** The staff sign-in page stays usable on the main portal (the Admin signs in there). */
  protected readonly onAdminLogin = computed(() => this.mainPortal && this.url().split('?')[0] === '/login');
  protected readonly until = computed(() => {
    const u = this.info()?.until;
    return u ? new Date(u) : null;
  });

  constructor() {
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => this.url.set((e as NavigationEnd).urlAfterRedirects));
  }

  protected async retry(): Promise<void> {
    await this.maintenance.check();
    if (!this.maintenance.info()) location.reload();
  }
}
