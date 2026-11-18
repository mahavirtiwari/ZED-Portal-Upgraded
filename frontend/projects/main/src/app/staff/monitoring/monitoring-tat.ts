import { Row } from './monitoring.api';

/**
 * 2026-11-18 (approved monitoring design, the user's decisions "TAT and monitoring"): the sub-sections, chips and delays of the
 * monitoring page (Assessment, Handholding, Surveillance), as the API gives them per row (Track, Step, SubmissionPending,
 * TatBucket, TatLabel, ...; Zed.Portal MonitoringInsights).
 */

export type MonitoringSystem = 'main' | 'consultancy' | 'surveillance';

export interface TrackTab {
  key: string;
  label: string;
}

/** The sub-sections of a stage: Desktop / Site assessment; on Consultancy all milestones or one. */
export function trackTabs(system: MonitoringSystem): TrackTab[] {
  return system === 'consultancy'
    ? [{ key: 'all', label: 'All milestones' }, { key: 'm1', label: 'Milestone 1' }, { key: 'm2', label: 'Milestone 2' }, { key: 'm3', label: 'Milestone 3' }]
    : [{ key: 'desktop', label: 'Desktop assessment' }, { key: 'site', label: 'Site assessment' }];
}

/** The row's sub-section: the API's Track, else from its status (below 8 desktop) or milestone (NcCount). */
export function trackOf(r: Row, system: MonitoringSystem): string {
  const t = r['Track'];
  if (typeof t === 'string' && t) return t;
  if (system === 'consultancy') return `m${Math.max(1, Number(r['NcCount'] ?? 1) || 1)}`;
  return Number(r['CertificationStatus'] ?? 0) < 8 ? 'desktop' : 'site';
}

/** What the date range means on each stage. */
export const DATE_LABELS: Record<number, string> = {
  2: 'Allotted between',
  3: 'Assessment between',
  5: 'Submitted between',
  4: 'NC raised between',
  7: 'Rejected between',
};

/** Where a site assessment in progress is (the app's records), in order, and the overlay chip from the man-days. */
export const PENDING = 'pending';

export function stepChips(system: MonitoringSystem): TrackTab[] {
  return system === 'consultancy'
    ? [{ key: 'distributed', label: 'Consultants allotted' }, { key: 'opening', label: 'Opening meeting conducted' }, { key: 'submitted', label: 'Submitted by the consultant' }]
    : [
        { key: 'distributed', label: 'Parameters distributed' },
        { key: 'opening', label: 'Opening meeting conducted' },
        { key: 'submitted', label: 'Assessment submitted through mobile app' },
        { key: PENDING, label: 'Submission pending through mobile app' },
      ];
}

/** The steps shown on a row (the pending chip is not a step). */
export const STEP_ORDER = ['distributed', 'opening', 'submitted'] as const;

export function stepLabels(system: MonitoringSystem): Record<string, string> {
  return system === 'consultancy'
    ? { distributed: 'Consultants allotted', opening: 'Opening meeting', submitted: 'Submitted' }
    : { distributed: 'Parameters distributed', opening: 'Opening meeting', submitted: 'Submitted (app)' };
}

/** A step of the row: done (green), current (amber) or to do (grey). */
export function stepState(current: unknown, step: string): 'done' | 'current' | 'todo' {
  const at = STEP_ORDER.indexOf(String(current ?? '') as (typeof STEP_ORDER)[number]);
  const i = STEP_ORDER.indexOf(step as (typeof STEP_ORDER)[number]);
  return at < 0 ? 'todo' : i < at ? 'done' : i === at ? 'current' : 'todo';
}

/** The delay chips of the quality check (TatEvaluator buckets). */
export const DELAY_CHIPS: TrackTab[] = [
  { key: 'on-time', label: 'On time' },
  { key: 'lt1', label: 'Delayed less than 1 day' },
  { key: '1-5', label: '1–5 days' },
  { key: '5-10', label: '5–10 days' },
  { key: 'gt10', label: 'More than 10 days' },
];

/** The row's highlight by delay: amber edge under 1 day, orange 1–5, red 5–10, red with a tint over 10. */
export function delayClass(r: Row): string {
  switch (r['TatBucket']) {
    case 'lt1': return 'mo-d1';
    case '1-5': return 'mo-d2';
    case '5-10': return 'mo-d3';
    case 'gt10': return 'mo-d4';
    default: return '';
  }
}

/** Days left (negative = late) from the TAT, else null. */
export function tatDaysLeft(r: Row): number | null {
  const h = r['TatLateHours'];
  return typeof h === 'number' ? -h / 24 : null;
}
