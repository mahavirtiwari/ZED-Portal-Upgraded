import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  colors,
  dimens,
  errorOf,
  Icon,
  isSuccess,
  OutlinedInput,
  ScreenFrame,
  textStyles,
  useNavigation,
  useRoute,
  useUi,
  ZedButton,
  ZedDialog,
  type BaseServiceResponse,
} from '@zed/shared';
import type { ProfileRow, UdyamActivity } from '../api';
import { icons } from '../assets/icons';
import { useOpenDrawer } from '../app/AppDrawer';
import { useMsme } from '../app/context';
import { basicDetailsAddress } from '../models';

/** The Udyam details in the web's order; the first ones show at once, the rest under "Show all details". */
const BASIC_INFO: Array<{ label: string; field: string; main?: boolean }> = [
  { label: 'Enterprise Name', field: 'EnterpriseName', main: true },
  { label: 'Udyam Number', field: 'UdyogAadharNo', main: true },
  { label: 'Owner Name', field: 'OwnerName', main: true },
  { label: 'Enterprise Type', field: 'EnterpriseTypee', main: true },
  { label: 'PAN', field: 'PanNo', main: true },
  { label: 'Registered Address', field: 'Address', main: true },
  { label: 'District', field: 'DistrictName', main: true },
  { label: 'State', field: 'StateName', main: true },
  { label: 'Pincode', field: 'Pincode' },
  { label: 'Organisation Type', field: 'OrganisationTypeName' },
  { label: 'Social Category', field: 'SocialCategoryName' },
  { label: 'Gender', field: 'Gender' },
  { label: 'E-mail (Udyam)', field: 'EmailId' },
  { label: 'Physically Handicapped', field: 'PH' },
  { label: 'Major Activity', field: 'MajorActivityName' },
  { label: 'Commencement Date', field: 'CommmenceDate' },
  { label: 'Total Employee', field: 'TotalEmp' },
  { label: 'DIC Name', field: 'DicName' },
  { label: 'Applied Date', field: 'AppliedDate' },
];

const text = (row: ProfileRow | null | undefined, field: string) => {
  const v = row?.[field];
  return v === null || v === undefined ? '' : String(v);
};

async function call<T extends BaseServiceResponse>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    return { status: '0', errorMessage: e instanceof Error && e.message ? e.message : 'Unknown error occurred' } as T;
  }
}

/**
 * MyAccountActivity ("Enterprise Profile"), redesigned 2026-11-07 in line with the web profile: the enterprise from Udyam,
 * the contact with the change of the registered e-mail (OTP to the new address), the selected unit (plant) and its NIC
 * activity with Edit. Read from the portal (Msme/AppProfile); offline, the login's copy.
 */
