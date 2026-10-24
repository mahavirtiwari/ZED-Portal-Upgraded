/**
 * Offline sends of this app through the shared {@link SyncQueue}: what the legacy app left as "COMPLETED but not
 * SUBMITTED" in its local data is queued and sent when the connection returns, in order, per unit and level.
 */
import { isNetworkAvailable, isSuccess, type BaseServiceResponse, type HandlerResult, type SyncJob } from '@zed/shared';
import type { MsmeApp } from '../app/MsmeApp';
import { Status, type CertificationType } from '../models';
import {
  activeNc,
  certification,
  findEvidence,
  submitBasicInformation,
  submitNcProduct,
  submitNcRequirement,
  submitNcSitePhotos,
  submitSurveillance,
  syncEvidence,
} from './submissions';

export type QueueKind = 'basicInfo' | 'evidence' | 'ncSitePhotos' | 'ncProduct' | 'ncRequirement' | 'surveillance';

const result = (r: BaseServiceResponse | null): HandlerResult =>
  isSuccess(r) ? { ok: true } : { ok: false, error: r?.errorMessage ?? 'Unknown Error Occurred' };

type Payload = { cert: CertificationType; surveillance?: boolean; evidenceId?: string; index?: number; requirementId?: string };

export function registerHandlers(app: MsmeApp): void {
  const q = app.queue;
  const guard = (job: SyncJob) => job.userId === app.loginId;
  const wrap = (fn: (p: Payload) => Promise<BaseServiceResponse | null>) => async (job: SyncJob): Promise<HandlerResult> => {
    if (!guard(job)) return { ok: false, error: 'Sign in as ' + job.userId + ' to send this' };
    return result(await fn(job.payload as Payload));
  };

  // The basic information alone, as the Proceed of the basic information screen (status stays as it was: the ESG
  // checklist, which needs the network, marks it SUBMITTED; evidences resend it otherwise, as before).
  q.register(
    'basicInfo',
    wrap(async p => {
      const info = certification(app, p.cert)?.basicInformation;
      if (!info) return { status: '1' };
      if (info.status === Status.SUBMITTED) return { status: '1' };
      return submitBasicInformation(app, p.cert, info);
    }),
  );
  q.register('evidence', wrap(p => syncEvidence(app, p.cert, p.evidenceId!)));
  q.register(
    'ncSitePhotos',
    wrap(async p => {
      const nc = activeNc(app, p.cert, !!p.surveillance);
      if (!nc || nc.sitePhotosSubmitted) return { status: '1' };
      return submitNcSitePhotos(app, p.cert, !!p.surveillance);
    }),
  );
  q.register(
    'ncProduct',
    wrap(async p => {
      const product = activeNc(app, p.cert, !!p.surveillance)?.products?.[p.index ?? -1];
      if (!product || product.status === Status.SUBMITTED) return { status: '1' };
      return submitNcProduct(app, p.cert, !!p.surveillance, product);
    }),
  );
  q.register(
    'ncRequirement',
    wrap(async p => {
      const nc = activeNc(app, p.cert, !!p.surveillance);
      const req = nc?.parameters?.flatMap(e => e.requirements ?? []).find(r => r.id === p.requirementId);
      if (!req || req.status === Status.SUBMITTED) return { status: '1' };
      return submitNcRequirement(app, p.cert, !!p.surveillance, req);
    }),
  );
  q.register('surveillance', wrap(p => submitSurveillance(app, p.cert)));
}

function enqueue(app: MsmeApp, kind: QueueKind, id: string, label: string, payload: Payload) {
  const user = app.loginId!;
  return app.queue.enqueue({
    kind,
    key: `${user}:${kind}:${payload.cert}:${payload.surveillance ? 'S:' : ''}${id}`,
    group: `${user}:${payload.cert}:${payload.surveillance ? 'S' : 'M'}`,
    userId: user,
    label,
    payload,
  });
}

export const queueBasicInfo = (app: MsmeApp, cert: CertificationType) =>
  enqueue(app, 'basicInfo', 'basic', `Basic Information (${cert})`, { cert });

export const queueEvidence = (app: MsmeApp, cert: CertificationType, evidenceId: string, label: string) =>
  enqueue(app, 'evidence', evidenceId, `Evidence: ${label}`, { cert, evidenceId });

export const queueNcSitePhotos = (app: MsmeApp, cert: CertificationType, surveillance: boolean) =>
  enqueue(app, 'ncSitePhotos', 'site', 'Non-conformance: Site Exterior Photos', { cert, surveillance });

export const queueNcProduct = (app: MsmeApp, cert: CertificationType, surveillance: boolean, index: number, name: string) =>
  enqueue(app, 'ncProduct', `p${index}`, `Non-conformance product: ${name}`, { cert, surveillance, index });

export const queueNcRequirement = (app: MsmeApp, cert: CertificationType, surveillance: boolean, requirementId: string, label: string) =>
  enqueue(app, 'ncRequirement', requirementId, `Non-conformance: ${label}`, { cert, surveillance, requirementId });

export const queueSurveillance = (app: MsmeApp, cert: CertificationType) =>
  enqueue(app, 'surveillance', 'photos', 'Surveillance Assessment photos', { cert });

/**
 * After sign-in: queue whatever the local data shows as done but not sent (also data the legacy app left behind),
 * so that nothing pending waits for the user to find the right screen.
 */
export async function queueOutstanding(app: MsmeApp): Promise<number> {
  let n = 0;
  for (const cert of ['Bronze', 'Silver', 'Gold'] as CertificationType[]) {
    for (const surveillance of [false, true]) {
      const details = certification(app, cert, surveillance);
      if (!details) continue;
      if (!surveillance) {
        for (const e of details.parameters ?? [])
          for (const r of e.requirements ?? [])
            for (const ev of r.evidences ?? [])
              if (ev.status === Status.COMPLETED) {
                await queueEvidence(app, cert, ev.id, ev.label ?? ev.id);
                n++;
              }
      }
      const nc = details.activeNcDetails;
      if (nc) {
        for (const [i, p] of (nc.products ?? []).entries())
          if (p.status === Status.COMPLETED) {
            await queueNcProduct(app, cert, surveillance, i, p.productName ?? '');
            n++;
          }
        for (const e of nc.parameters ?? [])
          for (const r of e.requirements ?? [])
            if (r.status === Status.COMPLETED) {
              await queueNcRequirement(app, cert, surveillance, r.id, `${e.code}. ${e.label ?? ''}`);
              n++;
            }
      }
    }
  }
  return n;
}

/** Sends the signed-in user's queue when there is a network (also called on reconnect and on demand). */
export async function syncNow(app: MsmeApp, force = false) {
  if (!app.loginId) return null;
  if (!(await isNetworkAvailable())) return null;
  return app.queue.run({ userId: app.loginId, force });
}

export { findEvidence };
