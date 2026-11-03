import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { isNetworkAvailable, isSuccess, useNavigation, useUi } from '@zed/shared';
import { useSa } from '../app/context';
import { PREFS } from '../db/stores';
import {
  basicInfoSubmitted,
  checkQuestionsData,
  needsBasicInfoFirst,
  selfieSyncAllowed,
  siteTourSubmitted,
  submitBasicInformation,
  submitEndAssessment,
  submitParameter,
  submitSiteTour,
  syncOpenMeeting,
  syncSelfie,
} from '../flows/submissions';
import { areAllParametersSubmitted, COMPLETED, EVIDENCE_SITE_TOUR, FAILED_TO_SUBMIT, SUBMITTED, UNKNOWN_ERROR, type AllottedParameters, type ServiceResponse } from '../models';
import { C, HeroHeader, Page, SectionLabel, Strip, z, ZButton, ZIcon, ZScroll } from '../ui/zed';
import { useSubmissionSuccess } from './FinalCommentsScreen';
import { TickBox } from './ParametersScreens';

type PendingRow = { kind: 'openMeeting' | 'selfie' | 'siteTour' | 'closeMeeting'; title: string };

const failure = (r: { errorMessage?: string | null } | null) => (r?.errorMessage?.trim() ? r.errorMessage : FAILED_TO_SUBMIT);

