/**
 * 2026-11-20 (incentive schemes, phase 2: onsite verification, docs/INCENTIVE-SCHEMES.md): the scheme visits of the onsite
 * assessor. The server's shapes (mobile API SchemeVisits/*), what the phone keeps of a visit (the draft) and the pure rules:
 * the visit as shown (server answer + the phone's unsynced work), what Recommend and Reject still need, the eligible amount.
 */
import type { BaseServiceResponse } from '@zed/shared';

// ------------------------------------------------------------------ server shapes

export const TO_VISIT = 'OnsiteWithAssessor';
export const VISITING = 'OnsiteVisit';
export const VALID = 'Yes';
export const NOT_VALID = 'No';
export const SELFIE_SLOT = 'onsite/selfie';
export const SITE_SLOT = 'onsite/site';

export type SchemeVisitSummary = {
  applicationId: number;
  zedId?: string | null;
  unitName?: string | null;
  address?: string | null;
  schemeCode?: string | null;
  schemeName?: string | null;
  level?: string | null;
  levelName?: string | null;
  claimAmount?: number | null;
  status?: string | null;
  allottedOn?: string | null;
  visitStartedOn?: string | null;
};

export type SchemeVisitListResponse = BaseServiceResponse & { visits?: SchemeVisitSummary[] | null };

export type SchemeVisitFile = { name: string; isPdf: boolean };
export type CheckState = { status?: string | null; remarks?: string | null };

export type SchemeVisitAnswer = {
  path: string;
  field: string;
  label: string;
  type: string;
  value?: string | null;
  files?: SchemeVisitFile[] | null;
  isClaim?: boolean;
  checkOnsite?: boolean;
  desktop?: CheckState | null;
};

export type SchemeVisitSection = {
  key: string;
  title: string;
  help?: string | null;
  repeating?: boolean;
  items: Array<{ index: number; title: string; answers: SchemeVisitAnswer[] }>;
};

export type SavedPhoto = { name: string; slot: string; timeStamp?: string | null; latitude?: string | null; longitude?: string | null };

export type PhotoSlot = { section: string; index: number; title: string; photos: SavedPhoto[] };

export type SchemeVisitDetail = {
  applicationId: number;
  zedId?: string | null;
  unitName?: string | null;
  address?: string | null;
  schemeCode?: string | null;
  schemeName?: string | null;
  level?: string | null;
  levelName?: string | null;
  status?: string | null;
  open: boolean;
  claimAmount?: number | null;
  eligibleAmount?: number | null;
  sharePercent?: number | null;
  maxAmount?: number | null;
  photosMin: number;
  photosMax: number;
  visitStartedOn?: string | null;
  visitLatitude?: string | null;
  visitLongitude?: string | null;
  visitSubmittedOn?: string | null;
  representativeName?: string | null;
  representativeMobile?: string | null;
  remarks?: string | null;
  verifiedClaim?: number | null;
  sections: SchemeVisitSection[];
  places: Array<{ path: string; label: string; section: string; index: number; field: string }>;
  items: PhotoSlot[];
  selfie?: SavedPhoto | null;
  sitePhoto?: SavedPhoto | null;
  checks?: Record<string, CheckState> | null;
};

export type SchemeVisitDetailResponse = BaseServiceResponse & { visit?: SchemeVisitDetail | null };

export type SchemeVisitWriteResponse = BaseServiceResponse & { name?: string | null; visitStatus?: string | null; visitStartedOn?: string | null; eligibleAmount?: number | null };

export type SchemePhotoInput = { photoId: string; photo: string; timeStamp?: string | null; latitude?: string | null; longitude?: string | null };

export type SchemeCheckInput = { path: string; status: string; remarks?: string | null };

// ------------------------------------------------------------------ what the phone keeps

/** A photo taken on the phone; its image is in the photo table (photos_table) under the same photo ID. */
export type DraftPhoto = {
  photoId: string;
  /** "onsite/selfie", "onsite/site" or "onsite/{section}/{index}". */
  slot: string;
  timeStamp: string;
  latitude: string | null;
  longitude: string | null;
  /** On the server (the send was answered); `name` is the stored file there. */
  uploaded: boolean;
  name?: string | null;
};

/** The phone's check of an answer: Valid / Not valid with a remark, or '' (the check removed). */
export type DraftCheck = { status: '' | typeof VALID | typeof NOT_VALID; remarks?: string | null };

