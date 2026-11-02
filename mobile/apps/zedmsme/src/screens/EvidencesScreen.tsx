import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  CheckBox,
  colors,
  dimens,
  Icon,
  isNetworkAvailable,
  isNetworkError,
  isSuccess,
  PhotosField,
  RadioButton,
  ScreenFrame,
  shapes,
  textStyles,
  UNKNOWN_ERROR,
  useFocusEffect,
  useNavigation,
  useRoute,
  useUi,
  ZedButton,
  ZedDialog,
  type BaseServiceResponse,
  htmlToPlain,
  useAppText,
} from '@zed/shared';
import { icons } from '../assets/icons';
import { useMsme } from '../app/context';
import { useOnline } from '../app/online';
import { useScreenCapture } from '../components/capture';
import {
  certificationDetailsOf,
  evidencesOf,
  Status,
  type CertificationType,
  type Evidence,
} from '../models';
import { queueEvidence } from '../sync/queue';
import { submitBasicInformation, submitEvidence } from '../sync/submissions';

const MAX_EVIDENCES = 5;

/** EvidencesActivity ("Documents Upload"). */
export function EvidencesScreen() {
  const app = useMsme();
  const nav = useNavigation();
  const ui = useUi();
  const online = useOnline();
  const type = useRoute<{ certificationType: CertificationType }>().params.certificationType;
  const details = certificationDetailsOf(app.user?.MsmeDetails?.msmeStatus, type);
  const evidences = useMemo(() => evidencesOf(details), [details]);
  const [selected, setSelected] = useState<Evidence | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [, rerender] = useState(0);
  const refresh = () => rerender(x => x + 1);
  const confirmText = useAppText('app.msme.evidences.finalSubmit.confirm');

  // updateFinalSubmitState (also onResume)
  const finalSubmitVisible = evidences.every(e => e.available === false || e.status === Status.SUBMITTED);
  useFocusEffect(useCallback(() => refresh(), []));

  /** onSyncClick */
  const onSyncClick = async (evidence: Evidence) => {
    if (!app.loginId) return;
    const info = details?.basicInformation;
    if (info && info.status !== Status.SUBMITTED) {
      ui.showLoading();
      let r: BaseServiceResponse;
      try {
        r = await submitBasicInformation(app, type, info);
      } catch (e) {
        if (isNetworkError(e)) await queueEvidence(app, type, evidence.id, evidence.label ?? evidence.id);
        r = { status: '0', errorMessage: e instanceof Error ? e.message : null };
      } finally {
        ui.hideLoading();
      }
      if (isSuccess(r)) {
        info.status = Status.SUBMITTED;
        await save(evidence);
        await app.persist();
      } else if (r.errorMessage) {
        ui.toast(r.errorMessage, { long: true });
      }
      return;
    }
    ui.showLoading('Please wait, this may take a while...');
    let response: BaseServiceResponse | null;
    try {
      response = await submitEvidence(app, type, evidence);
    } catch (e) {
      // New: no answer from the server -> queued and sent when the connection returns.
      if (isNetworkError(e)) await queueEvidence(app, type, evidence.id, evidence.label ?? evidence.id);
      response = { status: '0', errorMessage: UNKNOWN_ERROR };
    } finally {
      ui.hideLoading();
    }
    await app.persist();
    if (isSuccess(response)) {
      evidence.status = Status.SUBMITTED;
      await app.queue.remove(`${app.loginId}:evidence:${type}:${evidence.id}`);
      ui.toast('Evidence submitted successfully', { long: true });
      await app.persist();
      refresh();
    } else {
      ui.showAlert(response?.errorMessage?.trim() ? response.errorMessage : UNKNOWN_ERROR);
    }
  };

  /** EvidenceFragmentCallback.save */
  const save = async (evidence: Evidence | null) => {
    refresh();
    await app.persist();
    if (evidence?.status === Status.COMPLETED) {
      if (await isNetworkAvailable()) await onSyncClick(evidence);
      else await queueEvidence(app, type, evidence.id, evidence.label ?? evidence.id); // new: sent when back online
    }
  };

  /**
   * ZED MSME: the applicant's final submit is the confirmation alone. The Bronze surveillance build asked the desktop
   * assessor three more questions (financial support availed, Silver upgrade, handholding; SubmitFinancialAssistanceDetails),
   * which the main system does not serve.
   */
  const finalSubmit = async () => {
    if (!app.loginId) return;
    ui.showLoading();
    let r: BaseServiceResponse;
    try {
      r = await app.api.finalSubmit(app.loginId, type);
    } catch (e) {
      r = { status: '0', errorMessage: e instanceof Error ? e.message : null };
    } finally {
      ui.hideLoading();
    }
    if (isSuccess(r)) {
      if (details) details.finalSubmitDone = true;
      await app.persist();
      ui.toast('Submitted successfully', { long: true });
      nav.reset([{ name: 'Dashboard' }]);
    } else {
      ui.showAlert(r.errorMessage ?? UNKNOWN_ERROR);
    }
  };

  return (
    <ScreenFrame title="Documents Upload" offline={!online} backBar={{ zedId: app.user?.MsmeDetails?.ZedId, onBack: () => nav.pop() }} testID="evidences">
      <View style={{ flex: 1, padding: dimens.padding1 }}>
        <FlatList
          style={{ flex: 1 }}
          data={evidences}
          keyExtractor={(e, i) => `${e.id}-${i}`}
          renderItem={({ item, index }) => (
            <EvidenceRow
              evidence={item}
              online={online}
              testID={`evidence-${index}`}
              onPress={() => {
                if (item.photos && item.photos.length > 0) item.status = Status.COMPLETED;
                setSelected(item);
                refresh();
              }}
              onLongPress={() => ui.alert('Info', item.iButton ?? '', [{ text: 'OK' }], false)}
              onUpload={() => onSyncClick(item)}
            />
          )}
        />
        {finalSubmitVisible ? (
          <ScrollView style={{ flexGrow: 0, maxHeight: '60%' }} keyboardShouldPersistTaps="handled">
            <CheckBox
              label={confirmText ? htmlToPlain(confirmText.html) : ''}
              checked={confirmed}
              onChange={setConfirmed}
              testID="confirm"
            />
            <ZedButton title="Final Submit" disabled={!confirmed} onPress={finalSubmit} testID="final-submit" />
          </ScrollView>
        ) : null}
      </View>
      {selected ? (
        <EvidenceDialog
          evidence={selected}
          onClose={() => {
            setSelected(null);
            refresh();
          }}
          onDone={ev => {
            setSelected(null);
            save(ev);
          }}
        />
      ) : null}
    </ScreenFrame>
  );
}

