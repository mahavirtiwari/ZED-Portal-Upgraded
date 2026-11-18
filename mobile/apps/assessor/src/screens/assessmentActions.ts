import { BackHandler, Linking } from 'react-native';
import { isNetworkAvailable, zedDevice, type Ui } from '@zed/shared';
import type { SaApp } from '../app/SaApp';
import { openAssessment, UPDATE_APP } from '../flows/login';
import type { AssessmentSummary } from '../portfolio';
import { syncNow } from '../sync/queue';

type Nav = { push: (name: string, params?: Record<string, unknown>) => void };

/**
 * 2026-11-18: "Clear data" section by section (ClearDataSheet; it replaces the one-step "Clean data", which was refused while
 * anything was unsent): the sheet's texts. The same for an Onsite certification and a surveillance visit.
 */
export const CLEAR_DATA_SUBTITLE = 'Select the captured data to remove from this device. Synced data stays on the server.';
export const UNSYNCED_WARNING = 'Unsynced data cannot be recovered. Sync before clearing.';
export const CLEAR_CONFIRM_TEXT =
  'They are removed from this phone only. What the server has stays and comes back when you open the assessment online; the other steps stay as they are.';
export const UNDERSTAND_LOSS = 'I understand the unsynced work in these sections will be lost.';
export const EVERYTHING_TITLE = 'Remove everything for this assessment?';
export const EVERYTHING_TEXT =
  'Every step of this assessment is removed from the phone: answers, photos, meetings, attendance and the sends waiting to sync. The assessment is downloaded again when you open it online.';
/** Typed to confirm removing everything while some of it is not synced. */
export const TYPE_TO_CONFIRM = 'CLEAR';
export const NOTHING_KEPT = 'Nothing of this assessment is kept on the phone.';
export const DATA_CLEANED = 'Assessment data removed from the phone';
export const CLEAR_FAILED = 'Could not clear the data, please try again';
export const sectionsCleared = (n: number) => (n === 1 ? '1 section removed from the phone' : `${n} sections removed from the phone`);

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

/** The unit's address in the phone's map app (lat/long when the server has them). */
export function openMap(ui: Ui, address: string | null | undefined, latitude?: string | null, longitude?: string | null) {
  const q = latitude && longitude ? `${latitude},${longitude}` : (address ?? '').trim();
  if (!q) return ui.toast('Invalid Address');
  const url = latitude && longitude ? `geo:${q}?q=${q}` : 'geo:0,0?q=' + q.replace(/ /g, '+');
  Linking.openURL(url).catch(() => ui.showAlert('Failed to load given Address'));
}
