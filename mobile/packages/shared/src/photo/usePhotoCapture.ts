import { useCallback, useRef } from 'react';
import { useUi } from '../ui/UiHost';
import { zedDevice } from '../native';
import type { PhotoStore } from '../db/photoStore';
import {
  ENABLE_GPS_MESSAGE,
  FINDING_LOCATION,
  findCurrentLocation,
  openLocationSettings,
  type Coordinates,
} from '../location/location';
import { pickSource, storeImage, storePdf, TIME_NOT_AUTOMATIC, type PhotoSource } from './photoCapture';
import type { PhotoData } from './photoData';

export type PhotoCaptureOptions = {
  store: PhotoStore;
  loginId: string | null;
  associatedId: string | null;
  /** What the legacy screen did after the "Automatic Time" alert: finish() the activity. */
  onTimeNotAutomatic?: () => void;
  /** Activities toasted "Finding your location...", dialog fragments showed a snackbar. */
  findingStyle?: 'toast' | 'snackbar';
  /** The app's R.string.failed_to_get_location (the site assessor app's is shorter than the MSME app's). */
  failedLocationMessage?: string;
};

export type Capturer = {
  /**
   * The legacy onAddClick flow: the location is fetched once per screen (latitude/longitude kept), then the camera,
   * gallery or PDF picker opens, then the image is stamped and stored. Resolves the new photo, or null.
   */
  capture(source: PhotoSource, options?: { replacePhotoId?: string | null; askName?: () => Promise<string | null> }): Promise<PhotoData | null>;
  readonly coords: Coordinates | null;
};

export function usePhotoCapture(options: PhotoCaptureOptions): Capturer {
  const ui = useUi();
  const coordsRef = useRef<Coordinates | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  /**
   * LocationCaptureHelper.findCurrentLocation and its dialogs: GPS off -> "Alert / Please Enable GPS..." (OK opens the
   * settings); otherwise "Finding your location..." with the loading overlay, then the fix, or the failure dialog
   * with "Try Again". Resolves null when there is no location.
   */
  const locateWithFeedback = useCallback(async (): Promise<Coordinates | null> => {
    for (;;) {
      if (!zedDevice().isGpsEnabled()) {
        ui.alert('Alert', ENABLE_GPS_MESSAGE, [{ text: 'OK', onPress: openLocationSettings }], false);
        return null;
      }
      if (optionsRef.current.findingStyle === 'snackbar') ui.snackbar(FINDING_LOCATION);
      else ui.toast(FINDING_LOCATION, { long: true });
      ui.showLoading();
      let outcome;
      try {
        outcome = await findCurrentLocation();
      } finally {
        ui.hideLoading();
      }
      if (outcome.kind === 'ok') return outcome.coords;
      if (outcome.kind === 'gps-off') continue;
      if (outcome.kind === 'no-permission') {
        ui.showAlert('Location permission needed to access current location');
        return null;
      }
      const message = outcome.kind === 'failed' && optionsRef.current.failedLocationMessage ? optionsRef.current.failedLocationMessage : outcome.message;
      const retry = await new Promise<boolean>(resolve =>
        ui.alert(null, message, [{ text: 'Try Again', onPress: () => resolve(true), style: 'cancel' }], true, () => resolve(false)),
      );
      if (!retry) return null;
    }
  }, [ui]);

  const capture = useCallback<Capturer['capture']>(
    async (source, opts) => {
      if (!coordsRef.current) {
        const coords = await locateWithFeedback();
        if (!coords) return null;
        coordsRef.current = coords;
      }
      const picked = await pickSource(source);
      if (!picked) return null;
      let name: string | null = null;
      if (opts?.askName) {
        name = await opts.askName();
        if (name == null || name.trim() === '') return null;
      }
      const o = optionsRef.current;
      const ctx = {
        store: o.store,
        loginId: o.loginId,
        associatedId: o.associatedId,
        coords: coordsRef.current,
        onTimeNotAutomatic: () =>
          ui.alert(null, TIME_NOT_AUTOMATIC, [{ text: 'Ok', onPress: () => o.onTimeNotAutomatic?.() }], false),
      };
      ui.showLoading();
      try {
        const outcome =
          source === 'pdf'
            ? await storePdf(ctx, picked.uri, picked.size)
            : await storeImage(ctx, picked.uri, picked.tempPath, opts?.replacePhotoId ?? null);
        if (outcome.kind === 'added') {
          return name != null ? { ...outcome.photo, name } : outcome.photo;
        }
        if (outcome.kind === 'error') {
          if (outcome.alert) ui.showAlert(outcome.message);
          else ui.snackbar(outcome.message);
        }
        return null;
      } finally {
        ui.hideLoading();
      }
    },
    [locateWithFeedback, ui],
  );

  return {
    capture,
    get coords() {
      return coordsRef.current;
    },
  };
}
