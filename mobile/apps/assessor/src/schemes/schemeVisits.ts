/**
 * 2026-11-20 (incentive schemes, phase 2): the onsite assessor's scheme visits on the phone. The server's list and details are
 * kept for offline use (ZedCache); the work of a visit is kept as a draft (ZedCache) with its photos in the photo table
 * (photos_table, owner "SCHEME:{applicationId}:{assessor}") and sent by the sync queue, one job per thing to send, as the
 * assessment's offline sends: the start of the visit, each item photo, each removed photo, and one save of the checks,
 * representative and remarks. The jobs of a visit share a group (the start goes first; the rest wait for it). The result
 * (Recommend / Reject) needs a connection and everything synced first; afterwards the visit is removed from the phone.
 */
import {
  isSuccess,
  PHOTO_SUBMITTED,
  PHOTO_TO_SUBMIT,
  type AppTexts,
  type HandlerResult,
  type KeyValueStore,
  type PhotoData,
  type PhotoStore,
  type SyncJob,
  type SyncQueue,
} from '@zed/shared';
import type { SaApi } from '../api';
import type { ClearSection } from '../clearData';
import { schemeText } from './texts';
import {
  itemSlot,
  newDraft,
  SELFIE_SLOT,
  SITE_SLOT,
  summaryOf,
  type DraftCheck,
  type DraftPhoto,
  type SchemeCheckInput,
  type SchemeDraft,
  type SchemeVisitDetail,
  type SchemeVisitSummary,
  type ShownPhoto,
} from './visits';

const LIST_KEY = 'sa.scheme.list.';
const DETAIL_KEY = 'sa.scheme.detail.';
const DRAFT_KEY = 'sa.scheme.draft.';
const INDEX_KEY = 'sa.scheme.drafts.';

/** The sync queue's kinds of the scheme visits (registered in sync/queue.ts). */
export const SCHEME_JOBS = { start: 'schemeStart', photo: 'schemePhoto', remove: 'schemeRemove', save: 'schemeSave' } as const;

/** The queue's user of an assessor's scheme visits (run apart from the open assessment's jobs). */
export const schemeUser = (saId: string) => 'SCHEME:' + saId;
export const schemeGroup = (saId: string, id: number) => `SCHEME:${saId}:${id}`;
export const schemeJobKey = (saId: string, id: number, kind: string, sub = '') => `${schemeGroup(saId, id)}:${kind}${sub ? ':' + sub : ''}`;
/** The photo table's owner (associatedId) of a visit's photos. */
export const photoOwner = (saId: string, id: number) => `SCHEME:${id}:${saId}`;

/** Clear data sections of a visit. */
export const CLEAR_START = 'scheme-start';
export const CLEAR_CHECKS = 'scheme-checks';
const CLEAR_PHOTOS = 'scheme-photos:';
export const clearPhotosSection = (slot: string) => CLEAR_PHOTOS + slot;

export type SchemeShot = { base64: string; timeStamp: string; coords: { latitude: number | string; longitude: number | string } | null };

export type SchemeDeps = {
  cache: KeyValueStore;
  photos: PhotoStore;
  queue: SyncQueue;
  texts: AppTexts;
  /** The main host's API (scheme visits are Main only). */
  api: () => SaApi;
  saId: () => string;
  touch: () => void;
  newId: () => string;
  now?: () => Date;
};

export type DetailResult = { detail: SchemeVisitDetail | null; error?: string | null; fromServer: boolean };

const geo = (v: number | string | null | undefined) => (v == null || v === '' ? null : String(v));
const refusal = (r: { errorMessage?: string | null } | null | undefined, fallback: string): HandlerResult => ({ ok: false, error: r?.errorMessage?.trim() || fallback });
const FAILED = 'Failed to submit data, Please try again';

