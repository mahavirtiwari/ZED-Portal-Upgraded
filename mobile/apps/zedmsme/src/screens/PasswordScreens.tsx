import React, { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  colors,
  dimens,
  errorOf,
  Icon,
  OutlinedInput,
  ScreenFrame,
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
import type { FindAccountsResponse, FoundUnit, SendResetLinkResponse } from '../api';
import { Footer } from '../ui/legacy';

/** registration_footer: the legacy one (other screens import it from here). */
export { Footer };

async function call(fn: () => Promise<BaseServiceResponse>): Promise<BaseServiceResponse> {
  try {
    return await fn();
  } catch (e) {
    return { status: '0', errorMessage: e instanceof Error && e.message ? e.message : UNKNOWN_ERROR };
  }
}

type FindBy = 'zedid' | 'pan' | 'email';
const FIND_BY: Array<{ key: FindBy; title: string; label: string; placeholder: string; hint: string }> = [
  { key: 'zedid', title: 'ZED ID', label: 'Your ZED ID', placeholder: 'ZEDM000123', hint: 'The unit with this ZED ID is shown next.' },
  { key: 'pan', title: 'PAN', label: 'PAN of the enterprise', placeholder: 'ABCDE1234F', hint: 'The units registered with this PAN are listed next.' },
  { key: 'email', title: 'E-mail', label: 'Registered e-mail address', placeholder: 'name@example.com', hint: 'The units registered with this e-mail are listed next.' },
];

/**
 * ForgotPasswordFragment, extended (2026-11-07): find the account by ZED ID, PAN or e-mail, pick the unit (unit name,
 * district, state, ZED ID partly hidden), and the reset link (with the full ZED ID) goes to its registered e-mail, shown
 * partly hidden.
 */
export function ForgotPasswordScreen() {
  const app = useMsme();
  const ui = useUi();
  const nav = useNavigation();
  const [by, setBy] = useState<FindBy>('zedid');
  const [value, setValue] = useState('');
  const [units, setUnits] = useState<FoundUnit[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const mode = FIND_BY.find(m => m.key === by)!;

  const find = async () => {
    ui.showLoading();
    const r: FindAccountsResponse = await call(() => app.api.findAccounts(by, value.trim()));
    ui.hideLoading();
    if (r.status === '1' && r.Units?.length) {
      setUnits(r.Units);
      setChosen(r.Units.length === 1 ? r.Units[0]!.Ref : null);
    } else ui.snackbar(errorOf(r));
  };

  const send = async () => {
    if (!chosen) return;
    ui.showLoading();
    const r: SendResetLinkResponse = await call(() => app.api.sendResetLink(chosen));
    ui.hideLoading();
    if (r.status === '1') setSentTo(r.MaskedEmail ?? '');
    else ui.snackbar(errorOf(r));
  };

  if (sentTo != null)
    return (
      <ScreenFrame title="Forgot Password" showHeader={false} testID="forgot-password-screen">
        <View style={styles.result} testID="reset-link-sent">
          <View style={styles.badgeOuter}>
            <View style={styles.badgeInner}>
              <Icon icon={icons.ic_email_teal} size={26} tint={colors.white} />
            </View>
          </View>
          <Text style={styles.resultTitle}>Link sent</Text>
          <Text style={styles.resultText}>A reset link and your full ZED ID have been sent to</Text>
          {sentTo ? (
            <Text style={styles.masked} testID="masked-email">
              {sentTo}
            </Text>
          ) : null}
          <Text style={styles.note}>No access to this e-mail? Please contact the ZED team.</Text>
        </View>
        <View style={styles.bottom}>
          <ZedButton title="Go To Login" onPress={() => nav.pop()} testID="go-to-login" />
        </View>
      </ScreenFrame>
    );

  if (units)
    return (
      <ScreenFrame title="Forgot Password" showHeader={false} testID="forgot-password-screen">
        <ScrollView style={styles.scroll} contentContainerStyle={styles.page}>
          <Text style={styles.heading}>Select your unit</Text>
          {units.map(u => {
            const selected = u.Ref === chosen;
            return (
              <Pressable key={u.Ref} onPress={() => setChosen(u.Ref)} style={[styles.unit, selected && styles.unitSelected]} testID="found-unit">
                <Text style={styles.unitName}>{u.UnitName}</Text>
                {u.District || u.State ? <Text style={styles.unitPlace}>{[u.District, u.State].filter(Boolean).join(', ')}</Text> : null}
                <Text style={styles.unitId}>{u.ZedId}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Footer onBack={() => setUnits(null)} proceedTitle="Send Link" onProceed={send} proceedEnabled={chosen != null} />
      </ScreenFrame>
    );

  // forgot_password_fragment: the ZED banner, the choice and the field in a scroll view, registration_footer pinned below.
  return (
    <ScreenFrame title="Forgot Password" showHeader={false} testID="forgot-password-screen">
      <ScrollView style={styles.scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Image source={images.zed_banner} style={styles.logo} resizeMode="contain" />
        <Text style={styles.heading}>Forgot password</Text>
        <Text style={styles.sub}>Find your account by</Text>
        <View style={styles.choices}>
          {FIND_BY.map(m => (
            <Pressable key={m.key} onPress={() => (setBy(m.key), setValue(''))} style={[styles.choice, by === m.key && styles.choiceOn]} testID={`find-by-${m.key}`}>
              <Text style={[styles.choiceText, by === m.key && styles.choiceTextOn]}>{m.title}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[textStyles.defaultLabel, styles.label]}>{mode.label}</Text>
        <OutlinedInput
          value={value}
          onChangeText={setValue}
          placeholder={mode.placeholder}
          autoCapitalize={by === 'email' ? 'none' : 'characters'}
          keyboardType={by === 'email' ? 'email-address' : 'default'}
          testID="forgot-zed-id"
        />
        <Text style={styles.note}>{mode.hint}</Text>
      </ScrollView>
      <Footer onBack={() => nav.pop()} onProceed={find} proceedEnabled={value.trim() !== ''} />
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
        // Redesigned (2026-11-07): a check mark, the ZED ID, what happened and one button.
        <View style={styles.result} testID="password-changed">
          <View style={styles.badgeOuter}>
            <View style={styles.badgeInner}>
              <Icon icon={icons.ic_check_white} size={28} />
            </View>
          </View>
          <Text style={styles.resultTitle}>Password changed</Text>
          {app.user?.MsmeDetails?.ZedId ? <Text style={styles.idChip}>{app.user.MsmeDetails.ZedId}</Text> : null}
          <Text style={styles.resultText}>{"You’ve been signed out for your security. Log in again with your new password."}</Text>
          <View style={styles.mailNote}>
            <Icon icon={icons.ic_email_teal} size={16} />
            <Text style={styles.mailNoteText}>A confirmation mail was sent to your registered e-mail.</Text>
          </View>
          <View style={{ flex: 1 }} />
          <ZedButton title="Go To Login" onPress={goToLogin} style={{ alignSelf: 'stretch' }} testID="go-to-login" />
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
  heading: { fontSize: 20, fontWeight: 'bold', color: colors.black, marginTop: dimens.padding2 },
  sub: { color: colors.darkGrey2, marginTop: dimens.padding2 },
  choices: { flexDirection: 'row', marginTop: dimens.padding2 },
  choice: { flex: 1, borderWidth: 1, borderColor: '#D6D6D6', borderRadius: 6, paddingVertical: 10, alignItems: 'center', marginRight: 6 },
  choiceOn: { borderWidth: 2, borderColor: colors.appColor, backgroundColor: colors.appColor3 },
  choiceText: { color: colors.darkGrey2, fontSize: 14 },
  choiceTextOn: { color: colors.appColorDark, fontWeight: 'bold' },
  note: { color: colors.labelColor, fontSize: 13, marginTop: dimens.padding2, textAlign: 'center' },
  unit: { borderWidth: 1, borderColor: '#D6D6D6', borderRadius: 8, padding: dimens.padding3, marginTop: dimens.padding2 },
  unitSelected: { borderWidth: 2, borderColor: colors.appColor, backgroundColor: colors.appColor3 },
  unitName: { fontSize: 16, fontWeight: 'bold', color: colors.black },
  unitPlace: { color: colors.darkGrey2, marginTop: 2 },
  unitId: { color: colors.appColorDark, marginTop: 4, letterSpacing: 1 },
  result: { flex: 1, alignItems: 'center', padding: dimens.padding4, paddingTop: 48, backgroundColor: colors.white },
  badgeOuter: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.appColor3, alignItems: 'center', justifyContent: 'center' },
  badgeInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.appColor, alignItems: 'center', justifyContent: 'center' },
  resultTitle: { fontSize: 22, fontWeight: 'bold', color: colors.black, marginTop: dimens.padding4 },
  resultText: { fontSize: 15, color: colors.darkGrey2, textAlign: 'center', marginTop: dimens.padding3, lineHeight: 22 },
  masked: { fontSize: 17, fontWeight: 'bold', color: colors.appColorDark, marginTop: dimens.padding2 },
  idChip: {
    marginTop: dimens.padding2,
    borderWidth: 1,
    borderColor: colors.appColor,
    color: colors.appColorDark,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  mailNote: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.lightGrey2, borderRadius: 8, padding: dimens.padding3, marginTop: dimens.padding4 },
  mailNoteText: { flex: 1, marginLeft: dimens.padding2, color: colors.darkGrey2, fontSize: 13 },
  bottom: { padding: dimens.padding4, backgroundColor: colors.white },
});
