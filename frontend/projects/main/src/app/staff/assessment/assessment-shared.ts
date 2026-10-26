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


/** Text of a column ('' when empty). */
export function text(row: Row | null | undefined, column: string): string {
  const v = row?.[column];
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Component styles of the assessment details pages (desktop, site, remote, surveillance site review): the head line with
 * ZED ID / unit / level, the overview cards, photo grids, the section bars of the parameters, nested tables and the
 * submit bar under a tab. Shared here rather than in the V4 skin while only these pages use them.
 */
export const DETAILS_STYLES = `
  .head-ids { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
  .head-ids .zed-chip { margin: 0; }
  .overview { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 18px; align-items: start; }
  @media (max-width: 991px) { .overview { grid-template-columns: minmax(0, 1fr); } }
  .kv > tbody > tr > th { width: 42%; background: #eef6f6; color: #23474a; font-weight: 600; }
  .card-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
  .card-head h4 { font-size: 16px; font-weight: 700; color: #23474a; margin: 0; }
  .coords { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; }
  .coords dt { color: #5f6f70; font-weight: 600; }
  .coords dd { margin: 0; font-weight: 700; font-size: 16px; }
  .photo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; align-items: start; }
  .photo-grid .evidence-img img { height: 170px; }
  .photo-verdict { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .photo-row { display: flex; flex-wrap: wrap; gap: 8px; }
  .photo-row img { border-radius: 6px; }
  .photo-grid.tour .evidence-img img { height: 220px; }
  .photo-title { font-size: 14px; font-weight: 600; margin-bottom: 6px; }
  .req-results { border-left: 4px solid #45a5ad; border-radius: 0 0 8px 8px; margin-bottom: 12px; }
  .req-results > .table { margin-bottom: 4px; }
  .photo-review { display: flex; flex-wrap: wrap; gap: 8px 24px; align-items: center; justify-content: space-between; margin: 4px 0 12px; }
  .section + .section { margin-top: 18px; }
  .panel-black { background: #23474a; border-radius: 8px; margin-bottom: 10px; }
  .panel-black .panel-body { font-weight: 600; padding: 10px 14px; }
  .exempt { font-size: 15px; margin: 4px 0 10px; }
  .section-title { font-size: 16px; font-weight: 700; color: #23474a; margin: 6px 0 10px; }
  .table.inner { margin: 0; border: 0; border-radius: 0; box-shadow: none; }
  td > input.btn, td > .btn, label > input.btn { margin: 4px 0 0 4px; }
  .radio-label { line-height: 30px; cursor: pointer; margin-right: 8px; }
  .final-remarks { margin-top: 12px; }
  .submit-bar { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 8px; margin-top: 18px; }
  .file-hint { display: flex; justify-content: space-between; color: #c13a45; font-size: small; margin-top: 4px; }
  .preview-img { max-width: 100%; }
`;

/** Long texts of a table folded to three lines (clamp-3) with a more / less link, by row key. */
export class Expanded {
  private readonly keys = signal<ReadonlySet<string>>(new Set());

  has(key: string): boolean {
    return this.keys().has(key);
  }

  toggle(key: string): void {
    this.keys.update((set) => {
      const next = new Set(set);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }
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
