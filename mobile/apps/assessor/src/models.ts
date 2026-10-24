/**
 * The site assessor app's models (ZED_SA_Studio models/*, service/*) with the field names Gson writes, so the JSON the
 * legacy app kept in its database and the server's requests and answers stay the same.
 */
import type { BaseServiceResponse, PhotoData } from '@zed/shared';

// Constants (database/Constants.java)
export const TO_START = 0;
export const IN_PROGRESS = 1;
export const COMPLETED = 2;
export const SUBMITTED = 3;
export const YES = 'Yes';
export const NO = 'No';
export const MANDATORY = 'Mandatory';
export const OPTIONAL = 'Optional';
export const DATA_ERROR = 'Missing/Invalid Data';
export const UNKNOWN_ERROR = 'Unknown Error Occurred';
export const ENABLE_GPS_MESSAGE = 'Please Enable GPS/Location services';
export const FAILED_TO_SUBMIT = 'Failed to submit data, Please try again';
export const SAVED_LOCALLY = 'Network is not available. Data saved locally, you can submit later while syncing parameters';

/** models/Status (Kotlin enum, serialized by name). */
export enum Status {
  TO_START = 'TO_START',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  SUBMITTED = 'SUBMITTED',
}

/** EvidenceDataAccessObject.ADDED / SITE_TOUR */
export const EVIDENCE_ADDED = 1;
export const EVIDENCE_SITE_TOUR = 2;

/** models/PhotoInformation: the photos of the older screens, base64 kept in the JSON. */
export type PhotoInformation = {
  photoId: string;
  evidenceId?: string | null;
  photo?: string | null;
  timeStamp?: string | null;
  /** Evidence name */
  name?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  /** 1 added evidence, 2 site tour */
  type: number;
  comment?: string | null;
};

/** PhotoInformation(): UUID + "_" + millis. */
export function newPhotoInformation(randomUuid: () => string): PhotoInformation {
  return { photoId: `${randomUuid()}_${Date.now()}`, type: 0 };
}

export type Participant = { name?: string | null; designation?: string | null };

export type AssessorDetails = { assessorId?: string | null; assessorName?: string | null; userType?: string | null };

export type MSMEProfile = {
  saDate?: string | null;
  zedId?: string | null;
  msmeName?: string | null;
  sectorId?: string | null;
  sectorName?: string | null;
  unitAddress?: string | null;
  email?: string | null;
  phone?: string | null;
  osaScore?: string | null;
  daScore?: string | null;
};

export type ParametersDetails = {
  parameterId?: string | null;
  parameterCode?: string | null;
  parameterName?: string | null;
  assigneeName?: string | null;
  assigneeId?: string | null;
  isExcemptedFromSa: boolean;
};

export type Evidences = {
  evidenceId?: string | null;
  evidenceName?: string | null;
  evidenceType?: string | null;
  evidenceUrl?: string | null;
  evidenceReviewReason?: string | null;
  evidenceLocalUri?: string | null;
  isOpened: boolean;
};

export type Option = { id: number; code?: string | null; label?: string | null; origionalEvidences?: Evidences[] | null };

export type RequirementDetails = {
  id: string;
  questionDescription?: string | null;
  moreInfo?: string | null;
  previousSelectedOption?: string | null;
  providedEvidences?: Evidences[] | null;
  msmeOptionId?: string | null;
  msmeComment?: string | null;
  daComment?: string | null;
  msmeOption?: string | null;
  daOption?: string | null;
  daOptionId?: string | null;
  daStatus?: string | null;
  changedOptionId?: string | null;
  addedEvidences?: PhotoInformation[] | null;
  conformance?: string | null;
  changedOption?: string | null;
  options?: Option[] | null;
  comments?: string | null;
  reviewNeeded: boolean;
};

export type AllottedParameters = {
  parameterId?: string | null;
  parameterCode?: string | null;
  parameterName?: string | null;
  parameterType?: string | null;
  requirements?: RequirementDetails[] | null;
  /** 0 To Start, 1 In Progress, 2 Completed, 3 Submitted */
  status: number;
  isSelectedToSubmit: boolean;
};

export const isCompletedOrSubmitted = (p: AllottedParameters) => p.status === COMPLETED || p.status === SUBMITTED;

// Basic information (models/Models.kt)
export type ProductDetails = {
  id: string;
  productName?: string | null;
  exported?: string | null;
  productPhoto?: PhotoData | null;
  productDescriptionPhoto?: PhotoData | null;
};

export type RawMaterialDetails = {
  id: string;
  rawMaterialName?: string | null;
  rawMaterialPercentage?: string | null;
  countryName?: string | null;
};

export type BasicInformation = {
  auditsConducted?: string | null;
  productDetailsList: ProductDetails[];
  domesticCustomers?: string | null;
  internationalCustomers?: string | null;
  rawMaterialImported?: string | null;
  rawMaterialsList: RawMaterialDetails[];
  monthlyManufacturingCapacityUnits?: string | null;
  monthlyManufacturingCapacityValue?: string | null;
  monthlyUtilizationUnits?: string | null;
  monthlyUtilizationValue?: string | null;
  outsourcedProcesses?: string | null;
  energySources: string[];
  sitePhotosSubmitted: boolean;
  status: Status;
  // New (Admin forms, docs/mobile/APP-FORMS.md), kept with the draft on the phone and never sent inside it.
  customAnswers?: Record<string, unknown> | null;
  customFields?: Record<string, unknown> | null;
  formVersion?: string | null;
  omittedFields?: string[] | null;
  optionalFields?: string[] | null;
};

