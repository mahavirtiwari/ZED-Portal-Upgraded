import { BackHandler, Linking } from 'react-native';
import { isNetworkAvailable, zedDevice, type Ui } from '@zed/shared';
import type { SaApp } from '../app/SaApp';
import { openAssessment, UPDATE_APP } from '../flows/login';
import type { AssessmentSummary } from '../portfolio';
import { syncNow } from '../sync/queue';

type Nav = { push: (name: string, params?: Record<string, unknown>) => void };

/** The legacy Clear Data question (AssessmentOptionsActivity), asked as before: no check of unsent work. */
export const CLEAR_DATA_ASK = 'Are you sure you want to clear the data associated with this login?';
export const DATA_CLEARED = 'Case data removed from the phone';

/** The legacy "update the app" question (SA/Login status 2). */
export function showUpdateAlert(ui: Ui) {
  ui.alert(
    null,
    UPDATE_APP,
    [
      { text: 'Exit', onPress: () => BackHandler.exitApp(), style: 'cancel' },
      {
        text: 'Go to Play Store',
        onPress: () => {
          Linking.openURL('market://details?id=' + zedDevice().getAppInfo().packageName).catch(() => undefined);
          BackHandler.exitApp();
        },
      },
    ],
    false,
  );
}

/** "Open Milestone": downloads (or reads offline) the unit and opens its milestone page (the legacy company profile + dashboard). */
export async function openMilestone(app: SaApp, ui: Ui, nav: Nav, a: AssessmentSummary) {
  const online = await isNetworkAvailable();
  if (online) ui.showLoading('Please Wait...');
  let out;
  try {
    out = await openAssessment(app, a, online);
  } finally {
    if (online) ui.hideLoading();
  }
  switch (out.kind) {
    case 'open':
      nav.push('AssessmentOptions', { userType: out.userType, allottedParamsAvailable: out.allottedParamsAvailable });
      syncNow(app).catch(() => undefined);
      break;
    case 'update':
      showUpdateAlert(ui);
      break;
    case 'alert':
      ui.showAlert(out.message);
      break;
    case 'toast':
      ui.toast(out.message, { long: true });
      break;
  }
}

/** "Clear data" of a case: the legacy question (Yes / No); Yes removes the phone's copy of the unit. */
export function clearData(app: SaApp, ui: Ui, zedId: string, done: () => void) {
  ui.alert('Alert', CLEAR_DATA_ASK, [
    {
      text: 'Yes',
      onPress: async () => {
        if (await app.deleteStoredAssessment(zedId)) ui.toast(DATA_CLEARED);
        done();
      },
    },
    { text: 'No', style: 'cancel' },
  ]);
}

/** The unit's address in the phone's map app (lat/long when the server has them). */
export function openMap(ui: Ui, address: string | null | undefined, latitude?: string | null, longitude?: string | null) {
  const q = latitude && longitude ? `${latitude},${longitude}` : (address ?? '').trim();
  if (!q) return ui.toast('Invalid Address');
  const url = latitude && longitude ? `geo:${q}?q=${q}` : 'geo:0,0?q=' + q.replace(/ /g, '+');
  Linking.openURL(url).catch(() => ui.showAlert('Failed to load given Address'));
}
