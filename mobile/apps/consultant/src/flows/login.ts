import { isNetworkError, takeAppToken } from '@zed/shared';
import type { SaApp } from '../app/SaApp';
import { isFourthMilestone, mergeRequirementVideos, normalizeDetails, rememberPlanBase, type AssessmentDetails } from '../models';
import type { AssessmentSummary } from '../portfolio';

export const LOGIN_SUCCESSFUL = 'Login Successful.';
export const INVALID_USER = 'Invalid Username or Password';
export const NETWORK_UNAVAILABLE = 'Network Unavailable';
export const ENTER_ALL_DETAILS = 'Please enter all the details.';
export const PROFILE_MISSING = 'MSME Profile Missing';
export const MILESTONES_MISMATCH = "The milestones doesn't match, please check";
export const UPDATE_APP = 'There is an Updated version of the app available in Play store, Please update from Google Play store.';

export type LoginInput = { assessorId: string; password: string; zedId: string };

/** LoginActivity.initialize: consultant and ZED ID trimmed and upper-cased, the password trimmed. */
export function normalizeLoginInput(assessorId: string, password: string, zedId: string): LoginInput | null {
  if (assessorId.trim() === '' || password.trim() === '' || zedId.trim() === '') return null;
  return { assessorId: assessorId.trim().toUpperCase(), password: password.trim(), zedId: zedId.trim().toUpperCase() };
}

export type LoginOutcome =
  | { kind: 'proceed'; userType: number | null; allottedParamsAvailable: boolean; toast?: string }
  | { kind: 'update' }
  | { kind: 'alert'; message: string }
  | { kind: 'toast'; message: string };

/**
 * LoginActivity.processLogin + handleResponse + getLoginRespose. Online: the answer of SA/Login is stored the first
 * time (or when the stored one has no allotted parameters, except a technology upgradation one), later sign-ins keep
 * the local work and take the server's flags; a milestone other than the stored one stops the sign-in. Offline: the
 * stored credential and the stored consultancy.
 */
export async function login(app: SaApp, input: LoginInput, online: boolean): Promise<LoginOutcome> {
  if (!online) {
    if (!app.compareCredentials(input.assessorId, input.password, input.zedId)) return { kind: 'toast', message: NETWORK_UNAVAILABLE };
    return offlineSignIn(app, input);
  }
  let resp: AssessmentDetails | null = null;
  try {
    resp = await app.api.login({ assessorId: input.assessorId, password: input.password, zedId: input.zedId });
  } catch (e) {
    // The legacy then showed "Invalid Username or Password". New: no answer -> offline sign-in.
    if (isNetworkError(e) && app.compareCredentials(input.assessorId, input.password, input.zedId)) return offlineSignIn(app, input);
    resp = null;
  }
  const status = resp ? String(resp.status ?? '') : '';
  if (resp && status === '1') {
    // New (audit C1): the token is kept apart from the stored assessment and sent with every later call.
    const token = takeAppToken(resp);
    const out = await proceedWith(app, resp, input);
    if (out.kind !== 'proceed') return out;
    await app.session.signedIn(input.assessorId + input.zedId, token);
    return { ...out, toast: LOGIN_SUCCESSFUL };
  }
  if (resp && status === '2') return { kind: 'update' };
  return { kind: 'toast', message: resp?.errorMessage ? resp.errorMessage : INVALID_USER };
}

const hasParams = (d: AssessmentDetails | null) => !!d?.allottedParameters?.length;

/** Offline sign-in; new (audit C1): the token of this user's last online login is sent again. */
async function offlineSignIn(app: SaApp, input: LoginInput): Promise<LoginOutcome> {
  const out = await proceedWith(app, null, input);
  if (out.kind === 'proceed') await app.session.resumed(input.assessorId + input.zedId);
  return out;
}

async function proceedWith(app: SaApp, loginResp: AssessmentDetails | null, input: LoginInput): Promise<LoginOutcome> {
  if (loginResp) {
    normalizeDetails(loginResp);
    const current = await app.loadDetails(input.assessorId, input.zedId);
    // getAssessmentDetailsByUserId reads the same row: a stored consultancy without parameters is replaced, unless it
    // is a technology upgradation one (kept); the "already in progress" alert never shows.
    if (current == null || (!hasParams(current) && !isFourthMilestone(current))) {
      rememberPlanBase(loginResp);
      await app.saveDetails(loginResp, input.assessorId, input.zedId);
    }
    const d = app.details!;
    if (loginResp.milestone !== 0 && loginResp.milestone !== d.milestone) return { kind: 'alert', message: MILESTONES_MISMATCH };
    let available = false;
    if (hasParams(d)) {
      available = true;
      if (input.password) app.saveCredentials(input.assessorId, input.password, input.zedId);
    }
    if (loginResp.isOpenMeetingSubmitted) d.isOpenMeetingSubmitted = true;
    if (loginResp.isSelfieSubmitted) d.isSelfieSubmitted = true;
    if (loginResp.isSiteTourSubmitted) d.isSiteTourSubmitted = true;
    if (loginResp.isBasicInfoSubmitted) d.isBasicInfoSubmitted = true;
    // V4: the unit's site tour sections as the Admin has them now.
    if (loginResp.siteTourSections) d.siteTourSections = loginResp.siteTourSections;
    // 2026-11-08: the Admin's requirement videos as the server has them now (also for a consultancy already on the phone).
    mergeRequirementVideos(d, loginResp);
    await app.update();
    return { kind: 'proceed', userType: Number(loginResp.userType ?? 0), allottedParamsAvailable: available };
  }
  // Offline (compareCredentials passed): the stored consultancy is needed.
  const d = await app.loadDetails(input.assessorId, input.zedId);
  if (!d) return { kind: 'toast', message: PROFILE_MISSING };
  return { kind: 'proceed', userType: null, allottedParamsAvailable: hasParams(d) };
}

