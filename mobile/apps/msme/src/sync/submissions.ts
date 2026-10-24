/**
 * The legacy submissions (BasicInfoViewModel, EvidencesActivity.handleEvidenceSubmission, NonConformanceViewModel,
 * SurveillanceViewModel), used both by the screens (online, as before) and by the sync queue (offline work sent
 * when the connection returns). Messages are the legacy ones.
 *
 * Each function returns a BaseServiceResponse-like result; a NetworkError is rethrown so that the queue can retry.
 */
import {
  errorResponse,
  isNetworkError,
  isSuccess,
  markSubmitted,
  UNKNOWN_ERROR,
  type BaseServiceResponse,
  type PhotoData,
} from '@zed/shared';
import type { MsmeApp } from '../app/MsmeApp';
import { LOCAL_FORM_PROPERTIES } from '../forms';
import {
  certificationDetailsOf,
  Status,
  surveillanceInfo,
  hasSiteTourPhotos,
  SURVEILLANCE_EXTERIOR,
  SURVEILLANCE_INTERIOR,
  SURVEILLANCE_SELFIE,
  SURVEILLANCE_SITE_TOUR,
  type BasicInformation,
  type CertificationDetails,
  type CertificationType,
  type Evidence,
  type MsmeStatus,
  type ProductDetailsNc,
  type Requirement,
} from '../models';

const deepCopy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Exceptions as the legacy Result.Error: the message, or the generic text. */
function failure(e: unknown): BaseServiceResponse {
  if (isNetworkError(e)) throw e;
  return errorResponse(e instanceof Error && e.message ? e.message : UNKNOWN_ERROR);
}

export function certification(app: MsmeApp, type: CertificationType, surveillance = false): CertificationDetails | null {
  const details = app.user?.MsmeDetails;
  const status: MsmeStatus | null | undefined = surveillance ? details?.msmeSurveillanceStatus : details?.msmeStatus;
  return certificationDetailsOf(status, type);
}

// ---------------------------------------------------------------- Basic information

/** BasicInfoViewModel.handleDataSubmission: basic information with selfie and site photos, then each product's photos. */
export async function submitBasicInformation(app: MsmeApp, type: CertificationType, info: BasicInformation): Promise<BaseServiceResponse> {
  const loginId = app.loginId!;
  const copy = deepCopy(info);
  // New (Admin forms): the form's answers travel next to basicInformation; standard fields the Admin disabled are
  // not sent; the selfie is checked only while the form asks for it.
  const omitted = new Set(info.omittedFields ?? []);
  const optional = new Set(info.optionalFields ?? []);
  const form = info.formVersion ? { customFields: info.customFields ?? {}, formVersion: info.formVersion } : undefined;
  for (const k of LOCAL_FORM_PROPERTIES) delete (copy as Record<string, unknown>)[k];
  let finalResponse: BaseServiceResponse | null = null;
  try {
    let sitePhotos: PhotoData[];
    try {
      sitePhotos = omitted.has('siteExteriorPhotos') ? [] : await app.photos.fill(info.siteExteriorPhotos, 'Site photos missing, please capture again');
    } catch (e) {
      return errorResponse((e as Error).message);
    }
    copy.assessorSelfie = !omitted.has('assessorSelfie') && copy.assessorSelfie?.photoId ? await app.photos.get(copy.assessorSelfie.photoId) : null;
    if (copy.assessorSelfie?.photo == null && !omitted.has('assessorSelfie') && !optional.has('assessorSelfie'))
      return errorResponse('Assessor Selfie Missing, please capture again');
    copy.siteExteriorPhotos = sitePhotos;
    for (const k of omitted) {
      const record = copy as unknown as Record<string, unknown>;
      record[k] = Array.isArray(record[k]) ? [] : null;
    }
    const r = await app.api.submitBasicInfo(loginId, type, copy, form);
    if (!isSuccess(r)) {
      if (r.errorMessage != null) r.errorMessage = `Error occurred while submitting basic info: ${r.errorMessage}`;
      return r;
    }
    finalResponse = r;

    for (const product of copy.productDetailsList) {
      const productPhotos = [product.productPhoto, product.productDescriptionPhoto].filter((p): p is PhotoData => p != null);
      let filled: PhotoData[];
      try {
        filled = await app.photos.fill(productPhotos, `${product.productName} product photos missing, please capture again`);
      } catch (e) {
        return errorResponse((e as Error).message);
      }
      finalResponse = await app.api.submitPhotos(loginId, type, filled);
    }
  } catch (e) {
    return failure(e);
  }
  return finalResponse ?? errorResponse(null);
}

