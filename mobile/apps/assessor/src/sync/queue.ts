import { isNetworkError, isSuccess, type HandlerResult, type SyncJob } from '@zed/shared';
import type { SaApp } from '../app/SaApp';
import { FAILED_TO_SUBMIT } from '../models';
import { selfieSyncAllowed, submitAttendance, syncOpenMeeting, syncSelfie } from '../flows/submissions';
import { SCHEME_JOBS } from '../schemes/schemeVisits';

/**
 * New: what the user submitted while offline is sent when the connection returns. The legacy app kept these in its
 * database and the user sent them from "Sync Assessment" (still there); the queue sends them on its own.
 * Parameters, site tour photos and the closing meeting stay on "Sync Assessment" as before: sending them would end
 * steps the assessor may still be working on.
 */
const refusal = (r: { errorMessage?: string | null } | null): HandlerResult => ({ ok: false, error: r?.errorMessage?.trim() ? r.errorMessage : FAILED_TO_SUBMIT });

export function registerHandlers(app: SaApp) {
  const guard = (job: SyncJob) => app.details != null && job.userId === app.userId;

  app.queue.register('openMeeting', async job => {
    if (!guard(job)) throw new Error('Assessment not open');
    const r = await syncOpenMeeting(app);
    return isSuccess(r) ? { ok: true } : refusal(r);
  });

  app.queue.register('selfie', async job => {
    if (!guard(job)) throw new Error('Assessment not open');
    if (!(await selfieSyncAllowed(app))) return { ok: false, error: 'Please sync Opening Meeting data to sync Selfie' };
    const r = await syncSelfie(app);
    return isSuccess(r) ? { ok: true } : refusal(r);
  });

  app.queue.register('attendance', async job => {
    if (!guard(job)) throw new Error('Assessment not open');
    const entry = app.details!.attendanceData?.attendanceList.find(a => a.time === job.payload.time && a.attendanceType === job.payload.type);
    if (!entry || entry.isSubmitted) return { ok: true };
    const r = await submitAttendance(app, entry);
    await app.update();
    return isSuccess(r) ? { ok: true } : refusal(r);
  });

  // 2026-11-20 (incentive schemes, phase 2): a scheme visit's start, photos, removed photos and checks, sent in that order per
  // visit, whatever assessment is open (they belong to the signed-in assessor, not to a unit's assessment).
  app.queue.register(SCHEME_JOBS.start, job => app.schemes.sendStart(job));
  app.queue.register(SCHEME_JOBS.photo, job => app.schemes.sendPhoto(job));
  app.queue.register(SCHEME_JOBS.remove, job => app.schemes.sendRemove(job));
  app.queue.register(SCHEME_JOBS.save, job => app.schemes.sendSave(job));
}

/** Sends what is pending for the open assessment, then the signed-in assessor's scheme visits (on reconnect, foreground, timer). */
export async function syncNow(app: SaApp) {
  let summary = null;
  if (app.details) {
    try {
      summary = await app.queue.run({ userId: app.userId });
    } catch (e) {
      if (!isNetworkError(e)) throw e;
    }
  }
  if (app.assessor) await syncSchemeVisits(app);
  return summary;
}

/** The scheme visits' sends of the signed-in assessor; never throws (the queue retries later). */
export async function syncSchemeVisits(app: SaApp, force = false) {
  try {
    await app.schemes.sync(force);
  } catch {
    // retried on the next trigger
  }
}
