/**
 * Codegen spec of the shared native module (Android, Kotlin: packages/shared/android).
 *
 * Everything the legacy apps did with Android APIs that React Native does not offer one to one lives here,
 * so that the behaviour (and, for photos, the pixels) stays exactly as in the legacy code: device info,
 * the fused location fetch of LocationFetcher, the camera intent and the photo pipeline of
 * PhotoCaptureHelper (scale, EXIF rotation, time/latitude/longitude stamp, JPEG qualities, file names).
 */
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export type NativeDeviceInfo = {
  deviceId: string;
  osVersion: string;
  apiLevel: number;
  device: string;
  modelProduct: string;
  manufacturer: string;
};

export type NativeAppInfo = {
  packageName: string;
  versionName: string;
  versionCode: number;
  /** Android string resource `zed_environment` of the app (production, staging or local). */
  environment: string;
};

export type NativeMemoryInfo = {
  availableRamMb: number;
  availableStorageMb: number;
};

export type NativeLocation = {
  latitude: number;
  longitude: number;
  /** Java Double.toString of the coordinates, as the legacy code stamps and sends them. */
  latitudeText: string;
  longitudeText: string;
  accuracy: number;
  time: number;
};

export type NativeCaptureResult = {
  /** content:// uri handed to the camera (FileProvider). */
  uri: string;
  /** Absolute path of the temporary capture file (cacheDir/SharedDocs/Geostat_yyyyMMdd_HHmmss_*.jpg). */
  tempPath: string;
};

export type NativePickResult = {
  uri: string;
  /** Size in bytes when the provider reports it, else -1. */
  size: number;
};

export type NativeProcessedImage = {
  /** filesDir/<UUID>.<ext> written with JPEG quality 100. */
  photoPath: string;
  /** Base64 (NO_WRAP) of the stamped bitmap compressed with JPEG quality 75 (legacy getBitmapString). */
  base64: string;
  /** The "MMM dd, yyyy h:mm a" (Locale.ENGLISH) text drawn on the image, also the PhotoData timeStamp. */
  timeStamp: string;
  width: number;
  height: number;
};

export interface Spec extends TurboModule {
  getDeviceInfo(): NativeDeviceInfo;
  getAppInfo(): NativeAppInfo;
  getMemoryInfo(): NativeMemoryInfo;
  isAutoTimeEnabled(): boolean;
  isGpsEnabled(): boolean;
  openLocationSettings(): void;
  /** LocationFetcher: fused provider, high accuracy, accuracy <= 100 m, fix younger than 15 min, 10 s timeout. */
  getCurrentLocation(timeoutMs: number): Promise<NativeLocation>;

  /** MediaStore.ACTION_IMAGE_CAPTURE into a temp file; resolves null when the user cancels. */
  capturePhoto(): Promise<NativeCaptureResult | null>;
  /** Intent.ACTION_PICK on MediaStore images; resolves null when cancelled. */
  pickImage(): Promise<NativePickResult | null>;
  /** Intent.ACTION_OPEN_DOCUMENT for application/pdf; resolves null when cancelled. */
  pickPdf(): Promise<NativePickResult | null>;
  /** The legacy getScaledBitmap + copyImage + getBitmapString pipeline. Stamps only when both coordinates are given. */
  processImage(uri: string, latitude: string | null, longitude: string | null): Promise<NativeProcessedImage>;
  /** Copies a picked PDF to filesDir/<UUID>.pdf and returns the path. */
  copyPdf(uri: string): Promise<string>;
  /** Reads a file as base64 (used for PDFs, which have no thumbnail). */
  readFileBase64(path: string): Promise<string>;
  deleteFile(path: string): boolean;
  fileExists(path: string): boolean;
  /** Copies to cacheDir/SharedDocs/Image.jpg and opens an image viewer (legacy viewImage). */
  openImage(path: string): void;
  /** Copies to cacheDir/SharedDocs/<fileName> and opens a PDF viewer (legacy openPdf). */
  openPdf(path: string, fileName: string): void;

  setClipboard(text: string): void;
  /** PBKDF2-HMAC-SHA256, hex encoded. */
  hashPassword(password: string, saltHex: string, iterations: number): string;
  randomHex(bytes: number): string;

  /** SharedPreferences of the legacy app (same file names and keys). */
  getPreference(file: string, key: string): string | null;
  setPreference(file: string, key: string, value: string): void;
  removePreference(file: string, key: string): void;
}

export default TurboModuleRegistry.get<Spec>('ZedDevice');
