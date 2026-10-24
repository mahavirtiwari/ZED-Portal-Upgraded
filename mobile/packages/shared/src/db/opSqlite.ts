import { open } from '@op-engineering/op-sqlite';
import { SerializedDb, type SqlDb, type SqlResult, type SqlValue } from './types';

/**
 * Opens (or creates) a database in the app's databases folder (context.getDatabasePath), which is where the
 * legacy SQLiteOpenHelper and Room databases live: opening the legacy name reads the legacy data in place.
 */
export function openDatabase(name: string): SqlDb {
  const db = open({ name });
  return new SerializedDb({
    async run(sql: string, params: SqlValue[]): Promise<SqlResult> {
      const res = await db.execute(sql, params as never);
      return {
        rows: (res.rows ?? []) as SqlResult['rows'],
        rowsAffected: res.rowsAffected ?? 0,
        insertId: res.insertId,
      };
    },
    close() {
      db.close();
    },
  });
}
