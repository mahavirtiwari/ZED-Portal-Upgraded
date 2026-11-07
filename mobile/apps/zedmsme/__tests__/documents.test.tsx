import React from 'react';
import { Alert, ToastAndroid } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SESSION_EXPIRED_MESSAGE, SessionExpiryGate, StackNavigator, UiHost, zedDevice } from '@zed/shared';
import { MsmeAppProvider } from '../src/app/context';
import { AppDrawerHost, AppDrawerOverlay } from '../src/app/AppDrawer';
import type { MsmeApp } from '../src/app/MsmeApp';
import { isSignInRefused } from '../src/components/documents';
import { SCREENS } from '../App';
import { FakeServer, makeApp } from './helpers/harness';
import { memoryDb } from './helpers/sqljs';
import { writeLegacyLoginRow, writeLegacyPhotoRows, ZED_ID } from './helpers/legacyFixture';

jest.useFakeTimers();
jest.setTimeout(60000);

const UNKNOWN_ERROR = 'Unknown error occurred while downloading file';

async function signedInApp() {
  const server = new FakeServer(req =>
    req.url.endsWith('GetMyDocuments')
      ? { Guidelines: [], Certificates: [{ Pledge: null, Bronze: 'https://zedv3.qci.org.in/Certifications/DA/X/Bronze.pdf' }] }
      : { status: '1' },
  );
  const loginDb = await memoryDb();
  const mediaDb = await memoryDb();
  await writeLegacyLoginRow(loginDb, 'PW');
  await writeLegacyPhotoRows(mediaDb);
  const { app } = await makeApp(server, { loginDb, mediaDb });
  await app.offlineLogin(ZED_ID, 'PW');
  await app.session.signedIn(ZED_ID, 'h1.token');
  return app;
}

/** My Documents as App.tsx shows it: with the gate that opens the login page when the session ends. */
async function myDocuments(app: MsmeApp) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <UiHost>
        <MsmeAppProvider app={app}>
          <AppDrawerHost>
            <StackNavigator
              screens={SCREENS}
              initial={{ name: 'MyDocuments' }}
              overlay={
                <>
                  <AppDrawerOverlay />
                  <SessionExpiryGate session={app.session} loginRoute="Launcher" />
                </>
              }
            />
          </AppDrawerHost>
        </MsmeAppProvider>
      </UiHost>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return r;
}

const byTestId = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && typeof n.type === 'string');
const press = (r: ReactTestRenderer.ReactTestRenderer, id: string) =>
  act(async () => r.root.findAll(n => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());

describe('document download (Msme/AppDocument)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('a 401 on a download says the document cannot be opened and keeps the user signed in (2026-11-07)', async () => {
    const app = await signedInApp();
    jest.spyOn(zedDevice(), 'downloadFile').mockRejectedValue(new Error('HTTP 401'));
    const toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => undefined);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const r = await myDocuments(app);

    await press(r, 'certificate-Bronze');
    expect(app.session.expiredMessage).toBeNull();
    expect(app.session.appToken).toBe('h1.token');
    expect(byTestId(r, 'login-zed-id')).toHaveLength(0);
    expect(alert.mock.calls.some(c => c.join(' ').includes('This document could not be opened right now.'))).toBe(true);
    expect(alert.mock.calls.some(c => c.join(' ').includes(SESSION_EXPIRED_MESSAGE))).toBe(false);
    expect(toast).not.toHaveBeenCalledWith(UNKNOWN_ERROR, expect.anything());
  });

  it('any other failure keeps the old message and the session', async () => {
    const app = await signedInApp();
    jest.spyOn(zedDevice(), 'downloadFile').mockRejectedValue(new Error('HTTP 500'));
    const toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => undefined);
    const r = await myDocuments(app);

    await press(r, 'certificate-Bronze');
    expect(toast).toHaveBeenCalledWith(UNKNOWN_ERROR, ToastAndroid.LONG);
    expect(app.session.expiredMessage).toBeNull();
    expect(app.session.appToken).toBe('h1.token');
    expect(byTestId(r, 'login-zed-id')).toHaveLength(0);
  });

  it('knows the native download refusal only by its HTTP 401', () => {
    expect(isSignInRefused(new Error('HTTP 401'))).toBe(true);
    expect(isSignInRefused({ code: 'DOWNLOAD_FAILED', message: 'HTTP 401' })).toBe(true);
    expect(isSignInRefused(new Error('HTTP 4010'))).toBe(false);
    expect(isSignInRefused(new Error('HTTP 403'))).toBe(false);
    expect(isSignInRefused(new Error('timeout'))).toBe(false);
    expect(isSignInRefused(null)).toBe(false);
  });
});
