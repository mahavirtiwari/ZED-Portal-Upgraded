import { isNetworkError } from '../api/http';
import { textOf, type SqlDb, type SqlRow } from '../db/types';

/**
 * Offline sync queue.
 *
 * The legacy apps kept unsent work as statuses inside their local data (an evidence "COMPLETED" but not "SUBMITTED",
 * basic information not yet "SUBMITTED", ...) and the user had to press Sync/Submit while online. The queue keeps the
 * same local data as the source of truth and adds what was missing: every pending send is recorded, sent
 * automatically when the connection returns (and on demand), in order, with retries, without duplicates, and the
 * user can see what is pending and what failed.
 *
 * - A job names *what* to send (`kind` + `key`), never a copy of the data: the handler reads the current local data
 *   when it runs, so re-queuing the same item (same dedupe key) never sends it twice.
 * - Jobs run in insertion order. A job that fails stops later jobs of the same `group` (for example one unit and
 *   certification), because they may depend on it (basic information before evidences).
 * - No answer from the server (no network, timeout): the job stays pending, the run stops, and it is retried with
 *   back-off and whenever the connection returns.
 * - A refusal from the server (status "0", HTTP error): the job is marked failed with the server's message and is
 *   not retried automatically; the user retries it (or fixes the data first).
 * - The table lives in the app's own database, so pending jobs survive restarts and app updates.
 */

export type SyncStatus = 'pending' | 'running' | 'failed' | 'done';

export type SyncJob = {
  id: number;
  kind: string;
  key: string;
  group: string;
  userId: string;
  label: string;
  payload: Record<string, unknown>;
  status: SyncStatus;
  attempts: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  nextAttemptAt: number;
};

/** What a handler reports: done, or refused by the server with a message. Throwing a NetworkError means "retry later". */
export type HandlerResult = { ok: true; message?: string } | { ok: false; error: string };

export type SyncHandler = (job: SyncJob) => Promise<HandlerResult>;

export type EnqueueInput = {
  kind: string;
  key: string;
  group: string;
  userId: string;
  label: string;
  payload?: Record<string, unknown>;
};

export type RunSummary = {
  sent: SyncJob[];
  failed: SyncJob[];
  /** Stopped because the server could not be reached. */
  offline: boolean;
  skipped: number;
};

export const SYNC_TABLE = 'ZedSyncQueue';

const DDL = `CREATE TABLE IF NOT EXISTS ${SYNC_TABLE} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  dedupeKey TEXT NOT NULL UNIQUE,
  groupKey TEXT NOT NULL,
  userId TEXT NOT NULL,
  label TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lastError TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  nextAttemptAt INTEGER NOT NULL DEFAULT 0
)`;

/** Back-off after a network failure: 15 s, 30 s, 1 min, 2 min, ... capped at 15 minutes. */
export function backoffMs(attempts: number): number {
  return Math.min(15_000 * Math.pow(2, Math.max(0, attempts - 1)), 15 * 60_000);
}

function rowToJob(r: SqlRow): SyncJob {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(textOf(r.payload) ?? '{}');
  } catch {
    payload = {};
  }
  return {
    id: Number(r.id),
    kind: textOf(r.kind) ?? '',
    key: textOf(r.dedupeKey) ?? '',
    group: textOf(r.groupKey) ?? '',
    userId: textOf(r.userId) ?? '',
    label: textOf(r.label) ?? '',
    payload,
    status: (textOf(r.status) ?? 'pending') as SyncStatus,
    attempts: Number(r.attempts ?? 0),
    lastError: textOf(r.lastError),
    createdAt: Number(r.createdAt ?? 0),
    updatedAt: Number(r.updatedAt ?? 0),
    nextAttemptAt: Number(r.nextAttemptAt ?? 0),
  };
}

export class SyncQueue {
  private readonly handlers = new Map<string, SyncHandler>();
  private readonly listeners = new Set<() => void>();
  private running: Promise<RunSummary> | null = null;

  constructor(private readonly db: SqlDb, private readonly now: () => number = Date.now) {}

  async ensureSchema(): Promise<void> {
    await this.db.execute(DDL);
    // A job left "running" by a crash or a killed app is pending again.
    await this.db.execute(`UPDATE ${SYNC_TABLE} SET status = 'pending' WHERE status = 'running'`);
  }

