import { CertificationKind, Row, certificationKind, certificationLevel, milestoneNumber } from './certification.api';
import { levelMode } from '../shared/levels';

/**
 * 2026-11-17 (the user's applicant design, zed-msme-01): the progress tracker and the application timeline of a
 * certification, read from the MsmeHistory descriptions the API gives (ApplicationReceived, BasicInfoStatus, Nc1Raised, ...).
 * The descriptions carry their own dates ("Submitted on May 2, 2024", "Certificate & Report generated on November 14, 2026");
 * nothing else is invented.
 */

/** Who acted: ZED (the assessors, the portal) or YOU (the applicant). */
export type Actor = 'ZED' | 'YOU';

/** A description of a status type, or '' when the old page's ng-show would have hidden it (null, empty, 0, false). */
export function statusText(status: Row, field: string): string {
  const v = status[field];
  return v === null || v === undefined || v === '' || v === 0 || v === false ? '' : String(v).trim();
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function month(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase());
}

/**
 * The date in a description as "14 Nov 2026" and the words around it ("Submitted on May 2, 2024" → { date: '2 May 2024',
 * rest: 'Submitted' }); no date: { date: '', rest: text }.
 */
export function splitDate(text: string): { date: string; rest: string } {
  const patterns: [RegExp, (m: RegExpExecArray) => [number, number, string]][] = [
    [/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/, (m) => [month(m[1]), Number(m[2]), m[3]]],
    [/(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/, (m) => [month(m[2]), Number(m[1]), m[3]]],
    [/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/, (m) => [Number(m[2]) - 1, Number(m[1]), m[3]]],
  ];
  for (const [re, read] of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    const [mo, day, year] = read(m);
    if (mo < 0 || mo > 11 || day < 1 || day > 31) continue;
    const before = text.slice(0, m.index).replace(/\s*(\bon\b|:|-)?\s*$/i, '');
    const after = text.slice(m.index + m[0].length).trim();
    return { date: `${day} ${SHORT[mo]} ${year}`, rest: [before, after].filter((x) => x).join(' ').trim() };
  }
  return { date: '', rest: text };
}

/** A description that means the step is done: it has a date, or says something other than "In-progress" / "Pending". */
function done(text: string): boolean {
  return !!text && (!!splitDate(text).date || !/progress|pending/i.test(text));
}

export interface TrackerStepDef {
  label: string;
  note: string | null;
}

interface StepRule {
  label: string;
  /** Any of these done marks the step done. */
  done: string[];
  /** Shown under a step not done yet (e.g. "Scheduled on …"). */
  note?: string[];
  incentives?: boolean;
}

export interface ProgressOptions {
  kind: CertificationKind;
  milestone: number;
  /** The level's flow has a desktop step (not Remote only / Onsite only). */
  hasDesktop: boolean;
  /** The level has a site visit (not a desktop-only level). */
  hasSite: boolean;
  /** "Remote assessment", "Onsite assessment" or "Remote/onsite assessment". */
  siteTitle: string;
}

/**
 * The steps of a certification type: the level's flow (Admin → Certification Levels, 2026-11-14) decides whether there is a
 * desktop step (not Remote only / Onsite only) and what the site step is called; a desktop-only level has no site step.
 */
export function progressOptions(certification: string, flow: string | null | undefined): ProgressOptions {
  const f = flow ?? null;
  return {
    kind: certificationKind(certification),
    milestone: milestoneNumber(certification),
    hasDesktop: f !== 'Remote' && f !== 'Onsite',
    hasSite: levelMode(certificationLevel(certification)) !== 'Desktop',
    siteTitle: f === 'Remote' || f === 'DesktopRemote' ? 'Remote assessment' : f === 'Onsite' || f === 'DesktopOnsite' ? 'Onsite assessment' : 'Remote/onsite assessment',
  };
}

function rules(o: ProgressOptions): StepRule[] {
  const received: StepRule = { label: 'Application received', done: ['ApplicationReceived'] };
  const info: StepRule = { label: 'Information & documents', done: ['BasicInfoStatus'] };
  const certified: StepRule = { label: 'Certified', done: ['GetCertified'] };
  const incentives: StepRule = { label: 'Avail incentives', done: [], incentives: true };
  switch (o.kind) {
    case 'bronze':
      return [received, info, { label: 'Desktop verification', done: ['BronzeDesktopVerification', 'CompletedOn'] }, certified, incentives];
    case 'silverGold': {
      const list = [received, info];
      if (o.hasDesktop) list.push({ label: 'Desktop verification', done: o.hasSite ? ['DesktopVerification'] : ['DesktopVerification', 'CompletedOn'] });
      if (o.hasSite) list.push({ label: o.siteTitle, done: ['CompletedOn'], note: ['ScheduledOn'] });
      return [...list, certified, incentives];
    }
    case 'surveillance':
      return [received, { label: 'Surveillance assessment', done: ['CompletedOn'], note: ['ScheduledOn'] }, certified, incentives];
    case 'milestone':
      return [
        { label: 'Consulting organisation allocated', done: ['AllocationCompleted'] },
        { label: `Milestone ${o.milestone}`, done: ['SubmittedByConsultant'], note: ['BdsScheduledOn'] },
        { label: 'Accepted by you', done: ['ApplicantAcceptedOn'] },
      ];
  }
}

/** The tracker's steps and the 0-based current one (past the last when every step is done). */
export function progressSteps(status: Row, o: ProgressOptions): { steps: TrackerStepDef[]; current: number } {
  const list = rules(o);
  const isDone = list.map((r) => r.done.some((f) => done(statusText(status, f))));
  const current = isDone.lastIndexOf(true) + 1;
  const steps = list.map((r, i) => {
    const texts = [...r.done, ...(r.note ?? [])].map((f) => statusText(status, f)).filter((t) => t);
    const reached = i < current;
    const doneText = r.done.map((f) => statusText(status, f)).find((t) => done(t)) ?? '';
    let note: string | null = null;
    if (reached) note = splitDate(doneText).date || null;
    else if (texts.length) {
      const { date, rest } = splitDate(texts[texts.length - 1]);
      note = [rest, date].filter((x) => x).join(' ') || null;
    } else if (i === current && r.incentives) note = 'Your next step';
    return { label: r.label, note };
  });
  return { steps, current };
}

/** One line of the timeline. */
export interface TimelineEntry {
  date: string;
  title: string;
  /** The description without its date ("Certificate & Report generated"); '' when it only repeated the title. */
  note: string;
  who: Actor;
}

/** One NC round of the non-conformance block. */
export interface NcRound {
  round: number;
  raised: string;
  submitted: string;
  /** NcClosed and this is the last round raised. */
  closed: boolean;
}

/** The non-conformances, grouped in one block. */
export interface NcBlock {
  date: string;
  rounds: NcRound[];
  responded: number;
  closed: boolean;
  /** "14 Dec 2026", or the description as given. */
  finalClosure: string;
}

export type TimelineItem = { kind: 'entry'; entry: TimelineEntry } | { kind: 'nc'; nc: NcBlock };

function entry(status: Row, field: string, title: string, who: Actor): TimelineItem[] {
  const text = statusText(status, field);
  if (!text) return [];
  const { date, rest } = splitDate(text);
  const note = rest.toLowerCase() === title.toLowerCase() ? '' : rest;
  return [{ kind: 'entry', entry: { date, title, note, who } }];
}

/** The NC rounds raised (Nc1Raised … Nc5Raised), or null when no NC was raised. */
export function ncBlock(status: Row): NcBlock | null {
  const rounds: NcRound[] = [];
  for (let n = 1; n <= 5; n++) {
    const raised = statusText(status, `Nc${n}Raised`);
    if (raised) rounds.push({ round: n, raised, submitted: statusText(status, `Nc${n}Submitted`), closed: false });
  }
  if (!rounds.length) return null;
  const closed = !!statusText(status, 'NcClosed');
  if (closed) rounds[rounds.length - 1].closed = true;
  const final = statusText(status, 'NcFinalClosureDate');
  return {
    date: splitDate(rounds[0].raised).date,
    rounds,
    responded: rounds.filter((r) => r.submitted).length,
    closed,
    finalClosure: splitDate(final).date || final,
  };
}

/** The timeline, newest first (the descriptions in the order of the process, reversed). */
export function timelineItems(status: Row, o: ProgressOptions): TimelineItem[] {
  const e = (field: string, title: string, who: Actor = 'ZED') => entry(status, field, title, who);
  const nc = ncBlock(status);
  const ncPart: TimelineItem[] = [...(nc ? [{ kind: 'nc' as const, nc }] : []), ...e('NcClosed', 'Non-conformances closed'), ...e('CompletedOn', 'Assessment completed')];
  const received = e('ApplicationReceived', o.kind === 'surveillance' ? 'Application received for surveillance assessment' : 'Application received', 'YOU');
  const info = e('BasicInfoStatus', 'Basic information & documents', 'YOU');
  const certified = e('GetCertified', 'Certificate & report generated');
  let list: TimelineItem[];
  switch (o.kind) {
    case 'bronze':
      list = [...received, ...info, ...e('BronzeDesktopVerification', 'Desktop verification'), ...ncPart, ...certified];
      break;
    case 'silverGold':
      list = [...received, ...info, ...(o.hasDesktop ? e('DesktopVerification', 'Desktop verification') : []), ...e('ScheduledOn', o.siteTitle), ...ncPart, ...certified];
      break;
    case 'surveillance':
      list = [...received, ...e('ScheduledOn', 'Surveillance assessment'), ...ncPart, ...certified];
      break;
    case 'milestone':
      list = [
        ...e('AllocationCompleted', 'Allocation of consulting organisation'),
        ...e('BdsScheduledOn', `Milestone ${o.milestone}`),
        ...(o.milestone === 1 ? e('HapScheduledOn', `Milestone ${o.milestone}`) : []),
        ...e('SubmittedByConsultant', 'Submitted by the consultant'),
        ...e('ApplicantAcceptedOn', 'Accepted by you', 'YOU'),
      ];
      break;
  }
  return list.reverse();
}
