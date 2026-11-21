/**
 * 2026-11-21: Bronze surveillance in ZED SA (the ZED Surveillance app is retired). The assessor's Bronze surveillance cases
 * come from the surveillance host (SA/SignIn's `bronzeSurveillance`, SA/BronzeSurveillance); opening one exchanges ZED SA's
 * surveillance sign-in for the unit's session (SA/BronzeSurveillanceSession: the answer of Surveillance/Login with its "SURV"
 * token), and the steps are the old app's own screens (@zed/bronze-surveillance), which send to the surveillance host with
 * that token. Offline, a case opened before on this phone by the same assessor opens from what the phone kept.
 */
import { isNetworkError, type BaseServiceResponse } from '@zed/shared';
import { queueOutstanding, syncNow, updateCertificationDetails, type LoginResponse } from '@zed/bronze-surveillance';
import type { SaApp } from '../app/SaApp';

export type BronzeCase = {
  zedId: string;
  certificationType?: string | null;
  enterpriseName?: string | null;
  unitName?: string | null;
  address?: string | null;
  district?: string | null;
  state?: string | null;
  pincode?: string | null;
  /** MsmeCertifications.CertificationStatus (1: with the desktop assessor). */
  status?: number | null;
  /** ISO text, server time. */
  statusDate?: string | null;
};

export type BronzeCasesResponse = BaseServiceResponse & { cases?: BronzeCase[] | null };

export const bronzeName = (c: BronzeCase) => c.enterpriseName || c.unitName || c.zedId;

export const bronzePlace = (c: BronzeCase) => [c.address, c.district, c.state, c.pincode].filter(x => !!x && String(x).trim()).join(', ');

export type BronzeOpenOutcome = { kind: 'open' } | { kind: 'toast'; key: 'offline' | 'notSignedIn' } | { kind: 'toast'; message: string };

/**
 * Opens one case for the signed-in assessor. Online: SA/BronzeSurveillanceSession on the surveillance host (with ZED SA's
 * surveillance token), then the unit is opened in the Bronze module as the old app's login did (the first answer stored,
 * later the local work kept and the server's statuses taken) and anything left unsent is queued and sent. No answer from
 * the server, or no network: the unit kept on the phone, when this assessor opened it before.
 */
export async function openBronzeCase(app: SaApp, c: BronzeCase, online: boolean): Promise<BronzeOpenOutcome> {
  const assessorId = app.assessor?.assessorId ?? '';
  const offline = async (): Promise<BronzeOpenOutcome> => {
    if (!assessorId || (await app.bronzeOwner(c.zedId)) !== assessorId || !(await app.bronze.resumeKept(c.zedId))) return { kind: 'toast', key: 'offline' };
    return { kind: 'open' };
  };
  if (!online) return offline();
  if (!app.surveillanceSession.appToken) return (await offline()).kind === 'open' ? { kind: 'open' } : { kind: 'toast', key: 'notSignedIn' };
  let resp: LoginResponse | null = null;
  try {
    resp = await app.surveillanceApi.bronzeSurveillanceSession({ saId: assessorId, zedId: c.zedId });
  } catch (e) {
    if (isNetworkError(e)) return offline();
    resp = null;
  }
  if (!resp || String(resp.status ?? '') !== '1') return { kind: 'toast', message: resp?.errorMessage || UNKNOWN_ANSWER };
  await app.bronze.openedWithSession(c.zedId, resp, (local, server) => {
    const serverStatus = server.MsmeDetails?.msmeStatus;
    const localStatus = local.MsmeDetails?.msmeStatus;
    if (serverStatus && localStatus) updateCertificationDetails(localStatus, serverStatus);
  });
  await app.setBronzeOwner(c.zedId, assessorId);
  // As after the old app's login: anything left unsent is queued and sent when possible.
  queueOutstanding(app.bronze)
    .then(() => syncNow(app.bronze))
    .catch(() => undefined);
  return { kind: 'open' };
}

const UNKNOWN_ANSWER = 'Unable to open the assessment, please try again.';
