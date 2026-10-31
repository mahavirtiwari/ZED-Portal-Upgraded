import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { openEncrypted, rawKey, TEMP_SUFFIX, type CipherEnv, type RawDb } from '../src/db/encryptedDatabase';

/**
 * A fake phone: the databases folder as a map of files, each a sql.js database that is either plain or "encrypted"
 * with a key (opening it with another key, or without one, fails like SQLCipher: "file is not a database").
 * ATTACH ... KEY and sqlcipher_export are played on these files; the native helpers are the file operations.
 */
type FakeFile = { db: Database; key: string | null; wal?: number };

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs();
});

const KEY_HEX = 'ab'.repeat(32);

function fakePhone(options: { failExport?: boolean; failReplace?: boolean; dropRowsInCopy?: boolean } = {}) {
  const files = new Map<string, FakeFile>();
  const logs: string[] = [];
  let keyHex = KEY_HEX;
  const openDb = (name: string, key?: string): RawDb => {
    let file = files.get(name);
    if (!file) {
      file = { db: new SQL.Database(), key: key ?? null };
      files.set(name, file);
    }
    const f = file;
    let attached: { path: string; key: string } | null = null;
    const check = () => {
      if ((f.key ?? null) !== (key ?? null)) throw new Error('file is not a database');
    };
    return {
      async execute(sql: string, params: unknown[] = []) {
        check();
        const s = sql.trim();
        if (/^ATTACH DATABASE \? AS zedenc KEY \?$/.test(s)) {
          attached = { path: String(params[0]), key: String(params[1]) };
          return { rows: [] };
        }
        if (s === "SELECT sqlcipher_export('zedenc')") {
          if (options.failExport) throw new Error('disk I/O error');
          const copy = new SQL.Database(f.db.export());
          if (options.dropRowsInCopy) copy.run('DELETE FROM LoginData');
          files.set(attached!.path.replace('/data/databases/', ''), { db: copy, key: attached!.key });
          return { rows: [] };
        }
        if (s.startsWith('PRAGMA zedenc.user_version')) {
          const target = files.get(attached!.path.replace('/data/databases/', ''))!;
          target.db.run(s.replace('zedenc.', ''));
          return { rows: [] };
        }
        if (s === 'DETACH DATABASE zedenc') {
          attached = null;
          return { rows: [] };
        }
        if (s.startsWith('PRAGMA wal_checkpoint')) {
          f.wal = 0;
          return { rows: [] };
        }
        const stmt = f.db.prepare(s);
        try {
          stmt.bind(params as never);
          const rows: Array<Record<string, unknown>> = [];
          while (stmt.step()) rows.push(stmt.getAsObject());
          return { rows };
        } finally {
          stmt.free();
        }
      },
      close() {},
    };
  };
  const env: CipherEnv = {
    open: openDb,
    isSQLCipher: () => true,
    getDatabaseKey: () => keyHex,
    getDatabaseFileState: name => {
      const f = files.get(name);
      return !f ? 'missing' : f.key == null ? 'plain' : 'encrypted';
    },
    getDatabasePath: name => '/data/databases/' + name,
    deleteTempDatabase: name => {
      if (!name.endsWith(TEMP_SUFFIX)) throw new Error('not a temp');
      files.delete(name);
    },
    replaceDatabaseWithEncrypted: (name, temp) => {
      if (options.failReplace) throw new Error('Exception in HostFunction: rename failed');
      if (files.get(name)?.wal) throw new Error('still has a journal');
      files.set(name, files.get(temp)!);
      files.delete(temp);
    },
    moveDatabaseAside: (name, reason) => {
      const aside = `${name}.${reason}-1`;
      files.set(aside, files.get(name)!);
      files.delete(name);
      return aside;
    },
    log: m => logs.push(m),
  };
  return { env, files, logs, setKey: (k: string) => (keyHex = k) };
}

/** A legacy QCI_MSME_DB written by the old app (plain SQLite, pending work inside). */
function legacyPlainDb(): FakeFile {
  const db = new SQL.Database();
  db.run('create table if not exists LoginData(UserName text, EncCred text, LoginData text,  PRIMARY KEY (UserName));');
  db.run("INSERT INTO LoginData VALUES ('ZEDRNTEST0001', 'Secret1', '{\"evidence\":\"COMPLETED\"}')");
  db.run('CREATE TABLE android_metadata (locale TEXT)');
  db.run("INSERT INTO android_metadata VALUES ('en_US')");
  db.run('PRAGMA user_version = 3');
  return { db, key: null, wal: 1 };
}