// ---------------------------------------------------------------- Evidences

/** EvidencesActivity.handleEvidenceSubmission: one request per photo (isFirst/isLast). */
export async function submitEvidence(app: MsmeApp, type: CertificationType, evidence: Evidence): Promise<BaseServiceResponse | null> {
  if (evidence.status !== Status.COMPLETED) {
    return errorResponse(evidence.status === Status.SUBMITTED ? 'Evidence already submitted' : 'Evidence not completed');
  }
  let response: BaseServiceResponse | null = null;
  let photos: PhotoData[];
  try {
    photos = await app.photos.fill(evidence.photos ?? [], `Missing photo data for ${evidence.label} evidence`);
  } catch (e) {
    return errorResponse((e as Error).message);
  }
  for (let i = 0; i < photos.length; i++) {
    try {
      response = await app.api.submitEvidence(app.loginId!, type, evidence.id, photos[i]!, i === 0, i === photos.length - 1);
      if (!isSuccess(response)) return errorResponse(response?.errorMessage ?? UNKNOWN_ERROR);
    } catch (e) {
      if (isNetworkError(e)) throw e;
      return errorResponse(UNKNOWN_ERROR);
    }
  }
  return response;
}

/**
 * EvidencesActivity.onSyncClick: when the basic information is not yet SUBMITTED it is sent first (and marked
 * SUBMITTED on success), then the evidence; the evidence is marked SUBMITTED on success.
 */
export async function syncEvidence(app: MsmeApp, type: CertificationType, evidenceId: string): Promise<BaseServiceResponse> {
  const details = certification(app, type);
  const info = details?.basicInformation;
  if (info && info.status !== Status.SUBMITTED) {
    const r = await submitBasicInformation(app, type, info);
    if (!isSuccess(r)) return r;
    info.status = Status.SUBMITTED;
    await app.persist();
  }
  const evidence = findEvidence(details, evidenceId);
  if (!evidence) return errorResponse('Evidence not found');
  if (evidence.status === Status.SUBMITTED) return { status: '1' };
  const r = await submitEvidence(app, type, evidence);
  if (isSuccess(r)) {
    evidence.status = Status.SUBMITTED;
  }
  await app.persist();
  return r ?? errorResponse(null);
}

export function findEvidence(details: CertificationDetails | null, evidenceId: string): Evidence | null {
  for (const e of details?.parameters ?? []) for (const r of e.requirements ?? []) for (const ev of r.evidences ?? []) if (ev.id === evidenceId) return ev;
  return null;
}

// ---------------------------------------------------------------- Non-conformances

export function activeNc(app: MsmeApp, type: CertificationType, surveillance: boolean) {
  return certification(app, type, surveillance)?.activeNcDetails ?? null;
}

/** NonConformanceViewModel.submitSiteExteriorPhotos */
export async function submitNcSitePhotos(app: MsmeApp, type: CertificationType, surveillance: boolean): Promise<BaseServiceResponse> {
  const nc = activeNc(app, type, surveillance);
  if (!nc?.siteExteriorPhotoData || nc.msmeRemarksSitePhoto == null) return errorResponse(null);
  try {
    let photos: PhotoData[];
    try {
      photos = await app.photos.fill(nc.siteExteriorPhotoData, 'Site photos missing, please capture again');
    } catch (e) {
      return errorResponse((e as Error).message);
    }
    const r = await app.api.submitNcSitePhotos(app.loginId!, type, photos, nc.msmeRemarksSitePhoto, surveillance);
    if (isSuccess(r)) {
      nc.sitePhotosSubmitted = true;
      await app.persist();
    }
    return r;
  } catch (e) {
    return failure(e);
  }
}

