import { zedDevice } from '../native';
import type { PhotoStore } from '../db/photoStore';
import { formatDate, PHOTO_TIMESTAMP_PATTERN } from '../util/dates';
import type { Coordinates } from '../location/location';
import { ensureCameraPermission } from '../location/location';
import { newPhotoId, PHOTO_DEFAULT, withoutBase64, type PhotoData } from './photoData';

/** PhotosHelper.addPhoto size check. */
export const MAX_PDF_BYTES = 2 * 1024 * 1024;
export const PDF_TOO_LARGE = 'File size cannot exceed 2 MB';
export const PHOTO_SAVE_FAILED = 'Failed to save the captured photo, please try again';
export const TIME_NOT_AUTOMATIC =
  'Your Date and Time settings are not set to Automatic Time zone. Please change and continue.';

export type PhotoSource = 'camera' | 'gallery' | 'pdf';

export type CaptureContext = {
  store: PhotoStore;
  /** MApplication.loginId(): prefix of new photo ids. */
  loginId: string | null;
  /** LoginResponse.getAssociatedId() (msmeId + zedId): owner of the photo rows. */
  associatedId: string | null;
  coords: Coordinates | null;
  /** The legacy getCurrentTimeStamp showed TIME_NOT_AUTOMATIC and closed the screen when auto time was off. */
  onTimeNotAutomatic?: () => void;
};

export type CaptureOutcome =
  | { kind: 'added'; photo: PhotoData }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string; /** Legacy showed it as an alert (true) or a snackbar (false). */ alert: boolean };

function checkAutoTime(ctx: CaptureContext) {
  try {
    if (!zedDevice().isAutoTimeEnabled()) ctx.onTimeNotAutomatic?.();
  } catch {
    // not fatal
  }
}

/** Opens the camera, gallery or PDF picker; null when the user cancels. */
export async function pickSource(source: PhotoSource): Promise<{ uri: string; tempPath: string | null; size: number } | null> {
  const device = zedDevice();
  if (source === 'camera') {
    if (!(await ensureCameraPermission())) return null;
    const r = await device.capturePhoto();
    return r ? { uri: r.uri, tempPath: r.tempPath || null, size: -1 } : null;
  }
  const r = source === 'gallery' ? await device.pickImage() : await device.pickPdf();
  return r ? { uri: r.uri, tempPath: null, size: r.size } : null;
}

/**
 * PhotoCaptureHelper.handleCapturedImage: stamp and store a captured or picked image. With `replacePhotoId`
 * (re-capture of a submitted photo) the old row is removed first and the id is reused.
 */
export async function storeImage(
  ctx: CaptureContext,
  uri: string,
  tempPath: string | null,
  replacePhotoId: string | null = null,
): Promise<CaptureOutcome> {
  if (ctx.associatedId == null) return { kind: 'error', message: PHOTO_SAVE_FAILED, alert: false };
  checkAutoTime(ctx);
  const device = zedDevice();
  let processed;
  try {
    processed = await device.processImage(uri, ctx.coords?.latitude ?? null, ctx.coords?.longitude ?? null);
  } catch {
    return { kind: 'cancelled' }; // the legacy code silently added nothing when the bitmap could not be made
  }
  if (replacePhotoId != null) await ctx.store.delete(replacePhotoId);
  const info: PhotoData = {
    photoId: replacePhotoId ?? newPhotoId(ctx.loginId),
    photo: processed.base64,
    associatedId: ctx.associatedId,
    photoPath: processed.photoPath,
    timeStamp: processed.timeStamp,
    latitude: ctx.coords?.latitude ?? null,
    longitude: ctx.coords?.longitude ?? null,
    isPdf: false,
    status: PHOTO_DEFAULT,
  };
  await ctx.store.insert(info);
  if (tempPath) device.deleteFile(tempPath);
  return { kind: 'added', photo: withoutBase64(info) };
}

/** PhotoCaptureHelper.handlePickedPdf with PhotosHelper.copyPdf. */
export async function storePdf(ctx: CaptureContext, uri: string, size: number): Promise<CaptureOutcome> {
  if (size > MAX_PDF_BYTES) return { kind: 'error', message: PDF_TOO_LARGE, alert: true };
  if (ctx.associatedId == null) return { kind: 'error', message: PHOTO_SAVE_FAILED, alert: false };
  checkAutoTime(ctx);
  const path = await zedDevice().copyPdf(uri);
  const info: PhotoData = {
    photoId: newPhotoId(ctx.loginId),
    photo: null,
    associatedId: ctx.associatedId,
    photoPath: path,
    timeStamp: formatDate(new Date(), PHOTO_TIMESTAMP_PATTERN),
    latitude: ctx.coords?.latitude ?? null,
    longitude: ctx.coords?.longitude ?? null,
    isPdf: true,
    status: PHOTO_DEFAULT,
  };
  await ctx.store.insert(info);
  return { kind: 'added', photo: withoutBase64(info) };
}

/** PhotosHelper.removePhotoData. */
export async function removePhoto(store: PhotoStore, photo: PhotoData): Promise<void> {
  await store.delete(photo.photoId);
  if (photo.photoPath) zedDevice().deleteFile(photo.photoPath);
}

/** Tap on a thumbnail: viewImage / the PDF viewer ("PDF File.pdf"). */
export function viewPhoto(photo: PhotoData): void {
  if (!photo.photoPath) return;
  if (photo.isPdf) zedDevice().openPdf(photo.photoPath, 'PDF File.pdf');
  else zedDevice().openImage(photo.photoPath);
}
