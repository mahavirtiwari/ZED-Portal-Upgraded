/**
 * The consultant app's calls (service/ServiceProxy + RestHelper, network/WebService, ConsultancyWebService,
 * MobileApiWebService) with the same paths and shapes, on V4: the consultancy mobile API `consultancymobileapi/SA/`,
 * the consultancy web site `Consultancy/FinancialAssistance/` (technology upgradation) and the Main mobile API's
 * `mobileapi/photos/` (technology upgradation documents). Every request also carries `version` and `deviceInfo`
 * (the legacy app never sent them).
 */
import {
  apiBase,
  contextFields,
  fileUri,
  HttpClient,
  type AppTextsResponse,
  type BaseServiceResponse,
  type Environment,
  type FormDefinition,
  type MultipartField,
  type RequestContext,
} from '@zed/shared';
import type {
  AllottedParameters,
  Attendance,
  AssessmentDetails,
  BaseServiceRequest,
  BasicInformation,
  CertificationDetails,
  ConsultantPhoto,
  FinancialAssistanceDetailsResponse,
  ParametersDetails,
  ParametersModule,
  PhotoInformation,
  ServiceResponse,
  SubmitAssessmentRequest,
  SubmitSelfieImageRequest,
  ZedTrainingInfo,
} from './models';

/** RestHelper: 300 s connect and read timeouts (whole meetings with base64 photos). */
const REST_TIMEOUT_MS = 300_000;
/** RetrofitProvider: 60 s. */
const RETROFIT_TIMEOUT_MS = 60_000;

export type LoginRequest = { password: string; version: string; zedId: string; assessorId: string };

/** network/FileRepository FileUploadResponse */
export type FileUploadResponse = BaseServiceResponse & { fileName?: string | null; filePath?: string | null };

/**
 * The three hosts. In production and staging one site serves all three; on the developer PC each V4 project runs on
 * its own port (consultancy mobile host 5105, consultancy portal 5102, Main mobile host 5104), reached from the
 * emulator through 10.0.2.2.
 */
export type ConsultantHosts = { sa: string; web: string; mobile: string };

export function consultantHosts(env: Environment): ConsultantHosts {
  if (env.name === 'local') {
    return {
      sa: 'http://10.0.2.2:5105/consultancymobileapi/',
      web: 'http://10.0.2.2:5102/Consultancy/',
      mobile: 'http://10.0.2.2:5104/mobileapi/',
    };
  }
  return { sa: apiBase(env, 'consultancymobileapi/'), web: apiBase(env, 'Consultancy/'), mobile: apiBase(env, 'mobileapi/') };
}

/** Utils.getExtensionFromPath */
const extensionOf = (path: string) => (path.lastIndexOf('.') >= 0 ? path.substring(path.lastIndexOf('.')) : '');

const file = (p: ConsultantPhoto) => {
  const path = p.photoPath ?? '';
  return { uri: fileUri(path), name: p.photoId + extensionOf(path.split('/').pop() ?? ''), type: p.isPdf ? 'application/pdf' : 'image/*' };
};

const PARAMETER_ACTIONS: Record<ParametersModule, string> = {
  baselineDiagnostic: 'SubmitBaselineDiagnostic',
  handholdingActionPlan: 'SubmitHandholdingActionPlan',
  technologyIntervention: 'SubmitTechnologyIntervention',
  progressReview: 'SubmitProgressReview',
};

export class SaApi {
  readonly rest: HttpClient;
  readonly retrofit: HttpClient;
  readonly hosts: ConsultantHosts;
  private readonly base: string;

  constructor(
    env: Environment,
    private readonly ctx: () => RequestContext,
    http?: { rest?: HttpClient; retrofit?: HttpClient },
  ) {
    this.rest = http?.rest ?? new HttpClient({ timeoutMs: REST_TIMEOUT_MS });
    this.retrofit = http?.retrofit ?? new HttpClient({ timeoutMs: RETROFIT_TIMEOUT_MS });
    this.hosts = consultantHosts(env);
    this.base = this.hosts.sa + 'SA/';
  }

  /** The request with the context fields (deviceInfo is left out when unknown). */
  private body<T extends object>(fields: T): T & { version: string } {
    const c = this.ctx();
    const req: Record<string, unknown> = { ...fields, version: c.version };
    if (c.deviceInfo) req.deviceInfo = c.deviceInfo;
    return req as T & { version: string };
  }

