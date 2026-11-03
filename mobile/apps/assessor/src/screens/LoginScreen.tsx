import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Image, Linking, PermissionsAndroid, Pressable, StyleSheet, Text, View } from 'react-native';
import { htmlToPlain, isNetworkAvailable, SESSION_EXPIRED_PARAM, useAppText, useBackHandler, useNavigation, useRoute, useUi, zedDevice } from '@zed/shared';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSa } from '../app/context';
import { images as legacyImages } from '../assets/images';
import { normalizeSignIn, signIn } from '../flows/login';
import { C, Card, Field, HeroHeader, images, Strip, useKeyboardHeight, z, ZIcon, ZScroll } from '../ui/zed';
import { showUpdateAlert } from './assessmentActions';
import { SubmitButton } from './MeetingScreens';

export const LOW_RAM =
  'The memory available on your device seems to be less, this may affect the functionality of this application.\n\nPlease try closing all the background applications to free the memory and try again';
export const LOW_STORAGE =
  'The memory available on your device seems to be less, this may affect the functionality of this application.\n\nPlease try uninstalling unnecessary apps or removing unused files to free the memory and try again';
export const PERMISSIONS_NEEDED = 'The app needs some permissions to function properly. Please grant all the permissions to proceed.';
export const PERMISSIONS_DENIED =
  'You have denied the permissions required for proper functioning of the app. Please go to the settings and provide all the permissions then relaunch the app to proceed.';
export const ENTER_ID_AND_PASSWORD = 'Please enter your Assessor ID and password.';
export const RESET_LINK_SENT = 'If the Assessor ID or e-mail address belongs to an active assessor account, a link to set a new password has been sent to its registered e-mail address.';
export const ENTER_ID_OR_EMAIL = 'Please enter your Assessor ID or registered e-mail address.';

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

// ------------------------------------------------------------------ 01 Splash

const SPLASH_MS = 1200;

/** New (redesign): the launcher; the sign-in page after a moment. */
export function SplashScreen() {
  const app = useSa();
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const [cached, setCached] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    app.store
      .count()
      .then(n => alive && setCached(n))
      .catch(() => alive && setCached(0));
    const t = setTimeout(() => nav.reset([{ name: 'Login' }]), SPLASH_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [app, nav]);

  return (
    <View style={[st.splash, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]} testID="splash">
      <View style={st.splashMain}>
        <Image source={images.zedLogo} style={st.splashLogo} resizeMode="contain" />
        <Text style={st.splashTitle}>Site Assessment • Assessor App</Text>
        <Text style={st.splashSub}>On-site Bronze · Silver · Gold assessment</Text>
        <View style={st.cachedChip}>
          {cached ? <ZIcon name="check" size={14} color={C.success} /> : null}
          <Text style={[st.cachedText, !cached && { color: C.tSecondary }]} testID="splash-cached">
            {cached == null ? 'Setting things up…' : cached ? `${cached} assessment${cached === 1 ? '' : 's'} cached` : 'Setting things up…'}
          </Text>
        </View>
      </View>
      <Text style={st.footerTitle}>Quality Council of India</Text>
      <Text style={st.footerText}>Ministry of MSME, Government of India</Text>
      <Text style={[st.footerText, { marginTop: 8 }]}>{`v${zedDevice().getAppInfo().versionName}`}</Text>
    </View>
  );
}

// ------------------------------------------------------------------ 02 Sign in

/**
 * LoginActivity, redesigned: assessor ID and password (the unit is picked on the dashboard). The startup checks, the
 * end of a sign-in by the server and the update question stay as they were.
 */
