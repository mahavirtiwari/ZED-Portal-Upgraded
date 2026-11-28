/**
 * 2026-11-18: "Clear data" section by section (the user: "It should be section wise and not all in one go", "same for
 * consultancy"). The case card's Clear data opens a sheet listing each section of the milestone the phone holds data for
 * (Parameter Allocation, Attendance, Opening Meeting and site photos, Site Tour, the trainings, Baseline Diagnostic Study,
 * Basic Information, the action plan, the technology intervention, Progress Review, Closing Meeting...), with what it holds
 * and an "Unsynced" mark when the server does not have it yet; only the ticked sections are removed.
 *
 * This module reads what a case holds (loadCaseData), lists its sections (caseSections) and plans what clearing some of
 * them removes (planClear); SaApp.clearSections carries the plan out on the stores, so the other sections stay as they are.
 */
import { PHOTO_TO_SUBMIT, zedDevice, type PhotoData, type PhotoStore, type SyncJob, type SyncQueue } from '@zed/shared';
import { PREFS, type AssessorStore, type Prefs } from './db/stores';
import {
  EVIDENCE_ADDED,
  EVIDENCE_SITE_TOUR,
  isLead,
  isSaBasicInfoSubmitted,
  isThirdMilestone,
  normalizeDetails,
  Status,
  type AssessmentDetails,
  type BaseParametersData,
  type PhotoInformation,
  type SubmitAssessmentRequest,
  type SubmitSelfieImageRequest,
  type ZedTrainingInfo,
} from './models';
import type { IconName } from './ui/zed';

/** One section of the Clear data sheet. */
export type ClearSection = {
  id: string;
  title: string;
  icon: IconName;
  /** What the phone holds, e.g. "8 photos · 24.6 MB", "2 records · 4 photos". */
  detail: string;
  /** Work the server does not have yet: lost for good when cleared. */
  unsent: boolean;
  /** What happens after clearing, when it matters. */
  note?: string;
  photos: number;
  bytes: number;
};

/** Everything the phone keeps for one consultant + unit. */
export type CaseData = {
  id: string;
  saId: string;
  zedId: string;
  details: AssessmentDetails | null;
  openMeeting: SubmitAssessmentRequest | null;
  closeMeeting: SubmitAssessmentRequest | null;
  selfie: SubmitSelfieImageRequest | null;
  /** An opening meeting draft between screens, when it is this unit's (kept for parity with the assessor app). */
  meetingDraft: SubmitAssessmentRequest | null;
  siteTour: PhotoInformation[];
  added: PhotoInformation[];
  /** The unit's rows of the photo table (associatedId = ZED ID + consultant ID). */
  stored: PhotoData[];
  jobs: SyncJob[];
};

export type ClearDeps = { store: AssessorStore; photos: PhotoStore; queue: SyncQueue; prefs: Prefs };

export const ALLOCATION = 'allocation';
export const ATTENDANCE = 'attendance';
export const OPEN_MEETING = 'open-meeting';
export const SITE_TOUR = 'site-tour';
export const SELFIE = 'selfie';
export const TRAINING_ON_ZED = 'training-on-zed';
export const DIAGNOSTIC_STUDY = 'diagnostic-study';
export const BASIC_INFO = 'basic-info';
export const ACTION_PLAN = 'handholding-action-plan';
export const TECHNOLOGY_INTERVENTION = 'technology-intervention';
export const TRAINING_ON_HANDHOLDING = 'training-on-handholding';
export const PROGRESS_REVIEW = 'progress-review';
export const CLOSE_MEETING = 'close-meeting';
export const ADDED_EVIDENCE = 'added-evidence';
export const OTHER_PHOTOS = 'other-photos';

/** The milestone deliverables kept in the case's JSON, by section (as the milestone page names them). */
const MODULES = [
  [DIAGNOSTIC_STUDY, 'baselineDiagnosticStudyData', 'Baseline Diagnostic Study', 'clipboard'],
  [ACTION_PLAN, 'handholdingActionPlanData', 'Handholding Action Plan', 'flag'],
  [TECHNOLOGY_INTERVENTION, 'suggestionForTechnologyIntervention', 'Suggestion for Technology Intervention', 'settings'],
  [PROGRESS_REVIEW, 'progressReview', 'Progress Review', 'clipboard'],
] as const;