/**
 * One visit as the phone keeps it (ZedCache, per assessor and application): the start photos, the item photos, the checks,
 * the representative and the remarks, with what is still to sync. The server's answer (the detail) is kept apart; the visit
 * shown is both together ({@link visitView}).
 */
export type SchemeDraft = {
  applicationId: number;
  saId: string;
  /** Shown on the list while the server no longer lists the application. */
  summary: SchemeVisitSummary;
  selfie?: DraftPhoto | null;
  site?: DraftPhoto | null;
  /** The start was answered by the server. */
  startSent: boolean;
  startedAt?: string | null;
  photos: DraftPhoto[];
  /** Item photos on the server removed on the phone (their removal waits to sync). */
  removed: Array<{ photoId: string; slot: string; name?: string | null; sent?: boolean }>;
  checks: Record<string, DraftCheck>;
  representativeName?: string | null;
  representativeMobile?: string | null;
  remarks?: string | null;
  /** Checks, representative or remarks changed since the last save the server answered. */
  saveDirty: boolean;
  /** Raised on each change, so a save answered while the user typed does not mark the newer change as sent. */
  saveRev: number;
};

export function newDraft(saId: string, summary: SchemeVisitSummary): SchemeDraft {
  return { applicationId: summary.applicationId, saId, summary, startSent: false, photos: [], removed: [], checks: {}, saveDirty: false, saveRev: 0 };
}

export function summaryOf(d: SchemeVisitDetail): SchemeVisitSummary {
  return {
    applicationId: d.applicationId,
    zedId: d.zedId,
    unitName: d.unitName,
    address: d.address,
    schemeCode: d.schemeCode,
    schemeName: d.schemeName,
    level: d.level,
    levelName: d.levelName,
    claimAmount: d.claimAmount,
    status: d.status,
    visitStartedOn: d.visitStartedOn,
  };
}

export const itemSlot = (section: string, index: number) => `onsite/${section}/${index}`;

// ------------------------------------------------------------------ the visit as shown

export type ShownPhoto = {
  key: string;
  /** A photo of this phone (its image in the photo table) or one only on the server (opened from there). */
  local: boolean;
  photoId?: string;
  name?: string | null;
  uploaded: boolean;
  timeStamp?: string | null;
};

export type VisitView = {
  detail: SchemeVisitDetail;
  draft: SchemeDraft | null;
  started: boolean;
  /** Started on the phone, the start not yet on the server. */
  startPending: boolean;
  startedOn: string | null;
  /** The assessor may still change it (allotted, not submitted). */
  open: boolean;
  checks: Record<string, { status: string; remarks?: string | null }>;
  representativeName: string;
  representativeMobile: string;
  remarks: string;
  photos: Record<string, ShownPhoto[]>;
};

/** The server's answer with the phone's work over it: the phone's checks and texts win, its photos join the server's. */
export function visitView(detail: SchemeVisitDetail, draft: SchemeDraft | null): VisitView {
  const checks: VisitView['checks'] = {};
  for (const [path, c] of Object.entries(detail.checks ?? {})) if (c?.status) checks[path] = { status: c.status, remarks: c.remarks };
  for (const [path, c] of Object.entries(draft?.checks ?? {})) {
    if (!c.status) delete checks[path];
    else checks[path] = { status: c.status, remarks: c.remarks };
  }
  const removed = new Set((draft?.removed ?? []).flatMap(r => [r.name, r.photoId].filter((x): x is string => !!x)));
  const photos: Record<string, ShownPhoto[]> = {};
  for (const slot of detail.items) {
    const key = itemSlot(slot.section, slot.index);
    const mine = (draft?.photos ?? []).filter(p => p.slot === key);
    const mineNames = new Set(mine.map(p => p.name).filter(Boolean));
    const server = slot.photos.filter(p => !removed.has(p.name) && !mineNames.has(p.name));
    photos[key] = [
      ...server.map(p => ({ key: 'server:' + p.name, local: false, name: p.name, uploaded: true, timeStamp: p.timeStamp })),
      ...mine.map(p => ({ key: 'local:' + p.photoId, local: true, photoId: p.photoId, name: p.name, uploaded: p.uploaded, timeStamp: p.timeStamp })),
    ];
  }
  const serverStarted = detail.status === VISITING || (!!detail.visitStartedOn && detail.status !== TO_VISIT);
  const phoneStarted = !!draft?.selfie && !!draft?.site;
  const startPending = phoneStarted && !draft!.startSent && !serverStarted;
  const text = (mine: string | null | undefined, server: string | null | undefined) => (mine !== undefined && mine !== null ? mine : (server ?? ''));
  return {
    detail,
    draft,
    started: serverStarted || phoneStarted,
    startPending,
    startedOn: (serverStarted ? detail.visitStartedOn : null) ?? draft?.startedAt ?? null,
    open: detail.open && detail.status !== 'Qc' && detail.status !== 'Rejected',
    checks,
    representativeName: text(draft?.representativeName, detail.representativeName),
    representativeMobile: text(draft?.representativeMobile, detail.representativeMobile),
    remarks: text(draft?.remarks, detail.remarks),
    photos,
  };
}

