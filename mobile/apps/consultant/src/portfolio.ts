/**
 * New in the redesign: the consultant signs in once (consultant ID + password) and sees all the handholding cases
 * allotted to them, each at its current milestone; one unit is opened at a time and kept as before (AssessorData row
 * per consultant + unit). Shapes of the Consultancy host's SA/SignIn, SA/Assessments, SA/Notifications and SA/Reports
 * (docs/MOBILE-API.md), the same as the site assessor app's plus the milestones. Dates are ISO text in server time.
 */
import type { BaseServiceResponse } from '@zed/shared';

export type AssessorProfile = {
  assessorId: string;
  name?: string | null;
  email?: string | null;
  mobile?: string | null;
  /** Users.AssessorType of the consultant. */
  assessorType?: string | null;
  certificateNo?: string | null;
  sectorActivity?: string | null;
  /** The consultant's organisation (the consultancy firm managing the consultant). */
  agencyId?: string | null;
  agencyName?: string | null;
  /** The organisation's contact (Help page). */
  agencyEmail?: string | null;
  agencyMobile?: string | null;
  /** The certification levels (when the server lists them). */
  levels?: Array<{ code?: string | null; name?: string | null; mode?: string | null }> | null;
};

export type TeamMember = { assessorId?: string | null; name?: string | null; role?: string | null; email?: string | null; mobile?: string | null; userType?: number | null };

export type Spoc = { name?: string | null; designation?: string | null; email?: string | null; phone?: string | null; source?: string | null };

/** The server's stage of an assessment. */
export type Stage = 'scheduled' | 'inProgress' | 'submitted' | 'sentBack' | 'underReview' | 'completed' | 'rejected' | 'closed';

export type AssessmentSummary = {
  zedId: string;
  certificationType: string;
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
  /** 1 Lead Consultant, 2 Consultant */
  userType?: number | null;
  /** "Lead" or "Co" */
  role?: string | null;
  team?: TeamMember[] | null;
  spoc?: Spoc | null;
  latitude?: string | null;
  longitude?: string | null;
  /** The case's current milestone (1-4) and every milestone with its state. */
  milestone?: number | null;
  milestones?: MilestoneInfo[] | null;
};

export type MilestoneInfo = { no: number; status?: 'done' | 'current' | 'locked' | string | null; label?: string | null };

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
  /** The milestone of the report and its label. */
  milestone?: number | null;
  milestoneLabel?: string | null;
  reportAvailable?: boolean | null;
  /** The PDF's address relative to the portal (GET with the app token). */
  reportPath?: string | null;
};

export type ReportsResponse = BaseServiceResponse & { reports?: ReportSummary[] | null };

/** The dashboard counts (as the server's): Upcoming = scheduled, Ongoing = in progress or sent back, Submitted = submitted or under review. */
export function counts(list: Array<{ stage?: string | null }>) {
  const by = (...stages: string[]) => list.filter(a => stages.includes(a.stage ?? 'scheduled')).length;
  return { total: list.length, upcoming: by('scheduled'), ongoing: by('inProgress', 'sentBack'), submitted: by('submitted', 'underReview') };
}

/** The stages of a milestone still being worked on (the case list's "Active"). */
export const ACTIVE_STAGES = ['scheduled', 'inProgress', 'sentBack'];

const LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  inProgress: 'In Progress',
  submitted: 'Submitted',
  sentBack: 'Sent Back',
  underReview: 'Under Review',
  completed: 'Completed',
  rejected: 'Rejected',
  closed: 'Closed',
};

/** The server's label, else one from the stage. */
export const labelOf = (a: { stage?: string | null; statusLabel?: string | null }) => a.statusLabel || LABELS[a.stage ?? 'scheduled'] || 'Scheduled';

const STAGE_TONE: Record<string, 'info' | 'warning' | 'primary' | 'success' | 'neutral' | 'danger'> = {
  scheduled: 'info',
  inProgress: 'warning',
  submitted: 'primary',
  sentBack: 'danger',
  underReview: 'primary',
  completed: 'success',
  rejected: 'danger',
  closed: 'neutral',
};

export const toneOf = (stage: string | null | undefined) => STAGE_TONE[stage ?? 'scheduled'] ?? 'neutral';

/** The unit's name on cards: the enterprise, else the unit, else the ZED ID. */
export const nameOf = (a: { enterpriseName?: string | null; unitName?: string | null; zedId: string }) => a.enterpriseName || a.unitName || a.zedId;

export const keyOf = (a: { zedId: string; certificationType: string }) => `${a.zedId}|${a.certificationType}`;

/** Lead / co-consultant role text (AssessmentDetails.userType: 1 Lead Consultant, 2 Consultant). */
export const roleOf = (userType: number | null | undefined) => (userType === 1 ? 'Lead Consultant' : 'Co-consultant');

/** A team member's role as the design writes it ("Lead" -> "Lead Consultant"). */
export const memberRole = (m: TeamMember) =>
  m.userType === 1 || m.role === 'Lead' ? 'Lead Consultant' : m.userType === 2 || m.role === 'Co' ? 'Co-consultant' : (m.role ?? '');

/** The milestones of a case as the server lists them, else the current one alone (an older server). */
export function milestonesOf(a: AssessmentSummary): MilestoneInfo[] {
  if (a.milestones?.length) return a.milestones;
  return a.milestone ? [{ no: a.milestone, status: 'current' }] : [];
}

/** "Milestone 2", "Technology Upgradation" for the fourth (the server's name of the milestone goes beside it). */
export const milestoneLabel = (no: number | null | undefined) => (no === 4 ? 'Technology Upgradation' : `Milestone ${no ?? 1}`);

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

/** Search of the case list: organisation, ZED ID or level. */
export function matches(a: AssessmentSummary, query: string, level: string): boolean {
  if (level !== 'All' && a.certificationType.trim().toLowerCase() !== level.toLowerCase()) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [a.enterpriseName, a.unitName, a.zedId, a.certificationType, a.levelName, a.district, a.state].some(v => (v ?? '').toLowerCase().includes(q));
}
