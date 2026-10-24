import {
  basicInfoForSubmit,
  errorResponse,
  isNetworkError,
  isSuccess,
  type BaseServiceResponse,
  type PhotoData,
} from '@zed/shared';
import type { SaApp } from '../app/SaApp';
import { PREFS } from '../db/stores';
import {
  EVIDENCE_ADDED,
  isSaBasicInfoSubmitted,
  Status,
  UNKNOWN_ERROR,
  type AllottedParameters,
  type Attendance,
  type BaseServiceRequest,
  type BasicInformation,
  type ParametersDetails,
  type Participant,
  type PhotoInformation,
  type ServiceResponse,
  type SubmitAssessmentRequest,
  type SubmitSelfieImageRequest,
} from '../models';

export function baseRequest(app: SaApp): BaseServiceRequest {
  return { saId: app.saId, zedId: app.zedId, certificationType: app.certificationType };
}

export function newAssessmentRequest(app: SaApp): SubmitAssessmentRequest {
  return { ...baseRequest(app), userType: 0 };
}

/** Keys of the sync queue jobs (one per kind and assessment). */
export const jobKey = (app: SaApp, kind: string, id = '') => `${app.userId}:${kind}${id ? ':' + id : ''}`;

// ------------------------------------------------------------------ Opening meeting draft (between its two screens)

export function setMeetingDraft(app: SaApp, request: SubmitAssessmentRequest) {
  app.prefs.set(PREFS.meetingDraft, PREFS.meetingDraftKey, JSON.stringify(request, (_k, v) => (v === null ? undefined : v)));
}

export function meetingDraft(app: SaApp): SubmitAssessmentRequest | null {
  const s = app.prefs.get(PREFS.meetingDraft, PREFS.meetingDraftKey);
  if (!s) return null;
  try {
    return JSON.parse(s) as SubmitAssessmentRequest;
  } catch {
    return null;
  }
}

export function clearMeetingDraft(app: SaApp) {
  app.prefs.remove(PREFS.meetingDraft, PREFS.meetingDraftKey);
}

// ------------------------------------------------------------------ Allocation

export function submitAllocation(app: SaApp, allocatedParameters: ParametersDetails[]) {
  return app.api.submitAllocation({ ...baseRequest(app), allocatedParameters });
}

// ------------------------------------------------------------------ Opening meeting

/** MeetingDataCollectionActivity.handleOpenMeetingResponse: kept on success. */
export async function openMeetingSubmitted(app: SaApp, participants: Participant[]) {
  const d = app.details!;
  d.openMeetingParticipants = participants;
  d.isOpenMeetingSubmitted = true;
  await app.update();
  clearMeetingDraft(app);
}

/** submitData offline: OpenMeetingData column, marked submitted (sent later from Sync Assessment, and by the queue). */
export async function saveOpenMeetingOffline(app: SaApp, request: SubmitAssessmentRequest, participants: Participant[]): Promise<boolean> {
  const saved = await app.store.saveMeeting(app.userId, request, true);
  if (saved) {
    await openMeetingSubmitted(app, participants);
    await queueOpenMeeting(app);
  }
  return saved;
}

export function queueOpenMeeting(app: SaApp) {
  return app.queue.enqueue({ kind: 'openMeeting', key: jobKey(app, 'openMeeting'), group: `sa:${app.userId}`, userId: app.userId, label: 'Opening Meeting' });
}

/** Sync Assessment "Opening Meeting": sends the saved request; on success the column is cleared. */
export async function syncOpenMeeting(app: SaApp): Promise<ServiceResponse | null> {
  const request = await app.store.meeting(app.userId, true);
  if (!request) return { status: '1' };
  const r = await app.api.submitStartAssessment(request);
  if (isSuccess(r)) {
    await app.store.clearMeeting(app.userId, true);
    await app.queue.remove(jobKey(app, 'openMeeting'));
  }
  return r;
}

// ------------------------------------------------------------------ Selfie

export async function selfieSubmitted(app: SaApp) {
  app.details!.isSelfieSubmitted = true;
  await app.update();
}

