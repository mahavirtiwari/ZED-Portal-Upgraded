/**
 * The MSME code base's models (models/Models.kt, models/ServiceModels.kt, models/elements/Element.kt) with the field
 * names Gson writes. The whole LoginResponse, offline work included, is kept as this JSON in QCI_MSME_DB.LoginData,
 * so the names must stay as they are for data saved by the legacy app to be read after the update.
 */
import { parseLegacyDate, type BaseServiceResponse, type PhotoData } from '@zed/shared';
import { BUILT_IN_BASIC_INFO, validateBasicInformation } from './forms';

export type CertificationType = 'Bronze' | 'Silver' | 'Gold';

export enum Status {
  TO_START = 'TO_START',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  SUBMITTED = 'SUBMITTED',
}

export const YES = 'Yes';
export const NO = 'No';

// ---------- Unit ----------

export type BasicDetails = {
  ApplicationId?: string | null;
  UdyogAadharNo?: string | null;
  OwnerName?: string | null;
  EnterpriseName?: string | null;
  OrganisationType?: string | null;
  OrganisationTypeName?: string | null;
  SocialCategory?: string | null;
  SocialCategoryName?: string | null;
  Gender?: string | null;
  PH?: string | null;
  PanNo?: string | null;
  Address?: string | null;
  State_Id?: string | null;
  state_name?: string | null;
  District_Id?: string | null;
  DISTRICT_NAME?: string | null;
  LG_DT_Code?: string | null;
  PINCode?: string | null;
  MobileNo?: string | null;
  EmailId?: string | null;
  MajorActivity?: string | null;
  MajorActivityName?: string | null;
  EnterpriseType?: string | null;
  EnterpriseTypee?: string | null;
  WhetherProdCommenced?: string | null;
  CommmenceDate?: string | null;
  PreviousEMType?: string | null;
  PreviousEMNumber?: string | null;
  TotalEmp?: string | null;
  InvestmentCost?: string | null;
  Dic_Name?: string | null;
  AppliedDate?: string | null;
  IncorporationDate?: string | null;
};

export type ActivityDetails = {
  ApplicationId?: string | null;
  Activity?: string | null;
  Two_DigitActivity?: string | null;
  Four_DigitActivity?: string | null;
  Five_DigitActivity?: string | null;
  ActivityDetail_Id?: string | null;
};

export type PlantDetails = {
  ApplicationId?: string | null;
  PFlat?: string | null;
  PBuilding?: string | null;
  PRoad?: string | null;
  PArea?: string | null;
  PCity?: string | null;
  PPin?: string | null;
  state_id?: string | null;
  state_name?: string | null;
  DISTRICT_NAME?: string | null;
  LG_DT_Code?: string | null;
  PlantIdNo?: string | null;
  UnitIdNo?: string | null;
  UnitName?: string | null;
  PAddress?: string | null;
};

/** getFormattedDistrictStatePin + getFullAddress ("null" when the address is missing, as Kotlin's string template). */
function fullAddress(address: string | null | undefined, district?: string | null, state?: string | null, pin?: string | null) {
  const blank = (s?: string | null) => s == null || s.trim() === '';
  return (
    String(address ?? 'null') +
    '\n' +
    (blank(district) ? '' : `${district}, `) +
    (blank(state) ? '' : `${state}, `) +
    (blank(pin) ? '' : `${pin}`)
  );
}

export const basicDetailsAddress = (b: BasicDetails) => fullAddress(b.Address, b.DISTRICT_NAME, b.state_name, b.PINCode);
export const plantAddress = (p: PlantDetails) => fullAddress(p.PAddress, p.DISTRICT_NAME, p.state_name, p.PPin);

// ---------- Parameters (elements) ----------

export type Option = { code: string; id: string; label?: string | null; subOptions?: Option[] | null; image?: string | null };

export type Evidence = {
  code: string;
  id: string;
  label?: string | null;
  infoText?: string | null;
  iButton?: string | null;
  status?: Status | null;
  photos?: PhotoData[] | null;
  validationRequired?: boolean;
  available?: boolean | null;
};

