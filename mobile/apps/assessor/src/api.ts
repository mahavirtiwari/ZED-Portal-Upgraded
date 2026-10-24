/**
 * The site assessment app's calls (service/ServiceProxy + RestHelper, network/WebService + ServerDataRepository) with
 * the same paths and shapes, on the V4 mobile API: `mobileapi/SA/` (Main), or `surveillancemobileapi/SA/` for a
 * surveillance build. Every request also carries `version` and `deviceInfo` (the legacy app never sent them).
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
  type PhotoData,
  type RequestContext,
} from '@zed/shared';
import type { Attendance, AssessmentDetails, BaseServiceRequest, BasicInformation, ParametersDetails, AllottedParameters, PhotoInformation, ServiceResponse, SubmitAssessmentRequest, SubmitSelfieImageRequest } from './models';

export type SaSystem = 'main' | 'surveillance';

/** RestHelper: 300 s connect and read timeouts (whole meetings with base64 photos). */
const REST_TIMEOUT_MS = 300_000;

export type LoginRequest = { password: string; version: string; zedId: string; assessorId: string };

/** Utils.getExtensionFromPath */
const extensionOf = (path: string) => (path.lastIndexOf('.') >= 0 ? path.substring(path.lastIndexOf('.')) : '');

export class SaApi {
  readonly rest: HttpClient;
  readonly retrofit: HttpClient;
  private readonly base: string;
  private readonly host: string;

  constructor(
    env: Environment,
    private readonly ctx: () => RequestContext,
    http?: { rest?: HttpClient; retrofit?: HttpClient },
    system: SaSystem = 'main',
  ) {
    this.rest = http?.rest ?? new HttpClient({ timeoutMs: REST_TIMEOUT_MS });
    this.retrofit = http?.retrofit ?? new HttpClient();
    this.host = apiBase(env, system === 'main' ? 'mobileapi/' : 'surveillancemobileapi/');
    this.base = this.host + 'SA/';
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

  submitStartAssessment(req: SubmitAssessmentRequest) {
    return this.rest.postJson<ServiceResponse>(this.base + 'SubmitStartAssessment', this.body(req));
  }

  submitParameter(req: BaseServiceRequest & { allottedParameterObj: AllottedParameters }) {
    return this.rest.postJson<ServiceResponse>(this.base + 'SubmitParameter', this.body(req));
  }

  submitEndAssessment(req: SubmitAssessmentRequest) {
    return this.rest.postJson<ServiceResponse>(this.base + 'SubmitEndAssessment', this.body(req));
  }

  submitSelfie(req: SubmitSelfieImageRequest) {
    return this.rest.postJson<ServiceResponse>(this.base + 'SubmitSelfie', this.body(req));
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

  submitBasicInfoPhotos(req: BaseServiceRequest & { photos: PhotoData[] }) {
    return this.retrofit.postJson<BaseServiceResponse>(this.base + 'SubmitBasicInfoPhotos', this.body(req));
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
      const { photo: _photo, ...meta } = a.selfie;
      fields.push({ name: 'selfieMetadata', value: JSON.stringify(meta, (_k, v) => (v === null ? undefined : v)) });
      const path = a.selfie.photoPath ?? '';
      fields.push({
        name: 'files',
        file: { uri: fileUri(path), name: a.selfie.photoId + extensionOf(path.split('/').pop() ?? ''), type: a.selfie.isPdf ? 'application/pdf' : 'image/*' },
      });
    }
    fields.push(...contextFields(this.ctx()));
    return this.retrofit.postMultipart<BaseServiceResponse>(this.base + 'SubmitAttendance', fields);
  }

  /** New in V4 (docs/mobile/APP-TEXTS.md). */
  getTexts() {
    return this.retrofit.getJson<AppTextsResponse>(this.host + 'Content/Texts');
  }

  /** New in V4 (docs/mobile/APP-FORMS.md). */
  getFormDefinition(form: string) {
    return this.retrofit.getJson<FormDefinition>(this.host + 'Forms/Definition?form=' + encodeURIComponent(form));
  }
}
