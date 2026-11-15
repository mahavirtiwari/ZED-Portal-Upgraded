import React from 'react';
import { Image } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StackNavigator, UiHost } from '@zed/shared';
import { SCREENS } from '../App';
import { AppDrawerHost, AppDrawerOverlay } from '../src/app/AppDrawer';
import { MsmeAppProvider } from '../src/app/context';
import type { MsmeApp } from '../src/app/MsmeApp';
import { images } from '../src/assets/images';
import { FakeServer, makeApp } from './helpers/harness';
import { memoryDb } from './helpers/sqljs';

// 2026-11-15: the Admin's logo and colour theme for the ZED MSME app (Admin → Settings → Branding).

jest.useFakeTimers();
jest.setTimeout(60000);

const URL = 'http://10.0.2.2:5106/api/public/branding/app/msme';
const LOGO = 'https://zedv3.qci.org.in/api/public/branding/file/Branding_app-msme_app-logo.png';
const NAVY = { theme: { key: 'navy', dark: '#1f3b73', mid: '#3c6fc4', accent: '#f2c14e' }, logoUrl: LOGO };

function brandingServer(answer: unknown = NAVY) {
  return new FakeServer(req => (req.url === URL ? answer : { status: '1' }));
}

function render(app: MsmeApp, name: string) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <UiHost>
        <MsmeAppProvider app={app}>
          <AppDrawerHost>
            <StackNavigator screens={SCREENS} initial={{ name }} overlay={<AppDrawerOverlay />} />
          </AppDrawerHost>
        </MsmeAppProvider>
      </UiHost>,
    );
  });
  return r;
}

const logo = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.findAll(n => n.type === Image && n.props.testID === id)[0]!;
const styleOf = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

describe('Admin branding (ZED MSME)', () => {
  it('asks the main portal for "msme", keeps the answer and shows it on an offline start', async () => {
    const loginDb = await memoryDb();
    const mediaDb = await memoryDb();
    const server = brandingServer();
    const { app } = await makeApp(server, { loginDb, mediaDb });
    expect(app.branding.current).toEqual({ theme: null, logoUrl: null });
    await app.refreshBranding();
    expect(server.requests.map(q => q.url)).toEqual([URL]);
    expect(server.requests[0]!.method).toBe('GET');
    expect(app.branding.theme).toEqual({ key: 'navy', dark: '#1F3B73', mid: '#3C6FC4', accent: '#F2C14E' });

    const offline = brandingServer();
    offline.online = false;
    const { app: again } = await makeApp(offline, { loginDb, mediaDb });
    expect(again.branding.logoUrl).toBe(LOGO);
    await again.refreshBranding(); // no network: no message, the kept answer stays
    expect(again.branding.theme!.key).toBe('navy');
  });

  it('the maintenance body is not taken as branding', async () => {
    const { app } = await makeApp(brandingServer({ status: '0', errorMessage: 'The ZED MSME app is under maintenance.' }));
    await app.refreshBranding();
    expect(app.branding.current).toEqual({ theme: null, logoUrl: null });
  });

  it('the sign-in page shows the Admin’s logo (the ZED logo when it fails) and the theme on LOGIN', async () => {
    const { app } = await makeApp(brandingServer());
    const r = render(app, 'Launcher');
    expect(logo(r, 'splash-logo').props.source).toBe(images.zed_banner);
    await act(async () => {
      await app.refreshBranding();
    });
    expect(logo(r, 'splash-logo').props.source).toEqual({ uri: LOGO });
    act(() => {
      jest.advanceTimersByTime(2500); // splash
    });
    expect(logo(r, 'login-logo').props.source).toEqual({ uri: LOGO });
    const login = r.root.findAll(n => n.props.testID === 'login-button' && typeof n.props.style === 'function')[0]!;
    expect(styleOf(login.props.style({ pressed: false })).backgroundColor).toBe('#3C6FC4');
    act(() => logo(r, 'login-logo').props.onError());
    expect(logo(r, 'login-logo').props.source).toBe(images.zed_banner);
  });
});
