/**
 * 2026-11-18: "Clear data" section by section (the user: "It should be section wise and not all in one go"). The case card's
 * Clear data opens a sheet listing each step of the assessment the phone holds data for (Parameter Allocation, Attendance,
 * Opening Meeting, Site Tour, Basic Info, each parameter of the checklist, Closing Meeting...), with what it holds and an
 * "Unsynced" mark when the server does not have it yet; only the ticked steps are removed. The same steps apply to an
 * Onsite certification and to a surveillance visit (the same row per assessor + unit, kept the same way).
 *
 * This module reads what a case holds (loadCaseData), lists its sections (caseSections) and plans what clearing some of
 * them removes (planClear); SaApp.clearSections carries the plan out on the stores, so the other sections stay as they are.
 */
import { PHOTO_TO_SUBMIT, zedDevice, type PhotoData, type PhotoStore, type SyncJob, type SyncQueue } from '@zed/shared';
import { PREFS, type AssessorStore, type Prefs } from './db/stores';
import {
  COMPLETED,
  EVIDENCE_ADDED,
  EVIDENCE_SITE_TOUR,
  isSaBasicInfoSubmitted,
  normalizeDetails,
  SUBMITTED,
  TO_START,
  type AllottedParameters,
  type AssessmentDetails,
  type PhotoInformation,
  type RequirementDetails,
  type SubmitAssessmentRequest,
  type SubmitSelfieImageRequest,
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

/** Everything the phone keeps for one assessor + unit. */
export type CaseData = {
  id: string;
  saId: string;
  zedId: string;
  details: AssessmentDetails | null;
  openMeeting: SubmitAssessmentRequest | null;
  closeMeeting: SubmitAssessmentRequest | null;
  selfie: SubmitSelfieImageRequest | null;
  /** The opening meeting draft between its two screens, when it is this unit's. */
  meetingDraft: SubmitAssessmentRequest | null;
  siteTour: PhotoInformation[];
  added: PhotoInformation[];
  /** The unit's rows of the photo table (associatedId = ZED ID + assessor ID). */
  stored: PhotoData[];
  jobs: SyncJob[];
};

export type ClearDeps = { store: AssessorStore; photos: PhotoStore; queue: SyncQueue; prefs: Prefs };

export const ALLOCATION = 'allocation';
export const ATTENDANCE = 'attendance';
export const OPEN_MEETING = 'open-meeting';
export const SITE_TOUR = 'site-tour';
export const SELFIE = 'selfie';
export const BASIC_INFO = 'basic-info';
export const CLOSE_MEETING = 'close-meeting';
export const ADDED_EVIDENCE = 'added-evidence';
export const OTHER_PHOTOS = 'other-photos';
const PARAMETER = 'parameter:';
export const parameterSection = (p: AllottedParameters, index: number) => PARAMETER + (p.parameterId ?? String(index));

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

export type PhotoRef = { photoId: string; photo?: string | null; photoPath?: string | null };

/** Every photo (an object with a photo ID) found in the given data, once each. */
export function photosIn(...values: unknown[]): PhotoRef[] {
  const out = new Map<string, PhotoRef>();
  const walk = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 16) return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    const o = v as Record<string, unknown>;
    if (typeof o.photoId === 'string' && o.photoId) {
      if (!out.has(o.photoId)) out.set(o.photoId, o as PhotoRef);
      return;
    }
    for (const x of Object.values(o)) walk(x, depth + 1);
  };
  for (const v of values) walk(v, 0);
  return [...out.values()];
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
    const path = stored?.photoPath ?? p.photoPath;
    if (path) {
      try {
        zedDevice().deleteFile(path);
      } catch {
        // a file already gone
      }
    }
  }
}

// ------------------------------------------------------------------ sections

const answered = (r: RequirementDetails | null | undefined) =>
  !!r &&
  (!!r.conformance || !!r.comments || !!r.addedEvidences?.length || !!r.checkpointAnswers?.length || !!r.evidenceChecks?.some(c => !!c?.available || !!c?.photoIds?.length));

/** A parameter answered or completed on the phone but not submitted (as portfolio.hasUnsentWork). */
export const parameterUnsent = (p: AllottedParameters | null | undefined) =>
  !!p && p.status !== SUBMITTED && (p.status === COMPLETED || (p.requirements ?? []).some(answered));

/** The added evidences (EvidenceData) of a parameter's requirements. */
function addedOf(c: CaseData, params: AllottedParameters[]): PhotoInformation[] {
  const ids = new Set<string>();
  for (const p of params) for (const r of p?.requirements ?? []) for (const e of r?.addedEvidences ?? []) if (e?.evidenceId) ids.add(e.evidenceId);
  return c.added.filter(e => e.evidenceId != null && ids.has(e.evidenceId));
}

