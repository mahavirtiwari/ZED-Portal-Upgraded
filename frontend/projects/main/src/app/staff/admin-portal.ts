import { HttpBackend, HttpClient, HttpContextToken, HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { Component, Injectable, computed, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, firstValueFrom, from, switchMap, throwError } from 'rxjs';
import { AuthService, CurrentUser } from '@zed/shared';
import { PORTAL_SYSTEM } from '../portal-system';

export type AdminPortal = 'main' | 'consultancy' | 'surveillance';

export const ADMIN_PORTALS: readonly { key: AdminPortal; name: string }[] = [
  { key: 'main', name: 'ZED Certification' },
  { key: 'consultancy', name: 'Consultancy' },
  { key: 'surveillance', name: 'Surveillance' },
];

/** The API of each portal as the main pages reach it (their IIS applications; the dev proxy maps them too). */
export const PORTAL_API_BASE: Record<AdminPortal, string> = { main: '', consultancy: '/Consultancy', surveillance: '/surveillance' };

export const ALL_PORTALS: readonly AdminPortal[] = ['main', 'consultancy', 'surveillance'];
/**
 * The portals that have the home page banner (Upload Image). 2026-11-08: main only (the Consultancy build has no MSME login
 * page, so its banner was shown nowhere).
 */
export const BANNER_PORTALS: readonly AdminPortal[] = ['main'];
/** The portals with their own questionnaire (parameters, requirements, checkpoints): ZED Certification and Surveillance. */
export const QUESTIONNAIRE_PORTALS: readonly AdminPortal[] = ['main', 'surveillance'];
/** The portals whose app has a site tour (Admin → Site Tour Sections): the site assessor app, the consultant app's milestone 1. */
export const SITE_TOUR_PORTALS: readonly AdminPortal[] = ['main', 'consultancy', 'surveillance'];
/** The NEFT Admin's portals: financial assistance (main) and Technology Upgradation (Consultancy). */
export const NEFT_PORTALS: readonly AdminPortal[] = ['main', 'consultancy'];

/**
 * The APIs of the screens with the portal switch, and the portals that have them: while the Admin has chosen one of
 * those portals, their calls go to its API (so they read and change that portal's data, with its rules); otherwise main's.
 */
export const SWITCHED_APIS: readonly { prefix: string; portals: readonly AdminPortal[] }[] = [
  { prefix: '/api/staff/settings/texts', portals: ALL_PORTALS },
  { prefix: '/api/staff/settings/email', portals: ALL_PORTALS },
  { prefix: '/api/staff/settings/email-templates', portals: ALL_PORTALS },
  { prefix: '/api/staff/settings/app-forms', portals: ALL_PORTALS },
  { prefix: '/api/staff/settings/site-tour-sections', portals: SITE_TOUR_PORTALS },
  { prefix: '/api/staff/settings/captcha', portals: ALL_PORTALS },
  // Professional verification (2026-11-13): each portal keeps its own (the agencies' Add Assessor / Consultant form).
  { prefix: '/api/staff/settings/professional-verification', portals: ALL_PORTALS },
  // Links (contact, app stores): main only (2026-11-08: the Consultancy and Surveillance builds have no page that shows them).
  { prefix: '/api/staff/settings/links', portals: ['main'] },
  { prefix: '/api/staff/masters/parameters', portals: QUESTIONNAIRE_PORTALS },
  { prefix: '/api/staff/questionnaire', portals: QUESTIONNAIRE_PORTALS },
  { prefix: '/api/staff/accounts', portals: ALL_PORTALS },
  { prefix: '/api/staff/fees', portals: ALL_PORTALS },
  { prefix: '/api/staff/masters/page-settings', portals: BANNER_PORTALS },
  // One NEFT Admin (2026-11-07): financial assistance on main, Technology Upgradation on the Consultancy portal.
  { prefix: '/api/staff/neft', portals: NEFT_PORTALS },
  { prefix: '/api/staff/consultancy/tu', portals: ['consultancy'] },
];

/**
 * One Dashboard Admin (2026-11-07): its screens' APIs and the screens (Zed.Core DashboardScreens keys) they belong to. Its
 * calls go to the portal chosen on the page, among the portals where the Admin ticked that screen (the most specific
 * prefix first).
 */
export const DASHBOARD_APIS: readonly { prefix: string; screens: readonly string[] }[] = [
  { prefix: '/api/staff/dashboard/registered-msme', screens: ['registered-msme'] },
  { prefix: '/api/staff/dashboard/failed-transactions', screens: ['failed-transactions'] },
  { prefix: '/api/staff/dashboard/financial-support', screens: ['financial-support'] },
  { prefix: '/api/staff/dashboard', screens: ['dash-registered', 'dash-certified'] },
  { prefix: '/api/staff/schemes/incentives/submissions', screens: ['incentive-submissions'] },
  { prefix: '/api/staff/reports', screens: ['reports'] },
  { prefix: '/api/staff/history', screens: ['history'] },
  { prefix: '/api/staff/documents', screens: ['documents'] },
  ...['/api/staff/msme-profile', '/api/staff/msme-edit-history', '/api/staff/assessment/da', '/api/staff/site-review', '/api/staff/app-form-values',
    '/api/staff/certification-documents'].map((prefix) => ({ prefix, screens: ['registered-msme', 'history'] })),
];

/** The screens each portal offers (as Zed.Core DashboardScreens). */
const SCREEN_PORTALS: Readonly<Record<string, readonly AdminPortal[]>> = {
  'financial-support': ['main', 'surveillance'],
  'incentive-submissions': ['main'],
};

/**
 * The NEFT portals of a user on main (2026-11-07): the NEFT Admin both; an MSME DFO those of its NEFT lists ("main:neft",
 * "consultancy:neft"); null for others.
 */
export function neftPortals(user: CurrentUser | null | undefined): AdminPortal[] | null {
  if (PORTAL_SYSTEM !== 'main' || user?.roleId !== 6) return null;
  if (user.isNeftAdmin || !user.screens) return [...NEFT_PORTALS];
  return NEFT_PORTALS.filter((p) => user.screens!.includes(`${p}:neft`));
}

/**
 * A Dashboard Admin's permission or setting on a portal (2026-11-08): 'edits' (Can make changes) or 'hide-names'. A Dashboard
 * Admin with every screen (no list) has the changes and shows names; other roles: false.
 */
export function dashboardSetting(user: CurrentUser | null | undefined, portal: AdminPortal, key: 'edits' | 'hide-names'): boolean {
  if (user?.roleId !== 10) return false;
  if (!user.screens) return key === 'edits';
  return user.screens.includes(`${portal}:${key}`);
}

/** A Dashboard Admin (Users.RoleId 10) on the main portal: it opens the other portals' screens from here. */
export function isDashboardAdmin(user: CurrentUser | null | undefined): boolean {
  return PORTAL_SYSTEM === 'main' && user?.roleId === 10;
}

/** The portals where a Dashboard Admin has one of these screens (every portal that offers them when it has every screen). */
export function dashboardPortals(user: CurrentUser | null | undefined, screens: readonly string[]): AdminPortal[] {
  return ALL_PORTALS.filter((p) =>
    screens.some((s) => (SCREEN_PORTALS[s] ?? ALL_PORTALS).includes(p) && (!user?.screens || user.screens.includes(`${p}:${s}`))),
  );
}

/** Sends one request to a given portal's API, whatever the switch says (e.g. the Sectors list of every portal). */
export const ADMIN_PORTAL = new HttpContextToken<AdminPortal | null>(() => null);

const STORAGE_KEY = 'zed.adminPortal';

function stored(): AdminPortal {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    return v === 'consultancy' || v === 'surveillance' ? v : 'main';
  } catch {
    return 'main';
  }
}

