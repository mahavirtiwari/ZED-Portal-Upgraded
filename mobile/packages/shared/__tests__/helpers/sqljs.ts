import initSqlJs from 'sql.js';
import { SerializedDb, type SqlDb, type SqlValue } from '../../src/db/types';

/** A real SQLite (sql.js, WebAssembly) behind the same interface as op-sqlite on the phone. */
export async function memoryDb(): Promise<SqlDb & { raw: import('sql.js').Database }> {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();
  const db = new SerializedDb({
    async run(sql: string, params: SqlValue[]) {
      const stmt = raw.prepare(sql);
      try {
        stmt.bind(params.map(p => (p instanceof ArrayBuffer ? new Uint8Array(p) : p)) as never);
        const rows: Record<string, SqlValue>[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, SqlValue>);
        const rowsAffected = raw.getRowsModified();
        const id = raw.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0];
        return { rows, rowsAffected, insertId: typeof id === 'number' ? id : undefined };
      } finally {
        stmt.free();
      }
    },
    close() {
      raw.close();
    },
  });
  return Object.assign(db, { raw });
}
