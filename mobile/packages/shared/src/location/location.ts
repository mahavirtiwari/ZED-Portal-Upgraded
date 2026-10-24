import { PermissionsAndroid, Platform } from 'react-native';
import { zedDevice } from '../native';

/** Constants.ENABLE_GPS_MESSAGE / ALERT and the failure text of R.string.failed_to_get_location. */
export const ENABLE_GPS_MESSAGE = 'Please Enable GPS/Location services';
export const FAILED_TO_GET_LOCATION =
  'Failed to get your location, please check your GPS and Internet connectivity then try again';
export const FINDING_LOCATION = 'Finding your location...';
/** LocationFetcher.LOCATION_REQUEST_TIMEOUT */
export const LOCATION_REQUEST_TIMEOUT_MS = 10_000;

export type Coordinates = {
  /** Java Double.toString texts, stamped on photos and sent in PhotoData. */
  latitude: string;
  longitude: string;
};

export type LocationOutcome =
  | { kind: 'ok'; coords: Coordinates }
  | { kind: 'gps-off' }
  | { kind: 'no-permission' }
  /** onConnectionFailure (mock locations): the message is shown with "Try Again". */
  | { kind: 'connection-failure'; message: string }
  /** onLocationUpdateFailure, or a fix at 0.0/0.0. */
  | { kind: 'failed'; message: string };

export async function ensureLocationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const fine = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
  if (await PermissionsAndroid.check(fine)) return true;
  return (await PermissionsAndroid.request(fine)) === PermissionsAndroid.RESULTS.GRANTED;
}

export async function ensureCameraPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const cam = PermissionsAndroid.PERMISSIONS.CAMERA;
  if (await PermissionsAndroid.check(cam)) return true;
  return (await PermissionsAndroid.request(cam)) === PermissionsAndroid.RESULTS.GRANTED;
}

/** LocationCaptureHelper.findCurrentLocation + LocationFetcher + imageLocationResultCallback's 0.0 check. */
export async function findCurrentLocation(timeoutMs = LOCATION_REQUEST_TIMEOUT_MS): Promise<LocationOutcome> {
  const device = zedDevice();
  if (!device.isGpsEnabled()) return { kind: 'gps-off' };
  if (!(await ensureLocationPermission())) return { kind: 'no-permission' };
  try {
    const loc = await device.getCurrentLocation(timeoutMs);
    if (loc.latitude !== 0 && loc.longitude !== 0) {
      return { kind: 'ok', coords: { latitude: loc.latitudeText, longitude: loc.longitudeText } };
    }
    return { kind: 'failed', message: FAILED_TO_GET_LOCATION };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'MOCKED') return { kind: 'connection-failure', message: (e as Error).message };
    if (code === 'NO_PERMISSION') return { kind: 'no-permission' };
    return { kind: 'failed', message: FAILED_TO_GET_LOCATION };
  }
}

export function openLocationSettings(): void {
  zedDevice().openLocationSettings();
}
