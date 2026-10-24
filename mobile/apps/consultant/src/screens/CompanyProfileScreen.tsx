import React, { useEffect } from 'react';
import { Image, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useBackHandler, useNavigation, useRoute, useUi } from '@zed/shared';
import { useSa } from '../app/context';
import { images } from '../assets/images';
import { isFirstMilestone, isFourthMilestone } from '../models';
import { LabelValue, SaButton, SaFrame, sa } from '../ui/kit';
import { checkAutoTime, MILLIS_PER_DAY, saDateOf, showExitAlert, stripTimeFromDate } from './common';

/** CompanyProfileActivity: "Welcome", the unit's details in three boxes, Start Allocation / Proceed. */
export function CompanyProfileScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const { params } = useRoute<{ userType?: number | null; allottedParamsAvailable?: boolean }>();
  const details = app.details;
  const profile = details?.companyProfile ?? null;
  // The intent extra USER_TYPE is missing after an offline sign-in: the legacy default was 1.
  const userType = params.userType ?? 1;
  const available = (userType === 1 || userType === 2) && params.allottedParamsAvailable === true;
  const toLogin = (extra?: Record<string, unknown>) => nav.reset([{ name: 'Login', params: extra }]);

  useBackHandler(() => {
    showExitAlert(ui);
    return true;
  });

  useEffect(() => {
    if (!profile) {
      ui.toast('MSME Profile Missing');
      toLogin();
      return;
    }
    // checkSaTime: only when the parameters are there.
    if (available && profile.saDate != null) {
      if (!checkAutoTime(ui, () => toLogin())) return;
      const date = saDateOf(profile.saDate);
      if (date && date.getTime() - Date.now() > 0 && Math.abs(date.getTime() - Date.now()) > 2 * MILLIS_PER_DAY) toLogin({ saDateDue: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!details || !profile) return null;

  /** checkSaTimeForStartAssessement */
  const checkSaTimeForStart = (): boolean => {
    if (!checkAutoTime(ui, () => toLogin())) return false;
    const date = saDateOf(profile.saDate);
    if (!date) return false;
    if (Date.now() - date.getTime() < 0) {
      ui.showAlert('You can only start the Assessment on allotted SA Date');
      return false;
    }
    return true;
  };

  /** startAllocation: the dashboard opens the attendance itself, so there is no punch-in step here. */
  const startAllocation = () => {
    if (!isFourthMilestone(details)) {
      if (userType === 1 && !available) {
        if (details.inputParameters?.length) nav.reset([{ name: 'Allocation' }]);
        else ui.showAlert('No parameters to allocate');
        return;
      }
      if (!available) {
        nav.reset([{ name: 'Alert', params: { allocationPending: true } }]);
        return;
      }
    }
    if (checkSaTimeForStart()) nav.reset([{ name: 'AssessmentOptions' }]);
  };

  const showOnMaps = (address: string) => {
    if (!address) ui.toast('Invalid Address');
    Linking.openURL('geo:0,0?q=' + address.replace(/ /g, '+')).catch(() => ui.showAlert('Failed to load given Address'));
  };

  const date = (s: string) => stripTimeFromDate(s);
  const basic: Array<{ id: string; label: string; value: string | null | undefined }> = [
    { id: 'bds-date', label: 'BDS (From & To)', value: profile.bdsFromDate != null && profile.bdsToDate != null ? `${date(profile.bdsFromDate)} - ${date(profile.bdsToDate)}` : null },
    {
      id: 'hap-date',
      label: 'HAP (From & To)',
      value: isFirstMilestone(details) && profile.hapFromDate != null && profile.hapToDate != null ? `${date(profile.hapFromDate)} - ${date(profile.hapToDate)}` : null,
    },
    { id: 'zed-id', label: 'ZED ID', value: profile.zedId },
    { id: 'msme-name', label: 'MSME NAME', value: profile.msmeName },
    {
      id: 'sector',
      label: 'SECTOR (NIC 2 DIGIT)',
      value: profile.sectorName != null ? (profile.sectorId != null ? `${profile.sectorId}. ${profile.sectorName}` : profile.sectorName) : null,
    },
    { id: 'osa-score', label: 'OSA SCORE', value: profile.osaScore },
    { id: 'da-score', label: 'DA SCORE', value: profile.daScore },
  ];
  const filled = (s: string | null | undefined) => s != null && s.trim() !== '';
  const address: Array<{ id: string; label: string; value: string | null | undefined; map?: boolean }> = [
    // The row shows the plant address and opens the maps with the unit address, as the legacy did.
    { id: 'unit-address', label: 'UNIT ADDRESS', value: filled(profile.unitAddress) ? (profile.address ?? '') : null, map: true },
    { id: 'state', label: 'State/UT', value: filled(profile.stateName) ? profile.stateName : null },
    { id: 'district', label: 'District', value: filled(profile.districtName) ? profile.districtName : null },
    { id: 'pincode', label: 'PIN Code', value: filled(profile.pincode) ? profile.pincode : null },
  ];
  const spoc = [
    { id: 'email', label: 'EMAIL', value: filled(profile.email) ? profile.email : null },
    { id: 'phone', label: 'PHONE', value: filled(profile.phone) ? profile.phone : null },
  ];

  const box = (title: string, rows: Array<{ id: string; label: string; value: string | null | undefined; map?: boolean }>) => (
    <View style={styles.box}>
      <Text style={styles.header}>{title}</Text>
      {rows
        .filter(r => r.value != null)
        .map(r => (
          <LabelValue
            key={r.id}
            label={r.label}
            value={r.value!}
            testID={`profile-${r.id}`}
            onPressValue={r.map ? () => showOnMaps(profile.unitAddress ?? '') : undefined}
            right={r.map ? <Image source={images.marker_24} style={styles.marker} /> : undefined}
          />
        ))}
    </View>
  );

  const proceed = available || userType === 2 || isFourthMilestone(details);
  return (
    <SaFrame testID="company-profile">
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.welcome}>Welcome</Text>
        {box('BASIC INFORMATION', basic)}
        {box('UNIT ADDRESS', address)}
        {box('UNIT SPOC DETAILS', spoc)}
        <SaButton title={proceed ? 'Proceed' : 'Start Allocation'} large onPress={startAllocation} testID="start-alloc-button" />
      </ScrollView>
    </SaFrame>
  );
}

const styles = StyleSheet.create({
  content: { padding: 12 },
  welcome: { color: sa.primary, fontSize: 18, fontWeight: 'bold', paddingVertical: 8 },
  box: { backgroundColor: sa.white, borderColor: '#C7CACD', borderWidth: 0.5, paddingBottom: 8, marginBottom: 12 },
  header: { backgroundColor: sa.silver, paddingLeft: 16, paddingVertical: 8, fontSize: 14, fontWeight: 'bold', color: sa.darkGrey, marginBottom: 4 },
  marker: { width: 24, height: 24, marginLeft: 5 },
});
