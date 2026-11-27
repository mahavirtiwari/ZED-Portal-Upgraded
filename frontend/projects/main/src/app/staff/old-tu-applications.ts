import { HttpClient } from '@angular/common/http';
import { Injectable, effect, inject, signal } from '@angular/core';
import { AuthService, type CurrentUser } from '@zed/shared';
import { PORTAL_SYSTEM } from '../portal-system';
import { StaffRole, type StaffMenuItem } from './staff-menu';

export const OLD_TU_API = '/api/staff/consultancy/tu/open';

/** The logins that finish old Technology Upgradation applications on the consultancy portal; null for the others. */
function loginKey(u: CurrentUser | null, system: string = PORTAL_SYSTEM): string | null {
  if (system !== 'consultancy' || !u) return null;
  const fv = (u.subRoles ?? []).includes('FinancialVerification');
  return u.roleId === StaffRole.MasterAdmin || (fv && (u.roleId === StaffRole.Agency || u.roleId === StaffRole.DesktopAssessor)) ? u.userId : null;
}

/**
 * 2026-11-27 (the product owner, on Technology Upgradation moved to the incentive schemes: "finish old ones only"): the "Old TU
 * Applications" menu entries (`whileOldTu`) show only while the login has old applications to finish (api/staff/consultancy/tu/open).
 * Until the answer arrives, or when it fails, they are hidden; asked once per sign-in.
 */
@Injectable({ providedIn: 'root' })
export class OldTuApplications {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  readonly open = signal(0);
  private askedFor: string | null = null;

  constructor() {
    effect(() => {
      const key = loginKey(this.auth.currentUser());
      if (key === this.askedFor) return;
      this.askedFor = key;
      this.open.set(0);
      if (key) this.http.get<{ open: number }>(OLD_TU_API).subscribe({ next: (r) => this.askedFor === key && this.open.set(r?.open ?? 0), error: () => undefined });
    });
  }

  /** The menu without its old-TU entries while none are open. */
  filter(items: StaffMenuItem[]): StaffMenuItem[] {
    return this.open() > 0 ? items : items.filter((i) => !i.whileOldTu);
  }
}
