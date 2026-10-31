import { APP_TOKEN_HEADER, HttpClient, isNetworkError, isSessionExpired, SessionExpiredError } from '../src/api/http';
import { SESSION_EXPIRED_MESSAGE, takeAppToken } from '../src/api/legacy';
import { AppSession, AppTokenStore } from '../src/auth/appSession';
import { SyncQueue } from '../src/sync/syncQueue';
import { memoryDb } from './helpers/sqljs';

const answer = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 300, status, statusText: '', text: () => Promise.resolve(JSON.stringify(body)) } as Response);

async function session() {
  const db = await memoryDb();
  const store = new AppTokenStore(db);
  await store.ensureSchema();
  return { store, session: new AppSession(store) };
}

describe('app sign-in token (audit C1)', () => {
  it('takes the token out of the login answer; none from an older server', () => {
    const r: { status: string; appToken?: string } = { status: '1', appToken: 'h1.abc' };
    expect(takeAppToken(r)).toBe('h1.abc');
    expect(r).toEqual({ status: '1' });
    expect(takeAppToken({ status: '1' })).toBeNull();
    expect(takeAppToken({ status: '1', appToken: ' ' })).toBeNull();
  });

  it('sends the header on JSON and multipart calls only while there is a token', async () => {
    const { session: s } = await session();
    const fetchImpl = jest.fn((_url: string, _init?: RequestInit) => answer({ status: '1' }));
    const c = new HttpClient({ fetchImpl });
    c.useSession(s);
    await c.postJson('https://h/x', {});
    await s.signedIn('U1', 'tok');
    await c.postJson('https://h/x', {});
    await c.postMultipart('https://h/x', [{ name: 'a', value: 'b' }]);
    const headers = fetchImpl.mock.calls.map(([, init]) => (init!.headers as Record<string, string>)[APP_TOKEN_HEADER]);
    expect(headers).toEqual([undefined, 'tok', 'tok']);
  });

  it('ends the session on the expired text, with status 200 or an HTTP error, and fails the call as unsent', async () => {
    for (const status of [200, 401]) {
      const { store, session: s } = await session();
      await s.signedIn('U1', 'tok');
      const c = new HttpClient({ fetchImpl: () => answer({ status: '0', errorMessage: SESSION_EXPIRED_MESSAGE }, status) });
      c.useSession(s);
      const e = (await c.postJson('https://h/x', {}).catch(x => x)) as Error;
      expect(e).toBeInstanceOf(SessionExpiredError);
      expect(isSessionExpired(e)).toBe(true);
      // Kept like a call without an answer by the screens and the queue.
      expect(isNetworkError(e)).toBe(true);
      expect(e.message).toBe(SESSION_EXPIRED_MESSAGE);
      expect(s.expiredMessage).toBe(SESSION_EXPIRED_MESSAGE);
      expect(s.appToken).toBeNull();
      await new Promise(r => setTimeout(r, 0));
      expect(await store.get('U1')).toBeNull();
    }
  });

  it('a refusal before sign-in does not show the expired page; other refusals are untouched', async () => {
    const { session: s } = await session();
    const c = new HttpClient({ fetchImpl: () => answer({ status: '0', errorMessage: SESSION_EXPIRED_MESSAGE }) });
    c.useSession(s);
    await expect(c.getJson('https://h/x')).rejects.toBeInstanceOf(SessionExpiredError);
    expect(s.expiredMessage).toBeNull();
    const other = new HttpClient({ fetchImpl: () => answer({ status: '0', errorMessage: 'Invalid Details.' }) });
    other.useSession(s);
    expect(await other.postJson('https://h/x', {})).toEqual({ status: '0', errorMessage: 'Invalid Details.' });
  });

  it('logout keeps the stored token for an offline sign-in; the next sign-in clears the expired state', async () => {
    const { store, session: s } = await session();
    await s.signedIn('U1', 'tok');
    s.clear();
    expect(s.appToken).toBeNull();
    await s.resumed('U1');
    expect(s.appToken).toBe('tok');
    s.expire(SESSION_EXPIRED_MESSAGE);
    expect(s.expiredMessage).toBe(SESSION_EXPIRED_MESSAGE);
    await s.signedIn('U1', null);
    expect(s.expiredMessage).toBeNull();
    expect(await store.get('U1')).toBeNull();
  });

  it('the sync queue keeps a job pending, without back-off, when the sign-in has expired', async () => {
    const db = await memoryDb();
    const q = new SyncQueue(db, () => 1000);
    await q.ensureSchema();
    q.register('k', async () => {
      throw new SessionExpiredError();
    });
    await q.enqueue({ kind: 'k', key: 'a', group: 'g', userId: 'U1', label: 'A' });
    await q.enqueue({ kind: 'k', key: 'b', group: 'h', userId: 'U1', label: 'B' });
    const s = await q.run();
    expect(s.signedOut).toBe(true);
    expect(s.offline).toBe(false);
    const a = (await q.get('a'))!;
    expect(a).toMatchObject({ status: 'pending', attempts: 0, nextAttemptAt: 0, lastError: SESSION_EXPIRED_MESSAGE });
    // The run stopped at the first refusal.
    expect((await q.get('b'))!.attempts).toBe(0);
  });
});