export function MyAccountScreen() {
  const app = useMsme();
  const nav = useNavigation();
  const ui = useUi();
  const route = useRoute<{ showProceed?: boolean; hideHeaderMenu?: boolean }>();
  const openDrawer = useOpenDrawer('profile');
  const details = app.user?.MsmeDetails;
  const [msme, setMsme] = useState<ProfileRow | null>(null);
  const [basic, setBasic] = useState<ProfileRow | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [emailStep, setEmailStep] = useState<'idle' | 'enter' | 'otp'>('idle');
  const [newEmail, setNewEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [activities, setActivities] = useState<UdyamActivity[] | null>(null);
  const [chosen, setChosen] = useState('');

  const load = useCallback(async () => {
    ui.showLoading();
    const r = await call(() => app.api.getProfile());
    ui.hideLoading();
    if (isSuccess(r)) {
      setMsme(r.Msme ?? {});
      setBasic(r.BasicInfo ?? {});
      setRegisteredEmail(r.RegisteredEmail ?? null);
      setOffline(false);
    } else setOffline(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Offline: the login's copy of the Udyam details (no change possible).
  const legacy = details?.BasicDetails;
  const shownBasic: ProfileRow = basic ?? {
    EnterpriseName: legacy?.EnterpriseName,
    UdyogAadharNo: (legacy as Record<string, string | undefined> | undefined)?.UdyogAadharNo,
    Address: legacy ? basicDetailsAddress(legacy) : '',
    DistrictName: legacy?.DISTRICT_NAME,
    StateName: legacy?.state_name,
    Pincode: legacy?.PINCode,
    EmailId: legacy?.EmailId,
    MobileNo: legacy?.MobileNo,
  };
  const unitAddress = ['PAddress', 'PDistrictName', 'PStateName', 'PPin'].map(f => text(msme, f)).filter(x => x.trim()).join(', ');
  const rows = BASIC_INFO.filter(r => (showAll || r.main) && text(shownBasic, r.field).trim());

  const sendOtp = async () => {
    const email = newEmail.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 100) return ui.showAlert('Please enter a valid e-mail address.');
    ui.showLoading();
    const r = await call(() => app.api.sendEmailOtp(email));
    ui.hideLoading();
    if (!isSuccess(r)) return ui.showAlert(errorOf(r));
    setOtp('');
    setEmailStep('otp');
  };

  const verifyOtp = async () => {
    if (!/^[0-9]{6}$/.test(otp.trim())) return ui.showAlert('Please enter the 6-digit OTP.');
    ui.showLoading();
    const r = await call(() => app.api.verifyEmailOtp(otp.trim()));
    ui.hideLoading();
    if (!isSuccess(r)) return ui.showAlert(errorOf(r));
    setRegisteredEmail(r.Email ?? newEmail.trim());
    setEmailStep('idle');
    ui.showAlert('Your registered e-mail has been changed.', 'Success!');
  };

  const editActivity = async () => {
    ui.showLoading();
    const r = await call(() => app.api.getProfileActivities());
    ui.hideLoading();
    if (!isSuccess(r) || !r.Activities) return ui.showAlert(errorOf(r));
    setActivities(r.Activities);
    setChosen(text(msme, 'FiveDigitActivity'));
  };

  const updateActivity = async () => {
    if (!chosen || chosen === text(msme, 'FiveDigitActivity')) return;
    ui.showLoading();
    const r = await call(() => app.api.updateProfileActivity(chosen));
    ui.hideLoading();
    if (!isSuccess(r)) return ui.showAlert(errorOf(r));
    setActivities(null);
    await load();
    ui.showAlert('Activity updated successfully.', 'Success!');
  };

  const showLocationOnMaps = () => {
    if (!unitAddress) return ui.showAlert('Invalid Address');
    Linking.openURL('geo:0,0?q=' + unitAddress.replace(/ /g, '+')).catch(() => ui.showAlert('Failed to load given Address'));
  };

  return (
    <ScreenFrame
      title="Enterprise Profile"
      onMenu={route.params?.hideHeaderMenu ? undefined : openDrawer}
      backBar={{ zedId: details?.ZedId, onBack: () => nav.pop() }}
      testID="my-account">
      <ScrollView>
        <View style={styles.container}>
          {offline ? <Text style={styles.offline}>Offline: showing the details saved on this phone. Changes need a connection.</Text> : null}

          <Card title="Enterprise (from Udyam)" right={<Text style={styles.idChip}>{details?.ZedId ?? text(msme, 'ZedId')}</Text>}>
            {rows.map(r => (
              <Field key={r.field} label={r.label} value={text(shownBasic, r.field)} />
            ))}
            <Pressable onPress={() => setShowAll(s => !s)} testID="profile-show-all">
              <Text style={styles.link}>{showAll ? 'Show fewer details' : 'Show all details'}</Text>
            </Pressable>
          </Card>

          <Card title="Contact">
            <Field label="Registered e-mail (ZED mails, password links)" value={registeredEmail ?? text(shownBasic, 'EmailId')} />
            {!offline && emailStep === 'idle' ? (
              <ZedButton title="Change e-mail" small style={styles.inlineButton} onPress={() => (setNewEmail(''), setEmailStep('enter'))} testID="email-change" />
            ) : null}
            <Field label="Mobile" value={text(shownBasic, 'MobileNo')} />
          </Card>

          <Card title="Selected unit (plant)">
            <Pressable onPress={showLocationOnMaps}>
              <Text style={styles.unitName}>{text(msme, 'PUnitName') || '—'}</Text>
              <View style={styles.addressRow}>
                <Text style={styles.value}>{unitAddress || '—'}</Text>
                {unitAddress ? <Icon icon={icons.baseline_location_on_24} /> : null}
              </View>
            </Pressable>
          </Card>

          <Card
            title="Unit activity (NIC)"
            right={
              !offline && !activities ? (
                <Pressable onPress={editActivity} testID="activity-edit">
                  <Text style={styles.link}>Edit</Text>
                </Pressable>
              ) : null
            }>
            {activities ? (
              <View>
                {activities.map(a => {
                  const on = a.Five_DigitActivity === chosen;
                  return (
                    <Pressable key={a.Five_DigitActivity} onPress={() => setChosen(a.Five_DigitActivity)} style={[styles.option, on && styles.optionOn]} testID="activity-option">
                      <Text style={styles.value}>{a.Two_DigitActivity}</Text>
                      <Text style={styles.small}>{[a.Activity, a.Four_DigitActivity, a.Five_DigitActivity].filter(Boolean).join(' · ')}</Text>
                    </Pressable>
                  );
                })}
                <View style={styles.buttons}>
                  <ZedButton title="Cancel" small style={{ backgroundColor: colors.labelColor }} onPress={() => setActivities(null)} testID="activity-cancel" />
                  <ZedButton title="Update" small disabled={!chosen || chosen === text(msme, 'FiveDigitActivity')} onPress={updateActivity} testID="activity-update" />
                </View>
              </View>
            ) : (
              <>
                <Field label="Activity" value={text(msme, 'Activity')} />
                <Field label="2-digit" value={text(msme, 'TwoDigitActivity')} />
                <Field label="4-digit" value={text(msme, 'FourDigitActivity')} />
                <Field label="5-digit" value={text(msme, 'FiveDigitActivity')} />
              </>
            )}
          </Card>

          <Pressable style={styles.changePassword} onPress={() => nav.push('ChangePassword')} testID="profile-change-password">
            <Icon icon={icons.ic_change_pwd} />
            <Text style={styles.changePasswordText}>Change Password</Text>
          </Pressable>

          {route.params?.showProceed ? (
            <ZedButton title="Proceed" allCaps={false} textStyle={{ fontSize: 16 }} style={{ marginBottom: 20 }} onPress={() => nav.pop()} testID="profile-proceed" />
          ) : null}
        </View>
      </ScrollView>

      {emailStep !== 'idle' ? (
        <ZedDialog visible title="Change e-mail" cancelable={false} onClose={() => setEmailStep('idle')}>
          {emailStep === 'enter' ? (
            <>
              <Text style={textStyles.defaultLabel}>New e-mail address</Text>
              <OutlinedInput value={newEmail} onChangeText={setNewEmail} placeholder="name@example.com" autoCapitalize="none" keyboardType="email-address" testID="new-email" />
            </>
          ) : (
            <>
              <Text style={styles.small}>{`An OTP has been sent to ${newEmail.trim()}. It is valid for 10 minutes.`}</Text>
              <OutlinedInput value={otp} onChangeText={setOtp} placeholder="6-digit OTP" keyboardType="number-pad" maxLength={6} testID="email-otp" />
            </>
          )}
          <Text style={styles.small}>The e-mail changes only after the OTP is verified; the old address gets a notice.</Text>
          <View style={styles.buttons}>
            <ZedButton title="Cancel" small style={{ backgroundColor: colors.labelColor }} onPress={() => setEmailStep('idle')} testID="email-cancel" />
            {emailStep === 'enter' ? (
              <ZedButton title="Send OTP" small onPress={sendOtp} testID="email-send-otp" />
            ) : (
              <ZedButton title="Verify" small onPress={verifyOtp} testID="email-verify" />
            )}
          </View>
        </ZedDialog>
      ) : null}
    </ScreenFrame>
  );
}

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value?.trim() ? value : '—'}</Text>
    </View>
  );
}

