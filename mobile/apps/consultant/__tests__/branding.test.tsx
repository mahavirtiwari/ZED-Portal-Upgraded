import React from 'react';
import { Image } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StackNavigator, UiHost } from '@zed/shared';
import { SCREENS } from '../App';
import { SaAppProvider } from '../src/app/context';
import type { SaApp } from '../src/app/SaApp';
import { images } from '../src/ui/zed';
import { FakeServer, makeApp } from './helpers/harness';
import { memoryDb } from './helpers/sqljs';

// 2026-11-15: the Admin's logo and colour theme for the ZED Consultancy app (Admin → Settings → Branding).

jest.setTimeout(60000);

/** The main portal of the build (ENVIRONMENTS.local), not a MobileApi port. */
const URL = 'http://10.0.2.2:5106/api/public/branding/app/consultant';
const LOGO = 'https://zedv3.qci.org.in/api/public/branding/file/Branding_app-consultant_app-logo.png';
const NAVY = { theme: { key: 'navy', dark: '#1f3b73', mid: '#3c6fc4', accent: '#f2c14e' }, logoUrl: LOGO };

function brandingServer(answer: unknown = NAVY) {
  return new FakeServer(req => (req.url === URL ? answer : { status: '1' }));
}

function render(app: SaApp, name: string) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <UiHost>
        <SaAppProvider app={app}>
          <StackNavigator screens={SCREENS} initial={{ name }} />
        </SaAppProvider>
      </UiHost>,
    );
  });
  return r;
}

const logo = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.findAll(n => n.type === Image && n.props.testID === id)[0]!;
const styleOf = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

describe('Admin branding (ZED Consultancy)', () => {
  it('asks the main portal for "consultant", keeps the answer and shows it on an offline start', async () => {
    const db = await memoryDb();
    const mediaDb = await memoryDb();
    const server = brandingServer();
    const { app } = await makeApp(server, { db, mediaDb });
    expect(app.branding.current).toEqual({ theme: null, logoUrl: null });
    await app.refreshBranding();
    expect(server.requests.map(q => q.url)).toEqual([URL]);
    expect(app.branding.theme).toEqual({ key: 'navy', dark: '#1F3B73', mid: '#3C6FC4', accent: '#F2C14E' });

    const offline = brandingServer();
    offline.online = false;
    const { app: again } = await makeApp(offline, { db, mediaDb });
    expect(again.branding.logoUrl).toBe(LOGO);
    await again.refreshBranding(); // no network: no message, the kept answer stays
    expect(again.branding.theme!.key).toBe('navy');
  });

  it('teal and the maintenance body keep today’s look', async () => {
    const { app } = await makeApp(brandingServer({ status: '0', errorMessage: 'The app is under maintenance.' }));
    await app.refreshBranding();
    expect(app.branding.current).toEqual({ theme: null, logoUrl: null });
    const { app: teal } = await makeApp(brandingServer({ theme: { key: 'teal', dark: '#23656b', mid: '#45a5ad', accent: '#c9e8a0' }, logoUrl: null }));
    await teal.refreshBranding();
    expect(teal.branding.current).toEqual({ theme: null, logoUrl: null });
  });

  it('the splash, the sign-in page and the headers show the Admin’s logo (the ZED mark when it fails) and colours', async () => {
    const { app } = await makeApp(brandingServer());
    await app.refreshBranding();
    const splash = render(app, 'Splash');
    expect(logo(splash, 'splash-logo').props.source).toEqual({ uri: LOGO });
    act(() => splash.unmount());

    const login = render(app, 'Login');
    await act(async () => undefined);
    expect(logo(login, 'login-logo').props.source).toEqual({ uri: LOGO });
    act(() => logo(login, 'login-logo').props.onError());
    expect(logo(login, 'login-logo').props.source).toBe(images.zedMark);
    act(() => login.unmount());

    // A page with the hero header: its logo and its gradient's colour.
    const forgot = render(app, 'ForgotPassword');
    expect(logo(forgot, 'header-logo').props.source).toEqual({ uri: LOGO });
    const fills = forgot.root.findAll(n => typeof n.type === 'string' && n.props.pointerEvents === 'none' && styleOf(n.props.style).backgroundColor === '#3C6FC4');
    expect(fills.length).toBeGreaterThan(0);
    const send = forgot.root.findAll(n => n.props.testID === 'forgot-send' && typeof n.props.style === 'function')[0]!;
    // Not ready yet (no ID typed): grey as today; the theme's mid once something is typed.
    expect(styleOf(send.props.style({ pressed: false })).backgroundColor).not.toBe('#3C6FC4');
    act(() => forgot.root.findAll(n => n.props.testID === 'forgot-email' && typeof n.props.onChangeText === 'function')[0]!.props.onChangeText('a@b.in'));
    const ready = forgot.root.findAll(n => n.props.testID === 'forgot-send' && typeof n.props.style === 'function')[0]!;
    expect(styleOf(ready.props.style({ pressed: false })).backgroundColor).toBe('#3C6FC4');
  });
});
