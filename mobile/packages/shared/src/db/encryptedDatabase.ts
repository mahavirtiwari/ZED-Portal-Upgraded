/**
 * New in V4 (audit, Low "offline data on the phone is not encrypted"): the app databases are SQLCipher databases.
 *
 * - The key is random per install (32 bytes), made by the native module and kept wrapped by an Android Keystore key
 *   (`getDatabaseKey`); it is never in the code. It is used as a raw key (`x'…'`), so opening needs no key derivation.
 * - The databases keep their legacy names in the app's databases folder. A plain one (a legacy SQLite/Room file opened
 *   in place, or one written by an earlier build of this app) is encrypted in place at the first start:
 *     1. the plain file is checkpointed (Room's WAL folded into the file) and switched to a rollback journal;
 *     2. `sqlcipher_export` copies it into `<name>.zedenc-tmp`, with `user_version`;
 *     3. the copy is opened with the key and every table's row count compared with the plain file;
 *     4. the copy atomically replaces the plain file (rename), whose leftover `-shm` / empty `-wal` are removed first.
 *   Any failure before step 4 leaves the plain file as it was (the copy is removed at the next start), the app works
 *   on the plain file this time and the migration is tried again at the next start. Nothing pending is lost: at every
 *   moment the file under the legacy name is either the whole plain database or its verified encrypted copy.
 * - An encrypted file the key cannot open (the Keystore key was lost, which Android does only with the app's data) is
 *   renamed aside (`<name>.unreadable-<time>`), never deleted, and an empty database is started.
 */

/** What the migration needs from SQLite (op-sqlite on the phone, a fake in the tests). */
export type RawDb = {
  execute(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  close(): void;
};

/** The native file helpers (ZedDevice) and the SQLite opener. */
export type CipherEnv = {
  /** Opens databases/<name>, with the SQLCipher key when given. */
  open(name: string, key?: string): RawDb;
  /** True when the SQLite library is SQLCipher (op-sqlite's isSQLCipher). */
  isSQLCipher(): boolean;
  getDatabaseKey(): string;
  /** 'missing' | 'plain' | 'encrypted' */
  getDatabaseFileState(name: string): string;
  getDatabasePath(name: string): string;
  deleteTempDatabase(name: string): void;
  replaceDatabaseWithEncrypted(name: string, tempName: string): void;
  moveDatabaseAside(name: string, reason: string): string;
  log?(message: string): void;
};

export const TEMP_SUFFIX = '.zedenc-tmp';

/** The SQLCipher raw key literal of a 64-hex key. */
export function rawKey(hex: string): string {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('Invalid database key');
  return `x'${hex}'`;
}

const quoteId = (name: string) => '"' + name.replace(/"/g, '""') + '"';

async function tableCounts(db: RawDb): Promise<Map<string, number>> {
  const tables = await db.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const counts = new Map<string, number>();
  for (const t of tables.rows) {
    const name = String(t.name);
    const r = await db.execute(`SELECT count(*) AS n FROM ${quoteId(name)}`);
    counts.set(name, Number(r.rows[0]?.n ?? -1));
  }
  return counts;
}

function sameCounts(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/** Steps 1-4 above. Throws (leaving the plain file untouched) when anything does not check out. */
export async function encryptInPlace(env: CipherEnv, name: string, key: string): Promise<void> {
  const temp = name + TEMP_SUFFIX;
  env.deleteTempDatabase(temp);
  let counts: Map<string, number>;
  const plain = env.open(name);
  try {
    await plain.execute('PRAGMA wal_checkpoint(TRUNCATE)');
    await plain.execute('PRAGMA journal_mode = DELETE');
    counts = await tableCounts(plain);
    const version = Number((await plain.execute('PRAGMA user_version')).rows[0]?.user_version ?? 0);
    await plain.execute('ATTACH DATABASE ? AS zedenc KEY ?', [env.getDatabasePath(temp), key]);
    try {
      await plain.execute("SELECT sqlcipher_export('zedenc')");
      await plain.execute(`PRAGMA zedenc.user_version = ${Math.trunc(version) || 0}`);
    } finally {
      await plain.execute('DETACH DATABASE zedenc');
    }
  } finally {
    plain.close();
  }
  const copy = env.open(temp, key);
  let copied: Map<string, number>;
  try {
    copied = await tableCounts(copy);
  } finally {
    copy.close();
  }
  if (!sameCounts(counts, copied)) {
    env.deleteTempDatabase(temp);
    throw new Error('The encrypted copy of ' + name + ' does not match');
  }
  env.replaceDatabaseWithEncrypted(name, temp);
}

async function readable(db: RawDb): Promise<boolean> {
  try {
    await db.execute('SELECT count(*) AS n FROM sqlite_master');
    return true;
  } catch {
    return false;
  }
}

/** Opens databases/<name> encrypted, encrypting a plain file first (see above). */
export async function openEncrypted(env: CipherEnv, name: string): Promise<RawDb> {
  if (!env.isSQLCipher()) {
    // A build without SQLCipher (package.json "op-sqlite": {"sqlcipher": true} missing) cannot encrypt: keep working.
    env.log?.(`SQLCipher is not built in: ${name} stays unencrypted`);
    return env.open(name);
  }
  const key = rawKey(env.getDatabaseKey());
  const state = env.getDatabaseFileState(name);
  if (state === 'plain') {
    try {
      await encryptInPlace(env, name, key);
    } catch (e) {
      env.log?.(`Encrypting ${name} failed, kept unencrypted until the next start: ${e instanceof Error ? e.message : String(e)}`);
      return env.open(name);
    }
  }
  const db = env.open(name, key);
  if (await readable(db)) return db;
  db.close();
  if (state === 'missing') throw new Error('Cannot create the database ' + name);
  const aside = env.moveDatabaseAside(name, 'unreadable');
  env.log?.(`${name} cannot be opened with this install's key; kept as ${aside}, starting empty`);
  const fresh = env.open(name, key);
  if (!(await readable(fresh))) throw new Error('Cannot create the database ' + name);
  return fresh;
}
