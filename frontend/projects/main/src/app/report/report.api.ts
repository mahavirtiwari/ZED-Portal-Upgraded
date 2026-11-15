import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '@zed/shared';
import { RETURN_PARAM } from '../session-expiry';

/** The three reports (ReportLinks on the server): assessment, surveillance, handholding milestone. */
export type ReportKind = 'assessment' | 'surveillance' | 'milestone';

export const REPORT_KINDS: readonly ReportKind[] = ['assessment', 'surveillance', 'milestone'];

/** Tones of the chips and tiles: y conforms, n NC, p partial / in progress, x neutral. */
export type ReportTone = 'y' | 'n' | 'p' | 'x';

export interface ReportRow { label: string; value: string }
export interface ReportFact { value: string; label: string; tone: '' | 'g' | 'r' | 'a' }
export interface ReportPhoto { url: string; caption: string }
export interface ReportUnit {
  name: string; place: string; udyam: string; enterpriseType: string; nic: string; address: string;
  latitude: string; longitude: string; mapImage: string | null;
}
export interface ReportResult { tone: 'ok' | 'rej' | 'draft' | 'info'; heading: string; detail: string }
export interface ReportSectionResult { code: string; name: string; conformed: number; total: number; exempted: boolean }
export interface ReportProduct {
  name: string; exported: string; photo: string | null; descriptionPhoto: string | null; descriptionNote: string | null;
  verified: string; tone: ReportTone; remarks: string;
}
export interface ReportRawMaterial { name: string; percentage: string; country: string }
export interface ReportCheckpoint { code: string; text: string; subOptions: string[]; answer: 'Yes' | 'Partial' | 'No' | null }
export interface ReportRequirement { code: string; name: string; result: string; tone: ReportTone; remarks: string; checkpoints: ReportCheckpoint[] }
export interface ReportSection { code: string; name: string; exempted: boolean; ofi: string | null; requirements: ReportRequirement[] }
export interface ReportNcItem { code: string; requirement: string; remarks: string; status: string; tone: ReportTone }
export interface ReportNcRound { round: number; products: ReportProduct[]; items: ReportNcItem[] }
export interface ReportStep { number: number; name: string; status: string; tone: ReportTone; date: string }
export interface ReportGap {
  code: string; requirement: string; conformance: string; gaps: string[]; plan: string[]; days: string; technology: string[]; rationale: string;
}
export interface ReportProgressItem { code: string; requirement: string; completed: string; tone: ReportTone; remarks: string; date: string }
export interface ReportProgress { completed: number; total: number; items: ReportProgressItem[] }
export interface ReportMeeting { title: string; remark: string; photo: string | null; participants: ReportRow[] }
export interface ReportMilestone {
  number: number; existing: string; target: string; consultant: string; dates: string; steps: ReportStep[]; facts: ReportFact[];
  gaps: ReportGap[]; progress: ReportProgress | null; meetings: ReportMeeting[];
}

/** ReportPageView on the server (api/.../report/page, api/report-pages/link). */
export interface ReportPage {
  kind: ReportKind;
  title: string;
  zedId: string;
  recordId: string;
  level: string;
  levelName: string;
  /** A V4 level's badge (PNG data URI); Bronze, Silver and Gold use their medal. */
  badge: string | null;
  draft: boolean;
  rejected: boolean;
  footer: string;
  fileName: string;
  unit: ReportUnit | null;
  result: ReportResult | null;
  facts: ReportFact[];
  journey: ReportRow[];
  sectionResults: ReportSectionResult[];
  sitePhotos: ReportPhoto[];
  products: ReportProduct[];
  unitInfo: ReportRow[];
  rawMaterials: ReportRawMaterial[];
  findings: ReportSection[];
  ncRounds: ReportNcRound[];
  ncClosed: boolean;
  milestone: ReportMilestone | null;
  wayForward: string[];
  disclaimer: string[];
  verify: { url: string; qrImage: string } | null;
  /** An earlier milestone stored as a PDF when it was completed: the page links to that file only. */
  storedPdf: string | null;
  /** The cover's date: "Certified on", "Rejected on", "Surveillance completed on", the milestone's dates. */
  dated: ReportRow | null;
}

/** Where a report opens: the MSME's own (/msme/report/...) or a record staff may see (/staff/report/.../{zedId}). */
export interface ReportTarget {
  kind: ReportKind;
  level: string;
  /** Staff: the record (a rejected copy ZEDMSME000123_D_45 is allowed). */
  zedId?: string;
  /** MSME: a rejected copy of its own record. */
  record?: string;
  milestone?: number;
}

/** The report page's route (a new tab): MSME without zedId, staff with it. */
export function reportRoute(t: ReportTarget): string {
  const level = encodeURIComponent(t.level);
  const path = t.zedId ? `/staff/report/${t.kind}/${level}/${encodeURIComponent(t.zedId)}` : `/msme/report/${t.kind}/${level}`;
  const query = new URLSearchParams();
  if (t.record) query.set('record', t.record);
  if (t.milestone) query.set('milestone', String(t.milestone));
  const q = query.toString();
  return q ? `${path}?${q}` : path;
}

/** The page data's API address (relative to this portal; the API base interceptor adds /Consultancy or /surveillance). */
export function reportApiUrl(t: ReportTarget): string {
  const query = new URLSearchParams();
  if (t.milestone) query.set('milestone', String(t.milestone));
  if (t.zedId) {
    const q = query.toString();
    return `/api/staff/certification-documents/${encodeURIComponent(t.zedId)}/${encodeURIComponent(t.level)}/report/page${q ? '?' + q : ''}`;
  }
  if (t.record) query.set('record', t.record);
  const q = query.toString();
  const certification = t.kind === 'surveillance' ? `${t.level}Surveillance` : t.level;
  return `/api/msme/certification-documents/${encodeURIComponent(certification)}/report/page${q ? '?' + q : ''}`;
}

/** The API address of a link an app handed out (api/report-pages/link?t=…). */
export const reportLinkApiUrl = (token: string) => `/api/report-pages/link?t=${encodeURIComponent(token)}`;

const MSME_ROLE = 5;

/**
 * Sign-in for the report page: the MSME's (/msme/login) or staff's (/login). Unlike authGuard, the login page is given the way
 * back (returnUrl), so the "View report" link of an e-mail opens the report after signing in.
 */
export function reportGuard(area: 'msme' | 'staff'): CanActivateFn {
  return async (_route, state) => {
    const auth = inject(AuthService);
    const router = inject(Router);
    await auth.ensureLoaded().catch(() => undefined);
    const user = auth.currentUser();
    const ok = !!user && (area === 'msme' ? user.roleId === MSME_ROLE : user.roleId !== MSME_ROLE);
    if (ok) return true;
    return router.createUrlTree([area === 'msme' ? '/msme/login' : '/login'], { queryParams: { [RETURN_PARAM]: state.url } });
  };
}
