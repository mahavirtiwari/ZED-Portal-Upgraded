/**
 * The app's calls (network/WebService.kt, RemoteWebService, RegistrationWebService, PaymentWebService,
 * SurveillanceWebService, ServerDataRepository) with the same bases, paths, field names and multipart shapes.
 * Every request also carries `version` and `deviceInfo` (the legacy build never filled deviceInfo).
 *
 * Bases (RetrofitProvider):
 *   surveillancemobileapi/surveillance/  everything of the assessment (webService and surveillanceBronzeWebService)
 *   surveillancemobileapi/msme/          surveillance NC replies, GetMsmeStatus, FinalSubmit, SubmitSurveillancePhoto
 *   mobileapi/RA/                        remote assessment
 *   Msme/ and Pay/                       portal: payment details, token, zero payment
 */
import {
  apiBase,
  baseRequest,
  contextFields,
  extensionOf,
  fileNameOf,
  fileUri,
  gsonJson,
  HttpClient,
  type BaseServiceResponse,
  type AppTextsResponse,
  type Environment,
  type FormDefinition,
  type MultipartField,
  type PhotoData,
  type RequestContext,
} from '@zed/shared';
import type { BasicInformation, CertificationType, Element, LoginResponse, MsmeStatus, NcDetails, ProductDetailsNc } from './models';

export type EsgField = {
  id: string;
  type: string;
  selected_option?: string | null;
  question: string;
  options?: string[] | null;
  answer?: string | null;
  is_visable?: boolean | string | null;
  dependent_fields?: EsgField[] | null;
};

export type EsgSection = { section_title: string; section_key?: string | null; fields: EsgField[] };

export type EsgResponse = BaseServiceResponse & {
  version?: string;
  user_name?: string;
  certification_type?: string;
  sections: EsgSection[];
};

export type EsgChecklistItem = {
  code: string;
  question: string;
  answer: string;
  ifYesQuestion: string;
  ifYesAnswer: string;
  ifNoQuestion: string;
  ifNoAnswer: string;
  dependentCode0?: string | null;
  dependentVisibilityIf0?: string | null;
  dependentCode1?: string | null;
  dependentVisibilityIf1?: string | null;
};

export type EsgChecklistSubmitDataRequest = {
  version: string;
  userName: string;
  certificationType: string;
  esgChecklist: EsgChecklistItem[];
  socialOhsChecklist: EsgChecklistItem[];
};

export type PaymentDetails = {
  Id: number;
  EnterpriseTypee: string;
  Certification: string;
  AssessmentFee: number;
  Gst: number;
  Total: number;
  Coupon?: number | null;
  AssessmentFeeAfterCoupon?: number | null;
  GstAfterCoupon?: number | null;
  TotalAfterCoupon?: number | null;
  SubsidyPer?: number | null;
  SubsidyAmount?: number | null;
  GstAfterSubsidy?: number | null;
  ApplicantContributionAfterSubsidy?: number | null;
  Tds15?: number | null;
  Tds75?: number | null;
  NetPaybleTds15?: number | null;
  NetPaybleTds75?: number | null;
  IsActive?: boolean | null;
  SpecialCategory?: string | null;
  SubsidyPercentage?: number | null;
  Subsidy?: number | null;
  SubsidyLabel?: string | null;
};

export type PaymentDetailsResponse = BaseServiceResponse & {
  WithCoupon?: PaymentDetails[] | null;
  WithOutCoupon?: PaymentDetails[] | null;
  CouponStatus?: Array<{ IsCouponUsed?: number | null }> | null;
};

export type PaymentTokenRequest = {
  PaymentRefId: string;
  ZedId: string;
  Certification: string;
  Amount: string;
  UseCoupon: string;
  UnitGstin?: string | null;
  Gst?: string | null;
  TdsDeductible?: string | null;
  Tds?: string | null;
  Tan?: string | null;
};

export type PaymentHashResponse = BaseServiceResponse & {
  requestHash: string;
  orderId: string;
  merchantId: string;
  accessCode: string;
  amount: string;
};

