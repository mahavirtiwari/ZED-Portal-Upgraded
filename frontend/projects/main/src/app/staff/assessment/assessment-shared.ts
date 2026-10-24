import { InjectionToken, computed, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService, ClientConfigService } from '@zed/shared';
import { PORTAL_SYSTEM, PortalSystem } from '../../portal-system';
import { Row } from './assessment.api';
import { withApiBase } from '../../api-base';

/**
 * The system this build serves (PORTAL_SYSTEM), injectable so the assessment and monitoring pages can be tested
 * for each system. Consultancy and Surveillance differ in labels, columns and the actions their procedures support.
 */
export const ASSESSMENT_SYSTEM = new InjectionToken<PortalSystem>('ASSESSMENT_SYSTEM', { factory: () => PORTAL_SYSTEM });

/** Milestone report of a handholding unit (served by the certification documents API). */
export function milestoneReportUrl(zedId: string, certification: string, milestone: number): string {
  return withApiBase(`/api/staff/certification-documents/${encodeURIComponent(zedId)}/${encodeURIComponent(certification)}/report?milestone=${milestone}`);
}

/** State filter of the old list pages (LG state codes). */
export const STATES: readonly (readonly [code: string, name: string])[] = [
  ['35', 'ANDAMAN AND NICOBAR ISLANDS'], ['28', 'ANDHRA PRADESH'], ['12', 'ARUNACHAL PRADESH'], ['18', 'ASSAM'], ['10', 'BIHAR'],
  ['4', 'CHANDIGARH'], ['22', 'CHHATTISGARH'], ['7', 'DELHI'], ['30', 'GOA'], ['24', 'GUJARAT'], ['6', 'HARYANA'],
  ['2', 'HIMACHAL PRADESH'], ['1', 'JAMMU AND KASHMIR'], ['20', 'JHARKHAND'], ['29', 'KARNATAKA'], ['32', 'KERALA'], ['37', 'LADAKH'],
  ['31', 'LAKSHADWEEP'], ['23', 'MADHYA PRADESH'], ['27', 'MAHARASHTRA'], ['14', 'MANIPUR'], ['17', 'MEGHALAYA'], ['15', 'MIZORAM'],
  ['13', 'NAGALAND'], ['21', 'ODISHA'], ['34', 'PUDUCHERRY'], ['3', 'PUNJAB'], ['8', 'RAJASTHAN'], ['11', 'SIKKIM'], ['33', 'TAMIL NADU'],
  ['36', 'TELANGANA'], ['38', 'THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU'], ['16', 'TRIPURA'], ['9', 'UTTAR PRADESH'],
  ['5', 'UTTARAKHAND'], ['19', 'WEST BENGAL'],
];

export { ClientPager, PAGE_SIZES } from '../pager';

/** Text of a column ('' when empty). */
export function text(row: Row | null | undefined, column: string): string {
  const v = row?.[column];
  return v === null || v === undefined ? '' : String(v);
}

/** Truthy column (bit/1/'1'/true). */
export function flag(row: Row | null | undefined, column: string): boolean {
  const v = row?.[column];
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'True';
}

export function num(row: Row | null | undefined, column: string): number {
  const n = Number(row?.[column]);
  return Number.isFinite(n) ? n : 0;
}

/** Address of a page of the current (old) portal, for screens not migrated yet. */
export function useLegacyPortal() {
  const base = signal('');
  inject(ClientConfigService).get().then((c) => base.set(c.legacyPortalUrl ?? '')).catch(() => undefined);
  return {
    base,
    // The staff MSME profile page of this portal; relative, so it stays under the build's base href.
    profile: (zedId: string) => `staff/msme-profile/${encodeURIComponent(zedId)}`,
    saDetails: (zedId: string, certification: string) =>
      base() ? `${base()}/Assessment/SaDetails?zedId=${encodeURIComponent(zedId)}&Certification=${encodeURIComponent(certification)}` : '',
    daDetails: (zedId: string, certification: string) =>
      base() ? `${base()}/Assessment/DaDetails?zedId=${encodeURIComponent(zedId)}&Certification=${encodeURIComponent(certification)}` : '',
    path: (path: string) => (base() ? base() + path : ''),
  };
}

/** Child-route guard: the screen's roles (Users.RoleId) and sub-roles; others go back to the staff home page. */
export function staffScreenGuard(roles: number[], subRoles: string[] = [], anySubRole: string[] = []): CanActivateFn {
  return async () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    await auth.ensureLoaded().catch(() => undefined);
    const user = auth.currentUser();
    if (!user) return router.parseUrl('/login');
    const subs = user.subRoles ?? [];
    const ok = roles.includes(user.roleId) && subRoles.every((s) => subs.includes(s)) && (!anySubRole.length || anySubRole.some((s) => subs.includes(s)));
    return ok ? true : router.parseUrl('/staff');
  };
}
