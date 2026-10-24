import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { isNetworkAvailable, isNetworkError, isSuccess, OutlinedInput, useNavigation, useRoute, useUi } from '@zed/shared';
import { useSa } from '../app/context';
import { basicInfoSubmitted, needsBasicInfoFirst, saveCloseMeeting, submitBasicInformation, submitEndAssessment } from '../flows/submissions';
import { allowCloseMeetingSubmission, EVIDENCE_SITE_TOUR, FAILED_TO_SUBMIT, isLead, SAVED_LOCALLY, UNKNOWN_ERROR, type SubmitAssessmentRequest } from '../models';
import { SaButton, SaFrame, sa } from '../ui/kit';

/** FinalCommentsActivity's success text. */
export const CONSULTANCY_COMPLETED = 'Consultancy completed successfully and all the details are submitted\n\n Thank You!';
/** SubmitParametersActivity kept the site assessor app's text. */
export const ASSESSMENT_COMPLETED = 'Assessment completed successfully and all the details are submitted\n\n Thank You!';

/** The end of FinalCommentsActivity and SubmitParametersActivity after SubmitEndAssessment answered "1". */
export function useSubmissionSuccess(message: string) {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  return async () => {
    if (await app.deleteAssessorData()) {
      ui.alert(null, message, [{ text: 'OK', onPress: () => nav.reset([{ name: 'Login' }]) }], false);
    } else {
      ui.toast('Error occurred while removing local data', { long: true });
    }
  };
}

/** FinalCommentsActivity: the closing meeting's (or the co-consultant's final) comments, then SubmitEndAssessment. */
export function FinalCommentsScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const { params } = useRoute<{ closeMeetingData?: SubmitAssessmentRequest }>();
  const request = params.closeMeetingData;
  const [comment, setComment] = useState('');
  const onSuccess = useSubmissionSuccess(CONSULTANCY_COMPLETED);
  const d = app.details!;

  useEffect(() => {
    if (!request) {
      ui.toast('Data Missing');
      nav.pop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!request) return null;

  // This screen's showAlert goes back to the dashboard.
  const leave = (message: string) => ui.alert(null, message, [{ text: 'OK', onPress: () => nav.reset([{ name: 'AssessmentOptions' }]) }], false);

  const submitData = async (): Promise<void> => {
    if (!d.isSiteTourSubmitted && (await app.store.evidencesOfType(app.userId, EVIDENCE_SITE_TOUR)).length > 0) {
      return leave('Please sync Site Tour in order to final submit');
    }
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
    ui.showLoading('This might take a while, Please Wait...');
    let response = null;
    try {
      response = await submitEndAssessment(app, request, message => ui.toast(message, { long: true }));
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
    } else if (response) {
      ui.toast(response.errorMessage ? response.errorMessage : FAILED_TO_SUBMIT, { long: true });
    }
  };

  const onSubmit = async () => {
    request.userType = d.userType;
    request.endComment = comment;
    if (allowCloseMeetingSubmission(d)) {
      await submitData();
      return;
    }
    await saveCloseMeeting(app, request);
    leave('As there is data yet to submit, Close meeting data is saved locally. You can submit later while syncing parameters');
  };

  return (
    <SaFrame testID="final-comments">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label} testID="final-comments-label">
          {isLead(d) ? 'Consultancy Summary' : 'Comments'}
        </Text>
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
