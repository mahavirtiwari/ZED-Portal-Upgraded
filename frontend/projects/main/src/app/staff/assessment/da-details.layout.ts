import { TrackerStep } from '../../msme/shared/step-tracker';
import { flag, num, text } from './assessment-shared';
import { Row } from './assessment.api';
import { shortDay } from './da-details.overview';

/**
 * 2026-11-17 (the user's staff design 14, "Assessment details"): what the desktop and site review pages show first, made from
 * the record's own columns only: the result chip, the five-step stage tracker and the non-conformance rounds with their dates.
 * Nothing is guessed: a step without its date is not ticked, "Certified" needs the server's IsCertified (status 6 with the
 * desktop certificate number, or 16), and a round is "Closed" only once a later round was raised or the assessment completed.
 */

export type UnitTone = 'good' | 'bad' | 'warn' | 'info';

export interface UnitResult {
  label: string;
  tone: UnitTone;
}

export interface NcLine {
  round: number;
  raised: string;
  replied: string;
  /** Open (the unit's reply awaited), Replied (awaiting the assessor), Closed; null when the record does not say. */
  state: 'Open' | 'Replied' | 'Closed' | null;
}

export interface UnitStage {
  steps: TrackerStep[];
  current: number;
}

/** The NC statuses of the desktop (4) and site (14) stages. */
const NC_OPEN = [4, 14];

function ncOpen(m: Row): boolean {
  return NC_OPEN.includes(num(m, 'CertificationStatus')) && num(m, 'NcCount') > 0;
}

function finished(m: Row): boolean {
  return !!text(m, 'CompletedOn') || flag(m, 'IsCertified');
}

/** The result chip beside the title. */
export function unitResult(m: Row): UnitResult {
  if (flag(m, 'IsCertified')) return { label: 'Certified', tone: 'good' };
  if (num(m, 'CertificationStatus') === 99 || flag(m, 'IsAutoReject')) return { label: 'Rejected', tone: 'bad' };
  if (ncOpen(m)) return { label: `NC ${num(m, 'NcCount')} open`, tone: 'warn' };
  if (text(m, 'CompletedOn')) return { label: 'Assessment completed', tone: 'info' };
  return { label: 'In progress', tone: 'info' };
}

/** The NC rounds raised (Nc1Raised..Nc5Raised), with the unit's reply date. */
export function ncLines(m: Row): NcLine[] {
  const count = num(m, 'NcCount');
  const out: NcLine[] = [];
  for (const i of [1, 2, 3, 4, 5]) {
    const raised = text(m, `Nc${i}Raised`);
    if (!raised) continue;
    const replied = text(m, `Nc${i}Submitted`);
    const open = i === count && ncOpen(m);
    out.push({ round: i, raised: shortDay(raised), replied: shortDay(replied), state: open ? (replied ? 'Replied' : 'Open') : i < count || finished(m) ? 'Closed' : null });
  }
  return out;
}

function ncStep(m: Row): { step: TrackerStep; done: boolean } {
  const n = num(m, 'NcCount');
  const open = ncOpen(m);
  const done = !open && (n > 0 || finished(m));
  const note = n > 0 ? `${open ? n - 1 : n} of ${n}` : done ? 'None raised' : null;
  return { step: { label: 'NCs closed', note }, done };
}

function stage(parts: { step: TrackerStep; done: boolean }[]): UnitStage {
  const first = parts.findIndex((p) => !p.done);
  return { steps: parts.map((p) => p.step), current: first < 0 ? parts.length : first };
}

// 2026-11-18 (staff-14a): the steps' dates short ("13 Nov 2026").
const dated = (label: string, date: string) => ({ step: { label, note: shortDay(date) || null }, done: !!date });

/** Desktop: documents submitted, allotted, NCs closed, verified, certified. */
export function desktopStage(m: Row): UnitStage {
  const certified = flag(m, 'IsCertified');
  return stage([
    dated('Documents submitted', text(m, 'BasicInfoStatus')),
    dated('Allotted', text(m, 'DocVerifiAllot')),
    ncStep(m),
    dated('Verified', text(m, 'CompletedOn')),
    { step: { label: 'Certified', note: certified ? shortDay(text(m, 'CertificationStatusDate')) || null : null }, done: certified },
  ]);
}

/** Site: documents submitted, desktop verified, site visit (its date), NCs closed, certified. */
export function siteStage(m: Row): UnitStage {
  const certified = flag(m, 'IsCertified');
  const visited = num(m, 'NcCount') > 0 || finished(m) || [14, 15, 16].includes(num(m, 'CertificationStatus'));
  return stage([
    dated('Documents submitted', text(m, 'BasicInfoStatus')),
    dated('Desktop verified', text(m, 'DesktopVerificationCompleted')),
    { step: { label: 'Site visit', note: shortDay(text(m, 'AssessmentDate')) || null }, done: visited },
    ncStep(m),
    { step: { label: 'Certified', note: text(m, 'CompletedOn') ? `Completed ${shortDay(text(m, 'CompletedOn'))}` : null }, done: certified },
  ]);
}

/** "AGENCY1 - Agency One" (either part when the other is missing). */
export function idName(m: Row, id: string, name: string): string {
  return [text(m, id), text(m, name)].filter(Boolean).join(' - ');
}

