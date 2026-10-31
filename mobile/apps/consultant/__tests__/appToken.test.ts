import { APP_TOKEN_HEADER, SESSION_EXPIRED_MESSAGE } from '@zed/shared';
import { saveOpenMeetingOffline } from '../src/flows/submissions';
import { login } from '../src/flows/login';
import { FakeServer, makeApp } from './helpers/harness';
import { loginAnswer, SA_ID, ZED_ID } from './helpers/fixtures';

const input = { assessorId: SA_ID, password: 'Secret1', zedId: ZED_ID };
const meeting = { saId: SA_ID, zedId: ZED_ID, certificationType: 'Silver', userType: 0 } as never;

describe('app sign-in token (audit C1)', () => {
  it('keeps the login token apart from the stored assessment and sends it on every call; offline sign-in reuses it', async () => {
    const server = new FakeServer(r => (r.url.endsWith('/Login') ? { ...loginAnswer(), appToken: 'tok-1' } : { status: '1' }));
    const { app, db, mediaDb, prefs } = await makeApp(server);
    expect((await login(app, input, true)).kind).toBe('proceed');
    expect(server.last('/Login')!.headers![APP_TOKEN_HEADER]).toBeUndefined();
    expect(app.session.appToken).toBe('tok-1');
    expect(JSON.stringify(await app.store.load(app.userId))).not.toContain('tok-1');

    await saveOpenMeetingOffline(app, meeting, []);
    await app.queue.run({ userId: app.userId, force: true });
    expect(server.last('SubmitStartAssessment')!.headers![APP_TOKEN_HEADER]).toBe('tok-1');

    // Restarted app without a network.
    const { app: restarted } = await makeApp(server, { db, mediaDb }, prefs);
    expect((await login(restarted, input, false)).kind).toBe('proceed');
    expect(restarted.session.appToken).toBe('tok-1');
  });

  it('sends no header after a login answer without a token (older server)', async () => {
    const server = new FakeServer(r => (r.url.endsWith('/Login') ? loginAnswer() : { status: '1' }));
    const { app } = await makeApp(server);
    await login(app, input, true);
    await saveOpenMeetingOffline(app, meeting, []);
    await app.queue.run({ userId: app.userId, force: true });
    expect(server.last('SubmitStartAssessment')!.headers![APP_TOKEN_HEADER]).toBeUndefined();
  });

  it('on "sign-in has expired" signs out, keeps the stored work and sends it after the next sign-in', async () => {
    let expired = true;
    let token = 'tok-1';
    const server = new FakeServer(r => {
      if (r.url.endsWith('/Login')) return { ...loginAnswer(), appToken: token };
      return expired ? { status: '0', errorMessage: SESSION_EXPIRED_MESSAGE } : { status: '1' };
    });
    const { app } = await makeApp(server);
    await login(app, input, true);
    await saveOpenMeetingOffline(app, meeting, []);
    const s = await app.queue.run({ userId: app.userId, force: true });
    expect(s.signedOut).toBe(true);
    expect((await app.queue.list(app.userId)).map(j => j.status)).toEqual(['pending']);
    expect(app.session.expiredMessage).toBe(SESSION_EXPIRED_MESSAGE);
    expect(await app.tokens.get(app.userId)).toBeNull();

    // The login page (LoginScreen) closes the assessment in memory; the stored row and the meeting stay.
    const userId = app.userId;
    app.signOut();
    expect(app.details).toBeNull();
    expect(await app.store.load(userId)).not.toBeNull();
    expect(await app.store.meeting(userId, true)).not.toBeNull();

    expired = false;
    token = 'tok-2';
    expect((await login(app, input, true)).kind).toBe('proceed');
    expect(app.session.expiredMessage).toBeNull();
    const again = await app.queue.run({ userId: app.userId, force: true });
    expect(again.sent.map(j => j.kind)).toEqual(['openMeeting']);
    expect(server.last('SubmitStartAssessment')!.headers![APP_TOKEN_HEADER]).toBe('tok-2');
  });
});
