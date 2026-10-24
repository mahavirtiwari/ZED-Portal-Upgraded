import { NetworkError } from '@zed/shared';
import { certificationDetailsOf, newBasicInformation, Status, type BasicInformation } from '../src/models';
import { queueNcProduct, queueNcRequirement } from '../src/sync/queue';
import { submitBasicInformation, submitNcRequirement, submitSurveillance, syncEvidence } from '../src/sync/submissions';
import { FakeServer, makeApp } from './helpers/harness';
import { legacyLoginResponse, legacyPhoto, ZED_ID, writeLegacyLoginRow, writeLegacyPhotoRows } from './helpers/legacyFixture';
import { memoryDb } from './helpers/sqljs';

async function signedIn(server: FakeServer) {
  const loginDb = await memoryDb();
  const mediaDb = await memoryDb();
  await writeLegacyLoginRow(loginDb, 'PW');
  await writeLegacyPhotoRows(mediaDb);
  const { app } = await makeApp(server, { loginDb, mediaDb });
  await app.offlineLogin(ZED_ID, 'PW');
  return app;
}

function info(app: Awaited<ReturnType<typeof signedIn>>): BasicInformation {
  return certificationDetailsOf(app.user?.MsmeDetails?.msmeStatus, 'Bronze')!.basicInformation!;
}