/** SubmitParametersActivity ("Sync Assessment"): what is saved on the phone, then the completed parameters. */
export function SubmitParametersScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const onSuccess = useSubmissionSuccess();
  const d = app.details!;
  const [pending, setPending] = useState<PendingRow[] | null>(null);
  const [completed, setCompleted] = useState<AllottedParameters[]>(() => (d.allottedParameters ?? []).filter(p => p && p.status === COMPLETED));
  const [, rerender] = useState(0);

  /** showPendingDataSubmissionOptions + showCloseMeetingOption */
  const load = useCallback(async () => {
    const rows: PendingRow[] = [];
    if (await app.store.meeting(app.userId, true)) rows.push({ kind: 'openMeeting', title: 'Opening Meeting' });
    if (await app.store.selfie(app.userId)) rows.push({ kind: 'selfie', title: 'Selfie on Site' });
    const tour = await app.store.evidencesOfType(app.userId, EVIDENCE_SITE_TOUR);
    if (tour.length > 0 && !d.isSiteTourSubmitted) rows.push({ kind: 'siteTour', title: 'Site Tour' });
    setPending(rows);
  }, [app, d]);

  useEffect(() => {
    load();
  }, [load]);

  const [closeRow, setCloseRow] = useState<PendingRow | null>(null);
  useEffect(() => {
    // Once nothing else is pending and no completed parameter is left, the saved closing meeting is offered.
    if (pending == null || pending.length > 0 || completed.length > 0) return setCloseRow(null);
    if (areAllParametersSubmitted(d)) app.prefs.setBoolean(PREFS.siteTourStatus, 'Params', true);
    app.store.meeting(app.userId, false).then(m => setCloseRow(m ? { kind: 'closeMeeting', title: m.userType === 1 ? 'Closing Meeting' : 'Final Comments' } : null));
  }, [pending, completed, app, d]);

  const removeRow = (kind: PendingRow['kind']) => setPending(rows => (rows ?? []).filter(r => r.kind !== kind));

  const syncRow = async (row: PendingRow) => {
    if (!(await isNetworkAvailable())) return ui.toast('Network is not available');
    if (row.kind === 'openMeeting') {
      ui.showLoading('Please Wait...');
      const r = await syncOpenMeeting(app).catch(() => null);
      ui.hideLoading();
      if (isSuccess(r)) {
        removeRow('openMeeting');
        ui.toast('Submitted successfully');
      } else ui.toast(failure(r), { long: true });
    } else if (row.kind === 'selfie') {
      if (!(await selfieSyncAllowed(app))) return ui.toast('Please sync Opening Meeting data to sync Selfie', { long: true });
      ui.showLoading('Please Wait...');
      const r = await syncSelfie(app).catch(() => null);
      ui.hideLoading();
      if (isSuccess(r)) {
        removeRow('selfie');
        ui.toast('Submitted successfully');
      } else ui.toast(failure(r), { long: true });
    } else if (row.kind === 'siteTour') {
      const allowed = d.userType === 2 || ((await app.store.meeting(app.userId, true)) == null && d.isOpenMeetingSubmitted);
      if (!allowed) return ui.toast('Please sync Opening Meeting data to sync Site Tour photos', { long: true });
      const photos = await app.store.evidencesOfType(app.userId, EVIDENCE_SITE_TOUR);
      const send = async () => {
        ui.showLoading('Please Wait...');
        const r = await submitSiteTour(app, photos).catch(() => null);
        ui.hideLoading();
        if (isSuccess(r)) {
          await siteTourSubmitted(app);
          removeRow('siteTour');
          ui.toast('Submitted successfully');
        } else ui.toast(failure(r), { long: true });
      };
      if (photos.length > 5) {
        ui.alert(
          null,
          'This might take a while, please make sure you have a strong network connection (Wi-Fi recommended)',
          [
            { text: 'Sync', style: 'cancel', onPress: send },
            { text: 'Dismiss' },
          ],
          false,
        );
      } else send();
    } else {
      // Closing meeting / final comments: the lead's basic information first.
      const request = await app.store.meeting(app.userId, false);
      if (!request) return;
      if (needsBasicInfoFirst(app) && d.saBasicInformation) {
        ui.showLoading();
        const b = await submitBasicInformation(app, d.saBasicInformation);
        ui.hideLoading();
        if (!isSuccess(b)) return ui.toast(b.errorMessage ?? UNKNOWN_ERROR);
        await basicInfoSubmitted(app);
      }
      ui.showLoading('This might take a while, Please Wait...');
      let r: ServiceResponse | null = null;
      try {
        r = await submitEndAssessment(app, request);
      } catch {
        r = null;
      }
      ui.hideLoading();
      if (isSuccess(r)) {
        await app.store.clearMeeting(app.userId, false);
        setCloseRow(null);
        await onSuccess();
      } else ui.toast(failure(r), { long: true });
    }
  };

  /** submitParameter: one parameter; Sync All / Sync Selected go on with the next. */
  const submitOne = async (p: AllottedParameters, mode: 'one' | 'all' | 'selected'): Promise<void> => {
    if (!checkQuestionsData(p)) {
      ui.showAlert(`There is seems to be missing data in the ${p.parameterName} parameter. Please recheck and submit.`);
      return;
    }
    if (!(await isNetworkAvailable())) return ui.toast('Network not available', { long: true });
    ui.showLoading('Please Wait...');
    let r: ServiceResponse | null = null;
    try {
      r = await submitParameter(app, p, () => ui.toast('Failed to delete local evidence'));
    } catch {
      r = null;
    }
    if (!isSuccess(r)) {
      ui.hideLoading();
      ui.toast(failure(r), { long: true });
      return;
    }
    const target = (d.allottedParameters ?? []).find(x => x?.parameterId?.toLowerCase() === p.parameterId?.toLowerCase());
    if (target) {
      target.status = SUBMITTED;
      target.isSelectedToSubmit = false;
    }
    await app.update();
    const rest = completed.filter(x => x !== p);
    setCompleted(rest);
    completed.splice(0, completed.length, ...rest);
    const nextSelected = rest.find(x => x.isSelectedToSubmit);
    const done = mode === 'one' || (mode === 'all' && rest.length === 0) || (mode === 'selected' && !nextSelected);
    if (done) {
      ui.hideLoading();
      ui.showAlert('Parameter submitted successfully');
    }
    if (mode === 'all' && rest.length > 0) return submitOne(rest[0]!, 'all');
    if (mode === 'selected' && nextSelected) return submitOne(nextSelected, 'selected');
  };

  const header = <HeroHeader title="Sync Assessment" subtitle={app.zedId} onBack={() => nav.pop()} />;
  if (pending == null) return <Page>{header}</Page>;

  const rows = closeRow ? [...pending, closeRow] : pending;
  const showParams = pending.length === 0;
  const canSyncParams = showParams && completed.length > 0;
  // Already on the server: shown as SYNCED, nothing to do.
  const synced = [
    d.userType === 1 && d.isOpenMeetingSubmitted && !pending.some(r => r.kind === 'openMeeting') ? 'Opening Meeting' : null,
    d.isSelfieSubmitted && !pending.some(r => r.kind === 'selfie') ? 'Selfie on Site' : null,
    d.isSiteTourSubmitted ? 'Site Tour' : null,
  ].filter((t): t is string => t != null);
  const submittedParams = (d.allottedParameters ?? []).filter(p => p && p.status === SUBMITTED);
  const nothing = rows.length === 0 && !canSyncParams;
  const allSynced = synced.length > 0 || submittedParams.length > 0;

  return (
    <Page testID="submit-parameters">
      {header}
      <ZScroll contentContainerStyle={z.screenPad}>
        <SectionLabel label="Sync Assessment" />
        {nothing ? (
          <View testID="no-data">
            {allSynced ? (
              <Strip text="All synced · nothing left on this phone" tone="success" icon="check" />
            ) : (
              <Strip text="Nothing captured yet · nothing to sync" tone="warning" />
            )}
          </View>
        ) : (
          <Strip text="Saved on this phone · Ready to sync" tone="success" icon="check" />
        )}

        {rows.map(row => (
          <SyncRow key={row.kind} title={row.title} chip={<SyncChip onPress={() => syncRow(row)} testID={`sync-${row.kind}`} />} />
        ))}
        {synced.map(t => (
          <SyncRow key={t} title={t} chip={<SyncedChip />} />
        ))}

        {showParams && (completed.length > 0 || submittedParams.length > 0) ? (
          <>
            <SectionLabel label="Parameters" style={styles.paramsLabel} />
            {completed.map((p, i) => (
              <SyncRow
                key={`${p.parameterId}-${i}`}
                title={p.parameterName ?? ''}
                subtitle={p.requirements ? `${p.requirements.length} requirement(s) · Completed` : '0 requirement(s)'}
                tick={
                  <TickBox
                    checked={p.isSelectedToSubmit}
                    onChange={c => {
                      p.isSelectedToSubmit = c;
                      rerender(x => x + 1);
                    }}
                    testID={`select-${i}`}
                  />
                }
                chip={<SyncChip onPress={() => submitOne(p, 'one')} testID={`submit-param-${i}`} />}
              />
            ))}
            {submittedParams.map((p, i) => (
              <SyncRow key={`done-${p.parameterId}-${i}`} title={p.parameterName ?? ''} chip={<SyncedChip />} />
            ))}
          </>
        ) : null}
        {nothing && !allSynced ? <NoDataRows /> : null}

        <View style={styles.bulk}>
          <ZButton
            title="SYNC SELECTED"
            variant="secondary"
            disabled={!canSyncParams}
            style={[styles.bulkButton, canSyncParams && { backgroundColor: C.success, borderColor: C.success }]}
            testID="sync-selected"
            onPress={() => {
              const first = completed.find(x => x.isSelectedToSubmit);
              if (first) submitOne(first, 'selected');
              else ui.toast('Please select the Parameters you want to submit');
            }}
          />
          <ZButton title="SYNC ALL" disabled={!canSyncParams} style={styles.bulkButton} testID="sync-all" onPress={() => submitOne(completed[0]!, 'all')} />
        </View>
      </ZScroll>
    </Page>
  );
}

