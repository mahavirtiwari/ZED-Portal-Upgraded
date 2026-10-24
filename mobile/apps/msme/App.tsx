import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors, openDatabase, StackNavigator, UiHost, watchConnectivity, type ScreenMap } from '@zed/shared';

import { AppDrawerHost, AppDrawerOverlay } from './src/app/AppDrawer';
import { MsmeAppProvider } from './src/app/context';
import { MsmeApp } from './src/app/MsmeApp';
import { registerHandlers, syncNow } from './src/sync/queue';
import { BasicInformationScreen } from './src/screens/BasicInformationScreen';
import { CertificationOptionsScreen } from './src/screens/CertificationOptionsScreen';
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
import { PendingUploadsScreen } from './src/screens/PendingUploadsScreen';
import {
  RemoteAssessmentDetailsScreen,
  RemoteAssessmentInitialScreen,
  SurveillanceScreen,
} from './src/screens/SurveillanceScreens';

export const SCREENS: ScreenMap = {
  Launcher: LauncherScreen,
  Dashboard: DashboardScreen,
  MyAccount: MyAccountScreen,
  MyCertifications: MyCertificationsScreen,
  CertificationOptions: CertificationOptionsScreen,
  BasicInformation: BasicInformationScreen,
  EsgChecklist: EsgChecklistScreen,
  Evidences: EvidencesScreen,
  NonConformances: NonConformancesScreen,
  NcDetails: NcDetailsScreen,
  NcSitePhotos: NcSitePhotosScreen,
  NcProduct: NcProductScreen,
  NcRequirement: NcRequirementScreen,
  Surveillance: SurveillanceScreen,
  RemoteAssessmentInitial: RemoteAssessmentInitialScreen,
  RemoteAssessmentDetails: RemoteAssessmentDetailsScreen,
  Payment: PaymentScreen,
  PendingUploads: PendingUploadsScreen,
};

/** Retry of queued sends whose back-off has passed, while the app is open. */
const RETRY_INTERVAL_MS = 30_000;

export default function App() {
  const [app, setApp] = useState<MsmeApp | null>(null);

  useEffect(() => {
    let alive = true;
    MsmeApp.open(openDatabase).then(a => {
      registerHandlers(a);
      if (alive) setApp(a);
      // New: Admin texts and the Basic Information form at start (the last answer is used offline).
      a.refreshServerContent().catch(() => undefined);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Offline sync triggers: the connection returns, the app comes to the foreground, and a periodic retry.
  useEffect(() => {
    if (!app) return;
    const run = () => syncNow(app).catch(() => undefined);
    const unwatch = watchConnectivity(() => undefined, run);
    const sub = AppState.addEventListener('change', s => s === 'active' && run());
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
          <MsmeAppProvider app={app}>
            <AppDrawerHost>
              <StackNavigator screens={SCREENS} initial={{ name: 'Launcher' }} overlay={<AppDrawerOverlay />} />
            </AppDrawerHost>
          </MsmeAppProvider>
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
