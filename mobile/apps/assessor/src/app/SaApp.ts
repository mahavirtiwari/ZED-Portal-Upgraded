import {
  apiBase,
  AppForms,
  AppSession,
  type BaseServiceResponse,
  AppTexts,
  AppTokenStore,
  credentialToStore,
  AppBranding,
  fetchAppBranding,
  getAppInfo,
  KeyValueStore,
  PhotoStore,
  requestContext,
  SyncQueue,
  verifyCredential,
  type Environment,
  type SqlDb,
} from '@zed/shared';
import { LOGIN_DB_NAME as BRONZE_DB_NAME, MEDIA_DB_NAME as BRONZE_MEDIA_DB_NAME, MsmeApp } from '@zed/bronze-surveillance';
import { SaApi, type FormCorrection, type SaSystem } from '../api';
import type { BronzeCase } from '../bronze/cases';
import { carryOverLocalWork, caseSections, loadCaseData, photosIn, photosInUse, planClear, removePhotos, type ClearSection } from '../clearData';
import { BUILT_IN_TEXTS } from '../content/builtInTexts';
import { ASSESSMENT_DB_NAME, AssessorStore, MEDIA_DB_NAME, nativePrefs, PREFS, PROTECTED_PREFS, type Prefs } from '../db/stores';
import { ASSESSOR_BASIC_INFO, BUILT_IN_BASIC_INFO } from '../forms';
import { EVIDENCE_ADDED, EVIDENCE_SITE_TOUR, normalizeDetails, type AssessmentDetails } from '../models';
import { hasUnsentWork, type AppNotification, type AssessmentSummary, type AssessorProfile, type ReportLinkResponse, type ReportSummary } from '../portfolio';
import { SchemeVisits } from '../schemes/schemeVisits';
import { randomUuid } from '../util/uuid';
import { base64Decode, base64EncodeDefault } from '../util/base64';

