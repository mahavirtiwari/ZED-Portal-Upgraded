import { isNetworkError } from '@zed/shared';
import type { SaApp } from '../app/SaApp';
import { PREFS } from '../db/stores';
import { normalizeDetails, setAllParametersToCompleted, Status, type AssessmentDetails } from '../models';

export const LOGIN_SUCCESSFUL = 'Login Successful.';
export const INVALID_USER = 'Invalid Username or Password';
export const NETWORK_UNAVAILABLE = 'Network Unavailable';
export const ENTER_ALL_DETAILS = 'Please enter all the details.';
export const UPDATE_APP =
  'There is an Updated version of ZED SA App available in Play store, Please update from Google Play store.';

export type LoginInput = { assessorId: string; password: string; zedId: string };

/** LoginActivity.initialize: assessor and ZED ID trimmed and upper-cased, the password trimmed. */
export function normalizeLoginInput(assessorId: string, password: string, zedId: string): LoginInput | null {
  if (assessorId.trim() === '' || password.trim() === '' || zedId.trim() === '') return null;
  return { assessorId: assessorId.trim().toUpperCase(), password: password.trim(), zedId: zedId.trim().toUpperCase() };
}

export type LoginOutcome =
  | { kind: 'proceed'; userType: number | null; allottedParamsAvailable: boolean; toast?: string }
  | { kind: 'update' }
  | { kind: 'alert'; message: string }
  | { kind: 'toast'; message: string };

/** SiteTourStatusHelper.useLocalStatus: the ids are empty strings, so only an empty ZED ID matches (dead in practice). */
const useLocalStatus = (zedId: string | null | undefined) => zedId === '';

/**
 * LoginActivity.processLogin + handleResponse + getLoginRespose. Online: the answer of SA/Login is stored the first
 * time (or when the stored one has no allotted parameters), later sign-ins keep the local work and take the server's
 * flags. Offline: the stored credential and the stored assessment.
 */
export async function login(app: SaApp, input: LoginInput, online: boolean): Promise<LoginOutcome> {
  if (!online) {
    if (!app.compareCredentials(input.assessorId, input.password, input.zedId)) return { kind: 'toast', message: NETWORK_UNAVAILABLE };
    return proceedWith(app, null, input);
  }
  let resp: AssessmentDetails | null = null;
  try {
    resp = await app.api.login({ assessorId: input.assessorId, password: input.password, zedId: input.zedId });
  } catch (e) {
    // RestHelper threw; the legacy then showed "Invalid Username or Password". New: no answer -> offline sign-in.
    if (isNetworkError(e) && app.compareCredentials(input.assessorId, input.password, input.zedId)) return proceedWith(app, null, input);
    resp = null;
  }
  const status = resp ? String(resp.status ?? '') : '';
  if (resp && status === '1') {
    const out = await proceedWith(app, resp, input);
    return out.kind === 'proceed' ? { ...out, toast: LOGIN_SUCCESSFUL } : out;
  }
  if (resp && status === '2') return { kind: 'update' };
  return { kind: 'toast', message: resp?.errorMessage ? resp.errorMessage : INVALID_USER };
}

const hasParams = (d: AssessmentDetails | null) => !!d?.allottedParameters?.length;

async function proceedWith(app: SaApp, loginResp: AssessmentDetails | null, input: LoginInput): Promise<LoginOutcome> {
  if (loginResp) {
    normalizeDetails(loginResp);
    const current = await app.loadDetails(input.assessorId, input.zedId);
    if (current == null || !hasParams(current)) {
      // getAssessmentDetailsByUserId reads the same row, so the "already in progress" alert never shows.
      const byUser = await app.store.load(input.assessorId + input.zedId);
      if (byUser == null || !hasParams(byUser)) {
        await app.saveDetails(loginResp, input.assessorId, input.zedId);
      } else {
        return {
          kind: 'alert',
          message: `There is an assessment already in progress for the assessor Id ${input.assessorId}. Please complete that before starting a new one.`,
        };
      }
    }
    const d = app.details!;
    let available = false;
    if (hasParams(d)) {
      available = true;
      app.saveCredentials(input.assessorId, input.password, input.zedId);
    }
    if (loginResp.isOpenMeetingSubmitted) d.isOpenMeetingSubmitted = true;
    if (loginResp.isSelfieSubmitted) d.isSelfieSubmitted = true;
    if (loginResp.isSiteTourSubmitted) d.isSiteTourSubmitted = true;
    if (useLocalStatus(loginResp.companyProfile?.zedId)) {
      const flag = (k: string) => app.prefs.get(PREFS.siteTourStatus, k) === 'true';
      d.isSiteTourSubmitted = flag(loginResp.companyProfile?.zedId ?? '');
      if (!flag('BasicInfo') && d.saBasicInformation) d.saBasicInformation.status = Status.COMPLETED;
      if (!flag('Params')) setAllParametersToCompleted(d);
    }
    if (loginResp.isBasicInfoSubmitted) d.isBasicInfoSubmitted = true;
    if (loginResp.allowFinalSubmit) d.allowFinalSubmit = true;
    await app.update();
    return { kind: 'proceed', userType: Number(loginResp.userType ?? 0), allottedParamsAvailable: available };
  }
  // Offline (compareCredentials passed).
  const d = await app.loadDetails(input.assessorId, input.zedId);
  return { kind: 'proceed', userType: null, allottedParamsAvailable: hasParams(d) };
}
