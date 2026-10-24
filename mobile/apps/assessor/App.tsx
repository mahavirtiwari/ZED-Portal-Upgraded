import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { openDatabase, StackNavigator, UiHost, watchConnectivity, type ScreenMap } from '@zed/shared';

import { SaAppProvider, useSa } from './src/app/context';
import { SaApp } from './src/app/SaApp';
import { registerHandlers, syncNow } from './src/sync/queue';
import { AlertScreen, AllocationScreen } from './src/screens/AllocationScreens';
import { AssessmentOptionsScreen } from './src/screens/AssessmentOptionsScreen';
import { AttendanceLogScreen, AttendanceScreen, PunchInScreen } from './src/screens/AttendanceScreens';
import { BasicDetailsDisplayScreen, BasicInfoRowScreen, BasicInformationScreen } from './src/screens/BasicInfoScreens';
import { CompanyProfileScreen } from './src/screens/CompanyProfileScreen';
import { NewEvidenceScreen, NewSitePhotoScreen, SiteTourScreen } from './src/screens/EvidenceScreens';
import { FinalCommentsScreen } from './src/screens/FinalCommentsScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { MeetingScreen, SelfieScreen, SiteImagesScreen } from './src/screens/MeetingScreens';
import { ParametersPagerScreen, QuestionsPagerScreen } from './src/screens/ParametersScreens';
import { SubmitParametersScreen } from './src/screens/SubmitParametersScreen';
import { sa } from './src/ui/kit';

/**
 * The screens below the login need the open assessment. When it is removed (end of the assessment, punch-out after the
 * closing meeting) they stay in the stack until the reset to Login; they then render nothing instead of failing.
 */
function withAssessment<P extends object>(Screen: React.ComponentType<P>): React.ComponentType<P> {
  return function AssessmentScreen(props: P) {
    const app = useSa();
    return app.details ? <Screen {...props} /> : null;
  };
}

export const SCREENS: ScreenMap = {
  Login: LoginScreen,
  CompanyProfile: withAssessment(CompanyProfileScreen),
  Alert: withAssessment(AlertScreen),
  Allocation: withAssessment(AllocationScreen),
  AssessmentOptions: withAssessment(AssessmentOptionsScreen),
  SiteImages: withAssessment(SiteImagesScreen),
  Meeting: withAssessment(MeetingScreen),
  Selfie: withAssessment(SelfieScreen),
  ParametersPager: withAssessment(ParametersPagerScreen),
  QuestionsPager: withAssessment(QuestionsPagerScreen),
  NewEvidence: withAssessment(NewEvidenceScreen),
  SiteTour: withAssessment(SiteTourScreen),
  NewSitePhoto: withAssessment(NewSitePhotoScreen),
  BasicInformation: withAssessment(BasicInformationScreen),
  BasicInfoRow: withAssessment(BasicInfoRowScreen),
  BasicDetailsDisplay: withAssessment(BasicDetailsDisplayScreen),
  FinalComments: withAssessment(FinalCommentsScreen),
  SubmitParameters: withAssessment(SubmitParametersScreen),
  Attendance: withAssessment(AttendanceScreen),
  PunchIn: withAssessment(PunchInScreen),
  AttendanceLog: withAssessment(AttendanceLogScreen),
};

/** Retry of queued sends whose back-off has passed, while the app is open. */
const RETRY_INTERVAL_MS = 30_000;

export default function App() {
  const [app, setApp] = useState<SaApp | null>(null);

  useEffect(() => {
    let alive = true;
    SaApp.open(openDatabase).then(a => {
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
          <SaAppProvider app={app}>
            <StackNavigator screens={SCREENS} initial={{ name: 'Login' }} />
          </SaAppProvider>
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator color={sa.primary} />
          </View>
        )}
      </UiHost>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({ loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: sa.white } });
