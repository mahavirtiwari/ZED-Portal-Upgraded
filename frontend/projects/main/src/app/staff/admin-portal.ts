import { HttpBackend, HttpClient, HttpContextToken, HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { Component, Injectable, computed, inject, input, output, signal } from '@angular/core';
import { Observable, catchError, firstValueFrom, from, switchMap, throwError } from 'rxjs';
import { PORTAL_SYSTEM } from '../portal-system';

export type AdminPortal = 'main' | 'consultancy' | 'surveillance';

export const ADMIN_PORTALS: readonly { key: AdminPortal; name: string }[] = [
  { key: 'main', name: 'ZED Certification' },
  { key: 'consultancy', name: 'Consultancy' },
  { key: 'surveillance', name: 'Surveillance' },
];

/** The API of each portal as the main pages reach it (their IIS applications; the dev proxy maps them too). */
export const PORTAL_API_BASE: Record<AdminPortal, string> = { main: '', consultancy: '/Consultancy', surveillance: '/surveillance' };

/**
 * The APIs of the screens with the portal switch: while the Admin has chosen another portal, their calls go to that
 * portal's API (so they read and change that portal's data, with its rules).
 */
export const SWITCHED_APIS: readonly string[] = ['/api/staff/settings/texts'];

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

function targetOf(req: HttpRequest<unknown>, service: AdminPortalService): AdminPortal {
  const explicit = req.context.get(ADMIN_PORTAL);
  if (explicit) return explicit;
  const path = req.url.split('?')[0];
  return SWITCHED_APIS.some((p) => path === p || path.startsWith(p + '/')) ? service.current() : 'main';
}

/**
 * Sends the calls of a switched screen (or one marked with ADMIN_PORTAL) to the chosen portal's API with that API's
 * anti-forgery token. When the other portal's sign-in has ended (401, or its token expired), signs in again once.
 */
export const adminPortalInterceptor: HttpInterceptorFn = (req, next) => {
  const service = inject(AdminPortalService);
  if (!service.enabled || !req.url.startsWith('/api/')) return next(req);
  const portal = targetOf(req, service);
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
    @if (service.enabled) {
      <div class="portal-switch" role="group" aria-label="Portal">
        <span class="ps-label">Portal</span>
        @for (p of shown(); track p.key) {
          <button type="button" class="ps-tab" [class.on]="p.key === service.current()" [attr.aria-pressed]="p.key === service.current()"
                  (click)="choose(p.key)">{{ p.name }}</button>
        }
      </div>
    }
  `,
  styles: `
    .portal-switch { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 14px; }
    .ps-label { font-size: 12px; font-weight: 700; color: #5f6f70; text-transform: uppercase; letter-spacing: .05em; margin-right: 4px; }
    .ps-tab { border: 1px solid #cfe1e2; border-radius: 18px; padding: 5px 14px; font-weight: 700; font-size: 13px; color: #2f7c83; background: #fff; }
    .ps-tab.on { background: #45a5ad; color: #fff; border-color: #45a5ad; }
  `,
})
export class PortalSwitchComponent {
  protected readonly service = inject(AdminPortalService);
  readonly portals = input<readonly AdminPortal[]>(['main', 'consultancy', 'surveillance']);
  /** After the switch changed: the page reloads its data. */
  readonly changed = output<AdminPortal>();

  protected readonly shown = computed(() => ADMIN_PORTALS.filter((p) => this.portals().includes(p.key)));

  protected choose(portal: AdminPortal): void {
    if (portal === this.service.current()) return;
    this.service.select(portal);
    this.changed.emit(portal);
  }
}