export type ParametersResponse = BaseServiceResponse & { parameters?: Element[] | null };
export type TwilioTokenResponse = BaseServiceResponse & { token?: string | null };
export type RemoteAssessmentStatusResponse = BaseServiceResponse & { assementDate?: string | null; allowCalling?: boolean };

/** OkHttp asRequestBody media types of the legacy uploads. */
function filePart(name: string, photo: PhotoData, fileName: string): MultipartField {
  return { name, file: { uri: fileUri(photo.photoPath ?? ''), name: fileName, type: photo.isPdf ? 'application/pdf' : 'image/*' } };
}

/** The upload copy of a photo: the base64 cleared (`it.photo = null`) before its JSON goes into the form. */
const metadata = (p: PhotoData) => gsonJson({ ...p, photo: null });

export class MsmeApi {
  readonly http: HttpClient;
  private readonly survey: string;
  private readonly surveyNc: string;
  private readonly remote: string;
  private readonly portalMsme: string;
  private readonly pay: string;
  private readonly host: string;

  constructor(env: Environment, private readonly ctx: () => RequestContext, http?: HttpClient) {
    this.http = http ?? new HttpClient();
    this.survey = apiBase(env, 'surveillancemobileapi/surveillance/');
    this.surveyNc = apiBase(env, 'surveillancemobileapi/msme/');
    this.remote = apiBase(env, 'mobileapi/RA/');
    this.portalMsme = apiBase(env, 'Msme/');
    this.pay = apiBase(env, 'Pay/');
    this.host = apiBase(env, 'surveillancemobileapi/');
  }

  /** New in V4 (docs/mobile/APP-TEXTS.md): the Admin texts of this host's system. */
  getTexts() {
    return this.http.getJson<AppTextsResponse>(this.host + 'Content/Texts');
  }

  /** New in V4 (docs/mobile/APP-FORMS.md): the Basic Information form as the Admin set it. */
  getFormDefinition(form: string) {
    return this.http.getJson<FormDefinition>(this.host + 'Forms/Definition?form=' + encodeURIComponent(form));
  }

  private req<T extends object>(userName: string, fields: T) {
    return baseRequest(this.ctx(), userName, fields);
  }

  private ncBase(isSurveillance: boolean) {
    return isSurveillance ? this.surveyNc : this.survey;
  }

  /** LoginRequest(username, password, assessorId, zedId = username) */
  login(username: string, password: string, assessorId: string) {
    return this.http.postJson<LoginResponse>(this.survey + 'login', this.req(username, { password, assessorId, zedId: username }));
  }

  getParametersByType(username: string, certificationType: CertificationType) {
    return this.http.postJson<ParametersResponse>(this.survey + 'GetParametersByType', this.req(username, { certificationType }));
  }

  /** @GET("GetEsgChecklist") */
  getEsgChecklist() {
    return this.http.getJson<EsgResponse>(this.survey + 'GetEsgChecklist');
  }

  getMsmeStatus(username: string, isSurveillance: boolean) {
    return this.http.postJson<MsmeStatus>(this.ncBase(isSurveillance) + 'GetMsmeStatus', this.req(username, {}));
  }

  submitEsgChecklist(request: EsgChecklistSubmitDataRequest) {
    const ctx = this.ctx();
    return this.http.postJson<BaseServiceResponse>(this.survey + 'SubmitEsgChecklist', {
      ...request,
      ...(ctx.deviceInfo ? { deviceInfo: ctx.deviceInfo } : {}),
    });
  }

  /** New: `customFields` and `formVersion` next to `basicInformation` (docs/mobile/APP-FORMS.md "What to send"). */
  submitBasicInfo(
    username: string,
    certificationType: CertificationType,
    basicInformation: BasicInformation,
    form?: { customFields: Record<string, unknown>; formVersion: string },
  ) {
    return this.http.postJson<BaseServiceResponse>(
      this.survey + 'SubmitBasicInformation',
      this.req(username, { certificationType, basicInformation, ...(form ?? {}) }),
    );
  }

