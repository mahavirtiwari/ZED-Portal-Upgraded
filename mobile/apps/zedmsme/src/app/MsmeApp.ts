import {
  AppForms,
  AppSession,
  AppTexts,
  AppTokenStore,
  KeyValueStore,
  LegacyLoginStore,
  MSME_LOGIN_TABLE,
  PhotoStore,
  SyncQueue,
  credentialToStore,
  getAppInfo,
  requestContext,
  takeAppToken,
  verifyCredential,
  type Environment,
  type SqlDb,
} from '@zed/shared';
import { MsmeApi, type PublicLevel } from '../api';
import { BUILT_IN_TEXTS } from '../content/builtInTexts';
import { BUILT_IN_BASIC_INFO, MSME_BASIC_INFO } from '../forms';
import { associatedIdOf, normalizeLoginResponse, type LoginResponse } from '../models';

/** Legacy database names (database/DBHelper.java, database/AppDatabase.java). */
export const LOGIN_DB_NAME = 'QCI_MSME_DB';
export const MEDIA_DB_NAME = 'ZED_MSME_Media_DB';
/** KeyValueStore key of the enabled levels (api/public/levels). */
const LEVELS_KEY = 'publicLevels';

export type MsmeAppDeps = {
  loginDb: SqlDb;
  mediaDb: SqlDb;
  environment: Environment;
  versionName: string;
  api?: MsmeApi;
};

/**
 * MApplication of the legacy app: the signed-in user (MApplication.loginId / getUserData) and the local stores.
 *
 * The whole sign-in response, offline work included, lives in memory as one object; screens change it and call
 * {@link persist} (startUserDataUpdate), which rewrites the JSON in QCI_MSME_DB.LoginData.
 */
export class MsmeApp {
  readonly loginStore: LegacyLoginStore<LoginResponse>;
  readonly photos: PhotoStore;
  readonly queue: SyncQueue;
  /** New in V4: the last server answers kept for offline use (Admin texts, the Basic Information form). */
  readonly cache: KeyValueStore;
  readonly texts: AppTexts;
  readonly forms: AppForms;
  readonly api: MsmeApi;
  /** New in V4 (audit C1): the app sign-in token, sent with every call; kept per user in QCI_MSME_DB.ZedAppToken. */
  readonly session: AppSession;
  readonly tokens: AppTokenStore;
  readonly environment: Environment;
  readonly versionName: string;

  /**
   * New in V4: the levels the Admin has enabled (api/public/levels), kept for offline use; null until the server has
   * answered once on this phone.
   */
  private _levels: PublicLevel[] | null = null;
  private _user: LoginResponse | null = null;
  private _loginId: string | null = null;
  private listeners = new Set<() => void>();
  private revision = 0;
  private persisting: Promise<unknown> = Promise.resolve();

  constructor(deps: MsmeAppDeps) {
    this.loginStore = new LegacyLoginStore<LoginResponse>(deps.loginDb, MSME_LOGIN_TABLE);
    this.photos = new PhotoStore(deps.mediaDb);
    // The queue table lives next to the login data (same database file, kept across updates).
    this.queue = new SyncQueue(deps.loginDb);
    this.cache = new KeyValueStore(deps.loginDb);
    this.texts = new AppTexts(this.cache, BUILT_IN_TEXTS);
    this.forms = new AppForms(this.cache, { [MSME_BASIC_INFO]: BUILT_IN_BASIC_INFO });
    this.environment = deps.environment;
    this.versionName = deps.versionName;
    this.api = deps.api ?? new MsmeApi(deps.environment, () => requestContext());
    this.tokens = new AppTokenStore(deps.loginDb);
    this.session = new AppSession(this.tokens);
    this.api.http.useSession(this.session);
  }

  static async open(openDatabase: (name: string) => SqlDb): Promise<MsmeApp> {
    const info = getAppInfo();
    const app = new MsmeApp({
      loginDb: openDatabase(LOGIN_DB_NAME),
      mediaDb: openDatabase(MEDIA_DB_NAME),
      environment: info.environment,
      versionName: info.versionName,
    });
    await app.init();
    return app;
  }

