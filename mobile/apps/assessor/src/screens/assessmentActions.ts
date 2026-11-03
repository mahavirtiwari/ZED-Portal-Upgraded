import { BackHandler, Linking } from 'react-native';
import { isNetworkAvailable, zedDevice, type Ui } from '@zed/shared';
import type { SaApp } from '../app/SaApp';
import { openAssessment, UPDATE_APP } from '../flows/login';
import type { AssessmentSummary } from '../portfolio';
import { syncNow } from '../sync/queue';

type Nav = { push: (name: string, params?: Record<string, unknown>) => void };

export const UNSENT_WORK = 'This assessment has work on the phone that is not on the server yet. Please sync it before cleaning the data.';
export const CLEAN_DATA_ASK = 'Remove the copy of this assessment kept on the phone? It is downloaded again when you open it.';
export const DATA_CLEANED = 'Assessment data removed from the phone';

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

/** "View": downloads (or reads offline) the unit and opens its workspace (the legacy company profile + steps). */
export async function viewAssessment(app: SaApp, ui: Ui, nav: Nav, a: AssessmentSummary) {
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
      nav.push('CompanyProfile', { userType: out.userType, allottedParamsAvailable: out.allottedParamsAvailable });
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

/** "Clean data": refused while the unit has work the server does not have. */
export function cleanData(app: SaApp, ui: Ui, a: AssessmentSummary, done: () => void) {
  ui.alert(null, CLEAN_DATA_ASK, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Clean data',
      style: 'destructive',
      onPress: async () => {
        if (await app.hasUnsentWork(a.zedId)) return ui.showAlert(UNSENT_WORK);
        if (await app.deleteStoredAssessment(a.zedId)) ui.toast(DATA_CLEANED);
        done();
      },
    },
  ]);
}

/** The unit's address in the phone's map app (lat/long when the server has them). */
export function openMap(ui: Ui, address: string | null | undefined, latitude?: string | null, longitude?: string | null) {
  const q = latitude && longitude ? `${latitude},${longitude}` : (address ?? '').trim();
  if (!q) return ui.toast('Invalid Address');
  const url = latitude && longitude ? `geo:${q}?q=${q}` : 'geo:0,0?q=' + q.replace(/ /g, '+');
  Linking.openURL(url).catch(() => ui.showAlert('Failed to load given Address'));
}