  login(request: Omit<LoginRequest, 'version'>) {
    return this.rest.postJson<AssessmentDetails>(this.base + 'Login', this.body(request));
  }

  submitAllocation(req: BaseServiceRequest & { allocatedParameters: ParametersDetails[] }) {
    return this.rest.postJson<ServiceResponse>(this.base + 'SubmitAllocation', this.body(req));
  }

  /** The opening meeting; for technology upgradation (fourth milestone) the consultancy web site's own address. */
  submitStartAssessment(req: SubmitAssessmentRequest, technologyUpgradation = false) {
    const url = technologyUpgradation ? this.hosts.web + 'FinancialAssistance/SubmitOpenMeeting' : this.base + 'SubmitStartAssessment';
    return this.rest.postJson<ServiceResponse>(url, this.body(req));
  }

  /** ServiceProxy.submitParameter (the allotted parameters of Sync Data; the consultancy service does nothing with it). */
  submitParameter(req: BaseServiceRequest & { allottedParameterObj: AllottedParameters }) {
    return this.rest.postJson<ServiceResponse>(this.base + 'SubmitParameter', this.body(req));
  }

  submitEndAssessment(req: SubmitAssessmentRequest) {
    return this.rest.postJson<ServiceResponse>(this.base + 'SubmitEndAssessment', this.body(req));
  }

  /** ServiceProxy.submitSelfie (the old selfie screen; its data can still be waiting on a phone). */
  submitSelfie(req: SubmitSelfieImageRequest) {
    return this.rest.postJson<ServiceResponse>(this.base + 'SubmitSelfie', this.body(req));
  }

  /** WebService.submitSelfie (SelfieDataRequest: the progress review selfie, file sent before). */
  submitSelfieData(req: BaseServiceRequest & { selfie: ConsultantPhoto }) {
    return this.retrofit.postJson<BaseServiceResponse>(this.base + 'SubmitSelfie', this.body(req));
  }

  submitSiteTour(req: BaseServiceRequest & { siteTourPhotos: PhotoInformation[] }) {
    return this.rest.postJson<ServiceResponse>(this.base + 'SubmitSiteTour', this.body(req));
  }

  /** submitAddedEvidences */
  submitEvidences(req: SubmitAssessmentRequest) {
    return this.rest.postJson<ServiceResponse>(this.base + 'SubmitEvidences', this.body(req));
  }

  /** New: `customFields` and `formVersion` next to `basicInformation` (docs/mobile/APP-FORMS.md). */
  submitBasicInfo(req: BaseServiceRequest & { basicInformation: BasicInformation }, form?: { customFields: Record<string, unknown>; formVersion: string }) {
    return this.retrofit.postJson<BaseServiceResponse>(this.base + 'SubmitBasicInformation', this.body({ ...req, ...(form ?? {}) }));
  }

  /**
   * FileRepository.uploadFile: multipart zedId, userName, certificationType, sectionName, photoId, latitude, longitude,
   * timeStamp and the file as `FormFile` (photoId + extension).
   */
  submitPhotos(zedId: string, saId: string, certificationType: string, sectionName: string, photo: ConsultantPhoto) {
    const fields: MultipartField[] = [
      { name: 'zedId', value: zedId },
      { name: 'userName', value: saId },
      { name: 'certificationType', value: certificationType },
      { name: 'sectionName', value: sectionName },
      { name: 'photoId', value: photo.photoId },
    ];
    if (photo.latitude != null) fields.push({ name: 'latitude', value: photo.latitude });
    if (photo.longitude != null) fields.push({ name: 'longitude', value: photo.longitude });
    if (photo.timeStamp != null) fields.push({ name: 'timeStamp', value: photo.timeStamp });
    fields.push({ name: 'FormFile', file: file(photo) });
    fields.push(...contextFields(this.ctx()));
    return this.retrofit.postMultipart<FileUploadResponse>(this.base + 'SubmitPhotos', fields);
  }

  /** SubmitZedTrainingInfo / SubmitHouseholdingTrainingInfo (ZedTrainingInfoSubmissionRequest). */
  submitTraining(req: BaseServiceRequest & { trainingInfo: ZedTrainingInfo }, handholding: boolean) {
    return this.retrofit.postJson<BaseServiceResponse>(this.base + (handholding ? 'SubmitHouseholdingTrainingInfo' : 'SubmitZedTrainingInfo'), this.body(req));
  }

