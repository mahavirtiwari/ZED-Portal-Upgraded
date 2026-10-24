import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Image, PermissionsAndroid, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  colors,
  dimens,
  errorOf,
  isNetworkAvailable,
  isNetworkError,
  isSuccess,
  OutlinedInput,
  ScreenFrame,
  textStyles,
  UNKNOWN_ERROR,
  useNavigation,
  useUi,
  ZedButton,
  zedDevice,
} from '@zed/shared';
import { images } from '../assets/images';
import { useMsme } from '../app/context';
import { updateCertificationDetails, type LoginResponse } from '../models';
import { queueOutstanding, syncNow } from '../sync/queue';

const SPLASH_MS = 2500;
const NETWORK_UNAVAILABLE = 'Network Unavailable';
const LOW_RAM =
  'The memory available on your device seems to be less, this may affect the functionality of this application.\n\nPlease try closing all the background applications to free the memory and try again';
const LOW_STORAGE =
  'The memory available on your device seems to be less, this may affect the functionality of this application.\n\nPlease try uninstalling unnecessary apps or removing unused files to free the memory and try again';
const PERMISSIONS_NEEDED = 'The app needs some permissions to function properly. Please grant all the permissions to proceed.';
const PERMISSIONS_DENIED =
  'You have denied the permissions required for proper functioning of the app. Please go to the settings and provide all the permissions then relaunch the app to proceed.';

const PERMISSIONS = [
  { name: PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION, rationale: 'Location permission needed to access current location' },
  { name: PermissionsAndroid.PERMISSIONS.CAMERA, rationale: 'Camera permission needed to capture images' },
];

/** LauncherActivity + SplashFragment + LoginFragment. */
export function LauncherScreen() {
  const app = useMsme();
  const ui = useUi();
  const nav = useNavigation();
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    app.resetUser();
    const t = setTimeout(() => setShowLogin(true), SPLASH_MS);
    startupChecks(ui);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ScreenFrame title="ZED Surveillance" showHeader={false}>
      {showLogin ? <LoginForm onSuccess={() => onLoginSuccess(app, ui, nav)} /> : <Splash />}
    </ScreenFrame>
  );
}

function onLoginSuccess(app: ReturnType<typeof useMsme>, ui: ReturnType<typeof useUi>, nav: ReturnType<typeof useNavigation>) {
  // startActivity(DashboardActivity.getIntent(this, true)); showToast("Login Success"); finish()
  nav.reset([{ name: 'Dashboard', params: { fromLogin: true } }]);
  ui.toast('Login Success', { long: true });
  // New: anything left unsent (by this app or the legacy one) is queued and sent when possible.
  queueOutstanding(app)
    .then(() => syncNow(app))
    .catch(() => undefined);
}

function Splash() {
  return (
    <View style={styles.splash}>
      <Image source={images.main_logo} style={styles.splashLogo} resizeMode="contain" />
      <Image source={images.zed_banner} style={styles.banner} resizeMode="contain" />
    </View>
  );
}

/** checkAvailableRAM, checkAvailableMemory, then the permissions. */
function startupChecks(ui: ReturnType<typeof useUi>) {
  const exit = [{ text: 'Exit', onPress: () => BackHandler.exitApp() }];
  try {
    const mem = zedDevice().getMemoryInfo();
    if (mem.availableRamMb < 128) return ui.alert(null, LOW_RAM, exit, false);
    if (mem.availableStorageMb < 128) return ui.alert(null, LOW_STORAGE, exit, false);
  } catch {
    // not fatal
  }
  checkPermissions(ui);
}

async function checkPermissions(ui: ReturnType<typeof useUi>) {
  const missing = [];
  for (const p of PERMISSIONS) if (!(await PermissionsAndroid.check(p.name))) missing.push(p);
  if (missing.length === 0) return;
  const askAll = async () => {
    for (const p of PERMISSIONS) {
      if (await PermissionsAndroid.check(p.name)) continue;
      const r = await PermissionsAndroid.request(p.name, { title: '', message: p.rationale, buttonPositive: 'OK' });
      if (r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
        ui.alert(null, PERMISSIONS_DENIED, [{ text: 'OK', onPress: () => BackHandler.exitApp() }], false);
        return;
      }
      if (r !== PermissionsAndroid.RESULTS.GRANTED) {
        ui.toast('Permission not granted', { long: true });
        ui.alert(null, PERMISSIONS_NEEDED, [{ text: 'OK', onPress: askAll }], false);
        return;
      }
    }
    ui.toast('All the permissions granted, please proceed with login.', { long: true });
  };
  ui.alert(null, PERMISSIONS_NEEDED, [{ text: 'OK', onPress: askAll }], false);
}

