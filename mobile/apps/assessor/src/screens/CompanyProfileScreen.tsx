import React, { useEffect } from 'react';
import { Image, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useBackHandler, useNavigation, useRoute, useUi } from '@zed/shared';
import { useSa } from '../app/context';
import { images } from '../assets/images';
import { latestEntry } from '../attendance';
import { LabelValue, SaButton, SaFrame, sa } from '../ui/kit';
import { checkAutoTime, MILLIS_PER_DAY, saDateOf, showExitAlert, stripTimeFromDate } from './common';

/** CompanyProfileActivity */
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

  const startAllocation = () => {
    if (userType === 1 && !available) {
      if (details.inputParameters?.length) nav.reset([{ name: 'Allocation' }]);
      else ui.showAlert('No parameters to allocate');
    } else if (!available) {
      nav.reset([{ name: 'Alert', params: { allocationPending: true } }]);
    } else if (checkSaTimeForStart()) {
      const latest = details.attendanceData ? latestEntry(details.attendanceData) : null;
      if (latest == null || latest.attendanceType !== 'LOGIN') {
        // AttendanceActivity for result: on OK the button is pressed again.
        nav.push('Attendance', { onResult: (ok: boolean) => ok && startAllocation() });
        return;
      }
      nav.reset([{ name: 'AssessmentOptions' }]);
    }
  };

  const showOnMaps = (address: string) => {
    if (!address) ui.toast('Invalid Address');
    Linking.openURL('geo:0,0?q=' + address.replace(/ /g, '+')).catch(() => ui.showAlert('Failed to load given Address'));
  };

  const rows: Array<{ id: string; label: string; value: string | null | undefined; map?: boolean }> = [
    { id: 'sa-date', label: 'SA DATE', value: profile.saDate != null ? stripTimeFromDate(profile.saDate) : null },
    { id: 'zed-id', label: 'ZED ID', value: profile.zedId },
    { id: 'msme-name', label: 'MSME NAME', value: profile.msmeName },
    {
      id: 'sector',
      label: 'SECTOR (NIC 2 DIGIT)',
      value: profile.sectorName != null ? (profile.sectorId != null ? `${profile.sectorId}. ${profile.sectorName}` : profile.sectorName) : null,
    },
    { id: 'unit-address', label: 'UNIT ADDRESS', value: profile.unitAddress, map: true },
    { id: 'email', label: 'EMAIL', value: profile.email?.trim() ? profile.email : null },
    { id: 'phone', label: 'PHONE', value: profile.phone?.trim() ? profile.phone : null },
    { id: 'osa-score', label: 'OSA SCORE', value: profile.osaScore },
    { id: 'da-score', label: 'DA SCORE', value: profile.daScore },
  ];

  return (
    <SaFrame testID="company-profile">
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.box}>
          <Text style={styles.header}>COMPANY PROFILE</Text>
          {rows
            .filter(r => r.value != null)
            .map(r => (
              <LabelValue
                key={r.id}
                label={r.label}
                value={r.value!}
                testID={`profile-${r.id}`}
                onPressValue={r.map ? () => showOnMaps(r.value!) : undefined}
                right={r.map ? <Image source={images.marker_24} style={styles.marker} /> : undefined}
              />
            ))}
        </View>
        {details.basicInformation ? (
          <SaButton title="Show Company Details" large onPress={() => nav.push('BasicDetailsDisplay')} testID="products-button" />
        ) : null}
        <SaButton title={available || userType === 2 ? 'Proceed' : 'Start Allocation'} large onPress={startAllocation} testID="start-alloc-button" />
      </ScrollView>
    </SaFrame>
  );
}

const styles = StyleSheet.create({
  content: { padding: 12 },
  box: { backgroundColor: sa.white, borderColor: '#C7CACD', borderWidth: 0.5, paddingBottom: 8 },
  header: { backgroundColor: sa.silver, paddingLeft: 16, paddingVertical: 8, fontSize: 14, fontWeight: 'bold', color: sa.darkGrey, marginBottom: 4 },
  marker: { width: 24, height: 24, marginLeft: 5 },
});
