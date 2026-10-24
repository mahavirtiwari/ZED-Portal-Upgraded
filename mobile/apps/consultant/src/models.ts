/**
 * The handholding consultant app's models (ZEDConsultant models/*, service/*) with the field names Gson writes, so the
 * JSON the legacy app kept in its database and the server's requests and answers stay the same.
 */
import type { BaseServiceResponse, PhotoData } from '@zed/shared';

// Constants (database/Constants.java)
export const TO_START = 0;
export const IN_PROGRESS = 1;
export const COMPLETED = 2;
export const SUBMITTED = 3;
export const YES = 'Yes';
export const NO = 'No';
export const PARTIAL = 'Partial';
export const MANDATORY = 'Mandatory';
export const DATA_ERROR = 'Missing/Invalid Data';
export const UNKNOWN_ERROR = 'Unknown Error Occurred';
export const PLEASE_ENTER_DETAILS = 'Please enter required details';
export const NOT_COMPLETED = 'Not completed';
export const IN_PROGRESS_TEXT = 'In Progress';
export const COMPLETED_TEXT = 'Completed';
export const SUBMITTED_TEXT = 'Submitted';
export const ENABLE_GPS_MESSAGE = 'Please Enable GPS/Location services';
export const FAILED_TO_SUBMIT = 'Failed to submit data, Please try again';
export const SAVED_LOCALLY = 'Network is not available. Data saved locally, you can submit later while syncing parameters';
/** strings.xml network_not_available_data_saved_locally */
export const NETWORK_SAVED_LOCALLY = 'Network not available, your data will be saved locally.';
export const DATA_SUBMITTED = 'Data submitted successfully';
export const OPENING_MEETING_PENDING = 'Opening meeting is pending';
export const ATTENDANCE_ALERT = 'Please log the attendance today to proceed';
export const BRONZE = 'Bronze';
export const SILVER = 'Silver';
export const GOLD = 'Gold';

/** models/Status (Kotlin enum, serialized by name). */
export enum Status {
  TO_START = 'TO_START',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  SUBMITTED = 'SUBMITTED',
}

/** Utils.getTextStatus */
export function textStatus(status: Status | null | undefined): string | null {
  switch (status) {
    case Status.TO_START:
      return NOT_COMPLETED;
    case Status.IN_PROGRESS:
      return IN_PROGRESS_TEXT;
    case Status.COMPLETED:
      return COMPLETED_TEXT;
    case Status.SUBMITTED:
      return SUBMITTED_TEXT;
    default:
      return null;
  }
}

/** HomeMenuStatus: the status of a dashboard item. */
export type HomeMenuStatus = { status: Status };

/** HomeMenuStatus.getStringStatus */
export function stringStatus(s: HomeMenuStatus | null | undefined): string | null {
  if (!s) return null;
  return s.status === Status.COMPLETED ? COMPLETED_TEXT : s.status === Status.SUBMITTED ? SUBMITTED_TEXT : NOT_COMPLETED;
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

/** models/PhotoData of this app: the file's path on the server once SubmitPhotos took it. */
export type ConsultantPhoto = PhotoData & { filePath?: string | null; isUploadAttempted?: boolean };

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
  bdsFromDate?: string | null;
  bdsToDate?: string | null;
  hapFromDate?: string | null;
  hapToDate?: string | null;
  address?: string | null;
  districtName?: string | null;
  stateName?: string | null;
  pincode?: string | null;
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
  isOpened: boolean;
};

export type Option = { id: number; code?: string | null; label?: string | null; subOptions?: Option[] | null };

