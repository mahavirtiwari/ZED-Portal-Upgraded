/**
 * New in the redesign: the assessor signs in once (assessor ID + password) and sees all the assessments allotted to
 * them; one unit is opened at a time and kept as before (AssessorData row per assessor + unit). Shapes of SA/SignIn,
 * SA/Assessments, SA/Notifications and SA/Reports (docs/MOBILE-API.md). Dates are ISO text in server time.
 */
import type { BaseServiceResponse } from '@zed/shared';
import { COMPLETED, SUBMITTED, type AssessmentDetails } from './models';

export type AssessorProfile = {
  assessorId: string;
  name?: string | null;
  email?: string | null;
  mobile?: string | null;
  /** Users.AssessorType ("Assessor", "BronzeAssessor"). */
  assessorType?: string | null;
  certificateNo?: string | null;
  sectorActivity?: string | null;
  agencyId?: string | null;
  agencyName?: string | null;
  /** The agency's contact (Help page). */
  agencyEmail?: string | null;
  agencyMobile?: string | null;
  /** The certification levels the assessor may assess. */
  levels?: Array<{ code?: string | null; name?: string | null; mode?: string | null }> | null;
};

export type TeamMember = { assessorId?: string | null; name?: string | null; role?: string | null; email?: string | null; mobile?: string | null; userType?: number | null };

export type Spoc = { name?: string | null; designation?: string | null; email?: string | null; phone?: string | null; source?: string | null };

/** The server's stage of an assessment. */
export type Stage = 'scheduled' | 'inProgress' | 'submitted' | 'ncRound' | 'underReview' | 'certified' | 'rejected' | 'closed';

export type AssessmentSummary = {
  zedId: string;
  certificationType: string;
  /** 2026-11-14: the server the unit is allotted on (the surveillance one for a surveillance visit); absent = main. */
  system?: 'main' | 'surveillance';
  levelName?: string | null;
  enterpriseName?: string | null;
  unitName?: string | null;
  address?: string | null;
  district?: string | null;
  state?: string | null;
  pincode?: string | null;
  assessmentDate?: string | null;
  assessmentEndDate?: string | null;
  modeOfAssessment?: string | null;
  certificationStatus?: number | null;
  statusDate?: string | null;
  stage?: Stage | string | null;
  statusLabel?: string | null;
  ncRound?: number | null;
  ncAnswered?: boolean | null;
  openMeetingSubmitted?: boolean | null;
  /** SA/Assessment opens it (status 8 to 12, as SA/Login). */
  canOpen?: boolean | null;
  /** 1 Lead Assessor, 2 Assessor */
  userType?: number | null;
  /** "Lead" or "Co" */
  role?: string | null;
  team?: TeamMember[] | null;
  spoc?: Spoc | null;
  latitude?: string | null;
  longitude?: string | null;
};

export type SignInResponse = BaseServiceResponse & { appToken?: string | null; profile?: AssessorProfile | null; assessments?: AssessmentSummary[] | null };

export type AssessmentsResponse = BaseServiceResponse & { assessments?: AssessmentSummary[] | null };

export type AppNotification = {
  id: string;
  /** allotted, reminder, ncRaised, ncAnswered, certified, sentBack, rejected */
  type?: string | null;
  title: string;
  text?: string | null;
  zedId?: string | null;
  certificationType?: string | null;
  enterpriseName?: string | null;
  date?: string | null;
};

export type NotificationsResponse = BaseServiceResponse & { notifications?: AppNotification[] | null };

export type ReportSummary = {
  /** The certification record (a rejected or reset copy is ZEDMSME000123_D_45); baseZedId is the unit's ZED ID. */
  zedId: string;
  baseZedId?: string | null;
  certificationType: string;
  levelName?: string | null;
  enterpriseName?: string | null;
  district?: string | null;
  state?: string | null;
  assessmentDate?: string | null;
  statusDate?: string | null;
  stage?: string | null;
  statusLabel?: string | null;
  role?: string | null;
  team?: TeamMember[] | null;
  reportAvailable?: boolean | null;
  /** The PDF's address relative to the portal (GET with the app token). */
  reportPath?: string | null;
};