export type Requirement = {
  code: string;
  id: string;
  label?: string | null;
  answerCode?: string | null;
  remarks?: string | null;
  type?: string | null;
  status?: Status | null;
  options?: Option[] | null;
  evidences?: Evidence[] | null;
  photos?: PhotoData[] | null;
  assessorRemarks?: string | null;
  msmeRemarks?: string | null;
};

export type Element = {
  code: string;
  id: string;
  label?: string | null;
  infoText?: string | null;
  iButton?: string | null;
  subElements?: Element[] | null;
  requirements?: Requirement[] | null;
  status?: Status | null;
};

/** Question.getStatus */
export const requirementStatus = (r: Requirement): Status => r.status ?? Status.TO_START;

// ---------- Basic information ----------

export type ProductDetails = {
  id: string;
  productName?: string | null;
  exported?: string | null;
  productPhoto?: PhotoData | null;
  productDescriptionPhoto?: PhotoData | null;
};

export type ProductDetailsNc = ProductDetails & {
  productId?: string | null;
  productPhotoPath?: string | null;
  productDescriptionPhotoPath?: string | null;
  assessorRemarks?: string | null;
  msmeRemarks?: string | null;
  status?: Status;
};

export type RawMaterialDetails = {
  id: string;
  rawMaterialName?: string | null;
  rawMaterialPercentage?: string | null;
  countryName?: string | null;
};

export type BasicInformation = {
  assessorSelfie?: PhotoData | null;
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
  siteExteriorPhotos: PhotoData[];
  sitePhotosSubmitted: boolean;
  status: Status;
  // New (Admin forms, docs/mobile/APP-FORMS.md), kept with the draft on the phone and never sent inside it:
  /** Answers to the Admin's custom fields by key, as entered. */
  customAnswers?: Record<string, unknown> | null;
  /** On Proceed: the `customFields` and `formVersion` of the submit, the standard keys left out / optional. */
  customFields?: Record<string, unknown> | null;
  formVersion?: string | null;
  omittedFields?: string[] | null;
  optionalFields?: string[] | null;
};

export function newBasicInformation(): BasicInformation {
  return {
    productDetailsList: [],
    rawMaterialsList: [],
    energySources: [],
    siteExteriorPhotos: [],
    sitePhotosSubmitted: false,
    status: Status.IN_PROGRESS,
  };
}

/** Lists that a JSON written by Gson always has; guards against older or partial data. */
export function normalizeBasicInformation(b: BasicInformation): BasicInformation {
  b.productDetailsList ??= [];
  b.rawMaterialsList ??= [];
  b.energySources ??= [];
  b.siteExteriorPhotos ??= [];
  b.sitePhotosSubmitted ??= false;
  b.status ??= Status.IN_PROGRESS;
  return b;
}

const blank = (s?: string | null) => s == null || s.trim() === '';

/** BasicInformation.isValid of the legacy app: the rules of the app's own form. */
export function basicInformationIsValid(b: BasicInformation): boolean {
  return validateBasicInformation(BUILT_IN_BASIC_INFO, b).size === 0;
}

// ---------- Non-conformances ----------

export type NcDetails = BaseServiceResponse & {
  siteExteriorPhotos?: string[] | null;
  assessorRemarksSite?: string | null;
  msmeRemarksSitePhoto?: string | null;
  siteExteriorPhotoData?: PhotoData[] | null;
  sitePhotosSubmitted?: boolean;
  products?: ProductDetailsNc[] | null;
  parameters?: Element[] | null;
};

// ---------- Surveillance, remote assessment, final submit ----------

export type SurveillanceData = {
  selfie?: PhotoData | null;
  interiorPhotos: PhotoData[];
  exteriorPhotos: PhotoData[];
  siteTourPhotos: PhotoData[];
};

