import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  fileUri,
  isNetworkAvailable,
  isSubmitted,
  isSuccess,
  removePhoto,
  useNavigation,
  useRoute,
  useUi,
  viewPhoto,
  zedDevice,
  type Capturer,
  type PhotoData,
  type PhotoStore,
} from '@zed/shared';
import { useSa } from '../app/context';
import { queueTraining, submitTraining, trainingSubmitted } from '../flows/submissions';
import { useSaPhotoCapture } from '../photo/capture';
import { DATA_ERROR, DATA_SUBMITTED, isTrainingValid, NETWORK_SAVED_LOCALLY, Status, type ConsultantPhoto, type ZedTrainingInfo } from '../models';
import { REQUIRED, usePresentPhotos } from '../ui/inputs';
import { C, Field, HeroHeader, Page, SectionLabel, z, ZButton, ZIcon, ZScroll, type IconName } from '../ui/zed';
import { BulletComments, CaptureTile, ClockIcon, Footer, ShotTile, SubmitButton, useBulletComment } from './MeetingScreens';

/** Training photos and attendance sheets: 5 of each as before. */
const MAX_PHOTOS = 5;

/** TrainingOnZedActivity: "Training on ZED", or (handholding) "Training on Handholding Implementation Plan". */
export function TrainingScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const { params } = useRoute<{ handholding?: boolean }>();
  const handholding = params.handholding === true;
  const d = app.details!;
  // A new ZedTrainingInfo until Proceed stores it.
  const [info] = useState<ZedTrainingInfo>(() => (handholding ? d.handholdingTraining : d.zedTrainingInfo) ?? { status: Status.TO_START });
  const [topic, setTopic] = useState(info.trainingTopic ?? '');
  const [date, setDate] = useState(info.trainingDate ?? '');
  const [time, setTime] = useState(info.trainingTime ?? '');
  // The remarks as "• point" lines (no limit, as before).
  const remarks = useBulletComment(undefined, info.remarks ?? '');
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const capturer = useSaPhotoCapture();
  const presentPhotos = usePresentPhotos(info.trainingPhoto, app.photos, kept => (info.trainingPhoto = kept));
  const presentSheets = usePresentPhotos(info.attendanceSheet, app.photos, kept => (info.attendanceSheet = kept));
  const [photos, setPhotos] = useState<PhotoData[] | null>(null);
  const [sheets, setSheets] = useState<PhotoData[] | null>(null);
  const [lastTime, setLastTime] = useState<{ hour: number; minute: number } | null>(null);
  useEffect(() => {
    if (presentPhotos) setPhotos(presentPhotos);
  }, [presentPhotos]);
  useEffect(() => {
    if (presentSheets) setSheets(presentSheets);
  }, [presentSheets]);
  // The design's shorter title for the handholding training (the section keeps its full name elsewhere).
  const title = handholding ? 'Training on Implementation Plan' : 'Training on ZED';

  const proceed = async () => {
    const remarksText = remarks.final();
    if (remarksText == null) return;
    // collectEnteredData (the helpers mark the required fields left empty)
    info.trainingTopic = topic.trim() ? topic : null;
    info.trainingDate = date || null;
    info.trainingTime = time || null;
    info.remarks = remarksText.trim() ? remarksText : null;
    setErrors(new Set(Object.entries({ topic, date, time, remarks: remarksText }).filter(([, v]) => v.trim() === '').map(([k]) => k)));
    if (!isTrainingValid(info)) return ui.snackbar(DATA_ERROR);

    if (handholding) d.handholdingTraining = info;
    else d.zedTrainingInfo = info;
    await app.update();

    if (!(await isNetworkAvailable())) {
      // New: sent by the sync queue when the connection returns (the legacy waited for the next Proceed online).
      await queueTraining(app, handholding);
      ui.alert('Alert', NETWORK_SAVED_LOCALLY, [{ text: 'OK', onPress: () => nav.pop() }], false);
      return;
    }
    ui.showLoading();
    const { response, error } = await submitTraining(app, info, handholding);
    ui.hideLoading();
    if (error) return ui.showAlert(error);
    if (response && isSuccess(response)) {
      await trainingSubmitted(app, info);
      ui.toast(DATA_SUBMITTED);
      nav.pop();
    } else if (response?.errorMessage) {
      ui.toast(response.errorMessage);
    }
  };

  /** DateInputHelper: the picker limited to today on (yyyy-MM-dd). */
  const pickDate = async () => {
    const picked = await zedDevice().pickDateInRange(date || null, Date.now() - 1000, -1);
    if (picked) setDate(picked);
  };
  /** TimeInputHelper: TimePickerDialog, the time in the device's format. */
  const pickTime = async () => {
    const picked = await zedDevice().pickTime(lastTime?.hour ?? -1, lastTime?.minute ?? -1);
    if (picked) {
      setLastTime({ hour: picked.hour, minute: picked.minute });
      setTime(picked.text);
    }
  };

  const err = (k: string) => (errors.has(k) ? REQUIRED : null);
  const ready =
    topic.trim() !== '' && date !== '' && time !== '' && (remarks.comment.trim() !== '' || remarks.point.trim() !== '') && !!photos?.length && !!sheets?.length;
  return (
    <Page testID="training">
      <HeroHeader title={title} subtitle={app.zedId} onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={z.screenPad} keyboardShouldPersistTaps="handled">
        <Field
          label="Training topic"
          icon="document"
          placeholder="Enter the training topic"
          value={topic}
          onChangeText={setTopic}
          multiline
          error={err('topic')}
          style={styles.topic}
          testID="training-topic"
        />
        <PickerField label="Training date" icon="calendar" value={date} placeholder="Select training date" onPress={pickDate} error={err('date')} testID="training-date" />
        <PickerField label="Training time" clock value={time} placeholder="Select training time" onPress={pickTime} error={err('time')} testID="training-time" />

        <SectionLabel label="Attendance record" right={sheets ? <Text style={z.muted}>{`${sheets.length}/${MAX_PHOTOS}`}</Text> : null} />
        {sheets ? (
          <PhotoTiles
            caption="Attendance sheet"
            photos={sheets}
            onChange={l => (setSheets(l), (info.attendanceSheet = l as ConsultantPhoto[]))}
            capturer={capturer}
            store={app.photos}
            testID="training-sheet"
          />
        ) : null}

        <SectionLabel label="Training photograph" right={photos ? <Text style={z.muted}>{`${photos.length}/${MAX_PHOTOS}`}</Text> : null} />
        {photos ? (
          <PhotoTiles
            caption="Training session"
            photos={photos}
            onChange={l => (setPhotos(l), (info.trainingPhoto = l as ConsultantPhoto[]))}
            capturer={capturer}
            store={app.photos}
            testID="training-photo"
          />
        ) : null}

        <SectionLabel label="Remarks" />
        <BulletComments b={remarks} placeholder="Add a remark about the session" error={err('remarks')} testID="training-remarks" />
      </ZScroll>
      <Footer testID="training-footer">
        <View style={z.rowCenter}>
          <ZButton title="Back" variant="ghost" onPress={() => nav.pop()} style={styles.back} testID="training-footer-back" />
          <SubmitButton title="Submit" ready={ready} onPress={proceed} style={{ flex: 1, marginLeft: 12 }} testID="training-footer-proceed" />
        </View>
      </Footer>
    </Page>
  );
}

