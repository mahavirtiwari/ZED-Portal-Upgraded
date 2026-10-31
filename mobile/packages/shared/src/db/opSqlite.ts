import { isSQLCipher, open, type DB } from '@op-engineering/op-sqlite';
import { zedDevice } from '../native';
import { openEncrypted, type CipherEnv, type RawDb } from './encryptedDatabase';
import { SerializedDb, type SqlDb, type SqlResult, type SqlValue } from './types';

const cipherEnv: CipherEnv = {
  open(name, key) {
    const db: DB = open(key ? { name, encryptionKey: key } : { name });
    return {
      execute: (sql, params) => db.execute(sql, params as never) as unknown as ReturnType<RawDb['execute']>,
      close: () => db.close(),
    };
  },
  isSQLCipher,
  getDatabaseKey: () => zedDevice().getDatabaseKey(),
  getDatabaseFileState: name => zedDevice().getDatabaseFileState(name),
  getDatabasePath: name => zedDevice().getDatabasePath(name),
  deleteTempDatabase: name => zedDevice().deleteTempDatabase(name),
  replaceDatabaseWithEncrypted: (name, temp) => zedDevice().replaceDatabaseWithEncrypted(name, temp),
  moveDatabaseAside: (name, reason) => zedDevice().moveDatabaseAside(name, reason),
  log: message => console.warn('[ZED db] ' + message),
};

/**
 * Opens (or creates) a database in the app's databases folder (context.getDatabasePath), which is where the
 * legacy SQLiteOpenHelper and Room databases live: opening the legacy name reads the legacy data in place.
 *
 * New in V4: the file is a SQLCipher database with the install's key; a plain one is encrypted in place first
 * (db/encryptedDatabase.ts). That happens before the first statement runs, so the caller keeps a synchronous open.
 */
export function openDatabase(name: string): SqlDb {
  const ready = openEncrypted(cipherEnv, name);
  // A failure is reported by the first statement.
  ready.catch(() => undefined);
  return new SerializedDb({
    async run(sql: string, params: SqlValue[]): Promise<SqlResult> {
      const db = await ready;
      const res = (await db.execute(sql, params)) as { rows?: SqlResult['rows']; rowsAffected?: number; insertId?: number };
      return {
        rows: (res.rows ?? []) as SqlResult['rows'],
        rowsAffected: res.rowsAffected ?? 0,
        insertId: res.insertId,
      };
    },
    close() {
      ready.then(db => db.close()).catch(() => undefined);
    },
  });
}
