import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useBackHandler, useFocusEffect, useNavigation, useRoute, useUi } from '@zed/shared';
import { useSa } from '../app/context';
import { isLoggedInToday } from '../attendance';
import { newAssessmentRequest } from '../flows/submissions';
import { milestoneSections, shownStatus, type Section, type SectionId } from '../milestone';
import {
  allowCloseMeetingCapturing,
  ATTENDANCE_ALERT,
  COMPLETED_TEXT,
  EVIDENCE_SITE_TOUR,
  hasSitePhotos,
  IN_PROGRESS_TEXT,
  isFirstMilestone,
  isFourthMilestone,
  isLead,
  OPENING_MEETING_PENDING,
  Status,
  type ParametersModule,
} from '../models';
import { formatDate, milestoneLabel } from '../portfolio';
import { sectionsOf, tourCounts, tourShortfall } from '../siteTour';
import { Avatar, Badge, C, Card, HeroHeader, LevelBadge, ListRow, Page, ProgressBar, SectionLabel, z, ZIcon, ZScroll, type IconName } from '../ui/zed';
import { openMap } from './assessmentActions';
import { checkAutoTime, MILLIS_PER_DAY, saDateOf, stripTimeFromDate } from './common';

/** A meeting, the site photos or the site tour already sent: they do not open again (the legacy list dropped them). */
const ALREADY_SUBMITTED = 'Already submitted';

const ICONS: Record<SectionId, IconName> = {
  attendance: 'calendar',
  'site-photos': 'image',
  'open-meeting': 'users',
  'site-tour': 'map-pin',
  'training-on-zed': 'document',
  'diagnostic-study': 'search',
  'basic-info': 'edit',
  'handholding-action-plan': 'clipboard',
  'technology-intervention': 'settings',
  'training-on-handholding': 'document',
  'progress-review': 'clipboard',
  'closing-meeting': 'flag',
  'technology-upgradation': 'shield',
  'final-submission': 'check',
};

const SUBTITLES: Record<SectionId, string> = {
  attendance: 'Punch-in / punch-out with selfie',
  'site-photos': 'Lead only · site exterior photos',
  'open-meeting': 'Lead only · participants and photo',
  'site-tour': 'Photos by section of the unit',
  'training-on-zed': 'Lead only · Milestone 1',
  'diagnostic-study': 'Parameters of the baseline study',
  'basic-info': 'Lead only · unit details',
  'handholding-action-plan': 'Optional · action plan per parameter',
  'technology-intervention': 'Optional · suggested technologies',
  'training-on-handholding': 'Training on the implementation plan',
  'progress-review': 'Review of the implementation',
  'closing-meeting': 'Lead only · closes the milestone visit',
  'technology-upgradation': 'Verification of the technology upgradation',
  'final-submission': 'Co-consultant · submits your work',
};

/**
 * Milestone home (redesign 01): the unit (CompanyProfileActivity) and the milestone's sections (AssessmentOptionsActivity)
 * on one page. Every check of the two legacy screens stays, in the same order: the SA date window when opened; then for
 * each section the allocation (lead: Parameter Allocation, co-consultant: waiting), the SA date, today's punch-in
 * (except milestone 4) and the opening meeting, and each section's own rule. The attendance opens by itself once per
 * visit when today's punch-in is missing, as the legacy dashboard did.
 */