  /** @Multipart SubmitEvidenceV2: text parts and the file in `file_data` (its own file name). */
  submitEvidence(username: string, certificationType: string, evidenceId: string, photo: PhotoData, isFirst: boolean, isLast: boolean) {
    return this.http.postMultipart<BaseServiceResponse>(this.survey + 'SubmitEvidenceV2', [
      { name: 'userName', value: username },
      { name: 'certificationType', value: certificationType },
      { name: 'evidenceId', value: evidenceId },
      { name: 'photo', value: metadata(photo) },
      { name: 'isFirst', value: String(isFirst) },
      { name: 'isLast', value: String(isLast) },
      ...contextFields(this.ctx()),
      filePart('file_data', photo, fileNameOf(photo.photoPath ?? '')),
    ]);
  }

  /** SubmitPhotos: userName, certificationType and `files` named photoId + extension. */
  submitPhotos(username: string, certificationType: string, photos: PhotoData[]) {
    return this.http.postMultipart<BaseServiceResponse>(this.survey + 'SubmitPhotos', [
      { name: 'userName', value: username },
      { name: 'certificationType', value: certificationType },
      ...contextFields(this.ctx()),
      ...photos.map(p => filePart('files', p, p.photoId + extensionOf(fileNameOf(p.photoPath ?? '')))),
    ]);
  }

  /** EvidencesFinalSubmitRequest */
  finalSubmit(username: string, certificationType: string, suitableForSilverUpgrade: string, handholdingSupport: string) {
    return this.http.postJson<BaseServiceResponse>(
      this.survey + 'FinalSubmit',
      this.req(username, { certificationType, suitableForSilverUpgrade, handholdingSupport }),
    );
  }

  /** The NC close: BaseCertificationRequest to FinalSubmit (surveillance/ or msme/). */
  finalSubmitNc(username: string, certificationType: string, isSurveillance: boolean) {
    return this.http.postJson<BaseServiceResponse>(this.ncBase(isSurveillance) + 'FinalSubmit', this.req(username, { certificationType }));
  }

  getNcDetails(username: string, certificationType: string, ncCount: number, isSurveillance: boolean) {
    return this.http.postJson<NcDetails>(
      this.ncBase(isSurveillance) + 'GetNcDetailsByType',
      this.req(username, { certificationType, ncCount }),
    );
  }

  /** NcSitePhotosSubmitRequest: JSON with the photos (base64 filled in) and the MSME remarks. */
  submitNcSitePhotos(username: string, certificationType: string, photos: PhotoData[], msmeRemarks: string, isSurveillance: boolean) {
    return this.http.postJson<BaseServiceResponse>(
      this.ncBase(isSurveillance) + 'SubmitSiteExteriorInfo',
      this.req(username, { certificationType, photos, msmeRemarks }),
    );
  }

  /** SubmitNcProduct: productDetailsNc as JSON (photos without base64) and both photos in `files`. */
  submitNcProduct(username: string, certificationType: string, product: ProductDetailsNc, isSurveillance: boolean) {
    const photos = [product.productPhoto, product.productDescriptionPhoto].filter((p): p is PhotoData => p != null);
    const json = gsonJson({
      ...product,
      productPhoto: product.productPhoto ? { ...product.productPhoto, photo: null } : null,
      productDescriptionPhoto: product.productDescriptionPhoto ? { ...product.productDescriptionPhoto, photo: null } : null,
    });
    return this.http.postMultipart<BaseServiceResponse>(this.ncBase(isSurveillance) + 'SubmitNcProduct', [
      { name: 'userName', value: username },
      { name: 'certificationType', value: certificationType },
      { name: 'productDetailsNc', value: json },
      ...contextFields(this.ctx()),
      ...photos.map(p => filePart('files', p, p.photoId + extensionOf(fileNameOf(p.photoPath ?? '')))),
    ]);
  }

