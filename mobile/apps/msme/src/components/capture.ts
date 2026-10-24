import { usePhotoCapture, useNavigation, zedDevice } from '@zed/shared';
import { useMsme } from '../app/context';

/**
 * The photo capture of a legacy screen: this app's photo table and owner id; the "Automatic Time" alert closes the
 * screen (finish()). Activities toasted "Finding your location...", dialog fragments showed a snackbar.
 */
export function useScreenCapture(findingStyle: 'toast' | 'snackbar' = 'toast', onTimeNotAutomatic?: () => void) {
  const app = useMsme();
  const nav = useNavigation();
  return usePhotoCapture({
    store: app.photos,
    loginId: app.loginId,
    associatedId: app.associatedId,
    findingStyle,
    onTimeNotAutomatic: onTimeNotAutomatic ?? (() => nav.pop()),
  });
}

/** UUID.randomUUID().toString() (row ids of products and raw materials). */
export function randomUuid(): string {
  const h = zedDevice().randomHex(16).split('');
  h[12] = '4';
  h[16] = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
