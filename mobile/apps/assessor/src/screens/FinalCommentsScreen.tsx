import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { isNetworkAvailable, isNetworkError, isSuccess, OutlinedInput, useNavigation, useRoute, useUi } from '@zed/shared';
import { useSa } from '../app/context';
import { isLatestEntryLogout } from '../attendance';
import { basicInfoSubmitted, needsBasicInfoFirst, saveCloseMeeting, submitBasicInformation, submitEndAssessment } from '../flows/submissions';
import { areAllParametersSubmitted, FAILED_TO_SUBMIT, SAVED_LOCALLY, UNKNOWN_ERROR, type SubmitAssessmentRequest } from '../models';
import { SaButton, SaFrame, sa } from '../ui/kit';

export const ASSESSMENT_COMPLETED = 'Assessment completed successfully and all the details are submitted\n\n Thank You!';

/** The end of FinalCommentsActivity and SubmitParametersActivity after SubmitEndAssessment answered "1". */
export function useSubmissionSuccess() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  return async () => {
    if (await app.deleteAssessorData()) {
      ui.alert(null, ASSESSMENT_COMPLETED, [{ text: 'OK', onPress: () => nav.reset([{ name: 'Login' }]) }], false);
    } else {
      ui.toast('Error occurred while removing local data', { long: true });
    }
  };
}

/** FinalCommentsActivity: the closing meeting's (or the assessor's final) comments, then SubmitEndAssessment. */
export function FinalCommentsScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const { params } = useRoute<{ closeMeetingData?: SubmitAssessmentRequest }>();
  const request = params.closeMeetingData;
  const [comment, setComment] = useState('');
  const onSuccess = useSubmissionSuccess();
  const d = app.details!;

  useEffect(() => {
    if (!request) {
      ui.toast('Data Missing');
      nav.pop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!request) return null;

  // This screen's showAlert goes back to the assessment options.
  const leave = (message: string) => ui.alert(null, message, [{ text: 'OK', onPress: () => nav.reset([{ name: 'AssessmentOptions' }]) }], false);

  const submitData = async (): Promise<void> => {
    const offline = async () => {
      if (await saveCloseMeeting(app, request)) leave(SAVED_LOCALLY);
      else ui.toast('Network is not available');
    };
    if (!(await isNetworkAvailable())) return offline();
    if (needsBasicInfoFirst(app) && d.saBasicInformation) {
      ui.showLoading();
      const r = await submitBasicInformation(app, d.saBasicInformation);
      ui.hideLoading();
      if (!isSuccess(r)) return ui.toast(r.errorMessage ?? UNKNOWN_ERROR);
      await basicInfoSubmitted(app);
      return submitData();
    }
    if (!isLatestEntryLogout(d.attendanceData!)) {
      ui.alert(
        null,
        'Please perform punch out to continue with final submit',
        [
          {
            text: 'OK',
            onPress: () =>
              nav.push('Attendance', {
                onResult: (ok: boolean) => ok && isLatestEntryLogout(app.details!.attendanceData!) && submitData(),
              }),
          },
        ],
        false,
      );
      return;
    }
    ui.showLoading('This might take a while, Please Wait...');
    let response = null;
    try {
      response = await submitEndAssessment(app, request);
    } catch (e) {
      ui.hideLoading();
      if (isNetworkError(e)) return offline();
    }
    ui.hideLoading();
    const status = response ? String(response.status ?? '') : '';
    if (status === '1') {
      await onSuccess();
    } else if (status === '4') {
      if (await saveCloseMeeting(app, request)) {
        leave((response?.errorMessage ? response.errorMessage + '\n\n' : '') + 'Meeting Data saved locally, you can submit later from Sync Parameters option');
      } else {
        ui.toast('Error while submitting data');
      }
    } else {
      ui.toast(response?.errorMessage ? response.errorMessage : FAILED_TO_SUBMIT, { long: true });
    }
  };

  const onSubmit = async () => {
    request.userType = d.userType;
    request.endComment = comment;
    if (!areAllParametersSubmitted(d)) {
      await saveCloseMeeting(app, request);
      leave('As there are Parameters yet to submit, Close meeting data is saved locally. You can submit later while syncing parameters');
      return;
    }
    await submitData();
  };

  return (
    <SaFrame testID="final-comments">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label} testID="final-comments-label">
          {d.userType === 1 ? 'Assessment Summary' : 'Comments'}
        </Text>
        {/* The counter of the layout (500) stayed although the screen allowed 1000 characters. */}
        <OutlinedInput value={comment} onChangeText={setComment} multiline showCounter maxLength={1000} autoCapitalize="sentences" testID="final-comment" />
        <SaButton title="Submit" large onPress={onSubmit} testID="final-submit" />
      </ScrollView>
    </SaFrame>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  label: { color: sa.darkGrey, fontSize: 16, fontWeight: 'bold', marginBottom: 5 },
});
