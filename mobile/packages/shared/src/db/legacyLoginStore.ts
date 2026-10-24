import { textOf, utf8Encode, type SqlDb } from './types';

/**
 * The legacy login table (MSME code base database/DBHelper + LoginDataAccessObject): one row per user with the
 * credential column and the whole sign-in response as JSON, which is also where the app keeps its offline work.
 *
 *   create table if not exists LoginData(UserName text, EncCred text, LoginData text, PRIMARY KEY (UserName))
 *
 * Table and column names are parameters so that other apps can map their own legacy tables the same way.
 */
export type LegacyLoginTable = {
  table: string;
  userColumn: string;
  credentialColumn: string;
  dataColumn: string;
};

export const MSME_LOGIN_TABLE: LegacyLoginTable = {
  table: 'LoginData',
  userColumn: 'UserName',
  credentialColumn: 'EncCred',
  dataColumn: 'LoginData',
};

export class LegacyLoginStore<T> {
  constructor(private readonly db: SqlDb, private readonly t: LegacyLoginTable = MSME_LOGIN_TABLE) {}

  async ensureSchema(): Promise<void> {
    const { table, userColumn, credentialColumn, dataColumn } = this.t;
    await this.db.execute(
      `create table if not exists ${table}(${userColumn} text, ${credentialColumn} text, ${dataColumn} text,  PRIMARY KEY (${userColumn}));`,
    );
  }

  /** createOrReplaceData: the credential is stored as a BLOB, as the legacy code did. */
  async save(userId: string, credential: string, data: T): Promise<boolean> {
    if (data == null) return false;
    const { table, userColumn, credentialColumn, dataColumn } = this.t;
    const res = await this.db.execute(
      `INSERT OR REPLACE INTO ${table} (${userColumn}, ${credentialColumn}, ${dataColumn}) VALUES (?, ?, ?)`,
      [userId, utf8Encode(credential), JSON.stringify(data)],
    );
    return res.rowsAffected > 0;
  }

  /** getLoginData: null when there is no row or the JSON cannot be read (GsonProvider.jsonToObject). */
  async load(userId: string): Promise<T | null> {
    const { table, userColumn, dataColumn } = this.t;
    const res = await this.db.execute(`SELECT ${dataColumn} AS d FROM ${table} WHERE ${userColumn} = ?`, [userId]);
    const text = textOf(res.rows[0]?.d);
    if (!text) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  /** getPassword: the stored credential (legacy: the password itself; new rows: a hash, see auth/passwords). */
  async credential(userId: string): Promise<string | null> {
    const { table, userColumn, credentialColumn } = this.t;
    const res = await this.db.execute(`SELECT ${credentialColumn} AS c FROM ${table} WHERE ${userColumn} = ?`, [userId]);
    return textOf(res.rows[0]?.c);
  }

  async updateCredential(userId: string, credential: string): Promise<void> {
    const { table, userColumn, credentialColumn } = this.t;
    await this.db.execute(`UPDATE ${table} SET ${credentialColumn} = ? WHERE ${userColumn} = ?`, [utf8Encode(credential), userId]);
  }

  async remove(userId: string): Promise<boolean> {
    const { table, userColumn } = this.t;
    const res = await this.db.execute(`DELETE FROM ${table} WHERE ${userColumn} = ?`, [userId]);
    return res.rowsAffected > 0;
  }

  async users(): Promise<string[]> {
    const { table, userColumn } = this.t;
    const res = await this.db.execute(`SELECT ${userColumn} AS u FROM ${table}`);
    return res.rows.map(r => textOf(r.u) ?? '').filter(Boolean);
  }
}
