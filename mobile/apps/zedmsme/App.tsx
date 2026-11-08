import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppErrorBoundary, AppStartError, colors, openDatabase, SessionExpiryGate, StackNavigator, UiHost, watchConnectivity, type ScreenMap } from '@zed/shared';

import { AppDrawerHost, AppDrawerOverlay } from './src/app/AppDrawer';
import { MsmeAppProvider } from './src/app/context';
import { MsmeApp } from './src/app/MsmeApp';
import { registerHandlers, syncNow } from './src/sync/queue';
import { BasicInformationScreen } from './src/screens/BasicInformationScreen';
import { CertificationOptionsScreen } from './src/screens/CertificationOptionsScreen';
import { CertificationRequirementsScreen, ComplianceScreen } from './src/screens/CertificationTermsScreens';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { EsgChecklistScreen } from './src/screens/EsgChecklistScreen';
import { EvidencesScreen } from './src/screens/EvidencesScreen';
import { LauncherScreen } from './src/screens/LauncherScreen';
import { MyAccountScreen } from './src/screens/MyAccountScreen';
import { MyCertificationsScreen } from './src/screens/MyCertificationsScreen';
import {
  NcDetailsScreen,
  NcProductScreen,
  NcRequirementScreen,
  NcSitePhotosScreen,
  NonConformancesScreen,
} from './src/screens/NonConformanceScreens';
import { PaymentScreen } from './src/screens/PaymentScreen';
import { EditHistoryScreen } from './src/screens/EditHistoryScreen';
import { PendingUploadsScreen } from './src/screens/PendingUploadsScreen';
import { FinancialAssistanceScreen } from './src/screens/FinancialAssistanceScreen';
import { IncentivesScreen } from './src/screens/IncentivesScreen';
import { MyDocumentsScreen } from './src/screens/MyDocumentsScreen';
import { ChangePasswordScreen, ForgotPasswordScreen } from './src/screens/PasswordScreens';
import { RegistrationScreen } from './src/screens/RegistrationScreen';
import { RemoteAssessmentDetailsScreen, RemoteAssessmentInitialScreen } from './src/screens/RemoteAssessmentScreens';

export const SCREENS: ScreenMap = {
  Launcher: LauncherScreen,
  ForgotPassword: ForgotPasswordScreen,
  Registration: RegistrationScreen,
  Dashboard: DashboardScreen,
  MyDocuments: MyDocumentsScreen,
  Incentives: IncentivesScreen,
  FinancialAssistance: FinancialAssistanceScreen,
  ChangePassword: ChangePasswordScreen,
  MyAccount: MyAccountScreen,
  MyCertifications: MyCertificationsScreen,
  CertificationOptions: CertificationOptionsScreen,
  Compliance: ComplianceScreen,
  CertificationRequirements: CertificationRequirementsScreen,
  BasicInformation: BasicInformationScreen,
  EsgChecklist: EsgChecklistScreen,
  Evidences: EvidencesScreen,
  NonConformances: NonConformancesScreen,
  NcDetails: NcDetailsScreen,
  NcSitePhotos: NcSitePhotosScreen,
  NcProduct: NcProductScreen,
  NcRequirement: NcRequirementScreen,
  RemoteAssessmentInitial: RemoteAssessmentInitialScreen,
  RemoteAssessmentDetails: RemoteAssessmentDetailsScreen,
  Payment: PaymentScreen,
  EditHistory: EditHistoryScreen,
  PendingUploads: PendingUploadsScreen,
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
