import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { formatDate, StackNavigator, UiHost } from '@zed/shared';
import { MsmeAppProvider } from '../src/app/context';
import { AppDrawerHost, AppDrawerOverlay } from '../src/app/AppDrawer';
import type { MsmeApp } from '../src/app/MsmeApp';
import { certificationDetailsOf, Status, updateMsmeSurveillanceStatus, type CertificationDetails, type MsmeStatus } from '../src/models';
import { queueNcProduct, queueOutstanding } from '../src/sync/queue';
import { submitNcRequirement } from '../src/sync/submissions';
import { SCREENS } from '../App';
import { FakeServer, makeApp, type SentRequest } from './helpers/harness';
import { memoryDb } from './helpers/sqljs';
import { legacyPhoto, writeLegacyLoginRow, writeLegacyPhotoRows, ZED_ID } from './helpers/legacyFixture';

jest.useFakeTimers();
jest.setTimeout(60000);

const SURVEILLANCE = 'http://10.0.2.2:5106/surveillancemobileapi/msme/';
const MAIN = 'http://10.0.2.2:5106/mobileapi/msme/';

const level = (over: Partial<CertificationDetails>): CertificationDetails => ({
  status: 2,
  nc1Status: 0,
  nc2Status: 0,
  nc3Status: 0,
  nc4Status: 0,
  nc5Status: 0,
  finalSubmitDone: false,
  ...over,
});

/** The surveillance host's GetMsmeStatus: NC 1 of the Bronze surveillance raised. */
const surveillanceStatus = (): MsmeStatus => ({
  status: '1',
  financialAssistanceStatus: 0,
  bronze: level({ nc1Status: 1, nc1StatusText: 'NC 1 raised on surveillance' }),
  silver: level({ status: 0 }),
  gold: level({ status: 0 }),
});

/** A fake V4 server: the surveillance host answers its own status and NC details, everything else succeeds. */
function surveillanceServer() {
  return new FakeServer((req: SentRequest) => {
    if (req.url === SURVEILLANCE + 'GetMsmeStatus') return surveillanceStatus();
    if (req.url === SURVEILLANCE + 'GetNcDetailsByType') {
      return {
        status: '1',
        siteExteriorPhotos: ['https://x/s.jpg'],
        assessorRemarksSite: 'Board faded',
        products: [],
        parameters: [{ id: 41, code: '1', label: 'Leadership', requirements: [{ id: 9301, code: '1', assessorRemarks: 'missing', options: [] }] }],
      };
    }
    return { status: '1' };
  });
}

async function signedInApp(server: FakeServer) {
  const loginDb = await memoryDb();
  const mediaDb = await memoryDb();
  await writeLegacyLoginRow(loginDb, 'PW');
  await writeLegacyPhotoRows(mediaDb);
  const { app } = await makeApp(server, { loginDb, mediaDb });
  await app.offlineLogin(ZED_ID, 'PW');
  return app;
}

function render(app: MsmeApp, name: string, params?: Record<string, unknown>) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <UiHost>
        <MsmeAppProvider app={app}>
          <AppDrawerHost>
            <StackNavigator screens={SCREENS} initial={{ name, params }} overlay={<AppDrawerOverlay />} />
          </AppDrawerHost>
        </MsmeAppProvider>
      </UiHost>,
    );
  });
  return r;
}

const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });

const byTestId = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && typeof n.type === 'string');
const handler = (r: ReactTestRenderer.ReactTestRenderer, id: string, prop: string) => r.root.findAll(n => n.props.testID === id && typeof n.props[prop] === 'function')[0]!;
const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root
    .findAll(n => (n.type as unknown) === 'Text')
    .map(n => (Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '')));

const mainBronze = (app: MsmeApp) => certificationDetailsOf(app.user?.MsmeDetails?.msmeStatus, 'Bronze')!;
const surveillanceBronze = (app: MsmeApp) => certificationDetailsOf(app.user?.MsmeDetails?.msmeSurveillanceStatus, 'Bronze')!;
const urls = (server: FakeServer) => server.requests.map(q => q.url);