  /** SubmitBaselineDiagnostic, SubmitHandholdingActionPlan, SubmitTechnologyIntervention, SubmitProgressReview. */
  submitModuleParameter(module: ParametersModule, req: BaseServiceRequest & { allottedParameterObj: AllottedParameters }) {
    return this.retrofit.postJson<BaseServiceResponse>(this.base + PARAMETER_ACTIONS[module], this.body(req));
  }

  /**
   * ServerDataRepository.submitAttendance: multipart saId, zedId, certificationType, attendanceType, comments,
   * selfieMetadata (the selfie's JSON) and the file as `files` (photoId + extension). The legacy metadata still held
   * the base64 (set to null only after); the file part carries the photo, so the metadata here has none.
   */
  submitAttendance(a: Attendance, saId: string, zedId: string, certificationType: string) {
    const fields: MultipartField[] = [
      { name: 'saId', value: saId },
      { name: 'zedId', value: zedId },
      { name: 'certificationType', value: certificationType },
      { name: 'attendanceType', value: a.attendanceType },
    ];
    if (a.comments != null) fields.push({ name: 'comments', value: a.comments });
    if (a.selfie) {
      const meta = { ...a.selfie, photo: undefined };
      fields.push({ name: 'selfieMetadata', value: JSON.stringify(meta, (_k, v) => (v === null ? undefined : v)) });
      fields.push({ name: 'files', file: file(a.selfie) });
    }
    fields.push(...contextFields(this.ctx()));
    return this.retrofit.postMultipart<BaseServiceResponse>(this.base + 'SubmitAttendance', fields);
  }

  // ----- technology upgradation (ConsultancyWebService, MobileApiWebService) -----

  /** FinancialAssistance/GetDetails with BaseServiceRequest(null, zedId, null). */
  financialAssistanceDetails(zedId: string) {
    return this.retrofit.postJson<FinancialAssistanceDetailsResponse>(this.hosts.web + 'FinancialAssistance/GetDetails', this.body({ saId: null, zedId, certificationType: null }));
  }

  /** FinancialAssistance/ValidateEvidence: multipart Id, ZedId, CertificationType, IsVerified, Remarks, SourceOfValidation, files. */
  validateEvidence(req: { id: number; zedId: string; certificationType: string; isVerified: string; remarks?: string | null; sourceOfValidation?: string | null; attachments: ConsultantPhoto[] }) {
    const fields: MultipartField[] = [
      { name: 'Id', value: String(req.id) },
      { name: 'ZedId', value: req.zedId },
      { name: 'CertificationType', value: req.certificationType },
      { name: 'IsVerified', value: req.isVerified },
    ];
    if (req.remarks != null) fields.push({ name: 'Remarks', value: req.remarks });
    if (req.sourceOfValidation != null) fields.push({ name: 'SourceOfValidation', value: req.sourceOfValidation });
    for (const a of req.attachments) fields.push({ name: 'files', file: file(a) });
    fields.push(...contextFields(this.ctx()));
    return this.retrofit.postMultipart<BaseServiceResponse>(this.hosts.web + 'FinancialAssistance/ValidateEvidence', fields);
  }

  /** FinancialAssistance/FinalSubmit with the CertificationDetails (Gson names). */
  financialAssistanceFinalSubmit(details: CertificationDetails) {
    return this.retrofit.postJson<BaseServiceResponse>(this.hosts.web + 'FinancialAssistance/FinalSubmit', details);
  }

  /** FinancialAssistance/updatetechnology {ZedID, Id, AmountPaid} */
  updateTechnology(zedId: string, id: string, amountPaid: string) {
    return this.retrofit.postJson<BaseServiceResponse>(this.hosts.web + 'FinancialAssistance/updatetechnology', { ZedID: zedId, Id: id, AmountPaid: amountPaid });
  }

  /** MobileApiWebService.getPhoto("photos/{zedId}/TechnologyUpgradation/{photoId}"). */
  technologyUpgradationPhotoUrl(zedId: string, photoId: string) {
    return `${this.hosts.mobile}photos/${encodeURIComponent(zedId)}/TechnologyUpgradation/${encodeURIComponent(photoId)}`;
  }

  /** New in V4 (docs/mobile/APP-TEXTS.md). */
  getTexts() {
    return this.retrofit.getJson<AppTextsResponse>(this.hosts.sa + 'Content/Texts');
  }

  /** New in V4 (docs/mobile/APP-FORMS.md). */
  getFormDefinition(form: string) {
    return this.retrofit.getJson<FormDefinition>(this.hosts.sa + 'Forms/Definition?form=' + encodeURIComponent(form));
  }
}
