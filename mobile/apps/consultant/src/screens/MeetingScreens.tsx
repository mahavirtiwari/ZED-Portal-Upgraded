import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isNetworkAvailable, isNetworkError, isSuccess, useNavigation, useRoute, useUi, type Coordinates } from '@zed/shared';
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
import { C, Card, CharCounter, Field, HeroHeader, Page, SectionLabel, Strip, useKeyboardHeight, z, ZButton, ZIcon, ZScroll, type IconName } from '../ui/zed';

const COMMENT_MAX = 500;

// ------------------------------------------------------------------ building blocks of the on-site screens (also used by Attendance, Training and Final Comments)

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

/** The white bar under the form that holds the bottom call to action. */
export function Footer({ children, testID }: { children: React.ReactNode; testID?: string }) {
  const insets = useSafeAreaInsets();
  // Above the keyboard there is no navigation bar to clear.
  const keyboard = useKeyboardHeight();
  return (
    <View style={[styles.footer, { paddingBottom: keyboard ? 12 : Math.max(insets.bottom, 12) }]} testID={testID}>
      {children}
    </View>
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

/** The outlined "Capture photograph" tile (capture_tile): camera, title and the geo-tag hint. */
export function CaptureTile({
  title = 'Capture photograph',
  hint = 'Geo-tagged and time-stamped automatically',
  onPress,
  style,
  testID,
}: {
  title?: string;
  hint?: string | null;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.captureTile, pressed && { opacity: 0.85 }, style]} onPress={onPress} accessibilityRole="button" testID={testID}>
      <ZIcon name="camera" size={28} color={C.primary} />
      <Text style={styles.captureTitle}>{title}</Text>
      {hint ? <Text style={[z.muted, { marginTop: 3, textAlign: 'center' }]}>{hint}</Text> : null}
    </Pressable>
  );
}

/** A captured photo (photo_tile): the image, the geo-tag pin (or another corner control) and the caption bar. */
export function ShotTile({
  uri,
  caption,
  onPress,
  corner,
  style,
  testID,
}: {
  uri: string | null;
  caption: string;
  onPress?: () => void;
  corner?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <Pressable style={[styles.shot, style]} onPress={onPress} disabled={!onPress} testID={testID}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" testID={testID ? `${testID}-image` : undefined} />
      ) : (
        <ZIcon name="image" size={28} color={C.primary} />
      )}
      {corner ?? (
        <View style={styles.shotPin}>
          <ZIcon name="map-pin" size={14} color={C.tInverse} />
        </View>
      )}
      <View style={styles.shotBar}>
        <Text style={styles.shotBarText} numberOfLines={1}>
          {caption}
        </Text>
      </View>
    </Pressable>
  );
}

/** The tinted time / place card of the punch popups (03c / 03e). */
export function TimePlaceCard({ time, place }: { time: string; place: string }) {
  return (
    <View style={styles.timePlace}>
      <View style={z.rowCenter}>
        <ZIcon name="calendar" size={18} color={C.primaryDark} />
        <View style={{ marginLeft: 10, flex: 1 }}>
          <Text style={styles.smallCaps}>TIME</Text>
          <Text style={styles.timeValue}>{time}</Text>
        </View>
      </View>
      <View style={[z.rowCenter, { marginTop: 10 }]}>
        <ZIcon name="map-pin" size={16} color={C.primaryDark} />
        <Text style={[z.sub, { marginLeft: 10, flex: 1 }]} numberOfLines={1}>
          {place}
        </Text>
      </View>
    </View>
  );
}

