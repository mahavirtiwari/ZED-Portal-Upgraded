import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { isNetworkAvailable, isSuccess, useNavigation, useUi } from '@zed/shared';
import { useSa } from '../app/context';
import { baseRequest, selfieSyncAllowed, siteTourSubmitted, submitEndAssessment, submitSiteTour, syncOpenMeeting, syncSelfie } from '../flows/submissions';
import { allowCloseMeetingSubmission, COMPLETED, EVIDENCE_SITE_TOUR, FAILED_TO_SUBMIT, isLead, SUBMITTED, type AllottedParameters, type ServiceResponse } from '../models';
import { C, HeroHeader, Page, SectionLabel, Strip, z, ZButton, ZIcon, ZScroll, type IconName } from '../ui/zed';
import { ASSESSMENT_COMPLETED, useSubmissionSuccess } from './FinalCommentsScreen';

type PendingRow = { kind: 'openMeeting' | 'selfie' | 'siteTour' | 'closeMeeting'; title: string };

const failure = (r: { errorMessage?: string | null } | null) => (r?.errorMessage?.trim() ? r.errorMessage : FAILED_TO_SUBMIT);

/** checkQuestionsData: every requirement has a conformance. */
function checkQuestionsData(p: AllottedParameters | null | undefined): boolean {
  if (!p?.requirements?.length) return false;
  return p.requirements.every(q => (q.conformance ?? '').trim() !== '');
}

/**
 * SubmitParametersActivity ("Sync Data"): what is saved on the phone (opening meeting, selfie, site tour), then the
 * completed allotted parameters (this app's milestone screens work on their own copies, so there are none in practice),
 * then the saved closing meeting.
 */
export function SubmitParametersScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const onSuccess = useSubmissionSuccess(ASSESSMENT_COMPLETED);
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
      const allowed = !isLead(d) || ((await app.store.meeting(app.userId, true)) == null && d.isOpenMeetingSubmitted);
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
      // Closing meeting / final comments: only once every section is submitted.
      if (!allowCloseMeetingSubmission(d)) {
        ui.alert(null, 'Please submit all the sections in order to close the meeting', [{ text: 'OK', onPress: () => nav.pop() }], false);
        return;
      }
      const request = await app.store.meeting(app.userId, false);
      if (!request) return;
      ui.showLoading('This might take a while, Please Wait...');
      let r: ServiceResponse | null = null;
      try {
        r = await submitEndAssessment(app, request, message => ui.toast(message, { long: true }));
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
      r = await app.api.submitParameter({ ...baseRequest(app), allottedParameterObj: p });
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

  const header = <HeroHeader title="Sync Data" subtitle={app.zedId} onBack={() => nav.pop()} />;
  if (pending == null) return <Page>{header}</Page>;

  const rows = closeRow ? [...pending, closeRow] : pending;
  const showParams = pending.length === 0;
  const canSyncParams = showParams && completed.length > 0;
  // Already on the server: shown as SYNCED, nothing to do.
  const synced = ([
    isLead(d) && d.isOpenMeetingSubmitted && !pending.some(r => r.kind === 'openMeeting') ? { kind: 'openMeeting', title: 'Opening Meeting' } : null,
    d.isSelfieSubmitted && !pending.some(r => r.kind === 'selfie') ? { kind: 'selfie', title: 'Selfie on Site' } : null,
    d.isSiteTourSubmitted ? { kind: 'siteTour', title: 'Site Tour' } : null,
  ] as Array<PendingRow | null>).filter((t): t is PendingRow => t != null);
  const nothing = rows.length === 0 && !canSyncParams;
  const allSynced = synced.length > 0;

  return (
    <Page testID="submit-parameters">
      {header}
      <ZScroll contentContainerStyle={z.screenPad}>
        {nothing ? (
          <View testID="no-data">
            {allSynced ? (
              <Strip title="All data synced" text="Nothing left on this phone" tone="success" icon="check" />
            ) : (
              <Strip text="No data available to sync at this time." tone="warning" />
            )}
          </View>
        ) : (
          <Strip title="Saved on this phone" text="Ready to sync" tone="warning" icon="sync" />
        )}

        {rows.length > 0 || synced.length > 0 ? <SectionLabel label={nothing ? 'Synced items' : 'Sync queue'} /> : null}
        {rows.map(row => (
          <SyncRow key={row.kind} icon={ICONS[row.kind]} title={row.title} subtitle="Queued" chip={<SyncChip onPress={() => syncRow(row)} testID={`sync-${row.kind}`} />} />
        ))}
        {synced.map(row => (
          <SyncRow key={`synced-${row.kind}`} icon={ICONS[row.kind]} title={row.title} chip={<SyncedChip />} />
        ))}

        {nothing && !allSynced ? (
          <View style={styles.empty}>
            <View style={styles.emptyWell}>
              <ZIcon name="sync" size={36} color={C.tMuted} />
            </View>
            <Text style={styles.emptyTitle} testID="no-data-title">
              No data to sync
            </Text>
            <Text style={styles.emptyText}>There are no pending items to send to the server right now.</Text>
          </View>
        ) : null}

        {canSyncParams ? (
          <>
            <SectionLabel label="Parameters" style={styles.paramsLabel} />
            {completed.map((p, i) => (
              <SyncRow
                key={`${p.parameterId}-${i}`}
                icon="clipboard"
                title={p.parameterName ?? ''}
                subtitle={p.requirements ? `${p.requirements.length} Question(s) | Completed` : '0 Question(s)'}
                done={!!p.requirements}
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
                chip={<SyncChip title="SUBMIT" onPress={() => submitOne(p, 'one')} testID={`submit-param-${i}`} />}
              />
            ))}
          </>
        ) : null}
      </ZScroll>
      <View style={styles.bulk}>
        <ZButton
          title="Sync Selected"
          variant="outline"
          disabled={!canSyncParams}
          style={styles.bulkButton}
          testID="sync-selected"
          onPress={() => {
            const first = completed.find(x => x.isSelectedToSubmit);
            if (first) submitOne(first, 'selected');
            else ui.toast('Please select the Parameters you want to submit');
          }}
        />
        <ZButton title="Sync All" icon="sync" disabled={!canSyncParams} style={styles.bulkButton} testID="sync-all" onPress={() => submitOne(completed[0]!, 'all')} />
      </View>
    </Page>
  );
}