/** The sections the phone holds data for, in the order of the assessment's steps. */
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
      if (!r.photo && !r.photoPath && !s) continue;
      photos++;
      bytes += base64Bytes(r.photo) || base64Bytes(s?.photo);
    }
    if (records === 0 && photos === 0) return;
    const parts = [records ? count(records, label[0], label[1]) : null, photos ? count(photos, photoLabel[0], photoLabel[1]) : null, bytes ? formatBytes(bytes) : null];
    out.push({ id, title, icon, detail: parts.filter(Boolean).join(' · '), unsent, note, photos, bytes });
  };
  const jobOf = (kind: string) => c.jobs.some(j => j.kind === kind);
  const params = (d.allottedParameters ?? []).filter(Boolean);

  add(
    ALLOCATION,
    'Parameter Allocation',
    'edit',
    photosIn(params, addedOf(c, params)),
    params.length || (d.inputParameters ?? []).length,
    ['parameter', 'parameters'],
    params.some(parameterUnsent) || addedOf(c, params).length > 0,
    'With the checklist answers. Downloaded again when you open the assessment online.',
  );
  const attendance = (d.attendanceData?.attendanceList ?? []).filter(Boolean);
  add(
    ATTENDANCE,
    'Attendance',
    'calendar',
    photosIn(attendance),
    new Set(attendance.map(a => String(a.time ?? '').slice(0, 10))).size,
    ['day', 'days'],
    attendance.some(a => !a.isSubmitted) || jobOf('attendance'),
    undefined,
    ['selfie', 'selfies'],
  );
  add(
    OPEN_MEETING,
    'Opening Meeting',
    'users',
    photosIn(c.openMeeting, c.meetingDraft),
    (c.openMeeting ? 1 : 0) + (c.meetingDraft ? 1 : 0) + (d.openMeetingParticipants?.length ? 1 : 0),
    ['record', 'records'],
    !!c.openMeeting || !!c.meetingDraft || jobOf('openMeeting'),
  );
  add(SITE_TOUR, 'Site tour photographs', 'image', photosIn(c.siteTour), 0, ['', ''], c.siteTour.length > 0 && !d.isSiteTourSubmitted);
  if (c.selfie) add(SELFIE, 'Selfie on site', 'camera', photosIn(c.selfie), c.selfie.selfieImage?.photo ? 0 : 1, ['record', 'records'], true, undefined, ['selfie', 'selfies']);
  if (d.saBasicInformation) add(BASIC_INFO, 'Basic Info', 'document', photosIn(d.saBasicInformation), 1, ['record', 'records'], !isSaBasicInfoSubmitted(d));
  params.forEach((p, i) => {
    const linked = addedOf(c, [p]);
    add(
      parameterSection(p, i),
      `Checklist · ${p.parameterName || p.parameterCode || `Parameter ${i + 1}`}`,
      'clipboard',
      photosIn(p, linked),
      (p.requirements ?? []).filter(answered).length,
      ['answer', 'answers'],
      parameterUnsent(p) || linked.length > 0,
      p.status === SUBMITTED ? 'Submitted: only the photos kept on the phone are removed.' : undefined,
    );
  });
  if (c.closeMeeting) add(CLOSE_MEETING, d.userType === 1 ? 'Closing Meeting' : 'Final Comments', 'flag', photosIn(c.closeMeeting), 1, ['record', 'records'], true);
  const linkedAll = new Set(addedOf(c, params).map(e => e.evidenceId));
  const unlinked = c.added.filter(e => !linkedAll.has(e.evidenceId));
  add(ADDED_EVIDENCE, 'Other added evidence', 'paperclip', photosIn(unlinked), unlinked.filter(e => !e.photo).length, ['record', 'records'], unlinked.length > 0);
  const known = new Set(photosIn(d, c.openMeeting, c.closeMeeting, c.selfie, c.meetingDraft, c.siteTour, c.added).map(p => p.photoId));
  const other = c.stored.filter(p => !known.has(p.photoId));
  add(OTHER_PHOTOS, 'Other photos', 'image', other, 0, ['', ''], other.some(p => p.status === PHOTO_TO_SUBMIT), 'Taken for this assessment but not kept in any step.');
  return out;
}

// ------------------------------------------------------------------ clearing

