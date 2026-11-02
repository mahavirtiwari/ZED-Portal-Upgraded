/**
 * RegistrationActivity and fragments/registration/* of the MSME code base: six pages in order (no swipe), the e-mail
 * and OTP dialogs between "Unit and Activity" and "Summary". Calls on the portal (Msme/), no sign-in.
 *
 * New in V4 (2.0): the Udyam record comes from the server (Msme/LookupUdyam), not from the Udyam service with a key
 * built into the app, and there is no SafetyNet captcha (the server limits the lookups instead).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  CheckBox,
  colors,
  dimens,
  errorOf,
  HtmlText,
  htmlToPlain,
  OutlinedInput,
  ScreenFrame,
  shapes,
  textStyles,
  UNKNOWN_ERROR,
  useAppText,
  useBackHandler,
  useNavigation,
  useUi,
  ZedButton,
  ZedDialog,
  type BaseServiceResponse,
} from '@zed/shared';
import type { UdyamRecord } from '../api';
import { useMsme } from '../app/context';
import { Footer } from './PasswordScreens';

const TITLES = ['Registration', 'Udyam Validation', 'Unit and Activity', 'Summary', 'ZED Pledge', 'Successful'];
const UDYAM_PREFIX = 'UDYAM-';
const OTP_RESEND_SECONDS = 600;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Lookup = { basic: UdyamRecord; plants: UdyamRecord[]; activities: UdyamRecord[] };

async function call<T extends BaseServiceResponse>(fn: () => Promise<T>): Promise<T | BaseServiceResponse> {
  try {
    return await fn();
  } catch (e) {
    return { status: '0', errorMessage: e instanceof Error && e.message ? e.message : UNKNOWN_ERROR };
  }
}

const text = (r: UdyamRecord | null | undefined, key: string) => (r?.[key] ?? '').toString().trim();

/** The plant's full address as the legacy plant card showed it. */
function plantAddress(p: UdyamRecord) {
  return [text(p, 'PAddress'), [text(p, 'DISTRICT_NAME'), text(p, 'state_name'), text(p, 'PPin')].filter(Boolean).join(', ')]
    .filter(Boolean)
    .join('\n');
}

