import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { isNetworkAvailable, isNetworkError, isSuccess, OutlinedInput, useNavigation, useRoute, useUi, type Coordinates } from '@zed/shared';
import { useSa } from '../app/context';
import { PREFS } from '../db/stores';
import {
  newAssessmentRequest,
  newPhoto,
  openMeetingRequest,
  openMeetingSubmitted,
  saveOpenMeetingOffline,
  saveSitePhotos,
  submitOpenMeeting,
} from '../flows/submissions';
import { useInlineCapture } from '../photo/capture';
import {
  FAILED_TO_SUBMIT,
  hasSitePhotos,
  requestPhoto,
  SAVED_LOCALLY,
  SITE_EXTERIOR_PHOTO,
  SITE_INTERIOR_PHOTO,
  UNKNOWN_ERROR,
  type Participant,
  type PhotoInformation,
  type SubmitAssessmentRequest,
} from '../models';
import { PhotoTile, SaButton, SaFrame, sa } from '../ui/kit';

const COMMENT_MAX = 500;

/** SiteImagesCapturingActivity: the site exterior and interior photos, kept in the opening meeting row. */
export function SiteImagesScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const { capture } = useInlineCapture();
  const [request, setRequest] = useState<SubmitAssessmentRequest | null>(null);
  const [exterior, setExterior] = useState<PhotoInformation>(() => newPhoto());
  const [interior, setInterior] = useState<PhotoInformation>(() => newPhoto());

  useEffect(() => {
    // removePreference(ASSESSMENT_PREFS, ASSESSMENT_DATA)
    app.prefs.remove(PREFS.assessment, PREFS.assessmentData);
    openMeetingRequest(app).then(r => {
      const ext = requestPhoto(r, SITE_EXTERIOR_PHOTO);
      const int = requestPhoto(r, SITE_INTERIOR_PHOTO);
      if (ext) setExterior(ext);
      if (int) setInterior(int);
      setRequest(r);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const take = async (which: 'exterior' | 'interior') => {
    const shot = await capture();
    if (!shot) return;
    const update = (p: PhotoInformation): PhotoInformation => ({
      ...p,
      photo: shot.base64,
      timeStamp: shot.timeStamp,
      name: which === 'exterior' ? SITE_EXTERIOR_PHOTO : SITE_INTERIOR_PHOTO,
    });
    if (which === 'exterior') setExterior(update);
    else setInterior(update);
  };

  const proceed = async () => {
    if (!request) return;
    if (!exterior.photo) return ui.toast('Please capture site exterior photo');
    if (!interior.photo) return ui.toast('Please capture site interior photo');
    if (await saveSitePhotos(app, request, exterior, interior)) nav.pop();
    else ui.toast(UNKNOWN_ERROR);
  };

  return (
    <SaFrame testID="site-images">
      <ScrollView contentContainerStyle={styles.content}>
        <PhotoTile title="Site Exterior Photo (With Unit Name Board)" base64={exterior.photo} onPress={() => take('exterior')} testID="site-exterior" />
        <PhotoTile title="Site Interior Photo (Working Area)" base64={interior.photo} onPress={() => take('interior')} testID="site-interior" />
        <SaButton title="Proceed" large onPress={proceed} testID="site-images-proceed" />
      </ScrollView>
    </SaFrame>
  );
}

/** MeetingDataCollectionActivity: opening (submitted here) or closing (continues to the final comments) meeting. */
export function MeetingScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const { params } = useRoute<{ isCloseMeeting?: boolean }>();
  const isClose = params.isCloseMeeting === true;
  const title = isClose ? 'Closing Meeting Photo' : 'Opening Meeting Photo';
  const d = app.details!;
  // The opening meeting row (site photos, and anything saved before), or a new request.
  const request = useRef<SubmitAssessmentRequest>(newAssessmentRequest(app));
  const currentRequest = () => request.current;
  const [shownPhoto, setShownPhoto] = useState<string | null>(null);
  const [photo, setPhoto] = useState<PhotoInformation>(() => newPhoto());
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [participants, setParticipants] = useState<Participant[]>(() => {
    if (isClose && d.openMeetingParticipants?.length) return d.openMeetingParticipants.map(p => ({ name: p.name, designation: p.designation }));
    return (d.assessors ?? []).filter(Boolean).map(a => ({ name: a.assessorName, designation: a.userType === '1' ? 'Lead Consultant' : 'Consultant' }));
  });
  const [comment, setComment] = useState('');

  useEffect(() => {
    openMeetingRequest(app).then(r => {
      request.current = r;
      // The saved photo of this meeting is shown (a new one is still needed to submit, as in the legacy screen).
      setShownPhoto(requestPhoto(r, title)?.photo ?? null);
      if (r.inputComment) setComment(r.inputComment);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // showAlert of this screen also leaves it (for the offline message and a mocked location alike).
  const leave = (message: string) => ui.alert(null, message, [{ text: 'OK', onPress: () => nav.reset([{ name: 'AssessmentOptions' }]) }], false);
  const { capture } = useInlineCapture({ onConnectionFailure: leave });

  const takePhoto = async () => {
    const shot = await capture();
    if (!shot) return;
    setCoords(shot.coords);
    setPhoto(p => ({ ...p, photo: shot.base64, timeStamp: shot.timeStamp, name: title }));
    setShownPhoto(shot.base64);
  };

  const addParticipant = async () => {
    const result = await promptParticipant(ui);
    if (result) setParticipants(list => [...list, result]);
  };

  const deleteParticipant = (index: number) => {
    ui.alert(
      null,
      'Are you sure, You want to delete the participant?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes',
          onPress: () => {
            setParticipants(list => list.filter((_, i) => i !== index));
            ui.toast('Participant Deleted Successfully');
          },
        },
      ],
      true,
    );
  };

  /** validateAndPrepareRequest */
  const prepare = (): boolean => {
    const request = currentRequest();
    if (!photo.photo) {
      ui.toast(isClose ? 'Please capture closing meeting photo' : 'Please capture opening meeting photo');
      return false;
    }
    // removeIfPhotoExists(name), then the new photo
    request.assessmentPhotos = (request.assessmentPhotos ?? []).filter(p => !(p.name ?? '').includes(photo.name ?? ''));
    request.assessmentPhotos.push(photo);
    if (!coords) {
      ui.toast('Please capture Geotag');
      return false;
    }
    request.latitude = coords.latitude;
    request.longitude = coords.longitude;
    for (const p of request.assessmentPhotos) {
      p.latitude = request.latitude;
      p.longitude = request.longitude;
    }
    if (participants.length === 0) {
      ui.toast('Please enter at least one Participant details');
      return false;
    }
    if (isClose) {
      request.endParticipants = participants;
    } else {
      request.startParticipants = participants;
      request.inputComment = comment;
    }
    return true;
  };

  const submitOpen = async () => {
    const request = currentRequest();
    await app.store.saveMeeting(app.userId, request, true);
    if (!hasSitePhotos(request)) return ui.toast('Please capture site photos to proceed');
    const offline = async () => {
      if (await saveOpenMeetingOffline(app, request, participants)) leave(SAVED_LOCALLY);
      else ui.toast('Network is not available');
    };
    if (!(await isNetworkAvailable())) return offline();
    ui.showLoading('Please Wait...');
    let response = null;
    try {
      response = await submitOpenMeeting(app, request);
    } catch (e) {
      ui.hideLoading();
      // New: no answer from the server -> kept and sent when the connection returns.
      if (isNetworkError(e)) return offline();
      response = null;
    }
    ui.hideLoading();
    if (isSuccess(response)) {
      ui.toast('Submitted successfully', { long: true });
      await openMeetingSubmitted(app, participants);
      nav.reset([{ name: 'AssessmentOptions' }]);
    } else {
      ui.toast(response?.errorMessage ? response.errorMessage : FAILED_TO_SUBMIT, { long: true });
    }
  };

  const onSubmit = () => {
    if (!prepare()) return;
    if (isClose) nav.push('FinalComments', { closeMeetingData: currentRequest() });
    else submitOpen();
  };

  return (
    <SaFrame testID="meeting">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <PhotoTile title={title} base64={shownPhoto} onPress={takePhoto} testID="meeting-photo" />
        <Text style={styles.sectionLabel}>Participants</Text>
        {participants.map((p, i) => (
          <View key={`${p.name}-${i}`} style={styles.participant}>
            <Text style={styles.participantText} testID={`participant-${i}`}>{`${p.name} - ${p.designation}`}</Text>
            <Pressable onPress={() => deleteParticipant(i)} testID={`participant-${i}-delete`} style={styles.deleteTouch}>
              <Text style={styles.deleteText}>✕</Text>
            </Pressable>
          </View>
        ))}
        <SaButton title="+ Add" onPress={addParticipant} disabled={participants.length >= 15} style={{ alignSelf: 'flex-start' }} testID="add-participant" />
        {!isClose ? (
          <View>
            <Text style={styles.sectionLabel}>Comments</Text>
            <OutlinedInput value={comment} onChangeText={setComment} multiline showCounter maxLength={COMMENT_MAX} autoCapitalize="sentences" testID="meeting-comment" />
          </View>
        ) : null}
        {coords ? (
          <View style={styles.latLong} testID="lat-long">
            <Text style={styles.latLongText}>{`Latitude : ${coords.latitude}`}</Text>
            <Text style={styles.latLongText}>{`Longitude : ${coords.longitude}`}</Text>
          </View>
        ) : null}
        <SaButton title={isClose ? 'Proceed' : 'Submit'} large onPress={onSubmit} testID="meeting-submit" />
      </ScrollView>
    </SaFrame>
  );
}

/** showAddParticipantDialog: Name and Designation (cap words) with their errors. */
function promptParticipant(ui: ReturnType<typeof useUi>): Promise<Participant | null> {
  return new Promise(resolve => {
    ui.custom(close => <ParticipantDialog onDone={p => (close(), resolve(p))} />, () => resolve(null));
  });
}

function ParticipantDialog({ onDone }: { onDone: (p: Participant | null) => void }) {
  const [name, setName] = useState('');
  const [designation, setDesignation] = useState('');
  const [error, setError] = useState<{ name?: string; designation?: string }>({});
  const add = () => {
    if (name.length <= 0) return setError({ name: 'Please enter the Participant Name' });
    if (designation.length <= 0) return setError({ designation: 'Please enter the Participant Designation' });
    onDone({ name, designation });
  };
  return (
    <View style={styles.dialog} testID="participant-dialog">
      <Text style={styles.dialogTitle}>Enter Participant Information</Text>
      <TextInput style={styles.dialogInput} placeholder="Name" value={name} onChangeText={setName} autoCapitalize="words" testID="participant-name" />
      {error.name ? <Text style={styles.dialogError}>{error.name}</Text> : null}
      <TextInput style={styles.dialogInput} placeholder="Designation" value={designation} onChangeText={setDesignation} autoCapitalize="words" testID="participant-designation" />
      {error.designation ? <Text style={styles.dialogError}>{error.designation}</Text> : null}
      <View style={styles.dialogButtons}>
        <Text style={styles.dialogButton} onPress={() => onDone(null)} testID="participant-cancel">
          CANCEL
        </Text>
        <Text style={styles.dialogButton} onPress={add} testID="participant-add">
          ADD PARTICIPANT
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  sectionLabel: { color: sa.darkGrey, fontSize: 16, fontWeight: 'bold', marginTop: 12, marginBottom: 5 },
  participant: { flexDirection: 'row', alignItems: 'center', backgroundColor: sa.paleGrey, borderRadius: 3, marginBottom: 5, paddingLeft: 10 },
  participantText: { flex: 1, color: sa.darkGrey, fontSize: 15, paddingVertical: 8 },
  deleteTouch: { padding: 10 },
  deleteText: { color: '#EE4056', fontSize: 16, fontWeight: 'bold' },
  latLong: { marginTop: 8 },
  latLongText: { color: sa.darkGrey, fontSize: 15 },
  dialog: { backgroundColor: sa.white, borderRadius: 4, padding: 20, margin: 24 },
  dialogTitle: { fontSize: 18, fontWeight: '500', color: sa.black, marginBottom: 10 },
  dialogInput: { borderBottomColor: sa.primary, borderBottomWidth: 1, fontSize: 16, marginTop: 10, paddingVertical: 6 },
  dialogError: { color: '#B00020', fontSize: 13 },
  dialogButtons: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 },
  dialogButton: { color: sa.primary, fontWeight: '500', fontSize: 14, paddingHorizontal: 12, paddingVertical: 8 },
});
