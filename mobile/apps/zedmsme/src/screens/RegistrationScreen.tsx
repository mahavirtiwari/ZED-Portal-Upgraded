/**
 * RegistrationActivity and fragments/registration/* of the MSME code base: six pages in order (no swipe), the e-mail
 * and OTP dialogs between "Unit and Activity" and "Summary". Calls on the portal (Msme/), no sign-in.
 *
 * New in V4 (2.0): the Udyam record comes from the server (Msme/LookupUdyam), not from the Udyam service with a key
 * built into the app, and there is no SafetyNet captcha (the server limits the lookups instead). A wrong Udyam number,
 * mobile number or e-mail shows its message while typing (registrationValidation).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Image,
  Keyboard,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type ScrollViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  colors,
  dimens,
  errorOf,
  GradientFill,
  HtmlText,
  htmlToPlain,
  Icon,
  parseSimpleHtml,
  ScreenFrame,
  shapes,
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
import { icons } from '../assets/icons';
import { images } from '../assets/images';
import {
  confirmEmailError,
  EMAIL_ERROR,
  EMAIL_MISMATCH,
  emailError,
  isValidEmail,
  isValidMobile,
  isValidUdyam,
  MOBILE_START_ERROR,
  mobileError,
  sanitizeMobile,
  sanitizeUdyam,
  UDYAM_PREFIX,
  udyamError,
} from '../registrationValidation';
import { DarkHeading, Footer, IconRow, Note, OptionCard, RadioRow, RegistrationCommon } from '../ui/legacy';

const TITLES = ['Registration', 'Udyam Validation', 'Unit and Activity', 'Summary', 'ZED Pledge', 'Successful'];
const OTP_RESEND_SECONDS = 600;
const PLEDGE_GOLD_DARK = '#B1783B';
const PLEDGE_GOLD_LIGHT = '#EED17E';

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

/** The keyboard's height over the screen (edge to edge, the window no longer shrinks for it). */
function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', e =>
      setHeight(Math.max(e.endCoordinates.height, Dimensions.get('screen').height - e.endCoordinates.screenY)),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

