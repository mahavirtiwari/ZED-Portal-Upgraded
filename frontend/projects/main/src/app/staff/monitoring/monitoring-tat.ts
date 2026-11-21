import { Row } from './monitoring.api';
import { t } from '../../content/page-text';

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
    ? [
        { key: 'all', label: t('staff.monitoring.track.all.label', 'All milestones') },
        { key: 'm1', label: t('staff.monitoring.track.m1.label', 'Milestone 1') },
        { key: 'm2', label: t('staff.monitoring.track.m2.label', 'Milestone 2') },
        { key: 'm3', label: t('staff.monitoring.track.m3.label', 'Milestone 3') },
      ]
    : [
        { key: 'desktop', label: t('staff.monitoring.track.desktop.label', 'Desktop assessment') },
        { key: 'site', label: t('staff.monitoring.track.site.label', 'Site assessment') },
      ];
}

/** The row's sub-section: the API's Track, else from its status (below 8 desktop) or milestone (NcCount). */
export function trackOf(r: Row, system: MonitoringSystem): string {
  const track = r['Track'];
  if (typeof track === 'string' && track) return track;
  if (system === 'consultancy') return `m${Math.max(1, Number(r['NcCount'] ?? 1) || 1)}`;
  return Number(r['CertificationStatus'] ?? 0) < 8 ? 'desktop' : 'site';
}

/** What the date range means on each stage. */
export function dateLabel(status: number | null, system: MonitoringSystem = 'main'): string {
  switch (status) {
    case 2: return t('staff.monitoring.range.allotted.label', 'Allotted between');
    // 2026-11-21 (UI audit): handholding on Consultancy.
    case 3: return system === 'consultancy'
      ? t('staff.monitoring.range.consultancy.label', 'Handholding between')
      : t('staff.monitoring.range.assessment.label', 'Assessment between');
    case 5: return t('staff.monitoring.range.submitted.label', 'Submitted between');
    case 4: return t('staff.monitoring.range.ncRaised.label', 'NC raised between');
    case 7: return t('staff.monitoring.range.rejected.label', 'Rejected between');
    default: return t('staff.monitoring.range.between.label', 'Between');
  }
}

/** Where a site assessment in progress is (the app's records), in order, and the overlay chip from the man-days. */
export const PENDING = 'pending';

export function stepChips(system: MonitoringSystem): TrackTab[] {
  return system === 'consultancy'
    ? [
        { key: 'distributed', label: t('staff.monitoring.stepChip.consultantsAllotted.chip', 'Consultants allotted') },
        { key: 'opening', label: t('staff.monitoring.stepChip.opening.chip', 'Opening meeting conducted') },
        { key: 'submitted', label: t('staff.monitoring.stepChip.consultantSubmitted.chip', 'Submitted by the consultant') },
      ]
    : [
        { key: 'distributed', label: t('staff.monitoring.stepChip.distributed.chip', 'Parameters distributed') },
        { key: 'opening', label: t('staff.monitoring.stepChip.opening.chip', 'Opening meeting conducted') },
        { key: 'submitted', label: t('staff.monitoring.stepChip.appSubmitted.chip', 'Assessment submitted through mobile app') },
        { key: PENDING, label: t('staff.monitoring.stepChip.pending.chip', 'Submission pending through mobile app') },
      ];
}

/** The steps shown on a row (the pending chip is not a step). */
export const STEP_ORDER = ['distributed', 'opening', 'submitted'] as const;

export function stepLabels(system: MonitoringSystem): Record<string, string> {
  return system === 'consultancy'
    ? {
        distributed: t('staff.monitoring.step.consultantsAllotted.label', 'Consultants allotted'),
        opening: t('staff.monitoring.step.opening.label', 'Opening meeting'),
        submitted: t('staff.monitoring.step.submitted.label', 'Submitted'),
      }
    : {
        distributed: t('staff.monitoring.step.distributed.label', 'Parameters distributed'),
        opening: t('staff.monitoring.step.opening.label', 'Opening meeting'),
        submitted: t('staff.monitoring.step.appSubmitted.label', 'Submitted (app)'),
      };
}

/** A step of the row: done (green), current (amber) or to do (grey). */
export function stepState(current: unknown, step: string): 'done' | 'current' | 'todo' {
  const at = STEP_ORDER.indexOf(String(current ?? '') as (typeof STEP_ORDER)[number]);
  const i = STEP_ORDER.indexOf(step as (typeof STEP_ORDER)[number]);
  return at < 0 ? 'todo' : i < at ? 'done' : i === at ? 'current' : 'todo';
}

/** The delay chips of the quality check (TatEvaluator buckets). */
export function delayChips(): TrackTab[] {
  return [
    { key: 'on-time', label: t('staff.monitoring.delay.onTime.chip', 'On time') },
    { key: 'lt1', label: t('staff.monitoring.delay.lt1.chip', 'Delayed less than 1 day') },
    { key: '1-5', label: t('staff.monitoring.delay.d1to5.chip', '1–5 days') },
    { key: '5-10', label: t('staff.monitoring.delay.d5to10.chip', '5–10 days') },
    { key: 'gt10', label: t('staff.monitoring.delay.gt10.chip', 'More than 10 days') },
  ];
}

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
