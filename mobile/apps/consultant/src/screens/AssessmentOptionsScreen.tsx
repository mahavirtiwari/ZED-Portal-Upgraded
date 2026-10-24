import React, { useCallback, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text } from 'react-native';
import { useBackHandler, useFocusEffect, useNavigation, useUi } from '@zed/shared';
import { useSa } from '../app/context';
import { images } from '../assets/images';
import { isAttendanceDoneToday, isLoggedInToday } from '../attendance';
import { newAssessmentRequest } from '../flows/submissions';
import {
  allowCloseMeetingCapturing,
  ATTENDANCE_ALERT,
  basicInfoStringStatus,
  COMPLETED_TEXT,
  hasSitePhotos,
  isFirstMilestone,
  isFourthMilestone,
  isLead,
  isThirdMilestone,
  NOT_COMPLETED,
  OPENING_MEETING_PENDING,
  Status,
  stringStatus,
  SUBMITTED_TEXT,
  textStatus,
  type ParametersModule,
} from '../models';
import { MANDATORY_LABEL, MenuRow, OPTIONAL_LABEL, SaFrame, sa } from '../ui/kit';
import { showExitAlert } from './common';

type Item = {
  id: string;
  label: string;
  status: string | null;
  onPress: () => void;
  leading?: number;
};