  /** SubmitNcRequirement: one photo per request, `file_data` with its own file name. */
  submitNcRequirement(
    username: string,
    certificationType: string,
    requirementId: string,
    requirementCode: string,
    photo: PhotoData,
    isFirst: boolean,
    isLast: boolean,
    msmeRemarks: string | null | undefined,
    isSurveillance: boolean,
  ) {
    const fields: MultipartField[] = [
      { name: 'userName', value: username },
      { name: 'certificationType', value: certificationType },
      { name: 'requirementId', value: requirementId },
      { name: 'requirementCode', value: requirementCode },
      { name: 'photo', value: metadata(photo) },
      { name: 'isFirst', value: String(isFirst) },
      { name: 'isLast', value: String(isLast) },
    ];
    if (msmeRemarks != null) fields.push({ name: 'msmeRemarks', value: msmeRemarks });
    fields.push(...contextFields(this.ctx()), filePart('file_data', photo, fileNameOf(photo.photoPath ?? '')));
    return this.http.postMultipart<BaseServiceResponse>(this.ncBase(isSurveillance) + 'SubmitNcRequirement', fields);
  }

  changePassword(request: { userName: string; oldPassword: string; newPassword: string }) {
    return this.http.postJson<BaseServiceResponse>(this.survey + 'ChangePassword', this.req(request.userName, request));
  }

  resetPassword(userName: string) {
    return this.http.postJson<BaseServiceResponse>(this.survey + 'ResetPassword', this.req(userName, {}));
  }

  /** EvidencePreFinalSubmitRequest (documentTypes comma separated). */
  submitFinancialAssistanceDetails(
    username: string,
    certificationType: string,
    financialAssistanceAvailed: string,
    anyDocuments: string | null | undefined,
    documentTypes: string | null | undefined,
  ) {
    return this.http.postJson<BaseServiceResponse>(
      this.survey + 'SubmitFinancialAssistanceDetails',
      this.req(username, { certificationType, financialAssistanceAvailed, anyDocuments, documentTypes }),
    );
  }

  /** SubmitSurveillancePhoto: the photo JSON under its key (selfie/interior/exterior/sitetour), file in `file_data`. */
  submitSurveillancePhoto(username: string, certificationType: string, fileKey: string, photo: PhotoData) {
    return this.http.postMultipart<BaseServiceResponse>(this.surveyNc + 'SubmitSurveillancePhoto', [
      { name: 'userName', value: username },
      { name: 'certificationType', value: certificationType },
      { name: fileKey, value: gsonJson(photo) },
      ...contextFields(this.ctx()),
      filePart('file_data', photo, photo.photoId + extensionOf(fileNameOf(photo.photoPath ?? ''))),
    ]);
  }

  // ----- Remote assessment (mobileapi/RA/) -----

  submitSelfie(
    username: string,
    certificationType: string,
    photo: PhotoData,
    representativeName: string,
    representativeDesignation: string,
    siteExteriorPhoto: PhotoData,
  ) {
    return this.http.postJson<BaseServiceResponse>(
      this.remote + 'SubmitSelfie',
      this.req(username, { certificationType, photo, representativeName, representativeDesignation, siteExteriorPhoto }),
    );
  }

  getTwilioToken(username: string, certificationType: string) {
    return this.http.postJson<TwilioTokenResponse>(this.remote + 'GetToken', this.req(username, { certificationType }));
  }

  checkAssessment(username: string, certificationType: string) {
    return this.http.postJson<RemoteAssessmentStatusResponse>(this.remote + 'CheckAssessment', this.req(username, { certificationType }));
  }

  // ----- Portal payment -----

  getPaymentDetailsByType(certification: string, zedId: string) {
    return this.http.postJson<PaymentDetailsResponse>(this.portalMsme + 'GetPaymentDetailsByType', { certification, zedId });
  }

  getPaymentToken(request: PaymentTokenRequest) {
    return this.http.postJson<PaymentHashResponse>(this.pay + 'GetToken', request);
  }

  submitZeroPaymentDetails(request: PaymentTokenRequest) {
    return this.http.postJson<BaseServiceResponse>(this.pay + 'SubmitZeroPaymentDetails', request);
  }
}
