import { APP_TOKEN_HEADER, SESSION_EXPIRED_MESSAGE } from '@zed/shared';
import { certificationDetailsOf, Status, type LoginResponse } from '../src/models';
import { queueOutstanding } from '../src/sync/queue';
import { FakeServer, makeApp } from './helpers/harness';
import { memoryDb } from './helpers/sqljs';
import { legacyLoginResponse, writeLegacyLoginRow, writeLegacyPhotoRows, ZED_ID } from './helpers/legacyFixture';

async function legacyDatabases() {
  const loginDb = await memoryDb();
  const mediaDb = await memoryDb();
  await writeLegacyLoginRow(loginDb, 'Secret1');
  await writeLegacyPhotoRows(mediaDb);
  return { loginDb, mediaDb };
}

/** A successful login answer of the V4 server (status 1) with or without the app sign-in token. */
const loginAnswer = (appToken?: string): LoginResponse => ({ ...(legacyLoginResponse() as unknown as LoginResponse), status: '1', ...(appToken ? { appToken } : {}) });

const evidenceJob = `${ZED_ID}:evidence:Bronze:9501`;

describe('app sign-in token (audit C1)', () => {
  it('keeps the token of the login apart from the stored answer and sends it on JSON and multipart calls', async () => {
    const server = new FakeServer();
    const { app } = await makeApp(server, await legacyDatabases());
    await app.onlineLoginSucceeded(ZED_ID, 'SECRET1', loginAnswer('tok-1'), () => undefined);

    expect(app.session.appToken).toBe('tok-1');
    expect(await app.tokens.get(ZED_ID)).toBe('tok-1');
    expect(JSON.stringify(await app.loginStore.load(ZED_ID))).not.toContain('tok-1');

    await app.api.getParametersByType(ZED_ID, 'Bronze');
    expect(server.last('GetParametersByType')!.headers![APP_TOKEN_HEADER]).toBe('tok-1');
    await queueOutstanding(app);
    await app.queue.run({ userId: ZED_ID });
    const multipart = server.last('SubmitEvidenceV2')!;
    expect(multipart.files).toHaveLength(1);
    expect(multipart.headers![APP_TOKEN_HEADER]).toBe('tok-1');
  });

  it('sends no header when the server answered no token (older server)', async () => {
    const server = new FakeServer();
    const { app } = await makeApp(server, await legacyDatabases());
    await app.onlineLoginSucceeded(ZED_ID, 'SECRET1', loginAnswer(), () => undefined);
    await app.api.getParametersByType(ZED_ID, 'Bronze');
    expect(server.last('GetParametersByType')!.headers![APP_TOKEN_HEADER]).toBeUndefined();
  });

  it('an offline sign-in sends the token of the last online login; logout stops sending it', async () => {
    const server = new FakeServer();
    const dbs = await legacyDatabases();
    const { app } = await makeApp(server, dbs);
    await app.onlineLoginSucceeded(ZED_ID, 'SECRET1', loginAnswer('tok-1'), () => undefined);
    app.resetUser();
    expect(app.session.appToken).toBeNull();

    // Restarted app, no network at sign-in.
    const { app: restarted } = await makeApp(server, dbs);
    expect(await restarted.offlineLogin(ZED_ID, 'SECRET1')).toBe(true);
    expect(restarted.session.appToken).toBe('tok-1');
  });

  it('on "sign-in has expired" ends the session, keeps the offline work queued and sends it after the next sign-in', async () => {
    let expired = true;
    const server = new FakeServer(req =>
      expired && req.url.endsWith('SubmitEvidenceV2') ? { status: '0', errorMessage: SESSION_EXPIRED_MESSAGE } : { status: '1' },
    );
    const { app } = await makeApp(server, await legacyDatabases());
    await app.onlineLoginSucceeded(ZED_ID, 'SECRET1', loginAnswer('tok-1'), () => undefined);
    await queueOutstanding(app);

    const s = await app.queue.run({ userId: ZED_ID });
    expect(s.signedOut).toBe(true);
    expect(s.failed).toHaveLength(0);
    const job = (await app.queue.get(evidenceJob))!;
    expect(job.status).toBe('pending');
    expect(job.nextAttemptAt).toBe(0);
    expect(app.session.expiredMessage).toBe(SESSION_EXPIRED_MESSAGE);
    expect(app.session.appToken).toBeNull();
    expect(await app.tokens.get(ZED_ID)).toBeNull();
    // The evidence is still waiting in the stored data (nothing was marked sent or removed).
    const stored = await app.loginStore.load(ZED_ID);
    expect(certificationDetailsOf(stored!.MsmeDetails!.msmeStatus, 'Bronze')!.parameters![0]!.requirements![0]!.evidences![0]!.status).toBe(Status.COMPLETED);

    // The login page resets the user (LauncherScreen), the user signs in again and the queue goes out with the new token.
    app.resetUser();
    expired = false;
    await app.onlineLoginSucceeded(ZED_ID, 'SECRET1', loginAnswer('tok-2'), () => undefined);
    expect(app.session.expiredMessage).toBeNull();
    const again = await app.queue.run({ userId: ZED_ID });
    expect(again.sent).toHaveLength(1);
    expect(server.last('SubmitEvidenceV2')!.headers![APP_TOKEN_HEADER]).toBe('tok-2');
  });
});