export const SURVEILLANCE_SELFIE = 'selfie';
export const SURVEILLANCE_INTERIOR = 'interior';
export const SURVEILLANCE_EXTERIOR = 'exterior';
export const SURVEILLANCE_SITE_TOUR = 'sitetour';

export const hasSiteTourPhotos = (s: SurveillanceData) => s.siteTourPhotos.length > 0 && s.siteTourPhotos.every(p => p.photoPath != null);

export type RemoteAssessmentData = {
  representativeName?: string | null;
  representativeDesignation?: string | null;
  selfie?: PhotoData | null;
  siteExteriorPhoto?: PhotoData | null;
  isSelfieSubmitted: boolean;
};

export const remoteAssessmentIsValid = (r: RemoteAssessmentData) =>
  !blank(r.representativeName) && !blank(r.representativeDesignation) && r.selfie != null && r.siteExteriorPhoto != null;

export type FacilitatorAssistanceData = {
  mobileNumber?: string | null;
  email?: string | null;
  selfie?: PhotoData | null;
  isSubmitted: boolean;
};

export type EvidenceFinalSubmitData = {
  financialAssistanceAvailed?: string | null;
  anyDocuments?: string | null;
  documentTypes?: string[] | null;
  isSubmitted: boolean;
};

/** EvidenceFinalSubmitData.isValid */
export function preFinalSubmitIsValid(d: EvidenceFinalSubmitData): boolean {
  if (d.financialAssistanceAvailed === YES) return true;
  if (d.financialAssistanceAvailed === NO) {
    if (d.anyDocuments === NO) return true;
    if (d.anyDocuments === YES && d.documentTypes != null && d.documentTypes.length > 0) return true;
  }
  return false;
}

// ---------- Status ----------

export type CertificationDetails = {
  /** 0 disabled, 1 enabled, 2 view only, 3/4 completed, 5 completed and disabled. */
  status: number;
  nc1Status: number;
  nc1StatusText?: string | null;
  nc2Status: number;
  nc2StatusText?: string | null;
  nc3Status: number;
  nc3StatusText?: string | null;
  nc4Status: number;
  nc4StatusText?: string | null;
  nc5Status: number;
  nc5StatusText?: string | null;
  certificate?: string | null;
  report?: string | null;
  incentives?: string | null;
  basicInformation?: BasicInformation | null;
  parameters?: Element[] | null;
  facilitatorAssistanceData?: FacilitatorAssistanceData | null;
  evidencePreFinalSubmitData?: EvidenceFinalSubmitData | null;
  finalSubmitDone: boolean;
  ncOneDetails?: NcDetails | null;
  ncTwoDetails?: NcDetails | null;
  ncThreeDetails?: NcDetails | null;
  ncFourDetails?: NcDetails | null;
  ncFiveDetails?: NcDetails | null;
  activeNcDetails?: NcDetails | null;
  remoteStatus?: string | null;
  surveillanceStatus?: string | null;
  surveillanceDate?: string | null;
  surveillanceData?: SurveillanceData | null;
};

export type MsmeStatus = BaseServiceResponse & {
  bronze?: CertificationDetails | null;
  silver?: CertificationDetails | null;
  gold?: CertificationDetails | null;
  financialAssistanceStatus: number;
  latestCertification?: string | null;
  dateOfAvail?: string | null;
  joiningRewardAmount?: string | null;
  isCouponUsed?: boolean | null;
};

export type MsmeDetails = {
  MsmeId?: string | null;
  ZedId?: string | null;
  CertificateNo?: string | null;
  DateOfPledge?: string | null;
  PledgeEmailId?: string | null;
  BasicDetails?: BasicDetails | null;
  ActivityDetails?: ActivityDetails | null;
  PlantDetails?: PlantDetails | null;
  msmeStatus?: MsmeStatus | null;
  msmeSurveillanceStatus?: MsmeStatus | null;
};

export type LoginResponse = BaseServiceResponse & {
  MsmeDetails?: MsmeDetails | null;
  parameters?: Element[] | null;
  remoteAssessmentData: RemoteAssessmentData;
};

