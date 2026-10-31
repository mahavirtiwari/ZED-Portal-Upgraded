import type { AppTokenSource } from '../api/http';
import { textOf, type SqlDb } from '../db/types';

/**
 * New in V4 (audit C1): the app sign-in token. Every successful login answers a top-level `appToken`; the app keeps it
 * with the signed-in user's data (in the app's encrypted database, table `ZedAppToken`, one row per user) and sends it
 * on every later call as the `X-Zed-App-Token` header (HttpClient.useSession).
 *
 * - Online login: the token of the answer replaces the stored one; an answer without a token (an older server)
 *   removes it and the app carries on without the header.
 * - Offline login: the token stored at the last online login of that user is used again, so that work sent when the
 *   connection returns carries it.
 * - A call refused with "Your sign-in has expired. Please sign in again." ends the session: the token is dropped
 *   (memory and store) and {@link expiredMessage} is set until the next sign-in; the app shows its login page with
 *   that text (SessionExpiryGate). Offline work stays on the phone and is sent after the next sign-in.
 * - Logout only forgets the token in memory; the stored one stays for a later offline sign-in.
 */
export class AppTokenStore {
  constructor(private readonly db: SqlDb) {}

  async ensureSchema(): Promise<void> {
    await this.db.execute('CREATE TABLE IF NOT EXISTS ZedAppToken (userId TEXT NOT NULL PRIMARY KEY, token TEXT NOT NULL, updatedOn INTEGER NOT NULL)');
  }

  async get(userId: string): Promise<string | null> {
    const r = await this.db.execute('SELECT token FROM ZedAppToken WHERE userId = ?', [userId]);
    return textOf(r.rows[0]?.token) || null;
  }

  /** Stores the token, or removes the stored one when there is none. */
  async set(userId: string, token: string | null): Promise<void> {
    if (!token) return this.remove(userId);
    await this.db.execute('INSERT OR REPLACE INTO ZedAppToken (userId, token, updatedOn) VALUES (?, ?, ?)', [userId, token, Date.now()]);
  }

  async remove(userId: string): Promise<void> {
    await this.db.execute('DELETE FROM ZedAppToken WHERE userId = ?', [userId]);
  }
}

export class AppSession implements AppTokenSource {
  private token: string | null = null;
  private user: string | null = null;
  private expired: string | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly store: AppTokenStore) {}

  /** The token sent with every call (null: no header). */
  get appToken(): string | null {
    return this.token;
  }

  /** The user the token belongs to (the key of the stored token). */
  get userId(): string | null {
    return this.user;
  }

  /** The server's text while the user has been signed out by it (until the next sign-in). */
  get expiredMessage(): string | null {
    return this.expired;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const l of this.listeners) l();
  }

  /** After an online login: keeps the answer's token (or none) for this user. */
  async signedIn(userId: string, token: string | null): Promise<void> {
    await this.store.set(userId, token);
    this.start(userId, token);
  }

  /** After an offline sign-in: the token stored at this user's last online login. */
  async resumed(userId: string): Promise<void> {
    this.start(userId, await this.store.get(userId));
  }

  private start(userId: string, token: string | null) {
    this.user = userId;
    this.token = token;
    this.expired = null;
    this.notify();
  }

  /** Logout / login page: the token is no longer sent (the stored one stays for an offline sign-in). */
  clear(): void {
    if (this.user == null && this.token == null) return;
    this.user = null;
    this.token = null;
    this.notify();
  }

  /**
   * The server refused the token. Without a signed-in user (a call before sign-in) nothing changes; otherwise the
   * stored token is removed and the app is told to show its login page.
   */
  expire(message: string): void {
    const user = this.user;
    if (user == null) return;
    this.user = null;
    this.token = null;
    this.expired = message;
    this.store.remove(user).catch(() => undefined);
    this.notify();
  }
}
