import React, { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { isNetworkAvailable, isSuccess, useNavigation, useRoute, useUi } from '@zed/shared';
import { useSa } from '../app/context';
import { submitAllocation } from '../flows/submissions';
import { FAILED_TO_SUBMIT, type AssessorDetails, type ParametersDetails } from '../models';
import { Avatar, Badge, C, Card, HeroHeader, Page, SectionLabel, ZButton, ZIcon, z } from '../ui/zed';

/** The assessor's role under the name (AssessorDetails.userType: 1 lead, 2 co-assessor). */
const roleOf = (a: AssessorDetails | undefined) => (a?.userType === '1' ? 'Lead Assessor' : a?.userType === '2' ? 'Co Assessor' : null);

/** AlertActivity: allocation pending (exclamation) or submitted (done). */
export function AlertScreen() {
  const app = useSa();
  const nav = useNavigation();
  const { params } = useRoute<{ allocationPending?: boolean }>();
  const pending = params.allocationPending === true;
  return (
    <Page testID="alert-screen">
      <HeroHeader title="Parameter Allocation" subtitle={app.zedId} />
      <View style={styles.alertBox}>
        <View style={[styles.alertWell, { backgroundColor: pending ? C.warningBg : C.successBg }]}>
          <ZIcon name={pending ? 'info' : 'check'} size={40} color={pending ? C.warning : C.success} />
        </View>
        <Text style={styles.alertText} testID="alert-message">
          {pending ? 'Allocation from Lead Assessor pending.\n\nPlease try again after sometime.' : 'Allocation Submitted'}
        </Text>
        <ZButton
          title="Exit"
          testID="alert-exit"
          style={styles.alertButton}
          // Redesign: back to the dashboard (the login page forwards a signed-in assessor there); the legacy closed the
          // app on "pending" (CLEAR_TASK + finish()), when one sign-in held one unit.
          onPress={() => nav.reset([{ name: 'Login' }])}
        />
      </View>
    </Page>
  );
}

/** AllocationActivity: the lead assessor allots each parameter to an assessor. */
export function AllocationScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const d = app.details!;
  const [details, setDetails] = useState<ParametersDetails[]>(() => (d.inputParameters ?? []).filter(Boolean).map(p => ({ ...p })));
  const [errors, setErrors] = useState<Set<number>>(new Set());
  const [showCounts, setShowCounts] = useState(true);
  const alertShown = useRef(false);
  const assessors = (d.assessors ?? []).filter(a => a?.assessorName != null && a.assessorId != null);

  if (!d.inputParameters) {
    ui.toast('Input Parameters missing');
    nav.reset([{ name: 'Login' }]);
    return null;
  }

  const assign = (index: number, name: string | null) => {
    setDetails(list =>
      list.map((p, i) =>
        i === index ? { ...p, assigneeName: name, assigneeId: name == null ? null : assessors.find(a => a.assessorName === name)?.assessorId ?? '' } : p,
      ),
    );
    if (name != null) setErrors(e => new Set([...e].filter(x => x !== index)));
  };

  const pick = async (index: number) => {
    const names = ['Select', ...assessors.map(a => a.assessorName!)];
    const i = await ui.pickItem(null, names);
    if (i == null || i < 0) return;
    assign(index, i === 0 ? null : names[i]!);
  };

  const validateData = (): boolean => {
    const missing = new Set<number>();
    details.forEach((p, i) => {
      if (!p.isExcemptedFromSa && p.assigneeName == null) missing.add(i);
    });
    setErrors(missing);
    if (missing.size > 0) {
      ui.showAlert('Please assign all the parameters to proceed');
      return false;
    }
    return true;
  };

  const callSubmitService = async () => {
    if (!(await isNetworkAvailable())) return ui.toast('Network not available', { long: true });
    ui.showLoading('Please Wait...');
    let response = null;
    try {
      response = await submitAllocation(app, details);
    } catch {
      response = null;
    } finally {
      ui.hideLoading();
    }
    if (isSuccess(response)) {
      ui.toast('Allocation Submitted successfully', { long: true });
      nav.reset([{ name: 'Alert' }]);
    } else {
      ui.toast(response?.errorMessage ? response.errorMessage : FAILED_TO_SUBMIT, { long: true });
    }
  };

  const submitData = () => {
    if (!validateData()) return;
    if (alertShown.current) {
      callSubmitService();
    } else {
      alertShown.current = true;
      ui.alert(
        null,
        'Please review the allocated data before submission.',
        [
          { text: 'Submit', style: 'cancel', onPress: () => callSubmitService() },
          { text: 'Review' },
        ],
        false,
      );
    }
  };

  const toAllocate = details.filter(p => !p.isExcemptedFromSa);
  const allocated = toAllocate.filter(p => p.assigneeName != null).length;
  const allDone = allocated === toAllocate.length;

  return (
    <Page testID="allocation">
      <HeroHeader title="Parameter Allocation" subtitle={app.zedId} onBack={nav.canGoBack() ? () => nav.pop() : undefined} />
      <ScrollView contentContainerStyle={z.screenPad}>
        <Text style={styles.intro}>{'Assign each clause to a team member.\nLead Assessor reviews all sections.'}</Text>

        <Card style={styles.counts}>
          <Pressable style={z.rowBetween} onPress={() => setShowCounts(s => !s)} testID="details-label">
            <SectionLabel label="Allocation details" style={styles.flatLabel} />
            <ZIcon name={showCounts ? 'chevron-down' : 'chevron-right'} size={18} color={C.tMuted} />
          </Pressable>
          {showCounts
            ? assessors.map(a => (
                <View key={a.assessorId!} style={styles.countRow}>
                  <Avatar name={a.assessorName!} size={26} />
                  <View style={styles.countName}>
                    <Text style={styles.name}>{a.assessorName}</Text>
                    {roleOf(a) ? <Text style={styles.role}>{roleOf(a)}</Text> : null}
                  </View>
                  <Text style={styles.countValue} testID={`count-${a.assessorId}`}>
                    {details.filter(p => p.assigneeId != null && p.assigneeId === a.assessorId).length}
                  </Text>
                </View>
              ))
            : null}
        </Card>

        <SectionLabel label="Parameters" />
        {details.map((p, i) => {
          const assignee = p.assigneeName != null ? assessors.find(a => a.assessorId === p.assigneeId) : undefined;
          const error = errors.has(i);
          return (
            <Card key={`${p.parameterId}-${i}`} style={error ? styles.cardError : undefined}>
              <View style={styles.paramHead}>
                <Text style={[styles.paramName, error && { color: C.danger }]} testID={`param-${i}-name`}>
                  {p.parameterName}
                  {error ? '  (!)' : ''}
                </Text>
                {p.isExcemptedFromSa ? <Badge label="Exempted" tone="danger" small /> : null}
              </View>
              <Pressable
                style={[styles.select, p.assigneeName != null && styles.selectOn, p.isExcemptedFromSa && styles.selectOff]}
                disabled={p.isExcemptedFromSa}
                onPress={() => pick(i)}
                testID={`param-${i}-assignee`}>
                {p.assigneeName != null ? (
                  <>
                    <Avatar name={p.assigneeName} size={22} />
                    <View style={styles.selectText}>
                      <Text style={styles.name}>{p.assigneeName}</Text>
                      {roleOf(assignee) ? <Text style={styles.role}>{roleOf(assignee)}</Text> : null}
                    </View>
                  </>
                ) : (
                  <>
                    <View style={styles.userWell}>
                      <ZIcon name="user" size={12} color={C.tMuted} />
                    </View>
                    <Text style={[styles.selectText, styles.placeholder]}>Select assessor</Text>
                  </>
                )}
                <ZIcon name="chevron-down" size={18} color={C.tMuted} />
              </Pressable>
            </Card>
          );
        })}

        <ZButton title="Save allocation" onPress={submitData} style={styles.save} testID="submit-allocation" />
        <Text style={[styles.hint, allDone && styles.hintDone]} testID="allocation-hint">
          {allDone ? `${allocated} of ${toAllocate.length} sections allocated.` : 'Co-assessors cannot log in until parameters are allocated.'}
        </Text>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  alertBox: { flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center' },
  alertWell: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  alertText: { textAlign: 'center', fontSize: 16, fontWeight: '600', color: C.tPrimary, marginVertical: 20 },
  alertButton: { alignSelf: 'stretch' },
  intro: { fontSize: 13, color: C.tSecondary, marginBottom: 14, lineHeight: 18 },
  counts: { paddingVertical: 8 },
  flatLabel: { marginTop: 0, marginBottom: 0 },
  countRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  countName: { flex: 1, marginLeft: 10 },
  countValue: { fontSize: 15, fontWeight: '700', color: C.tPrimary },
  cardError: { borderWidth: 1, borderColor: C.danger },
  paramHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  paramName: { flex: 1, fontSize: 14, fontWeight: '600', color: C.tPrimary, marginRight: 8 },
  select: { flexDirection: 'row', alignItems: 'center', minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, paddingHorizontal: 10 },
  selectOn: { backgroundColor: C.primaryBg, borderColor: C.primaryBg },
  selectOff: { opacity: 0.5 },
  selectText: { flex: 1, marginLeft: 10 },
  userWell: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.muted, alignItems: 'center', justifyContent: 'center' },
  placeholder: { fontSize: 13, color: C.tMuted },
  name: { fontSize: 13, fontWeight: '600', color: C.tPrimary },
  role: { fontSize: 11, color: C.tSecondary },
  save: { minHeight: 52, borderRadius: 12, marginTop: 4 },
  hint: { fontSize: 10, color: C.tMuted, textAlign: 'center', marginTop: 10 },
  hintDone: { color: C.success, fontWeight: '600' },
});
