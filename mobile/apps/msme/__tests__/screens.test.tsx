import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import NetInfo from '@react-native-community/netinfo';
import { formatDate, StackNavigator, UiHost } from '@zed/shared';
import { MsmeAppProvider } from '../src/app/context';
import { AppDrawerHost, AppDrawerOverlay } from '../src/app/AppDrawer';
import type { MsmeApp } from '../src/app/MsmeApp';
import { certificationDetailsOf, Status } from '../src/models';
import { SCREENS } from '../App';
import { FakeServer, makeApp } from './helpers/harness';
import { memoryDb } from './helpers/sqljs';
import { writeLegacyLoginRow, writeLegacyPhotoRows, ZED_ID } from './helpers/legacyFixture';

jest.useFakeTimers();
jest.setTimeout(60000);

async function signedInApp(server = new FakeServer()) {
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

/** Host elements with the testID (composite wrappers pass the same testID down). */
const byTestId = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && typeof n.type === 'string');
/** The element with the testID that handles presses / text changes. */
const handler = (r: ReactTestRenderer.ReactTestRenderer, id: string, prop: string) => r.root.findAll(n => n.props.testID === id && typeof n.props[prop] === 'function')[0]!;
const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root
    .findAll(n => (n.type as unknown) === 'Text')
    .map(n => (Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '')));

describe('CertificationOptionsFragment', () => {
  it('shows only the options the certification status allows', async () => {
    const app = await signedInApp();
    const c = certificationDetailsOf(app.user?.MsmeDetails?.msmeStatus, 'Bronze')!;
    c.report = 'r.pdf';
    c.surveillanceStatus = '1';
    c.surveillanceDate = formatDate(new Date(), 'MM/dd/yyyy hh:mm:ss a');
    const r = render(app, 'CertificationOptions', { certificationType: 'Bronze' });
    expect(byTestId(r, 'option-basic-info')).toHaveLength(1);
    expect(byTestId(r, 'option-nc')).toHaveLength(0); // no active NC: the option is gone
    expect(byTestId(r, 'option-certificate')).toHaveLength(0); // no certificate URL
    expect(byTestId(r, 'option-report')).toHaveLength(1);
    expect(byTestId(r, 'option-surveillance')).toHaveLength(1);
    expect(byTestId(r, 'option-remote')).toHaveLength(0);
    expect(texts(r)).toContain('Basic Information & Document Upload');
  });

  it('opens the evidences when the basic information was submitted and no final submit happened', async () => {
    const app = await signedInApp();
    const r = render(app, 'CertificationOptions', { certificationType: 'Bronze' });
    await act(async () => handler(r, 'option-basic-info', 'onPress').props.onPress());
    expect(byTestId(r, 'evidences')).toHaveLength(1);
    expect(texts(r)).toContain('Documents Upload');
  });
});

describe('EvidencesActivity', () => {
  it('lists the evidences with their state and keeps final submit hidden until all are sent or not available', async () => {
    const app = await signedInApp();
    const r = render(app, 'Evidences', { certificationType: 'Bronze' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(texts(r)).toEqual(expect.arrayContaining(['Photo of the test process document', 'Already sent', 'Sync your offline changes now']));
    expect(byTestId(r, 'final-submit')).toHaveLength(0);

    const ev = certificationDetailsOf(app.user?.MsmeDetails?.msmeStatus, 'Bronze')!.parameters![0]!.requirements![0]!.evidences![0]!;
    ev.status = Status.SUBMITTED;
    await act(async () => app.touch());
    expect(byTestId(r, 'final-submit')).toHaveLength(1);
    expect(handler(r, 'final-submit', 'onPress').props.disabled).toBe(true);
  });

  it('offline: shows the red offline note and the legacy reminder instead of UPLOAD', async () => {
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: false });
    const app = await signedInApp();
    const r = render(app, 'Evidences', { certificationType: 'Bronze' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(byTestId(r, 'offline-note')).toHaveLength(1);
    expect(texts(r)).toContain('Don’t forget to sync your offline changes once you are connected to the Internet again.');
    expect(byTestId(r, 'evidence-0-upload')).toHaveLength(0);
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true });
  });
});

describe('Login (LoginFragment)', () => {
  it('stops at the first blank field and signs in offline with the stored credential', async () => {
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: false });
    const loginDb = await memoryDb();
    const mediaDb = await memoryDb();
    await writeLegacyLoginRow(loginDb, 'PW');
    await writeLegacyPhotoRows(mediaDb);
    const { app } = await makeApp(new FakeServer(), { loginDb, mediaDb });
    const r = render(app, 'Launcher');
    act(() => {
      jest.advanceTimersByTime(2500); // splash
    });
    expect(byTestId(r, 'login-button')).toHaveLength(1);
    const type = (id: string, v: string) => act(() => handler(r, id, 'onChangeText').props.onChangeText(v));
    await act(async () => handler(r, 'login-button', 'onPress').props.onPress());
    expect(byTestId(r, 'dashboard')).toHaveLength(0);
    type('login-zed-id', ZED_ID.toLowerCase());
    type('login-assessor-id', 'zedrnsa01');
    type('login-password', 'pw');
    await act(async () => {
      await handler(r, 'login-button', 'onPress').props.onPress();
    });
    expect(app.loginId).toBe(ZED_ID);
    // Dashboard, then My Certifications, then the Enterprise Profile on top (fromLogin).
    expect(byTestId(r, 'dashboard')).toHaveLength(1);
    expect(byTestId(r, 'my-account')).toHaveLength(1);
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true });
  });
});
