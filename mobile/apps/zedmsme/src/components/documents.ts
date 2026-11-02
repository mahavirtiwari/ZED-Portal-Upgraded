import { Linking } from 'react-native';
import { isNetworkAvailable, SESSION_EXPIRED_MESSAGE, zedDevice, type Ui } from '@zed/shared';
import type { MsmeApp } from '../app/MsmeApp';

const FILE = /\.(pdf|jpe?g|png|docx?|xlsx?|pptx?|csv|txt)$/i;
const IMAGE = /\.(jpe?g|png)$/i;

/** A file name for the downloaded copy: the address's own name, else `{name}.pdf`. */
function fileNameFor(path: string, name: string) {
  const last = decodeURIComponent(path.split(/[?#]/)[0]?.split('/').pop() ?? '');
  if (FILE.test(last)) return last.replace(/[^\w.\- ]/g, '_');
  return name.replace(/[^\w\- ]/g, '_') + '.pdf';
}

/**
 * Msme/AppDocument answers 401 when it does not accept the app sign-in token; the native download then fails with
 * "HTTP 401" (ZedDeviceModule.downloadFile).
 */
export function isSignInRefused(e: unknown): boolean {
  const message = typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message) : '';
  return /\bHTTP 401\b/.test(message);
}

/**
 * MyDocumentsActivity.openFile / MyCertificationsFragment.openPledgePdf: downloads the document with the sign-in token
 * (Msme/AppDocument) and opens it. A video or other web page (a guideline's link) opens in the browser.
 */
export async function openDocument(app: MsmeApp, ui: Ui, path: string, name: string) {
  const isFile = path === 'pledge' || FILE.test(path.split(/[?#]/)[0] ?? '');
  if (!isFile && /^https?:\/\//i.test(path)) {
    Linking.openURL(path).catch(() => ui.toast('No suitable application found to perform this action'));
    return;
  }
  if (!(await isNetworkAvailable())) return ui.toast('Network Unavailable', { long: true });
  const fileName = path === 'pledge' ? `Pledge_Certificate_${app.user?.MsmeDetails?.ZedId ?? ''}.pdf` : fileNameFor(path, name);
  ui.showLoading();
  try {
    const local = await zedDevice().downloadFile(app.api.documentUrl(path), fileName, app.session.appToken);
    if (fileName.toLowerCase().endsWith('.pdf')) zedDevice().openPdf(local, fileName);
    else if (IMAGE.test(fileName)) zedDevice().openImage(local);
    else ui.showAlert('This document can be opened from My Documents on the ZED portal.');
  } catch (e) {
    // New in V4: a refused sign-in ends the session as on the app's other calls (shared http.ts): the login page with
    // "Your sign-in has expired. Please sign in again." (SessionExpiryGate), not "Unknown error".
    if (isSignInRefused(e)) app.session.expire(SESSION_EXPIRED_MESSAGE);
    else ui.toast('Unknown error occurred while downloading file', { long: true });
  } finally {
    ui.hideLoading();
  }
}
