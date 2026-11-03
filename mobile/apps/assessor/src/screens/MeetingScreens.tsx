import React, { useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { isNetworkAvailable, isNetworkError, isSuccess, useNavigation, useRoute, useUi, type Coordinates } from '@zed/shared';
import { useSa } from '../app/context';
import { randomUuid } from '../util/uuid';
import {
  meetingDraft,
  newAssessmentRequest,
  openMeetingSubmitted,
  saveOpenMeetingOffline,
  setMeetingDraft,
} from '../flows/submissions';
import { useInlineCapture } from '../photo/capture';
import { FAILED_TO_SUBMIT, newPhotoInformation, SAVED_LOCALLY, type Participant, type PhotoInformation, type SubmitAssessmentRequest } from '../models';
import { Avatar, C, Card, CharCounter, Field, HeroHeader, Page, SectionLabel, Strip, z, ZButton, ZIcon, ZScroll, type IconName } from '../ui/zed';

const COMMENT_MAX = 500;

// ------------------------------------------------------------------ building blocks of the on-site screens (also used by Attendance and Final Comments)

/** The image of an inline (base64) photo. */
export const base64Uri = (base64: string) => `data:image/jpeg;base64,${base64.replace(/\s/g, '')}`;

/** "lat, long" of a geo-tag, or null without one. */
export function geoText(lat: string | number | null | undefined, long: string | number | null | undefined): string | null {
  return lat != null && long != null && lat !== '' && long !== '' ? `${lat}, ${long}` : null;
}

/**
 * The full-width bottom call to action. Not `ready` (something still missing) it looks disabled like the design's
 * empty state, but stays pressable so the screen's own checks still answer with their messages.
 */
export function SubmitButton({ title, ready, onPress, style, testID }: { title: string; ready: boolean; onPress: () => void; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <Pressable style={({ pressed }) => [styles.submit, !ready && styles.submitIdle, pressed && { opacity: 0.85 }, style]} onPress={onPress} accessibilityRole="button" testID={testID}>
      <Text style={[styles.submitText, !ready && { color: C.tMuted }]}>{title}</Text>
    </Pressable>
  );
}

/** Dashed "nothing captured yet" box of any size (dashed_placeholder). */
export function DashedBox({ label, icon = 'camera', onPress, style, testID }: { label?: string; icon?: IconName; onPress?: () => void; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <Pressable style={[styles.dashed, style]} onPress={onPress} disabled={!onPress} testID={testID}>
      <ZIcon name={icon} size={22} color={C.tMuted} />
      {label ? <Text style={[z.muted, { marginTop: 6, textAlign: 'center' }]}>{label}</Text> : null}
    </Pressable>
  );
}

/** The tinted time / place card of the punch-out popup (07b). */
export function TimePlaceCard({ time, place }: { time: string; place: string }) {
  return (
    <View style={styles.timePlace}>
      <View style={z.rowCenter}>
        <ZIcon name="calendar" size={18} color={C.primary} />
        <View style={{ marginLeft: 10, flex: 1 }}>
          <Text style={styles.smallCaps}>TIME</Text>
          <Text style={styles.timeValue}>{time}</Text>
        </View>
      </View>
      <View style={styles.timePlaceDivider} />
      <View style={z.rowCenter}>
        <ZIcon name="map-pin" size={16} color={C.primary} />
        <Text style={[z.sub, { marginLeft: 8, flex: 1 }]} numberOfLines={1}>
          {place}
        </Text>
      </View>
    </View>
  );
}

/** The selfie card of the punch-out popup (07b): preview, "Selfie required / captured", geo-tag, Capture / Retake. */
export function SelfieCard({ uri, geo, onPress, testID }: { uri: string | null; geo: string | null; onPress: () => void; testID?: string }) {
  return (
    <View style={styles.selfieCard}>
      {uri ? (
        <Image source={{ uri }} style={[styles.selfieSize, styles.selfiePhoto]} resizeMode="cover" testID={testID ? `${testID}-image` : undefined} />
      ) : (
        <DashedBox onPress={onPress} style={styles.selfieSize} />
      )}
      <View style={{ flex: 1, marginLeft: 16 }}>
        <ZIcon name="camera" size={22} color={C.primary} />
        <Text style={[styles.selfieState, !uri && { color: C.tMuted }]}>{uri ? 'Selfie captured' : 'Selfie required'}</Text>
        <View style={[z.rowCenter, { marginTop: 6 }]}>
          <ZIcon name="map-pin" size={12} color={C.tMuted} />
          <Text style={[z.muted, { marginLeft: 4, flex: 1 }]} numberOfLines={2}>
            {geo ? `Geo-tagged · ${geo}` : 'Geo-tagged'}
          </Text>
        </View>
        <Pressable style={styles.pill} onPress={onPress} testID={testID}>
          <Text style={styles.pillText}>{uri ? 'Retake' : 'Capture'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ screens

/** SiteImagesCapturingActivity: the opening meeting's two site exterior photos (redesign; the legacy took an exterior and an interior one). */
export function SiteImagesScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const { capture } = useInlineCapture();
  // Redesign: two photos of the site exterior (was one exterior and one interior).
  const [exterior, setExterior] = useState<PhotoInformation>(() => newPhotoInformation(randomUuid));
  const [exterior2, setExterior2] = useState<PhotoInformation>(() => newPhotoInformation(randomUuid));
  const request = useMemo(() => newAssessmentRequest(app), [app]);

  const take = async (which: 'exterior' | 'exterior-2') => {
    const shot = await capture();
    if (!shot) return;
    const update = (p: PhotoInformation): PhotoInformation => ({
      ...p,
      photo: shot.base64,
      timeStamp: shot.timeStamp,
      name: which === 'exterior' ? 'Site Exterior Photo 1' : 'Site Exterior Photo 2',
    });
    if (which === 'exterior') setExterior(update);
    else setExterior2(update);
  };

  const proceed = () => {
    if (!exterior.photo || !exterior2.photo) return ui.toast('Please capture 2 site exterior photos');
    request.assessmentPhotos = [exterior, exterior2];
    setMeetingDraft(app, request);
    nav.push('Meeting', { fromSiteImages: true });
  };

  const shots = [
    { key: 'exterior' as const, label: 'Site Exterior 1', photo: exterior },
    { key: 'exterior-2' as const, label: 'Site Exterior 2', photo: exterior2 },
  ];
  const done = shots.filter(s => s.photo.photo).length;
  // The first missing photo is the one to take next (the design's orange "Capture" tile).
  const next = shots.find(s => !s.photo.photo)?.key;

  return (
    <Page testID="site-images">
      <HeroHeader title="Site Photos" subtitle={app.zedId} onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={z.screenPad}>
        <View style={styles.banner}>
          <ZIcon name="camera" size={22} color={C.primary} />
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={styles.bannerTitle}>Site Exterior · 2 photos required</Text>
            <Text style={z.sub}>Capture two photos of the site exterior.</Text>
            <View style={[z.rowCenter, { marginTop: 4 }]}>
              <ZIcon name="map-pin" size={11} color={C.primary} />
              <Text style={styles.bannerGeo}>All photos geo-tagged automatically</Text>
            </View>
          </View>
        </View>
        <View style={styles.tiles}>
          {shots.map(s =>
            s.photo.photo ? (
              <Pressable key={s.key} style={styles.tile} onPress={() => take(s.key)} testID={`site-${s.key}`}>
                <Image source={{ uri: base64Uri(s.photo.photo) }} style={StyleSheet.absoluteFill} resizeMode="cover" testID={`site-${s.key}-image`} />
                <View style={styles.tilePin}>
                  <ZIcon name="map-pin" size={14} color={C.tInverse} />
                </View>
                <View style={styles.tileBar}>
                  <Text style={styles.tileBarText} numberOfLines={1}>{`${s.label} · ${s.photo.timeStamp ?? ''}`}</Text>
                </View>
              </Pressable>
            ) : s.key === next ? (
              <Pressable key={s.key} style={[styles.tile, styles.tileNext]} onPress={() => take(s.key)} testID={`site-${s.key}`}>
                <ZIcon name="camera" size={32} color={C.primary} />
                <Text style={styles.tileNextText}>Capture</Text>
                <Text style={z.muted}>{s.label}</Text>
              </Pressable>
            ) : (
              <DashedBox key={s.key} label={s.label} onPress={() => take(s.key)} style={[styles.tile, { backgroundColor: C.surface }]} testID={`site-${s.key}`} />
            ),
          )}
        </View>
        <Strip
          tone={done === 2 ? 'success' : 'warning'}
          icon={done === 2 ? 'check' : 'info'}
          title={`${done} of 2 photos captured`}
          text={done === 2 ? 'Section ready for submission.' : 'Ensure the unit name is visible in the frame.'}
        />
        <SubmitButton title="Proceed" ready={done === 2} onPress={proceed} style={{ marginTop: 8 }} testID="site-images-proceed" />
      </ZScroll>
    </Page>
  );
}

/** MeetingDataCollectionActivity: opening (submitted here) or closing (continues to the final comments) meeting. */
export function MeetingScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const { params } = useRoute<{ isCloseMeeting?: boolean; fromSiteImages?: boolean }>();
  const isClose = params.isCloseMeeting === true;
  const title = isClose ? 'Closing Meeting Photo' : 'Opening Meeting Photo';
  const d = app.details!;
  const request = useRef<SubmitAssessmentRequest>((params.fromSiteImages ? meetingDraft(app) : null) ?? newAssessmentRequest(app)).current;
  const [photo, setPhoto] = useState<PhotoInformation>(() => newPhotoInformation(randomUuid));
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [participants, setParticipants] = useState<Participant[]>(() => {
    if (isClose && d.openMeetingParticipants?.length) return d.openMeetingParticipants.map(p => ({ name: p.name, designation: p.designation }));
    return (d.assessors ?? []).filter(Boolean).map(a => ({ name: a.assessorName, designation: a.userType === '1' ? 'Lead Assessor' : 'Assessor' }));
  });
  const [comment, setComment] = useState('');
  // showAlert of this screen also leaves it (for the offline message and a mocked location alike).
  const leave = (message: string) => ui.alert(null, message, [{ text: 'OK', onPress: () => nav.reset([{ name: 'AssessmentOptions' }]) }], false);
  const { capture } = useInlineCapture({ onConnectionFailure: leave });

  const takePhoto = async () => {
    const shot = await capture();
    if (!shot) return;
    setCoords(shot.coords);
    setPhoto(p => ({ ...p, photo: shot.base64, timeStamp: shot.timeStamp, name: title }));
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

  const submitOpenMeeting = async () => {
    const offline = async () => {
      if (await saveOpenMeetingOffline(app, request, participants)) leave(SAVED_LOCALLY);
      else ui.toast('Network is not available');
    };
    if (!(await isNetworkAvailable())) return offline();
    ui.showLoading('Please Wait...');
    let response = null;
    try {
      response = await app.api.submitStartAssessment(request);
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
    if (isClose) nav.push('FinalComments', { closeMeetingData: request });
    else submitOpenMeeting();
  };

  const captured = !!photo.photo;
  const full = participants.length >= 15;
  const geo = coords ? geoText(coords.latitude, coords.longitude) : null;

  return (
    <Page testID="meeting">
      <HeroHeader title={isClose ? 'Closing Meeting' : 'Opening Meeting'} subtitle={app.zedId} onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={z.screenPad} keyboardShouldPersistTaps="handled">
        <Card>
          <View style={z.rowCenter}>
            <ZIcon name="calendar" size={18} color={C.primary} />
            <View style={{ marginLeft: 10, flex: 1 }}>
              <Text style={styles.smallCaps}>TIME</Text>
              <Text style={[styles.timeValue, !captured && { color: C.tMuted }]} testID="meeting-time">
                {captured ? photo.timeStamp ?? '' : 'Starts on tap'}
              </Text>
            </View>
          </View>
          <View style={styles.cardDivider} />
          <Text style={[styles.meetingState, { color: captured ? C.success : C.tMuted }]}>{captured ? (isClose ? 'Closing in progress' : 'Meeting in progress') : 'Not started'}</Text>
        </Card>

        <SectionLabel
          label={isClose ? 'Participants · auto-populated from Opening' : 'Participants'}
          right={
            <Pressable onPress={full ? undefined : addParticipant} disabled={full} hitSlop={8} testID="add-participant">
              <Text style={[styles.link, full && { color: C.tMuted }]}>+ Add</Text>
            </Pressable>
          }
        />
        <Card style={participants.length ? styles.participantsCard : null}>
          {participants.length === 0 ? (
            <DashedBox
              label={isClose ? 'Participants copy over from Opening Meeting' : 'No participants added yet'}
              icon="users"
              onPress={addParticipant}
              style={{ height: 68 }}
              testID="participants-empty"
            />
          ) : (
            participants.map((p, i) => (
              <View key={`${p.name}-${i}`} style={[styles.participant, i < participants.length - 1 && styles.participantDivider]}>
                <Avatar name={p.name ?? ''} size={28} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.participantName} testID={`participant-${i}`}>
                    {p.name}
                  </Text>
                  <Text style={z.sub}>{p.designation}</Text>
                </View>
                <Pressable
                  onPress={() => deleteParticipant(i)}
                  hitSlop={8}
                  style={[styles.deleteTouch, isClose && { backgroundColor: C.dangerBg }]}
                  accessibilityLabel="Delete participant"
                  testID={`participant-${i}-delete`}
                >
                  <ZIcon name="close" size={16} color={isClose ? C.danger : C.tMuted} />
                </Pressable>
              </View>
            ))
          )}
        </Card>

        {captured ? (
          <Pressable style={styles.photoDone} onPress={takePhoto} testID="meeting-photo">
            <ZIcon name="check" size={22} color={C.success} />
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={styles.photoDoneTitle}>{isClose ? 'Closing-meeting photo captured' : 'Group photo captured'}</Text>
              <View style={[z.rowCenter, { marginTop: 3 }]} testID="lat-long">
                <ZIcon name="map-pin" size={12} color={C.tMuted} />
                <Text style={[z.muted, { marginLeft: 4, flex: 1 }]} numberOfLines={1}>
                  {geo ? `Geo-tagged · ${geo}` : 'Geo-tagged automatically'}
                </Text>
              </View>
            </View>
            <Image source={{ uri: base64Uri(photo.photo!) }} style={styles.photoThumb} resizeMode="cover" testID="meeting-photo-image" />
            <ZIcon name="chevron-right" size={20} color={C.tMuted} />
          </Pressable>
        ) : (
          <DashedBox
            label={isClose ? 'Capture closing-meeting photo · geo-tagged' : 'Capture group photo · geo-tagged'}
            onPress={takePhoto}
            style={styles.photoEmpty}
            testID="meeting-photo"
          />
        )}

        {!isClose ? (
          <View>
            <SectionLabel label="Remarks" right={<CharCounter used={comment.length} limit={COMMENT_MAX} />} />
            <Field value={comment} onChangeText={setComment} multiline maxLength={COMMENT_MAX} autoCapitalize="sentences" placeholder="Add meeting remarks" testID="meeting-comment" />
          </View>
        ) : null}
        <SubmitButton title={isClose ? 'Proceed' : 'Submit'} ready={captured && participants.length > 0} onPress={onSubmit} style={{ marginTop: 8 }} testID="meeting-submit" />
      </ZScroll>
    </Page>
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
      <Field label="Name" placeholder="Name" icon="user" value={name} onChangeText={setName} autoCapitalize="words" error={error.name} testID="participant-name" />
      <Field
        label="Designation"
        placeholder="Designation"
        icon="clipboard"
        value={designation}
        onChangeText={setDesignation}
        autoCapitalize="words"
        error={error.designation}
        testID="participant-designation"
      />
      <View style={styles.dialogButtons}>
        <ZButton title="Cancel" variant="ghost" onPress={() => onDone(null)} style={{ flex: 36 }} testID="participant-cancel" />
        <ZButton title="Add participant" onPress={add} style={{ flex: 64, marginLeft: 12 }} testID="participant-add" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  submit: { minHeight: 52, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  submitIdle: { backgroundColor: C.muted },
  submitText: { fontSize: 15, fontWeight: '700', color: C.tInverse, letterSpacing: 0.3 },
  dashed: { borderRadius: 12, borderWidth: 1.5, borderColor: C.border, borderStyle: 'dashed', backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', padding: 8 },
  smallCaps: { fontSize: 10, fontWeight: '600', color: C.tMuted, letterSpacing: 0.5 },
  timeValue: { fontSize: 14, fontWeight: '700', color: C.tPrimary, marginTop: 2 },
  timePlace: { backgroundColor: C.primaryBg, borderRadius: 12, padding: 12, marginBottom: 12 },
  timePlaceDivider: { height: 1, backgroundColor: C.divider, marginVertical: 10 },
  selfieCard: { flexDirection: 'row', borderColor: C.primary, borderWidth: 1, borderRadius: 12, padding: 12 },
  selfieSize: { width: 96, height: 116, borderRadius: 10 },
  selfiePhoto: { backgroundColor: C.tPrimary },
  selfieState: { fontSize: 13, fontWeight: '700', color: C.tPrimary, marginTop: 10 },
  pill: { marginTop: 10, height: 28, width: 96, borderRadius: 10, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontSize: 11, fontWeight: '700', color: C.primaryDark },
  banner: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: C.primaryBg, borderRadius: 12, padding: 16, marginBottom: 16 },
  bannerTitle: { fontSize: 13, fontWeight: '700', color: C.tPrimary, marginBottom: 2 },
  bannerGeo: { fontSize: 10, fontWeight: '600', color: C.primary, marginLeft: 4 },
  tiles: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  tile: { flex: 1, aspectRatio: 1 / 0.95, borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: C.primaryBg },
  tileNext: { backgroundColor: C.surface, borderColor: C.primary, borderWidth: 1 },
  tileNextText: { fontSize: 12, fontWeight: '700', color: C.primary, marginTop: 6 },
  tilePin: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  tileBar: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 28, backgroundColor: C.primary, justifyContent: 'center', paddingHorizontal: 10 },
  tileBarText: { fontSize: 10, fontWeight: '600', color: C.tInverse },
  cardDivider: { height: 1, backgroundColor: C.divider, marginVertical: 10 },
  meetingState: { fontSize: 11, fontWeight: '600', textAlign: 'center' },
  link: { fontSize: 12, fontWeight: '600', color: C.primary },
  participantsCard: { paddingVertical: 6 },
  participant: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  participantDivider: { borderBottomColor: C.divider, borderBottomWidth: 1 },
  participantName: { fontSize: 13, fontWeight: '600', color: C.tPrimary },
  deleteTouch: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  photoDone: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.primaryBg, borderRadius: 12, padding: 14, marginBottom: 12 },
  photoDoneTitle: { fontSize: 14, fontWeight: '600', color: C.tPrimary },
  photoThumb: { width: 40, height: 40, borderRadius: 8, marginHorizontal: 8 },
  photoEmpty: { height: 84, marginBottom: 12 },
  dialog: { backgroundColor: C.surface, borderRadius: 16, padding: 18, margin: 20 },
  dialogTitle: { fontSize: 17, fontWeight: '700', color: C.tPrimary, marginBottom: 14 },
  dialogButtons: { flexDirection: 'row', marginTop: 4 },
});
