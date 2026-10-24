import { basicInfoForSubmit, errorResponse, isNetworkError, isSuccess, type BaseServiceResponse } from '@zed/shared';
import type { SaApp } from '../app/SaApp';
import {
  EVIDENCE_ADDED,
  isFourthMilestone,
  isLead,
  isSaBasicInfoSubmitted,
  newPhotoInformation,
  removeIfPhotoExists,
  Status,
  SUBMITTED,
  UNKNOWN_ERROR,
  type AllottedParameters,
  type Attendance,
  type BaseServiceRequest,
  type BasicInformation,
  type BaselineDiagnosticStudyData,
  type CertificationDetails,
  type ConsultantPhoto,
  type ParametersDetails,
  type ParametersModule,
  type Participant,
  type PhotoInformation,
  type ServiceResponse,
  type SubmitAssessmentRequest,
  type ZedTrainingInfo,
} from '../models';
import { randomUuid } from '../util/uuid';

export function baseRequest(app: SaApp): BaseServiceRequest {
  return { saId: app.saId, zedId: app.zedId, certificationType: app.certificationType };
}

export function newAssessmentRequest(app: SaApp): SubmitAssessmentRequest {
  return { ...baseRequest(app), userType: 0 };
}

/** Keys of the sync queue jobs (one per kind and consultancy). */
export const jobKey = (app: SaApp, kind: string, id = '') => `${app.userId}:${kind}${id ? ':' + id : ''}`;

/** The message of a call that got no answer (the legacy showed the exception text). */
export const NO_NETWORK = 'Network not available';

export function failureMessage(e: unknown): string {
  if (isNetworkError(e)) return NO_NETWORK;
  return (e as Error)?.message || UNKNOWN_ERROR;
}

/** A refusal's message, or the legacy fallback. */
export const refusalMessage = (r: BaseServiceResponse | null | undefined, fallback = UNKNOWN_ERROR) => (r?.errorMessage?.trim() ? r.errorMessage : fallback);

// ------------------------------------------------------------------ Allocation

export function submitAllocation(app: SaApp, allocatedParameters: ParametersDetails[]) {
  return app.api.submitAllocation({ ...baseRequest(app), allocatedParameters });
}

// ------------------------------------------------------------------ Site photos and opening meeting (the OpenMeetingData row is the draft)

/** The saved opening meeting row, or a new request (SiteImagesCapturingActivity / MeetingDataCollectionActivity). */
export async function openMeetingRequest(app: SaApp): Promise<SubmitAssessmentRequest> {
  return (await app.store.meeting(app.userId, true)) ?? newAssessmentRequest(app);
}

/** SiteImagesCapturingActivity.proceed: both photos replace earlier ones in the saved row. */
export async function saveSitePhotos(app: SaApp, request: SubmitAssessmentRequest, exterior: PhotoInformation, interior: PhotoInformation): Promise<boolean> {
  request.assessmentPhotos ??= [];
  removeIfPhotoExists(request, exterior.name ?? '');
  request.assessmentPhotos.push(exterior);
  removeIfPhotoExists(request, interior.name ?? '');
  request.assessmentPhotos.push(interior);
  return app.store.saveMeeting(app.userId, request, true);
}

/** The opening meeting; technology upgradation (fourth milestone) uses the consultancy web site's address. */
export function submitOpenMeeting(app: SaApp, request: SubmitAssessmentRequest) {
  return app.api.submitStartAssessment(request, isFourthMilestone(app.details!));
}

/** openMeetingHandler on success: the row is cleared, the participants kept. */
export async function openMeetingSubmitted(app: SaApp, participants: Participant[]) {
  await app.store.clearMeeting(app.userId, true);
  await app.queue.remove(jobKey(app, 'openMeeting'));
  const d = app.details!;
  d.openMeetingParticipants = participants;
  d.isOpenMeetingSubmitted = true;
  await app.update();
}

/** submitData offline: the row is kept, the meeting marked submitted (sent later from Sync Data, and by the queue). */
export async function saveOpenMeetingOffline(app: SaApp, request: SubmitAssessmentRequest, participants: Participant[]): Promise<boolean> {
  const saved = await app.store.saveMeeting(app.userId, request, true);
  if (saved) {
    const d = app.details!;
    d.openMeetingParticipants = participants;
    d.isOpenMeetingSubmitted = true;
    await app.update();
    await queueOpenMeeting(app);
  }
  return saved;
}

