import { isNetworkError, isSuccess, type HandlerResult, type SyncJob } from '@zed/shared';
import type { SaApp } from '../app/SaApp';
import { FAILED_TO_SUBMIT, isTrainingValid } from '../models';
import { submitAttendance, submitTraining, syncOpenMeeting, trainingSubmitted } from '../flows/submissions';

/**
 * New: what the consultant saved while offline is sent when the connection returns. The legacy app kept the opening
 * meeting in its database (sent from "Sync Data", still there), kept offline attendance entries without any way to
 * send them, and kept the training details until the consultant opened the screen again online; the queue sends them
 * on its own. The milestone sections and the closing meeting stay on their screens' buttons as before: sending them on
 * their own would end steps the consultant may still be working on.
 */
const refusal = (r: { errorMessage?: string | null } | null): HandlerResult => ({ ok: false, error: r?.errorMessage?.trim() ? r.errorMessage : FAILED_TO_SUBMIT });

export function registerHandlers(app: SaApp) {
  const guard = (job: SyncJob) => app.details != null && job.userId === app.userId;

  app.queue.register('openMeeting', async job => {
    if (!guard(job)) throw new Error('Consultancy not open');
    const r = await syncOpenMeeting(app);
    return isSuccess(r) ? { ok: true } : refusal(r);
  });

  app.queue.register('attendance', async job => {
    if (!guard(job)) throw new Error('Consultancy not open');
    const entry = app.details!.attendanceData?.attendanceList.find(a => a.time === job.payload.time && a.attendanceType === job.payload.type);
    if (!entry || entry.isSubmitted) return { ok: true };
    const r = await submitAttendance(app, entry);
    await app.update();
    return isSuccess(r) ? { ok: true } : refusal(r);
  });

  app.queue.register('training', async job => {
    if (!guard(job)) throw new Error('Consultancy not open');
    const handholding = job.payload.handholding === true;
    const d = app.details!;
    const info = handholding ? d.handholdingTraining : d.zedTrainingInfo;
    if (!info || info.status === 'SUBMITTED' || !isTrainingValid(info)) return { ok: true };
    const { response, error } = await submitTraining(app, info, handholding);
    if (error === 'Network not available') throw Object.assign(new Error(error), { name: 'NetworkError' });
    if (!response) return { ok: false, error: error ?? FAILED_TO_SUBMIT };
    if (!isSuccess(response)) return refusal(response);
    await trainingSubmitted(app, info);
    return { ok: true };
  });
}

/** Sends what is pending for the open consultancy (on reconnect, foreground, timer). */
export async function syncNow(app: SaApp) {
  if (!app.details) return null;
  try {
    return await app.queue.run({ userId: app.userId });
  } catch (e) {
    if (isNetworkError(e)) return null;
    throw e;
  }
}
