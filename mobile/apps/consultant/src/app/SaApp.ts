import {
  AppForms,
  AppTexts,
  credentialToStore,
  getAppInfo,
  KeyValueStore,
  PhotoStore,
  requestContext,
  SyncQueue,
  verifyCredential,
  type Environment,
  type SqlDb,
} from '@zed/shared';
import { SaApi } from '../api';
import { BUILT_IN_TEXTS } from '../content/builtInTexts';
import { ASSESSMENT_DB_NAME, AssessorStore, MEDIA_DB_NAME, nativePrefs, PREFS, type Prefs } from '../db/stores';
import { BUILT_IN_BASIC_INFO, CONSULTANT_BASIC_INFO } from '../forms';
import { normalizeDetails, type AssessmentDetails } from '../models';
import { base64Decode, base64EncodeDefault } from '../util/base64';

export type SaAppDeps = {
  db: SqlDb;
  mediaDb: SqlDb;
  environment: Environment;
  versionName: string;
  prefs?: Prefs;
  api?: SaApi;
};

/**
 * GlobalDataManager of the legacy app: the consultancy in progress (one per consultant + unit, kept as JSON in
 * com.zed.assessmentdb AssessorData), the consultant and unit in AssessmentPrefs, and the local stores.
 * Screens change `details` in place and call {@link update} (updateDetails), which rewrites the row.
 */
export class SaApp {
  readonly store: AssessorStore;
  readonly photos: PhotoStore;
  readonly queue: SyncQueue;
  readonly cache: KeyValueStore;
  readonly texts: AppTexts;
  readonly forms: AppForms;
  readonly api: SaApi;
  readonly prefs: Prefs;
  readonly environment: Environment;
  readonly versionName: string;

  private _details: AssessmentDetails | null = null;
  private listeners = new Set<() => void>();
  private revision = 0;
  private saving: Promise<unknown> = Promise.resolve();

  constructor(deps: SaAppDeps) {
    this.store = new AssessorStore(deps.db);
    this.photos = new PhotoStore(deps.mediaDb);
    this.queue = new SyncQueue(deps.db);
    this.cache = new KeyValueStore(deps.db);
    this.texts = new AppTexts(this.cache, BUILT_IN_TEXTS);
    this.forms = new AppForms(this.cache, { [CONSULTANT_BASIC_INFO]: BUILT_IN_BASIC_INFO });
    this.prefs = deps.prefs ?? nativePrefs;
    this.environment = deps.environment;
    this.versionName = deps.versionName;
    this.api = deps.api ?? new SaApi(this.environment, () => requestContext());
  }

  static async open(openDatabase: (name: string) => SqlDb): Promise<SaApp> {
    const info = getAppInfo();
    const app = new SaApp({ db: openDatabase(ASSESSMENT_DB_NAME), mediaDb: openDatabase(MEDIA_DB_NAME), environment: info.environment, versionName: info.versionName });
    await app.init();
    return app;
  }

  async init(): Promise<void> {
    await this.store.ensureSchema();
    await this.photos.ensureSchema();
    await this.queue.ensureSchema();
    await this.cache.ensureSchema();
    await this.texts.load();
    await this.forms.load([CONSULTANT_BASIC_INFO]);
  }

  /** Admin texts and the Basic Information form: at start and after login; a failure keeps the last answer. */
  async refreshServerContent(): Promise<void> {
    await Promise.all([
      this.texts.refresh(() => this.api.getTexts()),
      this.forms.refresh(CONSULTANT_BASIC_INFO, () => this.api.getFormDefinition(CONSULTANT_BASIC_INFO)),
    ]);
  }

  // ----- state -----

  get details(): AssessmentDetails | null {
    return this._details;
  }

  get saId(): string {
    return this.prefs.get(PREFS.assessment, PREFS.saId) ?? '';
  }

  get zedId(): string {
    return this.prefs.get(PREFS.assessment, PREFS.zedId) ?? '';
  }

