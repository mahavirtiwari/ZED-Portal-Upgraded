import React, { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { isNetworkAvailable, isSuccess, PhotosField, TextField, useNavigation, useRoute, useUi, type PhotoData } from '@zed/shared';
import { useSa } from '../app/context';
import { queueTraining, submitTraining, trainingSubmitted } from '../flows/submissions';
import { useSaPhotoCapture } from '../photo/capture';
import { DATA_ERROR, DATA_SUBMITTED, isTrainingValid, NETWORK_SAVED_LOCALLY, Status, type ConsultantPhoto, type ZedTrainingInfo } from '../models';
import { DateInput, REQUIRED, TimeInput, usePresentPhotos } from '../ui/inputs';
import { NavigationFooter, SaFrame } from '../ui/kit';

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
  const [remarks, setRemarks] = useState(info.remarks ?? '');
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const capturer = useSaPhotoCapture();
  const presentPhotos = usePresentPhotos(info.trainingPhoto, app.photos, kept => (info.trainingPhoto = kept));
  const presentSheets = usePresentPhotos(info.attendanceSheet, app.photos, kept => (info.attendanceSheet = kept));
  const [photos, setPhotos] = useState<PhotoData[] | null>(null);
  const [sheets, setSheets] = useState<PhotoData[] | null>(null);
  useEffect(() => {
    if (presentPhotos) setPhotos(presentPhotos);
  }, [presentPhotos]);
  useEffect(() => {
    if (presentSheets) setSheets(presentSheets);
  }, [presentSheets]);
  const title = handholding ? 'Training on Handholding Implementation Plan' : 'Training on ZED';

  const proceed = async () => {
    // collectEnteredData (the helpers mark the required fields left empty)
    info.trainingTopic = topic.trim() ? topic : null;
    info.trainingDate = date || null;
    info.trainingTime = time || null;
    info.remarks = remarks.trim() ? remarks : null;
    setErrors(new Set(Object.entries({ topic, date, time, remarks }).filter(([, v]) => v.trim() === '').map(([k]) => k)));
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

  const err = (k: string) => (errors.has(k) ? REQUIRED : null);
  return (
    <SaFrame title={title} testID="training">
      <ScrollView contentContainerStyle={{ padding: 8 }} keyboardShouldPersistTaps="handled">
        <TextField label="Training Topic" value={topic} onChange={setTopic} error={err('topic')} testID="training-topic" />
        <DateInput label="Training Date" value={date} onChange={setDate} error={err('date')} allowOnlyFuture testID="training-date" />
        <TimeInput label="Training Time" value={time} onChange={setTime} error={err('time')} testID="training-time" />
        <TextField label="Remarks" value={remarks} onChange={setRemarks} multiline error={err('remarks')} testID="training-remarks" />
        {photos ? (
          <PhotosField
            label="Training Photo"
            photos={photos}
            onChange={l => (setPhotos(l), (info.trainingPhoto = l as ConsultantPhoto[]))}
            capturer={capturer}
            store={app.photos}
            maxPhotos={5}
            testID="training-photo"
          />
        ) : null}
        {sheets ? (
          <PhotosField
            label="Attendance Sheet"
            photos={sheets}
            onChange={l => (setSheets(l), (info.attendanceSheet = l as ConsultantPhoto[]))}
            capturer={capturer}
            store={app.photos}
            maxPhotos={5}
            testID="training-sheet"
          />
        ) : null}
      </ScrollView>
      <NavigationFooter onBack={() => nav.pop()} onProceed={proceed} testID="training-footer" />
    </SaFrame>
  );
}