const TRAININGS = [
  [TRAINING_ON_ZED, 'zedTrainingInfo', 'Training on ZED', false],
  [TRAINING_ON_HANDHOLDING, 'handholdingTraining', 'Training on Handholding Implementation Plan', true],
] as const;

/** Set on a row whose allocation was cleared: the next download takes the server's parameters and keeps the rest. */
type Reloadable = AssessmentDetails & { reloadAllocation?: boolean };

export async function loadCaseData(deps: ClearDeps, saId: string, zedId: string, open?: AssessmentDetails | null): Promise<CaseData> {
  const id = saId + zedId;
  const kept = open ?? (await deps.store.load(id));
  const details = kept ? (open ? open : normalizeDetails(kept)) : null;
  let meetingDraft: SubmitAssessmentRequest | null = null;
  try {
    const s = deps.prefs.get(PREFS.meetingDraft, PREFS.meetingDraftKey);
    const draft = s ? (JSON.parse(s) as SubmitAssessmentRequest) : null;
    if (draft && draft.saId === saId && draft.zedId === zedId) meetingDraft = draft;
  } catch {
    meetingDraft = null;
  }
  return {
    id,
    saId,
    zedId,
    details,
    openMeeting: await deps.store.meeting(id, true),
    closeMeeting: await deps.store.meeting(id, false),
    selfie: await deps.store.selfie(id),
    meetingDraft,
    siteTour: await deps.store.evidencesOfType(id, EVIDENCE_SITE_TOUR),
    added: await deps.store.evidencesOfType(id, EVIDENCE_ADDED),
    stored: await deps.photos.byAssociatedId(zedId + saId),
    jobs: (await deps.queue.list(id)).filter(j => j.userId === id),
  };
}

// ------------------------------------------------------------------ photos and sizes

export type PhotoRef = { photoId: string; photo?: string | null; photoPath?: string | null; filePath?: string | null };

const isPhoto = (v: unknown): v is PhotoRef => !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as PhotoRef).photoId === 'string' && !!(v as PhotoRef).photoId;

/** Every photo (an object with a photo ID) found in the given data, once each. */
export function photosIn(...values: unknown[]): PhotoRef[] {
  const out = new Map<string, PhotoRef>();
  const walk = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 16) return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    if (isPhoto(v)) {
      if (!out.has(v.photoId)) out.set(v.photoId, v);
      return;
    }
    for (const x of Object.values(v as Record<string, unknown>)) walk(x, depth + 1);
  };
  for (const v of values) walk(v, 0);
  return [...out.values()];
}

/** Takes the photos out of a section kept as sent (its answers stay): photo lists emptied, single photos removed. */
export function stripPhotos(v: unknown, depth = 0): void {
  if (!v || typeof v !== 'object' || depth > 16) return;
  if (Array.isArray(v)) {
    for (let i = v.length - 1; i >= 0; i--) if (isPhoto(v[i])) v.splice(i, 1);
    for (const x of v) stripPhotos(x, depth + 1);
    return;
  }
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (isPhoto(o[k])) delete o[k];
    else stripPhotos(o[k], depth + 1);
  }
}

const base64Bytes = (s: string | null | undefined) => (s ? Math.floor((s.length * 3) / 4) : 0);

/** "640 KB", "24.6 MB" */
export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Removes photos from the photo table and their files. */
export async function removePhotos(store: PhotoStore, photos: PhotoRef[]): Promise<void> {
  for (const p of photos) {
    const stored = await store.get(p.photoId).catch(() => null);
    if (stored) await store.delete(p.photoId);
    for (const path of new Set([stored?.photoPath, p.photoPath, p.filePath])) {
      if (!path) continue;
      try {
        zedDevice().deleteFile(path);
      } catch {
        // a file already gone
      }
    }
  }
}