  /** SA ID + ZED ID */
  get userId(): string {
    return this.saId + this.zedId;
  }

  get certificationType(): string {
    return this._details?.certificationType ?? '';
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getRevision(): number {
    return this.revision;
  }

  touch(): void {
    this.revision++;
    for (const l of this.listeners) l();
  }

  private remember(saId: string | null, zedId: string | null) {
    if (saId != null) this.prefs.set(PREFS.assessment, PREFS.saId, saId);
    if (zedId != null) this.prefs.set(PREFS.assessment, PREFS.zedId, zedId);
  }

  /** saveAssessmentDetails */
  async saveDetails(data: AssessmentDetails, saId: string, zedId: string): Promise<boolean> {
    normalizeDetails(data);
    const ok = await this.store.save(saId + zedId, data);
    if (ok) {
      this._details = data;
      this.remember(saId, zedId);
      this.touch();
    }
    return ok;
  }

  /** getAssessmentDetails(assessorId, zedId): reads the row and remembers the assessor and unit. */
  async loadDetails(saId: string, zedId: string): Promise<AssessmentDetails | null> {
    const d = await this.store.load(saId + zedId);
    this._details = d ? normalizeDetails(d) : null;
    this.remember(saId, zedId);
    this.touch();
    return this._details;
  }

  /** getAssessmentDetails(): the remembered assessment. */
  async loadRemembered(): Promise<AssessmentDetails | null> {
    if (this._details) return this._details;
    const d = await this.store.load(this.userId);
    this._details = d ? normalizeDetails(d) : null;
    this.touch();
    return this._details;
  }

  /** updateDetails: rewrites the row (serialized, so writes never overtake each other). */
  update(): Promise<void> {
    this.touch();
    const data = this._details;
    const id = this.userId;
    if (!data) return Promise.resolve();
    const snapshot = JSON.parse(JSON.stringify(data)) as AssessmentDetails;
    const p = this.saving.then(() => this.store.save(id, snapshot));
    this.saving = p.catch(() => undefined);
    return p.then(() => undefined);
  }

  /** deleteAssessorData: the row, its evidences and the remembered assessor/unit. */
  async deleteAssessorData(): Promise<boolean> {
    const id = this.userId;
    if (!(await this.store.delete(id))) return false;
    await this.store.deleteAllEvidences(id);
    this.prefs.remove(PREFS.assessment, PREFS.saId);
    this.prefs.remove(PREFS.assessment, PREFS.zedId);
    this._details = null;
    this.touch();
    return true;
  }

  // ----- offline sign-in (LoginActivity.saveCredentials / compareCredentials) -----

  /**
   * The legacy kept Base64 of the assessor ID, password and ZED ID; the password is now kept as a salted hash (same
   * key), the IDs as before.
   */
  saveCredentials(assessorId: string, password: string, zedId: string) {
    this.prefs.set(PREFS.login, PREFS.loginAssessorId, base64EncodeDefault(assessorId));
    this.prefs.set(PREFS.login, PREFS.loginPassword, credentialToStore(password, undefined, false));
    this.prefs.set(PREFS.login, PREFS.loginZedId, base64EncodeDefault(zedId));
  }

  compareCredentials(assessorId: string, password: string, zedId: string): boolean {
    const a = this.prefs.get(PREFS.login, PREFS.loginAssessorId);
    const z = this.prefs.get(PREFS.login, PREFS.loginZedId);
    const p = this.prefs.get(PREFS.login, PREFS.loginPassword);
    if (a == null || z == null || p == null) return false;
    if (base64Decode(a) !== assessorId || base64Decode(z) !== zedId) return false;
    // A legacy value is Base64 of the password itself.
    const stored = p.startsWith('zed1$') ? p : base64Decode(p);
    const verdict = verifyCredential(stored, password, undefined, false);
    if (verdict.upgrade) this.prefs.set(PREFS.login, PREFS.loginPassword, verdict.upgrade);
    return verdict.ok;
  }
}
