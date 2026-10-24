import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { CheckBox, isNetworkAvailable, isSuccess, useNavigation, useUi } from '@zed/shared';
import { useSa } from '../app/context';
import { baseRequest, selfieSyncAllowed, siteTourSubmitted, submitEndAssessment, submitSiteTour, syncOpenMeeting, syncSelfie } from '../flows/submissions';
import { allowCloseMeetingSubmission, COMPLETED, EVIDENCE_SITE_TOUR, FAILED_TO_SUBMIT, isLead, SUBMITTED, type AllottedParameters, type ServiceResponse } from '../models';
import { SaButton, SaFrame, sa } from '../ui/kit';
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

  if (pending == null) return <SaFrame>{null}</SaFrame>;

  const rows = closeRow ? [...pending, closeRow] : pending;
  const showParams = pending.length === 0;
  return (
    <SaFrame testID="submit-parameters">
      <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
        {rows.map(row => (
          <View key={row.kind} style={styles.pendingRow}>
            <Text style={styles.pendingTitle}>{row.title}</Text>
            <SaButton title="Sync" onPress={() => syncRow(row)} style={styles.syncButton} testID={`sync-${row.kind}`} />
          </View>
        ))}
        {showParams && completed.length === 0 && !closeRow ? <Text style={styles.progressText} testID="no-data">No data to sync</Text> : null}
        {showParams && completed.length > 0 ? (
          <View>
            <View style={styles.pendingRow}>
              <Text style={styles.pendingTitle}>Sync All</Text>
              <SaButton title="Sync" onPress={() => submitOne(completed[0]!, 'all')} style={styles.syncButton} testID="sync-all" />
            </View>
            <View style={styles.pendingRow}>
              <Text style={styles.pendingTitle}>Sync Selected</Text>
              <SaButton
                title="Sync"
                style={styles.syncButton}
                testID="sync-selected"
                onPress={() => {
                  const first = completed.find(x => x.isSelectedToSubmit);
                  if (first) submitOne(first, 'selected');
                  else ui.toast('Please select the Parameters you want to submit');
                }}
              />
            </View>
            {completed.map((p, i) => (
              <View key={`${p.parameterId}-${i}`} style={styles.paramRow}>
                <CheckBox
                  label=""
                  checked={p.isSelectedToSubmit}
                  onChange={c => {
                    p.isSelectedToSubmit = c;
                    rerender(x => x + 1);
                  }}
                  testID={`select-${i}`}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.paramName}>{p.parameterName}</Text>
                  <Text style={[styles.paramStatus, p.requirements && { color: sa.teal }]}>
                    {p.requirements ? `${p.requirements.length} Question(s) | Completed` : '0 Question(s)'}
                  </Text>
                </View>
                <SaButton title="Submit" onPress={() => submitOne(p, 'one')} style={styles.syncButton} testID={`submit-param-${i}`} />
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SaFrame>
  );
}

const styles = StyleSheet.create({
  pendingRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, borderBottomColor: sa.divider, borderBottomWidth: 1 },
  pendingTitle: { flex: 1, color: sa.labelColor, fontSize: 16, fontWeight: 'bold' },
  syncButton: { margin: 5, minHeight: 40 },
  progressText: { color: sa.darkGrey, fontSize: 16, fontWeight: 'bold', padding: 16, textAlign: 'center' },
  paramRow: { flexDirection: 'row', alignItems: 'center', padding: 6, borderBottomColor: sa.divider, borderBottomWidth: 1 },
  paramName: { color: sa.darkGrey, fontSize: 16, padding: 8 },
  paramStatus: { color: sa.coolGrey, fontSize: 14, fontWeight: 'bold', paddingHorizontal: 8, paddingBottom: 8 },
});