/** A read-only field that opens a picker (date / time): icon, value or placeholder, chevron. */
function PickerField({
  label,
  icon,
  clock,
  value,
  placeholder,
  onPress,
  error,
  testID,
}: {
  label: string;
  icon?: IconName;
  clock?: boolean;
  value: string;
  placeholder: string;
  onPress: () => void;
  error?: string | null;
  testID: string;
}) {
  return (
    <View style={{ marginBottom: 14 }} testID={`${testID}-box`}>
      <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
      <Pressable style={[styles.picker, error ? { borderColor: C.danger } : null]} onPress={onPress} accessibilityRole="button" testID={testID}>
        {clock ? <ClockIcon size={18} color={C.tMuted} /> : <ZIcon name={icon ?? 'calendar'} size={18} color={C.tMuted} />}
        <Text style={[styles.pickerText, !value && { color: C.tMuted }]}>{value || placeholder}</Text>
        <ZIcon name="chevron-down" size={18} color={C.tSecondary} />
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

/**
 * PhotosHelper (as PhotosField: camera only, up to 5, delete until submitted, tap to view) drawn as the design's photo
 * tiles: each photo with its caption bar, and the capture tile while there is room.
 */
function PhotoTiles({
  caption,
  photos,
  onChange,
  capturer,
  store,
  testID,
}: {
  caption: string;
  photos: PhotoData[];
  onChange: (photos: PhotoData[]) => void;
  capturer: Capturer;
  store: PhotoStore;
  testID: string;
}) {
  const add = async () => {
    const photo = await capturer.capture('camera');
    if (!photo) return;
    onChange([...photos, photo]);
  };
  const canAdd = photos.length < MAX_PHOTOS && !photos.some(p => p.isPdf);
  return (
    <View testID={testID}>
      {photos.map(photo => (
        <ShotTile
          key={photo.photoId}
          uri={photo.isPdf ? null : fileUri(photo.photoPath ?? '')}
          caption={photo.timeStamp ? `${caption} · ${photo.timeStamp}` : caption}
          onPress={() => viewPhoto(photo)}
          style={styles.shot}
          corner={
            isSubmitted(photo) ? (
              <View style={[styles.corner, { backgroundColor: C.success }]}>
                <ZIcon name="check" size={14} color={C.tInverse} />
              </View>
            ) : (
              <Pressable
                style={[styles.corner, { backgroundColor: C.danger }]}
                onPress={async () => {
                  onChange(photos.filter(p => p.photoId !== photo.photoId));
                  await removePhoto(store, photo);
                }}
                hitSlop={8}
                accessibilityLabel="Delete photo"
                testID={`${testID}-delete`}
              >
                <ZIcon name="close" size={14} color={C.tInverse} />
              </Pressable>
            )
          }
          testID={`${testID}-photo`}
        />
      ))}
      {canAdd ? (
        <CaptureTile
          title={photos.length ? 'Capture another photograph' : 'Capture photograph'}
          onPress={add}
          style={photos.length ? styles.addMore : styles.shot}
          testID={`${testID}-add`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  topic: { marginBottom: 14 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: C.tSecondary, marginBottom: 6 },
  picker: { flexDirection: 'row', alignItems: 'center', borderColor: C.border, borderWidth: 1, borderRadius: 10, backgroundColor: C.surface, paddingHorizontal: 12, minHeight: 48 },
  pickerText: { flex: 1, fontSize: 15, color: C.tPrimary, marginLeft: 10 },
  error: { color: C.danger, fontSize: 12, marginTop: 4 },
  shot: { height: 132, marginBottom: 10 },
  addMore: { height: 84, marginBottom: 10 },
  corner: { position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  back: { width: 104, minHeight: 52, borderRadius: 12 },
});