/** The selfie card of the punch popups (03c / 03f): preview, "Selfie required / captured", geo-tag, Capture / Retake. */
export function SelfieCard({ uri, geo, onPress, testID }: { uri: string | null; geo: string | null; onPress: () => void; testID?: string }) {
  return (
    <View style={[styles.selfieCard, !uri && styles.selfieCardEmpty]}>
      {uri ? (
        <Image source={{ uri }} style={[styles.selfieSize, styles.selfiePhoto]} resizeMode="cover" testID={testID ? `${testID}-image` : undefined} />
      ) : (
        <DashedBox onPress={onPress} style={styles.selfieSize} />
      )}
      <View style={{ flex: 1, marginLeft: 16 }}>
        {uri ? <ZIcon name="camera" size={22} color={C.primaryDark} /> : null}
        <Text style={[styles.selfieState, !uri && { marginTop: 0 }]}>{uri ? 'Selfie captured' : 'Selfie required'}</Text>
        {uri ? (
          <View style={[z.rowCenter, { marginTop: 6 }]}>
            <ZIcon name="map-pin" size={12} color={C.tMuted} />
            <Text style={[z.muted, { marginLeft: 4, flex: 1 }]} numberOfLines={2}>
              {geo ? `Geo-tagged · ${geo}` : 'Geo-tagged'}
            </Text>
          </View>
        ) : (
          <Text style={[z.muted, { marginTop: 4 }]}>A geo-tagged selfie must be captured for every punch.</Text>
        )}
        {uri ? (
          <Pressable style={styles.pill} onPress={onPress} testID={testID}>
            <Text style={styles.pillText}>Retake</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.pillFilled} onPress={onPress} testID={testID}>
            <ZIcon name="camera" size={15} color={C.tInverse} />
            <Text style={styles.pillFilledText}>Capture selfie</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** The design's trash icon (not in the kit). */
export function TrashIcon({ size = 18, color = C.danger }: { size?: number; color?: string }) {
  const sp = { fill: 'none', stroke: color, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M3 6h18" {...sp} />
      <Path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" {...sp} />
      <Path d="M5 6l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14" {...sp} />
      <Path d="M10 11v6M14 11v6" {...sp} />
    </Svg>
  );
}

/** The design's clock icon (not in the kit). */
export function ClockIcon({ size = 18, color = C.primary }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={9} fill="none" stroke={color} strokeWidth={1.8} />
      <Path d="M12 7v5l3 2" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** A tinted round initial (participants). */
export function Initial({ name, size = 30 }: { name: string; size?: number }) {
  return (
    <View style={[styles.initial, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.initialText, { fontSize: size * 0.42 }]}>{(name.trim()[0] ?? '?').toUpperCase()}</Text>
    </View>
  );
}

/** A participant card (name, designation) with an optional delete. */
export function ParticipantRow({ p, index, onDelete }: { p: Participant; index: number; onDelete?: () => void }) {
  return (
    <View style={styles.participant}>
      <Initial name={p.name ?? ''} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={styles.participantName} testID={onDelete ? `participant-${index}` : undefined}>
          {p.name}
        </Text>
        <Text style={z.sub}>{p.designation}</Text>
      </View>
      {onDelete ? (
        <Pressable onPress={onDelete} hitSlop={8} style={styles.deleteTouch} accessibilityLabel="Delete participant" testID={`participant-${index}-delete`}>
          <TrashIcon />
        </Pressable>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ comments as bullet points

const BULLET = '• ';

/** The comment's points: one per line, without their bullet (a free-text comment of an older version gives one point per line). */
export const bulletsOf = (comment: string | null | undefined): string[] =>
  (comment ?? '')
    .split('\n')
    .map(l => l.replace(/^\s*[•\-*]\s*/, '').trim())
    .filter(l => l !== '');

/** The comment kept and sent: "• point" lines. */
export const bulletText = (points: readonly string[]) => points.map(p => BULLET + p.trim()).join('\n');

/**
 * A comment entered as points ("• point" lines). `limit` is the screen's character limit of the whole comment (the old
 * box's maxLength); none when the screen had none. `initial` is the comment saved before.
 */
export function useBulletComment(limit?: number, initial = '') {
  const ui = useUi();
  const [comment, setComment] = useState(initial);
  const [point, setPoint] = useState('');
  const points = bulletsOf(comment);
  const withPoint = (t: string) => bulletText([...points, t]);
  const tooLong = (text: string) => {
    if (limit == null || text.length <= limit) return false;
    ui.toast(`Comments can be up to ${limit} characters`);
    return true;
  };
  const add = () => {
    const t = point.trim();
    if (!t) return;
    const next = withPoint(t);
    if (tooLong(next)) return;
    setComment(next);
    setPoint('');
  };
  const remove = (i: number) => setComment(bulletText(points.filter((_, j) => j !== i)));
  /** The comment to save: a point still being typed is added to it; null (after the message) when it is too long. */
  const final = (): string | null => {
    const t = point.trim();
    if (!t) return comment;
    const next = withPoint(t);
    if (tooLong(next)) return null;
    setComment(next);
    setPoint('');
    return next;
  };
  const used = point.trim() ? withPoint(point.trim()).length : comment.length;
  // The characters left for the next point (its line break and bullet included), as the old box's maxLength.
  const room = limit == null ? undefined : Math.max(0, limit - (bulletText(points).length + (points.length ? 1 : 0) + BULLET.length));
  return { comment, setComment, point, setPoint, points, add, remove, final, used, room };
}

/** The points of a comment (one bullet each, removable) and the box to add the next one. */
export function BulletComments({ b, placeholder, error, testID }: { b: ReturnType<typeof useBulletComment>; placeholder: string; error?: string | null; testID: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={[styles.bullets, error ? { borderColor: C.danger } : null]} testID={`${testID}-points`}>
        {b.points.map((t, i) => (
          <View key={`${i}-${t}`} style={styles.bulletRow} testID={`${testID}-point-${i}`}>
            <View style={styles.bulletDot} />
            <Text style={styles.bulletText}>{t}</Text>
            <Pressable onPress={() => b.remove(i)} hitSlop={8} testID={`${testID}-point-${i}-remove`} accessibilityLabel="Remove">
              <ZIcon name="close" size={14} color={C.tMuted} />
            </Pressable>
          </View>
        ))}
        <View style={[styles.bulletAdd, b.points.length === 0 && { marginTop: 0 }]}>
          <TextInput
            value={b.point}
            onChangeText={b.setPoint}
            maxLength={b.room}
            placeholder={b.points.length ? 'Add another point' : placeholder}
            placeholderTextColor={C.tMuted}
            style={styles.bulletInput}
            multiline
            autoCapitalize="sentences"
            onSubmitEditing={b.add}
            blurOnSubmit
            returnKeyType="done"
            testID={testID}
          />
          <ZButton title="Add" small variant="outline" onPress={b.add} testID={`${testID}-add`} />
        </View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

// ------------------------------------------------------------------ screens

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

  const shots = [
    { key: 'exterior' as const, label: 'Site Exterior', hint: 'With unit name board', photo: exterior },
    { key: 'interior' as const, label: 'Site Interior', hint: 'Working area', photo: interior },
  ];
  const done = shots.filter(s => s.photo.photo).length;

  return (
    <Page testID="site-images">
      <HeroHeader title="Site Photos" subtitle={app.zedId} onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={z.screenPad}>
        <View style={styles.banner}>
          <ZIcon name="camera" size={22} color={C.primaryDark} />
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={styles.bannerTitle}>Site Photos · 2 photos required</Text>
            <Text style={z.sub}>The site exterior (with the unit name board) and the interior (working area).</Text>
            <View style={[z.rowCenter, { marginTop: 4 }]}>
              <ZIcon name="map-pin" size={11} color={C.primaryDark} />
              <Text style={styles.bannerGeo}>All photos geo-tagged automatically</Text>
            </View>
          </View>
        </View>
        <View style={styles.tiles}>
          {shots.map(s =>
            s.photo.photo ? (
              <ShotTile
                key={s.key}
                uri={base64Uri(s.photo.photo)}
                caption={s.photo.timeStamp ? `${s.label} · ${s.photo.timeStamp}` : s.label}
                onPress={() => take(s.key)}
                style={styles.tile}
                testID={`site-${s.key}`}
              />
            ) : (
              <CaptureTile key={s.key} title="Capture" hint={`${s.label}\n${s.hint}`} onPress={() => take(s.key)} style={styles.tile} testID={`site-${s.key}`} />
            ),
          )}
        </View>
        <Strip
          tone={done === 2 ? 'success' : 'warning'}
          icon={done === 2 ? 'check' : 'camera'}
          title={`${done} of 2 photos captured`}
          text={done === 2 ? 'Section ready for submission.' : 'Both site photos are mandatory.'}
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
  // Comments as "• point" lines, 500 characters in all as before.
  const remarks = useBulletComment(COMMENT_MAX);

  useEffect(() => {
    openMeetingRequest(app).then(r => {
      request.current = r;
      // The saved photo of this meeting is shown (a new one is still needed to submit, as in the legacy screen).
      setShownPhoto(requestPhoto(r, title)?.photo ?? null);
      if (r.inputComment) remarks.setComment(r.inputComment);
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
  const prepare = (comment: string): boolean => {
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
    // The opening meeting's remarks, with a point still being typed (the closing meeting has none here).
    const comment = isClose ? remarks.comment : remarks.final();
    if (comment == null) return;
    if (!prepare(comment)) return;
    if (isClose) nav.push('FinalComments', { closeMeetingData: currentRequest() });
    else submitOpen();
  };

  const captured = !!photo.photo;
  const full = participants.length >= 15;
  const meetingName = isClose ? 'Closing meeting' : 'Opening meeting';

  return (
    <Page testID="meeting">
      <HeroHeader title={isClose ? 'Closing Meeting' : 'Opening Meeting'} subtitle={app.zedId} onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={z.screenPad} keyboardShouldPersistTaps="handled">
        {coords ? (
          <Card testID="lat-long">
            <Text style={styles.smallCaps}>AUTO-CAPTURED</Text>
            <View style={[z.rowCenter, { marginTop: 8 }]}>
              <ClockIcon size={16} color={C.primaryDark} />
              <Text style={[styles.timeValue, { marginTop: 0, marginLeft: 8 }]} testID="meeting-time">
                {photo.timeStamp ?? ''}
              </Text>
            </View>
            <View style={[z.rowCenter, { marginTop: 6 }]}>
              <ZIcon name="map-pin" size={16} color={C.primaryDark} />
              <Text style={[z.sub, { marginLeft: 8, flex: 1 }]}>{`Latitude : ${coords.latitude}   Longitude : ${coords.longitude}`}</Text>
            </View>
          </Card>
        ) : (
          <Strip icon="map-pin" text="Date, time and geo-location are captured automatically with the meeting photograph. Location must be on." />
        )}

        <SectionLabel label="Participants" right={<Text style={z.muted}>{isClose ? 'Auto-added from the opening meeting' : 'Auto-added from the scheduled team'}</Text>} />
        {participants.map((p, i) => (
          <ParticipantRow key={`${p.name}-${i}`} p={p} index={i} onDelete={() => deleteParticipant(i)} />
        ))}
        <Pressable
          style={({ pressed }) => [styles.addRow, full && styles.addRowOff, pressed && !full && { opacity: 0.85 }]}
          onPress={full ? undefined : addParticipant}
          disabled={full}
          accessibilityRole="button"
          accessibilityState={{ disabled: full }}
          testID="add-participant"
        >
          <ZIcon name="plus" size={18} color={full ? C.tMuted : C.primaryDark} />
          <Text style={[styles.addRowText, full && { color: C.tMuted }]}>Add participant</Text>
        </Pressable>

        <SectionLabel label="Meeting photograph" />
        {shownPhoto ? (
          <ShotTile
            uri={base64Uri(shownPhoto)}
            caption={captured && photo.timeStamp ? `${meetingName} · ${photo.timeStamp}` : `${meetingName} · tap to capture`}
            onPress={takePhoto}
            style={styles.meetingShot}
            testID="meeting-photo"
          />
        ) : (
          <CaptureTile onPress={takePhoto} style={styles.meetingShot} testID="meeting-photo" />
        )}

        {!isClose ? (
          <View>
            <SectionLabel label="Meeting remarks" right={<CharCounter used={remarks.used} limit={COMMENT_MAX} />} />
            <BulletComments b={remarks} placeholder="Add a point of the discussion" testID="meeting-comment" />
          </View>
        ) : null}
      </ZScroll>
      <Footer>
        <SubmitButton title={isClose ? 'Proceed' : 'Submit'} ready={captured && participants.length > 0} onPress={onSubmit} testID="meeting-submit" />
      </Footer>
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
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [designation, setDesignation] = useState('');
  const [error, setError] = useState<{ name?: string; designation?: string }>({});
  const add = () => {
    if (name.length <= 0) return setError({ name: 'Please enter the Participant Name' });
    if (designation.length <= 0) return setError({ designation: 'Please enter the Participant Designation' });
    onDone({ name, designation });
  };
  return (
    <View style={[styles.dialog, { paddingBottom: Math.max(insets.bottom, 18) }]} testID="participant-dialog">
      <View style={styles.handle} />
      <View style={[z.rowBetween, styles.dialogHead]}>
        <Text style={styles.dialogTitle}>Add Participant</Text>
        <Pressable style={styles.close} onPress={() => onDone(null)} hitSlop={8} accessibilityLabel="Close" testID="participant-close">
          <ZIcon name="close" size={16} color={C.tSecondary} />
        </Pressable>
      </View>
      <Field label="Full name" placeholder="Enter full name" icon="user" value={name} onChangeText={setName} autoCapitalize="words" error={error.name} testID="participant-name" />
      <Field
        label="Designation"
        placeholder="Enter designation"
        icon="clipboard"
        value={designation}
        onChangeText={setDesignation}
        autoCapitalize="words"
        error={error.designation}
        testID="participant-designation"
      />
      <View style={styles.dialogButtons}>
        <ZButton title="Cancel" variant="ghost" onPress={() => onDone(null)} style={{ flex: 1 }} testID="participant-cancel" />
        <ZButton title="Add Participant" onPress={add} style={{ flex: 1, marginLeft: 12 }} testID="participant-add" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  submit: { minHeight: 52, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  submitIdle: { backgroundColor: C.muted },
  submitText: { fontSize: 15, fontWeight: '700', color: C.tInverse, letterSpacing: 0.3 },
  footer: { backgroundColor: C.surface, borderTopColor: C.border, borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 12 },
  dashed: { borderRadius: 12, borderWidth: 1.5, borderColor: C.border, borderStyle: 'dashed', backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', padding: 8 },
  captureTile: { borderRadius: 14, borderWidth: 1.5, borderColor: C.primary, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', padding: 12 },
  captureTitle: { fontSize: 13, fontWeight: '700', color: C.primaryDark, marginTop: 8, textAlign: 'center' },
  shot: { borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: C.primaryBg },
  shotPin: { position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: 13, backgroundColor: C.primaryDark, alignItems: 'center', justifyContent: 'center' },
  shotBar: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 30, backgroundColor: C.primaryDark, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 6 },
  shotBarText: { fontSize: 11, fontWeight: '700', color: C.tInverse },
  smallCaps: { fontSize: 10, fontWeight: '700', color: C.tSecondary, letterSpacing: 0.5 },
  timeValue: { fontSize: 14, fontWeight: '700', color: C.tPrimary, marginTop: 2 },
  timePlace: { backgroundColor: C.primaryBg, borderRadius: 12, padding: 14, marginBottom: 12 },
  selfieCard: { flexDirection: 'row', alignItems: 'center', borderColor: C.primary, borderWidth: 1.5, borderRadius: 12, padding: 14 },
  selfieCardEmpty: { borderColor: C.border, backgroundColor: C.bg },
  selfieSize: { width: 84, height: 84, borderRadius: 10 },
  selfiePhoto: { backgroundColor: C.tPrimary },
  selfieState: { fontSize: 14, fontWeight: '700', color: C.tPrimary, marginTop: 8 },
  pill: { marginTop: 10, height: 30, width: 110, borderRadius: 8, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontSize: 12, fontWeight: '700', color: C.primaryDark },
  pillFilled: { marginTop: 10, height: 32, paddingHorizontal: 12, alignSelf: 'flex-start', borderRadius: 8, backgroundColor: C.primary, flexDirection: 'row', alignItems: 'center' },
  pillFilledText: { fontSize: 12, fontWeight: '700', color: C.tInverse, marginLeft: 6 },
  initial: { backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center' },
  initialText: { fontWeight: '700', color: C.primaryDark },
  participant: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderColor: C.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 8 },
  participantName: { fontSize: 14, fontWeight: '700', color: C.tPrimary },
  deleteTouch: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  bullets: { backgroundColor: C.surface, borderColor: C.border, borderWidth: 1, borderRadius: 12, padding: 12 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 5, gap: 8 },
  bulletDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.primary, marginTop: 7 },
  bulletText: { flex: 1, fontSize: 14, color: C.tPrimary },
  bulletAdd: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  bulletInput: { flex: 1, minHeight: 40, borderColor: C.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: C.tPrimary },
  error: { color: C.danger, fontSize: 12, marginTop: 4 },
  banner: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: C.primaryBg, borderRadius: 12, padding: 16, marginBottom: 16 },
  bannerTitle: { fontSize: 13, fontWeight: '700', color: C.tPrimary, marginBottom: 2 },
  bannerGeo: { fontSize: 10, fontWeight: '600', color: C.primaryDark, marginLeft: 4 },
  tiles: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  tile: { flex: 1, aspectRatio: 1 / 1.2 },
  addRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: 12, backgroundColor: C.primaryBg, borderColor: C.border, borderWidth: 1, marginBottom: 8 },
  addRowOff: { backgroundColor: C.muted },
  addRowText: { fontSize: 14, fontWeight: '700', color: C.primaryDark, marginLeft: 8 },
  meetingShot: { height: 132, marginBottom: 8 },
  dialog: { marginTop: 'auto', backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, marginBottom: 12 },
  dialogHead: { paddingBottom: 12, marginBottom: 14, borderBottomColor: C.divider, borderBottomWidth: 1 },
  dialogTitle: { fontSize: 19, fontWeight: '700', color: C.tPrimary },
  close: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.muted, alignItems: 'center', justifyContent: 'center' },
  dialogButtons: { flexDirection: 'row', marginTop: 4, paddingTop: 14, borderTopColor: C.divider, borderTopWidth: 1 },
});