  register(kind: string, handler: SyncHandler): void {
    this.handlers.set(kind, handler);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  /**
   * Adds a job, or, when a job with the same key exists and is not done, keeps its place in the queue and refreshes
   * its label/payload and makes it pending again (a failed job is retried with the new data).
   */
  async enqueue(input: EnqueueInput): Promise<SyncJob> {
    const t = this.now();
    const payload = JSON.stringify(input.payload ?? {});
    const existing = await this.db.execute(`SELECT * FROM ${SYNC_TABLE} WHERE dedupeKey = ?`, [input.key]);
    const row = existing.rows[0];
    if (row && textOf(row.status) !== 'done') {
      await this.db.execute(
        `UPDATE ${SYNC_TABLE} SET label = ?, payload = ?, status = 'pending', nextAttemptAt = 0, updatedAt = ? WHERE id = ?`,
        [input.label, payload, t, Number(row.id)],
      );
    } else {
      if (row) await this.db.execute(`DELETE FROM ${SYNC_TABLE} WHERE id = ?`, [Number(row.id)]);
      await this.db.execute(
        `INSERT INTO ${SYNC_TABLE} (kind, dedupeKey, groupKey, userId, label, payload, status, attempts, lastError, createdAt, updatedAt, nextAttemptAt)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?, 0)`,
        [input.kind, input.key, input.group, input.userId, input.label, payload, t, t],
      );
    }
    this.notify();
    return (await this.get(input.key))!;
  }

  async get(key: string): Promise<SyncJob | null> {
    const res = await this.db.execute(`SELECT * FROM ${SYNC_TABLE} WHERE dedupeKey = ?`, [key]);
    return res.rows[0] ? rowToJob(res.rows[0]) : null;
  }

  /** Pending and failed jobs (not done), in queue order; optionally for one user. */
  async list(userId?: string): Promise<SyncJob[]> {
    const res = userId
      ? await this.db.execute(`SELECT * FROM ${SYNC_TABLE} WHERE status != 'done' AND userId = ? ORDER BY id`, [userId])
      : await this.db.execute(`SELECT * FROM ${SYNC_TABLE} WHERE status != 'done' ORDER BY id`);
    return res.rows.map(rowToJob);
  }

  async pendingCount(userId?: string): Promise<number> {
    return (await this.list(userId)).length;
  }

  /** Removes a job without sending it (the local data itself is kept; it can be queued again from its screen). */
  async remove(key: string): Promise<void> {
    await this.db.execute(`DELETE FROM ${SYNC_TABLE} WHERE dedupeKey = ?`, [key]);
    this.notify();
  }

  /** Makes a failed job pending again. */
  async retry(key: string): Promise<void> {
    await this.db.execute(
      `UPDATE ${SYNC_TABLE} SET status = 'pending', nextAttemptAt = 0, updatedAt = ? WHERE dedupeKey = ? AND status = 'failed'`,
      [this.now(), key],
    );
    this.notify();
  }

  async retryAllFailed(userId?: string): Promise<void> {
    if (userId) {
      await this.db.execute(`UPDATE ${SYNC_TABLE} SET status = 'pending', nextAttemptAt = 0 WHERE status = 'failed' AND userId = ?`, [userId]);
    } else {
      await this.db.execute(`UPDATE ${SYNC_TABLE} SET status = 'pending', nextAttemptAt = 0 WHERE status = 'failed'`);
    }
    this.notify();
  }

  /** Drops finished jobs (kept only for the run that sent them). */
  async purgeDone(): Promise<void> {
    await this.db.execute(`DELETE FROM ${SYNC_TABLE} WHERE status = 'done'`);
  }

  /**
   * Sends what is due. Concurrent calls share one run. `force` ignores back-off times (the user pressed Sync).
   * Only jobs of `userId` run when given (the signed-in user; other users' jobs wait for their next sign-in).
   */
  run(options: { userId?: string; force?: boolean } = {}): Promise<RunSummary> {
    if (!this.running) {
      this.running = this.runOnce(options).finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  get isRunning(): boolean {
    return this.running != null;
  }

  private async runOnce({ userId, force = false }: { userId?: string; force?: boolean }): Promise<RunSummary> {
    const summary: RunSummary = { sent: [], failed: [], offline: false, skipped: 0 };
    const blockedGroups = new Set<string>();
    const jobs = await this.list(userId);
    for (const job of jobs) {
      if (job.status === 'failed') {
        blockedGroups.add(job.group);
        continue;
      }
      if (blockedGroups.has(job.group)) {
        summary.skipped++;
        continue;
      }
      if (!force && job.nextAttemptAt > this.now()) {
        blockedGroups.add(job.group);
        summary.skipped++;
        continue;
      }
      const handler = this.handlers.get(job.kind);
      if (!handler) {
        blockedGroups.add(job.group);
        summary.skipped++;
        continue;
      }
      await this.db.execute(`UPDATE ${SYNC_TABLE} SET status = 'running', attempts = attempts + 1, updatedAt = ? WHERE id = ?`, [this.now(), job.id]);
      this.notify();
      let result: HandlerResult;
      try {
        result = await handler({ ...job, attempts: job.attempts + 1 });
      } catch (e) {
        if (isNetworkError(e)) {
          const attempts = job.attempts + 1;
          await this.db.execute(
            `UPDATE ${SYNC_TABLE} SET status = 'pending', lastError = ?, nextAttemptAt = ?, updatedAt = ? WHERE id = ?`,
            [e instanceof Error ? e.message : String(e), this.now() + backoffMs(attempts), this.now(), job.id],
          );
          summary.offline = true;
          this.notify();
          break;
        }
        result = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      if (result.ok) {
        await this.db.execute(`UPDATE ${SYNC_TABLE} SET status = 'done', lastError = NULL, updatedAt = ? WHERE id = ?`, [this.now(), job.id]);
        summary.sent.push({ ...job, status: 'done' });
      } else {
        await this.db.execute(`UPDATE ${SYNC_TABLE} SET status = 'failed', lastError = ?, updatedAt = ? WHERE id = ?`, [result.error, this.now(), job.id]);
        summary.failed.push({ ...job, status: 'failed', lastError: result.error });
        blockedGroups.add(job.group);
      }
      this.notify();
    }
    await this.purgeDone();
    this.notify();
    return summary;
  }
}
