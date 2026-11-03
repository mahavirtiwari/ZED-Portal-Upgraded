import React, { useEffect } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useBackHandler, useNavigation, useRoute, useUi } from '@zed/shared';
import { useSa } from '../app/context';
import { isAttendanceTakenToday, isLoggedOutToday, latestEntry } from '../attendance';
import { clearMeetingDraft, newAssessmentRequest } from '../flows/submissions';
import { areAllParametersCompletedOrSubmitted, COMPLETED, EVIDENCE_SITE_TOUR, IN_PROGRESS, isSaBasicInfoCompleted, isSaBasicInfoSubmitted, SUBMITTED } from '../models';
import { formatDate, formatRange, labelOf, progressOf, toneOf } from '../portfolio';
import { sectionsOf, tourCounts, tourShortfall } from '../siteTour';
import { Avatar, Badge, C, Card, HeroHeader, LevelBadge, levelOf, ListRow, Page, ProgressBar, SectionLabel, ZIcon, z, type IconName } from '../ui/zed';
import { openMap } from './assessmentActions';
import { SubmitButton } from './MeetingScreens';
import { checkAutoTime, MILLIS_PER_DAY, saDateOf } from './common';

const done = <Badge label="Completed" tone="success" small />;
const inProgress = <Badge label="In progress" tone="warning" small />;

/**
 * 07 Assessment Detail (redesign): the unit (CompanyProfileActivity) and its steps (AssessmentOptionsActivity) on one
 * page. Every check of the two legacy screens stays, in the same order: the SA date window when opened, the
 * allocation, the SA date, then today's punch-in for every step but Attendance, and each step's own rule.
 */