// ------------------------------------------------------------------ redesign: one sign-in, several cases

export type SignInOutcome = { kind: 'proceed'; toast?: string } | { kind: 'update' } | { kind: 'toast'; message: string };

/** The sign-in page: consultant ID and password, trimmed (the ID upper-cased) as before. */
export function normalizeSignIn(assessorId: string, password: string): { assessorId: string; password: string } | null {
  if (assessorId.trim() === '' || password.trim() === '') return null;
  return { assessorId: assessorId.trim().toUpperCase(), password: password.trim() };
}

/**
 * SA/SignIn: the same checks as SA/Login on the server, without a ZED ID. Online the token is kept for the consultant
 * and the profile and list for the offline sign-in; offline (or no answer) the credential kept by the last online
 * sign-in.
 */
export async function signIn(app: SaApp, input: { assessorId: string; password: string }, online: boolean): Promise<SignInOutcome> {
  const offline = async (): Promise<SignInOutcome> => {
    if (!app.compareCredentials(input.assessorId, input.password, '')) return { kind: 'toast', message: NETWORK_UNAVAILABLE };
    await app.resumeAssessor(input.assessorId);
    await app.session.resumed(input.assessorId);
    return { kind: 'proceed' };
  };
  if (!online) return offline();
  let resp;
  try {
    resp = await app.api.signIn(input);
  } catch (e) {
    if (isNetworkError(e)) return offline();
    resp = null;
  }
  const status = resp ? String(resp.status ?? '') : '';
  if (resp && status === '1') {
    const token = takeAppToken(resp);
    await app.session.signedIn(input.assessorId, token);
    app.saveCredentials(input.assessorId, input.password, '');
    await app.signedInAs({ ...(resp.profile ?? {}), assessorId: resp.profile?.assessorId || input.assessorId }, resp.assessments ?? []);
    return { kind: 'proceed', toast: LOGIN_SUCCESSFUL };
  }
  if (resp && status === '2') return { kind: 'update' };
  return { kind: 'toast', message: resp?.errorMessage ? resp.errorMessage : INVALID_USER };
}

export type OpenOutcome =
  | { kind: 'open'; userType: number; allottedParamsAvailable: boolean }
  | { kind: 'update' }
  | { kind: 'alert'; message: string }
  | { kind: 'toast'; message: string };

/**
 * Opens one case. Online: SA/Assessment (the Login answer for the unit, same refusals), applied to the stored row as a
 * sign-in did (the local work is kept, the server's flags taken; another milestone than the stored one stops it as
 * before). Offline: the stored row of this consultant and unit.
 */
export async function openAssessment(app: SaApp, a: AssessmentSummary, online: boolean): Promise<OpenOutcome> {
  const assessorId = app.assessor?.assessorId ?? '';
  const input = { assessorId, password: '', zedId: a.zedId };
  const offline = async (): Promise<OpenOutcome> => {
    const d = await app.loadDetails(assessorId, a.zedId);
    if (!d) return { kind: 'toast', message: PROFILE_MISSING };
    return { kind: 'open', userType: d.userType || 1, allottedParamsAvailable: hasParams(d) };
  };
  if (!online) return offline();
  let resp: AssessmentDetails | null = null;
  try {
    resp = await app.api.assessment({ saId: assessorId, zedId: a.zedId, certificationType: a.certificationType });
  } catch (e) {
    if (isNetworkError(e)) return offline();
    resp = null;
  }
  const status = resp ? String(resp.status ?? '') : '';
  if (resp && status === '1') {
    const token = takeAppToken(resp);
    if (token) await app.session.signedIn(assessorId, token);
    const out = await proceedWith(app, resp, input);
    if (out.kind !== 'proceed') return out;
    return { kind: 'open', userType: out.userType ?? 1, allottedParamsAvailable: out.allottedParamsAvailable };
  }
  if (resp && status === '2') return { kind: 'update' };
  return { kind: 'toast', message: resp?.errorMessage ? resp.errorMessage : UNKNOWN_ANSWER };
}

const UNKNOWN_ANSWER = 'Unable to open the case, please try again.';
