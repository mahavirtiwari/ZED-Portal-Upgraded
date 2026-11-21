import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { APP_TOKEN_HEADER, StackNavigator, UiHost } from '@zed/shared';
import { certificationDetailsOf, surveillanceInfo } from '@zed/bronze-surveillance/src/models';
import { submitSurveillance } from '@zed/bronze-surveillance/src/sync/submissions';
import { SCREENS } from '../App';
import { SaAppProvider } from '../src/app/context';
import type { SaApp } from '../src/app/SaApp';
import { BronzeExpiryGate } from '../src/bronze/BronzeSurveillance';
import { openBronzeCase, type BronzeCase } from '../src/bronze/cases';
import { signIn } from '../src/flows/login';
import { FakeServer, makeApp } from './helpers/harness';
import { SA_ID } from './helpers/fixtures';

jest.setTimeout(60000);

const BRONZE_ZED = 'ZEDRNTEST0001';

const bronzeCase = (over: Partial<BronzeCase> = {}): BronzeCase => ({
  zedId: BRONZE_ZED,
  certificationType: 'Bronze',
  enterpriseName: 'RN Test Enterprise Pvt Ltd',
  unitName: 'RN Test Unit',
  address: 'Plot 1, Test Road',
  district: 'NEW DELHI',
  state: 'DELHI',
  pincode: '110001',
  status: 1,
  statusDate: '2026-10-24T17:44:19',
  ...over,
});

/** Surveillance/Login's JSON for the unit (as SA/BronzeSurveillanceSession answers it), with its SURV token. */
const sessionAnswer = (zedId = BRONZE_ZED) => ({
  status: '1',
  appToken: 'surv-tok',
  MsmeDetails: {
    MsmeId: '990001',
    ZedId: zedId,
    BasicDetails: { EnterpriseName: 'RN Test Enterprise Pvt Ltd', EmailId: 'unit@zed.test', MobileNo: '9000000002', EnterpriseTypee: 'Small' },
    PlantDetails: { UnitName: 'RN Test Unit', PAddress: 'Plot 1, Test Road' },
    msmeStatus: { bronze: { status: 1 }, financialAssistanceStatus: 0 },
  },
});

const signInAnswer = (over: Record<string, unknown> = {}) => ({
  status: '1',
  appToken: 'tok-a',
  profile: { assessorId: SA_ID, name: 'RN Assessor' },
  assessments: [],
  ...over,
});

/** Main and surveillance hosts; `mainRefuses`: the assessor is known on the surveillance host only. */
function server(opts: { mainRefuses?: boolean; session?: unknown; ncRound?: number } = {}) {
  const s = new FakeServer(r => {
    const surv = r.url.includes('surveillancemobileapi');
    const name = r.url.split('/SA/')[1]?.split('?')[0] ?? '';
    if (name === 'SignIn') {
      if (!surv) return opts.mainRefuses ? { status: '0', errorMessage: 'Invalid credetials.' } : signInAnswer();
      return signInAnswer({ appToken: 'tok-s', bronzeSurveillance: [bronzeCase(opts.ncRound ? { status: 4, ncRound: opts.ncRound } : {})] });
    }
    if (name === 'BronzeSurveillance') return { status: '1', cases: [bronzeCase(opts.ncRound ? { status: 4, ncRound: opts.ncRound } : {})] };
    if (name === 'BronzeSurveillanceSession') return opts.session ?? sessionAnswer();
    if (name === 'Assessments') return { status: '1', assessments: [] };
    return { status: '1' };
  });
  s.surveillanceOnline = true;
  return s;
}

function render(app: SaApp, name: string, params?: Record<string, unknown>) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <UiHost>
        <SaAppProvider app={app}>
          <StackNavigator screens={SCREENS} initial={{ name, params }} overlay={<BronzeExpiryGate />} />
        </SaAppProvider>
      </UiHost>,
    );
  });
  return r;
}

const byTestId = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && typeof n.type === 'string');
const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAll(n => (n.type as unknown) === 'Text').map(n => (Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '')));
const flush = async () => {
  for (let i = 0; i < 10; i++) await act(async () => new Promise<void>(res => setTimeout(res, 0)));
};