function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const app = useMsme();
  const ui = useUi();
  // The legacy build pre-filled the ZED ID and Assessor ID with test values (donottranslate.xml); not ported.
  const [zedId, setZedId] = useState('');
  const [assessorId, setAssessorId] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ zedId?: string; assessorId?: string; password?: string }>({});
  const [showPassword, setShowPassword] = useState(false);
  const busy = useRef(false);

  const login = async () => {
    // Fields are read upper-cased; a blank field shows its error marker and stops (in this order).
    const username = zedId.toUpperCase();
    if (username.trim() === '') return setErrors({ zedId: '' });
    const assessor = assessorId.toUpperCase();
    if (assessor.trim() === '') return setErrors({ assessorId: '' });
    const pwd = password.toUpperCase();
    if (pwd.trim() === '') return setErrors({ password: '' });
    setErrors({});
    if (busy.current) return;
    busy.current = true;
    try {
      if (await isNetworkAvailable()) {
        ui.showLoading();
        let response: LoginResponse;
        try {
          response = await app.api.login(username, pwd, assessor);
        } catch (e) {
          response = { status: '0', errorMessage: e instanceof Error ? e.message : UNKNOWN_ERROR, remoteAssessmentData: { isSelfieSubmitted: false } };
          if (isNetworkError(e) && (await app.offlineLogin(username, pwd))) {
            // The server could not be reached although a network is connected: fall back to the offline login.
            ui.hideLoading();
            return onSuccess();
          }
        } finally {
          ui.hideLoading();
        }
        if (isSuccess(response)) {
          await app.onlineLoginSucceeded(username, pwd, response, (local, server) => {
            const serverStatus = server.MsmeDetails?.msmeStatus;
            const localStatus = local.MsmeDetails?.msmeStatus;
            if (serverStatus && localStatus) updateCertificationDetails(localStatus, serverStatus);
          });
          // New: the Admin texts and the Basic Information form are refreshed after login (not awaited).
          app.refreshServerContent().catch(() => undefined);
          onSuccess();
        } else {
          ui.snackbar(errorOf(response));
        }
      } else if (await app.offlineLogin(username, pwd)) {
        onSuccess();
      } else {
        ui.toast(NETWORK_UNAVAILABLE, { long: true });
      }
    } finally {
      busy.current = false;
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.login} keyboardShouldPersistTaps="handled">
      <Image source={images.main_logo} style={styles.loginLogo} resizeMode="contain" />
      <Image source={images.zed_banner} style={[styles.banner, { marginBottom: dimens.padding2 }]} resizeMode="contain" />
      <Text style={[textStyles.defaultLabel, styles.label]}>ZED ID</Text>
      <View style={styles.input}>
        <OutlinedInput value={zedId} onChangeText={t => (setZedId(t), setErrors({}))} error={errors.zedId} autoCapitalize="characters" testID="login-zed-id" />
      </View>
      <Text style={[textStyles.defaultLabel, styles.label]}>Assessor ID</Text>
      <View style={styles.input}>
        <OutlinedInput
          value={assessorId}
          onChangeText={t => (setAssessorId(t), setErrors({}))}
          error={errors.assessorId}
          autoCapitalize="characters"
          testID="login-assessor-id"
        />
      </View>
      <Text style={[textStyles.defaultLabel, styles.label]}>Password</Text>
      <View style={styles.input}>
        <OutlinedInput
          value={password}
          onChangeText={t => (setPassword(t), setErrors({}))}
          error={errors.password}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          testID="login-password"
          right={
            <Pressable onPress={() => setShowPassword(s => !s)} style={{ paddingHorizontal: 12 }} testID="password-toggle">
              <Text style={{ color: colors.labelColor, fontSize: 18 }}>{showPassword ? '◉' : '◎'}</Text>
            </Pressable>
          }
        />
      </View>
      <ZedButton title="Login" onPress={login} style={{ alignSelf: 'stretch' }} testID="login-button" />
      {/* "FORGOT PASSWORD?" and the "New User / Register Now" box are visibility="gone" in the legacy layout. */}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: dimens.padding4 },
  splashLogo: { width: '100%', height: 320, margin: dimens.padding2 },
  banner: { height: 72, width: 300, margin: dimens.padding2 },
  login: { alignItems: 'center', padding: dimens.padding3, backgroundColor: colors.white },
  loginLogo: { height: 280, width: '100%' },
  label: { alignSelf: 'stretch' },
  input: { alignSelf: 'stretch', marginHorizontal: dimens.padding1 },
});
