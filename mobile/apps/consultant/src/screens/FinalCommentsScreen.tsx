import React, { useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { isNetworkAvailable, isNetworkError, isSuccess, useNavigation, useRoute, useUi } from '@zed/shared';
import { useSa } from '../app/context';
import { basicInfoSubmitted, needsBasicInfoFirst, saveCloseMeeting, submitBasicInformation, submitEndAssessment } from '../flows/submissions';
import { allowCloseMeetingSubmission, EVIDENCE_SITE_TOUR, FAILED_TO_SUBMIT, isLead, SAVED_LOCALLY, UNKNOWN_ERROR, type SubmitAssessmentRequest } from '../models';
import { C, CharCounter, HeroHeader, Page, SectionLabel, z, ZIcon, ZScroll } from '../ui/zed';
import { base64Uri, BulletComments, Footer, geoText, ParticipantRow, SubmitButton, useBulletComment } from './MeetingScreens';

/** The closing meeting's comments: 1000 characters as before. */
const COMMENT_MAX = 1000;

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
  const { params } = useRoute<{ closeMeetingData?: SubmitAssessmentRequest; finalSubmission?: boolean }>();
  const request = params.closeMeetingData;
  // Comments as "• point" lines, 1000 characters in all as before.
  const comments = useBulletComment(COMMENT_MAX);
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
    // A point still being typed is part of the comment.
    const comment = comments.final();
    if (comment == null) return;
    request.userType = d.userType;
    request.endComment = comment;
    if (allowCloseMeetingSubmission(d)) {
      await submitData();
      return;
    }
    await saveCloseMeeting(app, request);
    leave('As there is data yet to submit, Close meeting data is saved locally. You can submit later while syncing parameters');
  };

  // What the closing meeting captured (none on the co-consultant's final submission).
  const participants = request.endParticipants ?? [];
  const meetingPhoto = (request.assessmentPhotos ?? []).find(p => !!p.photo && (p.name ?? '').includes('Closing Meeting Photo')) ?? null;
  const geo = geoText(request.latitude, request.longitude);

  return (
    <Page testID="final-comments">
      <HeroHeader title={params.finalSubmission ? 'Final Submission' : 'Closing Meeting'} subtitle={app.zedId} onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={z.screenPad} keyboardShouldPersistTaps="handled">
        {participants.length > 0 ? (
          <View>
            <SectionLabel label="Participants" right={<Text style={z.muted}>{String(participants.length)}</Text>} style={{ marginTop: 0 }} />
            {participants.map((p, i) => (
              <ParticipantRow key={`${p.name}-${i}`} p={p} index={i} />
            ))}
          </View>
        ) : null}
        {meetingPhoto?.photo ? (
          <View style={styles.photoDone}>
            <ZIcon name="check" size={22} color={C.success} />
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={styles.photoDoneTitle}>Closing meeting photo captured</Text>
              <View style={[z.rowCenter, { marginTop: 3 }]}>
                <ZIcon name="map-pin" size={12} color={C.tMuted} />
                <Text style={[z.muted, { marginLeft: 4, flex: 1 }]} numberOfLines={1}>
                  {geo ? `Geo-tagged · ${geo}` : 'Geo-tagged automatically'}
                </Text>
              </View>
            </View>
            <Image source={{ uri: base64Uri(meetingPhoto.photo) }} style={styles.photoThumb} resizeMode="cover" />
          </View>
        ) : null}
        <View style={styles.labelRow}>
          <Text style={styles.label} testID="final-comments-label">
            {isLead(d) ? 'Consultancy Summary' : 'Comments'}
          </Text>
          <CharCounter used={comments.used} limit={COMMENT_MAX} />
        </View>
        <BulletComments b={comments} placeholder={isLead(d) ? 'Add a point of the consultancy summary' : 'Add a comment'} testID="final-comment" />
      </ZScroll>
      <Footer>
        <SubmitButton title="Submit" ready onPress={onSubmit} testID="final-submit" />
      </Footer>
    </Page>
  );
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 8 },
  label: { fontSize: 11, fontWeight: '600', color: C.tSecondary, letterSpacing: 0.5, textTransform: 'uppercase' },
  photoDone: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.primaryBg, borderRadius: 12, padding: 14, marginTop: 4, marginBottom: 12 },
  photoDoneTitle: { fontSize: 14, fontWeight: '600', color: C.tPrimary },
  photoThumb: { width: 40, height: 40, borderRadius: 8, marginLeft: 8 },
});