const ICONS: Record<PendingRow['kind'], IconName> = { openMeeting: 'users', selfie: 'camera', siteTour: 'image', closeMeeting: 'users' };

/** A row of the sync list: tick box (parameters), icon well, title, status chip. */
function SyncRow({ icon, title, subtitle, done, tick, chip }: { icon: IconName; title: string; subtitle?: string; done?: boolean; tick?: React.ReactNode; chip: React.ReactNode }) {
  return (
    <View style={styles.row}>
      {tick ? <View style={styles.tick}>{tick}</View> : null}
      <View style={styles.well}>
        <ZIcon name={icon} size={20} color={C.primary} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={[styles.rowSub, done && styles.rowSubDone]}>{subtitle}</Text> : null}
      </View>
      {chip}
    </View>
  );
}

const SyncChip = ({ onPress, testID, title = 'SYNC' }: { onPress: () => void; testID: string; title?: string }) => (
  <Pressable style={({ pressed }) => [styles.chip, styles.chipSync, pressed && { opacity: 0.85 }]} onPress={onPress} accessibilityRole="button" testID={testID}>
    <Text style={[styles.chipText, { color: C.tInverse }]}>{title}</Text>
  </Pressable>
);

const SyncedChip = () => (
  <View style={[styles.chip, { backgroundColor: C.successBg }]}>
    <ZIcon name="check" size={14} color={C.success} />
    <Text style={[styles.chipText, styles.chipSynced]}>SYNCED</Text>
  </View>
);

/** A tick box (rounded square, green when ticked). */
function TickBox({ checked, onChange, testID }: { checked: boolean; onChange: (checked: boolean) => void; testID?: string }) {
  return (
    <Pressable onPress={() => onChange(!checked)} accessibilityRole="checkbox" accessibilityState={{ checked }} hitSlop={6} testID={testID}>
      <View style={[styles.box, checked && styles.boxOn]}>{checked ? <ZIcon name="check" size={14} color={C.tInverse} strokeWidth={2.6} /> : null}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  paramsLabel: { marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 64, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  tick: { marginRight: 10 },
  well: { width: 40, height: 40, borderRadius: 10, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  rowText: { flex: 1, marginRight: 8 },
  rowTitle: { fontSize: 14, fontWeight: '700', color: C.tPrimary },
  rowSub: { fontSize: 11, color: C.tSecondary, marginTop: 2 },
  rowSubDone: { color: C.success, fontWeight: '600' },
  chip: { minWidth: 72, height: 30, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  chipSync: { backgroundColor: C.primary },
  chipText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  chipSynced: { color: C.success, marginLeft: 4 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: C.success, borderColor: C.success },
  empty: { alignItems: 'center', backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, paddingVertical: 28, paddingHorizontal: 24 },
  emptyWell: { width: 96, height: 96, borderRadius: 48, backgroundColor: C.muted, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: C.tPrimary, marginTop: 16 },
  emptyText: { fontSize: 13, color: C.tSecondary, marginTop: 6, textAlign: 'center' },
  bulk: { flexDirection: 'row', gap: 12, backgroundColor: C.surface, borderTopColor: C.border, borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 12 },
  bulkButton: { flex: 1, borderRadius: 12 },
});