/**
 * One Admin for the three portals (V4): the portal the main Admin is working on, and its sign-in there. The main API
 * gives a one-time pass (api/staff/admin-portals/{portal}/handoff); the other portal's API signs the Admin in with it
 * and returns its anti-forgery token, which its calls then carry (its XSRF cookie is not readable from the main pages).
 * Only on the main portal's build.
 */
@Injectable({ providedIn: 'root' })
export class AdminPortalService {
  /** Without interceptors: the hand-over calls must not be rerouted themselves. */
  private readonly http = new HttpClient(inject(HttpBackend));
  private readonly tokens = new Map<AdminPortal, string>();
  private readonly pending = new Map<AdminPortal, Promise<string>>();

  readonly enabled = PORTAL_SYSTEM === 'main';
  readonly current = signal<AdminPortal>(this.enabled ? stored() : 'main');
  readonly currentName = computed(() => ADMIN_PORTALS.find((p) => p.key === this.current())!.name);

  /**
   * The portal a screen works on: the chosen one if the screen has it there, else main's; on the Consultancy and
   * Surveillance builds, their own.
   */
  effective(portals: readonly AdminPortal[] = ALL_PORTALS): AdminPortal {
    if (!this.enabled) return PORTAL_SYSTEM as AdminPortal;
    // A screen not on main (a Dashboard Admin's): its first portal.
    return portals.includes(this.current()) ? this.current() : portals.includes('main') || !portals.length ? 'main' : portals[0];
  }

  select(portal: AdminPortal): void {
    this.current.set(portal);
    try {
      sessionStorage.setItem(STORAGE_KEY, portal);
    } catch {
      /* private window: kept for this page only */
    }
  }

  /** The anti-forgery token of the portal's API, signing the Admin in there first when needed. */
  connect(portal: AdminPortal, fresh = false): Promise<string> {
    if (!fresh && this.tokens.has(portal)) return Promise.resolve(this.tokens.get(portal)!);
    if (!fresh && this.pending.has(portal)) return this.pending.get(portal)!;
    const run = (async () => {
      try {
        const { token } = await firstValueFrom(this.http.post<{ token: string }>(`/api/staff/admin-portals/${portal}/handoff`, null, { headers: { 'X-XSRF-TOKEN': mainXsrf() } }));
        const accepted = await firstValueFrom(this.http.post<{ xsrfToken: string }>(`${PORTAL_API_BASE[portal]}/api/staff/admin-portals/handoff`, { token }));
        this.tokens.set(portal, accepted.xsrfToken);
        return accepted.xsrfToken;
      } finally {
        this.pending.delete(portal);
      }
    })();
    this.pending.set(portal, run);
    return run;
  }

