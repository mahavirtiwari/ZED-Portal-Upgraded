import React, { createContext, useContext, useState, useSyncExternalStore } from 'react';
import { Image, type ImageResizeMode, type ImageSourcePropType, type ImageStyle, type StyleProp } from 'react-native';
import { AppBranding, NO_BRANDING, type BrandingState, type BrandTheme } from './appBranding';

const Ctx = createContext<AppBranding | null>(null);

/** 2026-11-15: gives the screens the Admin's logo and theme (Admin → Settings → Branding) of this app. */
export function AppBrandingProvider({ branding, children }: { branding: AppBranding; children: React.ReactNode }) {
  return <Ctx.Provider value={branding}>{children}</Ctx.Provider>;
}

const NONE = new AppBranding(null, 'msme');

/**
 * The app's branding, re-rendered when a newer answer arrives. Without a provider (tests, the old app, the start
 * spinner): no branding, so every component keeps today's look.
 */
export function useAppBranding(): BrandingState {
  const branding = useContext(Ctx);
  const source = branding ?? NONE;
  useSyncExternalStore(
    l => source.subscribe(l),
    () => source.getRevision(),
  );
  return branding ? branding.current : NO_BRANDING;
}

/**
 * The Admin's theme, or null for today's colours. The apps' colours are fixed in StyleSheet.create when a module
 * loads, so the few components that follow the theme (headers, primary buttons, the main accent) put these on top of
 * their own styles at render time.
 */
export function useBrandTheme(): BrandTheme | null {
  return useAppBranding().theme;
}

/**
 * The Admin's logo when there is one, else the bundled image `fallback`; also the bundled image when the remote one
 * fails to load (no network on a first start, a removed file). The style must give the size: a remote image has none
 * of its own.
 */
export function BrandLogo({
  fallback,
  style,
  resizeMode = 'contain',
  testID,
}: {
  fallback: ImageSourcePropType;
  style?: StyleProp<ImageStyle>;
  resizeMode?: ImageResizeMode;
  testID?: string;
}) {
  const { logoUrl } = useAppBranding();
  const [failed, setFailed] = useState<string | null>(null);
  const remote = logoUrl && logoUrl !== failed ? logoUrl : null;
  return (
    <Image
      source={remote ? { uri: remote } : fallback}
      style={style}
      resizeMode={resizeMode}
      onError={remote ? () => setFailed(remote) : undefined}
      accessibilityIgnoresInvertColors
      testID={testID}
    />
  );
}