/** A row of the sync list: tick box (parameters), title, status chip. */
function SyncRow({ title, subtitle, tick, chip, muted }: { title: string; subtitle?: string; tick?: React.ReactNode; chip: React.ReactNode; muted?: boolean }) {
  return (
    <View style={styles.row}>
      {tick ? <View style={styles.tick}>{tick}</View> : null}
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, muted && { color: C.tMuted }]}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
      </View>
      {chip}
    </View>
  );
}

const SyncChip = ({ onPress, testID }: { onPress: () => void; testID: string }) => (
  <Pressable style={({ pressed }) => [styles.chip, styles.chipSync, pressed && { opacity: 0.85 }]} onPress={onPress} accessibilityRole="button" testID={testID}>
    <Text style={[styles.chipText, { color: C.tInverse }]}>SYNC</Text>
  </Pressable>
);

const SyncedChip = () => (
  <View style={[styles.chip, { backgroundColor: C.successBg }]}>
    <ZIcon name="check" size={14} color={C.success} />
    <Text style={[styles.chipText, styles.chipSynced]}>SYNCED</Text>
  </View>
);

/** Nothing on the phone and nothing synced yet: the sections, each "NO DATA". */
function NoDataRows() {
  return (
    <>
      {['Opening Meeting', 'Selfie on Site', 'Site Tour', 'Parameters', 'Closing Meeting'].map(t => (
        <SyncRow
          key={t}
          title={t}
          muted
          chip={
            <View style={[styles.chip, { backgroundColor: C.muted }]}>
              <Text style={[styles.chipText, { color: C.tMuted }]}>NO DATA</Text>
            </View>
          }
        />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  paramsLabel: { marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 8 },
  tick: { marginRight: 12 },
  rowText: { flex: 1, marginRight: 8 },
  rowTitle: { fontSize: 14, color: C.tPrimary },
  rowSub: { fontSize: 11, color: C.success, fontWeight: '600', marginTop: 2 },
  chip: { minWidth: 76, height: 32, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  chipSync: { backgroundColor: C.primary },
  chipText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  chipSynced: { color: C.success, marginLeft: 4 },
  bulk: { flexDirection: 'row', gap: 12, backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 16, marginTop: 8 },
  bulkButton: { flex: 1, borderRadius: 24 },
});