export function queueOpenMeeting(app: SaApp) {
  return app.queue.enqueue({ kind: 'openMeeting', key: jobKey(app, 'openMeeting'), group: `sa:${app.userId}`, userId: app.userId, label: 'Opening Meeting' });
}

/**
 * Sync Data "Opening Meeting": sends the saved row; on success it is cleared. (The legacy then also marked the site
 * tour as submitted, which hid the site tour for good; not done here.)
 */
export async function syncOpenMeeting(app: SaApp): Promise<ServiceResponse | null> {
  const request = await app.store.meeting(app.userId, true);
  if (!request) return { status: '1' };
  const r = await submitOpenMeeting(app, request);
  if (isSuccess(r)) {
    await app.store.clearMeeting(app.userId, true);
    await app.queue.remove(jobKey(app, 'openMeeting'));
    await app.update();
  }
  return r;
}

// ------------------------------------------------------------------ Selfie (the legacy selfie screen; its saved data can still be on a phone)

export async function selfieSyncAllowed(app: SaApp): Promise<boolean> {
  const d = app.details!;
  return !isLead(d) || ((await app.store.meeting(app.userId, true)) == null && d.isOpenMeetingSubmitted);
}

export async function syncSelfie(app: SaApp): Promise<ServiceResponse | null> {
  const request = await app.store.selfie(app.userId);
  if (!request) return { status: '1' };
  const r = await app.api.submitSelfie(request);
  if (isSuccess(r)) await app.store.clearSelfie(app.userId);
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
  app.details!.isSiteTourSubmitted = true;
  await app.update();
}

// ------------------------------------------------------------------ Closing meeting / final comments

/**
 * handleEvidencesSubmission (FinalComments and Sync Data): all added evidences, three per SubmitEvidences request;
 * each sent evidence is deleted from the phone. Returns null when all were sent, else the refusal.
 */
export async function submitAddedEvidences(app: SaApp, userType: number, onDeleteFailed?: () => void): Promise<ServiceResponse | null> {
  const evidences = await app.store.evidencesOfType(app.userId, EVIDENCE_ADDED);
  for (let i = 0; i < evidences.length; i += 3) {
    const photos = evidences.slice(i, i + 3);
    const r = await app.api.submitEvidences({ ...newAssessmentRequest(app), userType, addedEvidences: photos });
    if (!isSuccess(r)) return r ?? errorResponse(null);
    for (const p of photos) if (!(await app.store.deleteEvidence(app.userId, p.evidenceId))) onDeleteFailed?.();
  }
  return null;
}

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

/** The added evidences, then SubmitEndAssessment (null when an evidence was refused: its message was shown). */
export async function submitEndAssessment(app: SaApp, request: SubmitAssessmentRequest, onEvidenceRefused: (message: string) => void): Promise<ServiceResponse | null> {
  const refused = await submitAddedEvidences(app, request.userType);
  if (refused) {
    onEvidenceRefused(refusalMessage(refused, 'Failed to submit data, Please try again'));
    return null;
  }
  return app.api.submitEndAssessment(request);
}

// ------------------------------------------------------------------ Basic information

/**
 * BasicInfoViewModel.handleDataSubmission: SubmitBasicInformation (this app sends no photos with it).
 * New: `customFields` and `formVersion` (Admin forms) travel next to the basic information.
 */
export async function submitBasicInformation(app: SaApp, info: BasicInformation): Promise<BaseServiceResponse> {
  const { basicInformation, form } = basicInfoForSubmit(info);
  try {
    return await app.api.submitBasicInfo({ ...baseRequest(app), basicInformation }, form);
  } catch (e) {
    return errorResponse(failureMessage(e));
  }
}

/** The observer of BasicInformationActivity (and FinalComments) on success. */
export async function basicInfoSubmitted(app: SaApp) {
  const d = app.details!;
  if (d.saBasicInformation) d.saBasicInformation.status = Status.SUBMITTED;
  d.isBasicInfoSubmitted = true;
  await app.update();
}

export const needsBasicInfoFirst = (app: SaApp) => isLead(app.details!) && !isSaBasicInfoSubmitted(app.details!);

// ------------------------------------------------------------------ Files (SubmitPhotos)

/**
 * The milestone screens' uploads: every photo the server has not taken yet (no filePath) goes to SubmitPhotos under
 * the section name, one per request, and keeps the path the server answers. Null when all are on the server, else the
 * message of the first failure.
 */
