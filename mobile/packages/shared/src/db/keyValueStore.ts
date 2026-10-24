import { textOf, type SqlDb } from './types';

/**
 * New in the React Native apps: the last server answers kept for offline use (Admin texts, form definitions), as JSON
 * by key. The table lives next to the app's own data and is unknown to the legacy apps.
 */
export class KeyValueStore {
  constructor(private readonly db: SqlDb) {}

  async ensureSchema(): Promise<void> {
    await this.db.execute('CREATE TABLE IF NOT EXISTS ZedCache (key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL, updatedOn INTEGER NOT NULL)');
  }

  async get<T>(key: string): Promise<T | null> {
    const r = await this.db.execute('SELECT value FROM ZedCache WHERE key = ?', [key]);
    const text = r.rows[0] ? textOf(r.rows[0].value) : null;
    if (text == null) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.db.execute('INSERT OR REPLACE INTO ZedCache (key, value, updatedOn) VALUES (?, ?, ?)', [key, JSON.stringify(value), Date.now()]);
  }
}