// ------------------------------------------------------------------ sections

const sent = (s: { status?: Status | null } | null | undefined) => s?.status === Status.SUBMITTED;
const moduleTitle = (d: AssessmentDetails, id: string, title: string) => (id === PROGRESS_REVIEW ? (isThirdMilestone(d) ? 'Progress Review 2' : 'Progress Review 1') : title);
const trainingJob = (handholding: boolean) => (j: SyncJob) => j.kind === 'training' && (j.payload.handholding === true) === handholding;

/** The sections the phone holds data for, in the order of the milestone page. */
export function caseSections(c: CaseData): ClearSection[] {
  const d = c.details;
  if (!d) return [];
  const stored = new Map(c.stored.map(p => [p.photoId, p]));
  const out: ClearSection[] = [];
  const add = (
    id: string,
    title: string,
    icon: IconName,
    refs: PhotoRef[],
    records: number,
    label: [string, string],
    unsent: boolean,
    note?: string,
    photoLabel: [string, string] = ['photo', 'photos'],
  ) => {
    let photos = 0;
    let bytes = 0;
    for (const r of refs) {
      const s = stored.get(r.photoId);
      if (!r.photo && !r.photoPath && !r.filePath && !s) continue;
      photos++;
      bytes += base64Bytes(r.photo) || base64Bytes(s?.photo);
    }
    if (records === 0 && photos === 0) return;
    const parts = [records ? count(records, label[0], label[1]) : null, photos ? count(photos, photoLabel[0], photoLabel[1]) : null, bytes ? formatBytes(bytes) : null];
    out.push({ id, title, icon, detail: parts.filter(Boolean).join(' · '), unsent, note, photos, bytes });
  };
  const jobOf = (test: (j: SyncJob) => boolean) => c.jobs.some(test);
  const params = (d.allottedParameters ?? []).filter(Boolean);

  add(
    ALLOCATION,
    'Parameter Allocation',
    'edit',
    photosIn(params),
    params.length || (d.inputParameters ?? []).length,
    ['parameter', 'parameters'],
    false,
    'Downloaded again when you open the case online.',
  );
  const attendance = (d.attendanceData?.attendanceList ?? []).filter(Boolean);
  add(
    ATTENDANCE,
    'Attendance',
    'calendar',
    photosIn(attendance),
    new Set(attendance.map(a => String(a.time ?? '').slice(0, 10))).size,
    ['day', 'days'],
    attendance.some(a => !a.isSubmitted) || jobOf(j => j.kind === 'attendance'),
    undefined,
    ['selfie', 'selfies'],
  );
  add(
    OPEN_MEETING,
    'Opening Meeting & site photos',
    'users',
    photosIn(c.openMeeting, c.meetingDraft),
    (c.openMeeting ? 1 : 0) + (c.meetingDraft ? 1 : 0) + (d.openMeetingParticipants?.length ? 1 : 0),
    ['record', 'records'],
    !!c.openMeeting || !!c.meetingDraft || jobOf(j => j.kind === 'openMeeting'),
  );
  add(SITE_TOUR, 'Site tour photographs', 'image', photosIn(c.siteTour), 0, ['', ''], c.siteTour.length > 0 && !d.isSiteTourSubmitted);
  if (c.selfie) add(SELFIE, 'Selfie on site', 'camera', photosIn(c.selfie), c.selfie.selfieImage?.photo ? 0 : 1, ['record', 'records'], true, undefined, ['selfie', 'selfies']);
  const training = ([id, key, title, handholding]: (typeof TRAININGS)[number]) => {
    const info = d[key] as ZedTrainingInfo | null | undefined;
    if (!info) return;
    add(id, title, 'users', photosIn(info), 1, ['record', 'records'], !sent(info) || jobOf(trainingJob(handholding)), sent(info) ? 'Sent: only the photos kept on the phone are removed.' : undefined);
  };
  const module = ([id, key, title, icon]: (typeof MODULES)[number]) => {
    const data = d[key] as BaseParametersData | null | undefined;
    if (!data) return;
    add(
      id,
      moduleTitle(d, id, title),
      icon,
      photosIn(data),
      (data.parameters ?? []).filter(Boolean).length,
      ['parameter', 'parameters'],
      !sent(data),
      sent(data) ? 'Sent: only the photos kept on the phone are removed.' : undefined,
    );
  };
  training(TRAININGS[0]);
  module(MODULES[0]);
  if (d.saBasicInformation) add(BASIC_INFO, 'Basic Information', 'document', photosIn(d.saBasicInformation), 1, ['record', 'records'], !isSaBasicInfoSubmitted(d));
  module(MODULES[1]);
  module(MODULES[2]);
  training(TRAININGS[1]);
  module(MODULES[3]);
  if (c.closeMeeting) add(CLOSE_MEETING, isLead(d) ? 'Closing Meeting' : 'Final Submission', 'flag', photosIn(c.closeMeeting), 1, ['record', 'records'], true);
  add(ADDED_EVIDENCE, 'Added evidence', 'paperclip', photosIn(c.added), c.added.filter(e => !e.photo).length, ['record', 'records'], c.added.length > 0);
  const known = photosInUse(c);
  const other = c.stored.filter(p => !known.has(p.photoId));
  add(OTHER_PHOTOS, 'Other photos', 'image', other, 0, ['', ''], other.some(p => p.status === PHOTO_TO_SUBMIT), 'Taken for this case but not kept in any section.');
  return out;
}

