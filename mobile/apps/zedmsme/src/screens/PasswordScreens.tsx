import React, { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  colors,
  dimens,
  errorOf,
  OutlinedButton,
  OutlinedInput,
  ScreenFrame,
  textStyles,
  UNKNOWN_ERROR,
  useNavigation,
  useUi,
  ZedButton,
  type BaseServiceResponse,
} from '@zed/shared';
import { images } from '../assets/images';
import { useMsme } from '../app/context';

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

  return (
    <ScreenFrame title="Forgot Password" showHeader={false} testID="forgot-password-screen">
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Image source={images.main_logo} style={styles.logo} resizeMode="contain" />
        <Text style={[textStyles.defaultLabel, styles.label]}>Enter Your ZED ID</Text>
        <OutlinedInput value={zedId} onChangeText={setZedId} autoCapitalize="characters" testID="forgot-zed-id" />
        <Footer onBack={() => nav.pop()} onProceed={proceed} proceedEnabled={zedId.trim() !== ''} />
      </ScrollView>
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
        <View style={styles.page} testID="password-changed">
          <Text style={styles.done}>Password changed successfully</Text>
          <ZedButton title="Go To Login" onPress={goToLogin} testID="go-to-login" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <PasswordField label="Enter Current Password" value={current} onChange={setCurrent} testID="current-password" />
          <PasswordField label="Enter New Password" value={next} onChange={setNext} testID="new-password" />
          <PasswordField label="Enter New Password Again" value={again} onChange={setAgain} testID="new-password-again" />
          <Footer onBack={() => nav.pop()} onProceed={proceed} proceedEnabled={enabled} />
        </ScrollView>
      )}
    </ScreenFrame>
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
        right={
          <Pressable onPress={() => setShown(s => !s)} style={{ paddingHorizontal: 12 }}>
            <Text style={{ color: colors.labelColor, fontSize: 18 }}>{shown ? '◉' : '◎'}</Text>
          </Pressable>
        }
      />
    </View>
  );
}

/** registration_footer: BACK and Proceed. */
export function Footer({
  onBack,
  onProceed,
  proceedEnabled = true,
  backTitle = 'BACK',
  proceedTitle = 'Proceed',
}: {
  onBack: () => void;
  onProceed: () => void;
  proceedEnabled?: boolean;
  backTitle?: string;
  proceedTitle?: string;
}) {
  return (
    <View style={styles.footer}>
      <OutlinedButton title={backTitle} onPress={onBack} style={styles.footerButton} testID="footer-back" />
      <ZedButton title={proceedTitle} onPress={onProceed} disabled={!proceedEnabled} style={styles.footerButton} testID="footer-proceed" />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: dimens.padding3, backgroundColor: colors.white },
  logo: { height: 200, width: '100%', marginBottom: dimens.padding3 },
  label: { alignSelf: 'stretch' },
  done: { ...textStyles.defaultLabel, color: colors.black, fontSize: 18, textAlign: 'center', marginVertical: dimens.padding4 },
  footer: { flexDirection: 'row', marginTop: dimens.padding3 },
  footerButton: { flex: 1, marginHorizontal: dimens.padding1 },
});