export async function saveSelfieOffline(app: SaApp, request: SubmitSelfieImageRequest): Promise<boolean> {
  const saved = await app.store.saveSelfie(app.userId, request);
  if (saved) {
    await selfieSubmitted(app);
    await app.queue.enqueue({ kind: 'selfie', key: jobKey(app, 'selfie'), group: `sa:${app.userId}`, userId: app.userId, label: 'Selfie on Site' });
  }
  return saved;
}

/** Sync Assessment "Selfie on Site": allowed for an assessor, or once the opening meeting is sent and submitted. */
export async function selfieSyncAllowed(app: SaApp): Promise<boolean> {
  const d = app.details!;
  return d.userType === 2 || ((await app.store.meeting(app.userId, true)) == null && d.isOpenMeetingSubmitted);
}

export async function syncSelfie(app: SaApp): Promise<ServiceResponse | null> {
  const request = await app.store.selfie(app.userId);
  if (!request) return { status: '1' };
  const r = await app.api.submitSelfie(request);
  if (isSuccess(r)) {
    await app.store.clearSelfie(app.userId);
    await app.queue.remove(jobKey(app, 'selfie'));
  }
  return r;
}

// ------------------------------------------------------------------ Site tour

/** SubmitParametersActivity.submitSitetourData: chunks of 3, stopping at the first refusal. */
export async function submitSiteTour(app: SaApp, photos: PhotoInformation[]): Promise<ServiceResponse | null> {
  let response: ServiceResponse | null = null;
  for (let i = 0; i < photos.length; i += 3) {
    response = await app.api.submitSiteTour({ ...baseRequest(app), siteTourPhotos: photos.slice(i, i + 3) });
    if (!isSuccess(response)) break;
  }
  return response;
}

export async function siteTourSubmitted(app: SaApp) {
  const d = app.details!;
  d.isSiteTourSubmitted = true;
  const zedId = d.companyProfile?.zedId ?? '';
  // SiteTourStatusHelper: only set when it was already set (as the legacy code did).
  if (app.prefs.get(PREFS.siteTourStatus, zedId) === 'true') app.prefs.setBoolean(PREFS.siteTourStatus, zedId, true);
  await app.update();
}

// ------------------------------------------------------------------ Parameters

/** checkQuestionsData: every requirement has a conformance. */
export function checkQuestionsData(p: AllottedParameters | null | undefined): boolean {
  if (!p?.requirements?.length) return false;
  return p.requirements.every(q => (q.conformance ?? '').trim() !== '');
}

/** ModelUtils.getAddedEvidences: the parameter's added evidences that are still on the phone. */
export async function addedEvidencesOf(app: SaApp, p: AllottedParameters): Promise<PhotoInformation[]> {
  const out: PhotoInformation[] = [];
  for (const r of p.requirements ?? []) {
    for (const e of r.addedEvidences ?? []) {
      if (e?.type === EVIDENCE_ADDED) {
        const stored = await app.store.evidence(app.userId, e.evidenceId);
        if (stored) out.push(stored);
      }
    }
  }
  return out;
}

/**
 * handleEvidencesSubmission: ALL added evidences of the assessment, two per SubmitEvidences request; each sent
 * evidence is deleted from the phone. Returns null when all were sent, else the refusal.
 */
export async function submitAddedEvidences(app: SaApp, onDeleteFailed?: () => void): Promise<ServiceResponse | null> {
  const evidences = await app.store.evidencesOfType(app.userId, EVIDENCE_ADDED);
  for (let i = 0; i < evidences.length; i += 2) {
    const photos = evidences.slice(i, i + 2);
    const r = await app.api.submitEvidences({ ...newAssessmentRequest(app), userType: app.details!.userType, addedEvidences: photos });
    if (!isSuccess(r)) return r ?? errorResponse(null);
    for (const p of photos) if (!(await app.store.deleteEvidence(app.userId, p.evidenceId))) onDeleteFailed?.();
  }
  return null;
}

