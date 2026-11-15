import React from 'react';
import { Image, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { HttpClient } from '../src/api/http';
import { AppBranding, brandingUrl, BRANDING_TIMEOUT_MS, fetchAppBranding, normalizeBranding } from '../src/branding/appBranding';
import { AppBrandingProvider, BrandLogo, useBrandTheme } from '../src/branding/AppBrandingContext';
import { KeyValueStore } from '../src/db/keyValueStore';
import { ZedButton } from '../src/ui/components/Form';
import { memoryDb } from './helpers/sqljs';

// 2026-11-15: the Admin's logo and colour theme per app (Admin → Settings → Branding).

const NAVY = { theme: { key: 'navy', dark: '#1f3b73', mid: '#3c6fc4', accent: '#f2c14e' }, logoUrl: 'https://zedv3.qci.org.in/api/public/branding/file/logo.png' };
/** A bundled image is a module number in React Native. */
const LOGO = 42;

async function newStore() {
  const store = new KeyValueStore(await memoryDb());
  await store.ensureSchema();
  return store;
}

describe('branding answer', () => {
  it('reads the theme and logo; teal means today’s look; a failure or maintenance body is not an answer', () => {
    expect(normalizeBranding(NAVY)).toEqual({
      theme: { key: 'navy', dark: '#1F3B73', mid: '#3C6FC4', accent: '#F2C14E' },
      logoUrl: NAVY.logoUrl,
    });
    expect(normalizeBranding({ theme: { key: 'teal', dark: '#23656b', mid: '#45a5ad', accent: '#c9e8a0' }, logoUrl: null })).toEqual({ theme: null, logoUrl: null });
    // #RGB is widened; a bad colour drops the theme (today's colours), a non-http logo is ignored.
    expect(normalizeBranding({ theme: { key: 'x', dark: '#123', mid: '#abc', accent: '#fff' }, logoUrl: 'file:///x.png' })).toEqual({
      theme: { key: 'x', dark: '#112233', mid: '#AABBCC', accent: '#FFFFFF' },
      logoUrl: null,
    });
    expect(normalizeBranding({ theme: { key: 'x', dark: 'red', mid: '#abc', accent: '#fff' }, logoUrl: null })!.theme).toBeNull();
    expect(normalizeBranding({ status: '0', errorMessage: 'The app is down for maintenance' })).toBeNull();
    expect(normalizeBranding({ status: '0', theme: NAVY.theme })).toBeNull();
    expect(normalizeBranding('<html>')).toBeNull();
    expect(normalizeBranding(null)).toBeNull();
    expect(normalizeBranding({ other: 1 })).toBeNull();
  });

  it('asks the main portal with a 5 s limit and makes a relative logo absolute', async () => {
    const calls: Array<{ url: string; signal?: AbortSignal | null }> = [];
    const http = new HttpClient({
      fetchImpl: async (url, init) => {
        calls.push({ url, signal: init?.signal });
        const text = JSON.stringify({ theme: NAVY.theme, logoUrl: '/api/public/branding/file/a.png' });
        return { ok: true, status: 200, statusText: 'OK', text: async () => text } as Response;
      },
    });
    expect(brandingUrl('https://zedv3.qci.org.in/', 'consultant')).toBe('https://zedv3.qci.org.in/api/public/branding/app/consultant');
    const r = await fetchAppBranding(http, 'https://zedv3.qci.org.in', 'msme');
    expect(calls[0]!.url).toBe('https://zedv3.qci.org.in/api/public/branding/app/msme');
    expect(r.logoUrl).toBe('https://zedv3.qci.org.in/api/public/branding/file/a.png');
    expect(BRANDING_TIMEOUT_MS).toBe(5000);
  });

  it('gives up after 5 s (not the client’s 60 s)', async () => {
    jest.useFakeTimers();
    try {
      const http = new HttpClient({
        fetchImpl: (_url, init) =>
          new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
      });
      const p = fetchAppBranding(http, 'https://zedv3.qci.org.in', 'assessor');
      const caught = p.catch(e => e as Error);
      jest.advanceTimersByTime(BRANDING_TIMEOUT_MS + 1);
      expect(((await caught) as Error).message).toBe('timeout');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('AppBranding', () => {
  it('keeps the last good answer on the phone and shows it on the next (offline) start', async () => {
    const store = await newStore();
    const first = new AppBranding(store, 'msme');
    await first.load();
    expect(first.current).toEqual({ theme: null, logoUrl: null });
    const seen = jest.fn();
    first.subscribe(seen);
    expect(await first.refresh(async () => NAVY)).toBe(true);
    expect(first.theme!.mid).toBe('#3C6FC4');
    expect(seen).toHaveBeenCalledTimes(1);
    // The same answer again draws nothing again.
    await first.refresh(async () => NAVY);
    expect(seen).toHaveBeenCalledTimes(1);

    const offline = new AppBranding(store, 'msme');
    await offline.load();
    expect(offline.logoUrl).toBe(NAVY.logoUrl);
    // No network, a timeout, the maintenance body: the kept answer stays.
    expect(await offline.refresh(async () => Promise.reject(new Error('timeout')))).toBe(false);
    expect(await offline.refresh(async () => ({ status: '0', errorMessage: 'Down for maintenance' }))).toBe(false);
    expect(offline.theme!.key).toBe('navy');
    // The Admin went back to teal and removed the logo: today's look, also kept.
    expect(await offline.refresh(async () => ({ theme: { key: 'teal', dark: '#23656b', mid: '#45a5ad', accent: '#c9e8a0' }, logoUrl: null }))).toBe(true);
    const later = new AppBranding(store, 'msme');
    await later.load();
    expect(later.current).toEqual({ theme: null, logoUrl: null });
  });
});

describe('BrandLogo and themed components', () => {
  const imageOf = (r: ReactTestRenderer.ReactTestRenderer) => r.root.findAllByType(Image)[0]!;

  it('shows the bundled image without a provider or logo, the Admin’s logo when set, and the bundled one when it fails', async () => {
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      r = ReactTestRenderer.create(<BrandLogo fallback={LOGO} style={{ width: 10, height: 10 }} />);
    });
    expect(imageOf(r).props.source).toBe(LOGO);

    const branding = new AppBranding(null, 'assessor');
    act(() => {
      r = ReactTestRenderer.create(
        <AppBrandingProvider branding={branding}>
          <BrandLogo fallback={LOGO} style={{ width: 10, height: 10 }} />
        </AppBrandingProvider>,
      );
    });
    expect(imageOf(r).props.source).toBe(LOGO);
    await act(async () => {
      await branding.refresh(async () => NAVY);
    });
    expect(imageOf(r).props.source).toEqual({ uri: NAVY.logoUrl });
    act(() => imageOf(r).props.onError());
    expect(imageOf(r).props.source).toBe(LOGO);
  });

  it('colours the primary button with the theme; without one it keeps the app colour', async () => {
    const branding = new AppBranding(null, 'msme');
    let theme: ReturnType<typeof useBrandTheme> = null;
    function Probe() {
      theme = useBrandTheme();
      return <Text>probe</Text>;
    }
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      r = ReactTestRenderer.create(
        <AppBrandingProvider branding={branding}>
          <Probe />
          <ZedButton title="Login" onPress={() => undefined} testID="b" />
        </AppBrandingProvider>,
      );
    });
    const bg = () => {
      const button = r.root.findAll(n => n.props.testID === 'b' && typeof n.props.style === 'function')[0]!;
      const style = button.props.style({ pressed: false }) as unknown[];
      return Object.assign({}, ...style.flat().filter(Boolean)).backgroundColor;
    };
    expect(theme).toBeNull();
    expect(bg()).toBe('#45A5AD');
    await act(async () => {
      await branding.refresh(async () => NAVY);
    });
    expect(theme!.mid).toBe('#3C6FC4');
    expect(bg()).toBe('#3C6FC4');
  });
});
