import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Image, Linking, PermissionsAndroid, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { htmlToPlain, isNetworkAvailable, OutlinedInput, useAppText, useNavigation, useRoute, useUi, zedDevice } from '@zed/shared';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSa } from '../app/context';
import { images } from '../assets/images';
import { ENTER_ALL_DETAILS, login, normalizeLoginInput, UPDATE_APP } from '../flows/login';
import { syncNow } from '../sync/queue';
import { SaButton, sa } from '../ui/kit';

export const LOW_RAM =
  'The memory available on your device seems to be less, this may affect the functionality of this application.\n\nPlease try closing all the background applications to free the memory and try again';
export const LOW_STORAGE =
  'The memory available on your device seems to be less, this may affect the functionality of this application.\n\nPlease try uninstalling unnecessary apps or removing unused files to free the memory and try again';
export const PERMISSIONS_NEEDED = 'The app needs some permissions to function properly. Please grant all the permissions to proceed.';
export const PERMISSIONS_DENIED =
  'You have denied the permissions required for proper functioning of the app. Please go to the settings and provide all the permissions then relaunch the app to proceed.';

/** Storage is not asked from Android 13 on (as the legacy isTiramisuOrMore). */
const PERMISSIONS = [
  { name: PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION, rationale: 'Location permission needed to access current location' },
  { name: PermissionsAndroid.PERMISSIONS.CAMERA, rationale: 'Camera permission needed to capture images' },
];

/** checkAvailableRAM (256 MB) and checkAvailableMemory (128 MB), then the permissions. */
function startupChecks(ui: ReturnType<typeof useUi>) {
  const exit = [{ text: 'Exit', onPress: () => BackHandler.exitApp() }];
  try {
    const mem = zedDevice().getMemoryInfo();
    if (mem.availableRamMb < 256) return ui.alert(null, LOW_RAM, exit, false);
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
        ui.toast('Permission not granted');
        ui.alert(null, PERMISSIONS_NEEDED, [{ text: 'OK', onPress: askAll }], false);
        return;
      }
    }
    ui.toast('All the permissions granted, please proceed with login.');
  };
  ui.alert(null, PERMISSIONS_NEEDED, [{ text: 'OK', onPress: askAll }], false);
}

/** LoginActivity (the launcher). */
export function LoginScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const { params } = useRoute<{ saDateDue?: boolean }>();
  const insets = useSafeAreaInsets();
  const windowNote = useAppText('app.consultant.login.windowNote');
  // The legacy layout pre-filled the ID prefixes.
  const [assessorId, setAssessorId] = useState('ZEDCC');
  const [password, setPassword] = useState('');
  const [zedId, setZedId] = useState('ZEDMSME');
  const [showPassword, setShowPassword] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    startupChecks(ui);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (params.saDateDue && windowNote) ui.alert(null, htmlToPlain(windowNote.html), [{ text: 'OK' }], false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.saDateDue]);

  const onLogin = async () => {
    if (busy.current) return;
    const input = normalizeLoginInput(assessorId, password, zedId);
    if (!input) return ui.toast(ENTER_ALL_DETAILS, { long: true });
    busy.current = true;
    try {
      const online = await isNetworkAvailable();
      if (online) ui.showLoading('Please Wait...');
      let out;
      try {
        out = await login(app, input, online);
      } finally {
        if (online) ui.hideLoading();
      }
      switch (out.kind) {
        case 'proceed':
          if (out.toast) ui.toast(out.toast, { long: true });
          nav.reset([{ name: 'CompanyProfile', params: { userType: out.userType, allottedParamsAvailable: out.allottedParamsAvailable } }]);
          if (online) app.refreshServerContent().catch(() => undefined);
          syncNow(app).catch(() => undefined);
          break;
        case 'update':
          ui.alert(
            null,
            UPDATE_APP,
            [
              { text: 'Exit', onPress: () => BackHandler.exitApp(), style: 'cancel' },
              {
                text: 'Go to Play Store',
                onPress: () => {
                  Linking.openURL('market://details?id=' + zedDevice().getAppInfo().packageName).catch(() => undefined);
                  BackHandler.exitApp();
                },
              },
            ],
            false,
          );
          break;
        case 'alert':
          ui.showAlert(out.message);
          break;
        case 'toast':
          ui.toast(out.message, { long: true });
          break;
      }
    } finally {
      busy.current = false;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: sa.white }}>
    {/* The status bar in `primary` with light icons, as the theme drew it. */}
    <StatusBar barStyle="light-content" />
    <View style={{ height: insets.top, backgroundColor: sa.primary }} />
    <ScrollView style={{ backgroundColor: sa.white }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" testID="login">
      <Image source={images.login_image} style={styles.loginImage} resizeMode="contain" />
      <Image source={images.zed_banner} style={styles.banner} resizeMode="contain" />
      <Text style={styles.label}>Consultant/Expert ID</Text>
      <OutlinedInput value={assessorId} onChangeText={setAssessorId} autoCapitalize="characters" testID="login-assessor-id" />
      <Text style={styles.label}>Password</Text>
      <OutlinedInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry={!showPassword}
        autoCapitalize="none"
        testID="login-password"
        right={
          <Text onPress={() => setShowPassword(s => !s)} style={styles.eye} testID="login-password-toggle">
            {showPassword ? '◉' : '◎'}
          </Text>
        }
      />
      <Text style={styles.label}>Applicant MSME ID</Text>
      <OutlinedInput value={zedId} onChangeText={setZedId} autoCapitalize="characters" testID="login-zed-id" />
      <SaButton title="Login" large onPress={onLogin} testID="login-button" />
      <View style={{ height: 280 }} />
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 12 },
  loginImage: { alignSelf: 'center', width: '100%', height: 180 },
  banner: { alignSelf: 'center', height: 96, width: '80%', marginBottom: 12 },
  label: { marginTop: 4, marginHorizontal: 10, color: sa.labelColor, fontSize: 14 },
  eye: { fontSize: 20, color: sa.coolGrey, paddingHorizontal: 8 },
});