/** submitParameter's background part: the evidences first (when the parameter has any), then SubmitParameter. */
export async function submitParameter(app: SaApp, p: AllottedParameters, onDeleteFailed?: () => void): Promise<ServiceResponse | null> {
  const added = await addedEvidencesOf(app, p);
  if (added.length > 0) {
    const refused = await submitAddedEvidences(app, onDeleteFailed);
    if (refused) return refused;
  }
  return app.api.submitParameter({ ...baseRequest(app), allottedParameterObj: p });
}

// ------------------------------------------------------------------ Closing meeting / final comments

/** FinalCommentsActivity.saveCloseMeetingData */
export async function saveCloseMeeting(app: SaApp, request: SubmitAssessmentRequest): Promise<boolean> {
  request.addedEvidences = null;
  const saved = await app.store.saveMeeting(app.userId, request, false);
  if (saved) {
    app.details!.isCloseMeetingSubmitted = true;
    await app.update();
  }
  return saved;
}

export function submitEndAssessment(app: SaApp, request: SubmitAssessmentRequest) {
  return app.api.submitEndAssessment(request);
}

// ------------------------------------------------------------------ Basic information

/**
 * BasicInfoViewModel.handleDataSubmission: SubmitBasicInformation, then each product's photos, one per
 * SubmitBasicInfoPhotos request. Answers the last response, or the first refusal / missing photo.
 * New: `customFields` and `formVersion` (Admin forms) travel next to the basic information.
 */
export async function submitBasicInformation(app: SaApp, info: BasicInformation): Promise<BaseServiceResponse> {
  const { basicInformation, form } = basicInfoForSubmit(info);
  let response: BaseServiceResponse;
  try {
    response = await app.api.submitBasicInfo({ ...baseRequest(app), basicInformation }, form);
  } catch (e) {
    return errorResponse(isNetworkError(e) ? e.message : (e as Error).message || UNKNOWN_ERROR);
  }
  if (!isSuccess(response)) return response;
  for (const product of basicInformation.productDetailsList) {
    const productPhotos = [product.productPhoto, product.productDescriptionPhoto].filter((p): p is PhotoData => p != null);
    let filled: PhotoData[];
    try {
      filled = await app.photos.fill(productPhotos, `${product.productName} product photos missing, please capture again`);
    } catch (e) {
      return errorResponse((e as Error).message);
    }
    for (const photo of filled) {
      try {
        response = await app.api.submitBasicInfoPhotos({ ...baseRequest(app), photos: [photo] });
      } catch (e) {
        return errorResponse((e as Error).message || UNKNOWN_ERROR);
      }
    }
  }
  return response;
}

/** The observers of BasicInformationActivity / SubmitParameters / FinalComments on success. */
export async function basicInfoSubmitted(app: SaApp) {
  const d = app.details!;
  if (d.saBasicInformation) d.saBasicInformation.status = Status.SUBMITTED;
  d.isBasicInfoSubmitted = true;
  app.prefs.setBoolean(PREFS.siteTourStatus, 'BasicInfo', true);
  await app.update();
}

export const needsBasicInfoFirst = (app: SaApp) => app.details!.userType === 1 && !isSaBasicInfoSubmitted(app.details!);

// ------------------------------------------------------------------ Attendance

/**
 * AttendanceViewModel.submitAttendanceData. The legacy marked the entry synced on any HTTP answer, also a refusal;
 * here only on success, so a refused entry stays pending.
 */
export async function submitAttendance(app: SaApp, a: Attendance): Promise<BaseServiceResponse> {
  const r = await app.api.submitAttendance(a, app.saId, app.zedId, app.certificationType);
  if (isSuccess(r)) {
    a.isSubmitted = true;
    await app.queue.remove(jobKey(app, 'attendance', a.time));
  }
  return r;
}

export function queueAttendance(app: SaApp, a: Attendance) {
  return app.queue.enqueue({
    kind: 'attendance',
    key: jobKey(app, 'attendance', a.time),
    group: `att:${app.userId}`,
    userId: app.userId,
    label: `Attendance ${a.attendanceType === 'LOGIN' ? 'Punch In' : 'Punch Out'}`,
    payload: { time: a.time, type: a.attendanceType },
  });
}
