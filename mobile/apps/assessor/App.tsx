import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppErrorBoundary, AppStartError, openDatabase, SessionExpiryGate, StackNavigator, UiHost, watchConnectivity, type ScreenMap } from '@zed/shared';

import { SaAppProvider, useSa } from './src/app/context';
import { SaApp } from './src/app/SaApp';
import { registerHandlers, syncNow } from './src/sync/queue';
import { AlertScreen, AllocationScreen } from './src/screens/AllocationScreens';
import { AssessmentDetailScreen } from './src/screens/AssessmentDetailScreen';
import { AttendanceLogScreen, AttendanceScreen, PunchInScreen } from './src/screens/AttendanceScreens';
import { BasicDetailsDisplayScreen, BasicInfoRowScreen, BasicInformationScreen } from './src/screens/BasicInfoScreens';
import { NewEvidenceScreen, NewSitePhotoScreen, SiteTourScreen } from './src/screens/EvidenceScreens';
import { FinalCommentsScreen } from './src/screens/FinalCommentsScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { AboutScreen, HelpScreen, NotificationsScreen, ViewProfileScreen } from './src/screens/InfoScreens';
import { ForgotPasswordScreen, LoginScreen, SplashScreen } from './src/screens/LoginScreen';
import { MeetingScreen, SiteImagesScreen } from './src/screens/MeetingScreens';
import { ParametersPagerScreen, QuestionsPagerScreen } from './src/screens/ParametersScreens';
import { SubmitParametersScreen } from './src/screens/SubmitParametersScreen';
import { C } from './src/ui/zed';

/** The pages of the signed-in assessor (redesign); the sign-in page when the assessor is gone. */
function withAssessor<P extends object>(Screen: React.ComponentType<P>): React.ComponentType<P> {
  return function AssessorScreen(props: P) {
    const app = useSa();
    return app.assessor ? <Screen {...props} /> : null;
  };
}

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
  Splash: SplashScreen,
  Login: LoginScreen,
  ForgotPassword: ForgotPasswordScreen,
  Home: withAssessor(HomeScreen),
  Notifications: withAssessor(NotificationsScreen),
  ViewProfile: withAssessor(ViewProfileScreen),
  Help: HelpScreen,
  About: AboutScreen,
  // The company profile and the steps are one page in the redesign (07 Assessment Detail); both legacy names lead there.
  CompanyProfile: withAssessment(AssessmentDetailScreen),
  Alert: withAssessment(AlertScreen),
  Allocation: withAssessment(AllocationScreen),
  AssessmentOptions: withAssessment(AssessmentDetailScreen),
  SiteImages: withAssessment(SiteImagesScreen),
  Meeting: withAssessment(MeetingScreen),
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
/** How often, at most, the Admin's texts and forms are read again when the app comes to the front. */
const CONTENT_REFRESH_MS = 5 * 60_000;
const RETRY_INTERVAL_MS = 30_000;

export default function App() {
  const [app, setApp] = useState<SaApp | null>(null);
  // New in V4: the local database did not open (storage full, a damaged file): an error page with RETRY, not an endless spinner.
  const [startFailed, setStartFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setStartFailed(false);
    SaApp.open(openDatabase)
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
            <SaAppProvider app={app}>
              <StackNavigator screens={SCREENS} initial={{ name: 'Splash' }} overlay={<SessionExpiryGate session={app.session} loginRoute="Login" />} />
            </SaAppProvider>
          </AppErrorBoundary>
        ) : startFailed ? (
          <AppStartError onRetry={() => setAttempt(n => n + 1)} />
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator color={C.primary} />
          </View>
        )}
      </UiHost>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({ loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface } });
