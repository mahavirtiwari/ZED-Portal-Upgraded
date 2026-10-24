import React, { useRef, useState } from 'react';
import { BackHandler, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { isNetworkAvailable, isSuccess, useNavigation, useRoute, useUi } from '@zed/shared';
import { useSa } from '../app/context';
import { images } from '../assets/images';
import { submitAllocation } from '../flows/submissions';
import { FAILED_TO_SUBMIT, type ParametersDetails } from '../models';
import { SaButton, SaFrame, sa } from '../ui/kit';

/** AlertActivity: allocation pending (exclamation) or submitted (done). */
export function AlertScreen() {
  const nav = useNavigation();
  const { params } = useRoute<{ allocationPending?: boolean }>();
  const pending = params.allocationPending === true;
  return (
    <SaFrame testID="alert-screen">
      <View style={styles.alertBox}>
        <Image source={pending ? images.ic_exclamation_48dp : images.ic_done_teal} style={styles.alertImage} resizeMode="contain" />
        <Text style={styles.alertText} testID="alert-message">
          {pending ? 'Allocation from Lead Assessor pending.\n\nPlease try again after sometime.' : 'Allocation Submitted'}
        </Text>
        <SaButton
          title="EXIT"
          large
          testID="alert-exit"
          // Opened with CLEAR_TASK: finish() on "pending" closed the app.
          onPress={() => (pending ? BackHandler.exitApp() : nav.reset([{ name: 'Login' }]))}
        />
      </View>
    </SaFrame>
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

  return (
    <SaFrame testID="allocation">
      <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
        <Pressable style={styles.detailsHeader} onPress={() => setShowCounts(s => !s)} testID="details-label">
          <Text style={styles.detailsLabel}>ALLOCATION DETAILS</Text>
          <Image source={showCounts ? images.ic_keyboard_arrow_up_black_18dp : images.ic_keyboard_arrow_down_black_18dp} style={styles.arrow} />
        </Pressable>
        {showCounts
          ? assessors.map(a => (
              <View key={a.assessorId!} style={styles.countRow}>
                <Text style={styles.countLabel}>{a.assessorName}</Text>
                <Text style={styles.countValue} testID={`count-${a.assessorId}`}>
                  {details.filter(p => p.assigneeId != null && p.assigneeId === a.assessorId).length}
                </Text>
              </View>
            ))
          : null}
        <View style={styles.box}>
          <Text style={styles.header}>PARAMETERS</Text>
          {details.map((p, i) => (
            <View key={`${p.parameterId}-${i}`} style={styles.paramRow}>
              {p.isExcemptedFromSa ? <Text style={styles.exempted}>Exempted</Text> : null}
              <Text style={[styles.paramName, errors.has(i) && styles.paramError]} testID={`param-${i}-name`}>
                {p.parameterName}
                {errors.has(i) ? '  (!)' : ''}
              </Text>
              <Pressable
                style={[styles.spinner, p.isExcemptedFromSa && { opacity: 0.5 }]}
                disabled={p.isExcemptedFromSa}
                onPress={() => pick(i)}
                testID={`param-${i}-assignee`}>
                <Text style={styles.spinnerText}>{p.assigneeName ?? 'Select'}</Text>
                <Text style={styles.spinnerArrow}>▾</Text>
              </Pressable>
            </View>
          ))}
        </View>
        <SaButton title="SUBMIT ALLOCATION" large onPress={submitData} testID="submit-allocation" />
      </ScrollView>
    </SaFrame>
  );
}

const styles = StyleSheet.create({
  alertBox: { flex: 1, padding: 20, justifyContent: 'center' },
  alertImage: { width: 96, height: 96, alignSelf: 'center' },
  alertText: { textAlign: 'center', fontSize: 18, color: sa.darkGrey, marginVertical: 20 },
  detailsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, backgroundColor: sa.silver },
  detailsLabel: { fontWeight: 'bold', fontSize: 14, color: sa.darkGrey },
  arrow: { width: 18, height: 18 },
  countRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 6 },
  countLabel: { color: sa.coolGrey, fontSize: 15 },
  countValue: { color: sa.darkGrey, fontSize: 15, fontWeight: 'bold' },
  box: { margin: 12, borderColor: '#C7CACD', borderWidth: 0.5 },
  header: { backgroundColor: sa.silver, paddingLeft: 16, paddingVertical: 8, fontSize: 14, fontWeight: 'bold', color: sa.darkGrey },
  paramRow: { padding: 8, borderBottomColor: sa.divider, borderBottomWidth: 1 },
  exempted: { color: sa.red, fontSize: 12, fontWeight: 'bold' },
  paramName: { color: sa.darkGrey, fontSize: 15, marginVertical: 4 },
  paramError: { color: '#B00020' },
  spinner: { flexDirection: 'row', alignItems: 'center', borderColor: '#C7CACD', borderWidth: 1, borderRadius: 4, padding: 10 },
  spinnerText: { flex: 1, color: sa.darkGrey, fontSize: 15 },
  spinnerArrow: { color: sa.coolGrey, fontSize: 16 },
});
