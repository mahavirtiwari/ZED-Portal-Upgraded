import React, { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  colors,
  dimens,
  errorOf,
  Icon,
  OutlinedInput,
  ScreenFrame,
  shapes,
  textStyles,
  UNKNOWN_ERROR,
  useNavigation,
  useUi,
  ZedButton,
  type BaseServiceResponse,
} from '@zed/shared';
import { icons } from '../assets/icons';
import { images } from '../assets/images';
import { useMsme } from '../app/context';
import { Footer } from '../ui/legacy';

/** registration_footer: the legacy one (other screens import it from here). */
export { Footer };

const RESET_SENT = 'A reset link has been sent your registered Email ID';

async function call(fn: () => Promise<BaseServiceResponse>): Promise<BaseServiceResponse> {
  try {
    return await fn();
  } catch (e) {
    return { status: '0', errorMessage: e instanceof Error && e.message ? e.message : UNKNOWN_ERROR };
  }
}

/** ForgotPasswordFragment ("Forgot Password"): the ZED ID, then ResetPassword mails a reset link. */
export function ForgotPasswordScreen() {
  const app = useMsme();
  const ui = useUi();
  const nav = useNavigation();
  const [zedId, setZedId] = useState('');

  const proceed = async () => {
    ui.showLoading();
    const r = await call(() => app.api.resetPassword(zedId.trim().toUpperCase()));
    ui.hideLoading();
    if (r.status === '1') ui.showAlert(r.errorMessage?.trim() ? r.errorMessage : RESET_SENT, 'Success!', () => nav.pop());
    else ui.snackbar(errorOf(r));
  };

  // forgot_password_fragment: the ZED banner and the field in a scroll view, registration_footer pinned below.
  return (
    <ScreenFrame title="Forgot Password" showHeader={false} testID="forgot-password-screen">
      <ScrollView style={styles.scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Image source={images.zed_banner} style={styles.logo} resizeMode="contain" />
        <Text style={[textStyles.defaultLabel, styles.label]}>Enter Your ZED ID</Text>
        <OutlinedInput value={zedId} onChangeText={setZedId} autoCapitalize="characters" testID="forgot-zed-id" />
      </ScrollView>
      <Footer onBack={() => nav.pop()} onProceed={proceed} proceedEnabled={zedId.trim() !== ''} />
    </ScreenFrame>
  );
}

/** ChangePasswordFragment ("Change Password"): current, new and new again; a success signs the user out. */
export function ChangePasswordScreen() {
  const app = useMsme();
  const ui = useUi();
  const nav = useNavigation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [done, setDone] = useState(false);
  const enabled = current !== '' && next !== '' && again !== '' && next === again;

  const proceed = async () => {
    const zedId = app.user?.MsmeDetails?.ZedId ?? app.loginId;
    if (!zedId) return;
    ui.showLoading();
    const r = await call(() => app.api.changePassword({ userName: zedId, oldPassword: current, newPassword: again }));
    ui.hideLoading();
    if (r.status === '1') setDone(true);
    else ui.snackbar(errorOf(r));
  };

  const goToLogin = () => nav.reset([{ name: 'Launcher' }]);

  return (
    <ScreenFrame title="Change Password" backBar={{ zedId: app.user?.MsmeDetails?.ZedId, onBack: done ? goToLogin : () => nav.pop() }} testID="change-password-screen">
      {done ? (
        // success_container: the grey box with the message, then Go To Login.
        <View style={styles.page} testID="password-changed">
          <View style={styles.doneBox}>
            <Image source={images.pwd_change_icon} style={styles.doneIcon} resizeMode="contain" />
            <Text style={styles.done}>Password changed successfully</Text>
          </View>
          <ZedButton title="Go To Login" onPress={goToLogin} small style={{ alignSelf: 'center' }} testID="go-to-login" />
        </View>
      ) : (
        <>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
            <Image source={images.zed_banner} style={styles.logo} resizeMode="contain" />
            <PasswordField label="Enter Current Password" value={current} onChange={setCurrent} testID="current-password" />
            <PasswordField label="Enter New Password" value={next} onChange={setNext} testID="new-password" />
            <PasswordField label="Enter New Password Again" value={again} onChange={setAgain} testID="new-password-again" />
          </ScrollView>
          <Footer onBack={() => nav.pop()} onProceed={proceed} proceedEnabled={enabled} />
        </>
      )}
    </ScreenFrame>
  );
}

/** A password field with the end icon toggle (app:endIconMode="password_toggle"). */
export function PasswordToggle({ shown, onToggle, testID }: { shown: boolean; onToggle: () => void; testID?: string }) {
  return (
    <Pressable onPress={onToggle} style={styles.toggle} testID={testID} accessibilityLabel={shown ? 'Hide password' : 'Show password'}>
      <Icon icon={icons.ic_baseline_view_48} size={26} tint={shown ? colors.appColor : colors.darkGrey2} />
    </Pressable>
  );
}

function PasswordField({ label, value, onChange, testID }: { label: string; value: string; onChange: (v: string) => void; testID: string }) {
  const [shown, setShown] = useState(false);
  return (
    <View>
      <Text style={[textStyles.defaultLabel, styles.label]}>{label}</Text>
      <OutlinedInput
        value={value}
        onChangeText={onChange}
        secureTextEntry={!shown}
        autoCapitalize="none"
        testID={testID}
        right={<PasswordToggle shown={shown} onToggle={() => setShown(s => !s)} testID={`${testID}-toggle`} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.white },
  page: { padding: dimens.padding3, backgroundColor: colors.white },
  logo: { height: 72, width: '100%', marginBottom: dimens.padding3 },
  label: { alignSelf: 'stretch', marginTop: dimens.padding2 },
  toggle: { paddingHorizontal: 12, justifyContent: 'center' },
  doneBox: { ...shapes.greyRectangle, padding: dimens.padding4, marginVertical: dimens.padding4 },
  doneIcon: { width: 256, height: 256, alignSelf: 'center' },
  done: { ...textStyles.defaultLabel, color: colors.black, fontSize: 18, textAlign: 'center', marginVertical: dimens.padding2 },
});