/** What clearing some sections removes; SaApp.clearSections carries it out. */
export type ClearPlan = {
  /** The partial update of the stored assessment (applied to the open one too). */
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

function resetRequirement(r: RequirementDetails) {
  delete r.conformance;
  delete r.comments;
  delete r.checkpointAnswers;
  delete r.evidenceChecks;
  delete r.addedEvidences;
}

export function planClear(c: CaseData, ids: string[]): ClearPlan {
  const d = c.details;
  const want = new Set(ids);
  const steps: Array<(d: AssessmentDetails) => void> = [];
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
  const params = (d.allottedParameters ?? []).filter(Boolean);
  // 2026-11-28 (the owner: a cleared section's data stayed): an evidence's photos go with it; before, only the record went and its
  // photos stayed on the phone, shown again under "Other photos".
  const evidences = (list: PhotoInformation[]) => {
    plan.evidenceIds.push(...list.map(e => e.evidenceId).filter((e): e is string => !!e));
    plan.photos.push(...photosIn(list));
  };

  if (want.has(ALLOCATION)) {
    plan.photos.push(...photosIn(params));
    evidences(addedOf(c, params));
    steps.push(x => {
      delete x.allottedParameters;
      delete x.inputParameters;
      (x as Reloadable).reloadAllocation = true;
    });
  }
  if (want.has(ATTENDANCE)) {
    plan.photos.push(...photosIn(d.attendanceData?.attendanceList));
    plan.jobKinds.push('attendance');
    steps.push(x => {
      x.attendanceData = { attendanceList: [] };
    });
  }
  if (want.has(OPEN_MEETING)) {
    plan.openMeeting = true;
    plan.meetingDraft = !!c.meetingDraft;
    plan.photos.push(...photosIn(c.openMeeting, c.meetingDraft));
    plan.jobKinds.push('openMeeting');
    // A meeting saved offline was marked held on the phone only: it is to be held again.
    const unsent = !!c.openMeeting;
    steps.push(x => {
      if (unsent) x.isOpenMeetingSubmitted = false;
      delete x.openMeetingParticipants;
    });
  }
  if (want.has(SITE_TOUR)) {
    plan.evidenceTypes.push(EVIDENCE_SITE_TOUR);
    plan.photos.push(...photosIn(c.siteTour));
  }
  if (want.has(SELFIE) && c.selfie) {
    plan.selfie = true;
    plan.photos.push(...photosIn(c.selfie));
    plan.jobKinds.push('selfie');
    steps.push(x => {
      x.isSelfieSubmitted = false;
    });
  }
  if (want.has(BASIC_INFO)) {
    plan.photos.push(...photosIn(d.saBasicInformation));
    steps.push(x => {
      // Sent already: the step stays done (the server's flag says so on the next download too).
      if (isSaBasicInfoSubmitted(x)) x.isBasicInfoSubmitted = true;
      delete x.saBasicInformation;
    });
  }
  params.forEach((p, i) => {
    const sid = parameterSection(p, i);
    if (!want.has(sid) || want.has(ALLOCATION)) return;
    plan.photos.push(...photosIn(p));
    evidences(addedOf(c, [p]));
    steps.push(x => {
      const q = (x.allottedParameters ?? []).find((y, j) => y && parameterSection(y, j) === sid);
      if (!q) return;
      if (q.status === SUBMITTED) {
        // On the server: only the phone's photo copies go.
        for (const r of q.requirements ?? []) if (r) delete r.addedEvidences;
        return;
      }
      for (const r of q.requirements ?? []) if (r) resetRequirement(r);
      q.status = TO_START;
      q.isSelectedToSubmit = false;
    });
  });
  if (want.has(CLOSE_MEETING) && c.closeMeeting) {
    plan.closeMeeting = true;
    plan.photos.push(...photosIn(c.closeMeeting));
    steps.push(x => {
      x.isCloseMeetingSubmitted = false;
    });
  }
  if (want.has(ADDED_EVIDENCE)) {
    const linked = new Set(addedOf(c, params).map(e => e.evidenceId));
    evidences(c.added.filter(e => !linked.has(e.evidenceId)));
  }
  if (want.has(OTHER_PHOTOS)) {
    const known = new Set(photosIn(d, c.openMeeting, c.closeMeeting, c.selfie, c.meetingDraft, c.siteTour, c.added).map(p => p.photoId));
    plan.photos.push(...c.stored.filter(p => !known.has(p.photoId)));
  }
  return plan;
}

/** The photos the case still uses after a clear (they stay in the photo table). */
export const photosInUse = (c: CaseData) => new Set(photosIn(c.details, c.openMeeting, c.closeMeeting, c.selfie, c.meetingDraft, c.siteTour, c.added).map(p => p.photoId));

/**
 * After a cleared allocation, the server's fresh answer (saveDetails) brings the parameters back; the sections captured on
 * the phone are kept from the stored row instead of being replaced by the download.
 */
export function carryOverLocalWork(before: AssessmentDetails, fresh: AssessmentDetails): void {
  if (!(before as Reloadable).reloadAllocation) return;
  if (before.saBasicInformation) fresh.saBasicInformation = before.saBasicInformation;
  if (before.attendanceData?.attendanceList?.length) fresh.attendanceData = before.attendanceData;
  if (before.openMeetingParticipants?.length) fresh.openMeetingParticipants = before.openMeetingParticipants;
  for (const k of ['isOpenMeetingSubmitted', 'isSelfieSubmitted', 'isSiteTourSubmitted', 'isCloseMeetingSubmitted', 'isBasicInfoSubmitted'] as const) fresh[k] = !!fresh[k] || !!before[k];
  delete (fresh as Reloadable).reloadAllocation;
}
