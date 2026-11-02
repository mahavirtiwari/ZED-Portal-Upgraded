/**
 * The ZED MSME applicant app's calls: the MSME code base's WebService (base mobileapi/msme/, the `retrofit` instance
 * that the Bronze surveillance build left unused), RegistrationWebService (portal Msme/), RemoteWebService
 * (mobileapi/RA/) and PaymentWebService (portal Msme/ and Pay/), with the same paths, field names and multipart
 * shapes as apps/msme. Every request also carries `version` and `deviceInfo`.
 *
 * Bases:
 *   mobileapi/msme/   sign-in, certification steps, NC replies, documents, passwords (Zed.Main.MobileApi MsmeController)
 *   mobileapi/RA/     remote assessment
 *   Msme/ and Pay/    portal: registration, payment details, token, zero payment
 *   mobileapi/        Admin texts and forms of the main system
 *
 * New in V4 (2.0): the Udyam record comes from the server (Msme/LookupUdyam); the old app read the Udyam service
 * itself with a built-in key and showed a SafetyNet captcha (both gone).
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
import type { FinancialAssistance } from './financialAssistance';
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
  /** V4: the CCAvenue SDK environment of the server's gateway (app_live or app_staging). */
  paymentEnvironment?: string | null;
};

export type ParametersResponse = BaseServiceResponse & { parameters?: Element[] | null };
export type RemoteAssessmentStatusResponse = BaseServiceResponse & { assementDate?: string | null; allowCalling?: boolean };

/** Msme/LookupUdyam: the fields of the Udyam record the app shows, and the plants and activities to choose from. */
export type UdyamRecord = Record<string, string | null | undefined>;
export type UdyamLookupResponse = BaseServiceResponse & {
  BasicDetails?: UdyamRecord | null;
  Plants?: UdyamRecord[] | null;
  Activities?: UdyamRecord[] | null;
};

/** Msme/FinalSubmit (RegistrationRequest): the server registers from its own Udyam lookup; these identify the choice. */
export type RegistrationRequest = {
  DateOfPledge: string;
  PledgeEmailId: string;
  RegistrationType: 'UDYAM';
  RegistrationFrom: 'Android';
  BasicDetails: UdyamRecord;
  PlantDetails: UdyamRecord;
  ActivityDetails: UdyamRecord;
};

/** GetMyDocuments (DocumentsResponse). */
export type GuidelineDocument = { DocumentName?: string | null; DocumentPath?: string | null; OrderNo?: number | string | null };
export type CertificateLinks = {
  Pledge?: string | null;
  Bronze?: string | null;
  Silver?: string | null;
  Gold?: string | null;
  Wash?: string | null;
  Webinar?: string | null;
};
export type DocumentsResponse = BaseServiceResponse & {
  Guidelines?: GuidelineDocument[] | null;
  Certificates?: CertificateLinks[] | null;
};

/** OkHttp asRequestBody media types of the legacy uploads. */
function filePart(name: string, photo: PhotoData, fileName: string): MultipartField {
  return { name, file: { uri: fileUri(photo.photoPath ?? ''), name: fileName, type: photo.isPdf ? 'application/pdf' : 'image/*' } };
}

/** The upload copy of a photo: the base64 cleared (`it.photo = null`) before its JSON goes into the form. */
const metadata = (p: PhotoData) => gsonJson({ ...p, photo: null });

export class MsmeApi {
  readonly http: HttpClient;
  /** The portal site (pledge certificate, Msme/ViewStatus). */
  readonly site: string;
  private readonly msme: string;
  private readonly remote: string;
  private readonly portalMsme: string;
  private readonly pay: string;
  private readonly host: string;