// ------------------------------------------------------------------ clearing

/** What clearing some sections removes; SaApp.clearSections carries it out. */
export type ClearPlan = {
  /** The partial update of the stored case (applied to the open one too). */
  mutate: (d: AssessmentDetails) => void;
  /** Photos of the cleared sections (those still used by another section stay). */
  photos: PhotoRef[];
  evidenceIds: string[];
  evidenceTypes: number[];
  openMeeting: boolean;
  closeMeeting: boolean;
  selfie: boolean;
  meetingDraft: boolean;
  jobKinds: string[];
  /** Narrows the queued sends of those kinds (all of them when absent). */
  jobFilter?: (job: SyncJob) => boolean;
};

export function planClear(c: CaseData, ids: string[]): ClearPlan {
  const d = c.details;
  const want = new Set(ids);
  const steps: Array<(d: AssessmentDetails) => void> = [];
  const filters: Array<(job: SyncJob) => boolean> = [];
  const plan: ClearPlan = {
    mutate: x => steps.forEach(s => s(x)),
    photos: [],
    evidenceIds: [],
    evidenceTypes: [],
    openMeeting: false,
    closeMeeting: false,
    selfie: false,
    meetingDraft: false,
    jobKinds: [],
  };
  if (!d) return plan;
  const job = (kind: string, filter: (j: SyncJob) => boolean = j => j.kind === kind) => {
    if (!plan.jobKinds.includes(kind)) plan.jobKinds.push(kind);
    filters.push(filter);
  };

  if (want.has(ALLOCATION)) {
    plan.photos.push(...photosIn(d.allottedParameters));
    steps.push(x => {
      delete x.allottedParameters;
      delete x.inputParameters;
      (x as Reloadable).reloadAllocation = true;
    });
  }
  if (want.has(ATTENDANCE)) {
    plan.photos.push(...photosIn(d.attendanceData?.attendanceList));
    job('attendance');
    steps.push(x => {
      x.attendanceData = { attendanceList: [] };
    });
  }
  if (want.has(OPEN_MEETING)) {
    plan.openMeeting = true;
    plan.meetingDraft = !!c.meetingDraft;
    plan.photos.push(...photosIn(c.openMeeting, c.meetingDraft));
    job('openMeeting');
    // A meeting saved offline was marked held on the phone only: it is to be held again.
    const unsent = !!c.openMeeting;
    steps.push(x => {
      if (unsent) x.isOpenMeetingSubmitted = false;
      delete x.openMeetingParticipants;
    });
  }
  // 2026-11-28 (the owner: a cleared section's data stayed): the photos of the site tour, the selfie and the added evidence go with
  // their records; before, they stayed on the phone and showed again under "Other photos".
  if (want.has(SITE_TOUR)) {
    plan.evidenceTypes.push(EVIDENCE_SITE_TOUR);
    plan.photos.push(...photosIn(c.siteTour));
  }
  if (want.has(SELFIE) && c.selfie) {
    plan.selfie = true;
    plan.photos.push(...photosIn(c.selfie));
    steps.push(x => {
      x.isSelfieSubmitted = false;
    });
  }
  for (const [id, key, , handholding] of TRAININGS) {
    if (!want.has(id) || !d[key]) continue;
    plan.photos.push(...photosIn(d[key]));
    job('training', trainingJob(handholding));
    steps.push(x => {
      const info = x[key];
      if (!info) return;
      if (sent(info)) stripPhotos(info);
      else delete x[key];
    });
  }
  for (const [id, key] of MODULES) {
    if (!want.has(id) || !d[key]) continue;
    plan.photos.push(...photosIn(d[key]));
    steps.push(x => {
      const data = x[key];
      if (!data) return;
      // Sent: on the server, the phone's photo copies go. Not sent: the section starts again from the allotted parameters.
      if (sent(data)) stripPhotos(data);
      else delete x[key];
    });
  }
  if (want.has(BASIC_INFO)) {
    plan.photos.push(...photosIn(d.saBasicInformation));
    steps.push(x => {
      // Sent already: the section stays done (the server's flag says so on the next download too).
      if (isSaBasicInfoSubmitted(x)) x.isBasicInfoSubmitted = true;
      delete x.saBasicInformation;
    });
  }
  if (want.has(CLOSE_MEETING) && c.closeMeeting) {
    plan.closeMeeting = true;
    plan.photos.push(...photosIn(c.closeMeeting));
    steps.push(x => {
      x.isCloseMeetingSubmitted = false;
    });
  }
  if (want.has(ADDED_EVIDENCE)) {
    plan.evidenceTypes.push(EVIDENCE_ADDED);
    plan.photos.push(...photosIn(c.added));
  }
  if (want.has(OTHER_PHOTOS)) {
    const known = photosInUse(c);
    plan.photos.push(...c.stored.filter(p => !known.has(p.photoId)));
  }
  if (filters.length) plan.jobFilter = j => filters.some(f => f(j));
  return plan;
}