export function RegistrationScreen() {
  const app = useMsme();
  const ui = useUi();
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const [page, setPage] = useState(0);
  const [udyam, setUdyam] = useState(UDYAM_PREFIX);
  const [udyamTouched, setUdyamTouched] = useState(false);
  const [mobile, setMobile] = useState('');
  const [mobileTouched, setMobileTouched] = useState(false);
  const [mobileStartError, setMobileStartError] = useState(false);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [plant, setPlant] = useState<number | null>(null);
  const [activity, setActivity] = useState<number | null>(null);
  const [email, setEmail] = useState('');
  const [dialog, setDialog] = useState<'email' | 'otp' | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  // PledgeFragment: I/We Pledge waits until the pledge text has moved in.
  const [pledgeShown, setPledgeShown] = useState(false);
  const busy = useRef(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const activityY = useRef(0);

  // Back: from the first and the last page the registration closes; otherwise one page back (not while loading).
  useBackHandler(() => {
    if (ui.isLoading) return true;
    if (page === 0 || page === 5) return false;
    setPage(p => p - 1);
    return true;
  });

  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [page]);

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

  const choosePlant = (i: number) => {
    setPlant(i);
    setActivity(null);
    // The activities follow the plants: bring them into view (after they are laid out).
    setTimeout(() => scroll.current?.scrollTo({ y: activityY.current, animated: true }), 50);
  };

  const footer =
    page === 0 ? (
      <Footer onBack={() => nav.pop()} backTitle="Back to Login" onProceed={() => setPage(1)} />
    ) : page === 1 ? (
      <Footer onBack={back} onProceed={validateUdyam} proceedEnabled={isValidUdyam(udyam) && isValidMobile(mobile)} />
    ) : page === 2 ? (
      <Footer onBack={back} onProceed={validatePlant} proceedEnabled={chosenPlant != null && chosenActivity != null} />
    ) : page === 3 ? (
      <Footer onBack={back} onProceed={() => (setPledgeShown(false), setPage(4))} proceedEnabled={confirmed} proceedTitle="Proceed to Pledge" />
    ) : page === 4 ? (
      <Footer onBack={back} onProceed={pledge} proceedEnabled={pledgeShown} proceedTitle="I/We Pledge" />
    ) : null;

  return (
    <ScreenFrame title={TITLES[page] ?? 'Registration'} testID="registration">
      <View style={[styles.body, { paddingBottom: Math.max(0, keyboard - insets.bottom) }]}>
        <ScrollView ref={scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" testID={`registration-page-${page}`}>
          {/* The pledge keeps the Summary's step (statusThree current) and hides the banner (it is in the frame). */}
          {page <= 4 ? <RegistrationCommon current={page === 4 ? 2 : page - 1} banner={page !== 4} /> : null}
          {page === 0 ? <Welcome /> : null}
          {page === 1 ? (
            <View>
              <Text style={styles.fieldLabel}>Enter your Udyam Registration Number:</Text>
              <RegInput
                value={udyam}
                onChangeText={t => setUdyam(sanitizeUdyam(t))}
                onBlur={() => setUdyamTouched(true)}
                floatingLabel="UDYAM-XX-99-9999999"
                helper="(as provided at the time of Udyam Registration)"
                error={udyamError(udyam, udyamTouched)}
                autoCapitalize="characters"
                testID="udyam-number"
              />
              <Text style={styles.fieldLabel}>Enter your Udyam Registered Mobile Number:</Text>
              <RegInput
                value={mobile}
                keyboardType="phone-pad"
                maxLength={10}
                onChangeText={t => {
                  // Utils.validateFirstCharOfPhoneNumber: a mobile number cannot begin with 0-5 (the field is emptied).
                  const m = sanitizeMobile(t);
                  setMobileStartError(m.startError);
                  setMobile(m.value);
                }}
                onBlur={() => setMobileTouched(true)}
                helper="(As mentioned on the Udyam Registration)"
                error={mobileStartError ? MOBILE_START_ERROR : mobileError(mobile, mobileTouched)}
                testID="udyam-mobile"
              />
            </View>
          ) : null}
          {page === 2 && lookup ? (
            <View>
              <ValidatedNote />
              <DarkHeading title="Basic Information" />
              <EnterpriseCard basic={lookup.basic} />
              <Text style={styles.select}>Please select any one Plant location and its activity</Text>
              <DarkHeading title="Plant Location" />
              {lookup.plants.map((p, i) => (
                <View key={`plant-${i}`} testID={`plant-${i}`}>
                  <OptionCard selected={plant === i} onPress={() => choosePlant(i)} disabled={registeredZedId(p) != null} testID={`plant-${i}-select`}>
                    {registeredZedId(p) != null ? (
                      <Unavailable
                        text={`Already registered${registeredZedId(p) ? ': ' + registeredZedId(p) : ''}. Log in with its ZED ID.`}
                        testID={`plant-${i}-registered`}
                      />
                    ) : (
                      <RadioRow selected={plant === i} label="Select this Unit" />
                    )}
                    {text(p, 'UnitName') ? <IconRow icon={icons.ic_plant_name} text={text(p, 'UnitName')} /> : null}
                    {plantAddress(p) ? <IconRow icon={icons.ic_location_teal} text={plantAddress(p)} /> : null}
                  </OptionCard>
                </View>
              ))}
              <View onLayout={e => (activityY.current = e.nativeEvent.layout.y)}>
                {chosenPlant ? (
                  <View>
                    <Note tone="yellow" style={styles.activityNote} testID="activity-note">
                      <Text style={styles.centred}>
                        Please select Plant activity for the selected Plant location:{'\n'}
                        <Text style={{ fontWeight: 'bold' }}>{plantAddress(chosenPlant)}</Text>
                      </Text>
                    </Note>
                    {lookup.activities.map((a, i) => (
                      <View key={`activity-${i}`} testID={`activity-${i}`}>
                        <OptionCard selected={activity === i} onPress={() => setActivity(i)} disabled={notEligible(a) != null} testID={`activity-${i}-select`}>
                          {notEligible(a) != null ? (
                            <Unavailable text={notEligible(a)!} testID={`activity-${i}-not-eligible`} />
                          ) : (
                            <RadioRow selected={activity === i} label="Select this Activity" />
                          )}
                          <ActivityRows activity={a} />
                        </OptionCard>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
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
              onEditEmail={() => setDialog('email')}
              onEdit={() => setPage(2)}
            />
          ) : null}
          {page === 4 ? <Pledge onShown={() => setPledgeShown(true)} /> : null}
          {page === 5 ? <Success onLogin={() => nav.reset([{ name: 'Launcher' }])} /> : null}
        </ScrollView>
        {footer}
      </View>
      {dialog === 'email' ? <EmailDialog initial={email} onClose={() => setDialog(null)} onProceed={sendOtp} /> : null}
      {dialog === 'otp' ? (
        <OtpDialog email={email} onClose={() => setDialog(null)} onSubmit={verifyOtp} onResend={() => (setDialog(null), sendOtp(email))} />
      ) : null}
    </ScreenFrame>
  );
}

/**
 * TextInputLayout (OutlinedBox) of the registration pages: the hint on the outline, the helper text under it, the
 * error in its place when there is one.
 */
function RegInput({
  value,
  onChangeText,
  onBlur,
  floatingLabel,
  placeholder,
  helper,
  error,
  keyboardType,
  maxLength,
  autoCapitalize = 'none',
  testID,
}: {
  value: string;
  onChangeText: (t: string) => void;
  onBlur?: () => void;
  floatingLabel?: string;
  placeholder?: string;
  helper?: string;
  error?: string;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  testID?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.inputWrap}>
      <View style={[styles.outline, focused && styles.outlineFocused, error != null && styles.outlineError]}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          maxLength={maxLength}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          placeholder={placeholder}
          placeholderTextColor={colors.labelColor}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          testID={testID}
        />
        {floatingLabel ? (
          <Text style={[styles.floating, focused && { color: colors.appColor }, error != null && { color: colors.error }]}>{floatingLabel}</Text>
        ) : null}
      </View>
      {error != null ? (
        <Text style={styles.error} testID={testID ? `${testID}-error` : undefined}>
          {error}
        </Text>
      ) : helper ? (
        <Text style={styles.helper}>{helper}</Text>
      ) : null}
    </View>
  );
}

/** New (2026-11-07): the server marks a registered plant with its ZED ID (partly hidden) when it looks the record up. */
function registeredZedId(plant: UdyamRecord): string | null {
  const v = (plant as Record<string, unknown>).V4RegisteredZedId;
  return typeof v === 'string' ? v : null;
}

/** New (2026-11-07): the reason an activity cannot be registered (the scheme does not cover it), from the server. */
function notEligible(activity: UdyamRecord): string | null {
  const v = (activity as Record<string, unknown>).V4NotEligible;
  return typeof v === 'string' && v.trim() ? v : null;
}

/** Why a plant or an activity cannot be chosen, in place of its radio button. */
function Unavailable({ text: message, testID }: { text: string; testID?: string }) {
  return (
    <View style={styles.unavailable} testID={testID}>
      <Text style={styles.unavailableText}>{message}</Text>
    </View>
  );
}

/** fragment_msme_registration: Welcome, what to keep ready, and the Udyam Registration link in the green box. */
function Welcome() {
  const welcome = useAppText('app.msme.registration.welcome');
  const html = welcome?.html ?? '';
  // The paragraph with the link goes in the green box (point_three, registration_link, point_four).
  const m = /<p>((?:(?!<\/p>)[\s\S])*?)<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)<\/p>/i.exec(html);
  const before = m ? html.slice(0, m.index) : html;
  return (
    <View testID="welcome">
      <Text style={styles.welcome}>Welcome</Text>
      {before ? <HtmlText html={before} style={styles.welcomeText} paragraphGap={16} /> : null}
      {m ? (
        <Note tone="green" style={styles.linkBox}>
          {htmlToPlain(m[1] ?? '').trim() ? <Text style={[styles.welcomeText, styles.centred, styles.linkBoxText]}>{htmlToPlain(m[1] ?? '').trim()}</Text> : null}
          <Pressable style={styles.link} onPress={() => Linking.openURL(m[2] ?? '').catch(() => undefined)} testID="udyam-link">
            <Text style={styles.linkText}>{htmlToPlain(m[3] ?? '').trim() || m[2]}</Text>
            <Icon icon={icons.ic_external_link} size={30} />
          </Pressable>
          {htmlToPlain(m[4] ?? '').trim() ? <Text style={[styles.welcomeText, styles.centred, styles.linkBoxText]}>{htmlToPlain(m[4] ?? '').trim()}</Text> : null}
        </Note>
      ) : null}
    </View>
  );
}

function ValidatedNote() {
  const note = useAppText('app.msme.registration.validatedNote');
  return note ? (
    <Note tone="green" center testID="validated-note">
      {htmlToPlain(note.html)}
    </Note>
  ) : null;
}

function enterpriseTypeImage(type: string) {
  if (type === 'Micro') return images.ic_micro;
  if (type === 'Small') return images.ic_small;
  if (type === 'Medium') return images.ic_medium;
  return null;
}

/** layout_enterprise_details: the type badge, the name, then Unit Address, Entrepreneur Name, Social Category, Gender, Udyam Number. */
function EnterpriseCard({ basic, short = false }: { basic: UdyamRecord; short?: boolean }) {
  const address = [text(basic, 'Address'), [text(basic, 'DISTRICT_NAME'), text(basic, 'state_name'), text(basic, 'PINCode')].filter(Boolean).join(', ')]
    .filter(Boolean)
    .join('\n');
  const rows: [string, string][] = short
    ? [['Udyam Number', text(basic, 'UdyogAadharNo')]]
    : [
        ['Unit Address', address],
        ['Entrepreneur Name', text(basic, 'OwnerName')],
        ['Social Category', text(basic, 'SocialCategory')],
        ['Gender', text(basic, 'Gender')],
        ['Udyam Number', text(basic, 'UdyogAadharNo')],
      ];
  const type = text(basic, 'EnterpriseType');
  const badge = enterpriseTypeImage(type);
  return (
    <View style={styles.enterprise} testID="enterprise-box">
      {badge ? <Image source={badge} style={styles.badge} /> : type ? <Text style={styles.type}>{type.toUpperCase()}</Text> : null}
      <Text style={styles.enterpriseName}>{text(basic, 'EnterpriseName')}</Text>
      {rows
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <View key={k} style={styles.row}>
            <Text style={styles.rowLabel}>{k}</Text>
            <Text style={styles.rowValue}>{v}</Text>
          </View>
        ))}
    </View>
  );
}

/** layout_activity_selection: the activity, then its 2, 4 and 5 digit codes. */
function ActivityRows({ activity }: { activity: UdyamRecord }) {
  return (
    <View>
      {text(activity, 'Activity') ? <IconRow icon={icons.ic_manufacturing} text={text(activity, 'Activity')} /> : null}
      {text(activity, 'Two_DigitActivity') ? <IconRow icon={icons.ic_manufacturing_two} text={text(activity, 'Two_DigitActivity')} /> : null}
      {text(activity, 'Four_DigitActivity') ? <IconRow icon={icons.ic_manufacturing_three} text={text(activity, 'Four_DigitActivity')} /> : null}
      {text(activity, 'Five_DigitActivity') ? <IconRow icon={icons.ic_manufacturing_four} text={text(activity, 'Five_DigitActivity')} /> : null}
    </View>
  );
}

/** The confirmation check box on the yellow box (teal outline, filled when ticked). */
function ConfirmBox({ label, checked, onChange, testID }: { label: string; checked: boolean; onChange: (c: boolean) => void; testID?: string }) {
  return (
    <Pressable
      style={styles.confirm}
      onPress={() => onChange(!checked)}
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}>
      <View style={[styles.confirmBox, checked && styles.confirmBoxOn]}>
        {checked ? <Text style={styles.confirmTick}>✓</Text> : null}
      </View>
      <Text style={styles.confirmText}>{label}</Text>
    </Pressable>
  );
}

/** fragment_registration_summary: the e-mail, the enterprise, the unit and the activity, each with its edit pencil. */
function Summary({
  email,
  basic,
  plant,
  activity,
  confirmed,
  onConfirm,
  onEditEmail,
  onEdit,
}: {
  email: string;
  basic: UdyamRecord;
  plant: UdyamRecord;
  activity: UdyamRecord;
  confirmed: boolean;
  onConfirm: (c: boolean) => void;
  onEditEmail: () => void;
  onEdit: () => void;
}) {
  const note = useAppText('app.msme.registration.emailNote');
  const confirm = useAppText('app.msme.registration.confirm.checkbox');
  const label = confirm ? htmlToPlain(confirm.html) : '';
  return (
    <View>
      <DarkHeading title="Provided Email ID" onEdit={onEditEmail} testID="summary-email-heading" />
      <View style={styles.emailRow}>
        <Icon icon={icons.ic_email_teal} size={20} />
        <Text style={styles.emailText} testID="summary-email">
          {email}
        </Text>
      </View>
      {note ? (
        <Note tone="green" center>
          {htmlToPlain(note.html).replace(/ on this Email ID\.?$/, ' on the above Email ID')}
        </Note>
      ) : null}
      <EnterpriseCard basic={basic} short />
      <DarkHeading title="Selected Unit" onEdit={onEdit} testID="summary-unit-heading" />
      <View style={styles.outlined}>
        {text(plant, 'UnitName') ? <IconRow icon={icons.ic_plant_name} text={text(plant, 'UnitName')} /> : null}
        {plantAddress(plant) ? <IconRow icon={icons.ic_location_teal} text={plantAddress(plant)} /> : null}
      </View>
      <DarkHeading title="Selected Activity" onEdit={onEdit} testID="summary-activity-heading" />
      <View style={styles.outlined}>
        <ActivityRows activity={activity} />
      </View>
      <View style={styles.confirmWrap}>
        <ConfirmBox label={label} checked={confirmed} onChange={onConfirm} testID="summary-confirm" />
      </View>
    </View>
  );
}

/** fragment_pledge: the gold frame with the PLEDGE tag, the ZED banner and the pledge on its cream box. */
function Pledge({ onShown }: { onShown: () => void }) {
  const pledge = useAppText('app.msme.registration.pledge');
  // anim/pledge_text: the text moves up from 650 to its place in 5 s.
  const y = useRef(new Animated.Value(650)).current;
  useEffect(() => {
    Animated.timing(y, { toValue: 0, duration: 5000, useNativeDriver: true }).start(() => onShown());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View style={styles.pledgeFrame} testID="pledge">
      <GradientFill from={PLEDGE_GOLD_LIGHT} to={PLEDGE_GOLD_DARK} angle="diagonal" />
      <View style={styles.pledgeInner}>
        <Image source={images.zed_banner} style={styles.pledgeBanner} resizeMode="contain" />
        {pledge ? (
          <Animated.Text style={[styles.pledgeText, { transform: [{ translateY: y }] }]}>{htmlToPlain(pledge.html)}</Animated.Text>
        ) : null}
      </View>
      <Image source={images.pledge_text} style={styles.pledgeTag} />
    </View>
  );
}

/** fragment_registration_success: the illustration, then the Admin's text (paragraphs bold, items as bullets). */
function Success({ onLogin }: { onLogin: () => void }) {
  const success = useAppText('app.msme.registration.success');
  const blocks = success ? parseSimpleHtml(success.html) : [];
  return (
    <View testID="registration-success">
      <View style={styles.successCard}>
        <Image source={images.ic_registration_success} style={styles.successImage} resizeMode="contain" />
        <Text style={styles.successTitle}>Registration Successful!</Text>
        {blocks.map((b, i) =>
          b.marker ? (
            <View key={i} style={styles.bullet}>
              <Text style={styles.successText}>•</Text>
              <Text style={[styles.successText, { flex: 1, marginLeft: dimens.padding3 }]}>
                {b.runs.map((r, j) => (
                  <Text key={j} style={r.bold ? { fontWeight: 'bold' } : undefined}>
                    {r.text}
                  </Text>
                ))}
              </Text>
            </View>
          ) : (
            <Text key={i} style={[styles.successText, styles.successHeading]}>
              {b.runs.map(r => r.text).join('')}
            </Text>
          ),
        )}
      </View>
      <ZedButton title="Go To Login" onPress={onLogin} small style={styles.centredButton} testID="go-to-login" />
    </View>
  );
}

/** RegistrationEmailDialogFragment: the e-mail twice. */
function EmailDialog({ initial, onClose, onProceed }: { initial: string; onClose: () => void; onProceed: (email: string) => void }) {
  const note = useAppText('app.msme.registration.emailNote');
  const [email, setEmail] = useState(initial);
  const [again, setAgain] = useState(initial);
  const [touched, setTouched] = useState({ email: false, again: false });
  const [submitError, setSubmitError] = useState<string | undefined>();
  const proceed = () => {
    setTouched({ email: true, again: true });
    const a = email.trim();
    if (!isValidEmail(a)) return setSubmitError(EMAIL_ERROR);
    if (a.toLowerCase() !== again.trim().toLowerCase()) return setSubmitError(EMAIL_MISMATCH);
    setSubmitError(undefined);
    onProceed(a);
  };
  const emailMessage = emailError(email, touched.email) ?? (submitError === EMAIL_ERROR ? EMAIL_ERROR : undefined);
  const againMessage =
    confirmEmailError(email, again, touched.again) ?? (submitError === EMAIL_MISMATCH && !emailMessage ? EMAIL_MISMATCH : undefined);
  return (
    <ZedDialog visible title="Enter Email ID" onClose={onClose} cancelable={false} testID="email-dialog">
      {note ? (
        <Note tone="green" style={styles.dialogNote}>
          {htmlToPlain(note.html)}
        </Note>
      ) : null}
      <Text style={styles.dialogLabel}>YOUR EMAIL ID</Text>
      <RegInput
        value={email}
        onChangeText={t => (setEmail(t), setSubmitError(undefined))}
        onBlur={() => setTouched(s => ({ ...s, email: true }))}
        keyboardType="email-address"
        error={emailMessage}
        testID="email"
      />
      <Text style={styles.dialogLabel}>CONFIRM EMAIL ID</Text>
      <RegInput
        value={again}
        onChangeText={t => (setAgain(t), setSubmitError(undefined))}
        onBlur={() => setTouched(s => ({ ...s, again: true }))}
        keyboardType="email-address"
        error={againMessage}
        testID="email-again"
      />
      <ZedButton title="Proceed" onPress={proceed} small style={styles.centredButton} testID="email-proceed" />
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
      {sent ? (
        <Note tone="green" style={styles.dialogNote}>
          {htmlToPlain(sent.html)}
        </Note>
      ) : null}
      <Text style={styles.otpLabel}>Please enter the OTP</Text>
      <RegInput
        value={otp}
        onChangeText={t => (setOtp(t.toUpperCase()), setError(undefined))}
        maxLength={4}
        autoCapitalize="characters"
        placeholder="OTP (One Time Password)"
        error={error}
        testID="otp"
      />
      <ZedButton title="Resend OTP" onPress={onResend} disabled={left > 0} small style={styles.centredButton} testID="otp-resend" />
      {left > 0 ? (
        <Note tone="blue" style={styles.dialogNote}>
          {`Resend OTP will be activated after ${left} secs`}
        </Note>
      ) : null}
      <Note tone="yellow" style={styles.dialogNote}>
        If you have not received the OTP, then please re-check the Email ID.
      </Note>
      <ZedButton
        title="Submit"
        onPress={() => (otp.trim() === '' ? setError('Please enter OTP') : onSubmit(otp.trim()))}
        small
        style={styles.centredButton}
        testID="otp-submit"
      />
    </ZedDialog>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  page: { padding: dimens.padding4, backgroundColor: colors.white, flexGrow: 1 },
  centred: { textAlign: 'center' },
  fieldLabel: { fontWeight: 'bold', color: colors.textColor, fontSize: 18, marginTop: dimens.padding3, marginBottom: dimens.padding2 },
  inputWrap: { marginHorizontal: dimens.padding1, marginBottom: dimens.padding2 },
  outline: { borderWidth: 1, borderColor: colors.labelColor, borderRadius: 4, minHeight: 56, justifyContent: 'center', backgroundColor: colors.white },
  outlineFocused: { borderColor: colors.appColor, borderWidth: 2 },
  outlineError: { borderColor: colors.error, borderWidth: 2 },
  input: { fontSize: 18, color: colors.black, paddingHorizontal: dimens.padding4, paddingVertical: dimens.padding3 },
  floating: {
    position: 'absolute',
    top: -10,
    left: 12,
    paddingHorizontal: 4,
    backgroundColor: colors.white,
    color: colors.labelColor,
    fontSize: 13,
    letterSpacing: 0.4,
  },
  helper: { color: colors.labelColor, fontSize: 14, marginTop: 4, marginLeft: dimens.padding4, letterSpacing: 0.4 },
  error: { color: colors.error, fontSize: 14, marginTop: 4, marginLeft: dimens.padding4 },
  welcome: { fontSize: dimens.textSize2, fontWeight: 'bold', color: colors.black, marginBottom: dimens.padding4 },
  welcomeText: { color: colors.black, fontSize: dimens.textSize, lineHeight: 23 },
  linkBox: { padding: dimens.padding3, marginTop: dimens.padding4 },
  unavailable: { backgroundColor: colors.yellow, borderRadius: 4, paddingVertical: dimens.padding1, paddingHorizontal: dimens.padding2, margin: dimens.padding1 },
  unavailableText: { color: colors.darkGrey, fontSize: 14, fontWeight: 'bold' },
  linkBoxText: { padding: dimens.padding2 },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center', // the address and its icon centred together in the bar
    backgroundColor: colors.appColorSecondary,
    borderRadius: 5,
    paddingVertical: dimens.padding1,
    paddingLeft: dimens.padding2,
    paddingRight: dimens.padding1,
  },
  linkText: { flexShrink: 1, color: colors.black, fontSize: dimens.textSize, textAlign: 'center', marginRight: dimens.padding1 },
  select: { fontSize: dimens.textSize3, fontWeight: 'bold', color: colors.black, marginVertical: dimens.padding2, lineHeight: 30 },
  activityNote: { backgroundColor: colors.activitySelectTextBackground, marginTop: dimens.padding3 },
  enterprise: { ...shapes.greyRectangle, padding: dimens.padding2, marginVertical: dimens.padding1 },
  badge: { margin: dimens.padding1 },
  type: { margin: dimens.padding1, fontSize: 12, fontWeight: 'bold', color: colors.labelColor },
  enterpriseName: { margin: dimens.padding1, fontSize: 20, fontWeight: 'bold', color: colors.black },
  row: { paddingHorizontal: dimens.padding1, paddingVertical: dimens.padding1 },
  rowLabel: { color: colors.labelColor, fontSize: dimens.textSize },
  rowValue: { color: colors.black, fontSize: dimens.textSize, lineHeight: 23, marginTop: 2 },
  emailRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.lightGrey2, borderRadius: 5, padding: dimens.padding3, marginTop: dimens.padding1 },
  emailText: { flex: 1, marginLeft: dimens.padding3, color: colors.black, fontSize: dimens.textSize },
  outlined: {
    borderWidth: 2,
    borderColor: colors.progressBarColor,
    borderRadius: 5,
    padding: dimens.padding2,
    paddingTop: 0,
    marginVertical: dimens.padding2,
  },
  confirmWrap: { backgroundColor: colors.yellow, borderRadius: 5, marginVertical: dimens.padding3 },
  confirm: { flexDirection: 'row', alignItems: 'center', padding: dimens.padding3 },
  confirmBox: { width: 22, height: 22, borderWidth: 2, borderColor: colors.appColor, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  confirmBoxOn: { backgroundColor: colors.appColor },
  confirmTick: { color: colors.white, fontWeight: 'bold', fontSize: 14, lineHeight: 16 },
  confirmText: { flex: 1, marginLeft: dimens.padding3, color: colors.black, fontSize: dimens.textSize, lineHeight: 23 },
  pledgeFrame: { borderRadius: 2, overflow: 'hidden', paddingBottom: dimens.padding3 },
  pledgeInner: { margin: dimens.padding3, marginBottom: 0, backgroundColor: colors.white, padding: dimens.padding2, overflow: 'hidden' },
  pledgeBanner: { width: '100%', height: 72, marginBottom: dimens.padding2 },
  pledgeText: {
    margin: dimens.padding3,
    padding: dimens.padding4,
    backgroundColor: colors.pledgeTextBackground,
    borderRadius: 5,
    textAlign: 'center',
    fontSize: dimens.textSize2,
    fontWeight: 'bold',
    fontStyle: 'italic',
    color: colors.black,
    lineHeight: 28,
  },
  pledgeTag: { position: 'absolute', top: 0, left: 0, width: 34, height: 104, backgroundColor: colors.white },
  successCard: { ...shapes.greyRectangle, margin: dimens.padding3, padding: dimens.padding4 },
  successImage: { width: 256, height: 256, alignSelf: 'center' },
  successTitle: { textAlign: 'center', fontSize: dimens.textSize2, fontWeight: 'bold', color: colors.black, marginTop: dimens.padding3 },
  successText: { color: colors.black, fontSize: dimens.textSize, lineHeight: 23 },
  successHeading: { fontWeight: 'bold', marginVertical: dimens.padding3 },
  bullet: { flexDirection: 'row', marginVertical: dimens.padding1, paddingLeft: dimens.padding2 },
  centredButton: { alignSelf: 'center', marginTop: dimens.padding3 },
  dialogNote: { marginBottom: dimens.padding3 },
  dialogLabel: { fontWeight: 'bold', color: colors.textColor, fontSize: dimens.textSize, marginTop: dimens.padding2, marginBottom: dimens.padding2, letterSpacing: 0.5 },
  otpLabel: { fontWeight: 'bold', color: colors.textColor, fontSize: dimens.textSize, marginBottom: dimens.padding2 },
});