/** ZedCache key of an assessor's profile and assessment list (redesign). */
const ASSESSOR_KEY = 'sa.assessor.';
const NOTIFICATIONS_KEY = 'sa.notifications.';
const REPORTS_KEY = 'sa.reports.';
/** 2026-11-21: the Bronze surveillance cases kept per assessor, and which assessor opened a Bronze unit on this phone. */
const BRONZE_CASES_KEY = 'sa.bronze.cases.';
const BRONZE_OWNER_KEY = 'sa.bronze.owner.';

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
  /**
   * 2026-11-21: the Bronze surveillance module, on databases of its own (its texts cache, queue and photo tables have the
   * same names as this app's).
   */
  bronze: MsmeApp;
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
  /** 2026-11-15: the Admin's logo and colours for this app (Admin → Settings → Branding), the last answer kept. */
  readonly branding: AppBranding;
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
  /** 2026-11-20 (incentive schemes, phase 2): the onsite assessor's scheme visits (main host). */
  readonly schemes: SchemeVisits;
  /**
   * 2026-11-21: Bronze surveillance (the retired ZED Surveillance app's steps, @zed/bronze-surveillance) for the case opened
   * last: its own databases (QCI_MSME_DB, ZED_MSME_Media_DB of this app), queue, texts (app.msme.*) and "SURV" session.
   */
  readonly bronze: MsmeApp;
  private _bronzeCases: BronzeCase[] = [];

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
    this.branding = new AppBranding(this.cache, 'assessor');
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
    this.bronze = deps.bronze;
    this.schemes = new SchemeVisits({
      cache: this.cache,
      photos: this.photos,
      queue: this.queue,
      texts: this.texts,
      api: () => this.mainApi,
      saId: () => this._assessor?.assessorId ?? '',
      touch: () => this.touch(),
      newId: () => `${this._assessor?.assessorId ?? 'SA'}-${randomUuid()}`,
    });
  }

  /**
   * 2026-11-21: signed in on the surveillance host only (a Bronze surveillance desktop assessor the main host refused): no
   * main token, so nothing is asked of the main host.
   */
  get surveillanceOnly(): boolean {
    return !this.mainSession.appToken && !!this.surveillanceSession.appToken;
  }

  /** The main host's API and sign-in token (scheme visits and their documents are on the main host only). */
  get schemeApi(): SaApi {
    return this.mainApi;
  }

  get schemeToken(): string | null {
    return this.mainSession.appToken;
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
    const environment = saEnvironment(info.environment);
    // 2026-11-21: the Bronze module on databases of its own (its queue and photo tables would mix with this app's).
    const bronze = new MsmeApp({ loginDb: openDatabase(BRONZE_DB_NAME), mediaDb: openDatabase(BRONZE_MEDIA_DB_NAME), environment, versionName: info.versionName });
    const app = new SaApp({ db: openDatabase(ASSESSMENT_DB_NAME), mediaDb: openDatabase(MEDIA_DB_NAME), environment: info.environment, versionName: info.versionName, bronze });
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
    // Before the first screen: an offline start shows the Admin's last logo and colours at once.
    await this.branding.load();
    await this.bronze.init();
  }

  /**
   * 2026-11-15: the Admin's logo and colours from the main portal (api/public/branding/app/assessor, 5 s at most): the
   * build's portal address, not the local MobileApi port, and the main host's client (never the surveillance one).
   * Asked at start and when the app comes back to the front, never awaited by the start; a failure keeps the last
   * answer (or today's look) without a message.
   */
  async refreshBranding(): Promise<void> {
    await this.branding.refresh(() => fetchAppBranding(this.mainApi.retrofit, this.portalEnvironment.baseUrl, 'assessor'));
  }

  /** Admin texts and the Basic Information form: at start and after login; a failure keeps the last answer. */
  async refreshServerContent(): Promise<void> {
    await Promise.all([
      this.texts.refresh(() => this.api.getTexts()),
      this.forms.refresh(ASSESSOR_BASIC_INFO, () => this.api.getFormDefinition(ASSESSOR_BASIC_INFO)),
      // 2026-11-21: the Bronze steps' own texts (app.msme.*) and Basic Information form, from the surveillance host.
      this.bronze.refreshServerContent(),
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
  async signedInAs(profile: AssessorProfile, assessments: AssessmentSummary[] | null, bronzeCases?: BronzeCase[] | null): Promise<void> {
    if (this._assessor?.assessorId !== profile.assessorId) await this.loadKept(profile.assessorId);
    this._assessor = profile;
    if (assessments) this._assessments = assessments;
    await this.cache.set(ASSESSOR_KEY + profile.assessorId, { profile, assessments: this._assessments });
    if (bronzeCases) await this.setBronzeCases(bronzeCases);
    this.touch();
  }

  // ----- Bronze surveillance (2026-11-21) -----

  /** The assessor's Bronze surveillance cases (last answer of the surveillance host, kept for offline use). */
  get bronzeCases(): BronzeCase[] {
    return this._bronzeCases;
  }

  private async setBronzeCases(list: BronzeCase[]): Promise<void> {
    this._bronzeCases = list.filter(c => !!c?.zedId);
    const a = this._assessor;
    if (a) await this.cache.set(BRONZE_CASES_KEY + a.assessorId, this._bronzeCases);
    this.touch();
  }

  /** SA/BronzeSurveillance on the surveillance host, when signed in there; a failure keeps the last list. */
  async refreshBronzeCases(): Promise<void> {
    const a = this._assessor;
    if (!a || !this.surveillanceSession.appToken) return;
    const r = await this.surveillanceApi.bronzeSurveillance(a.assessorId);
    if (r && String(r.status ?? '') === '1' && Array.isArray(r.cases)) await this.setBronzeCases(r.cases);
  }

  /** The assessor who last opened a Bronze unit on this phone (a unit opens offline only for that assessor). */
  async bronzeOwner(zedId: string): Promise<string | null> {
    return (await this.cache.get<string>(BRONZE_OWNER_KEY + zedId)) ?? null;
  }

  async setBronzeOwner(zedId: string, assessorId: string): Promise<void> {
    await this.cache.set(BRONZE_OWNER_KEY + zedId, assessorId);
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
  /** 2026-11-16: the answers the agency sent back to this assessor (every unit under its review; main portal only). */
  async formCorrections(): Promise<FormCorrection[]> {
    const id = this._assessor?.assessorId;
    // 2026-11-21: not for an assessor signed in on the surveillance host only.
    if (!id || this.surveillanceOnly) return [];
    const r = await this.mainApi.formCorrections({ saId: id });
    return r && String(r.status ?? '') === '1' && Array.isArray(r.corrections) ? r.corrections : [];
  }

  /** 2026-11-16: the corrected answer to one of them; the server's refusal, or null. */
  async submitFormCorrection(c: FormCorrection, value: unknown): Promise<string | null> {
    const id = this._assessor?.assessorId;
    if (!id) return 'Please sign in again.';
    const r = await this.mainApi.submitFormCorrection({ saId: id, zedId: c.zedId, certificationType: c.certificationType, form: c.form, key: c.key, value });
    return r && String(r.status ?? '') === '1' ? null : (r?.errorMessage || 'The answer could not be sent. Please try again.');
  }

  async refreshAssessments(): Promise<void> {
    const a = this._assessor;
    if (!a) return;
    // 2026-11-21: the Bronze surveillance cases too (surveillance host); an assessor signed in there only has no main list.
    await this.refreshBronzeCases().catch(() => undefined);
    let main: AssessmentSummary[] = this._assessments.filter(x => x.system !== 'surveillance');
    if (!this.surveillanceOnly) {
      const r = await this.mainApi.assessments(a.assessorId);
      if (!(r && String(r.status ?? '') === '1' && Array.isArray(r.assessments))) return;
      main = r.assessments.map(x => ({ ...x, system: 'main' as const }));
    }
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
    await this.signedInAs(a, [...main, ...surveillance]);
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
    this._bronzeCases = (await this.cache.get<BronzeCase[]>(BRONZE_CASES_KEY + assessorId)) ?? [];
    // Another assessor's Bronze unit is not left open (its queue is sent when that assessor opens it again).
    if (this.bronze.loginId && (await this.bronzeOwner(this.bronze.loginId)) !== assessorId) this.bronze.resetUser();
    await this.schemes.load(assessorId);
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
   * 2026-11-15: the report as a page of the portal (built from the live data, with Download PDF there): its address signed
   * for 10 minutes (portal SA/AppReportLink, checked with the sign-in token), which the app opens in the browser.
   */
  reportLink(zedId: string, certificationType: string, linkPath?: string | null): Promise<ReportLinkResponse> {
    const url = linkPath
      ? this.portalEnvironment.baseUrl.replace(/\/+$/, '') + '/' + linkPath.replace(/^\/+/, '')
      : apiBase(this.portalEnvironment, 'SA/AppReportLink').replace(/\/$/, '') + `?zedId=${encodeURIComponent(zedId)}&certificationType=${encodeURIComponent(certificationType)}`;
    return this.api.retrofit.getJson<ReportLinkResponse>(url);
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

  /**
   * 2026-11-18: the sections of an assessment the phone holds data for (the Clear data sheet), with their size and whether
   * they hold work the server does not have yet.
   */
  async dataSections(zedId: string): Promise<ClearSection[]> {
    const a = this._assessor;
    if (!a) return [];
    const id = a.assessorId + zedId;
    return caseSections(await loadCaseData(this, a.assessorId, zedId, this.userId === id ? this._details : null));
  }

  /**
   * 2026-11-18: "Clear data" section by section: only the given sections are removed (a partial update of the stored
   * assessment, their evidences, photos, saved meeting or selfie and their queued sends); the other sections stay and the
   * assessment stays usable. A photo still used by a section that stays is kept.
   */
  async clearSections(zedId: string, sections: string[]): Promise<boolean> {
    const a = this._assessor;
    if (!a || sections.length === 0) return false;
    const id = a.assessorId + zedId;
    await this.saving;
    const open = this.userId === id ? this._details : null;
    const before = await loadCaseData(this, a.assessorId, zedId, open);
    if (!before.details) return false;
    const plan = planClear(before, sections);
    if (!(await this.store.updateDetails(id, plan.mutate))) return false;
    if (open) plan.mutate(open);
    if (plan.openMeeting) await this.store.clearMeeting(id, true);
    if (plan.closeMeeting) await this.store.clearMeeting(id, false);
    if (plan.selfie) await this.store.clearSelfie(id);
    if (plan.meetingDraft) this.prefs.remove(PREFS.meetingDraft, PREFS.meetingDraftKey);
    for (const type of plan.evidenceTypes) await this.store.deleteEvidencesOfType(id, type);
    await this.store.deleteEvidences(id, plan.evidenceIds);
    for (const job of before.jobs) if (plan.jobKinds.includes(job.kind) && (!plan.jobFilter || plan.jobFilter(job))) await this.queue.remove(job.key);
    const inUse = photosInUse(await loadCaseData(this, a.assessorId, zedId, open));
    await removePhotos(this.photos, plan.photos.filter(p => !inUse.has(p.photoId)));
    this.touch();
    return true;
  }

  /**
   * "Everything for this assessment" of the Clear data sheet (the earlier one-step Clear data): the unit's row, its evidences,
   * its photos and its queued sends.
   */
  async deleteStoredAssessment(zedId: string): Promise<boolean> {
    const a = this._assessor;
    if (!a) return false;
    const id = a.assessorId + zedId;
    await this.saving;
    const c = await loadCaseData(this, a.assessorId, zedId, this.userId === id ? this._details : null);
    if (!(await this.store.delete(id))) return false;
    await this.store.deleteAllEvidences(id);
    await removePhotos(this.photos, [...photosIn(c.details, c.openMeeting, c.closeMeeting, c.selfie), ...c.stored]);
    for (const job of c.jobs) await this.queue.remove(job.key);
    if (c.meetingDraft) this.prefs.remove(PREFS.meetingDraft, PREFS.meetingDraftKey);
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
    // 2026-11-18: after a cleared allocation the download brings the parameters back; the phone's other sections stay.
    const before = await this.store.load(saId + zedId).catch(() => null);
    if (before) carryOverLocalWork(before, data);
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
    this._bronzeCases = [];
    this.schemes.reset();
    this.session.clear();
    this.bronze.resetUser();
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