export function AssessmentDetailScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const { params } = useRoute<{ userType?: number | null; allottedParamsAvailable?: boolean }>();
  const d = app.details!;
  const profile = d.companyProfile ?? null;
  // The intent extra USER_TYPE is missing after an offline sign-in: the legacy default was 1.
  const userType = params.userType ?? (d.userType || 1);
  const lead = d.userType === 1;
  const hasParams = !!d.allottedParameters?.length;
  const available = (userType === 1 || userType === 2) && hasParams;
  const summary = app.assessments.find(a => a.zedId === app.zedId && (!a.certificationType || a.certificationType === d.certificationType));
  const toHome = (extra?: Record<string, unknown>) => {
    app.closeAssessment();
    nav.reset([{ name: 'Home', params: extra }]);
  };

  useBackHandler(() => {
    toHome();
    return true;
  });

  useEffect(() => {
    if (!profile) {
      ui.toast('MSME Profile Missing');
      toHome();
      return;
    }
    // checkSaTime: only when the parameters are there.
    if (available && profile.saDate != null) {
      if (!checkAutoTime(ui, () => toHome())) return;
      const date = saDateOf(profile.saDate);
      if (date && date.getTime() - Date.now() > 0 && Math.abs(date.getTime() - Date.now()) > 2 * MILLIS_PER_DAY) toHome({ saDateDue: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!profile) return null;

  /** checkSaTimeForStartAssessement */
  const checkSaTimeForStart = (): boolean => {
    if (!checkAutoTime(ui, () => toHome())) return false;
    const date = saDateOf(profile.saDate);
    if (!date) return false;
    if (Date.now() - date.getTime() < 0) {
      ui.showAlert('You can only start the Assessment on allotted SA Date');
      return false;
    }
    return true;
  };

  /** The legacy "Start Allocation" / "Proceed" button: allocation first, then the SA date. */
  const allocationReady = (): boolean => {
    if (userType === 1 && !available) {
      if (d.inputParameters?.length) nav.push('Allocation');
      else ui.showAlert('No parameters to allocate');
      return false;
    }
    if (!available) {
      nav.push('Alert', { allocationPending: true });
      return false;
    }
    return checkSaTimeForStart();
  };

  /** onClick of AssessmentOptionsActivity: every step but Attendance needs today's punch-in and no punch-out. */
  const step = (action: () => void) => () => {
    if (!allocationReady()) return;
    if (!isAttendanceTakenToday(d.attendanceData)) return ui.snackbar('Please log the attendance today to proceed');
    if (isLoggedOutToday(d.attendanceData)) return ui.snackbar("You've already punched out for the day");
    action();
  };

  const started = (d.allottedParameters ?? []).some(p => p && (p.status === IN_PROGRESS || p.status === COMPLETED || p.status === SUBMITTED));
  const allDone = areAllParametersCompletedOrSubmitted(d) && hasParams;

  const allocation = () => {
    if (!allocationReady()) return;
    const latest = d.attendanceData ? latestEntry(d.attendanceData) : null;
    // CompanyProfileActivity: "Proceed" opened the attendance first when the last entry is no punch-in.
    if (latest == null || latest.attendanceType !== 'LOGIN') nav.push('Attendance');
    else ui.toast('Parameters are allocated. Continue with the steps below.');
  };

  const siteTour = step(() => {
    if ((lead && d.isOpenMeetingSubmitted) || d.userType === 2) nav.push('SiteTour');
    else ui.toast('Please open the meeting to start site tour');
  });

  const openMeeting = step(() => {
    nav.push('SiteImages');
    clearMeetingDraft(app);
  });

  const startAssessment = step(() => {
    if (!d.isOpenMeetingSubmitted && lead) return ui.toast('Please open the meeting to start assessment');
    // Redesign: no separate selfie on site; the punch-in of the attendance carries the assessor's selfie.
    nav.push('ParametersPager');
  });

  const closeMeeting = step(() => {
    if (!areAllParametersCompletedOrSubmitted(d)) return ui.showAlert('Please complete all the parameters to close the meeting');
    if (!d.allowFinalSubmit && !isSaBasicInfoCompleted(d)) return ui.showAlert('Please capture Basic Info to close the meeting');
    // V4: every site tour section has its minimum (Admin → Site Tour Sections); the server checks it again with the team's
    // photos as stored.
    app.store.evidencesOfType(app.userId, EVIDENCE_SITE_TOUR).then(local => {
      const sections = sectionsOf(d);
      const short = tourShortfall(sections, tourCounts(sections, local, d.isSiteTourSubmitted));
      if (short) return ui.showAlert(short);
      clearMeetingDraft(app);
      nav.push('Meeting', { isCloseMeeting: true });
    });
  });

  const finalSubmission = step(() => {
    if (!areAllParametersCompletedOrSubmitted(d)) return ui.showAlert('Please complete all the parameters to proceed to final submission');
    nav.push('FinalComments', { finalSubmission: true, closeMeetingData: newAssessmentRequest(app) });
  });

  const progress = progressOf(d);
  const serverStage = summary?.stage ?? (started ? 'inProgress' : 'scheduled');
  const stage = serverStage === 'scheduled' && progress.done > 0 ? 'inProgress' : serverStage;
  const shownStatus = summary && stage === serverStage ? labelOf(summary) : labelOf({ stage });
  const level = levelOf(d.certificationType)?.label ?? d.certificationType ?? '';
  const address = profile.unitAddress ?? summary?.address ?? '';
  const spoc = summary?.spoc;
  const spocName = spoc?.name ?? null;
  const email = spoc?.email ?? (profile.email?.trim() ? profile.email : null);
  const phone = spoc?.phone ?? (profile.phone?.trim() ? profile.phone : null);
  const attendanceToday = isAttendanceTakenToday(d.attendanceData);
  const meetingLock = lead && !d.isOpenMeetingSubmitted ? 'Locked · finish Opening Meeting' : null;
  const allocationLock = !available ? (userType === 1 ? 'Locked · finish Parameter Allocation' : 'Waiting for the Lead Assessor\'s allocation') : null;

  return (
    <Page testID="assessment-options">
      <HeroHeader title={profile.msmeName ?? summary?.enterpriseName ?? app.zedId} subtitle={app.zedId} onBack={() => toHome()} />
      <ScrollView contentContainerStyle={z.screenPad} testID="company-profile">
        <Card>
          <View style={z.rowBetween}>
            <LevelBadge certification={d.certificationType} small />
            <Badge label={shownStatus} tone={toneOf(stage)} small testID="detail-status" />
          </View>
          <Text style={[z.h2, { marginTop: 8 }]} testID="profile-msme-name">
            {profile.msmeName}
          </Text>
          {address ? <Text style={[z.muted, { marginTop: 2 }]}>{address}</Text> : null}
          <View style={st.divider} />
          <View style={z.rowBetween}>
            <Text style={st.overline}>ASSESSMENT PROGRESS</Text>
            <Text style={z.title}>{`${Math.round(progress.ratio * 100)}%`}</Text>
          </View>
          <View style={{ marginVertical: 8 }}>
            <ProgressBar value={progress.ratio} />
          </View>
          <Text style={z.muted}>{`${progress.done} of ${progress.total} requirements assessed · ${progress.parameters} parameters`}</Text>
        </Card>

        <SectionLabel label="Schedule & scope" />
        <Card style={{ paddingVertical: 4 }}>
          <InfoRow icon="calendar" label="Scheduled" value={summary ? formatRange(summary.assessmentDate, summary.assessmentEndDate) : formatDate(profile.saDate)} testID="profile-sa-date" />
          <InfoRow icon="shield" label="Assessment type" value={`${level} · ${progress.parameters} parameters · ${progress.total} requirements`} />
          {profile.sectorName ? (
            <InfoRow icon="clipboard" label="Sector (NIC 2 digit)" value={profile.sectorId != null ? `${profile.sectorId}. ${profile.sectorName}` : profile.sectorName} />
          ) : null}
          {profile.osaScore || profile.daScore ? (
            <InfoRow icon="document" label="OSA / DA score" value={[profile.osaScore ?? '–', profile.daScore ?? '–'].join(' / ')} />
          ) : null}
          {address ? (
            <InfoRow
              icon="map-pin"
              label="Address · tap to view on map"
              value={address}
              link
              last
              onPress={() => openMap(ui, address, summary?.latitude, summary?.longitude)}
              testID="profile-unit-address"
            />
          ) : null}
        </Card>

        {spocName || email || phone ? (
          <>
            <SectionLabel label="Unit SPOC" />
            <Card>
              {spocName ? (
                <View style={[z.rowCenter, { marginBottom: 12 }]}>
                  <Avatar name={spocName} size={48} />
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <Text style={z.title}>{spocName}</Text>
                    {spoc?.designation ? <Text style={z.sub}>{spoc.designation}</Text> : null}
                  </View>
                </View>
              ) : null}
              <View style={z.rowBetween}>
                <View style={{ flex: 1 }}>
                  {email ? <Contact icon="mail" text={email} testID="profile-email" /> : null}
                  {phone ? <Contact icon="phone" text={phone} testID="profile-phone" /> : null}
                </View>
                {email ? <IconButton icon="mail" onPress={() => Linking.openURL('mailto:' + email).catch(() => undefined)} testID="spoc-mail" /> : null}
                {phone ? <IconButton icon="phone" onPress={() => Linking.openURL('tel:' + phone).catch(() => undefined)} testID="spoc-call" /> : null}
              </View>
            </Card>
          </>
        ) : null}

        <SectionLabel label="Workspace" />
        <Card style={{ paddingVertical: 4 }}>
          <ListRow
            icon="edit"
            title="Parameter Allocation"
            subtitle={lead ? 'Assign parameters to the team' : 'Parameters allotted to you'}
            badge={available ? done : null}
            onPress={allocation}
            testID="start-alloc-button"
          />
          <ListRow
            icon="calendar"
            title="Attendance"
            subtitle="Punch-in / out · Selfie"
            badge={attendanceToday ? <Badge label="Punched in today" tone="success" small /> : null}
            onPress={() => nav.push('Attendance')}
            testID="option-attendance"
          />
          {details(d) ? <ListRow icon="document" title="Company Details" subtitle="Products, customers, capacity" onPress={() => nav.push('BasicDetailsDisplay')} testID="products-button" /> : null}
          {lead ? (
            <ListRow
              icon="users"
              title="Opening Meeting"
              subtitle="Site photos · participants · remarks"
              badge={d.isOpenMeetingSubmitted ? done : null}
              locked={allocationLock}
              onPress={d.isOpenMeetingSubmitted ? undefined : openMeeting}
              testID="option-open-meeting"
            />
          ) : null}
          <ListRow
            icon="image"
            title="Site Tour"
            subtitle="Walkthrough photos by section"
            badge={d.isSiteTourSubmitted ? done : null}
            locked={d.isSiteTourSubmitted ? null : allocationLock ?? meetingLock}
            onPress={d.isSiteTourSubmitted ? undefined : siteTour}
            testID="option-site-tour"
          />
          {lead ? (
            <ListRow
              icon="document"
              title="Basic Info"
              subtitle="Unit details & scope"
              badge={isSaBasicInfoSubmitted(d) ? done : isSaBasicInfoCompleted(d) ? inProgress : null}
              locked={allocationLock}
              onPress={step(() => nav.push('BasicInformation'))}
              testID="option-basic-info"
            />
          ) : null}
          <ListRow
            icon="clipboard"
            title="Assessment Checklist"
            subtitle={started ? 'Continue the assessment · Yes / Partial / No' : 'Start the assessment · Yes / Partial / No'}
            badge={allDone ? done : started ? inProgress : null}
            locked={allocationLock ?? meetingLock}
            onPress={startAssessment}
            testID="option-start-assessment"
          />
          <ListRow icon="sync" title="Sync Assessment" subtitle="Upload offline data" locked={allocationLock} onPress={step(() => nav.push('SubmitParameters'))} testID="option-sync" last={!lead} />
          {lead ? (
            <ListRow
              icon="flag"
              title="Closing Meeting"
              subtitle="Findings · final submission"
              badge={d.isCloseMeetingSubmitted ? done : null}
              locked={d.isCloseMeetingSubmitted ? null : allocationLock ?? meetingLock ?? (allDone ? null : 'Locked · complete all parameters')}
              onPress={d.isCloseMeetingSubmitted ? undefined : closeMeeting}
              last
              testID="option-close-meeting"
            />
          ) : null}
        </Card>
        {!lead && !d.isCloseMeetingSubmitted ? <SubmitButton title="Final Submit" ready={allDone} onPress={finalSubmission} testID="option-final-submission" /> : null}
      </ScrollView>
    </Page>
  );
}

const details = (d: { basicInformation?: unknown }) => !!d.basicInformation;

function InfoRow({
  icon,
  label,
  value,
  link,
  last,
  onPress,
  testID,
}: {
  icon: IconName;
  label: string;
  value: string;
  link?: boolean;
  last?: boolean;
  onPress?: () => void;
  testID?: string;
}) {
  return (
    <Pressable style={[st.info, !last && st.infoDivider]} onPress={onPress} disabled={!onPress} testID={testID}>
      <ZIcon name={icon} size={18} color={C.primary} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={z.muted}>{label}</Text>
        <Text style={[z.body, { marginTop: 2 }, link && st.linkValue]}>{value}</Text>
      </View>
      {link ? <ZIcon name="chevron-right" size={18} color={C.primary} /> : null}
    </Pressable>
  );
}

function Contact({ icon, text, testID }: { icon: IconName; text: string; testID?: string }) {
  return (
    <View style={[z.rowCenter, { marginVertical: 3 }]}>
      <ZIcon name={icon} size={14} color={C.primary} />
      <Text style={[z.body, { marginLeft: 8, fontSize: 13 }]} testID={testID}>
        {text}
      </Text>
    </View>
  );
}

function IconButton({ icon, onPress, testID }: { icon: IconName; onPress: () => void; testID: string }) {
  return (
    <Pressable style={st.iconButton} onPress={onPress} testID={testID} accessibilityLabel={icon === 'mail' ? 'Email' : 'Call'}>
      <ZIcon name={icon} size={18} color={C.primary} />
    </Pressable>
  );
}

const st = StyleSheet.create({
  divider: { height: 1, backgroundColor: C.divider, marginVertical: 12 },
  overline: { fontSize: 11, fontWeight: '700', color: C.tSecondary, letterSpacing: 0.8 },
  info: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  infoDivider: { borderBottomColor: C.divider, borderBottomWidth: 1 },
  linkValue: { color: C.primaryDark, fontWeight: '700' },
  iconButton: { width: 40, height: 40, borderRadius: 10, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
});