/** The photos the case uses (they stay in the photo table after a clear). */
export const photosInUse = (c: CaseData) => new Set(photosIn(c.details, c.openMeeting, c.closeMeeting, c.selfie, c.meetingDraft, c.siteTour, c.added).map(p => p.photoId));

/**
 * After a cleared allocation, the server's fresh answer (saveDetails) brings the parameters back; the sections captured on
 * the phone are kept from the stored row instead of being replaced by the download.
 */
export function carryOverLocalWork(before: AssessmentDetails, fresh: AssessmentDetails): void {
  if (!(before as Reloadable).reloadAllocation) return;
  const keep = [
    'saBasicInformation',
    'zedTrainingInfo',
    'handholdingTraining',
    'baselineDiagnosticStudyData',
    'handholdingActionPlanData',
    'suggestionForTechnologyIntervention',
    'progressReview',
  ] as const;
  const target = fresh as Record<string, unknown>;
  for (const k of keep) if (before[k]) target[k] = before[k];
  if (before.attendanceData?.attendanceList?.length) fresh.attendanceData = before.attendanceData;
  if (before.openMeetingParticipants?.length) fresh.openMeetingParticipants = before.openMeetingParticipants;
  if (before.technologyUpgradationStatus === Status.SUBMITTED) fresh.technologyUpgradationStatus = before.technologyUpgradationStatus;
  for (const k of ['isOpenMeetingSubmitted', 'isSelfieSubmitted', 'isSiteTourSubmitted', 'isCloseMeetingSubmitted', 'isBasicInfoSubmitted'] as const) fresh[k] = !!fresh[k] || !!before[k];
  delete (fresh as Reloadable).reloadAllocation;
}