/** LoginResponse.getAssociatedId: msmeId + zedId (Kotlin string concatenation, "null" for a missing part). */
export function associatedIdOf(user: LoginResponse | null): string | null {
  if (!user) return null;
  return String(user.MsmeDetails?.MsmeId ?? 'null') + String(user.MsmeDetails?.ZedId ?? 'null');
}

export function certificationDetailsOf(status: MsmeStatus | null | undefined, type: CertificationType): CertificationDetails | null {
  if (!status) return null;
  return (type === 'Bronze' ? status.bronze : type === 'Silver' ? status.silver : status.gold) ?? null;
}

/** CertificationDetails.updateStatus: only the server's fields are taken; local work stays. */
function updateStatus(local: CertificationDetails, server: CertificationDetails) {
  local.status = server.status;
  local.nc1Status = server.nc1Status;
  local.nc1StatusText = server.nc1StatusText;
  local.nc2Status = server.nc2Status;
  local.nc2StatusText = server.nc2StatusText;
  local.nc3Status = server.nc3Status;
  local.nc3StatusText = server.nc3StatusText;
  local.nc4Status = server.nc4Status;
  local.nc4StatusText = server.nc4StatusText;
  local.nc5Status = server.nc5Status;
  local.nc5StatusText = server.nc5StatusText;
  local.certificate = server.certificate;
  local.report = server.report;
  local.incentives = server.incentives;
  local.remoteStatus = server.remoteStatus;
  local.surveillanceStatus = server.surveillanceStatus;
  local.surveillanceDate = server.surveillanceDate;
}

/** MsmeStatus.updateCertificationDetails */
export function updateCertificationDetails(local: MsmeStatus, server: MsmeStatus) {
  if (server.bronze && local.bronze) updateStatus(local.bronze, server.bronze);
  if (server.silver && local.silver) updateStatus(local.silver, server.silver);
  if (server.gold && local.gold) updateStatus(local.gold, server.gold);
  local.financialAssistanceStatus = server.financialAssistanceStatus ?? 0;
  local.latestCertification = server.latestCertification;
  local.dateOfAvail = server.dateOfAvail;
  local.joiningRewardAmount = server.joiningRewardAmount;
  local.isCouponUsed = server.isCouponUsed;
}

/** MsmeDetails.updateMsmeSurveillanceStatus */
export function updateMsmeSurveillanceStatus(details: MsmeDetails, status: MsmeStatus) {
  if (details.msmeSurveillanceStatus == null) details.msmeSurveillanceStatus = status;
  else updateCertificationDetails(details.msmeSurveillanceStatus, status);
}

export const isAnyCertificationCompleted = (s: MsmeStatus) => s.bronze?.status === 3 || s.silver?.status === 4 || s.gold?.status === 4;

export const anyActiveNc = (c: CertificationDetails) =>
  c.nc1Status !== 0 || c.nc2Status !== 0 || c.nc3Status !== 0 || c.nc4Status !== 0 || c.nc5Status !== 0;

export const isCompletedAndDisabled = (c: CertificationDetails) => c.status === 5;
export const isSurveillanceNcActive = (c: CertificationDetails) => c.surveillanceStatus === '3';
export const isSurveillanceActive = (c: CertificationDetails) => c.surveillanceStatus === '1' || isSurveillanceNcActive(c);
export const parsedSurveillanceDate = (c: CertificationDetails) => parseLegacyDate(c.surveillanceDate);

/** getSurveillanceInfo: created on first use. */
export function surveillanceInfo(c: CertificationDetails): SurveillanceData {
  if (!c.surveillanceData) c.surveillanceData = { selfie: null, interiorPhotos: [], exteriorPhotos: [], siteTourPhotos: [] };
  c.surveillanceData.interiorPhotos ??= [];
  c.surveillanceData.exteriorPhotos ??= [];
  c.surveillanceData.siteTourPhotos ??= [];
  return c.surveillanceData;
}