export function newBasicInformation(): BasicInformation {
  return { productDetailsList: [], rawMaterialsList: [], energySources: [], sitePhotosSubmitted: false, status: Status.IN_PROGRESS };
}

/** Lists Gson always wrote; guards against older or partial JSON. */
export function normalizeBasicInformation(b: BasicInformation): BasicInformation {
  b.productDetailsList ??= [];
  b.rawMaterialsList ??= [];
  b.energySources ??= [];
  b.sitePhotosSubmitted ??= false;
  b.status ??= Status.IN_PROGRESS;
  return b;
}

// Attendance (models/AttendanceData.kt)
export type AttendanceType = 'LOGIN' | 'LOGOUT';

export type Attendance = {
  selfie?: PhotoData | null;
  comments?: string | null;
  /** Gson Date in the local database: "yyyy-MM-dd'T'HH:mm:ssXXX". */
  time: string;
  attendanceType: AttendanceType;
  isSubmitted: boolean;
};

export type AttendanceData = { attendanceList: Attendance[] };

/** AssessmentDetails (extends LoginServiceResponse): the sign-in answer, kept and changed on the phone. */
export type AssessmentDetails = BaseServiceResponse & {
  names?: string[] | null;
  roleId?: number;
  /** 1 Lead Assessor, 2 Assessor */
  userType: number;
  companyProfile?: MSMEProfile | null;
  assessors?: AssessorDetails[] | null;
  inputParameters?: ParametersDetails[] | null;
  allottedParameters?: AllottedParameters[] | null;
  totalEvidences?: Evidences[] | null;
  isOpenMeetingSubmitted: boolean;
  isSelfieSubmitted: boolean;
  isCloseMeetingSubmitted: boolean;
  isSiteTourSubmitted: boolean;
  isBasicInfoSubmitted: boolean;
  allowFinalSubmit: boolean;
  certificationType?: string | null;
  openMeetingParticipants?: Participant[] | null;
  /** captured on the app */
  saBasicInformation?: BasicInformation | null;
  /** sent from the API */
  basicInformation?: BasicInformation | null;
  attendanceData?: AttendanceData | null;
  /** V4 surveillance deployment only (SA login answers it for Silver/Gold surveillance). */
  isSurveillance?: boolean;
  minimumParameters?: number;
};

/** Requests (service/*). Every request also carries `version` and `deviceInfo` (new). */
export type BaseServiceRequest = { saId: string; zedId: string; certificationType: string };

export type SubmitAssessmentRequest = BaseServiceRequest & {
  latitude?: string | null;
  longitude?: string | null;
  assessmentPhotos?: PhotoInformation[] | null;
  startParticipants?: Participant[] | null;
  endParticipants?: Participant[] | null;
  inputComment?: string | null;
  endComment?: string | null;
  addedEvidences?: PhotoInformation[] | null;
  userType: number;
};

export type SubmitSelfieImageRequest = BaseServiceRequest & { selfieImage?: PhotoInformation | null };

export type ServiceResponse = BaseServiceResponse & { refId?: string | null };

// ----- helpers of AssessmentDetails -----

export function normalizeDetails(d: AssessmentDetails): AssessmentDetails {
  d.userType = Number(d.userType ?? 0);
  for (const k of ['isOpenMeetingSubmitted', 'isSelfieSubmitted', 'isCloseMeetingSubmitted', 'isSiteTourSubmitted', 'isBasicInfoSubmitted', 'allowFinalSubmit'] as const) {
    d[k] = d[k] === true || (d[k] as unknown) === 'true' || (d[k] as unknown) === 1;
  }
  for (const p of d.allottedParameters ?? []) {
    if (!p) continue;
    p.status = Number(p.status ?? 0);
    p.isSelectedToSubmit = !!p.isSelectedToSubmit;
    if (p.parameterId != null) p.parameterId = String(p.parameterId);
    for (const r of p.requirements ?? []) {
      r.id = String(r.id);
      r.reviewNeeded = !!r.reviewNeeded;
      for (const o of r.options ?? []) if (o) o.id = Number(o.id ?? 0);
    }
  }
  for (const p of d.inputParameters ?? []) if (p) p.isExcemptedFromSa = !!p.isExcemptedFromSa;
  if (d.saBasicInformation) normalizeBasicInformation(d.saBasicInformation);
  if (d.basicInformation) normalizeBasicInformation(d.basicInformation);
  d.attendanceData ??= { attendanceList: [] };
  d.attendanceData.attendanceList ??= [];
  return d;
}

export const isSaBasicInfoSubmitted = (d: AssessmentDetails) => d.isBasicInfoSubmitted || d.saBasicInformation?.status === Status.SUBMITTED;
export const isSaBasicInfoCompleted = (d: AssessmentDetails) => isSaBasicInfoSubmitted(d) || d.saBasicInformation?.status === Status.COMPLETED;

export function areAllParametersCompletedOrSubmitted(d: AssessmentDetails): boolean {
  if (d.allowFinalSubmit) return true;
  return (d.allottedParameters ?? []).every(p => !p || isCompletedOrSubmitted(p));
}

export function areAllParametersSubmitted(d: AssessmentDetails): boolean {
  if (d.allowFinalSubmit) return true;
  return (d.allottedParameters ?? []).every(p => !p || p.status === SUBMITTED);
}

/** setAllParametersToCompleted (it sets SUBMITTED, as the legacy method did). */
export function setAllParametersToCompleted(d: AssessmentDetails) {
  for (const p of d.allottedParameters ?? []) if (p) p.status = SUBMITTED;
}