export type ReportsResponse = BaseServiceResponse & { reports?: ReportSummary[] | null };

/** The dashboard counts (as the server's): Upcoming = scheduled, Ongoing = in progress, Submitted = submitted, NC round or under review. */
export function counts(list: Array<{ stage?: string | null }>) {
  const by = (...stages: string[]) => list.filter(a => stages.includes(a.stage ?? 'scheduled')).length;
  return { total: list.length, upcoming: by('scheduled'), ongoing: by('inProgress'), submitted: by('submitted', 'ncRound', 'underReview') };
}

const LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  inProgress: 'In Progress',
  submitted: 'Submitted',
  ncRound: 'NC Round',
  underReview: 'Under Review',
  certified: 'Certified',
  rejected: 'Rejected',
  closed: 'Closed',
};

/** The server's label, else one from the stage. */
export const labelOf = (a: { stage?: string | null; statusLabel?: string | null }) => a.statusLabel || LABELS[a.stage ?? 'scheduled'] || 'Scheduled';

const STAGE_TONE: Record<string, 'info' | 'warning' | 'primary' | 'success' | 'neutral' | 'danger'> = {
  scheduled: 'neutral',
  // Blue: the app colour is orange, so an orange badge would not stand out.
  inProgress: 'info',
  submitted: 'primary',
  ncRound: 'warning',
  underReview: 'primary',
  certified: 'success',
  rejected: 'danger',
  closed: 'neutral',
};

export const toneOf = (stage: string | null | undefined) => STAGE_TONE[stage ?? 'scheduled'] ?? 'neutral';

/** The unit's name on cards: the enterprise, else the unit, else the ZED ID. */
export const nameOf = (a: { enterpriseName?: string | null; unitName?: string | null; zedId: string }) => a.enterpriseName || a.unitName || a.zedId;

export const keyOf = (a: { zedId: string; certificationType: string }) => `${a.zedId}|${a.certificationType}`;

/** Lead / co-assessor role text. */
export const roleOf = (userType: number | null | undefined) => (userType === 1 ? 'Lead Assessor' : 'Co Assessor');

/** A team member's role as the design writes it ("Lead" -> "Lead Assessor"). */
export const memberRole = (m: TeamMember) =>
  m.userType === 1 || m.role === 'Lead' ? 'Lead Assessor' : m.userType === 2 || m.role === 'Co' ? 'Co Assessor' : (m.role ?? '');

/** The requirements assessed on the phone: those with a conformance (or in a completed / submitted parameter). */
export function progressOf(d: AssessmentDetails | null | undefined) {
  let total = 0;
  let done = 0;
  for (const p of d?.allottedParameters ?? []) {
    if (!p) continue;
    const reqs = p.requirements ?? [];
    total += reqs.length;
    done += p.status === COMPLETED || p.status === SUBMITTED ? reqs.length : reqs.filter(r => r && !!r.conformance).length;
  }
  return { total, done, parameters: (d?.allottedParameters ?? []).filter(Boolean).length, ratio: total ? done / total : 0 };
}

/**
 * Work on the phone that the server does not have yet: a requirement answered or a parameter completed but not
 * synced, Basic Info or attendance captured offline. "Clean data" refuses while there is any (or while the sync queue,
 * the stored meetings, selfie or photos hold the unit's sends), so it never loses an assessor's work.
 */