export type RequirementDetails = {
  id: string;
  code?: string | null;
  questionDescription?: string | null;
  options?: Option[] | null;
  conformance?: string | null;
  comments?: string | null;
  reviewNeeded: boolean;
  addedEvidences?: PhotoInformation[] | null;
  capturedEvidences?: ConsultantPhoto[] | null;
  /** Baseline diagnostic study */
  gapsIdentified?: string[] | null;
  /** Handholding action plan */
  plannedActivities?: string[] | null;
  estimatedTimeInDays?: string | null;
  /** Suggestion for technology intervention */
  suggestedTechnologyIntervention?: string[] | null;
  technologyInterventionRationale?: string | null;
  /** Progress review */
  isProposedActivityCompleted?: string | null;
};

const blank = (s: string | null | undefined) => s == null || s.trim() === '';
const empty = (l: unknown[] | null | undefined) => l == null || l.length === 0;

/** RequirementDetails validation methods */
export function isBaselineDiagnosticInfoValid(r: RequirementDetails): boolean {
  if (blank(r.conformance)) return false;
  if ((r.conformance === YES || r.conformance === PARTIAL) && empty(r.capturedEvidences)) return false;
  return r.conformance === YES || !empty(r.gapsIdentified);
}

export const isSuggestionForTechnologyInterventionValid = (r: RequirementDetails) =>
  !empty(r.suggestedTechnologyIntervention) && !blank(r.technologyInterventionRationale);

export const isHandholdingActionPlanValid = (r: RequirementDetails) => !empty(r.plannedActivities) && !blank(r.estimatedTimeInDays);

export const isProgressReviewValid = (r: RequirementDetails) =>
  !blank(r.isProposedActivityCompleted) && (r.isProposedActivityCompleted === NO || !empty(r.capturedEvidences));

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

/** The four milestone screens that work on copies of the allotted parameters. */
export type ParametersModule = 'baselineDiagnostic' | 'handholdingActionPlan' | 'technologyIntervention' | 'progressReview';

/** AllottedParameters.onRequirementUpdated */
export function onRequirementUpdated(p: AllottedParameters, module: ParametersModule) {
  const reqs = p.requirements ?? [];
  if (module === 'handholdingActionPlan') {
    p.status = reqs.every(isHandholdingActionPlanValid) ? COMPLETED : IN_PROGRESS;
    return;
  }
  if (module === 'technologyIntervention') {
    p.status = reqs.every(isSuggestionForTechnologyInterventionValid) ? COMPLETED : IN_PROGRESS;
    return;
  }
  if (module === 'progressReview') {
    p.status = reqs.every(isProgressReviewValid) ? COMPLETED : IN_PROGRESS;
    return;
  }
  if (reqs.every(r => r.conformance == null)) {
    p.status = TO_START;
    return;
  }
  if (reqs.every(r => r.conformance != null && !r.reviewNeeded)) {
    p.status = COMPLETED;
    return;
  }
  p.status = IN_PROGRESS;
}

/** BaseParametersData (HomeMenuStatus with the screen's copy of the parameters). */
export type BaseParametersData = HomeMenuStatus & { parameters: AllottedParameters[] };
/** BaselineDiagnosticStudyData: also the consultant's selfie (progress review). */
export type BaselineDiagnosticStudyData = BaseParametersData & { selfie?: ConsultantPhoto | null };

/** ZedTrainingInfo (Training on ZED and Training on Handholding Implementation Plan). */
export type ZedTrainingInfo = HomeMenuStatus & {
  trainingTopic?: string | null;
  trainingDate?: string | null;
  trainingTime?: string | null;
  remarks?: string | null;
  trainingPhoto?: ConsultantPhoto[] | null;
  attendanceSheet?: ConsultantPhoto[] | null;
};

export const isTrainingValid = (t: ZedTrainingInfo) =>
  !(blank(t.trainingTopic) || blank(t.trainingDate) || blank(t.trainingTime) || blank(t.remarks) || empty(t.trainingPhoto) || empty(t.attendanceSheet));

// ----- Basic information (models/Models.kt): nine groups, each a BasicInfoParameter with its own status -----

export type BasicInfoParameter = { label: string; status: HomeMenuStatus } & Record<string, unknown>;