/** CertificationDetails.setNcDetails */
export function setNcDetails(c: CertificationDetails, nc: NcDetails) {
  if (c.nc1Status === 1) c.ncOneDetails = nc;
  else if (c.nc2Status === 1) c.ncTwoDetails = nc;
  else if (c.nc3Status === 1) c.ncThreeDetails = nc;
  else if (c.nc4Status === 1) c.ncFourDetails = nc;
  else if (c.nc5Status === 1) c.ncFiveDetails = nc;
  c.activeNcDetails = nc;
  if (nc.siteExteriorPhotos != null && nc.siteExteriorPhotos.length > 0 && nc.siteExteriorPhotoData == null) {
    nc.siteExteriorPhotoData = [];
  }
}

// ---------- Normalisation of server data ----------

const str = (v: unknown): string => (v == null ? (v as unknown as string) : String(v));

/** Gson read numeric ids and codes into the String fields of the Kotlin models: do the same. */
export function normalizeElements(list: Element[] | null | undefined): Element[] | null {
  if (!list) return list ?? null;
  for (const e of list) {
    e.id = str(e.id);
    e.code = str(e.code);
    normalizeElements(e.subElements);
    for (const r of e.requirements ?? []) {
      r.id = str(r.id);
      r.code = str(r.code);
      for (const o of r.options ?? []) normalizeOption(o);
      for (const ev of r.evidences ?? []) {
        ev.id = str(ev.id);
        ev.code = str(ev.code);
        ev.validationRequired ??= false;
      }
    }
  }
  return list;
}

function normalizeOption(o: Option) {
  o.id = str(o.id);
  o.code = str(o.code);
  for (const s of o.subOptions ?? []) normalizeOption(s);
}

function normalizeCertification(c: CertificationDetails | null | undefined) {
  if (!c) return;
  c.status ??= 0;
  for (const k of ['nc1Status', 'nc2Status', 'nc3Status', 'nc4Status', 'nc5Status'] as const) c[k] ??= 0;
  c.finalSubmitDone ??= false;
  if (c.basicInformation) normalizeBasicInformation(c.basicInformation);
  normalizeElements(c.parameters);
}

export function normalizeStatus(s: MsmeStatus | null | undefined) {
  if (!s) return;
  s.financialAssistanceStatus ??= 0;
  normalizeCertification(s.bronze);
  normalizeCertification(s.silver);
  normalizeCertification(s.gold);
}

/** Fills what Gson's defaults would have filled (also for data saved by the legacy app). */
export function normalizeLoginResponse(r: LoginResponse): LoginResponse {
  r.remoteAssessmentData ??= { isSelfieSubmitted: false };
  r.remoteAssessmentData.isSelfieSubmitted ??= false;
  normalizeStatus(r.MsmeDetails?.msmeStatus);
  normalizeStatus(r.MsmeDetails?.msmeSurveillanceStatus);
  normalizeElements(r.parameters);
  return r;
}

export function normalizeNcDetails(nc: NcDetails): NcDetails {
  normalizeElements(nc.parameters);
  for (const p of nc.products ?? []) {
    if (p.productId != null) p.productId = String(p.productId);
    p.status ??= Status.TO_START;
  }
  nc.sitePhotosSubmitted ??= false;
  return nc;
}

/** The evidences of all requirements of all parameters (EvidencesActivity.getEvidencesList). */
export function evidencesOf(c: CertificationDetails | null): Evidence[] {
  const out: Evidence[] = [];
  for (const e of c?.parameters ?? []) for (const r of e.requirements ?? []) out.push(...(r.evidences ?? []));
  return out;
}

export function certificationLabel(type: CertificationType): string {
  // R.string.Bronze_Certification / Silver_Certification / Gold_Certification
  return type === 'Bronze' ? 'Bronze Surveillance' : type === 'Silver' ? 'Silver Certification' : 'Gold Certification';
}
