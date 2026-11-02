import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SESSION_EXPIRED_MESSAGE, SessionExpiryGate, StackNavigator, UiHost } from '@zed/shared';
import { MsmeAppProvider } from '../src/app/context';
import { AppDrawerHost, AppDrawerOverlay } from '../src/app/AppDrawer';
import { SCREENS } from '../App';
import { FakeServer, makeApp } from './helpers/harness';
import { memoryDb } from './helpers/sqljs';
import { writeLegacyLoginRow, writeLegacyPhotoRows, ZED_ID } from './helpers/legacyFixture';

jest.useFakeTimers();

describe('the server ends the sign-in (audit C1)', () => {
  it('shows the login page with the server text at once, signs out and keeps the user there', async () => {
    const loginDb = await memoryDb();
    const mediaDb = await memoryDb();
    await writeLegacyLoginRow(loginDb, 'PW');
    await writeLegacyPhotoRows(mediaDb);
    const { app } = await makeApp(new FakeServer(), { loginDb, mediaDb });
    await app.offlineLogin(ZED_ID, 'PW');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      r = ReactTestRenderer.create(
        <UiHost>
          <MsmeAppProvider app={app}>
            <AppDrawerHost>
              <StackNavigator
                screens={SCREENS}
                initial={{ name: 'CertificationOptions', params: { certificationType: 'Bronze' } }}
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
    const byTestId = (id: string) => r.root.findAll(n => n.props.testID === id && typeof n.type === 'string');
    expect(byTestId('option-basic-info')).toHaveLength(1);

    act(() => app.session.expire(SESSION_EXPIRED_MESSAGE));
    // No splash: the login form shows with the server's text.
    expect(byTestId('login-zed-id')).toHaveLength(1);
    expect(alert).toHaveBeenCalledWith('', SESSION_EXPIRED_MESSAGE, expect.anything(), expect.anything());
    expect(app.user).toBeNull();
    expect(app.session.appToken).toBeNull();
    // The offline work stays on the phone.
    expect(await app.loginStore.load(ZED_ID)).not.toBeNull();
    alert.mockRestore();
  });
});