/** general_row: label (45%) and bold value (other screens use it). */
export function Row({ label, value, right, onPress }: { label: string; value?: string | null; right?: React.ReactNode; onPress?: () => void }) {
  const valueView = (
    <View style={styles.valueBox}>
      <Text style={styles.rowValue}>{value ?? ''}</Text>
      {right}
    </View>
  );
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {onPress ? (
        <Pressable onPress={onPress} style={{ flex: 55 }}>
          {valueView}
        </Pressable>
      ) : (
        <View style={{ flex: 55 }}>{valueView}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { margin: dimens.padding2, paddingBottom: dimens.padding1 },
  offline: { backgroundColor: colors.yellow, color: colors.darkGrey, padding: dimens.padding2, borderRadius: 6, marginBottom: dimens.padding2 },
  card: { borderWidth: 1, borderColor: '#E3E6E8', borderRadius: 10, padding: dimens.padding3, marginBottom: dimens.padding3, backgroundColor: colors.white },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: dimens.padding2 },
  cardTitle: { fontSize: 16, fontWeight: 'bold', color: colors.appColorDark },
  idChip: { backgroundColor: colors.appColor3, color: colors.appColorDark, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 2, fontWeight: 'bold', overflow: 'hidden' },
  field: { marginBottom: dimens.padding2 },
  label: { color: colors.labelColor, fontSize: 13 },
  value: { color: colors.black, fontSize: dimens.textSize, fontWeight: 'bold', flexShrink: 1 },
  small: { color: colors.darkGrey2, fontSize: 13, marginVertical: 4 },
  link: { color: colors.appColorDark, fontWeight: 'bold', fontSize: 14, paddingVertical: 4 },
  inlineButton: { alignSelf: 'flex-start', marginBottom: dimens.padding2 },
  unitName: { fontSize: 16, fontWeight: 'bold', color: colors.black, marginBottom: 4 },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  option: { borderWidth: 1, borderColor: '#D6D6D6', borderRadius: 8, padding: dimens.padding2, marginBottom: dimens.padding2 },
  optionOn: { borderWidth: 2, borderColor: colors.appColor, backgroundColor: colors.appColor3 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: dimens.padding2, marginTop: dimens.padding2 },
  changePassword: { flexDirection: 'row', alignItems: 'center', padding: dimens.padding1, marginVertical: dimens.padding2 },
  changePasswordText: { marginLeft: dimens.padding1, color: colors.black, fontSize: dimens.textSize },
  row: { flexDirection: 'row', padding: dimens.padding1 },
  rowLabel: { flex: 45, color: colors.labelColor, padding: 5, fontSize: dimens.textSize },
  valueBox: { flexDirection: 'row', alignItems: 'flex-start' },
  rowValue: { flexShrink: 1, fontWeight: 'bold', padding: 5, color: colors.black, fontSize: dimens.textSize },
});