/** NonConformanceViewModel.submitProduct (only a COMPLETED product is sent). */
export async function submitNcProduct(app: MsmeApp, type: CertificationType, surveillance: boolean, product: ProductDetailsNc): Promise<BaseServiceResponse> {
  if (product.status !== Status.COMPLETED) return errorResponse(null);
  const copy = deepCopy(product);
  const photos = [copy.productPhoto, copy.productDescriptionPhoto].filter((p): p is PhotoData => p != null);
  try {
    let filled: PhotoData[];
    try {
      filled = await app.photos.fill(photos, `${copy.productName} product photos missing, please capture again`);
    } catch (e) {
      return errorResponse((e as Error).message);
    }
    for (const p of filled) {
      if (p.photoId === copy.productPhoto?.photoId) copy.productPhoto = p;
      else if (p.photoId === copy.productDescriptionPhoto?.photoId) copy.productDescriptionPhoto = p;
    }
    const r = await app.api.submitNcProduct(app.loginId!, type, copy, surveillance);
    if (isSuccess(r)) {
      product.status = Status.SUBMITTED;
      await app.persist();
    }
    return r;
  } catch (e) {
    return failure(e);
  }
}

/** NonConformanceViewModel.submitRequirement: one request per photo. */
export async function submitNcRequirement(app: MsmeApp, type: CertificationType, surveillance: boolean, requirement: Requirement): Promise<BaseServiceResponse> {
  if ((requirement.status ?? Status.TO_START) !== Status.COMPLETED) return errorResponse(null);
  let photos: PhotoData[];
  try {
    photos = await app.photos.fill(requirement.photos ?? [], `${requirement.id} requirement photos missing, please capture again`);
  } catch (e) {
    return errorResponse((e as Error).message);
  }
  let response: BaseServiceResponse | null = null;
  for (let i = 0; i < photos.length; i++) {
    try {
      response = await app.api.submitNcRequirement(
        app.loginId!,
        type,
        requirement.id,
        requirement.code,
        photos[i]!,
        i === 0,
        i === photos.length - 1,
        requirement.msmeRemarks,
        surveillance,
      );
      if (isSuccess(response)) {
        requirement.status = Status.SUBMITTED;
      } else {
        response = errorResponse(response?.errorMessage ?? UNKNOWN_ERROR);
        break;
      }
    } catch (e) {
      if (isNetworkError(e)) throw e;
      response = errorResponse(UNKNOWN_ERROR);
      break;
    }
  }
  await app.persist();
  return response ?? errorResponse(UNKNOWN_ERROR);
}

// ---------------------------------------------------------------- Surveillance photos

async function submitSurveillancePhoto(app: MsmeApp, type: CertificationType, key: string, photo: PhotoData | null | undefined, missing: string) {
  if (photo && photo.status === 2) return { status: '1' } as BaseServiceResponse;
  if (!photo || !photo.photoPath) return errorResponse(missing);
  try {
    const r = await app.api.submitSurveillancePhoto(app.loginId!, type, key, photo);
    if (isSuccess(r)) {
      markSubmitted(photo);
      return r;
    }
    return errorResponse(r.errorMessage);
  } catch (e) {
    if (isNetworkError(e)) throw e;
    return errorResponse(UNKNOWN_ERROR);
  }
}

/** SurveillanceViewModel.submitData */
export async function submitSurveillance(app: MsmeApp, type: CertificationType): Promise<BaseServiceResponse> {
  const details = certification(app, type);
  if (!details) return errorResponse(null);
  const data = surveillanceInfo(details);
  try {
    const selfie = await submitSurveillancePhoto(app, type, SURVEILLANCE_SELFIE, data.selfie, 'Please capture selfie');
    if (!isSuccess(selfie)) return selfie;
    for (const p of data.interiorPhotos.filter(x => x.status !== 2)) {
      const r = await submitSurveillancePhoto(app, type, SURVEILLANCE_INTERIOR, p, 'Please capture interior photo');
      if (!isSuccess(r)) return r;
    }
    for (const p of data.exteriorPhotos.filter(x => x.status !== 2)) {
      const r = await submitSurveillancePhoto(app, type, SURVEILLANCE_EXTERIOR, p, 'Please capture exterior photo');
      if (!isSuccess(r)) return r;
    }
    if (!hasSiteTourPhotos(data)) return errorResponse('Please capture site tour photos');
    const pending = data.siteTourPhotos.filter(x => x.status !== 2);
    if (pending.length === 0) return { status: '1' };
    // The legacy loop's "return@forEach" only skipped to the next photo, so the last answer is reported.
    let last: BaseServiceResponse = { status: '1' };
    for (const p of pending) last = await submitSurveillancePhoto(app, type, SURVEILLANCE_SITE_TOUR, p, 'Invalid/Missing Site Tour Photo');
    return last;
  } finally {
    await app.persist();
  }
}
