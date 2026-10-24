/**
 * PhotoData (models/PhotoData.java, Room entity "photos_table"): field names as Gson writes them, because the
 * same object travels in the app's JSON (with `photo` cleared) and in the requests (with `photo` filled in).
 */
export type PhotoData = {
  photoId: string;
  /** Base64 JPEG (quality 75) of the stamped image; only kept in photos_table, null in the app's JSON. */
  photo?: string | null;
  name?: string | null;
  /** Absolute path of the stored file (filesDir/<UUID>.jpg or .pdf). */
  photoPath?: string | null;
  /** "MMM dd, yyyy h:mm a" capture time. */
  timeStamp?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  associatedId: string;
  status: number;
  isPdf: boolean;
};

export const PHOTO_DEFAULT = 0;
export const PHOTO_TO_SUBMIT = 1;
export const PHOTO_SUBMITTED = 2;

export function isSubmitted(p: PhotoData): boolean {
  return p.status === PHOTO_SUBMITTED;
}

export function markSubmitted(p: PhotoData): void {
  p.status = PHOTO_SUBMITTED;
}

/** The copy kept in the app's JSON: `photo` cleared (info.photo = null after inserting into Room). */
export function withoutBase64(p: PhotoData): PhotoData {
  return { ...p, photo: null };
}

/** Utils.getId: prefix + System.currentTimeMillis(). */
export function newPhotoId(prefix: string | null | undefined, now: number = Date.now()): string {
  return prefix == null ? '' : prefix + String(now);
}

/** Utils.getExtensionFromPath: the extension with the dot. */
export function extensionOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i >= 0 ? path.substring(i) : '';
}

export function fileNameOf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i >= 0 ? path.substring(i + 1) : path;
}

export function fileUri(path: string): string {
  return path.startsWith('file://') || path.startsWith('content://') ? path : 'file://' + path;
}
