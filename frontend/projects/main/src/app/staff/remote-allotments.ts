import { HttpClient } from '@angular/common/http';
import { Injectable, effect, inject, signal } from '@angular/core';
import { AuthService, type CurrentUser } from '@zed/shared';
import { Observable, finalize, shareReplay, tap } from 'rxjs';
import { StaffRole, type StaffMenuItem } from './staff-menu';

const REMOTE_ROUTE = '/staff/remote-assessments';
const API = '/api/staff/site-assessment/remote-assessments';

/** Where the answer is kept for the browser tab's session (per user), and for how long it is used. */
export const REMOTE_ALLOTMENTS_CACHE_KEY = 'zed.remoteAllotments';
export const REMOTE_ALLOTMENTS_TTL_MS = 5 * 60_000;

/** The assessor whose menu follows its remote / onsite assessments (an assessor with site verification), else null. */
function assessorKey(u: CurrentUser | null): string | null {
  return u && u.roleId === StaffRole.DesktopAssessor && (u.subRoles ?? []).includes('SiteVerification') ? u.userId : null;
}

function readCache(key: string, now = Date.now()): boolean | null {
  try {
    const c = JSON.parse(sessionStorage.getItem(REMOTE_ALLOTMENTS_CACHE_KEY) ?? 'null') as { user?: string; has?: boolean; at?: number } | null;
    return c && c.user === key && typeof c.has === 'boolean' && typeof c.at === 'number' && now - c.at >= 0 && now - c.at < REMOTE_ALLOTMENTS_TTL_MS ? c.has : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, has: boolean): void {
  try {
    sessionStorage.setItem(REMOTE_ALLOTMENTS_CACHE_KEY, JSON.stringify({ user: key, has, at: Date.now() }));
  } catch {
    // Without the browser's storage the next page load asks again.
  }
}

/**
 * 2026-11-14: an assessor's "Remote Assessments" menu entry follows the assessments allotted to them. It shows only when
 * at least one remote / onsite assessment (Silver, Gold …) is allotted; a Bronze (desktop) assessor has none, so the entry
 * is not shown. Until the answer arrives (or when it fails) the entry is hidden.
 * <p>2026-11-21 (Assessor UI audit: the list was asked on every staff page, often twice): the answer is kept for the tab's session
 * for a few minutes ({@link REMOTE_ALLOTMENTS_TTL_MS}), one request at a time (the menu and the Remote Assessments page share it),
 * and the Remote Assessments page, which reads the list itself, refreshes it.</p>
 */
@Injectable({ providedIn: 'root' })
export class RemoteAllotments {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly has = signal(false);
  private askedFor: string | null = null;
  private inFlight: Observable<unknown[]> | null = null;

  constructor() {
    effect(() => {
      const key = assessorKey(this.auth.currentUser());
      if (key === this.askedFor) return;
      this.askedFor = key;
      const cached = key ? readCache(key) : null;
      this.has.set(cached ?? false);
      if (key && cached === null) this.list().subscribe({ error: () => undefined });
    });
  }

  /**
   * The assessor's remote / onsite assessments (api/staff/site-assessment/remote-assessments), read now: a request already on its
   * way is shared. The menu follows the answer.
   */
  list(): Observable<unknown[]> {
    if (this.inFlight) return this.inFlight;
    const call: Observable<unknown[]> = this.http.get<unknown[]>(API).pipe(
      tap((rows) => {
        const key = this.askedFor;
        if (!key) return;
        const has = Array.isArray(rows) && rows.length > 0;
        this.has.set(has);
        writeCache(key, has);
      }),
      finalize(() => {
        if (this.inFlight === call) this.inFlight = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.inFlight = call;
    return call;
  }

  /** Asks again (e.g. after an allotment changed); the menu follows the answer. */
  refresh(): void {
    if (this.askedFor) this.list().subscribe({ error: () => undefined });
  }

  /** The menu without "Remote Assessments" while no remote / onsite assessment is allotted. */
  filter(items: StaffMenuItem[]): StaffMenuItem[] {
    const has = this.has();
    return has ? items : items.filter((i) => i.route !== REMOTE_ROUTE);
  }
}