/** The groups in their legacy order with their labels (BasicInformation.loadParameters). */
export const BASIC_INFO_GROUPS = [
  ['occupationalSafety', 'Occupational (Workplace) Safety'],
  ['measurementOfTimelyDelivery', 'Measurement of Timely Delivery'],
  ['plannedMaintenanceCalibration', 'Planned Maintenance & Calibration'],
  ['energyManagement', 'Energy Management'],
  ['environmentManagement', 'Environment Management'],
  ['humanResourceManagement', 'Human Resource Management'],
  ['measurementAnalysis', 'Measurement & Analysis'],
  ['naturalResourcesManagement', 'Natural Resources Management'],
  ['financialPerformance', 'Financial Performance (Previous Financial Year)'],
] as const;

export type BasicInfoGroup = (typeof BASIC_INFO_GROUPS)[number][0];

/** EnergyManagement's Parameter (unit and % of total consumption) for each source. */
export const ENERGY_SOURCES = ['electrical', 'solar', 'wind', 'fossilFuel', 'gas', 'others'] as const;

export type BasicInformation = HomeMenuStatus &
  Record<BasicInfoGroup, BasicInfoParameter> & {
    // New (Admin forms, docs/mobile/APP-FORMS.md), kept with the draft on the phone and never sent inside it.
    customAnswers?: Record<string, unknown> | null;
    customFields?: Record<string, unknown> | null;
    formVersion?: string | null;
    omittedFields?: string[] | null;
    optionalFields?: string[] | null;
  };

export function newBasicInformation(): BasicInformation {
  return normalizeBasicInformation({ status: Status.TO_START } as unknown as BasicInformation);
}

/** Groups Gson always wrote (each with its label and status); guards against older or partial JSON. */
export function normalizeBasicInformation(b: BasicInformation): BasicInformation {
  const rec = b as unknown as Record<string, unknown>;
  for (const [key, label] of BASIC_INFO_GROUPS) {
    const g = (rec[key] ??= {}) as BasicInfoParameter;
    g.label ??= label;
    g.status ??= { status: Status.TO_START };
    g.status.status ??= Status.TO_START;
    if (key === 'energyManagement') for (const s of ENERGY_SOURCES) g[s] ??= {};
  }
  b.status ??= Status.TO_START;
  return b;
}

export const basicInfoGroups = (b: BasicInformation): BasicInfoParameter[] => BASIC_INFO_GROUPS.map(([key]) => b[key]);

/** BasicInformation.getUpdatedStatus */
export function updatedBasicInfoStatus(b: BasicInformation): Status {
  const groups = basicInfoGroups(b);
  b.status = groups.every(g => g.status.status === Status.COMPLETED)
    ? Status.COMPLETED
    : groups.every(g => g.status.status === Status.SUBMITTED)
      ? Status.SUBMITTED
      : Status.IN_PROGRESS;
  return b.status;
}

/** HomeMenuStatus.getStringStatus of the basic information (which first refreshes its status). */
export function basicInfoStringStatus(b: BasicInformation | null | undefined): string | null {
  if (!b) return null;
  updatedBasicInfoStatus(b);
  return stringStatus(b);
}

// Attendance (models/AttendanceData.kt)
export type AttendanceType = 'LOGIN' | 'LOGOUT';

export type Attendance = {
  selfie?: ConsultantPhoto | null;
  comments?: string | null;
  /** Gson Date in the local database (DateFormat.FULL: "Saturday, October 24, 2026 at 7:17:00 PM"). */
  time: string;
  attendanceType: AttendanceType;
  isSubmitted: boolean;
};

export type AttendanceData = { attendanceList: Attendance[] };