/** evidences_list_row via EvidenceListAdapter */
function EvidenceRow({
  evidence,
  online,
  onPress,
  onLongPress,
  onUpload,
  testID,
}: {
  evidence: Evidence;
  online: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onUpload: () => void;
  testID?: string;
}) {
  const offlineNote = useAppText('app.msme.offline.evidenceNote');
  const startIcon = evidence.status === Status.COMPLETED ? icons.ic_complete : evidence.status === Status.SUBMITTED ? icons.ic_done : icons.ic_grey_tick;
  return (
    <Pressable style={styles.row} onPress={onPress} onLongPress={onLongPress} testID={testID}>
      <View style={styles.rowLabel}>
        <Icon icon={startIcon} />
        <Text style={[textStyles.defaultLabel, styles.rowText]} testID={testID ? `${testID}-label` : undefined}>
          {evidence.label}
        </Text>
        <Icon icon={icons.ic_evidence_open} />
      </View>
      {evidence.status === Status.COMPLETED ? (
        <View style={styles.note}>
          <Text style={styles.noteText}>
            {online ? 'Sync your offline changes now' : offlineNote ? htmlToPlain(offlineNote.html) : ''}
          </Text>
          {online ? (
            <Pressable style={styles.upload} onPress={onUpload} testID={testID ? `${testID}-upload` : undefined}>
              <Icon icon={icons.ic_upload} size={18} tint={colors.white} />
              <Text style={styles.uploadText}>UPLOAD</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

/** EvidenceFragment (not cancelable). */
function EvidenceDialog({ evidence, onClose, onDone }: { evidence: Evidence; onClose: () => void; onDone: (e: Evidence) => void }) {
  const app = useMsme();
  const ui = useUi();
  const capturer = useScreenCapture('snackbar');
  const [photos, setPhotos] = useState(evidence.photos ?? []);
  const showAvailability = evidence.validationRequired === true && (evidence.photos ?? []).length === 0;
  const [available, setAvailable] = useState<boolean | null>(() => {
    if (!showAvailability) {
      evidence.available = null;
      return null;
    }
    return evidence.available ?? null;
  });

  return (
    <ZedDialog visible title={evidence.label ?? ''} onClose={onClose} cancelable={false} testID="evidence-dialog">
      {available !== false ? (
        <PhotosField
          label="Attach photos (max. 5 photos)"
          photos={photos}
          maxPhotos={MAX_EVIDENCES}
          allowPick={evidence.validationRequired ?? false}
          onChange={list => {
            setPhotos(list);
            evidence.photos = list;
            app.persist();
          }}
          capturer={capturer}
          store={app.photos}
          testID="evidence-photos"
        />
      ) : null}
      {showAvailability ? (
        <View style={[shapes.greyOutlineRectangle, styles.available]}>
          <Text style={[textStyles.defaultLabel, { fontWeight: 'normal', flex: 1 }]}>Certificate Available</Text>
          <RadioButton label="Yes" selected={available === true} onPress={() => (setAvailable(true), (evidence.available = true))} style={{ margin: dimens.padding1 }} testID="available-yes" />
          <RadioButton
            label="No"
            selected={available === false}
            testID="available-no"
            onPress={() => {
              if ((evidence.photos ?? []).length > 0) {
                ui.toast('There are photos already attached', { center: true });
                setAvailable(true);
                evidence.available = true;
                return;
              }
              setAvailable(false);
              evidence.available = false;
            }}
            style={{ margin: dimens.padding1 }}
          />
        </View>
      ) : null}
      <ZedButton
        title="Done"
        small
        testID="evidence-done"
        onPress={() => {
          if ((evidence.photos ?? []).length > 0) evidence.status = Status.COMPLETED;
          else if (evidence.available === false) evidence.status = Status.SUBMITTED;
          else evidence.status = Status.IN_PROGRESS;
          onDone(evidence);
        }}
      />
    </ZedDialog>
  );
}

const styles = StyleSheet.create({
  row: { ...shapes.lightGreyOutlineFilled, margin: dimens.padding1, padding: 2 },
  rowLabel: { flexDirection: 'row', alignItems: 'center', padding: dimens.padding2 },
  rowText: { flex: 1, marginHorizontal: dimens.padding1, marginBottom: 0 },
  note: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.yellow },
  noteText: { flex: 1, fontSize: dimens.textSize14, padding: dimens.padding2, color: colors.black },
  upload: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.orange,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    margin: dimens.padding2,
  },
  uploadText: { color: colors.white, fontWeight: 'bold', fontSize: 14, marginLeft: 6 },
  available: { flexDirection: 'row', alignItems: 'center', margin: dimens.padding1, paddingHorizontal: dimens.padding2 },
});
