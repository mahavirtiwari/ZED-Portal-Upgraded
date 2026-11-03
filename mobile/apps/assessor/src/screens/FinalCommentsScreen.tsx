import React, { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { isNetworkAvailable, isNetworkError, isSuccess, useNavigation, useRoute, useUi } from '@zed/shared';
import { useSa } from '../app/context';
import { isLatestEntryLogout } from '../attendance';
import { basicInfoSubmitted, needsBasicInfoFirst, saveCloseMeeting, submitBasicInformation, submitEndAssessment } from '../flows/submissions';
import { areAllParametersSubmitted, FAILED_TO_SUBMIT, SAVED_LOCALLY, UNKNOWN_ERROR, type SubmitAssessmentRequest } from '../models';
import { Avatar, C, CharCounter, Card, Field, HeroHeader, Page, SectionLabel, ZIcon, z } from '../ui/zed';
import { base64Uri, geoText, SubmitButton } from './MeetingScreens';

const COMMENT_MAX = 1000;

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
  const { params } = useRoute<{ closeMeetingData?: SubmitAssessmentRequest; finalSubmission?: boolean }>();
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

  // What the closing meeting captured (none on the assessor's final submission).
  const participants = request.endParticipants ?? [];
  const meetingPhoto = (request.assessmentPhotos ?? []).find(p => !!p.photo && (p.name ?? '').includes('Closing Meeting Photo')) ?? null;
  const geo = geoText(request.latitude, request.longitude);
  const summaryLabel = d.userType === 1 ? 'Assessment Summary' : 'Comments';

  return (
    <Page testID="final-comments">
      <HeroHeader title={params.finalSubmission ? 'Final Submission' : 'Closing Meeting'} subtitle={app.zedId} onBack={() => nav.pop()} />
      <ScrollView contentContainerStyle={z.screenPad} keyboardShouldPersistTaps="handled">
        {participants.length > 0 ? (
          <View>
            <SectionLabel label="Participants" right={<Text style={z.muted}>{String(participants.length)}</Text>} />
            <Card style={styles.participantsCard}>
              {participants.map((p, i) => (
                <View key={`${p.name}-${i}`} style={[styles.participant, i < participants.length - 1 && styles.participantDivider]}>
                  <Avatar name={p.name ?? ''} size={28} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.participantName}>{p.name}</Text>
                    <Text style={z.sub}>{p.designation}</Text>
                  </View>
                </View>
              ))}
            </Card>
          </View>
        ) : null}
        {meetingPhoto?.photo ? (
          <View style={styles.photoDone}>
            <ZIcon name="check" size={22} color={C.success} />
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={styles.photoDoneTitle}>Closing-meeting photo captured</Text>
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
            {summaryLabel}
          </Text>
          <CharCounter used={comment.length} limit={COMMENT_MAX} />
        </View>
        {/* The legacy layout's counter said 500 although the screen allowed 1000 characters; the counter shows 1000. */}
        <Field
          value={comment}
          onChangeText={setComment}
          multiline
          maxLength={COMMENT_MAX}
          autoCapitalize="sentences"
          placeholder={d.userType === 1 ? 'Add the assessment summary' : 'Add your comments'}
          testID="final-comment"
        />
        <SubmitButton title="Submit" ready onPress={onSubmit} style={{ marginTop: 8 }} testID="final-submit" />
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 8 },
  label: { fontSize: 11, fontWeight: '600', color: C.tSecondary, letterSpacing: 0.5, textTransform: 'uppercase' },
  participantsCard: { paddingVertical: 6 },
  participant: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  participantDivider: { borderBottomColor: C.divider, borderBottomWidth: 1 },
  participantName: { fontSize: 13, fontWeight: '600', color: C.tPrimary },
  photoDone: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.primaryBg, borderRadius: 12, padding: 14, marginBottom: 12 },
  photoDoneTitle: { fontSize: 14, fontWeight: '600', color: C.tPrimary },
  photoThumb: { width: 40, height: 40, borderRadius: 8, marginLeft: 8 },
});