/** AssessmentOptionsActivity: the dashboard of the consultancy (one row per section, with its status). */
export function AssessmentOptionsScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const d = app.details!;
  const [sitePhotosDone, setSitePhotosDone] = useState(false);

  /** M4 needs no attendance. */
  const attendanceTaken = () => isFourthMilestone(d) || isLoggedInToday(d.attendanceData);

  // onResume: the attendance is opened whenever today's punch-in is missing; the site photos' status is read again.
  useFocusEffect(
    useCallback(() => {
      if (!attendanceTaken()) nav.push('Attendance');
      app.store
        .meeting(app.userId, true)
        .then(r => setSitePhotosDone(hasSitePhotos(r)))
        .catch(() => setSitePhotosDone(false));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  useBackHandler(() => {
    showExitAlert(ui);
    return true;
  });

  const lead = isLead(d);
  const m1 = isFirstMilestone(d);
  const m4 = isFourthMilestone(d);

  /** The checks every section but the attendance starts with. */
  const step = (action: () => void | Promise<void>, needsOpenMeeting = true) => () => {
    if (!attendanceTaken()) return ui.snackbar(ATTENDANCE_ALERT);
    if (needsOpenMeeting && !d.isOpenMeetingSubmitted) return ui.snackbar(OPENING_MEETING_PENDING);
    return action();
  };
  const module = (m: ParametersModule) => step(() => nav.push('Module', { module: m }));

  const items: Item[] = [];
  const attendanceStatus = isAttendanceDoneToday(d.attendanceData) ? Status.COMPLETED : isLoggedInToday(d.attendanceData) ? Status.IN_PROGRESS : Status.TO_START;
  items.push({ id: 'attendance', label: 'Attendance' + MANDATORY_LABEL, status: textStatus(attendanceStatus), onPress: () => nav.push('Attendance') });

  if (lead && !d.isOpenMeetingSubmitted) {
    items.push({
      id: 'site-photos',
      label: 'Site Photos' + MANDATORY_LABEL,
      status: sitePhotosDone ? COMPLETED_TEXT : null,
      onPress: step(() => nav.push('SiteImages'), false),
    });
    items.push({
      id: 'open-meeting',
      label: 'Opening Meeting' + MANDATORY_LABEL,
      status: null,
      onPress: step(async () => {
        if (!hasSitePhotos(await app.store.meeting(app.userId, true))) return ui.toast('Please capture site photos to proceed');
        nav.push('Meeting');
      }, false),
    });
  }
  if (m1 && !d.isSiteTourSubmitted) {
    items.push({
      id: 'site-tour',
      label: 'Site Tour' + MANDATORY_LABEL,
      status: null,
      onPress: step(() => {
        if ((lead && d.isOpenMeetingSubmitted) || !lead) nav.push('SiteTour');
        else ui.snackbar(OPENING_MEETING_PENDING);
      }, false),
    });
  }
  if (m1 && lead) {
    items.push({ id: 'training-on-zed', label: 'Training on ZED' + MANDATORY_LABEL, status: stringStatus(d.zedTrainingInfo), onPress: step(() => nav.push('Training', { handholding: false })) });
  }
  if (m1) {
    items.push({ id: 'diagnostic-study', label: 'Baseline Diagnostic Study' + MANDATORY_LABEL, status: stringStatus(d.baselineDiagnosticStudyData), onPress: module('baselineDiagnostic') });
  }
  if (lead && !m4) {
    items.push({ id: 'basic-info', label: 'Basic Information' + MANDATORY_LABEL, status: basicInfoStringStatus(d.saBasicInformation), onPress: step(() => nav.push('BasicInformation')) });
  }
  if (m1) {
    items.push({ id: 'handholding-action-plan', label: 'Handholding Action Plan' + OPTIONAL_LABEL, status: stringStatus(d.handholdingActionPlanData), onPress: module('handholdingActionPlan') });
    items.push({
      id: 'technology-intervention',
      label: 'Suggestion for Technology Intervention' + OPTIONAL_LABEL,
      status: stringStatus(d.suggestionForTechnologyIntervention),
      onPress: module('technologyIntervention'),
    });
  }
  if (!m4) {
    items.push({
      id: 'training-on-handholding',
      label: 'Training on Handholding Implementation Plan' + MANDATORY_LABEL,
      status: stringStatus(d.handholdingTraining),
      onPress: step(() => nav.push('Training', { handholding: true })),
    });
  }
  if (!m1 && !m4) {
    items.push({ id: 'progress-review', label: isThirdMilestone(d) ? 'Progress Review 2' : 'Progress Review 1', status: stringStatus(d.progressReview), onPress: module('progressReview') });
  }
  if (lead && !m4 && !d.isCloseMeetingSubmitted) {
    items.push({
      id: 'closing-meeting',
      label: 'Closing Meeting',
      status: null,
      onPress: () => {
        if (!allowCloseMeetingCapturing(d)) return ui.showAlert('Please complete all the sections in order to close the meeting');
        nav.push('Meeting', { isCloseMeeting: true });
      },
    });
  }
  if (m4) {
    const submitted = d.technologyUpgradationStatus === Status.SUBMITTED;
    items.push({
      id: 'technology-upgradation',
      label: 'Technology Upgradation' + MANDATORY_LABEL,
      status: submitted ? COMPLETED_TEXT : null,
      onPress: step(() => {
        if (d.technologyUpgradationStatus === Status.SUBMITTED) return ui.snackbar('Information already submitted');
        nav.push('TechnologyUpgradation');
      }),
    });
  }
  if (!lead && !d.isCloseMeetingSubmitted) {
    items.push({
      id: 'final-submission',
      label: 'Final Submission',
      status: null,
      onPress: () => {
        if (!allowCloseMeetingCapturing(d)) return ui.showAlert('Please complete all the sections in order to close the meeting');
        nav.push('FinalComments', { finalSubmission: true, closeMeetingData: newAssessmentRequest(app) });
      },
    });
  }
  items.push({ id: 'sync-data', label: 'Sync Data', status: '', leading: images.ic_sync_dashboard, onPress: () => nav.push('SubmitParameters') });
  items.push({
    id: 'clear-data',
    label: 'Clear Data',
    status: '',
    leading: images.ic_sync_dashboard,
    onPress: () =>
      // Positive "No", negative "Yes", as the legacy dialog; Yes removes the consultancy and leaves the app.
      ui.alert('Alert', 'Are you sure you want to clear the data associated with this login?', [
        { text: 'Yes', onPress: async () => {
          await app.deleteAssessorData();
          nav.reset([{ name: 'Login' }]);
          BackHandler.exitApp();
        } },
        { text: 'No', style: 'cancel' },
      ]),
  });

  return (
    <SaFrame testID="assessment-options">
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Dashboard</Text>
        {items.map(item => {
          // configureOption: "Submitted" shows as "Completed"; nothing yet is "Not completed".
          const status = item.status === SUBMITTED_TEXT ? COMPLETED_TEXT : item.status;
          const completed = status === COMPLETED_TEXT;
          return (
            <MenuRow
              key={item.id}
              label={item.label}
              status={status ?? NOT_COMPLETED}
              statusColor={completed ? sa.teal : undefined}
              statusBold={completed}
              leading={item.leading}
              onPress={item.onPress}
              testID={`option-${item.id}`}
            />
          );
        })}
      </ScrollView>
    </SaFrame>
  );
}

const styles = StyleSheet.create({
  content: { padding: 12 },
  heading: { fontSize: 22, fontWeight: 'bold', color: sa.subheading, marginBottom: 8, marginTop: 5, alignSelf: 'stretch' },
});