function today() {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function RegistrationScreen() {
  const app = useMsme();
  const ui = useUi();
  const nav = useNavigation();
  const [page, setPage] = useState(0);
  const [udyam, setUdyam] = useState(UDYAM_PREFIX);
  const [mobile, setMobile] = useState('');
  const [mobileError, setMobileError] = useState<string | undefined>();
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [plant, setPlant] = useState<number | null>(null);
  const [activity, setActivity] = useState<number | null>(null);
  const [email, setEmail] = useState('');
  const [dialog, setDialog] = useState<'email' | 'otp' | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const busy = useRef(false);

  // Back: from the first and the last page the registration closes; otherwise one page back (not while loading).
  useBackHandler(() => {
    if (ui.isLoading) return true;
    if (page === 0 || page === 5) return false;
    setPage(p => p - 1);
    return true;
  });

  const run = async <T extends BaseServiceResponse>(fn: () => Promise<T>) => {
    if (busy.current) return null;
    busy.current = true;
    ui.showLoading();
    try {
      return await call(fn);
    } finally {
      ui.hideLoading();
      busy.current = false;
    }
  };

  const validateUdyam = async () => {
    const r = await run(() => app.api.lookupUdyam(udyam.trim().toUpperCase(), mobile.trim()));
    if (!r) return;
    const found = r as { BasicDetails?: UdyamRecord | null; Plants?: UdyamRecord[] | null; Activities?: UdyamRecord[] | null };
    if (r.status === '1' && found.BasicDetails && (found.Plants ?? []).length > 0 && (found.Activities ?? []).length > 0) {
      setLookup({ basic: found.BasicDetails, plants: found.Plants ?? [], activities: found.Activities ?? [] });
      setPlant(null);
      setActivity(null);
      setPage(2);
    } else if (r.status === '1') {
      ui.showAlert('Unable to get proper response, please make sure you have entered correct data', 'Error');
    } else {
      ui.showAlert(errorOf(r), 'Error');
    }
  };

  const chosenPlant = lookup && plant != null ? lookup.plants[plant] : undefined;
  const chosenActivity = lookup && activity != null ? lookup.activities[activity] : undefined;

  const validatePlant = async () => {
    const regNo = text(lookup?.basic, 'UdyogAadharNo');
    const plantId = text(chosenPlant, 'PlantIdNo');
    const two = text(chosenActivity, 'Two_DigitActivity');
    if (!regNo || !plantId || !two) return ui.showAlert('Required data missing in the selected plant/activity');
    const r = await run(() => app.api.validatePlantAndActivity(regNo, plantId, two));
    if (!r) return;
    if (r.status === '1') setDialog('email');
    else ui.showAlert(errorOf(r), 'Error');
  };

  const sendOtp = async (address: string) => {
    const r = await run(() => app.api.sendPledgeEmailOtp(address));
    if (!r) return;
    if (r.status === '1') {
      setEmail(address);
      setConfirmed(false);
      setDialog('otp');
    } else {
      ui.showAlert(errorOf(r), 'Error');
    }
  };

  const verifyOtp = async (otp: string) => {
    const r = await run(() => app.api.verifyPledgeEmailOtp(email, otp));
    if (!r) return;
    if (r.status === '1') {
      setDialog(null);
      setPage(3);
    } else {
      ui.snackbar(errorOf(r));
    }
  };

  const pledge = async () => {
    if (!lookup || !chosenPlant || !chosenActivity) return ui.showAlert('Invalid Data, please select details again');
    const r = await run(() =>
      app.api.register({
        DateOfPledge: today(),
        PledgeEmailId: email,
        RegistrationType: 'UDYAM',
        RegistrationFrom: 'Android',
        // The server registers from its own Udyam lookup: the number and mobile find it, the plant and activity are chosen in it.
        BasicDetails: { ...lookup.basic, MobileNo: mobile.trim() },
        PlantDetails: chosenPlant,
        ActivityDetails: chosenActivity,
      }),
    );
    if (!r) return;
    if (r.status === '1') setPage(5);
    else ui.showAlert(errorOf(r), 'Error');
  };

  const back = () => (page === 0 || page === 5 ? nav.pop() : setPage(p => p - 1));

  return (
    <ScreenFrame title={TITLES[page] ?? 'Registration'} testID="registration">
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" testID={`registration-page-${page}`}>
        {page >= 1 && page <= 4 ? <Dots current={page} /> : null}
        {page === 0 ? <Welcome onBack={() => nav.pop()} onProceed={() => setPage(1)} /> : null}
        {page === 1 ? (
          <View>
            <Text style={styles.label}>Enter your Udyam Registration Number:</Text>
            <OutlinedInput
              value={udyam}
              onChangeText={t => setUdyam(t.toUpperCase())}
              autoCapitalize="characters"
              placeholder="UDYAM-XX-99-9999999"
              testID="udyam-number"
            />
            <Text style={styles.label}>Enter your Udyam Registered Mobile Number:</Text>
            <OutlinedInput
              value={mobile}
              keyboardType="phone-pad"
              maxLength={10}
              error={mobileError}
              onChangeText={t => {
                const digits = t.replace(/\D/g, '');
                // Utils.validateMobileNumber: a mobile number cannot begin with 0-5.
                if (digits.length > 0 && Number(digits[0]) < 6) {
                  setMobileError('Mobile Number cannot begin with 0-5');
                  setMobile('');
                  return;
                }
                setMobileError(undefined);
                setMobile(digits);
              }}
              testID="udyam-mobile"
            />
            <Footer onBack={back} onProceed={validateUdyam} proceedEnabled={udyam.trim().length > UDYAM_PREFIX.length && mobile.length === 10} />
          </View>
        ) : null}
        {page === 2 && lookup ? (
          <View>
            <ValidatedNote />
            <EnterpriseBox basic={lookup.basic} />
            <Text style={styles.label}>Please select any one Plant Location and its Activity</Text>
            <Text style={styles.heading}>Plant Location</Text>
            {lookup.plants.map((p, i) => (
              <Choice
                key={`plant-${i}`}
                title={text(p, 'UnitName')}
                detail={plantAddress(p)}
                selected={plant === i}
                selectTitle="Select this unit"
                onSelect={() => (setPlant(i), setActivity(null))}
                testID={`plant-${i}`}
              />
            ))}
            {chosenPlant ? (
              <View>
                <Text style={styles.heading}>Plant Activity</Text>
                <Text style={styles.label}>
                  Please select Plant activity for the selected Plant location:{'\n'}
                  <Text style={{ fontWeight: 'bold' }}>{plantAddress(chosenPlant)}</Text>
                </Text>
                {lookup.activities.map((a, i) => (
                  <Choice
                    key={`activity-${i}`}
                    title={text(a, 'Activity')}
                    detail={activityCodes(a)}
                    selected={activity === i}
                    selectTitle="Select this Activity"
                    onSelect={() => setActivity(i)}
                    testID={`activity-${i}`}
                  />
                ))}
              </View>
            ) : null}
            <Footer onBack={back} onProceed={validatePlant} proceedEnabled={chosenPlant != null && chosenActivity != null} />
          </View>
        ) : null}
        {page === 3 && lookup && chosenPlant && chosenActivity ? (
          <Summary
            email={email}
            basic={lookup.basic}
            plant={chosenPlant}
            activity={chosenActivity}
            confirmed={confirmed}
            onConfirm={setConfirmed}
            onEdit={() => setPage(2)}
            onBack={back}
            onProceed={() => setPage(4)}
          />
        ) : null}
        {page === 4 ? <Pledge onBack={back} onPledge={pledge} /> : null}
        {page === 5 ? <Success onLogin={() => nav.reset([{ name: 'Launcher' }])} /> : null}
      </ScrollView>
      {dialog === 'email' ? <EmailDialog initial={email} onClose={() => setDialog(null)} onProceed={sendOtp} /> : null}
      {dialog === 'otp' ? (
        <OtpDialog email={email} onClose={() => setDialog(null)} onSubmit={verifyOtp} onResend={() => (setDialog(null), sendOtp(email))} />
      ) : null}
    </ScreenFrame>
  );
}

function activityCodes(a: UdyamRecord) {
  return [
    ['2 Digit', text(a, 'Two_DigitActivity')],
    ['4 Digit', text(a, 'Four_DigitActivity')],
    ['5 Digit', text(a, 'Five_DigitActivity')],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join('   ');
}

/** layout_page_status: four dots, the current one in the app colour, the done ones filled. */
function Dots({ current }: { current: number }) {
  return (
    <View style={styles.dots}>
      {[1, 2, 3, 4].map(i => (
        <View key={i} style={[styles.dot, i < current && styles.dotDone, i === current && styles.dotCurrent]} />
      ))}
    </View>
  );
}

function Welcome({ onBack, onProceed }: { onBack: () => void; onProceed: () => void }) {
  const welcome = useAppText('app.msme.registration.welcome');
  return (
    <View>
      <Text style={styles.welcome}>Welcome</Text>
      {welcome ? <HtmlText html={welcome.html} style={styles.body} /> : null}
      <Footer onBack={onBack} backTitle="BACK TO LOGIN" onProceed={onProceed} />
    </View>
  );
}

function ValidatedNote() {
  const note = useAppText('app.msme.registration.validatedNote');
  return note ? <Text style={styles.validated}>{htmlToPlain(note.html)}</Text> : null;
}

/** layout_enterprise_details: name, then Udyam Number, Unit Address, Entrepreneur Name, Social Category, Gender. */
function EnterpriseBox({ basic, short = false }: { basic: UdyamRecord; short?: boolean }) {
  const address = [text(basic, 'Address'), [text(basic, 'DISTRICT_NAME'), text(basic, 'state_name'), text(basic, 'PINCode')].filter(Boolean).join(', ')]
    .filter(Boolean)
    .join('\n');
  const rows: [string, string][] = short
    ? [['Udyam Number', text(basic, 'UdyogAadharNo')]]
    : [
        ['Udyam Number', text(basic, 'UdyogAadharNo')],
        ['Unit Address', address],
        ['Entrepreneur Name', text(basic, 'OwnerName')],
        ['Social Category', text(basic, 'SocialCategory')],
        ['Gender', text(basic, 'Gender')],
      ];
  return (
    <View style={styles.box} testID="enterprise-box">
      <Text style={styles.enterprise}>
        {text(basic, 'EnterpriseName')}
        {text(basic, 'EnterpriseType') ? <Text style={styles.type}>{'  ' + text(basic, 'EnterpriseType')}</Text> : null}
      </Text>
      {rows.map(([k, v]) => (
        <View key={k} style={styles.row}>
          <Text style={styles.rowLabel}>{k}</Text>
          <Text style={styles.rowValue}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

function Choice({
  title,
  detail,
  selected,
  selectTitle,
  onSelect,
  testID,
}: {
  title: string;
  detail: string;
  selected: boolean;
  selectTitle: string;
  onSelect: () => void;
  testID: string;
}) {
  return (
    <View style={[styles.box, selected && styles.selected]} testID={testID}>
      {title ? <Text style={styles.choiceTitle}>{title}</Text> : null}
      {detail ? <Text style={styles.body}>{detail}</Text> : null}
      <Pressable style={[styles.select, selected && styles.selectOn]} onPress={onSelect} testID={`${testID}-select`}>
        <Text style={[styles.selectText, selected && { color: colors.white }]}>{selected ? 'Selected' : selectTitle}</Text>
      </Pressable>
    </View>
  );
}

function Summary({
  email,
  basic,
  plant,
  activity,
  confirmed,
  onConfirm,
  onEdit,
  onBack,
  onProceed,
}: {
  email: string;
  basic: UdyamRecord;
  plant: UdyamRecord;
  activity: UdyamRecord;
  confirmed: boolean;
  onConfirm: (c: boolean) => void;
  onEdit: () => void;
  onBack: () => void;
  onProceed: () => void;
}) {
  const note = useAppText('app.msme.registration.emailNote');
  const confirm = useAppText('app.msme.registration.confirm.checkbox');
  return (
    <View>
      <Pressable onPress={onEdit}>
        <Text style={styles.heading}>Provided Email ID</Text>
      </Pressable>
      <Text style={styles.body} testID="summary-email">
        {email}
      </Text>
      {note ? <Text style={styles.note}>{htmlToPlain(note.html)}</Text> : null}
      <EnterpriseBox basic={basic} short />
      <Pressable onPress={onEdit}>
        <Text style={styles.heading}>Selected Unit</Text>
      </Pressable>
      <View style={styles.box}>
        <Text style={styles.choiceTitle}>{text(plant, 'UnitName')}</Text>
        <Text style={styles.body}>{plantAddress(plant)}</Text>
      </View>
      <Pressable onPress={onEdit}>
        <Text style={styles.heading}>Selected Activity</Text>
      </Pressable>
      <View style={styles.box}>
        <Text style={styles.choiceTitle}>{text(activity, 'Activity')}</Text>
        <Text style={styles.body}>{activityCodes(activity)}</Text>
      </View>
      <CheckBox label={confirm ? htmlToPlain(confirm.html) : ''} checked={confirmed} onChange={onConfirm} testID="summary-confirm" />
      <Footer onBack={onBack} onProceed={onProceed} proceedEnabled={confirmed} proceedTitle="PROCEED TO PLEDGE" />
    </View>
  );
}

function Pledge({ onBack, onPledge }: { onBack: () => void; onPledge: () => void }) {
  const pledge = useAppText('app.msme.registration.pledge');
  return (
    <View>
      {pledge ? <HtmlText html={pledge.html} style={styles.pledge} /> : null}
      <Footer onBack={onBack} onProceed={onPledge} proceedTitle="I/We Pledge" />
    </View>
  );
}

function Success({ onLogin }: { onLogin: () => void }) {
  const success = useAppText('app.msme.registration.success');
  return (
    <View testID="registration-success">
      <Text style={styles.welcome}>Registration Successful!</Text>
      {success ? <HtmlText html={success.html} style={styles.body} /> : null}
      <ZedButton title="Go To Login" onPress={onLogin} style={{ marginTop: dimens.padding3 }} testID="go-to-login" />
    </View>
  );
}

/** RegistrationEmailDialogFragment: the e-mail twice. */
function EmailDialog({ initial, onClose, onProceed }: { initial: string; onClose: () => void; onProceed: (email: string) => void }) {
  const note = useAppText('app.msme.registration.emailNote');
  const [email, setEmail] = useState(initial);
  const [again, setAgain] = useState(initial);
  const [error, setError] = useState<string | undefined>();
  const proceed = () => {
    const a = email.trim();
    if (!EMAIL.test(a)) return setError('Not a valid email');
    if (a.toLowerCase() !== again.trim().toLowerCase()) return setError('Email ID is not matching');
    setError(undefined);
    onProceed(a);
  };
  return (
    <ZedDialog visible title="Enter Email ID" onClose={onClose} cancelable={false} testID="email-dialog">
      {note ? <Text style={styles.note}>{htmlToPlain(note.html)}</Text> : null}
      <Text style={styles.label}>YOUR EMAIL ID</Text>
      <OutlinedInput value={email} onChangeText={t => (setEmail(t), setError(undefined))} keyboardType="email-address" autoCapitalize="none" testID="email" />
      <Text style={styles.label}>CONFIRM EMAIL ID</Text>
      <OutlinedInput value={again} onChangeText={t => (setAgain(t), setError(undefined))} keyboardType="email-address" autoCapitalize="none" error={error} testID="email-again" />
      <ZedButton title="Proceed" onPress={proceed} style={{ marginTop: dimens.padding2 }} testID="email-proceed" />
    </ZedDialog>
  );
}

/** VerifyEmailOtpDialogFragment: 4 characters; Resend after a countdown. */
function OtpDialog({ email, onClose, onSubmit, onResend }: { email: string; onClose: () => void; onSubmit: (otp: string) => void; onResend: () => void }) {
  const sent = useAppText('app.msme.registration.otpSent', { Email: email });
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [left, setLeft] = useState(OTP_RESEND_SECONDS);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft(l => l - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return (
    <ZedDialog visible title="Enter OTP" onClose={onClose} cancelable={false} testID="otp-dialog">
      {sent ? <Text style={styles.body}>{htmlToPlain(sent.html)}</Text> : null}
      <Text style={styles.label}>Please enter the OTP</Text>
      <OutlinedInput
        value={otp}
        onChangeText={t => (setOtp(t.toUpperCase()), setError(undefined))}
        maxLength={4}
        autoCapitalize="characters"
        placeholder="OTP (One Time Password)"
        error={error}
        testID="otp"
      />
      <ZedButton title="Resend OTP" onPress={onResend} disabled={left > 0} style={{ marginTop: dimens.padding2 }} testID="otp-resend" />
      {left > 0 ? <Text style={styles.note}>Resend OTP will be activated after {left} secs</Text> : null}
      <Text style={styles.note}>If you have not received the OTP, then please re-check the Email ID.</Text>
      <ZedButton title="Submit" onPress={() => (otp.trim() === '' ? setError('Please enter OTP') : onSubmit(otp.trim()))} testID="otp-submit" />
    </ZedDialog>
  );
}

const styles = StyleSheet.create({
  page: { padding: dimens.padding2, backgroundColor: colors.white, flexGrow: 1 },
  label: { ...textStyles.defaultLabel, marginTop: dimens.padding2 },
  heading: { ...textStyles.defaultLabel, color: colors.appColorDark, fontWeight: 'bold', marginTop: dimens.padding3 },
  body: { color: colors.black, fontSize: dimens.textSize14 },
  note: { color: colors.labelColor, fontSize: dimens.textSize14, marginVertical: dimens.padding1 },
  welcome: { fontSize: 24, fontWeight: 'bold', color: colors.black, marginBottom: dimens.padding2 },
  validated: { color: colors.appColorDark, fontSize: dimens.textSize14, marginBottom: dimens.padding2 },
  pledge: { fontSize: 18, color: colors.black, lineHeight: 28 },
  box: { ...shapes.lightGreyOutlineFilled, padding: dimens.padding2, marginTop: dimens.padding1 },
  selected: { borderColor: colors.appColor, borderWidth: 2 },
  enterprise: { fontSize: 16, fontWeight: 'bold', color: colors.black, marginBottom: dimens.padding1 },
  type: { fontSize: 12, fontWeight: 'normal', color: colors.appColorDark },
  row: { flexDirection: 'row', paddingVertical: 3 },
  rowLabel: { width: 130, color: colors.labelColor, fontSize: dimens.textSize14 },
  rowValue: { flex: 1, color: colors.black, fontSize: dimens.textSize14 },
  choiceTitle: { fontWeight: 'bold', color: colors.black, fontSize: 15, marginBottom: 2 },
  select: { alignSelf: 'flex-start', marginTop: dimens.padding1, borderWidth: 1, borderColor: colors.appColor, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 6 },
  selectOn: { backgroundColor: colors.appColor },
  selectText: { color: colors.appColorDark, fontWeight: 'bold' },
  dots: { flexDirection: 'row', justifyContent: 'center', marginBottom: dimens.padding2 },
  dot: { width: 10, height: 10, borderRadius: 5, marginHorizontal: 4, backgroundColor: colors.labelColor, opacity: 0.4 },
  dotDone: { backgroundColor: colors.appColor, opacity: 0.6 },
  dotCurrent: { backgroundColor: colors.appColor, opacity: 1 },
});
