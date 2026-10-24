import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useBackHandler, useNavigation, useUi } from '@zed/shared';
import { useSa } from '../app/context';
import { isAttendanceTakenToday, isLoggedOutToday } from '../attendance';
import { clearMeetingDraft, newAssessmentRequest } from '../flows/submissions';
import { areAllParametersCompletedOrSubmitted, IN_PROGRESS, COMPLETED, SUBMITTED, isSaBasicInfoCompleted, isSaBasicInfoSubmitted } from '../models';
import { SaButton, SaFrame } from '../ui/kit';
import { showExitAlert } from './common';

/** AssessmentOptionsActivity: the assessment's steps. */
export function AssessmentOptionsScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const d = app.details!;
  const lead = d.userType === 1;

  // The legacy onBackPressed finished the (only) activity and then showed the exit question; here the question.
  useBackHandler(() => {
    showExitAlert(ui);
    return true;
  });

  const started = (d.allottedParameters ?? []).some(p => p && (p.status === IN_PROGRESS || p.status === COMPLETED || p.status === SUBMITTED));

  /** onClick: every step but Attendance needs today's punch-in and no punch-out. */
  const step = (action: () => void) => () => {
    if (!isAttendanceTakenToday(d.attendanceData)) return ui.snackbar('Please log the attendance today to proceed');
    if (isLoggedOutToday(d.attendanceData)) return ui.snackbar("You've already punched out for the day");
    action();
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
    nav.push(d.isSelfieSubmitted ? 'ParametersPager' : 'Selfie');
  });

  const closeMeeting = step(() => {
    if (!areAllParametersCompletedOrSubmitted(d)) return ui.showAlert('Please complete all the parameters to close the meeting');
    if (!d.allowFinalSubmit && !isSaBasicInfoCompleted(d)) return ui.showAlert('Please capture Basic Info to close the meeting');
    clearMeetingDraft(app);
    nav.push('Meeting', { isCloseMeeting: true });
  });

  const finalSubmission = step(() => {
    if (!areAllParametersCompletedOrSubmitted(d)) return ui.showAlert('Please complete all the parameters to proceed to final submission');
    nav.push('FinalComments', { finalSubmission: true, closeMeetingData: newAssessmentRequest(app) });
  });

  return (
    <SaFrame testID="assessment-options">
      <ScrollView contentContainerStyle={styles.content}>
        <SaButton title="Attendance" large onPress={() => nav.push('Attendance')} testID="option-attendance" />
        {lead && !d.isOpenMeetingSubmitted ? <SaButton title="Opening Meeting" large onPress={openMeeting} testID="option-open-meeting" /> : null}
        {lead ? (
          <SaButton title={isSaBasicInfoSubmitted(d) ? 'Edit Basic Info' : 'Capture Basic Info'} large onPress={step(() => nav.push('BasicInformation'))} testID="option-basic-info" />
        ) : null}
        {!d.isSiteTourSubmitted ? <SaButton title="Site Tour" large onPress={siteTour} testID="option-site-tour" /> : null}
        <SaButton title={started ? 'Continue Assessment' : 'Start Assessment'} large onPress={startAssessment} testID="option-start-assessment" />
        <SaButton title="Sync Assessment" large onPress={step(() => nav.push('SubmitParameters'))} testID="option-sync" />
        {lead && !d.isCloseMeetingSubmitted ? <SaButton title="Closing Meeting" large onPress={closeMeeting} testID="option-close-meeting" /> : null}
        {!lead && !d.isCloseMeetingSubmitted ? <SaButton title="Final Submission" large onPress={finalSubmission} testID="option-final-submission" /> : null}
      </ScrollView>
    </SaFrame>
  );
}

const styles = StyleSheet.create({ content: { padding: 20 } });