/** "2026-11-20T11:05:00" (local time), as the server writes its dates. */
export function isoLocal(d: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

export class SchemeVisits {
  private _list: SchemeVisitSummary[] = [];
  private _drafts: SchemeDraft[] = [];
  private loadedFor: string | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: SchemeDeps) {}

  private get saId(): string {
    return this.deps.saId();
  }

  private t(key: string, fields?: Record<string, string | number>) {
    return schemeText(this.deps.texts, key, fields);
  }

  /** The applications allotted to the assessor (the last answer, kept for offline use). */
  get list(): SchemeVisitSummary[] {
    return this._list;
  }

  /** The visits the phone holds work for. */
  get drafts(): SchemeDraft[] {
    return this._drafts;
  }

  /** Drafts of applications the server no longer lists (submitted, or allotted elsewhere): kept until cleared. */
  get kept(): SchemeDraft[] {
    const listed = new Set(this._list.map(v => v.applicationId));
    return this._drafts.filter(d => !listed.has(d.applicationId));
  }

  draftOf(id: number): SchemeDraft | null {
    return this._drafts.find(d => d.applicationId === id) ?? null;
  }

  /** The kept list and drafts of an assessor (sign-in, offline sign-in). */
  async load(saId: string): Promise<void> {
    this.loadedFor = saId;
    this._list = (await this.deps.cache.get<SchemeVisitSummary[]>(LIST_KEY + saId)) ?? [];
    const ids = (await this.deps.cache.get<number[]>(INDEX_KEY + saId)) ?? [];
    const drafts: SchemeDraft[] = [];
    for (const id of ids) {
      const d = await this.deps.cache.get<SchemeDraft>(this.draftKey(saId, id));
      if (d) drafts.push(d);
    }
    this._drafts = drafts;
    this.deps.touch();
  }

  reset(): void {
    this._list = [];
    this._drafts = [];
    this.loadedFor = null;
  }

  private async ensureLoaded() {
    if (this.saId && this.loadedFor !== this.saId) await this.load(this.saId);
  }

  /** SchemeVisits/List; a failure (or a refusal) keeps the last list. Network errors are thrown. */
  async refreshList(): Promise<boolean> {
    const saId = this.saId;
    if (!saId) return false;
    await this.ensureLoaded();
    const r = await this.deps.api().schemeVisits(saId);
    if (!(isSuccess(r) && Array.isArray(r.visits))) return false;
    this._list = r.visits;
    await this.deps.cache.set(LIST_KEY + saId, this._list);
    this.deps.touch();
    return true;
  }

  /** One application: the server's answer when online (kept), else the kept one. */
  async detail(id: number, online: boolean): Promise<DetailResult> {
    const saId = this.saId;
    await this.ensureLoaded();
    const key = `${DETAIL_KEY}${saId}.${id}`;
    if (online) {
      const r = await this.deps.api().schemeVisit(saId, id);
      if (isSuccess(r) && r.visit) {
        await this.deps.cache.set(key, r.visit);
        await this.pruneRemoved(r.visit);
        return { detail: r.visit, fromServer: true };
      }
      return { detail: await this.deps.cache.get<SchemeVisitDetail>(key), error: r?.errorMessage || FAILED, fromServer: false };
    }
    return { detail: await this.deps.cache.get<SchemeVisitDetail>(key), fromServer: false };
  }

  /** The kept detail only (no call). */
  keptDetail(id: number): Promise<SchemeVisitDetail | null> {
    return this.deps.cache.get<SchemeVisitDetail>(`${DETAIL_KEY}${this.saId}.${id}`);
  }

  // ------------------------------------------------------------------ the draft

  private draftKey(saId: string, id: number) {
    return `${DRAFT_KEY}${saId}.${id}`;
  }

  /** Changes a visit's draft (created from `summary` when missing); changes are serialised, the list of drafts kept in step. */
  private mutate(id: number, change: (d: SchemeDraft) => void, summary?: SchemeVisitSummary): Promise<SchemeDraft | null> {
    const saId = this.saId;
    const run = this.chain.then(async () => {
      const key = this.draftKey(saId, id);
      let d = await this.deps.cache.get<SchemeDraft>(key);
      if (!d) {
        if (!summary) return null;
        d = newDraft(saId, summary);
        const ids = (await this.deps.cache.get<number[]>(INDEX_KEY + saId)) ?? [];
        if (!ids.includes(id)) await this.deps.cache.set(INDEX_KEY + saId, [...ids, id]);
      }
      change(d);
      await this.deps.cache.set(key, d);
      if (saId === this.saId) {
        const i = this._drafts.findIndex(x => x.applicationId === id);
        if (i >= 0) this._drafts[i] = d;
        else this._drafts.push(d);
      }
      return d;
    });
    this.chain = run.catch(() => undefined);
    return run.then(d => {
      this.deps.touch();
      return d;
    });
  }

  private async storePhoto(id: number, slot: string, shot: SchemeShot): Promise<DraftPhoto> {
    const photoId = this.deps.newId();
    const ref: DraftPhoto = {
      photoId,
      slot,
      timeStamp: shot.timeStamp,
      latitude: geo(shot.coords?.latitude),
      longitude: geo(shot.coords?.longitude),
      uploaded: false,
    };
    const row: PhotoData = {
      photoId,
      photo: shot.base64,
      name: slot,
      photoPath: null,
      timeStamp: ref.timeStamp,
      latitude: ref.latitude,
      longitude: ref.longitude,
      associatedId: photoOwner(this.saId, id),
      status: PHOTO_TO_SUBMIT,
      isPdf: false,
    };
    await this.deps.photos.insert(row);
    return ref;
  }

  private enqueue(id: number, kind: string, sub: string, label: string, payload: Record<string, unknown> = {}) {
    const saId = this.saId;
    return this.deps.queue.enqueue({
      kind,
      key: schemeJobKey(saId, id, kind, sub),
      group: schemeGroup(saId, id),
      userId: schemeUser(saId),
      label,
      payload: { saId, applicationId: id, ...payload },
    });
  }

  /** The start of the visit (selfie and site photo with GPS and time), sent by the queue. */
  async startVisit(detail: SchemeVisitDetail, selfie: SchemeShot, site: SchemeShot): Promise<void> {
    const id = detail.applicationId;
    const s = await this.storePhoto(id, SELFIE_SLOT, selfie);
    const p = await this.storePhoto(id, SITE_SLOT, site);
    await this.mutate(
      id,
      d => {
        d.selfie = s;
        d.site = p;
        d.startSent = false;
        d.startedAt = isoLocal(this.deps.now?.() ?? new Date());
        d.summary = summaryOf(detail);
      },
      summaryOf(detail),
    );
    await this.enqueue(id, SCHEME_JOBS.start, '', this.t('start.heading') || 'Start the visit');
  }

  /** A geo-tagged photo of an item, sent by the queue. */
  async addPhoto(detail: SchemeVisitDetail, section: string, index: number, shot: SchemeShot): Promise<DraftPhoto> {
    const id = detail.applicationId;
    const ref = await this.storePhoto(id, itemSlot(section, index), shot);
    await this.mutate(id, d => void d.photos.push(ref), summaryOf(detail));
    await this.enqueue(id, SCHEME_JOBS.photo, ref.photoId, this.t('photos.heading') || 'Photos', { photoId: ref.photoId });
    return ref;
  }

  /** Removes an item photo: one not sent yet is simply dropped; one on the server is removed there by the queue. */
  async removePhoto(detail: SchemeVisitDetail, slot: string, photo: ShownPhoto): Promise<void> {
    const id = detail.applicationId;
    const saId = this.saId;
    if (photo.local && photo.photoId) {
      const ref = this.draftOf(id)?.photos.find(p => p.photoId === photo.photoId);
      await this.deps.photos.delete(photo.photoId);
      await this.deps.queue.remove(schemeJobKey(saId, id, SCHEME_JOBS.photo, photo.photoId));
      await this.mutate(id, d => {
        d.photos = d.photos.filter(p => p.photoId !== photo.photoId);
        if (ref?.uploaded) d.removed.push({ photoId: photo.photoId!, slot, name: ref.name });
      });
      if (ref?.uploaded) await this.enqueue(id, SCHEME_JOBS.remove, photo.photoId, this.t('photos.remove') || 'Remove', { photoId: photo.photoId });
      return;
    }
    if (!photo.name) return;
    await this.mutate(id, d => void d.removed.push({ photoId: photo.name!, slot, name: photo.name }), summaryOf(detail));
    await this.enqueue(id, SCHEME_JOBS.remove, photo.name, this.t('photos.remove') || 'Remove', { photoId: photo.name });
  }

  private changed(detail: SchemeVisitDetail, change: (d: SchemeDraft) => void) {
    const id = detail.applicationId;
    return this.mutate(
      id,
      d => {
        change(d);
        d.saveDirty = true;
        d.saveRev = (d.saveRev ?? 0) + 1;
      },
      summaryOf(detail),
    ).then(() => this.enqueue(id, SCHEME_JOBS.save, '', this.t('clear.checks') || 'Checks'));
  }

  /** An answer's check: Valid, Not valid with a remark, or '' (removed). */
  setCheck(detail: SchemeVisitDetail, path: string, status: DraftCheck['status'], remarks?: string | null) {
    return this.changed(detail, d => {
      d.checks[path] = { status, remarks: status === 'No' ? (remarks ?? '') : null };
    });
  }

  setRepresentative(detail: SchemeVisitDetail, name: string, mobile: string) {
    return this.changed(detail, d => {
      d.representativeName = name;
      d.representativeMobile = mobile;
    });
  }

  setRemarks(detail: SchemeVisitDetail, remarks: string) {
    return this.changed(detail, d => {
      d.remarks = remarks;
    });
  }

  /** The sends of a visit still waiting (pending or refused), in queue order. */
  async pending(id: number): Promise<SyncJob[]> {
    const saId = this.saId;
    return (await this.deps.queue.list(schemeUser(saId))).filter(j => j.group === schemeGroup(saId, id));
  }

  /** Sends what waits (after a run already going); network errors end the run quietly. */
  async sync(force = false): Promise<void> {
    const saId = this.saId;
    if (!saId) return;
    if (this.deps.queue.isRunning) await this.deps.queue.run().catch(() => undefined);
    await this.deps.queue.run({ userId: schemeUser(saId), force });
  }

  // ------------------------------------------------------------------ the queue's sends

  private async job(job: SyncJob): Promise<{ saId: string; id: number; draft: SchemeDraft | null } | null> {
    const saId = String(job.payload.saId ?? '');
    const id = Number(job.payload.applicationId);
    if (!saId || saId !== this.saId || !id) return null;
    await this.chain;
    return { saId, id, draft: await this.deps.cache.get<SchemeDraft>(this.draftKey(saId, id)) };
  }

  private async input(ref: DraftPhoto | null | undefined) {
    if (!ref) return null;
    const row = await this.deps.photos.get(ref.photoId);
    if (!row?.photo) return null;
    return { photoId: ref.photoId, photo: row.photo, timeStamp: ref.timeStamp, latitude: ref.latitude, longitude: ref.longitude };
  }

  async sendStart(job: SyncJob): Promise<HandlerResult> {
    const j = await this.job(job);
    if (!j) return { ok: false, error: 'Please sign in again.' };
    if (!j.draft || j.draft.startSent) return { ok: true };
    const selfie = await this.input(j.draft.selfie);
    const site = await this.input(j.draft.site);
    if (!selfie || !site) return { ok: false, error: this.t('start.needBoth') || 'Please take the selfie and the site photo.' };
    const r = await this.deps.api().schemeStart({ saId: j.saId, applicationId: j.id, selfie, site });
    if (!isSuccess(r)) return refusal(r, FAILED);
    await this.mutate(j.id, d => {
      d.startSent = true;
      if (r.visitStartedOn) d.startedAt = r.visitStartedOn;
    });
    for (const p of [selfie, site]) await this.deps.photos.updateStatus(PHOTO_SUBMITTED, p.photoId);
    return { ok: true };
  }

  async sendPhoto(job: SyncJob): Promise<HandlerResult> {
    const j = await this.job(job);
    if (!j) return { ok: false, error: 'Please sign in again.' };
    const ref = j.draft?.photos.find(p => p.photoId === job.payload.photoId);
    if (!ref || ref.uploaded) return { ok: true };
    const photo = await this.input(ref);
    if (!photo) return { ok: false, error: 'The photo is no longer on the phone. Please take it again.' };
    const m = /^onsite\/(.+)\/(\d+)$/.exec(ref.slot);
    if (!m) return { ok: true };
    const r = await this.deps.api().schemeSavePhoto({ saId: j.saId, applicationId: j.id, section: m[1]!, index: Number(m[2]), photo });
    if (!isSuccess(r)) return refusal(r, FAILED);
    await this.mutate(j.id, d => {
      const p = d.photos.find(x => x.photoId === ref.photoId);
      if (p) {
        p.uploaded = true;
        p.name = r.name ?? null;
      }
    });
    await this.deps.photos.updateStatus(PHOTO_SUBMITTED, ref.photoId);
    return { ok: true };
  }

  async sendRemove(job: SyncJob): Promise<HandlerResult> {
    const j = await this.job(job);
    if (!j) return { ok: false, error: 'Please sign in again.' };
    const photoId = String(job.payload.photoId ?? '');
    const r = await this.deps.api().schemeDeletePhoto({ saId: j.saId, applicationId: j.id, photoId });
    if (!isSuccess(r)) return refusal(r, FAILED);
    await this.mutate(j.id, d => {
      for (const x of d.removed) if (x.photoId === photoId) x.sent = true;
    });
    return { ok: true };
  }

  /**
   * The checks, representative and remarks of the draft. What the server would refuse is kept on the phone and not sent (a Not
   * valid check without its remark, a mobile number that is not valid yet), so one unfinished answer never stops the others.
   */
  async sendSave(job: SyncJob): Promise<HandlerResult> {
    const j = await this.job(job);
    if (!j) return { ok: false, error: 'Please sign in again.' };
    const d = j.draft;
    if (!d || !d.saveDirty) return { ok: true };
    const rev = d.saveRev;
    let held = false;
    const checks: SchemeCheckInput[] = [];
    for (const [path, c] of Object.entries(d.checks)) {
      if (c.status === 'No' && !(c.remarks ?? '').trim()) {
        held = true;
        continue;
      }
      checks.push({ path, status: c.status, remarks: c.remarks ?? null });
    }
    const mobile = d.representativeMobile;
    const mobileOk = mobile == null || mobile.trim() === '' || /^[6-9][0-9]{9}$/.test(mobile.trim());
    if (!mobileOk) held = true;
    const r = await this.deps.api().schemeSave({
      saId: j.saId,
      applicationId: j.id,
      representativeName: d.representativeName ?? undefined,
      representativeMobile: mobileOk ? (mobile ?? undefined) : undefined,
      remarks: d.remarks ?? undefined,
      checks,
    });
    if (!isSuccess(r)) return refusal(r, FAILED);
    let again = false;
    await this.mutate(j.id, x => {
      if (x.saveRev === rev) x.saveDirty = held;
      else again = true;
    });
    if (again) await this.enqueue(j.id, SCHEME_JOBS.save, '', this.t('clear.checks') || 'Checks');
    return { ok: true };
  }

  // ------------------------------------------------------------------ the result

  /**
   * Recommend or reject: everything of the visit synced first (a run is made), then SchemeVisits/Submit. On success the visit is
   * removed from the phone (the server has all of it). Network errors are thrown (the caller says the result needs a connection).
   */
  async submit(
    detail: SchemeVisitDetail,
    input: { decision: 'recommend' | 'reject'; verifiedClaim?: number | null; reason?: string | null; remarks?: string | null },
  ): Promise<{ ok: boolean; message: string }> {
    const id = detail.applicationId;
    await this.sync(true);
    const waiting = await this.pending(id);
    if (waiting.length) {
      const error = waiting.find(w => w.lastError)?.lastError ?? '';
      return { ok: false, message: this.t('submit.unsynced', { Error: error }) || error };
    }
    const r = await this.deps.api().schemeSubmit({ saId: this.saId, applicationId: id, ...input });
    if (!isSuccess(r)) return { ok: false, message: r?.errorMessage || FAILED };
    await this.clearAll(id);
    this._list = this._list.filter(v => v.applicationId !== id);
    await this.deps.cache.set(LIST_KEY + this.saId, this._list);
    this.deps.touch();
    return { ok: true, message: r.errorMessage || this.t('submit.done') };
  }

  /** Forgets the server's removed photos once a fresh detail no longer lists them. */
  private async pruneRemoved(fresh: SchemeVisitDetail) {
    const d = this.draftOf(fresh.applicationId);
    if (!d?.removed.length) return;
    const names = new Set(fresh.items.flatMap(i => i.photos.map(p => p.name)));
    const keep = (r: SchemeDraft['removed'][number]) => !r.sent || names.has(r.name ?? '');
    if (d.removed.every(keep)) return;
    await this.mutate(fresh.applicationId, x => {
      x.removed = x.removed.filter(keep);
    });
  }

  // ------------------------------------------------------------------ Clear data

  /** The sections of a visit the phone holds (the Clear data sheet), with sizes and the "Unsynced" mark. */
  async dataSections(id: number): Promise<ClearSection[]> {
    const d = this.draftOf(id) ?? (await this.deps.cache.get<SchemeDraft>(this.draftKey(this.saId, id)));
    if (!d) return [];
    const stored = new Map((await this.deps.photos.byAssociatedId(photoOwner(this.saId, id))).map(p => [p.photoId, p]));
    const out: ClearSection[] = [];
    const size = (refs: Array<DraftPhoto | null | undefined>) => {
      let photos = 0;
      let bytes = 0;
      for (const r of refs) {
        const p = r ? stored.get(r.photoId) : null;
        if (!p) continue;
        photos++;
        bytes += p.photo ? Math.floor((p.photo.length * 3) / 4) : 0;
      }
      return { photos, bytes };
    };
    const detail = (n: number, bytes: number, records = 0) =>
      [records ? `${records} ${records === 1 ? 'record' : 'records'}` : null, n ? `${n} ${n === 1 ? 'photo' : 'photos'}` : null, bytes ? formatSize(bytes) : null]
        .filter(Boolean)
        .join(' · ');
    if (d.selfie || d.site) {
      const s = size([d.selfie, d.site]);
      out.push({
        id: CLEAR_START,
        title: this.t('clear.start'),
        icon: 'camera',
        detail: detail(s.photos, s.bytes, s.photos ? 0 : 1),
        unsent: !d.startSent,
        note: d.startSent ? undefined : this.t('clear.startNote'),
        ...s,
      });
    }
    const slots = new Map<string, DraftPhoto[]>();
    for (const p of d.photos) slots.set(p.slot, [...(slots.get(p.slot) ?? []), p]);
    for (const r of d.removed) if (!slots.has(r.slot)) slots.set(r.slot, []);
    const titles = new Map(((await this.keptDetail(id))?.items ?? []).map(i => [itemSlot(i.section, i.index), i.title]));
    for (const [slot, refs] of slots) {
      const s = size(refs);
      const removals = d.removed.filter(r => r.slot === slot).length;
      if (!refs.length && !removals) continue;
      out.push({
        id: clearPhotosSection(slot),
        title: this.t('clear.photos', { Item: titles.get(slot) ?? slot.replace(/^onsite\//, '') }),
        icon: 'image',
        detail: detail(s.photos, s.bytes, s.photos ? 0 : removals),
        unsent: refs.some(r => !r.uploaded) || d.removed.some(x => x.slot === slot && !x.sent),
        ...s,
      });
    }
    const answered = Object.keys(d.checks).length + (d.representativeName != null || d.representativeMobile != null ? 1 : 0) + (d.remarks != null ? 1 : 0);
    if (answered) {
      out.push({ id: CLEAR_CHECKS, title: this.t('clear.checks'), icon: 'clipboard', detail: detail(0, 0, answered), unsent: d.saveDirty, photos: 0, bytes: 0 });
    }
    return out;
  }

  /** Clears some sections of a visit (only the phone's copy; what the server has stays). An unsynced start clears everything. */
  async clearSections(id: number, ids: string[]): Promise<boolean> {
    const saId = this.saId;
    const d = this.draftOf(id) ?? (await this.deps.cache.get<SchemeDraft>(this.draftKey(saId, id)));
    if (!d || ids.length === 0) return false;
    if (ids.includes(CLEAR_START) && !d.startSent) return this.clearAll(id);
    const want = new Set(ids);
    const drop: string[] = [];
    const jobs: string[] = [];
    if (want.has(CLEAR_START)) for (const p of [d.selfie, d.site]) if (p) drop.push(p.photoId);
    for (const p of d.photos)
      if (want.has(clearPhotosSection(p.slot))) {
        drop.push(p.photoId);
        jobs.push(schemeJobKey(saId, id, SCHEME_JOBS.photo, p.photoId));
      }
    for (const r of d.removed) if (want.has(clearPhotosSection(r.slot))) jobs.push(schemeJobKey(saId, id, SCHEME_JOBS.remove, r.photoId));
    if (want.has(CLEAR_CHECKS)) jobs.push(schemeJobKey(saId, id, SCHEME_JOBS.save));
    for (const k of jobs) await this.deps.queue.remove(k);
    for (const p of drop) await this.deps.photos.delete(p);
    const after = await this.mutate(id, x => {
      if (want.has(CLEAR_START)) {
        x.selfie = null;
        x.site = null;
      }
      x.photos = x.photos.filter(p => !want.has(clearPhotosSection(p.slot)));
      x.removed = x.removed.filter(r => !want.has(clearPhotosSection(r.slot)));
      if (want.has(CLEAR_CHECKS)) {
        x.checks = {};
        x.representativeName = undefined;
        x.representativeMobile = undefined;
        x.remarks = undefined;
        x.saveDirty = false;
      }
    });
    if (after && !after.selfie && !after.site && !after.photos.length && !after.removed.length && !Object.keys(after.checks).length && after.remarks == null && after.representativeName == null)
      await this.forget(id);
    this.deps.touch();
    return true;
  }

  /** Everything of a visit on the phone: its draft, photos, kept detail and waiting sends. */
  async clearAll(id: number): Promise<boolean> {
    const saId = this.saId;
    for (const j of await this.pending(id)) await this.deps.queue.remove(j.key);
    await this.deps.photos.deleteByAssociatedId(photoOwner(saId, id));
    await this.forget(id);
    this.deps.touch();
    return true;
  }

  private async forget(id: number) {
    const saId = this.saId;
    await this.chain;
    await this.deps.cache.set(this.draftKey(saId, id), null);
    await this.deps.cache.set(`${DETAIL_KEY}${saId}.${id}`, null);
    const ids = (await this.deps.cache.get<number[]>(INDEX_KEY + saId)) ?? [];
    await this.deps.cache.set(INDEX_KEY + saId, ids.filter(x => x !== id));
    this._drafts = this._drafts.filter(x => x.applicationId !== id);
  }

  /** Whether the phone holds unsynced work for a visit (the list's badge). */
  hasUnsent(id: number): boolean {
    const d = this.draftOf(id);
    return !!d && ((!!d.selfie && !d.startSent) || d.photos.some(p => !p.uploaded) || d.saveDirty || d.removed.some(r => !r.sent));
  }

  /** The photo's image kept on the phone (base64), for its thumbnail. */
  async image(photoId: string): Promise<string | null> {
    return (await this.deps.photos.get(photoId))?.photo ?? null;
  }
}

function formatSize(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