/** AssessmentDetails (extends LoginServiceResponse): the sign-in answer, kept and changed on the phone. */
export type AssessmentDetails = BaseServiceResponse & {
  /** 1 Lead Consultant, 2 Consultant */
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
  certificationType?: string | null;
  openMeetingParticipants?: Participant[] | null;
  /** captured on the app */
  saBasicInformation?: BasicInformation | null;
  zedTrainingInfo?: ZedTrainingInfo | null;
  handholdingTraining?: ZedTrainingInfo | null;
  baselineDiagnosticStudyData?: BaselineDiagnosticStudyData | null;
  handholdingActionPlanData?: BaseParametersData | null;
  suggestionForTechnologyIntervention?: BaseParametersData | null;
  progressReview?: BaselineDiagnosticStudyData | null;
  attendanceData?: AttendanceData | null;
  /** 1 to 3: handholding milestones; 4: technology upgradation verification (DFO). */
  milestone: number;
  technologyUpgradationStatus: Status;
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

/** SubmitAssessmentRequest.SITE_EXTERIOR_PHOTO / SITE_INTERIOR_PHOTO */
export const SITE_EXTERIOR_PHOTO = 'Site Exterior Photo';
export const SITE_INTERIOR_PHOTO = 'Site Interior Photo';

/** SubmitAssessmentRequest.hasSitePhotos: both site photos (exactly two named so). */
export function hasSitePhotos(r: SubmitAssessmentRequest | null | undefined): boolean {
  return (r?.assessmentPhotos ?? []).filter(p => p?.name === SITE_EXTERIOR_PHOTO || p?.name === SITE_INTERIOR_PHOTO).length === 2;
}

export function requestPhoto(r: SubmitAssessmentRequest | null | undefined, name: string): PhotoInformation | null {
  return (r?.assessmentPhotos ?? []).find(p => p?.name === name) ?? null;
}

/** SubmitAssessmentRequest.removeIfPhotoExists (removes those whose name contains the type, as the legacy loop). */
export function removeIfPhotoExists(r: SubmitAssessmentRequest, photoType: string) {
  r.assessmentPhotos = (r.assessmentPhotos ?? []).filter(p => !(p?.name ?? '').includes(photoType));
}

export type SubmitSelfieImageRequest = BaseServiceRequest & { selfieImage?: PhotoInformation | null };

export type ServiceResponse = BaseServiceResponse & { refId?: string | null };

// ----- helpers of AssessmentDetails -----

export const isLead = (d: AssessmentDetails) => d.userType === 1;
export const isFirstMilestone = (d: AssessmentDetails) => d.milestone === 1;
export const isThirdMilestone = (d: AssessmentDetails) => d.milestone === 3;
export const isFourthMilestone = (d: AssessmentDetails) => d.milestone === 4;

const STATUS_VALUES = new Set<string>(Object.values(Status));
const status = (s: unknown): Status => (typeof s === 'string' && STATUS_VALUES.has(s) ? (s as Status) : Status.TO_START);

function normalizeParameters(list: AllottedParameters[] | null | undefined) {
  for (const p of list ?? []) {
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
}

function normalizeMenuStatus<T extends HomeMenuStatus>(s: T | null | undefined): T | null | undefined {
  if (s) s.status = status(s.status);
  return s;
}

export function normalizeDetails(d: AssessmentDetails): AssessmentDetails {
  d.userType = Number(d.userType ?? 0);
  d.milestone = Number(d.milestone ?? 0);
  for (const k of ['isOpenMeetingSubmitted', 'isSelfieSubmitted', 'isCloseMeetingSubmitted', 'isSiteTourSubmitted', 'isBasicInfoSubmitted'] as const) {
    d[k] = d[k] === true || (d[k] as unknown) === 'true' || (d[k] as unknown) === 1;
  }
  normalizeParameters(d.allottedParameters);
  for (const p of d.inputParameters ?? []) if (p) p.isExcemptedFromSa = !!p.isExcemptedFromSa;
  for (const k of ['baselineDiagnosticStudyData', 'handholdingActionPlanData', 'suggestionForTechnologyIntervention', 'progressReview'] as const) {
    const data = normalizeMenuStatus(d[k]);
    if (data) normalizeParameters((data.parameters ??= []));
  }
  normalizeMenuStatus(d.zedTrainingInfo);
  normalizeMenuStatus(d.handholdingTraining);
  if (d.saBasicInformation) normalizeBasicInformation(normalizeMenuStatus(d.saBasicInformation)!);
  d.technologyUpgradationStatus = status(d.technologyUpgradationStatus);
  d.attendanceData ??= { attendanceList: [] };
  d.attendanceData.attendanceList ??= [];
  return d;
}

const submitted = (s: HomeMenuStatus | null | undefined) => s?.status === Status.SUBMITTED;
const completed = (s: HomeMenuStatus | null | undefined) => s?.status === Status.COMPLETED;

export const isSaBasicInfoSubmitted = (d: AssessmentDetails) => d.isBasicInfoSubmitted || submitted(d.saBasicInformation);
export const isSaBasicInfoCompleted = (d: AssessmentDetails) => isSaBasicInfoSubmitted(d) || completed(d.saBasicInformation);
export const isZedTrainingInfoSubmitted = (d: AssessmentDetails) => submitted(d.zedTrainingInfo);
export const isZedTrainingInfoCompleted = (d: AssessmentDetails) => isZedTrainingInfoSubmitted(d) || completed(d.zedTrainingInfo);
export const isBaselineDiagnosticStudySubmitted = (d: AssessmentDetails) => submitted(d.baselineDiagnosticStudyData);
export const isBaselineDiagnosticStudyCompleted = (d: AssessmentDetails) => isBaselineDiagnosticStudySubmitted(d) || completed(d.baselineDiagnosticStudyData);
/** The legacy checks of the two optional sections are switched off (always true). */
export const isHandholdingActionPlanSubmitted = (_d: AssessmentDetails) => true;
export const isSuggestionForTechnologyInterventionSubmitted = (_d: AssessmentDetails) => true;
export const isHandholdingTrainingSubmitted = (d: AssessmentDetails) => submitted(d.handholdingTraining);
export const isHandholdingTrainingCompleted = (d: AssessmentDetails) => isHandholdingTrainingSubmitted(d) || completed(d.handholdingTraining);
export const isProgressReviewSubmitted = (d: AssessmentDetails) => submitted(d.progressReview);
export const isProgressReviewCompleted = (d: AssessmentDetails) => isProgressReviewSubmitted(d) || completed(d.progressReview);

/** AssessmentDetails.allowCloseMeetingSubmission */
export function allowCloseMeetingSubmission(d: AssessmentDetails): boolean {
  if (isFirstMilestone(d)) {
    const ok = isBaselineDiagnosticStudySubmitted(d) && isSuggestionForTechnologyInterventionSubmitted(d);
    if (!isLead(d)) return ok;
    return ok && d.isOpenMeetingSubmitted && isZedTrainingInfoSubmitted(d) && isSaBasicInfoSubmitted(d) && isHandholdingActionPlanSubmitted(d) && isHandholdingTrainingSubmitted(d);
  }
  const ok = isProgressReviewSubmitted(d);
  if (!isLead(d)) return ok;
  return ok && d.isOpenMeetingSubmitted && isSaBasicInfoSubmitted(d) && isHandholdingTrainingSubmitted(d);
}

/** AssessmentDetails.allowCloseMeetingCapturing */
export function allowCloseMeetingCapturing(d: AssessmentDetails): boolean {
  if (isFirstMilestone(d)) {
    // ZED Training Info and Basic Info are not required for a co-consultant.
    const ok = isBaselineDiagnosticStudyCompleted(d);
    if (!isLead(d)) return ok;
    return ok && isZedTrainingInfoCompleted(d) && isSaBasicInfoCompleted(d) && isHandholdingTrainingCompleted(d);
  }
  const ok = isProgressReviewCompleted(d);
  if (!isLead(d)) return ok;
  return ok && isHandholdingTrainingCompleted(d);
}

// ----- Technology upgradation (FinancialAssistance, consultancy web site) -----

export type CertificationDetails = {
  Id?: number | null;
  ZedId?: string | null;
  CategoryOfCertificate?: string | null;
  NameOfCertficate?: string | null;
  CertificationAgency?: string | null;
  CertficateNumber?: string | null;
  DateOfIssue?: string | null;
  ValidityOfCertificate?: string | null;
  ExpenditureCertficate?: string | null;
  AgencyOrSupplier?: string | null;
  InvoiceNo?: string | null;
  InvoiceBillDate?: string | null;
  AmountPaid?: string | null;
  AccountNo?: string | null;
  IfscCode?: string | null;
  BranchAddress?: string | null;
  CreatedDate?: string | null;
  SubmittedFrom?: string | null;
  ModeOfPayment?: string | null;
  BankName?: string | null;
  EligibleAmount?: string | null;
  certificationType?: string | null;
  VerificationStatus?: number | null;
  CertificationBodyUserId?: string | null;
  FinancialAssessorId?: string | null;
  ReasonForRejection?: string | null;
  /** 0 pending, 1 accepted, 2 rejected */
  IsApproved?: number | null;
  FinancialAssistanceId?: number | null;
  ReasonForRejectionAgency?: string | null;
  ApproverDateOfReceiptOfPayment?: string | null;
  Comments?: string | null;
  AnyOtherInformation?: string | null;
  EligibleSubsidyPer?: number | null;
  MaxEligibleSubsidy?: number | null;
};

export type FinancialAssistanceDocument = {
  Id?: number | null;
  ZedId?: string | null;
  PhotoId?: string | null;
  Name?: string | null;
  TimeStamp?: string | null;
  PhotoType?: string | null;
  CreatedDate?: string | null;
  CertificationType?: string | null;
  DocumentOpenedTime?: string | null;
  FinancialAssistanceId?: number | null;
  IsVerified?: string | null;
  AssessorRemarks?: string | null;
  SourceOfValidation?: string | null;
  TechnologyCode?: string | null;
  /** On the phone only */
  uploadedAttachments?: ConsultantPhoto[] | null;
  isValidateClicked?: boolean;
};

export type TechnologyDetails = {
  Id?: string | null;
  ZedId?: string | null;
  CertId?: string | null;
  NameOfTheManufaturer?: string | null;
  MakeOrModelName?: string | null;
  DateOfPurchase?: string | null;
  AgencyOrSupplier?: string | null;
  CreatedDate?: string | null;
  SubmittedFrom?: string | null;
  CertificationType?: string | null;
  FinancialAssistanceId?: number | null;
  InvoiceNo?: string | null;
  InvoiceBillDate?: string | null;
  AmountPaid?: string | null;
  EligibleAmount?: string | null;
  ModeOfPayment?: string | null;
  TechDetailsId?: string | null;
  TechnologyCode?: string | null;
  TechnologyName?: string | null;
  MsmeAmountPaid?: number | null;
  /** On the phone only */
  isCompleted?: boolean;
};

/** FinancialAssistanceDetailsResponse: the procedure's tables (Table, Table1, ...). */
export type FinancialAssistanceDetailsResponse = Record<string, unknown[] | undefined> & {
  Table?: CertificationDetails[];
  Table1?: CertificationDetails[];
  Table2?: CertificationDetails[];
  Table3?: FinancialAssistanceDocument[];
  Table4?: FinancialAssistanceDocument[];
  Table5?: FinancialAssistanceDocument[];
  Table10?: TechnologyDetails[];
  Table11?: TechnologyDetails[];
};

export const COPY_OF_CERTIFICATE = 'Copy of Certificate';
export const CA_CERTIFICATE = 'CA certificate of expenditure';
export const COPY_OF_INVOICE = 'Copy of Invoice';
export const COPY_OF_CANCELLED_CHEQUE = 'Copy of Cancelled Cheque';
export const PURCHASED_TECHNOLOGY = 'Purchased Technology';

const sameName = (a: string | null | undefined, b: string) => (a ?? '').toLowerCase() === b.toLowerCase();

export const tu = {
  certificationDetails(r: FinancialAssistanceDetailsResponse, cert: string): CertificationDetails | null {
    const t = cert === BRONZE ? r.Table : cert === SILVER ? r.Table1 : cert === GOLD ? r.Table2 : undefined;
    return t?.[0] ?? null;
  },
  documents(r: FinancialAssistanceDetailsResponse, cert: string): FinancialAssistanceDocument[] | null {
    return (cert === BRONZE ? r.Table3 : cert === SILVER ? r.Table4 : cert === GOLD ? r.Table5 : undefined) ?? null;
  },
  technologies(r: FinancialAssistanceDetailsResponse, cert: string): TechnologyDetails[] | null {
    return (cert === SILVER ? r.Table10 : cert === GOLD ? r.Table11 : undefined) ?? null;
  },
  copyOfCertificate: (r: FinancialAssistanceDetailsResponse, cert: string) => tu.documents(r, cert)?.find(d => sameName(d.Name, COPY_OF_CERTIFICATE)) ?? null,
  copyOfInvoice: (r: FinancialAssistanceDetailsResponse, cert: string, code: string) =>
    tu.documents(r, cert)?.find(d => sameName(d.Name, COPY_OF_INVOICE) && d.TechnologyCode === code) ?? null,
  copyOfCancelledCheque: (r: FinancialAssistanceDetailsResponse, cert: string) => tu.documents(r, cert)?.find(d => sameName(d.Name, COPY_OF_CANCELLED_CHEQUE)) ?? null,
  purchasedTechnology: (r: FinancialAssistanceDetailsResponse, cert: string, code: string) =>
    tu.documents(r, cert)?.find(d => sameName(d.Name, PURCHASED_TECHNOLOGY) && d.TechnologyCode === code) ?? null,
  /** isAnyDocumentRejectedForTechnology */
  isAnyDocumentRejected(r: FinancialAssistanceDetailsResponse, cert: string, code: string): boolean {
    return tu.purchasedTechnology(r, cert, code)?.IsVerified !== YES || tu.copyOfInvoice(r, cert, code)?.IsVerified !== YES;
  },
};

export const shouldAskForAttachments = (d: FinancialAssistanceDocument, code: string) =>
  sameName(d.Name, COPY_OF_CERTIFICATE) ||
  sameName(d.Name, COPY_OF_CANCELLED_CHEQUE) ||
  (sameName(d.Name, COPY_OF_INVOICE) && d.TechnologyCode === code) ||
  (sameName(d.Name, PURCHASED_TECHNOLOGY) && d.TechnologyCode === code);

/** FinancialAssistanceDocument.hasVerificationData */
export function hasVerificationData(d: FinancialAssistanceDocument): boolean {
  if (d.IsVerified !== YES) return !blank(d.IsVerified) && !blank(d.AssessorRemarks);
  return !blank(d.IsVerified);
}

/** FinancialAssistanceDocument.validateVerificationData */
export function validateVerificationData(d: FinancialAssistanceDocument, code: string): boolean {
  if (!hasVerificationData(d)) return false;
  if (d.IsVerified === YES) return !(shouldAskForAttachments(d, code) && empty(d.uploadedAttachments));
  d.uploadedAttachments = [];
  return true;
}

/** CertificationDetails.isAccepted: null while pending. */
export const isAccepted = (c: CertificationDetails) => (c.IsApproved === 0 || c.IsApproved == null ? null : c.IsApproved === 1);

/** Utils.formatToHaveTwoDecimalPlaces */
export function twoDecimals(amount: string | number | null | undefined): string | null {
  if (amount == null || (typeof amount === 'string' && amount.trim() === '')) return null;
  const n = typeof amount === 'number' ? amount : Number(amount);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}