export function hasUnsentWork(d: AssessmentDetails | null | undefined): boolean {
  if (!d) return false;
  for (const p of d.allottedParameters ?? []) {
    if (!p || p.status === SUBMITTED) continue;
    if (p.status === COMPLETED || (p.requirements ?? []).some(r => r && (!!r.conformance || !!r.comments || !!r.addedEvidences?.length || !!r.checkpointAnswers?.length)))
      return true;
  }
  if (d.saBasicInformation && !d.isBasicInfoSubmitted && d.saBasicInformation.status !== 'SUBMITTED') return true;
  return (d.attendanceData?.attendanceList ?? []).some(a => a && !a.isSubmitted);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** ISO or "MM/dd/yyyy[ hh:mm:ss a]" (the SA date of the legacy answer). */
export function parseDate(text: string | null | undefined): Date | null {
  if (!text) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?/.exec(text.trim());
  if (m) {
    let h = Number(m[4] ?? 0);
    if (m[7]) h = (h % 12) + (/p/i.test(m[7]) ? 12 : 0);
    return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]), h, Number(m[5] ?? 0), Number(m[6] ?? 0));
  }
  const d = new Date(text);
  return isNaN(d.getTime()) ? null : d;
}

const two = (n: number) => String(n).padStart(2, '0');

/** "04 May 2026" */
export function formatDate(text: string | null | undefined): string {
  const d = parseDate(text);
  return d ? `${two(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
}

/** "04 May 2026, 08:14" */
export function formatDateTime(text: string | null | undefined): string {
  const d = parseDate(text);
  return d ? `${formatDate(text)}, ${two(d.getHours())}:${two(d.getMinutes())}` : '';
}

/** "04 – 05 May 2026", "29 Apr – 02 May 2026", or the one date. */
export function formatRange(from: string | null | undefined, to: string | null | undefined): string {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a) return '';
  if (!b || b.toDateString() === a.toDateString()) return formatDate(from);
  if (a.getFullYear() !== b.getFullYear()) return `${formatDate(from)} – ${formatDate(to)}`;
  const left = a.getMonth() === b.getMonth() ? two(a.getDate()) : `${two(a.getDate())} ${MONTHS[a.getMonth()]}`;
  return `${left} – ${formatDate(to)}`;
}

/** "Pune, Maharashtra" */
export const placeOf = (a: { district?: string | null; state?: string | null }) => [a.district, a.state].filter(x => !!x && x.trim()).join(', ');

/** The fixed level chips of My assessments (codes); ZEDX is shown as ZED-X. */
export const BUILT_IN_LEVEL_FILTERS = ['Bronze', 'Silver', 'Gold', 'ZEDX'];

/**
 * The level chips of My assessments (2026-11-08, generic levels): All, Bronze, Silver, Gold and ZED-X, then every other
 * level code among the assessor's allotted units (a level the Admin added, e.g. PLATINUM), in the order they come. Each is
 * labelled with the server's level name of the allotment when known, else ZED-X / the code.
 */
export function levelFilters(assessments: AssessmentSummary[]): { code: string; label: string }[] {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const nameOf = (code: string) => assessments.find(a => same(a.certificationType?.trim() ?? '', code) && a.levelName?.trim())?.levelName?.trim();
  const codes = [...BUILT_IN_LEVEL_FILTERS];
  for (const a of assessments) {
    const code = a.certificationType?.trim();
    if (code && !codes.some(c => same(c, code))) codes.push(code);
  }
  return [
    { code: 'All', label: 'All' },
    ...codes.map(code => ({
      code,
      label: code === 'ZEDX' ? nameOf(code) || 'ZED-X' : BUILT_IN_LEVEL_FILTERS.includes(code) ? code : nameOf(code) || code,
    })),
  ];
}

/** Search of the assessment list: organisation, ZED ID or level. */
export function matches(a: AssessmentSummary, query: string, level: string): boolean {
  if (level !== 'All' && a.certificationType.trim().toLowerCase() !== level.toLowerCase()) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [a.enterpriseName, a.unitName, a.zedId, a.certificationType, a.levelName, a.district, a.state].some(v => (v ?? '').toLowerCase().includes(q));
}