  constructor(env: Environment, private readonly ctx: () => RequestContext, http?: HttpClient) {
    this.http = http ?? new HttpClient();
    this.site = env.baseUrl + '/';
    this.msme = apiBase(env, 'mobileapi/msme/');
    this.remote = apiBase(env, 'mobileapi/RA/');
    this.portalMsme = apiBase(env, 'Msme/');
    this.pay = apiBase(env, 'Pay/');
    this.host = apiBase(env, 'mobileapi/');
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

  /** LoginRequest(username, password, zedId = username): the applicant signs in with the ZED ID and password only. */
  login(username: string, password: string) {
    return this.http.postJson<LoginResponse>(this.msme + 'login', this.req(username, { password, zedId: username }));
  }

  /** GetMsmeStatus: the certification statuses (pull to refresh, after a payment). */
  getMsmeStatus(username: string) {
    return this.http.postJson<MsmeStatus>(this.msme + 'GetMsmeStatus', this.req(username, {}));
  }

  /** GetMyDocuments: `{ zedId }` only (a Map in the legacy code, no version). */
  getMyDocuments(zedId: string) {
    return this.http.postJson<DocumentsResponse>(this.msme + 'GetMyDocuments', { zedId });
  }

  /**
   * A document of My Documents, or the pledge certificate (`pledge`), with the sign-in token (Msme/AppDocument on the
   * portal). `path` is the address GetMyDocuments answers; V4 no longer serves those as public files.
   */
  documentUrl(path: string) {
    return this.portalMsme + 'AppDocument?path=' + encodeURIComponent(path);
  }

  // ----- Financial Assistance (FinAssistanceViewModel) -----

  /** SubmitFinancialPhotos: `zedId` and the files of one upload field, named photoId + extension. */
  submitFinancialPhotos(zedId: string, photos: PhotoData[]) {
    return this.http.postMultipart<BaseServiceResponse>(this.msme + 'SubmitFinancialPhotos', [
      { name: 'zedId', value: zedId },
      ...contextFields(this.ctx()),
      ...photos.map(p => filePart('files', p, p.photoId + extensionOf(fileNameOf(p.photoPath ?? '')))),
    ]);
  }

  /** SubmitFinancialData: the claim as JSON (the photos' metadata without base64). */
  submitFinancialData(claim: FinancialAssistance) {
    const strip = (list: PhotoData[]) => list.map(p => ({ ...p, photo: null }));
    return this.http.postJson<BaseServiceResponse>(this.msme + 'SubmitFinancialData', {
      ...claim,
      CertificationDetails: { ...claim.CertificationDetails, Photos: strip(claim.CertificationDetails.Photos) },
      ExpenditureDetails: {
        ...claim.ExpenditureDetails,
        Photos: strip(claim.ExpenditureDetails.Photos),
        InvoicePhotos: strip(claim.ExpenditureDetails.InvoicePhotos),
      },
      AccountDetails: { ...claim.AccountDetails, Photos: strip(claim.AccountDetails.Photos) },
    });
  }

  /** Incentive/DetailsMobile: the incentives page (a WebView in the legacy app, the browser here). */
  get incentivesUrl() {
    return this.site + 'Incentive/DetailsMobile';
  }

  // ----- Registration (portal Msme/, no sign-in) -----

  lookupUdyam(udyamNumber: string, mobileNo: string) {
    return this.http.postJson<UdyamLookupResponse>(this.portalMsme + 'LookupUdyam', { udyamNumber, mobileNo });
  }

  validatePlantAndActivity(UdyogAadharNo: string, PlantIdNo: string, TwoDigitActivity: string) {
    return this.http.postJson<BaseServiceResponse>(this.portalMsme + 'ValidatePlantAndActivity', { UdyogAadharNo, PlantIdNo, TwoDigitActivity });
  }

  sendPledgeEmailOtp(email: string) {
    return this.http.postJson<BaseServiceResponse>(this.portalMsme + 'SendPledgeEmailOtp', { email });
  }

  verifyPledgeEmailOtp(email: string, otp: string) {
    return this.http.postJson<BaseServiceResponse>(this.portalMsme + 'VerifyPledgeEmailOtp', { email, otp });
  }

  register(request: RegistrationRequest) {
    return this.http.postJson<BaseServiceResponse>(this.portalMsme + 'FinalSubmit', request);
  }

  getParametersByType(username: string, certificationType: CertificationType) {
    return this.http.postJson<ParametersResponse>(this.msme + 'GetParametersByType', this.req(username, { certificationType }));
  }

  /** @GET("GetEsgChecklist") */
  getEsgChecklist() {
    return this.http.getJson<EsgResponse>(this.msme + 'GetEsgChecklist');
  }

  submitEsgChecklist(request: EsgChecklistSubmitDataRequest) {
    const ctx = this.ctx();
    return this.http.postJson<BaseServiceResponse>(this.msme + 'SubmitEsgChecklist', {
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
      this.msme + 'SubmitBasicInformation',
      this.req(username, { certificationType, basicInformation, ...(form ?? {}) }),
    );
  }

  /** @Multipart SubmitEvidenceV2: text parts and the file in `file_data` (its own file name). */
  submitEvidence(username: string, certificationType: string, evidenceId: string, photo: PhotoData, isFirst: boolean, isLast: boolean) {
    return this.http.postMultipart<BaseServiceResponse>(this.msme + 'SubmitEvidenceV2', [
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
    return this.http.postMultipart<BaseServiceResponse>(this.msme + 'SubmitPhotos', [
      { name: 'userName', value: username },
      { name: 'certificationType', value: certificationType },
      ...contextFields(this.ctx()),
      ...photos.map(p => filePart('files', p, p.photoId + extensionOf(fileNameOf(p.photoPath ?? '')))),
    ]);
  }

  /** FinalSubmit (BaseCertificationRequest): the documents of a level, and the close of its NC replies. */
  finalSubmit(username: string, certificationType: string) {
    return this.http.postJson<BaseServiceResponse>(this.msme + 'FinalSubmit', this.req(username, { certificationType }));
  }

  getNcDetails(username: string, certificationType: string, ncCount: number) {
    return this.http.postJson<NcDetails>(this.msme + 'GetNcDetailsByType', this.req(username, { certificationType, ncCount }));
  }

  /** NcSitePhotosSubmitRequest: JSON with the photos (base64 filled in) and the MSME remarks. */
  submitNcSitePhotos(username: string, certificationType: string, photos: PhotoData[], msmeRemarks: string) {
    return this.http.postJson<BaseServiceResponse>(this.msme + 'SubmitSiteExteriorInfo', this.req(username, { certificationType, photos, msmeRemarks }));
  }

  /** SubmitNcProduct: productDetailsNc as JSON (photos without base64) and both photos in `files`. */
  submitNcProduct(username: string, certificationType: string, product: ProductDetailsNc) {
    const photos = [product.productPhoto, product.productDescriptionPhoto].filter((p): p is PhotoData => p != null);
    const json = gsonJson({
      ...product,
      productPhoto: product.productPhoto ? { ...product.productPhoto, photo: null } : null,
      productDescriptionPhoto: product.productDescriptionPhoto ? { ...product.productDescriptionPhoto, photo: null } : null,
    });
    return this.http.postMultipart<BaseServiceResponse>(this.msme + 'SubmitNcProduct', [
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
    return this.http.postMultipart<BaseServiceResponse>(this.msme + 'SubmitNcRequirement', fields);
  }

  changePassword(request: { userName: string; oldPassword: string; newPassword: string }) {
    return this.http.postJson<BaseServiceResponse>(this.msme + 'ChangePassword', this.req(request.userName, request));
  }

  resetPassword(userName: string) {
    return this.http.postJson<BaseServiceResponse>(this.msme + 'ResetPassword', this.req(userName, {}));
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
