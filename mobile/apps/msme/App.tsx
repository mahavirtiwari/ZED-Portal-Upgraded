import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppErrorBoundary, AppStartError, colors, openDatabase, SessionExpiryGate, StackNavigator, UiHost, watchConnectivity, type ScreenMap } from '@zed/shared';

import {
  AppDrawerHost,
  AppDrawerOverlay,
  BRONZE_SCREENS,
  LauncherScreen,
  MsmeApp,
  MsmeAppProvider,
  registerHandlers,
  syncNow,
} from '@zed/bronze-surveillance';

/**
 * 2026-11-21: retired. Bronze surveillance is done in ZED SA (com.qci.zed.siteassessment); this build keeps working for the
 * copies already installed. Its screens, models, API and sync live in @zed/bronze-surveillance (mobile/packages), which ZED SA
 * uses too.
 */
export const SCREENS: ScreenMap = {
  Launcher: LauncherScreen,
  ...BRONZE_SCREENS,
};

/** Retry of queued sends whose back-off has passed, while the app is open. */
/** How often, at most, the Admin's texts and forms are read again when the app comes to the front. */
const CONTENT_REFRESH_MS = 5 * 60_000;
const RETRY_INTERVAL_MS = 30_000;

export default function App() {
  const [app, setApp] = useState<MsmeApp | null>(null);
  // New in V4: the local database did not open (storage full, a damaged file): an error page with RETRY, not an endless spinner.
  const [startFailed, setStartFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setStartFailed(false);
    MsmeApp.open(openDatabase)
      .then(a => {
        registerHandlers(a);
        if (alive) setApp(a);
        // New: Admin texts and the Basic Information form at start (the last answer is used offline).
        a.refreshServerContent().catch(() => undefined);
      })
      .catch(() => {
        if (alive) setStartFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  // Offline sync triggers: the connection returns, the app comes to the foreground, and a periodic retry.
  useEffect(() => {
    if (!app) return;
    const run = () => syncNow(app).catch(() => undefined);
    const unwatch = watchConnectivity(() => undefined, run);
    // 2026-11-08: the Admin's texts and forms again when the app comes back (at most every five minutes), not only at start.
    let refreshedAt = Date.now();
    const refreshContent = () => {
      if (Date.now() - refreshedAt < CONTENT_REFRESH_MS) return;
      refreshedAt = Date.now();
      app.refreshServerContent().catch(() => undefined);
    };
    const sub = AppState.addEventListener('change', s => {
      if (s !== 'active') return;
      run();
      refreshContent();
    });
    const timer = setInterval(run, RETRY_INTERVAL_MS);
    return () => {
      unwatch();
      sub.remove();
      clearInterval(timer);
    };
  }, [app]);

  return (
    <SafeAreaProvider>
      <UiHost>
        {app ? (
          <AppErrorBoundary>
            <MsmeAppProvider app={app}>
              <AppDrawerHost>
                <StackNavigator
                  screens={SCREENS}
                  initial={{ name: 'Launcher' }}
                  overlay={
                    <>
                      <AppDrawerOverlay />
                      <SessionExpiryGate session={app.session} loginRoute="Launcher" />
                    </>
                  }
                />
              </AppDrawerHost>
            </MsmeAppProvider>
          </AppErrorBoundary>
        ) : startFailed ? (
          <AppStartError onRetry={() => setAttempt(n => n + 1)} />
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.appColor} />
          </View>
        )}
      </UiHost>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({ loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white } });
