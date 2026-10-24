import { BackHandler } from 'react-native';
import { parseLegacyDate, useUi, zedDevice } from '@zed/shared';
import { TIME_NOT_AUTOMATIC } from '../photo/capture';

type Ui = ReturnType<typeof useUi>;

/** BaseActivity.showExitAlert: Yes goes to the home screen. */
export function showExitAlert(ui: Ui) {
  ui.alert(
    null,
    'Are you sure you want to exit?',
    [
      { text: 'No', style: 'cancel' },
      { text: 'Yes', onPress: () => BackHandler.exitApp() },
    ],
    false,
  );
}

/** The "Automatic Time" check of CompanyProfileActivity: OK goes back to the login. */
export function checkAutoTime(ui: Ui, toLogin: () => void): boolean {
  if (zedDevice().isAutoTimeEnabled()) return true;
  ui.alert(null, TIME_NOT_AUTOMATIC, [{ text: 'Ok', onPress: toLogin }], false);
  return false;
}

export const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

/** "MM/dd/yyyy hh:mm:ss a" (Locale.US) of the SA date. */
export const saDateOf = (text: string | null | undefined) => (text ? parseLegacyDate(text) : null);

/** stripTimeFromDate: "MM/dd/yyyy", or the text itself when it cannot be read. */
export function stripTimeFromDate(text: string): string {
  const d = saDateOf(text);
  if (!d) return text;
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getMonth() + 1)}/${two(d.getDate())}/${d.getFullYear()}`;
}
