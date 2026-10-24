/** A minimal async SQLite interface: op-sqlite on the phone, sql.js in unit tests. */
export type SqlValue = string | number | null | Uint8Array | ArrayBuffer;

export type SqlRow = Record<string, SqlValue>;

export type SqlResult = {
  rows: SqlRow[];
  rowsAffected: number;
  insertId?: number;
};

export interface SqlExecutor {
  execute(sql: string, params?: SqlValue[]): Promise<SqlResult>;
}

export interface SqlDb extends SqlExecutor {
  /** Runs fn inside BEGIN/COMMIT (ROLLBACK on error); no other statement runs on this connection meanwhile. */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): void;
}

/** Raw driver: executes one statement. Serialization and transactions are added by {@link SerializedDb}. */
export interface SqlDriver {
  run(sql: string, params: SqlValue[]): Promise<SqlResult>;
  close(): void;
}

/** Serializes statements on one connection so that a transaction is never interleaved with other statements. */
export class SerializedDb implements SqlDb {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly driver: SqlDriver) {}

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job, job);
    this.tail = run.catch(() => undefined);
    return run;
  }

  execute(sql: string, params: SqlValue[] = []): Promise<SqlResult> {
    return this.enqueue(() => this.driver.run(sql, params));
  }

  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      const tx: SqlExecutor = { execute: (sql, params = []) => this.driver.run(sql, params) };
      await this.driver.run('BEGIN TRANSACTION', []);
      try {
        const result = await fn(tx);
        await this.driver.run('COMMIT', []);
        return result;
      } catch (e) {
        await this.driver.run('ROLLBACK', []).catch(() => undefined);
        throw e;
      }
    });
  }

  close(): void {
    this.driver.close();
  }
}

/** Reads a TEXT or BLOB column as a UTF-8 string (the legacy EncCred column holds a BLOB). */
export function textOf(value: SqlValue | undefined): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return utf8Decode(bytes);
}

export function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    let c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else {
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      c = 0;
    }
  }
  return new Uint8Array(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    let c: number;
    if (b < 0x80) {
      c = b;
      i += 1;
    } else if (b < 0xe0) {
      c = ((b & 31) << 6) | (bytes[i + 1]! & 63);
      i += 2;
    } else if (b < 0xf0) {
      c = ((b & 15) << 12) | ((bytes[i + 1]! & 63) << 6) | (bytes[i + 2]! & 63);
      i += 3;
    } else {
      c = ((b & 7) << 18) | ((bytes[i + 1]! & 63) << 12) | ((bytes[i + 2]! & 63) << 6) | (bytes[i + 3]! & 63);
      i += 4;
    }
    s += String.fromCodePoint(c);
  }
  return s;
}
