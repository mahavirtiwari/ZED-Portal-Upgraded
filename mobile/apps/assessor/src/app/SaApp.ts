import {
  apiBase,
  AppForms,
  AppSession,
  type BaseServiceResponse,
  AppTexts,
  AppTokenStore,
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
import { SaApi, type SaSystem } from '../api';
import { BUILT_IN_TEXTS } from '../content/builtInTexts';
import { ASSESSMENT_DB_NAME, AssessorStore, MEDIA_DB_NAME, nativePrefs, PREFS, PROTECTED_PREFS, type Prefs } from '../db/stores';
import { ASSESSOR_BASIC_INFO, BUILT_IN_BASIC_INFO } from '../forms';
import { EVIDENCE_ADDED, EVIDENCE_SITE_TOUR, normalizeDetails, type AssessmentDetails } from '../models';
import { hasUnsentWork, type AppNotification, type AssessmentSummary, type AssessorProfile, type ReportSummary } from '../portfolio';
import { base64Decode, base64EncodeDefault } from '../util/base64';

/** ZedCache key of an assessor's profile and assessment list (redesign). */
const ASSESSOR_KEY = 'sa.assessor.';
const NOTIFICATIONS_KEY = 'sa.notifications.';
const REPORTS_KEY = 'sa.reports.';

export type SaAppDeps = {
  db: SqlDb;
  mediaDb: SqlDb;
  environment: Environment;
  versionName: string;
  prefs?: Prefs;
  api?: SaApi;
  /** 2026-11-14: the surveillance host's API (tests); built from the environment otherwise. */
  surveillanceApi?: SaApi;
  system?: SaSystem;
};

/** The local Main MobileApi (launch profile "http", port 5104) seen from the emulator. */
export function saEnvironment(env: Environment): Environment {
  return env.name === 'local' ? { name: 'local', baseUrl: 'http://10.0.2.2:5104' } : env;
}

/**
 * GlobalDataManager of the legacy app: the assessment in progress (one per assessor + unit, kept as JSON in
 * com.zed.assessmentdb AssessorData), the assessor and unit in AssessmentPrefs, and the local stores.
 * Screens change `details` in place and call {@link update} (updateDetails), which rewrites the row.
 */
export class SaApp {
  readonly store: AssessorStore;
  readonly photos: PhotoStore;
  readonly queue: SyncQueue;
  readonly cache: KeyValueStore;
  readonly texts: AppTexts;
  readonly forms: AppForms;
  /**
   * 2026-11-14 (Onsite surveillance, "the app tries both"): the assessor signs in on the main and the surveillance hosts
   * with the same credentials; each unit is opened on the host it is allotted on (AssessmentSummary.system). `api` and
   * `session` are the current unit's host's; the surveillance token is kept under "SURV:" + the user (see tokenKey).
   */
  private readonly mainApi: SaApi;
  readonly surveillanceApi: SaApi;
  private readonly mainSession: AppSession;
  readonly surveillanceSession: AppSession;
  private system: SaSystem = 'main';
  readonly tokens: AppTokenStore;
  readonly prefs: Prefs;
  readonly environment: Environment;
  /** The portal (reports): the build's environment, not the local MobileApi port. */
  readonly portalEnvironment: Environment;
  readonly versionName: string;

  private _details: AssessmentDetails | null = null;
  private _assessor: AssessorProfile | null = null;
  private _assessments: AssessmentSummary[] = [];
  private _notifications: AppNotification[] = [];
  private _read = new Set<string>();
  private _reports: ReportSummary[] = [];
  private listeners = new Set<() => void>();
  private revision = 0;
  private saving: Promise<unknown> = Promise.resolve();

  constructor(deps: SaAppDeps) {
    this.store = new AssessorStore(deps.db);
    this.photos = new PhotoStore(deps.mediaDb);
    this.queue = new SyncQueue(deps.db);
    this.cache = new KeyValueStore(deps.db);
    this.texts = new AppTexts(this.cache, BUILT_IN_TEXTS);
    this.forms = new AppForms(this.cache, { [ASSESSOR_BASIC_INFO]: BUILT_IN_BASIC_INFO });
    this.prefs = deps.prefs ?? nativePrefs;
    this.environment = saEnvironment(deps.environment);
    this.portalEnvironment = deps.environment;
    this.versionName = deps.versionName;
    this.mainApi = deps.api ?? new SaApi(this.environment, () => requestContext(), undefined, deps.system ?? 'main');
    this.surveillanceApi = deps.surveillanceApi ?? new SaApi(this.environment, () => requestContext(), undefined, 'surveillance');
    this.tokens = new AppTokenStore(deps.db);
    this.mainSession = new AppSession(this.tokens);
    this.surveillanceSession = new AppSession(this.tokens);
    this.mainApi.rest.useSession(this.mainSession);
    this.mainApi.retrofit.useSession(this.mainSession);
    this.surveillanceApi.rest.useSession(this.surveillanceSession);
    this.surveillanceApi.retrofit.useSession(this.surveillanceSession);
  }

  /** The current unit's host API (main unless a surveillance unit is open). */
  get api(): SaApi {
    return this.system === 'surveillance' ? this.surveillanceApi : this.mainApi;
  }

  /** The current host's sign-in. */
  get session(): AppSession {
    return this.system === 'surveillance' ? this.surveillanceSession : this.mainSession;
  }

  get currentSystem(): SaSystem {
    return this.system;
  }

  /** Switches to the host a unit is allotted on, before its calls. */
  useSystem(system: SaSystem | null | undefined): void {
    this.system = system === 'surveillance' ? 'surveillance' : 'main';
  }

  /** The token store's key of a user on the current host (the surveillance token apart from the main one). */
  tokenKey(userId: string): string {
    return this.system === 'surveillance' ? 'SURV:' + userId : userId;
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
    await this.tokens.ensureSchema();
    // New in V4: the sign-in values and drafts the legacy app left in plain SharedPreferences are encrypted.
    for (const file of PROTECTED_PREFS) this.prefs.protect(file);
    await this.texts.load();
    await this.forms.load([ASSESSOR_BASIC_INFO]);
  }

  /** Admin texts and the Basic Information form: at start and after login; a failure keeps the last answer. */
  async refreshServerContent(): Promise<void> {
    await Promise.all([
      this.texts.refresh(() => this.api.getTexts()),
      this.forms.refresh(ASSESSOR_BASIC_INFO, () => this.api.getFormDefinition(ASSESSOR_BASIC_INFO)),
    ]);
  }

  // ----- state -----

  get details(): AssessmentDetails | null {
    return this._details;
  }

  /** New (redesign): the signed-in assessor; null on the sign-in page. */
  get assessor(): AssessorProfile | null {
    return this._assessor;
  }

  /** New (redesign): the assessor's assessments (last answer of SA/SignIn or SA/Assessments, kept for offline use). */
  get assessments(): AssessmentSummary[] {
    return this._assessments;
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

  // ----- the signed-in assessor (redesign) -----

  /** After a sign-in: the profile and the list are kept per assessor for the offline sign-in. */
  async signedInAs(profile: AssessorProfile, assessments: AssessmentSummary[] | null): Promise<void> {
    if (this._assessor?.assessorId !== profile.assessorId) await this.loadKept(profile.assessorId);
    this._assessor = profile;
    if (assessments) this._assessments = assessments;
    await this.cache.set(ASSESSOR_KEY + profile.assessorId, { profile, assessments: this._assessments });
    this.touch();
  }

  /** The offline sign-in: the profile and list kept by the last online sign-in of this assessor. */
  async resumeAssessor(assessorId: string): Promise<boolean> {
    const kept = await this.cache.get<{ profile: AssessorProfile; assessments: AssessmentSummary[] }>(ASSESSOR_KEY + assessorId);
    await this.loadKept(assessorId);
    this._assessor = kept?.profile ?? { assessorId };
    this._assessments = kept?.assessments ?? [];
    this.touch();
    return kept != null;
  }

  /** SA/Assessments: a failure keeps the last list. */
  async refreshAssessments(): Promise<void> {
    const a = this._assessor;
    if (!a) return;
    const r = await this.mainApi.assessments(a.assessorId);
    if (!(r && String(r.status ?? '') === '1' && Array.isArray(r.assessments))) return;
    // 2026-11-14: the surveillance host's units too, when the assessor is signed in there.
    let surveillance: AssessmentSummary[] = this._assessments.filter(x => x.system === 'surveillance');
    if (this.surveillanceSession.appToken) {
      try {
        const s = await this.surveillanceApi.assessments(a.assessorId);
        if (s && String(s.status ?? '') === '1' && Array.isArray(s.assessments)) surveillance = s.assessments.map(x => ({ ...x, system: 'surveillance' as const }));
      } catch {
        // keep the last surveillance list
      }
    }
    await this.signedInAs(a, [...r.assessments.map(x => ({ ...x, system: 'main' as const })), ...surveillance]);
  }

  get notifications(): AppNotification[] {
    return this._notifications;
  }

  get unreadCount(): number {
    return this._notifications.filter(n => !this._read.has(n.id)).length;
  }

  isRead(id: string): boolean {
    return this._read.has(id);
  }

  get reports(): ReportSummary[] {
    return this._reports;
  }

  /** SA/Notifications and SA/Reports; a failure keeps the last answer (kept per assessor for offline use). */
  async refreshNotifications(): Promise<void> {
    const a = this._assessor;
    if (!a) return;
    const r = await this.api.notifications(a.assessorId);
    if (r && String(r.status ?? '') === '1' && Array.isArray(r.notifications)) {
      this._notifications = r.notifications;
      await this.cache.set(NOTIFICATIONS_KEY + a.assessorId, { list: this._notifications, read: [...this._read] });
      this.touch();
    }
  }

  async markAllRead(): Promise<void> {
    const a = this._assessor;
    if (!a) return;
    for (const n of this._notifications) this._read.add(n.id);
    await this.cache.set(NOTIFICATIONS_KEY + a.assessorId, { list: this._notifications, read: [...this._read] });
    this.touch();
  }

  async refreshReports(): Promise<void> {
    const a = this._assessor;
    if (!a) return;
    const r = await this.api.reports(a.assessorId);
    if (r && String(r.status ?? '') === '1' && Array.isArray(r.reports)) {
      this._reports = r.reports;
      await this.cache.set(REPORTS_KEY + a.assessorId, this._reports);
      this.touch();
    }
  }

  /** The notifications and reports kept by the last sign-in of this assessor. */
  private async loadKept(assessorId: string): Promise<void> {
    const n = await this.cache.get<{ list: AppNotification[]; read: string[] }>(NOTIFICATIONS_KEY + assessorId);
    this._notifications = n?.list ?? [];
    this._read = new Set(n?.read ?? []);
    this._reports = (await this.cache.get<ReportSummary[]>(REPORTS_KEY + assessorId)) ?? [];
  }

  /** The assessments of this assessor kept on the phone (its unit rows), by ZED ID. */
  async storedAssessment(zedId: string): Promise<AssessmentDetails | null> {
    const a = this._assessor;
    if (!a) return null;
    const d = this._details && this.saId === a.assessorId && this.zedId === zedId ? this._details : await this.store.load(a.assessorId + zedId);
    return d ? normalizeDetails(d) : null;
  }

  /** Leaves the open unit (back to the dashboard); its row and sync queue stay. */
  closeAssessment(): void {
    this._details = null;
    this.touch();
  }

  /** The site assessment report PDF of a unit (portal, checked with the sign-in token; docs/MOBILE-API.md). */
  reportUrl(zedId: string, certificationType: string, path?: string | null): string {
    if (path) return this.portalEnvironment.baseUrl.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
    return apiBase(this.portalEnvironment, 'SA/AppReport').replace(/\/$/, '') + `?zedId=${encodeURIComponent(zedId)}&certificationType=${encodeURIComponent(certificationType)}`;
  }

  /**
   * New (redesign): the web's staff password reset mail, asked from the app (portal SA/AppForgotPassword, by assessor
   * ID or registered e-mail address); the answer never says whether the account exists.
   */
  forgotPassword(input: { assessorId?: string; email?: string }) {
    return this.api.retrofit.postJson<BaseServiceResponse>(apiBase(this.portalEnvironment, 'SA/AppForgotPassword').replace(/\/$/, ''), input);
  }

  /** Anything of the unit not on the server yet: queued sends, meetings, selfie or photos kept offline, answers. */
  async hasUnsentWork(zedId: string): Promise<boolean> {
    const a = this._assessor;
    if (!a) return false;
    const id = a.assessorId + zedId;
    if ((await this.queue.pendingCount(id)) > 0) return true;
    if ((await this.store.meeting(id, true)) || (await this.store.meeting(id, false)) || (await this.store.selfie(id))) return true;
    if ((await this.store.evidencesOfType(id, EVIDENCE_ADDED)).length || (await this.store.evidencesOfType(id, EVIDENCE_SITE_TOUR)).length) return true;
    return hasUnsentWork(await this.storedAssessment(zedId));
  }

  /** "Clean data": the unit's row and its evidences (the caller checks there is no unsent work). */
  async deleteStoredAssessment(zedId: string): Promise<boolean> {
    const a = this._assessor;
    if (!a) return false;
    const id = a.assessorId + zedId;
    if (!(await this.store.delete(id))) return false;
    await this.store.deleteAllEvidences(id);
    if (this.userId === id) {
      this.prefs.remove(PREFS.assessment, PREFS.zedId);
      this._details = null;
    }
    this.touch();
    return true;
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

  /**
   * New (audit C1): the server ended the sign-in. The open assessment is closed in memory and the token forgotten;
   * the stored assessment (offline work), its sync queue and the offline credential stay on the phone.
   */
  signOut(): void {
    this._details = null;
    this._assessor = null;
    this._assessments = [];
    this._notifications = [];
    this._read = new Set();
    this._reports = [];
    this.session.clear();
    this.touch();
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
