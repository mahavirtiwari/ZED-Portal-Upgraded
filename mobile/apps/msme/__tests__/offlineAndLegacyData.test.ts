import { isHashedCredential } from '@zed/shared';
import { certificationDetailsOf, Status, updateCertificationDetails } from '../src/models';
import { queueOutstanding } from '../src/sync/queue';
import { FakeServer, makeApp, DEVICE } from './helpers/harness';
import { memoryDb } from './helpers/sqljs';
import { writeLegacyLoginRow, writeLegacyPhotoRows, ZED_ID } from './helpers/legacyFixture';

async function legacyDatabases() {
  const loginDb = await memoryDb();
  const mediaDb = await memoryDb();
  await writeLegacyLoginRow(loginDb, 'Secret1');
  await writeLegacyPhotoRows(mediaDb);
  return { loginDb, mediaDb };
}

describe('update from the legacy app: its local data is read and its pending work is sent', () => {
  it('signs in offline with the legacy credential (case-insensitive) and replaces it by a hash', async () => {
    const server = new FakeServer();
    const { app, loginDb, mediaDb } = await makeApp(server, await legacyDatabases());
    expect(await app.offlineLogin(ZED_ID, 'WRONG')).toBe(false);
    expect(await app.offlineLogin(ZED_ID, 'SECRET1')).toBe(true);
    expect(app.user?.MsmeDetails?.ZedId).toBe(ZED_ID);
    const stored = await app.loginStore.credential(ZED_ID);
    expect(isHashedCredential(stored!)).toBe(true);
    expect(stored).not.toContain('SECRET1');
    // Still works with the hash, also after a restart of the app.
    const { app: again } = await makeApp(server, { loginDb, mediaDb });
    expect(await again.offlineLogin(ZED_ID, 'secret1')).toBe(true);
    expect(server.requests).toHaveLength(0);
  });

  it('queues the evidence the legacy app left COMPLETED and sends it as SubmitEvidenceV2, one photo per request', async () => {
    const server = new FakeServer();
    const { app } = await makeApp(server, await legacyDatabases());
    await app.offlineLogin(ZED_ID, 'SECRET1');
    expect(await queueOutstanding(app)).toBe(1);
    const jobs = await app.queue.list(ZED_ID);
    expect(jobs.map(j => j.label)).toEqual(['Evidence: Photo of the test process document']);

    const summary = await app.queue.run({ userId: ZED_ID });
    expect(summary.sent).toHaveLength(1);
    const posts = server.requests.filter(r => r.url.endsWith('surveillancemobileapi/surveillance/SubmitEvidenceV2'));
    expect(posts).toHaveLength(2);
    const [first, second] = posts;
    expect(first!.url).toBe('http://10.0.2.2:5106/surveillancemobileapi/surveillance/SubmitEvidenceV2');
    expect(first!.fields).toMatchObject({
      userName: ZED_ID,
      certificationType: 'Bronze',
      evidenceId: '9501',
      isFirst: 'true',
      isLast: 'false',
      version: '1.9',
      'deviceInfo.deviceId': DEVICE.deviceId,
      'deviceInfo.apiLevel': '35',
    });
    expect(second!.fields).toMatchObject({ isFirst: 'false', isLast: 'true' });
    // Photo metadata without the base64 (photo = null before the JSON), the file under its own name.
    const meta = JSON.parse(first!.fields!.photo!);
    expect(meta).toMatchObject({ photoId: 'ZEDRNTEST00011700000000003', timeStamp: 'Oct 23, 2026 11:15 AM', latitude: '28.6139', isPdf: false });
    expect(meta.photo).toBeUndefined();
    expect(first!.files).toEqual([
      { name: 'file_data', uri: 'file:///data/user/0/com.qci.zed.bronzesurveillance/files/e1.jpg', fileName: 'e1.jpg', type: 'image/*' },
    ]);

    // Marked SUBMITTED and saved: a restart does not send it again.
    const ev = certificationDetailsOf(app.user?.MsmeDetails?.msmeStatus, 'Bronze')!.parameters![0]!.requirements![0]!.evidences![0]!;
    expect(ev.status).toBe(Status.SUBMITTED);
    const saved = await app.loginStore.load(ZED_ID);
    expect(saved!.MsmeDetails!.msmeStatus!.bronze!.parameters![0]!.requirements![0]!.evidences![0]!.status).toBe('SUBMITTED');
    expect(await queueOutstanding(app)).toBe(0);
  });

  it('keeps the queue across a restart while offline and sends it when the network returns', async () => {
    const server = new FakeServer();
    const dbs = await legacyDatabases();
    const { app } = await makeApp(server, dbs);
    await app.offlineLogin(ZED_ID, 'SECRET1');
    await queueOutstanding(app);

    server.online = false;
    const offline = await app.queue.run({ userId: ZED_ID });
    expect(offline.offline).toBe(true);
    expect((await app.queue.get(`${ZED_ID}:evidence:Bronze:9501`))!.status).toBe('pending');

    // App killed and started again (same database files).
    const { app: restarted } = await makeApp(server, dbs);
    await restarted.offlineLogin(ZED_ID, 'SECRET1');
    expect(await restarted.queue.pendingCount(ZED_ID)).toBe(1);

    server.online = true;
    const summary = await restarted.queue.run({ userId: ZED_ID, force: true });
    expect(summary.sent).toHaveLength(1);
    expect(await restarted.queue.pendingCount(ZED_ID)).toBe(0);
  });

  it('keeps a refused evidence failed with the server message, for the user to retry', async () => {
    const server = new FakeServer(req => (req.url.endsWith('SubmitEvidenceV2') ? { status: '0', errorMessage: 'Invalid Details.' } : { status: '1' }));
    const { app } = await makeApp(server, await legacyDatabases());
    await app.offlineLogin(ZED_ID, 'SECRET1');
    await queueOutstanding(app);
    const s = await app.queue.run({ userId: ZED_ID });
    expect(s.failed.map(f => f.lastError)).toEqual(['Invalid Details.']);
    const ev = certificationDetailsOf(app.user?.MsmeDetails?.msmeStatus, 'Bronze')!.parameters![0]!.requirements![0]!.evidences![0]!;
    expect(ev.status).toBe(Status.COMPLETED);
  });

  it('online sign-in keeps the local work and takes only the server statuses', async () => {
    const server = new FakeServer();
    const dbs = await legacyDatabases();
    const { app } = await makeApp(server, dbs);
    const serverResponse = {
      status: '1',
      MsmeDetails: {
        MsmeId: '990001',
        ZedId: ZED_ID,
        msmeStatus: { status: '1', financialAssistanceStatus: 0, bronze: { status: 2, nc1Status: 0, nc2Status: 0, nc3Status: 0, nc4Status: 0, nc5Status: 0, certificate: 'https://x/c.pdf' } },
      },
      remoteAssessmentData: { isSelfieSubmitted: false },
    };
    await app.onlineLoginSucceeded(ZED_ID, 'NEWPASS', serverResponse as never, (local, srv) =>
      updateCertificationDetails(local.MsmeDetails!.msmeStatus!, srv.MsmeDetails!.msmeStatus!),
    );
    const bronze = certificationDetailsOf(app.user?.MsmeDetails?.msmeStatus, 'Bronze')!;
    expect(bronze.status).toBe(2);
    expect(bronze.certificate).toBe('https://x/c.pdf');
    expect(bronze.basicInformation?.status).toBe(Status.SUBMITTED); // local work kept
    expect(bronze.parameters?.length).toBe(1);
    expect(await app.offlineLogin(ZED_ID, 'NEWPASS')).toBe(true); // the password that worked online is the offline one
  });
});