// ------------------------------------------------------------------ rules

/** A 10-digit Indian mobile number (the app's rule: it cannot begin with 0–5). */
export const isValidMobile = (text: string | null | undefined) => /^[6-9][0-9]{9}$/.test((text ?? '').trim());

/** Eligible = share % of the verified claim's whole rupees, at most the maximum (as the server, SchemeVisitRules.Eligible). */
export function eligibleAmount(claim: number, share: number | null | undefined, max: number | null | undefined): number {
  if (share == null || max == null || !isFinite(claim)) return 0;
  return Math.min(Math.round(Math.trunc(claim) * share) / 100, max);
}

/** The verified claim typed: a number of rupees with at most two decimals, else null. */
export function parseAmount(text: string | null | undefined): number | null {
  const t = (text ?? '').replace(/,/g, '').trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null;
  return Number(t);
}

/** "1,50,000" or "1,50,000.50" (Indian grouping). */
export function rupees(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '0';
  const fixed = Math.abs(n).toFixed(2);
  const [whole, paise] = fixed.split('.') as [string, string];
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = rest ? `${rest},${last3}` : last3;
  return (n < 0 ? '-' : '') + grouped + (paise === '00' ? '' : '.' + paise);
}

/** What still stops a submit: a text key (app.assessor.schemes.ready.*) and its fields. */
export type Problem = { code: 'start' | 'repName' | 'repMobile' | 'unchecked' | 'notValid' | 'remark' | 'photos' | 'claim' | 'reason' | 'remarks'; fields?: Record<string, string | number> };

/**
 * Recommend needs the visit started, the representative's name and 10-digit mobile, every onsite answer checked, none Not
 * valid, the minimum of photos for every item and a verified claim of at most the claimed amount (as the server checks).
 */
export function recommendProblems(v: VisitView, verifiedClaim: number | null): Problem[] {
  const out: Problem[] = [];
  if (!v.started) out.push({ code: 'start' });
  if (!v.representativeName.trim()) out.push({ code: 'repName' });
  if (!isValidMobile(v.representativeMobile)) out.push({ code: 'repMobile' });
  const places = v.detail.places;
  const left = places.filter(p => !v.checks[p.path]?.status).length;
  if (left > 0) out.push({ code: 'unchecked', fields: { Count: left } });
  const notValid = places.filter(p => v.checks[p.path]?.status === NOT_VALID).length;
  if (notValid > 0) out.push({ code: 'notValid', fields: { Count: notValid } });
  const min = Math.max(0, v.detail.photosMin);
  for (const slot of v.detail.items) {
    const n = (v.photos[itemSlot(slot.section, slot.index)] ?? []).length;
    if (n < min) out.push({ code: 'photos', fields: { Item: slot.title, Min: min } });
  }
  const claimed = v.detail.claimAmount ?? 0;
  if (verifiedClaim == null || verifiedClaim < 0 || verifiedClaim > claimed) out.push({ code: 'claim', fields: { Claim: rupees(claimed) } });
  return out;
}

/** Reject needs the visit started, a reason and the overall remarks; every answer marked Not valid needs its remark. */
export function rejectProblems(v: VisitView, reason: string): Problem[] {
  const out: Problem[] = [];
  if (!v.started) out.push({ code: 'start' });
  if (Object.values(v.checks).some(c => c.status === NOT_VALID && !(c.remarks ?? '').trim())) out.push({ code: 'remark' });
  if (!reason.trim()) out.push({ code: 'reason' });
  if (!v.remarks.trim()) out.push({ code: 'remarks' });
  return out;
}

/** The photos an item may still take (the scheme's maximum). */
export const photosLeft = (v: VisitView, slot: string) => Math.max(0, Math.max(1, v.detail.photosMax) - (v.photos[slot] ?? []).length);