/**
 * The layout of the redesigned review pages: the tabs as one white bar of pills, the main column and the right rail (the
 * quality observations, the submission checklists) from 1200 px, the cards, the fact grid and the NC lines.
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files', the new staff-14 series): the tab bar is a white card (radius
 * 14, 52px) whose tabs are 36px pills (13.5/500 #17373b; the active one #24666b, white 700) with grey count pills, beating the
 * old teal .zed-tabs band; the tab content is no longer an outer white card; main and rail 16px apart, the rail 328px and as
 * tall as its content (no scrollbar of its own); the facts four to a row.
 */
export const UNIT_VIEW_STYLES = `
  .zed-tabs .uv-tabs.nav.nav-tabs { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; background: #fff; border: 1px solid #dde7e8;
    border-radius: 14px; padding: 7px; margin: 0 0 16px; box-shadow: 0 3px 10px rgba(0, 0, 0, 0.09); }
  .zed-tabs .uv-tabs.nav.nav-tabs > li > .nav-link { display: inline-flex; align-items: center; gap: 8px; min-height: 36px; opacity: 1; border: 0 !important;
    border-radius: 9px !important; padding: 0 14px; margin: 0; color: #17373b; font-size: 13.5px !important; font-weight: 500; background: none; white-space: nowrap; }
  .zed-tabs .uv-tabs.nav.nav-tabs > li > .nav-link:hover { background: #f2f8f7; color: #17373b; }
  .zed-tabs .uv-tabs.nav.nav-tabs > li > .nav-link.active { background: #24666b !important; color: #fff !important; font-weight: 700; }
  .zed-tabs .uv-tabs .nav-link::after { display: none !important; }
  .uv-tab-n { display: inline-block; padding: 2px 9px; border-radius: 11px; background: #ecf0f0; color: #6f8487; font-size: 10.5px; font-weight: 700; line-height: 18px; }
  .nav-link.active .uv-tab-n { background: #3f8a90; color: #fff; }
  .uv-tabs .uv-meta { margin-left: auto; padding: 0 8px; font-size: 12.5px; font-weight: 500; color: #6f8487; }
  .zed-tabs .tab-content.uv-main { background: transparent; border: 0; border-radius: 0; padding: 0; }
  .uv-grid { display: block; }
  .uv-main, .uv-rail { min-width: 0; }
  @media (min-width: 1200px) {
    .uv-grid.uv-has-rail { display: grid; grid-template-columns: minmax(0, 1fr) 328px; gap: 16px; align-items: start; }
  }
  .uv-card { background: #fff; border: 1px solid #dde7e8; border-radius: 14px; box-shadow: 0 3px 10px rgba(0, 0, 0, 0.09); margin: 0 0 16px; overflow: hidden; }
  .uv-card-head { display: flex; align-items: center; gap: 12px; padding: 13px 20px; border-bottom: 1px solid #edf2f2; }
  .uv-card-head h4 { margin: 0; font-size: 16px; font-weight: 700; color: #17373b; }
  .uv-card-head .uv-link { margin-left: auto; font-size: 13px; font-weight: 700; color: #24666b; text-decoration: none; background: none; border: 0; padding: 0; }
  .uv-ico { flex: none; width: 30px; height: 30px; border-radius: 8px; background: #e6f2f3; display: grid; place-items: center; color: #24666b; }
  .uv-ico svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .uv-facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px 24px; margin: 0; padding: 18px 24px; }
  .uv-facts .fact { min-width: 0; }
  .uv-facts .fact.wide { grid-column: 1 / -1; display: flex; align-items: baseline; gap: 28px; border-top: 1px solid #edf2f2; padding-top: 14px; }
  .uv-facts dt { font-size: 10px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: #6f8487; margin: 0 0 6px; }
  .uv-facts dd { margin: 0; font-size: 14px; font-weight: 500; color: #17373b; overflow-wrap: anywhere; }
  .uv-facts dd small { margin-left: 14px; font-size: 12px; color: #6f8487; }
  .uv-facts .loc { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; }
  @media (max-width: 991.98px) { .uv-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 479.98px) { .uv-facts { grid-template-columns: minmax(0, 1fr); } .uv-facts .fact.wide { display: block; } }
  .uv-ncs { list-style: none; margin: 0; padding: 8px 20px 12px; }
  .uv-ncs li { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; padding: 6px 0; }
  .uv-ncs li + li { border-top: 1px solid #f1f5f5; }
  .uv-ncs b { min-width: 44px; color: #17373b; }
  .uv-ncs .d { flex: 1; min-width: 0; font-size: 12.5px; color: #3d5559; }
  .uv-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; border-radius: 11px;
    padding: 3px 10px; background: #ecf0f0; color: #6f8487; white-space: nowrap; }
  .uv-chip.good { background: #e5f5ea; color: #2f9e58; }
  .uv-chip.warn { background: #fdf2dc; color: #9a5f06; }
  .uv-chip.bad { background: #fbe9e7; color: #c8473c; }
  .uv-chip.info { background: #e6f2f3; color: #24666b; }
  .uv-chip.good::before { content: '\\2713'; }
  .uv-result { align-self: center; }
  .uv-tracker { display: block; margin-bottom: 16px; padding: 18px 20px 14px; background: #fff; border: 1px solid #dde7e8; border-radius: 14px; box-shadow: 0 3px 10px rgba(0, 0, 0, 0.09); }
  .locations { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0 16px; }
  .locations .sub-heading { grid-column: 1 / -1; }
  .map-link { display: inline-flex; align-items: center; gap: 4px; font-weight: 700; color: #24666b; text-decoration: none; }
  .map-link:hover { color: #1b4f53; text-decoration: underline; }
`;