describe('basic information (BasicInfoViewModel.handleDataSubmission)', () => {
  it('sends the basic information with the selfie and site photos as base64, then each product\'s photos', async () => {
    const server = new FakeServer();
    const app = await signedIn(server);
    const b = info(app);
    b.productDetailsList = [
      { id: 'u1', productName: 'Widget', exported: 'No', productPhoto: legacyPhoto('ZEDRNTEST00011700000000003', 'e1.jpg'), productDescriptionPhoto: legacyPhoto('ZEDRNTEST00011700000000004', 'e2.jpg') },
    ];
    const r = await submitBasicInformation(app, 'Bronze', b);
    expect(r.status).toBe('1');
    const basic = server.last('SubmitBasicInformation')!;
    expect(basic.url).toBe('http://10.0.2.2:5106/surveillancemobileapi/surveillance/SubmitBasicInformation');
    expect(basic.json).toMatchObject({ userName: ZED_ID, certificationType: 'Bronze', version: '1.9', deviceInfo: { deviceId: 'test-device-1' } });
    const sent = basic.json!.basicInformation as BasicInformation;
    expect(sent.assessorSelfie!.photo).toBe('BASE64-ZEDRNTEST00011700000000001');
    expect(sent.siteExteriorPhotos[0]!.photo).toBe('BASE64-ZEDRNTEST00011700000000002');
    expect(sent.status).toBe('SUBMITTED');
    const photos = server.last('SubmitPhotos')!;
    expect(photos.fields).toMatchObject({ userName: ZED_ID, certificationType: 'Bronze' });
    expect(photos.files!.map(f => [f.name, f.fileName, f.type])).toEqual([
      ['files', 'ZEDRNTEST00011700000000003.jpg', 'image/*'],
      ['files', 'ZEDRNTEST00011700000000004.jpg', 'image/*'],
    ]);
    // The local copy keeps no base64.
    expect(info(app).assessorSelfie!.photo).toBeUndefined();
  });

  it('keeps the legacy messages', async () => {
    const refused = new FakeServer(() => ({ status: '0', errorMessage: 'Invalid Details.' }));
    const app = await signedIn(refused);
    expect((await submitBasicInformation(app, 'Bronze', info(app))).errorMessage).toBe('Error occurred while submitting basic info: Invalid Details.');

    const b: BasicInformation = { ...newBasicInformation(), siteExteriorPhotos: [legacyPhoto('missing', 'x.jpg')] };
    expect((await submitBasicInformation(app, 'Bronze', b)).errorMessage).toBe('Site photos missing, please capture again');
    const noSelfie: BasicInformation = { ...newBasicInformation(), siteExteriorPhotos: [legacyPhoto('ZEDRNTEST00011700000000002', 'a2.jpg')] };
    expect((await submitBasicInformation(app, 'Bronze', noSelfie)).errorMessage).toBe('Assessor Selfie Missing, please capture again');
  });

  it('rethrows "no answer" so the caller can queue it', async () => {
    const server = new FakeServer();
    const app = await signedIn(server);
    server.online = false;
    await expect(submitBasicInformation(app, 'Bronze', info(app))).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('evidence sync (EvidencesActivity.onSyncClick)', () => {
  it('sends the basic information first when it is not yet SUBMITTED, then the evidence', async () => {
    const server = new FakeServer();
    const app = await signedIn(server);
    info(app).status = Status.IN_PROGRESS;
    const r = await syncEvidence(app, 'Bronze', '9501');
    expect(r.status).toBe('1');
    expect(server.requests.map(q => q.url.split('/').pop())).toEqual(['SubmitBasicInformation', 'SubmitEvidenceV2', 'SubmitEvidenceV2']);
    expect(info(app).status).toBe(Status.SUBMITTED);
  });
});

describe('non-conformance replies (NonConformanceViewModel)', () => {
  async function withNc(server: FakeServer) {
    const app = await signedIn(server);
    const c = certificationDetailsOf(app.user?.MsmeDetails?.msmeStatus, 'Bronze')!;
    c.nc1Status = 1;
    c.activeNcDetails = {
      products: [{ id: undefined as never, productId: '7', productName: 'P', status: Status.COMPLETED, msmeRemarks: 'done', productPhoto: legacyPhoto('ZEDRNTEST00011700000000003', 'e1.jpg'), productDescriptionPhoto: legacyPhoto('ZEDRNTEST00011700000000004', 'e2.jpg') }],
      parameters: [
        { code: '1', id: '9101', label: 'Test Parameter One', requirements: [{ code: '1', id: '9201', status: Status.COMPLETED, msmeRemarks: 'fixed', photos: [legacyPhoto('ZEDRNTEST00011700000000001', 'a1.jpg')] }] },
      ],
    };
    return app;
  }

  it('sends a requirement reply per photo with its remarks (SubmitNcRequirement)', async () => {
    const server = new FakeServer();
    const app = await withNc(server);
    const req = certificationDetailsOf(app.user?.MsmeDetails?.msmeStatus, 'Bronze')!.activeNcDetails!.parameters![0]!.requirements![0]!;
    expect((await submitNcRequirement(app, 'Bronze', false, req)).status).toBe('1');
    const sent = server.last('SubmitNcRequirement')!;
    expect(sent.url).toBe('http://10.0.2.2:5106/surveillancemobileapi/surveillance/SubmitNcRequirement');
    expect(sent.fields).toMatchObject({ requirementId: '9201', requirementCode: '1', msmeRemarks: 'fixed', isFirst: 'true', isLast: 'true' });
    expect(sent.files![0]).toMatchObject({ name: 'file_data', fileName: 'a1.jpg' });
    expect(req.status).toBe(Status.SUBMITTED);
  });

  it('queues product and requirement replies made offline and sends them when back online (msme/ base for surveillance NCs)', async () => {
    const server = new FakeServer();
    const app = await withNc(server);
    await queueNcProduct(app, 'Bronze', false, 0, 'P');
    await queueNcRequirement(app, 'Bronze', false, '9201', '1. Test Parameter One');
    server.online = false;
    expect((await app.queue.run({ userId: ZED_ID })).offline).toBe(true);
    server.online = true;
    const s = await app.queue.run({ userId: ZED_ID, force: true });
    expect(s.sent).toHaveLength(2);
    const product = server.last('SubmitNcProduct')!;
    expect(JSON.parse(product.fields!.productDetailsNc!)).toMatchObject({ productId: '7', productName: 'P', msmeRemarks: 'done', status: 'COMPLETED' });
    expect(JSON.parse(product.fields!.productDetailsNc!).productPhoto.photo).toBeUndefined();
    expect(product.files!.map(f => f.fileName)).toEqual(['ZEDRNTEST00011700000000003.jpg', 'ZEDRNTEST00011700000000004.jpg']);
  });
});

describe('surveillance photos (SurveillanceViewModel.submitData)', () => {
  it('sends selfie, interior, exterior and site tour photos to msme/SubmitSurveillancePhoto and marks them sent', async () => {
    const server = new FakeServer();
    const app = await signedIn(server);
    const c = certificationDetailsOf(app.user?.MsmeDetails?.msmeStatus, 'Bronze')!;
    c.surveillanceData = {
      selfie: legacyPhoto('ZEDRNTEST00011700000000001', 'a1.jpg'),
      interiorPhotos: [legacyPhoto('ZEDRNTEST00011700000000002', 'a2.jpg')],
      exteriorPhotos: [],
      siteTourPhotos: [{ ...legacyPhoto('ZEDRNTEST00011700000000003', 'e1.jpg'), name: 'Store room' }],
    };
    expect((await submitSurveillance(app, 'Bronze')).status).toBe('1');
    const posts = server.requests.filter(r => r.url.endsWith('surveillancemobileapi/msme/SubmitSurveillancePhoto'));
    expect(posts.map(p => Object.keys(p.fields!).find(k => ['selfie', 'interior', 'exterior', 'sitetour'].includes(k)))).toEqual(['selfie', 'interior', 'sitetour']);
    expect(JSON.parse(posts[2]!.fields!.sitetour!).name).toBe('Store room');
    expect(c.surveillanceData!.siteTourPhotos[0]!.status).toBe(2);
    // A second sync sends nothing again.
    server.requests.length = 0;
    expect((await submitSurveillance(app, 'Bronze')).status).toBe('1');
    expect(server.requests).toHaveLength(0);
  });
});

export { legacyLoginResponse };