export async function uploadPhotos(app: SaApp, sectionName: string, photos: ConsultantPhoto[]): Promise<string | null> {
  for (const photo of photos) {
    if (photo.filePath && photo.filePath.trim() !== '') continue;
    try {
      const r = await app.api.submitPhotos(app.zedId, app.saId, app.certificationType, sectionName, photo);
      if (!r?.filePath) return refusalMessage(r);
      photo.filePath = r.filePath;
      photo.isUploadAttempted = false;
    } catch (e) {
      return failureMessage(e);
    }
  }
  return null;
}

// ------------------------------------------------------------------ Training on ZED / on the handholding implementation plan

/**
 * TrainingViewModel.submitTrainingOnZedData: the photos and attendance sheets first (SubmitPhotos, section = the
 * screen's title), then SubmitZedTrainingInfo / SubmitHouseholdingTrainingInfo. Null with the upload's failure message.
 */
export async function submitTraining(app: SaApp, info: ZedTrainingInfo, handholding: boolean): Promise<{ response: BaseServiceResponse | null; error?: string }> {
  const section = handholding ? 'Training on Handholding Implementation Plan' : 'Training on ZED';
  const failed = await uploadPhotos(app, section, [...(info.trainingPhoto ?? []), ...(info.attendanceSheet ?? [])]);
  if (failed) {
    await app.update();
    return { response: null, error: failed };
  }
  try {
    return { response: await app.api.submitTraining({ ...baseRequest(app), trainingInfo: info }, handholding) };
  } catch (e) {
    return { response: null, error: failureMessage(e) };
  } finally {
    await app.update();
  }
}

export async function trainingSubmitted(app: SaApp, info: ZedTrainingInfo) {
  info.status = Status.SUBMITTED;
  await app.update();
}

export function queueTraining(app: SaApp, handholding: boolean) {
  const kind = handholding ? 'handholdingTraining' : 'zedTraining';
  return app.queue.enqueue({ kind: 'training', key: jobKey(app, kind), group: `sa:${app.userId}`, userId: app.userId, label: handholding ? 'Training on Handholding Implementation Plan' : 'Training on ZED', payload: { handholding } });
}

// ------------------------------------------------------------------ Baseline diagnostic study, handholding action plan, technology intervention, progress review

/** The activities' TAG: the section of their uploads. */
export const MODULE_SECTION: Record<ParametersModule, string> = {
  baselineDiagnostic: 'BaselineDiagnosticStudy',
  handholdingActionPlan: 'HandholdingActionPlan',
  technologyIntervention: 'SuggestionForTechnologyIntervention',
  progressReview: 'ProgressReview',
};

/** processRequirementsSubmission: the parameter's evidences (uploads), then its submit call; SUBMITTED on success. */
export async function submitModuleParameter(app: SaApp, module: ParametersModule, parameter: AllottedParameters): Promise<string | null> {
  const photos = (parameter.requirements ?? []).flatMap(r => r.capturedEvidences ?? []);
  const failed = await uploadPhotos(app, MODULE_SECTION[module], photos);
  if (failed) {
    await app.update();
    return failed;
  }
  try {
    const r = await app.api.submitModuleParameter(module, { ...baseRequest(app), allottedParameterObj: parameter });
    if (!isSuccess(r)) return refusalMessage(r);
    parameter.status = SUBMITTED;
    return null;
  } catch (e) {
    return failureMessage(e);
  } finally {
    await app.update();
  }
}

/** ProgressReviewViewModel.submitSelfie: the file (section "Progress Review"), then SubmitSelfie with it. */
export async function submitProgressReviewSelfie(app: SaApp, data: BaselineDiagnosticStudyData): Promise<string | null> {
  const selfie = data.selfie;
  if (!selfie) return null;
  const failed = await uploadPhotos(app, 'Progress Review', [selfie]);
  if (failed) return failed;
  try {
    const r = await app.api.submitSelfieData({ ...baseRequest(app), selfie });
    return isSuccess(r) ? null : refusalMessage(r);
  } catch (e) {
    return failureMessage(e);
  } finally {
    await app.update();
  }
}

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

// ------------------------------------------------------------------ Technology upgradation

/** TechnologyUpgradationActivity.finalSubmit (after the pending opening meeting check). */
export async function technologyUpgradationSubmitted(app: SaApp) {
  app.details!.technologyUpgradationStatus = Status.SUBMITTED;
  await app.update();
}

export function finalSubmitTechnologyUpgradation(app: SaApp, details: CertificationDetails) {
  return app.api.financialAssistanceFinalSubmit(details);
}

/** PhotoInformation for the old pipeline's photos (site photos, meeting photos, site tour). */
export const newPhoto = () => newPhotoInformation(randomUuid);