describe('Surveillance Assessment option (CertificationOptionsFragment)', () => {
  it('is shown only while a surveillance NC is open (status "3"), with the red NC frame', async () => {
    const app = await signedInApp(new FakeServer());
    const c = mainBronze(app);
    c.surveillanceDate = formatDate(new Date(), 'MM/dd/yyyy hh:mm:ss a');
    for (const [status, shown] of [['1', 0], ['2', 0], [null, 0], ['3', 1]] as const) {
      c.surveillanceStatus = status;
      const r = render(app, 'CertificationOptions', { certificationType: 'Bronze' });
      expect(byTestId(r, 'option-surveillance')).toHaveLength(shown);
      act(() => r.unmount());
    }
    const r = render(app, 'CertificationOptions', { certificationType: 'Bronze' });
    expect(texts(r)).toContain('Surveillance Assessment');
  });

  it('keeps the legacy alert before the scheduled date', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const server = new FakeServer();
    const app = await signedInApp(server);
    const c = mainBronze(app);
    c.surveillanceStatus = '3';
    c.surveillanceDate = formatDate(new Date(Date.now() - 2 * 24 * 3600 * 1000), 'MM/dd/yyyy hh:mm:ss a');
    const r = render(app, 'CertificationOptions', { certificationType: 'Bronze' });
    await act(async () => handler(r, 'option-surveillance', 'onPress').props.onPress());
    expect(alert).toHaveBeenCalledWith('Alert', 'This module will be activated on the scheduled assessment date only', expect.anything(), expect.anything());
    expect(byTestId(r, 'non-conformances')).toHaveLength(0);
    expect(server.requests).toHaveLength(0);
    alert.mockRestore();
  });

  it('opens the surveillance NCs on the scheduled date with the statuses of the surveillance host, kept apart', async () => {
    const server = surveillanceServer();
    const app = await signedInApp(server);
    const c = mainBronze(app);
    c.surveillanceStatus = '3';
    c.surveillanceDate = formatDate(new Date(), 'MM/dd/yyyy hh:mm:ss a');
    const r = render(app, 'CertificationOptions', { certificationType: 'Bronze' });
    await act(async () => handler(r, 'option-surveillance', 'onPress').props.onPress());
    await settle();

    expect(byTestId(r, 'non-conformances')).toHaveLength(1);
    expect(texts(r)).toEqual(expect.arrayContaining(['Non-Conformances(Surveillance)', 'Non-conformance 1', 'NC 1 raised on surveillance']));
    const status = server.last('GetMsmeStatus')!;
    expect(status.url).toBe(SURVEILLANCE + 'GetMsmeStatus');
    expect(status.json).toMatchObject({ userName: ZED_ID });
    // The main certification's NC statuses are untouched; the surveillance round's are stored with the sign-in data.
    expect(mainBronze(app).nc1Status).toBe(0);
    expect(surveillanceBronze(app).nc1Status).toBe(1);
    const stored = await app.loginStore.load(ZED_ID);
    expect(stored?.MsmeDetails?.msmeSurveillanceStatus?.bronze?.nc1Status).toBe(1);
  });
});

describe('Surveillance non-conformances (NonConformancesActivity, isSurveillance)', () => {
  it('fetches the NC from the surveillance host and keeps it with the surveillance status only', async () => {
    const server = surveillanceServer();
    const app = await signedInApp(server);
    const r = render(app, 'NonConformances', { certificationType: 'Bronze', isSurveillance: true });
    await settle();
    await act(async () => handler(r, 'nc-1', 'onPress').props.onPress());
    await settle();

    const details = server.last('GetNcDetailsByType')!;
    expect(details.url).toBe(SURVEILLANCE + 'GetNcDetailsByType');
    expect(details.json).toMatchObject({ userName: ZED_ID, certificationType: 'Bronze', ncCount: 1 });
    expect(byTestId(r, 'nc-details')).toHaveLength(1);
    expect(byTestId(r, 'nc-requirement-9301')).toHaveLength(1);
    expect(surveillanceBronze(app).activeNcDetails?.assessorRemarksSite).toBe('Board faded');
    expect(surveillanceBronze(app).ncOneDetails).toBe(surveillanceBronze(app).activeNcDetails);
    expect(mainBronze(app).activeNcDetails ?? null).toBeNull();
    expect(urls(server).every(u => u.startsWith(SURVEILLANCE))).toBe(true);
  });

  it('shows the statuses kept on the phone when offline, and leaves when the host refuses', async () => {
    const server = surveillanceServer();
    const app = await signedInApp(server);
    updateMsmeSurveillanceStatus(app.user!.MsmeDetails!, surveillanceStatus());
    server.online = false;
    const offline = render(app, 'NonConformances', { certificationType: 'Bronze', isSurveillance: true });
    await settle();
    expect(byTestId(offline, 'nc-1')).toHaveLength(1);
    act(() => offline.unmount());

    // A refused status (handleSurveillanceFlow: toast and finish) goes back to the options.
    server.online = true;
    server.responder = () => ({ status: '0', errorMessage: 'Invalid ZED ID.' });
    const c = mainBronze(app);
    c.surveillanceStatus = '3';
    c.surveillanceDate = formatDate(new Date(), 'MM/dd/yyyy hh:mm:ss a');
    const refused = render(app, 'CertificationOptions', { certificationType: 'Bronze' });
    await act(async () => handler(refused, 'option-surveillance', 'onPress').props.onPress());
    await settle();
    expect(server.last('GetMsmeStatus')!.url).toBe(SURVEILLANCE + 'GetMsmeStatus');
    expect(byTestId(refused, 'non-conformances')).toHaveLength(0);
    expect(byTestId(refused, 'option-surveillance')).toHaveLength(1);
  });

  it('closes the surveillance NC on the surveillance host', async () => {
    const server = surveillanceServer();
    const app = await signedInApp(server);
    updateMsmeSurveillanceStatus(app.user!.MsmeDetails!, surveillanceStatus());
    surveillanceBronze(app).activeNcDetails = { products: [], parameters: [], sitePhotosSubmitted: true };
    const r = render(app, 'NcDetails', { certificationType: 'Bronze', isSurveillance: true });
    expect(byTestId(r, 'nc-close')).toHaveLength(1);
    await act(async () => handler(r, 'nc-close', 'onPress').props.onPress());
    await settle();

    const close = server.last('FinalSubmit')!;
    expect(close.url).toBe(SURVEILLANCE + 'FinalSubmit');
    expect(close.json).toMatchObject({ userName: ZED_ID, certificationType: 'Bronze' });
    expect(surveillanceBronze(app).activeNcDetails).toBeNull();
  });
});