  forget(portal: AdminPortal): void {
    this.tokens.delete(portal);
  }
}

/** The main API's anti-forgery token (its XSRF-TOKEN cookie), for the hand-over request sent without the interceptors. */
function mainXsrf(): string {
  const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function targetOf(req: HttpRequest<unknown>, service: AdminPortalService, user: CurrentUser | null): AdminPortal {
  const explicit = req.context.get(ADMIN_PORTAL);
  if (explicit) return explicit;
  const path = req.url.split('?')[0];
  const neft = neftPortals(user);
  if (neft && (path === '/api/staff/neft' || path.startsWith('/api/staff/neft/') || path.startsWith('/api/staff/consultancy/tu'))) {
    return path.startsWith('/api/staff/consultancy/tu') ? 'consultancy' : service.effective(neft);
  }
  if (isDashboardAdmin(user)) {
    const screen = DASHBOARD_APIS.find((a) => path === a.prefix || path.startsWith(a.prefix + '/'));
    if (screen) return service.effective(dashboardPortals(user, screen.screens));
  }
  const api = SWITCHED_APIS.find((a) => path === a.prefix || path.startsWith(a.prefix + '/'));
  return api ? service.effective(api.portals) : 'main';
}

/**
 * Sends the calls of a switched screen (or one marked with ADMIN_PORTAL) to the chosen portal's API with that API's
 * anti-forgery token. When the other portal's sign-in has ended (401, or its token expired), signs in again once.
 */
export const adminPortalInterceptor: HttpInterceptorFn = (req, next) => {
  const service = inject(AdminPortalService);
  if (!service.enabled || !req.url.startsWith('/api/')) return next(req);
  const portal = targetOf(req, service, inject(AuthService).currentUser());
  if (portal === 'main') return next(req);
  const send = (fresh: boolean): Observable<never> =>
    from(service.connect(portal, fresh)).pipe(
      switchMap((xsrf) => next(req.clone({ url: PORTAL_API_BASE[portal] + req.url, setHeaders: { 'X-XSRF-TOKEN': xsrf } })) as Observable<never>),
    );
  return send(false).pipe(
    catchError((err: unknown) => {
      const expired = err instanceof HttpErrorResponse && (err.status === 401 || (err.status === 400 && /session token/i.test(String((err.error as { title?: string })?.title))));
      if (!expired) return throwError(() => err);
      service.forget(portal);
      return send(true);
    }),
  );
};

/**
 * The portal switch at the top of a screen that each portal keeps on its own (V4 one Admin): ZED Certification,
 * Consultancy or Surveillance. `portals` limits it to the portals that have the screen.
 */
@Component({
  selector: 'zed-portal-switch',
  template: `
    @if (service.enabled && shown().length > 1) {
      <div class="portal-switch" role="group" aria-label="Portal">
        <span class="ps-label">{{ title() }}</span>
        @for (p of shown(); track p.key) {
          <button type="button" class="ps-tab" [class.on]="p.key === selected()" [attr.aria-pressed]="p.key === selected()"
                  (click)="choose(p.key)">{{ labels()?.[p.key] ?? p.name }}</button>
        }
      </div>
    }
  `,
  styles: `
    .portal-switch { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 14px; }
    .ps-label { font-size: 12px; font-weight: 700; color: #5f6f70; text-transform: uppercase; letter-spacing: .05em; margin-right: 4px; }
    .ps-tab { border: 1px solid #d9eef0; border-radius: 18px; padding: 5px 14px; font-weight: 700; font-size: 13px; color: #174a4e; background: #d9eef0; }
    .ps-tab.on { background: #23656b; color: #fff; border-color: #23656b; }
  `,
})
export class PortalSwitchComponent {
  protected readonly service = inject(AdminPortalService);
  private readonly router = inject(Router);
  readonly portals = input<readonly AdminPortal[]>(ALL_PORTALS);
  /** Other names for the portals' tabs (the NEFT Admin's: Financial Assistance, Technology Upgradation). */
  readonly labels = input<Partial<Record<AdminPortal, string>> | null>(null);
  readonly title = input('Portal');
  /** Recreate the page after a change (default); false: the page reloads its data itself on (changed). */
  readonly reload = input(true);
  /** After the switch changed. */
  readonly changed = output<AdminPortal>();

  protected readonly shown = computed(() => ADMIN_PORTALS.filter((p) => this.portals().includes(p.key)));
  protected readonly selected = computed(() => this.service.effective(this.portals()));

  protected async choose(portal: AdminPortal): Promise<void> {
    if (portal === this.selected()) return;
    this.service.select(portal);
    this.changed.emit(portal);
    if (!this.reload()) return;
    // The page starts again on the chosen portal (its state, forms and lists belong to the other one).
    const url = this.router.url;
    await this.router.navigateByUrl('/', { skipLocationChange: true });
    await this.router.navigateByUrl(url);
  }
}