export function MilestoneScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const { params } = useRoute<{ userType?: number | null; allottedParamsAvailable?: boolean }>();
  const d = app.details!;
  const profile = d.companyProfile ?? null;
  // The intent extra USER_TYPE is missing after an offline sign-in: the legacy default was 1.
  const userType = params.userType ?? (d.userType || 1);
  const lead = isLead(d);
  const m1 = isFirstMilestone(d);
  const m4 = isFourthMilestone(d);
  const available = (userType === 1 || userType === 2) && !!d.allottedParameters?.length;
  const summary = app.assessments.find(a => a.zedId === app.zedId && (!a.certificationType || a.certificationType === d.certificationType));
  const [sitePhotosDone, setSitePhotosDone] = useState(false);
  const attendancePushed = useRef(false);

  const leave = (extra?: Record<string, unknown>) => {
    app.closeAssessment();
    if (!extra && nav.canGoBack()) nav.pop();
    else nav.reset([{ name: 'Home', params: extra }]);
  };

  useBackHandler(() => {
    leave();
    return true;
  });

  useEffect(() => {
    if (!profile) {
      ui.toast('MSME Profile Missing');
      leave();
      return;
    }
    // checkSaTime: only when the parameters are there.
    if (available && profile.saDate != null) {
      if (!checkAutoTime(ui, () => leave())) return;
      const date = saDateOf(profile.saDate);
      if (date && date.getTime() - Date.now() > 0 && Math.abs(date.getTime() - Date.now()) > 2 * MILLIS_PER_DAY) leave({ saDateDue: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** M4 needs no attendance. */
  const attendanceTaken = () => m4 || isLoggedInToday(d.attendanceData);

  /** The legacy "Start Allocation" / "Proceed" check, silently: the allocation is done and the SA date has come. */
  const started = () => {
    if (!m4 && !available) return false;
    const date = saDateOf(profile?.saDate);
    return !!date && Date.now() - date.getTime() >= 0;
  };

  // onResume: the site photos' status is read again; the attendance opens once when today's punch-in is missing.
  useFocusEffect(
    useCallback(() => {
      app.store
        .meeting(app.userId, true)
        .then(r => setSitePhotosDone(hasSitePhotos(r)))
        .catch(() => setSitePhotosDone(false));
      if (!attendancePushed.current && profile && started() && !attendanceTaken()) {
        attendancePushed.current = true;
        nav.push('Attendance');
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  if (!profile) return null;

  /** checkSaTimeForStartAssessement */
  const checkSaTimeForStart = (): boolean => {
    if (!checkAutoTime(ui, () => leave())) return false;
    const date = saDateOf(profile.saDate);
    if (!date) return false;
    if (Date.now() - date.getTime() < 0) {
      ui.showAlert('You can only start the Assessment on allotted SA Date');
      return false;
    }
    return true;
  };

  /** startAllocation (CompanyProfileActivity): the allocation first (not for milestone 4), then the SA date. */
  const allocationReady = (): boolean => {
    if (!m4) {
      if (userType === 1 && !available) {
        if (d.inputParameters?.length) nav.push('Allocation');
        else ui.showAlert('No parameters to allocate');
        return false;
      }
      if (!available) {
        nav.push('Alert', { allocationPending: true });
        return false;
      }
    }
    return checkSaTimeForStart();
  };

  /** The checks every section but the attendance starts with (AssessmentOptionsActivity). */
  const step = (action: () => void | Promise<void>, needsOpenMeeting = true) => () => {
    if (!allocationReady()) return;
    if (!attendanceTaken()) return ui.snackbar(ATTENDANCE_ALERT);
    if (needsOpenMeeting && !d.isOpenMeetingSubmitted) return ui.snackbar(OPENING_MEETING_PENDING);
    return action();
  };
  /** The closing meeting and final submission had no punch-in check on the legacy dashboard. */
  const afterAllocation = (action: () => void | Promise<void>) => () => {
    if (!allocationReady()) return;
    return action();
  };
  const module = (m: ParametersModule) => step(() => nav.push('Module', { module: m }));

  const actions: Record<SectionId, () => void> = {
    attendance: afterAllocation(() => nav.push('Attendance')),
    'site-photos': step(() => nav.push('SiteImages'), false),
    'open-meeting': step(async () => {
      if (!hasSitePhotos(await app.store.meeting(app.userId, true))) return ui.toast('Please capture site photos to proceed');
      nav.push('Meeting');
    }, false),
    'site-tour': step(() => {
      if ((lead && d.isOpenMeetingSubmitted) || !lead) nav.push('SiteTour');
      else ui.snackbar(OPENING_MEETING_PENDING);
    }, false),
    'training-on-zed': step(() => nav.push('Training', { handholding: false })),
    'diagnostic-study': module('baselineDiagnostic'),
    'basic-info': step(() => nav.push('BasicInformation')),
    'handholding-action-plan': module('handholdingActionPlan'),
    'technology-intervention': module('technologyIntervention'),
    'training-on-handholding': step(() => nav.push('Training', { handholding: true })),
    'progress-review': module('progressReview'),
    'closing-meeting': afterAllocation(async () => {
      if (!allowCloseMeetingCapturing(d)) return ui.showAlert('Please complete all the sections in order to close the meeting');
      // V4: in milestone 1 every site tour section needs its minimum (Admin → Site Tour Sections); the server checks
      // it again with the team's photos as stored.
      if (m1) {
        const sections = sectionsOf(d);
        const short = tourShortfall(sections, tourCounts(sections, await app.store.evidencesOfType(app.userId, EVIDENCE_SITE_TOUR), d.isSiteTourSubmitted));
        if (short) return ui.showAlert(short);
      }
      nav.push('Meeting', { isCloseMeeting: true });
    }),
    'technology-upgradation': step(() => {
      if (d.technologyUpgradationStatus === Status.SUBMITTED) return ui.snackbar('Information already submitted');
      nav.push('TechnologyUpgradation');
    }),
    'final-submission': afterAllocation(() => {
      if (!allowCloseMeetingCapturing(d)) return ui.showAlert('Please complete all the sections in order to close the meeting');
      nav.push('FinalComments', { finalSubmission: true, closeMeetingData: newAssessmentRequest(app) });
    }),
  };

  const sections = milestoneSections(d, sitePhotosDone);
  const done = sections.filter(s => shownStatus(s.status) === COMPLETED_TEXT).length;
  const ratio = sections.length ? done / sections.length : 0;
  const allocationLock = !m4 && !available ? (userType === 1 ? 'Locked · finish Parameter Allocation' : "Waiting for the Lead Consultant's allocation") : null;
  const lockOf = (s: Section): string | null => {
    if (s.submitted) return null;
    if (allocationLock) return allocationLock;
    if (s.id === 'attendance' || s.id === 'closing-meeting' || s.id === 'final-submission') return null;
    if (!attendanceTaken()) return 'Locked · punch in first';
    const needsMeeting = !['site-photos', 'open-meeting', 'site-tour'].includes(s.id);
    if (needsMeeting && !d.isOpenMeetingSubmitted) return 'Locked · finish Opening Meeting';
    return null;
  };
  const badgeOf = (s: Section) => {
    const status = shownStatus(s.status);
    if (status === COMPLETED_TEXT) return <Badge label="Completed" tone="success" small />;
    if (status === IN_PROGRESS_TEXT) return <Badge label="In progress" tone="warning" small />;
    return <Badge label="Pending" tone="neutral" small />;
  };

  const address = profile.unitAddress ?? summary?.address ?? '';
  // The legacy row showed the plant address and opened the map with the unit address.
  const plant = profile.address?.trim() ? profile.address : null;
  const spoc = summary?.spoc;
  const email = spoc?.email ?? (profile.email?.trim() ? profile.email : null);
  const phone = spoc?.phone ?? (profile.phone?.trim() ? profile.phone : null);
  const range = (from?: string | null, to?: string | null) => (from != null && to != null ? `${stripTimeFromDate(from)} - ${stripTimeFromDate(to)}` : null);
  const bds = range(profile.bdsFromDate, profile.bdsToDate);
  const hap = m1 ? range(profile.hapFromDate, profile.hapToDate) : null;
  const sector = profile.sectorName != null ? (profile.sectorId != null ? `${profile.sectorId}. ${profile.sectorName}` : profile.sectorName) : null;
  const place = [profile.districtName, profile.stateName, profile.pincode].filter(x => !!x && String(x).trim()).join(', ');

  return (
    <Page testID="assessment-options">
      <HeroHeader title={profile.msmeName ?? summary?.enterpriseName ?? app.zedId} subtitle={app.zedId} onBack={() => leave()} />
      <ZScroll contentContainerStyle={z.screenPad} testID="company-profile">
        <Card>
          <View style={z.rowBetween}>
            <Text style={z.idText} testID="profile-zed-id">
              {profile.zedId ?? app.zedId}
            </Text>
            <Badge label={milestoneLabel(d.milestone)} tone="warning" small />
          </View>
          <Text style={[z.h2, { marginTop: 8 }]} testID="profile-msme-name">
            {profile.msmeName}
          </Text>
          {address ? <Text style={[z.muted, { marginTop: 2 }]}>{address}</Text> : null}
          <View style={st.divider} />
          <View style={z.rowBetween}>
            <Text style={st.overline}>MILESTONE PROGRESS</Text>
            <Text style={z.title}>{`${Math.round(ratio * 100)}%`}</Text>
          </View>
          <View style={{ marginVertical: 8 }}>
            <ProgressBar value={ratio} />
          </View>
          <Text style={z.muted} testID="milestone-progress">{`${done} of ${sections.length} sections completed`}</Text>
        </Card>

        <SectionLabel label="Schedule" />
        <Card style={{ paddingVertical: 4 }}>
          <InfoRow icon="calendar" label="Scheduled" value={formatDate(profile.saDate) || stripTimeFromDate(profile.saDate ?? '')} testID="profile-sa-date" />
          {bds ? <InfoRow icon="calendar" label="BDS (From & To)" value={bds} testID="profile-bds-date" /> : null}
          {hap ? <InfoRow icon="calendar" label="HAP (From & To)" value={hap} testID="profile-hap-date" /> : null}
          {address ? (
            <InfoRow
              icon="map-pin"
              label="Address · tap to view on map"
              value={plant || address}
              link
              last
              onPress={() => openMap(ui, address, summary?.latitude, summary?.longitude)}
              testID="profile-unit-address"
            />
          ) : null}
        </Card>

        {spoc?.name || email || phone ? (
          <>
            <SectionLabel label="Unit SPOC" />
            <Card>
              {spoc?.name ? (
                <View style={[z.rowCenter, { marginBottom: 12 }]}>
                  <Avatar name={spoc.name} size={48} />
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <Text style={z.title}>{spoc.name}</Text>
                    {spoc.designation ? <Text style={z.sub}>{spoc.designation}</Text> : null}
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

        <SectionLabel label="Unit details" />
        <Card style={{ paddingVertical: 4 }}>
          {sector ? <InfoRow icon="clipboard" label="Sector (NIC 2 digit)" value={sector} testID="profile-sector" /> : null}
          <View style={[st.info, st.infoDivider]}>
            <ZIcon name="shield" size={18} color={C.primary} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={z.muted}>Certification level</Text>
              <View style={{ flexDirection: 'row', marginTop: 4 }}>
                <LevelBadge certification={d.certificationType} small />
              </View>
            </View>
          </View>
          {profile.osaScore || profile.daScore ? (
            <InfoRow icon="document" label="OSA / DA score" value={[profile.osaScore ?? '–', profile.daScore ?? '–'].join(' / ')} testID="profile-scores" />
          ) : null}
          {place ? <InfoRow icon="map-pin" label="District, State/UT, PIN" value={place} last testID="profile-place" /> : null}
        </Card>

        <SectionLabel label="Milestone sections" />
        <Card style={{ paddingVertical: 4 }}>
          {m4 ? null : (
            <ListRow
              icon="edit"
              title="Parameter Allocation"
              subtitle={lead ? 'Assign parameters to the team' : 'Parameters allotted to you'}
              badge={available ? <Badge label="Completed" tone="success" small /> : null}
              onPress={() => {
                if (allocationReady()) ui.toast('Parameters are allocated. Continue with the sections below.');
              }}
              testID="start-alloc-button"
            />
          )}
          {sections.map(s => (
            <ListRow
              key={s.id}
              icon={ICONS[s.id]}
              title={s.label}
              subtitle={SUBTITLES[s.id]}
              badge={s.submitted || (s.id !== 'closing-meeting' && s.id !== 'final-submission') ? badgeOf(s) : null}
              locked={lockOf(s)}
              onPress={s.submitted ? () => ui.snackbar(ALREADY_SUBMITTED) : actions[s.id]}
              testID={`option-${s.id}`}
            />
          ))}
          {/* Clear Data is on the case's card (dashboard and case list). */}
          <ListRow icon="sync" title="Sync Data" subtitle="Send the work saved on the phone" onPress={afterAllocation(() => nav.push('SubmitParameters'))} last testID="option-sync-data" />
        </Card>
      </ZScroll>
    </Page>
  );
}

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