describe('surveillance NC replies (NonConformanceViewModel, isSurveillance)', () => {
  async function withSurveillanceNc(server: FakeServer) {
    const app = await signedInApp(server);
    updateMsmeSurveillanceStatus(app.user!.MsmeDetails!, surveillanceStatus());
    surveillanceBronze(app).activeNcDetails = {
      products: [
        {
          id: undefined as never,
          productId: '7',
          productName: 'P',
          status: Status.COMPLETED,
          msmeRemarks: 'done',
          productPhoto: legacyPhoto('ZEDRNTEST00011700000000003', 'e1.jpg'),
          productDescriptionPhoto: legacyPhoto('ZEDRNTEST00011700000000004', 'e2.jpg'),
        },
      ],
      parameters: [
        {
          code: '1',
          id: '41',
          label: 'Leadership',
          requirements: [{ code: '1', id: '9301', status: Status.COMPLETED, msmeRemarks: 'fixed', photos: [legacyPhoto('ZEDRNTEST00011700000000001', 'a1.jpg')] }],
        },
      ],
    };
    return app;
  }

  it('sends a requirement reply to the surveillance host', async () => {
    const server = new FakeServer();
    const app = await withSurveillanceNc(server);
    const req = surveillanceBronze(app).activeNcDetails!.parameters![0]!.requirements![0]!;
    expect((await submitNcRequirement(app, 'Bronze', req, true)).status).toBe('1');
    const sent = server.last('SubmitNcRequirement')!;
    expect(sent.url).toBe(SURVEILLANCE + 'SubmitNcRequirement');
    expect(sent.fields).toMatchObject({ userName: ZED_ID, requirementId: '9301', msmeRemarks: 'fixed', isFirst: 'true', isLast: 'true' });
    expect(req.status).toBe(Status.SUBMITTED);
  });

  it('queues surveillance replies apart and sends them to the surveillance host when back online', async () => {
    const server = new FakeServer();
    const app = await withSurveillanceNc(server);
    // The same product index of the main certification's open NC: its own job, to its own host.
    mainBronze(app).activeNcDetails = { products: [{ ...surveillanceBronze(app).activeNcDetails!.products![0]!, productId: '8' }], parameters: [] };
    await queueNcProduct(app, 'Bronze', 0, 'P', true);
    await queueNcProduct(app, 'Bronze', 0, 'P');
    const jobs = await app.queue.list(ZED_ID);
    expect(jobs).toHaveLength(2);
    expect(jobs.map(j => j.label).sort()).toEqual(['Non-conformance (Surveillance) product: P', 'Non-conformance product: P']);
    expect(new Set(jobs.map(j => j.group)).size).toBe(2);

    server.online = false;
    expect((await app.queue.run({ userId: ZED_ID })).offline).toBe(true);
    server.online = true;
    expect((await app.queue.run({ userId: ZED_ID, force: true })).sent).toHaveLength(2);
    const products = server.requests.filter(q => q.url.endsWith('SubmitNcProduct'));
    const byUrl = Object.fromEntries(products.map(q => [q.url, JSON.parse(q.fields!.productDetailsNc!).productId]));
    expect(byUrl).toEqual({ [SURVEILLANCE + 'SubmitNcProduct']: '7', [MAIN + 'SubmitNcProduct']: '8' });
  });

  it('finds unsent surveillance replies after sign-in (queueOutstanding)', async () => {
    const server = new FakeServer();
    const app = await withSurveillanceNc(server);
    expect(await queueOutstanding(app)).toBeGreaterThanOrEqual(2);
    const labels = (await app.queue.list(ZED_ID)).map(j => j.label);
    expect(labels).toEqual(expect.arrayContaining(['Non-conformance (Surveillance) product: P', 'Non-conformance (Surveillance): 1. Leadership']));
    await app.queue.run({ userId: ZED_ID, force: true });
    expect(server.last('SubmitNcRequirement')!.url).toBe(SURVEILLANCE + 'SubmitNcRequirement');
    expect(server.last('SubmitNcProduct')!.url).toBe(SURVEILLANCE + 'SubmitNcProduct');
  });
});
