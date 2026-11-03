import { isAttendanceDoneToday, isLoggedInToday } from './attendance';
import {
  basicInfoStringStatus,
  COMPLETED_TEXT,
  isFirstMilestone,
  isFourthMilestone,
  isLead,
  isThirdMilestone,
  Status,
  stringStatus,
  SUBMITTED_TEXT,
  textStatus,
  type AssessmentDetails,
  type ParametersModule,
} from './models';

/**
 * The sections of the open milestone, in the order and with the statuses of the legacy dashboard
 * (AssessmentOptionsActivity): which appear depends on the milestone and the lead / co-consultant role. The legacy list
 * dropped a meeting, the site photos and the site tour once submitted; the redesign keeps them as completed (they do not
 * open again) so the progress counts them. The milestone home attaches each section's action.
 */
export type SectionId =
  | 'attendance'
  | 'site-photos'
  | 'open-meeting'
  | 'site-tour'
  | 'training-on-zed'
  | 'diagnostic-study'
  | 'basic-info'
  | 'handholding-action-plan'
  | 'technology-intervention'
  | 'training-on-handholding'
  | 'progress-review'
  | 'closing-meeting'
  | 'technology-upgradation'
  | 'final-submission';

export type Section = { id: SectionId; label: string; mandatory: boolean; status: string | null; module?: ParametersModule; submitted?: boolean };

/** configureOption: "Submitted" shows as "Completed". */
export const shownStatus = (s: string | null) => (s === SUBMITTED_TEXT ? COMPLETED_TEXT : s);

export function milestoneSections(d: AssessmentDetails, sitePhotosDone: boolean): Section[] {
  const lead = isLead(d);
  const m1 = isFirstMilestone(d);
  const m4 = isFourthMilestone(d);
  const out: Section[] = [];
  const attendance = isAttendanceDoneToday(d.attendanceData) ? Status.COMPLETED : isLoggedInToday(d.attendanceData) ? Status.IN_PROGRESS : Status.TO_START;
  out.push({ id: 'attendance', label: 'Attendance', mandatory: true, status: textStatus(attendance) });
  const done = (submitted: boolean) => (submitted ? { status: COMPLETED_TEXT, submitted: true } : { status: null });
  if (lead) {
    const opened = !!d.isOpenMeetingSubmitted;
    out.push({ id: 'site-photos', label: 'Site Photos', mandatory: true, ...done(opened), ...(!opened && sitePhotosDone ? { status: COMPLETED_TEXT } : null) });
    out.push({ id: 'open-meeting', label: 'Opening Meeting', mandatory: true, ...done(opened) });
  }
  if (m1) out.push({ id: 'site-tour', label: 'Site Tour', mandatory: true, ...done(!!d.isSiteTourSubmitted) });
  if (m1 && lead) out.push({ id: 'training-on-zed', label: 'Training on ZED', mandatory: true, status: stringStatus(d.zedTrainingInfo) });
  if (m1) {
    out.push({ id: 'diagnostic-study', label: 'Baseline Diagnostic Study', mandatory: true, status: stringStatus(d.baselineDiagnosticStudyData), module: 'baselineDiagnostic' });
  }
  if (lead && !m4) out.push({ id: 'basic-info', label: 'Basic Information', mandatory: true, status: basicInfoStringStatus(d.saBasicInformation) });
  if (m1) {
    out.push({
      id: 'handholding-action-plan',
      label: 'Handholding Action Plan',
      mandatory: false,
      status: stringStatus(d.handholdingActionPlanData),
      module: 'handholdingActionPlan',
    });
    out.push({
      id: 'technology-intervention',
      label: 'Suggestion for Technology Intervention',
      mandatory: false,
      status: stringStatus(d.suggestionForTechnologyIntervention),
      module: 'technologyIntervention',
    });
  }
  if (!m4) {
    out.push({ id: 'training-on-handholding', label: 'Training on Handholding Implementation Plan', mandatory: true, status: stringStatus(d.handholdingTraining) });
  }
  if (!m1 && !m4) {
    out.push({
      id: 'progress-review',
      label: isThirdMilestone(d) ? 'Progress Review 2' : 'Progress Review 1',
      mandatory: true,
      status: stringStatus(d.progressReview),
      module: 'progressReview',
    });
  }
  if (lead && !m4) out.push({ id: 'closing-meeting', label: 'Closing Meeting', mandatory: true, ...done(!!d.isCloseMeetingSubmitted) });
  if (m4) {
    out.push({ id: 'technology-upgradation', label: 'Technology Upgradation', mandatory: true, status: d.technologyUpgradationStatus === Status.SUBMITTED ? COMPLETED_TEXT : null });
  }
  if (!lead) out.push({ id: 'final-submission', label: 'Final Submission', mandatory: true, ...done(!!d.isCloseMeetingSubmitted) });
  return out;
}

/** Sections completed of those shown (the attendance counts once punched in and out today). */
export function milestoneProgress(d: AssessmentDetails | null | undefined, sitePhotosDone = false) {
  if (!d) return { done: 0, total: 0, ratio: 0 };
  const list = milestoneSections(d, sitePhotosDone);
  const done = list.filter(s => shownStatus(s.status) === COMPLETED_TEXT).length;
  return { done, total: list.length, ratio: list.length ? done / list.length : 0 };
}