const pending = async (db: RawDb) => (await db.execute('SELECT LoginData AS d FROM LoginData')).rows.map(r => r.d);

describe('encrypted databases (SQLCipher, key per install)', () => {
  it('uses the key as a raw SQLCipher key, never a passphrase', () => {
    expect(rawKey(KEY_HEX)).toBe(`x'${KEY_HEX}'`);
    expect(() => rawKey("abc'; ATTACH")).toThrow();
  });

  it('encrypts a legacy plain file in place: same name, same rows and user_version, nothing left behind', async () => {
    const phone = fakePhone();
    phone.files.set('QCI_MSME_DB', legacyPlainDb());
    const db = await openEncrypted(phone.env, 'QCI_MSME_DB');
    expect(phone.files.get('QCI_MSME_DB')!.key).toBe(rawKey(KEY_HEX));
    expect([...phone.files.keys()]).toEqual(['QCI_MSME_DB']);
    expect(await pending(db)).toEqual(['{"evidence":"COMPLETED"}']);
    expect((await db.execute('PRAGMA user_version')).rows[0]!.user_version).toBe(3);
    // The next start opens it encrypted without migrating again.
    const again = await openEncrypted(phone.env, 'QCI_MSME_DB');
    expect(await pending(again)).toEqual(['{"evidence":"COMPLETED"}']);
    expect(phone.logs).toEqual([]);
  });

  it('creates a new database encrypted', async () => {
    const phone = fakePhone();
    const db = await openEncrypted(phone.env, 'ZED_MSME_Media_DB');
    await db.execute('CREATE TABLE t (a)');
    expect(phone.files.get('ZED_MSME_Media_DB')!.key).toBe(rawKey(KEY_HEX));
  });

  it.each([
    ['the export fails', { failExport: true }],
    ['the copy does not match', { dropRowsInCopy: true }],
    ['the file cannot be replaced', { failReplace: true }],
  ])('keeps the plain file and works on it when %s, and tries again at the next start', async (_what, failure) => {
    const phone = fakePhone(failure);
    const plain = legacyPlainDb();
    phone.files.set('QCI_MSME_DB', plain);
    const db = await openEncrypted(phone.env, 'QCI_MSME_DB');
    expect(phone.files.get('QCI_MSME_DB')).toBe(plain);
    expect(plain.key).toBeNull();
    expect(await pending(db)).toEqual(['{"evidence":"COMPLETED"}']);
    expect(phone.logs[0]).toContain('kept unencrypted until the next start');

    // Next start, the cause is gone: migrated, the copy of the failed run does not get in the way.
    const next = fakePhone();
    for (const [k, v] of phone.files) next.files.set(k, v);
    const db2 = await openEncrypted(next.env, 'QCI_MSME_DB');
    expect(next.files.get('QCI_MSME_DB')!.key).toBe(rawKey(KEY_HEX));
    expect([...next.files.keys()]).toEqual(['QCI_MSME_DB']);
    expect(await pending(db2)).toEqual(['{"evidence":"COMPLETED"}']);
  });

  it('moves a file the key cannot open aside (never deletes it) and starts empty', async () => {
    const phone = fakePhone();
    phone.files.set('QCI_MSME_DB', legacyPlainDb());
    await openEncrypted(phone.env, 'QCI_MSME_DB');
    phone.setKey('cd'.repeat(32));
    const db = await openEncrypted(phone.env, 'QCI_MSME_DB');
    expect(phone.files.has('QCI_MSME_DB.unreadable-1')).toBe(true);
    expect((await db.execute("SELECT name FROM sqlite_master WHERE name = 'LoginData'")).rows).toEqual([]);
  });

  it('opens plain (and says so) when the build has no SQLCipher', async () => {
    const phone = fakePhone();
    phone.env.isSQLCipher = () => false;
    phone.files.set('QCI_MSME_DB', legacyPlainDb());
    const db = await openEncrypted(phone.env, 'QCI_MSME_DB');
    expect(await pending(db)).toEqual(['{"evidence":"COMPLETED"}']);
    expect(phone.logs[0]).toContain('SQLCipher is not built in');
  });
});
