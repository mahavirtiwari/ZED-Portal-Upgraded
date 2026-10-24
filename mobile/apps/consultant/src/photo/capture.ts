import { useCallback } from 'react';
import { ensureCameraPermission, findCurrentLocation, formatDate, PHOTO_TIMESTAMP_PATTERN, usePhotoCapture, useUi, zedDevice, type Coordinates } from '@zed/shared';
import { useSa } from '../app/context';
import { ENABLE_GPS_MESSAGE } from '../models';

/** R.string.failed_to_get_location of the consultant app. */
export const FAILED_TO_GET_LOCATION = 'Failed to get your location';
/**
 * LocationFetcher.getNotAvailable of this app: without a fix the last known location (the native side already falls
 * back to it), else 1.0, 1.0 (String.valueOf(1d)), instead of the failure dialog.
 */
export const NO_FIX_COORDINATES = { latitude: '1.0', longitude: '1.0' };
/** Utils.getBitmapString of this app compressed at 100. */
const INLINE_JPEG_QUALITY = 100;
export const ATTEMPTING_LOCATION = 'Attempting to find your location';
export const LOCATION_OBTAINED = 'Location obtained successfully';
export const TIME_NOT_AUTOMATIC = 'Your Date and Time settings are not set to Automatic Time zone. Please change and continue.';

/**
 * The newer photo screens (attendance, training, the milestone sections, technology upgradation): PhotoCaptureHelper +
 * LocationCaptureHelper, the MSME pipeline (1080 px, file in filesDir, base64 in photos_table). Photo ids are the
 * consultant ID + millis (Utils.getId(saId)), the owner ZED ID + consultant ID.
 */
export function useSaPhotoCapture() {
  const app = useSa();
  return usePhotoCapture({
    store: app.photos,
    loginId: app.saId,
    associatedId: app.zedId + app.saId,
    failedLocationMessage: FAILED_TO_GET_LOCATION,
    noFixCoordinates: NO_FIX_COORDINATES,
  });
}

/** BaseActivity.getCurrentTimeStamp("") (the date of PhotoInformation.timeStamp). */
export const currentTimeStamp = () => formatDate(new Date(), PHOTO_TIMESTAMP_PATTERN);

export type InlinePhoto = { base64: string; timeStamp: string; coords: Coordinates | null };

/**
 * The older photo screens (meetings, site photos, site tour): their own location dialogs (GPS off -> "Please Enable
 * GPS/Location services" OK; "Attempting to find your location"; "Location obtained successfully"; no fix -> 1.0,
 * 1.0 as above), then the camera, then BaseActivity.displayImageWithUri + getBitmapString: 1280 px, stamped, base64
 * (JPEG 100) kept in the app's JSON; the camera's file is deleted.
 */
export function useInlineCapture(options: { onConnectionFailure?: (message: string) => void } = {}) {
  const ui = useUi();

  /** getLocation(): resolves the fix, or null after the legacy dialogs. */
  const locate = useCallback(async (): Promise<Coordinates | null> => {
    for (;;) {
      if (!zedDevice().isGpsEnabled()) {
        await new Promise<void>(resolve => ui.alert(null, ENABLE_GPS_MESSAGE, [{ text: 'OK', onPress: () => resolve() }], false));
        return null;
      }
      ui.showLoading(ATTEMPTING_LOCATION);
      let outcome;
      try {
        outcome = await findCurrentLocation();
      } finally {
        ui.hideLoading();
      }
      if (outcome.kind === 'ok') {
        ui.toast(LOCATION_OBTAINED);
        return outcome.coords;
      }
      if (outcome.kind === 'gps-off') continue;
      if (outcome.kind === 'no-permission') {
        ui.showAlert('Location permission needed to access current location');
        return null;
      }
      if (outcome.kind === 'connection-failure') {
        if (options.onConnectionFailure) options.onConnectionFailure(outcome.message);
        else ui.showAlert(outcome.message);
        return null;
      }
      if (outcome.kind === 'failed') {
        ui.toast(LOCATION_OBTAINED);
        return NO_FIX_COORDINATES;
      }
      const retry = await new Promise<boolean>(resolve =>
        ui.alert(null, FAILED_TO_GET_LOCATION, [{ text: 'Try Again', onPress: () => resolve(true), style: 'cancel' }], true, () => resolve(false)),
      );
      if (!retry) return null;
    }
  }, [ui, options]);

  /** startCamera + the result handler. `coords` given: the camera opens at once (site tour reuses the last fix). */
  const capture = useCallback(
    async (opts: { front?: boolean; coords?: Coordinates | null; locate?: boolean } = {}): Promise<InlinePhoto | null> => {
      let coords = opts.coords ?? null;
      if (!coords && opts.locate !== false) {
        coords = await locate();
        if (!coords) return null;
      }
      if (!(await ensureCameraPermission())) return null;
      const device = zedDevice();
      const shot = opts.front ? await device.capturePhotoFront() : await device.capturePhoto();
      if (!shot) return null;
      // getCurrentTimeStamp shows this (and goes on) when the time is not automatic.
      if (!device.isAutoTimeEnabled()) ui.alert(null, TIME_NOT_AUTOMATIC, [{ text: 'Ok' }], false);
      ui.showLoading();
      try {
        const img = await device.processImageInlineQuality(shot.uri, coords?.latitude ?? null, coords?.longitude ?? null, INLINE_JPEG_QUALITY);
        return { base64: img.base64, timeStamp: currentTimeStamp(), coords };
      } catch {
        return null;
      } finally {
        if (shot.tempPath) device.deleteFile(shot.tempPath);
        ui.hideLoading();
      }
    },
    [locate, ui],
  );

  return { capture, locate };
}
