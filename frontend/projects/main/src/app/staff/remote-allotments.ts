import { HttpClient } from '@angular/common/http';
import { Injectable, effect, inject, signal } from '@angular/core';
import { AuthService } from '@zed/shared';
import { StaffRole, type StaffMenuItem } from './staff-menu';

const REMOTE_ROUTE = '/staff/remote-assessments';

/**
 * 2026-11-14: an assessor's "Remote Assessments" menu entry follows the assessments allotted to them. It shows only when
 * at least one remote / onsite assessment (Silver, Gold …) is allotted; a Bronze (desktop) assessor has none, so the entry
 * is not shown. Asked once per signed-in assessor; until the answer arrives (or when it fails) the entry is hidden.
 */
@Injectable({ providedIn: 'root' })
export class RemoteAllotments {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly has = signal(false);
  private askedFor: string | null = null;

  constructor() {
    effect(() => {
      const u = this.auth.currentUser();
      const key = u && u.roleId === StaffRole.DesktopAssessor && (u.subRoles ?? []).includes('SiteVerification') ? u.userId : null;
      if (key === this.askedFor) return;
      this.askedFor = key;
      this.has.set(false);
      if (!key) return;
      this.http.get<unknown[]>('/api/staff/remote-assessments').subscribe({
        next: (rows) => { if (this.askedFor === key) this.has.set(Array.isArray(rows) && rows.length > 0); },
        error: () => undefined,
      });
    });
  }

  /** The menu without "Remote Assessments" while no remote / onsite assessment is allotted. */
  filter(items: StaffMenuItem[]): StaffMenuItem[] {
    const has = this.has();
    return has ? items : items.filter((i) => i.route !== REMOTE_ROUTE);
  }
}