  async init(): Promise<void> {
    await this.loginStore.ensureSchema();
    await this.photos.ensureSchema();
    await this.queue.ensureSchema();
    await this.cache.ensureSchema();
    await this.tokens.ensureSchema();
    await this.texts.load();
    await this.forms.load([MSME_BASIC_INFO]);
    this._levels = await this.cache.get<PublicLevel[]>(LEVELS_KEY).catch(() => null);
  }

  get levels(): PublicLevel[] | null {
    return this._levels;
  }

  /** The enabled levels from the server; a failure keeps the last answer without a message. */
  async refreshLevels(): Promise<void> {
    try {
      const levels = await this.api.getPublicLevels();
      if (!Array.isArray(levels)) return;
      this._levels = levels;
      await this.cache.set(LEVELS_KEY, levels);
      this.touch();
    } catch {
      // offline or an older server: the last answer stays
    }
  }

  /**
   * Admin texts and the Basic Information form (docs/mobile/APP-TEXTS.md, APP-FORMS.md): asked at start and after
   * login; a failure keeps the last answer (or the built-in wording) without a message.
   */
  async refreshServerContent(): Promise<void> {
    await Promise.all([
      this.texts.refresh(() => this.api.getTexts()),
      this.forms.refresh(MSME_BASIC_INFO, () => this.api.getFormDefinition(MSME_BASIC_INFO)),
      this.refreshLevels(),
    ]);
  }

  // ----- state -----

  get user(): LoginResponse | null {
    return this._user;
  }

  /** MApplication.loginId(): the ZED ID the user signed in with. */
  get loginId(): string | null {
    return this._loginId;
  }

  get associatedId(): string | null {
    return associatedIdOf(this._user);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getRevision(): number {
    return this.revision;
  }

  /** Re-render the screens after an in-memory change. */
  touch(): void {
    this.revision++;
    for (const l of this.listeners) l();
  }

  /** startUserDataUpdate: saves the in-memory data (serialized, so saves never overtake each other). */
  persist(): Promise<void> {
    this.touch();
    const id = this._loginId;
    const data = this._user;
    if (!id || !data) return Promise.resolve();
    const snapshot = JSON.parse(JSON.stringify(data)) as LoginResponse;
    const p = this.persisting.then(() => this.loginStore.saveData(id, snapshot));
    this.persisting = p.catch(() => undefined);
    return p.then(() => undefined);
  }

  /** resetUser; the sign-in token is no longer sent (the stored one stays for an offline sign-in). */
  resetUser(): void {
    this._user = null;
    this._loginId = null;
    this.session.clear();
    this.touch();
  }

  // ----- sign in -----

  /**
   * LoginFragment's success branch: the first sign-in on this phone stores the response; later sign-ins keep the
   * local data (offline work) and only take the server's certification statuses (updateCertificationDetails).
   * The offline credential is refreshed with the password that just worked (stored as a hash).
   * New: the answer's `appToken` is kept apart (ZedAppToken), not in the stored sign-in response.
   */
  async onlineLoginSucceeded(username: string, password: string, response: LoginResponse, update: (local: LoginResponse, server: LoginResponse) => void) {
    const token = takeAppToken(response);
    normalizeLoginResponse(response);
    const existing = await this.loginStore.load(username);
    if (existing == null) {
      await this.loginStore.save(username, credentialToStore(password), response);
    } else {
      await this.loginStore.updateCredential(username, credentialToStore(password));
    }
    const local = normalizeLoginResponse((await this.loginStore.load(username))!);
    this._user = local;
    this._loginId = username;
    update(local, response);
    await this.session.signedIn(username, token);
    await this.persist();
  }

  /** LauncherActivity.handleOfflineLogin: stored credential (equals ignoring case) and stored data. */
  async offlineLogin(username: string, password: string): Promise<boolean> {
    const stored = await this.loginStore.credential(username);
    const data = await this.loginStore.load(username);
    const verdict = verifyCredential(stored, password);
    if (!verdict.ok || data == null) return false;
    if (verdict.upgrade) await this.loginStore.updateCredential(username, verdict.upgrade);
    // New: the token of this user's last online login, so that work sent when the connection returns carries it.
    await this.session.resumed(username);
    this._user = normalizeLoginResponse(data);
    this._loginId = username;
    this.touch();
    return true;
  }
}
