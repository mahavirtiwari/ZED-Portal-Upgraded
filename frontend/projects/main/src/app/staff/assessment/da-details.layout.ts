import { TrackerStep } from '../../msme/shared/step-tracker';
import { flag, num, text } from './assessment-shared';
import { Row } from './assessment.api';

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
    out.push({ round: i, raised, replied, state: open ? (replied ? 'Replied' : 'Open') : i < count || finished(m) ? 'Closed' : null });
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

const dated = (label: string, date: string) => ({ step: { label, note: date || null }, done: !!date });

/** Desktop: documents submitted, allotted, NCs closed, verified, certified. */
export function desktopStage(m: Row): UnitStage {
  const certified = flag(m, 'IsCertified');
  return stage([
    dated('Documents submitted', text(m, 'BasicInfoStatus')),
    dated('Allotted', text(m, 'DocVerifiAllot')),
    ncStep(m),
    dated('Verified', text(m, 'CompletedOn')),
    { step: { label: 'Certified' }, done: certified },
  ]);
}

/** Site: documents submitted, desktop verified, site visit (its date), NCs closed, certified. */
export function siteStage(m: Row): UnitStage {
  const certified = flag(m, 'IsCertified');
  const visited = num(m, 'NcCount') > 0 || finished(m) || [14, 15, 16].includes(num(m, 'CertificationStatus'));
  return stage([
    dated('Documents submitted', text(m, 'BasicInfoStatus')),
    dated('Desktop verified', text(m, 'DesktopVerificationCompleted')),
    { step: { label: 'Site visit', note: text(m, 'AssessmentDate') || null }, done: visited },
    ncStep(m),
    { step: { label: 'Certified', note: text(m, 'CompletedOn') ? `Completed ${text(m, 'CompletedOn')}` : null }, done: certified },
  ]);
}

/** "AGENCY1 - Agency One" (either part when the other is missing). */
export function idName(m: Row, id: string, name: string): string {
  return [text(m, id), text(m, name)].filter(Boolean).join(' - ');
}

/**
 * The layout of the redesigned review pages: the tabs as one white bar of pills, the main column and the right rail (the
 * quality observations, the submission checklists) from 1200 px, the cards, the 3-column fact grid and the NC lines.
 */
export const UNIT_VIEW_STYLES = `
  .uv-tabs.nav-tabs { display: flex; flex-wrap: wrap; gap: 4px; background: #fff; border: 1px solid #e1eaea; border-radius: 12px; padding: 7px;
    margin: 0 0 16px; box-shadow: 0 2px 8px rgba(16, 61, 64, 0.05); }
  .uv-tabs .nav-link { border: 0 !important; border-radius: 8px !important; padding: 8px 16px; margin: 0; color: var(--zt-ink, #173f44); font-weight: 600;
    background: none; white-space: nowrap; }
  .uv-tabs .nav-link:hover { background: #f2f8f7; }
  .uv-tabs .nav-link.active { background: var(--zt-dark, #1f5c61) !important; color: #fff !important; }
  .uv-grid { display: block; }
  .uv-main, .uv-rail { min-width: 0; }
  @media (min-width: 1200px) {
    .uv-grid.uv-has-rail { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 20px; align-items: start; }
    .uv-has-rail .uv-rail { position: sticky; top: 12px; max-height: calc(100vh - 24px); overflow-y: auto; }
  }
  .uv-card { background: #fff; border: 1px solid #e1eaea; border-radius: 12px; box-shadow: 0 2px 8px rgba(16, 61, 64, 0.05); margin: 0 0 16px; overflow: hidden; }
  .uv-card-head { display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-bottom: 1px solid #edf2f2; }
  .uv-card-head h4 { margin: 0; font-size: 16px; font-weight: 700; color: var(--zt-ink, #173f44); }
  .uv-ico { flex: none; width: 30px; height: 30px; border-radius: 8px; background: #eef6f5; display: grid; place-items: center; color: var(--zt-dark, #1f5c61); }
  .uv-ico svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .uv-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px 24px; margin: 0; padding: 18px 20px; }
  .uv-facts .fact { min-width: 0; }
  .uv-facts .fact.wide { grid-column: 1 / -1; border-top: 1px solid #edf2f2; padding-top: 14px; }
  .uv-facts dt { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #5f6f70; margin: 0 0 4px; }
  .uv-facts dd { margin: 0; font-size: 14.5px; color: #1b2a2c; overflow-wrap: anywhere; }
  .uv-facts .loc { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; }
  @media (max-width: 767.98px) { .uv-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 479.98px) { .uv-facts { grid-template-columns: minmax(0, 1fr); } }
  .uv-ncs { list-style: none; margin: 0; padding: 8px 20px 12px; }
  .uv-ncs li { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; padding: 6px 0; }
  .uv-ncs li + li { border-top: 1px solid #f1f5f5; }
  .uv-ncs b { min-width: 44px; color: var(--zt-ink, #173f44); }
  .uv-ncs .d { flex: 1; min-width: 0; font-size: 13.5px; color: #3d4f50; }
  .uv-chip { display: inline-block; font-size: 11.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; border-radius: 12px; padding: 3px 10px;
    background: #eef2f2; color: #3d4f50; white-space: nowrap; }
  .uv-chip.good { background: #e3f4e8; color: #1e7d43; }
  .uv-chip.warn { background: #fdf3e1; color: #8a5a00; }
  .uv-chip.bad { background: #fdecec; color: #a32d2d; }
  .uv-chip.info { background: #e6f2f3; color: var(--zt-dark, #1f5c61); }
  .uv-result { align-self: center; font-size: 12.5px; padding: 6px 12px; }
  .uv-tracker { margin-bottom: 16px; }
  .locations { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0 16px; }
  .locations .sub-heading { grid-column: 1 / -1; }
  .map-link { font-weight: 600; color: #fff; background: var(--zt-dark, #1f5c61); border-radius: 4px; padding: 1px 9px; text-decoration: none; }
  .map-link:hover { color: #fff; background: var(--zt-ink, #173f44); }
`;
