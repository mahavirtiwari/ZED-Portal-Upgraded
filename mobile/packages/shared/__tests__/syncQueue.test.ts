import { NetworkError } from '../src/api/http';
import { backoffMs, SyncQueue, type SyncJob } from '../src/sync/syncQueue';
import { memoryDb } from './helpers/sqljs';

async function setup() {
  const db = await memoryDb();
  let now = 1_000_000;
  const q = new SyncQueue(db, () => now);
  await q.ensureSchema();
  return { db, q, advance: (ms: number) => (now += ms) };
}

const job = (key: string, group = 'U1:Bronze') => ({ kind: 'evidence', key, group, userId: 'U1', label: key });

describe('SyncQueue', () => {
  it('sends pending jobs in insertion order and removes them when done', async () => {
    const { q } = await setup();
    const sent: string[] = [];
    q.register('evidence', async j => {
      sent.push(j.key);
      return { ok: true };
    });
    await q.enqueue(job('a'));
    await q.enqueue(job('b'));
    await q.enqueue(job('c'));
    const summary = await q.run();
    expect(sent).toEqual(['a', 'b', 'c']);
    expect(summary.sent.map(s => s.key)).toEqual(['a', 'b', 'c']);
    expect(await q.pendingCount()).toBe(0);
  });

  it('never duplicates: re-queuing the same key keeps one job in its original place', async () => {
    const { q } = await setup();
    await q.enqueue(job('a'));
    await q.enqueue(job('b'));
    await q.enqueue({ ...job('a'), label: 'a again', payload: { v: 2 } });
    const list = await q.list();
    expect(list.map(j => j.key)).toEqual(['a', 'b']);
    expect(list[0]!.label).toBe('a again');
    expect(list[0]!.payload).toEqual({ v: 2 });
  });

  it('keeps a job pending with back-off when the server cannot be reached, and stops the run', async () => {
    const { q, advance } = await setup();
    const calls: string[] = [];
    q.register('evidence', async j => {
      calls.push(j.key);
      throw new NetworkError('Network request failed');
    });
    await q.enqueue(job('a'));
    await q.enqueue(job('b', 'other group'));
    const s1 = await q.run();
    expect(s1.offline).toBe(true);
    expect(calls).toEqual(['a']); // stopped at the first network failure
    const a = (await q.get('a'))!;
    expect(a.status).toBe('pending');
    expect(a.attempts).toBe(1);
    expect(a.lastError).toBe('Network request failed');
    expect(a.nextAttemptAt).toBe(1_000_000 + backoffMs(1));

    // Before the back-off ends, an automatic run skips it; a forced run (Sync pressed) tries again.
    calls.length = 0;
    await q.run();
    expect(calls).toEqual(['b']);
    calls.length = 0;
    await q.run({ force: true });
    expect(calls[0]).toBe('a');
    advance(backoffMs(5));
  });

  it('marks a refused job failed, blocks later jobs of its group only, and retries on demand', async () => {
    const { q } = await setup();
    let refuse = true;
    const sent: string[] = [];
    q.register('evidence', async (j: SyncJob) => {
      if (j.key === 'a' && refuse) return { ok: false, error: 'Invalid Details.' };
      sent.push(j.key);
      return { ok: true };
    });
    await q.enqueue(job('a', 'g1'));
    await q.enqueue(job('b', 'g1'));
    await q.enqueue(job('c', 'g2'));
    const s = await q.run();
    expect(s.failed.map(f => [f.key, f.lastError])).toEqual([['a', 'Invalid Details.']]);
    expect(sent).toEqual(['c']);
    expect((await q.list()).map(j => [j.key, j.status])).toEqual([
      ['a', 'failed'],
      ['b', 'pending'],
    ]);
    // A failed job is not retried automatically...
    await q.run();
    expect(sent).toEqual(['c']);
    // ...until the user retries it.
    refuse = false;
    await q.retry('a');
    await q.run();
    expect(sent).toEqual(['c', 'a', 'b']);
    expect(await q.pendingCount()).toBe(0);
  });

  it('survives a restart: jobs stay, and a job interrupted while running is pending again', async () => {
    const { db, q } = await setup();
    await q.enqueue(job('a'));
    await db.execute(`UPDATE ZedSyncQueue SET status = 'running'`);
    const q2 = new SyncQueue(db);
    await q2.ensureSchema();
    expect((await q2.list()).map(j => j.status)).toEqual(['pending']);
  });

  it('runs only the signed-in user\'s jobs when a user is given', async () => {
    const { q } = await setup();
    const sent: string[] = [];
    q.register('evidence', async j => {
      sent.push(j.key);
      return { ok: true };
    });
    await q.enqueue(job('a'));
    await q.enqueue({ ...job('x'), userId: 'U2', group: 'U2:Bronze' });
    await q.run({ userId: 'U1' });
    expect(sent).toEqual(['a']);
    expect((await q.list()).map(j => j.userId)).toEqual(['U2']);
  });

  it('shares one run between concurrent callers', async () => {
    const { q } = await setup();
    let n = 0;
    q.register('evidence', async () => {
      n++;
      return { ok: true };
    });
    await q.enqueue(job('a'));
    await Promise.all([q.run(), q.run(), q.run()]);
    expect(n).toBe(1);
  });

  it('a handler without registration leaves the job pending', async () => {
    const { q } = await setup();
    await q.enqueue({ ...job('a'), kind: 'unknown' });
    const s = await q.run();
    expect(s.skipped).toBe(1);
    expect(await q.pendingCount()).toBe(1);
  });
});