export function LoginScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const { params } = useRoute<{ saDateDue?: boolean; [SESSION_EXPIRED_PARAM]?: string }>();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const windowNote = useAppText('app.assessor.login.windowNote');
  const [assessorId, setAssessorId] = useState('ZEDAS');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    // New (audit C1): the login page no longer sends the sign-in token; opened by the server's end of the sign-in,
    // it also closes the open assessment (its offline work stays stored) and shows the server's text.
    const expired = params[SESSION_EXPIRED_PARAM];
    if (expired) {
      app.signOut();
      ui.alert(null, expired, [{ text: 'OK' }], false);
      return;
    }
    // Redesign: the steps that ended at the login (end of the assessment, allocation submitted) go back to the
    // dashboard while the assessor is signed in.
    if (app.assessor) {
      app.closeAssessment();
      nav.reset([{ name: 'Home', params: { saDateDue: params.saDateDue } }]);
      return;
    }
    app.session.clear();
    startupChecks(ui);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (params.saDateDue && windowNote && !app.assessor) ui.alert(null, htmlToPlain(windowNote.html), [{ text: 'OK' }], false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.saDateDue]);

  const onLogin = async () => {
    if (busy.current) return;
    const input = normalizeSignIn(assessorId, password);
    if (!input) return ui.toast(ENTER_ID_AND_PASSWORD, { long: true });
    busy.current = true;
    try {
      const online = await isNetworkAvailable();
      if (online) ui.showLoading('Please Wait...');
      let out;
      try {
        out = await signIn(app, input, online);
      } finally {
        if (online) ui.hideLoading();
      }
      switch (out.kind) {
        case 'proceed':
          if (out.toast) ui.toast(out.toast, { long: true });
          nav.reset([{ name: 'Home' }]);
          if (online) app.refreshServerContent().catch(() => undefined);
          break;
        case 'update':
          showUpdateAlert(ui);
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
    <View style={{ flex: 1, backgroundColor: C.bg, paddingBottom: keyboard }}>
      <ZScroll style={{ backgroundColor: C.bg }} contentContainerStyle={[st.login, { paddingTop: 12 + insets.top }]} keyboardShouldPersistTaps="handled" testID="login">
        {/* The legacy sign-in page's illustration stays at the top of the page. */}
        <Image source={legacyImages.login_image} style={st.loginImage} resizeMode="contain" testID="login-image" />
        <Image source={images.zedMark} style={st.loginMark} resizeMode="contain" />
        <Text style={st.brand}>ZED Assessment</Text>
        <Text style={[z.h1, { textAlign: 'center', marginTop: 10 }]}>Sign in</Text>
        <Text style={[z.sub, { textAlign: 'center', marginTop: 6, marginBottom: 20 }]}>Use the credentials emailed to your registered ID.</Text>
        <Card style={{ padding: 16, paddingBottom: 24 }}>
          <Field label="Assessor ID" icon="shield" value={assessorId} onChangeText={setAssessorId} autoCapitalize="characters" autoCorrect={false} testID="login-assessor-id" />
          <Field
            label="Password"
            icon="lock"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            testID="login-password"
            right={
              <Text onPress={() => setShowPassword(v => !v)} style={st.show} testID="login-password-toggle">
                {showPassword ? 'Hide' : 'Show'}
              </Text>
            }
          />
          <Pressable style={{ alignSelf: 'flex-end', marginBottom: 14 }} onPress={() => nav.push('ForgotPassword')} testID="login-forgot">
            <Text style={st.link}>Forgot password?</Text>
          </Pressable>
          <SubmitButton title="Sign in" ready={!!assessorId.trim() && !!password.trim()} onPress={onLogin} testID="login-button" />
        </Card>
        <Strip tone="primary" icon="mail" title="First-time sign-in?" text="Your Assessor ID and password are shared on your registered email by the assessment agency." />
      </ZScroll>
    </View>
  );
}

// ------------------------------------------------------------------ 03 Forgot password

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** New (redesign): the staff password reset mail of the web, asked from the app. */
export function ForgotPasswordScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const keyboard = useKeyboardHeight();
  const busy = useRef(false);

  useBackHandler(() => {
    nav.pop();
    return true;
  });

  const send = async () => {
    if (busy.current) return;
    const value = email.trim();
    if (!value || (value.includes('@') && !EMAIL.test(value))) return ui.toast(ENTER_ID_OR_EMAIL);
    if (!(await isNetworkAvailable())) return ui.toast('Network Unavailable', { long: true });
    busy.current = true;
    ui.showLoading('Please Wait...');
    try {
      const r = await app.forgotPassword(value.includes('@') ? { email: value } : { assessorId: value.toUpperCase() });
      if (r && String(r.status ?? '') === '1') setSent(r.errorMessage?.trim() ? r.errorMessage : RESET_LINK_SENT);
      else ui.toast(r?.errorMessage?.trim() ? r.errorMessage : 'Unable to send the reset link, please try again.', { long: true });
    } catch {
      ui.toast('Unable to send the reset link, please try again.', { long: true });
    } finally {
      ui.hideLoading();
      busy.current = false;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingBottom: keyboard }} testID="forgot-password">
      <HeroHeader title="Forgot password" onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={z.screenPad} keyboardShouldPersistTaps="handled">
        <Text style={z.h2}>Reset your password</Text>
        <Text style={[z.sub, { marginTop: 6, marginBottom: 20 }]}>Enter your Assessor ID or the email address registered with QCI. We'll send a secure link to set a new password.</Text>
        <Field
          label="Assessor ID or registered email"
          icon="mail"
          value={email}
          onChangeText={t => {
            setEmail(t);
            setSent(null);
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          testID="forgot-email"
        />
        <SubmitButton title="Send reset link" ready={!!email.trim()} onPress={send} style={{ marginTop: 8, marginBottom: 12 }} testID="forgot-send" />
        {sent ? <Strip tone="success" icon="check" text={sent} /> : null}
        <View style={{ height: 12 }} />
        <Pressable onPress={() => Linking.openURL('mailto:support@qcin.org').catch(() => undefined)}>
          <Strip tone="neutral" icon="help" title="Didn't receive the email?" text="Check your spam folder or write to support@qcin.org for help." />
        </Pressable>
      </ZScroll>
    </View>
  );
}

const st = StyleSheet.create({
  splash: { flex: 1, backgroundColor: '#FDF6EC', alignItems: 'center' },
  splashMain: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  splashLogo: { width: 290, height: 290 },
  splashTitle: { fontSize: 17, fontWeight: '700', color: C.tSecondary, marginTop: 28, letterSpacing: 0.5 },
  splashSub: { fontSize: 13, color: C.tMuted, marginTop: 6 },
  cachedChip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.successBg, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7, marginTop: 28 },
  cachedText: { fontSize: 13, fontWeight: '700', color: C.success },
  footerTitle: { fontSize: 13, fontWeight: '700', color: C.tSecondary },
  footerText: { fontSize: 11, color: C.tMuted, marginTop: 4 },
  login: { paddingHorizontal: 20, paddingBottom: 40 },
  loginImage: { width: '100%', height: 190, alignSelf: 'center' },
  loginMark: { width: 56, height: 56, alignSelf: 'center', marginTop: 4 },
  brand: { fontSize: 22, fontWeight: '700', color: C.primaryDark, textAlign: 'center', marginTop: 10, letterSpacing: 0.5 },
  show: { color: C.primaryDark, fontWeight: '600', paddingLeft: 8 },
  link: { color: C.primary, fontWeight: '700', fontSize: 13 },
});