describe('Bronze surveillance in ZED SA (2026-11-21)', () => {
  it('lists the Bronze surveillance cases of the surveillance sign-in with a Bronze Surveillance label', async () => {
    const s = server();
    const { app } = await makeApp(s);
    expect(await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true)).toEqual({ kind: 'proceed', toast: 'Login Successful.' });
    expect(app.bronzeCases.map(c => c.zedId)).toEqual([BRONZE_ZED]);

    const r = render(app, 'Home');
    await flush();
    expect(byTestId(r, `bronze-case-${BRONZE_ZED}`)).toHaveLength(1);
    const shown = texts(r);
    expect(shown).toContain('Bronze Surveillance');
    expect(shown).toContain('RN Test Enterprise Pvt Ltd');
    // The list is refreshed from the surveillance host with ZED SA's surveillance token.
    expect(s.last('SA/BronzeSurveillance')!.url).toContain('surveillancemobileapi/SA/BronzeSurveillance');
    expect(s.last('SA/BronzeSurveillance')!.headers![APP_TOKEN_HEADER]).toBe('tok-s');
    act(() => r.unmount());
  });

  it('a unit in its open NC round is listed as waiting for the NC reply', async () => {
    const s = server({ ncRound: 2 });
    const { app } = await makeApp(s);
    await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
    const r = render(app, 'Home');
    await flush();
    expect(texts(r)).toContain('NC 2: reply due');
    expect(texts(r)).not.toContain('Desktop assessment');
    act(() => r.unmount());
  });

  it('signs in an assessor known on the surveillance host only (main refuses)', async () => {
    const s = server({ mainRefuses: true });
    const { app } = await makeApp(s);
    expect(await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true)).toEqual({ kind: 'proceed', toast: 'Login Successful.' });
    expect(app.assessor?.name).toBe('RN Assessor');
    expect(app.bronzeCases).toHaveLength(1);
    expect(app.surveillanceSession.appToken).toBe('tok-s');
    // No main token: nothing is asked of the main host, the notices come from the surveillance host.
    expect(app.currentSystem).toBe('surveillance');
    s.requests.length = 0;
    await app.refreshAssessments();
    await app.refreshNotifications();
    expect(await app.formCorrections()).toEqual([]);
    expect(s.requests.filter(q => q.url.includes('/mobileapi/')).map(q => q.url)).toEqual([]);
    expect(s.last('SA/BronzeSurveillance')).toBeDefined();
    expect(s.last('SA/Notifications')!.url).toContain('surveillancemobileapi/SA/Notifications');
  });

  it('opening a case exchanges the session on the surveillance host and shows the Bronze steps', async () => {
    const s = server();
    const { app } = await makeApp(s);
    await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
    const r = render(app, 'Home');
    await flush();
    await act(async () => {
      r.root.findAll(n => n.props.testID === `bronze-open-${BRONZE_ZED}` && typeof n.props.onPress === 'function')[0]!.props.onPress();
    });
    await flush();

    const exchange = s.last('SA/BronzeSurveillanceSession')!;
    expect(exchange.url).toContain('surveillancemobileapi/SA/BronzeSurveillanceSession');
    expect(exchange.json).toMatchObject({ saId: SA_ID, zedId: BRONZE_ZED, deviceInfo: { deviceId: 'test-device-1' } });
    expect(exchange.headers![APP_TOKEN_HEADER]).toBe('tok-s');
    expect(app.bronze.loginId).toBe(BRONZE_ZED);
    expect(app.bronze.session.appToken).toBe('surv-tok');
    // The old app's first pages: the Dashboard with My Certifications and the Enterprise Profile on top.
    expect(byTestId(r, 'dashboard')).toHaveLength(1);
    expect(byTestId(r, 'my-account')).toHaveLength(1);
    expect(byTestId(r, 'bronze-card').length).toBeGreaterThan(0);
    act(() => r.unmount());
  });

  it('refuses a case the server does not open, with its text', async () => {
    const { app } = await makeApp(server({ session: { status: '0', errorMessage: 'Bronze Surveillance Assessment data not yet allocated for the ZEDID: ZEDX' } }));
    await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
    expect(await openBronzeCase(app, bronzeCase(), true)).toEqual({
      kind: 'toast',
      message: 'Bronze Surveillance Assessment data not yet allocated for the ZEDID: ZEDX',
    });
    expect(app.bronze.loginId).toBeNull();
  });

  it('a Bronze write goes to the surveillance host with the unit\'s SURV token', async () => {
    const s = server();
    const { app } = await makeApp(s);
    await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
    expect(await openBronzeCase(app, bronzeCase(), true)).toEqual({ kind: 'open' });

    const details = certificationDetailsOf(app.bronze.user?.MsmeDetails?.msmeStatus, 'Bronze')!;
    surveillanceInfo(details).selfie = { photoId: 'SELFIE1', photoPath: '/files/selfie.jpg', status: 0, isPdf: false } as never;
    await submitSurveillance(app.bronze, 'Bronze');
    const sent = s.last('msme/SubmitSurveillancePhoto')!;
    expect(sent.url).toContain('surveillancemobileapi/msme/SubmitSurveillancePhoto');
    expect(sent.headers![APP_TOKEN_HEADER]).toBe('surv-tok');
    expect(sent.fields).toMatchObject({ userName: BRONZE_ZED, certificationType: 'Bronze' });
    expect(sent.files!.map(f => f.name)).toEqual(['file_data']);
  });

  it('opens offline a case opened before on the phone by the same assessor, not another', async () => {
    const s = server();
    const { app, db, mediaDb, bronzeDb, bronzeMediaDb, prefs } = await makeApp(s);
    await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
    expect(await openBronzeCase(app, bronzeCase(), true)).toEqual({ kind: 'open' });
    // Work entered on the phone.
    const details = certificationDetailsOf(app.bronze.user?.MsmeDetails?.msmeStatus, 'Bronze')!;
    details.basicInformation = { ...(details.basicInformation ?? {}), auditsConducted: 'Yes' } as never;
    await app.bronze.persist();
    expect(await openBronzeCase(app, bronzeCase({ zedId: 'ZEDNEVER0001' }), false)).toEqual({ kind: 'toast', key: 'offline' });

    // The app is restarted offline: offline sign-in, then the case.
    const { app: restarted } = await makeApp(s, { db, mediaDb, bronzeDb, bronzeMediaDb }, prefs);
    expect(await signIn(restarted, { assessorId: SA_ID, password: 'Secret1' }, false)).toEqual({ kind: 'proceed' });
    expect(restarted.bronzeCases.map(c => c.zedId)).toEqual([BRONZE_ZED]);
    expect(await openBronzeCase(restarted, bronzeCase(), false)).toEqual({ kind: 'open' });
    expect(restarted.bronze.session.appToken).toBe('surv-tok');
    expect(certificationDetailsOf(restarted.bronze.user?.MsmeDetails?.msmeStatus, 'Bronze')!.basicInformation?.auditsConducted).toBe('Yes');

    // Another assessor on this phone does not open it offline.
    await restarted.signedInAs({ assessorId: 'ZEDOTHER01' }, []);
    expect(restarted.bronze.loginId).toBeNull();
    expect(await openBronzeCase(restarted, bronzeCase(), false)).toEqual({ kind: 'toast', key: 'offline' });
  });

  it('when the surveillance host ends the unit\'s session, the Bronze pages return to Home', async () => {
    const s = server();
    const { app } = await makeApp(s);
    await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
    await openBronzeCase(app, bronzeCase(), true);
    const r = render(app, 'Bronze.Dashboard', { fromLogin: true });
    await flush();
    expect(byTestId(r, 'dashboard')).toHaveLength(1);
    await act(async () => app.bronze.session.expire('Your sign-in has expired. Please sign in again.'));
    await flush();
    expect(byTestId(r, 'dashboard')).toHaveLength(0);
    expect(byTestId(r, 'home')).toHaveLength(1);
    act(() => r.unmount());
  });
});
