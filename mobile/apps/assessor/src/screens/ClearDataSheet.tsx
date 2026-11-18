import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useUi } from '@zed/shared';
import { useSa } from '../app/context';
import type { ClearSection } from '../clearData';
import { nameOf, type AssessmentSummary } from '../portfolio';
import { Badge, C, Sheet, z, ZButton, ZIcon } from '../ui/zed';
import {
  CLEAR_CONFIRM_TEXT,
  CLEAR_DATA_SUBTITLE,
  CLEAR_FAILED,
  DATA_CLEANED,
  EVERYTHING_TEXT,
  EVERYTHING_TITLE,
  NOTHING_KEPT,
  sectionsCleared,
  TYPE_TO_CONFIRM,
  UNDERSTAND_LOSS,
  UNSYNCED_WARNING,
} from './assessmentActions';

type Step = 'pick' | 'confirm' | 'everything';

/**
 * 2026-11-18: the assessment card's "Clear data" (design Common_04c_Dashboard_ClearData): one row per step of the assessment
 * the phone holds data for (the same for an Onsite certification and a surveillance visit), with what it holds and an
 * "Unsynced" mark; only the ticked steps are removed, after a confirmation that asks for a tick when any of them holds
 * unsynced work. "Remove everything" is the earlier one-step clean, confirmed by typing CLEAR when anything is unsynced.
 */
export function ClearDataSheet({ a, onClose, onCleared }: { a: AssessmentSummary; onClose: () => void; onCleared: () => void }) {
  const app = useSa();
  const ui = useUi();
  const [sections, setSections] = useState<ClearSection[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [step, setStep] = useState<Step>('pick');
  const [understood, setUnderstood] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    app
      .dataSections(a.zedId)
      .then(list => alive && setSections(list))
      .catch(() => alive && setSections([]));
    return () => {
      alive = false;
    };
  }, [app, a.zedId]);

  const list = sections ?? [];
  const chosen = list.filter(s => selected.includes(s.id));
  const unsentChosen = chosen.filter(s => s.unsent);
  const anyUnsent = list.some(s => s.unsent);
  const allSelected = list.length > 0 && chosen.length === list.length;

  const toggle = (id: string) => setSelected(sel => (sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]));
  const toggleAll = () => setSelected(allSelected ? [] : list.map(s => s.id));
  const back = () => {
    setStep('pick');
    setUnderstood(false);
    setTyped('');
  };

  const clearSelected = async () => {
    if (busy || chosen.length === 0) return;
    setBusy(true);
    let ok = false;
    try {
      ok = await app.clearSections(a.zedId, chosen.map(s => s.id));
    } catch {
      ok = false;
    } finally {
      setBusy(false);
    }
    ui.toast(ok ? sectionsCleared(chosen.length) : CLEAR_FAILED);
    if (ok) onCleared();
    onClose();
  };

  const clearEverything = async () => {
    if (busy) return;
    setBusy(true);
    let ok = false;
    try {
      ok = await app.deleteStoredAssessment(a.zedId);
    } catch {
      ok = false;
    } finally {
      setBusy(false);
    }
    ui.toast(ok ? DATA_CLEANED : CLEAR_FAILED);
    if (ok) onCleared();
    onClose();
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={step === 'pick' ? onClose : back} visible>
      <Sheet testID="clear-data">
        <View style={[z.rowBetween, { alignItems: 'flex-start' }]}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={st.overline}>CLEAR DATA</Text>
            <Text style={[z.h2, { marginTop: 6 }]} testID="clear-data-name">
              {nameOf(a)}
            </Text>
            {a.system === 'surveillance' ? (
              <View style={{ flexDirection: 'row', marginTop: 6 }}>
                <Badge label="Surveillance visit" tone="info" small testID="clear-data-surveillance" />
              </View>
            ) : null}
          </View>
          <Pressable style={st.close} onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" testID="clear-data-close">
            <ZIcon name="close" size={16} color={C.tSecondary} />
          </Pressable>
        </View>

        {step === 'pick' ? (
          <>
            <Text style={[z.sub, { marginTop: 6 }]}>{CLEAR_DATA_SUBTITLE}</Text>
            {sections == null ? (
              <Text style={[z.muted, { marginVertical: 18 }]}>Reading the data kept on the phone…</Text>
            ) : list.length === 0 ? (
              <Text style={[z.sub, { marginVertical: 18 }]} testID="clear-data-empty">
                {NOTHING_KEPT}
              </Text>
            ) : (
              <>
                <View style={[z.rowBetween, { marginTop: 14, marginBottom: 8 }]}>
                  <Text style={st.counter} testID="clear-count">{`${chosen.length} of ${list.length} selected`}</Text>
                  <Pressable onPress={toggleAll} hitSlop={8} accessibilityRole="button" testID="clear-select-all">
                    <Text style={st.link}>{allSelected ? 'Clear selection' : 'Select all'}</Text>
                  </Pressable>
                </View>
                <ScrollView style={{ maxHeight: 340 }} nestedScrollEnabled>
                  {list.map(s => (
                    <SectionRow key={s.id} s={s} on={selected.includes(s.id)} onPress={() => toggle(s.id)} />
                  ))}
                </ScrollView>
              </>
            )}
            {anyUnsent ? <Warning text={UNSYNCED_WARNING} testID="clear-unsynced-warning" /> : null}
            <View style={st.buttons}>
              <ZButton title="Cancel" variant="ghost" onPress={onClose} style={{ flex: 1 }} testID="clear-cancel" />
              <ZButton title="Clear selected" variant="danger" disabled={chosen.length === 0} onPress={() => setStep('confirm')} style={{ flex: 1.2 }} testID="clear-selected" />
            </View>
            {list.length > 0 ? (
              <Pressable style={st.everything} onPress={() => setStep('everything')} accessibilityRole="button" testID="clear-everything">
                <Text style={st.everythingText}>Remove everything for this assessment</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}

        {step === 'confirm' ? (
          <View testID="clear-confirm-step">
            <Text style={[z.title, { marginTop: 14 }]}>{chosen.length === 1 ? 'Clear 1 section?' : `Clear ${chosen.length} sections?`}</Text>
            <View style={{ marginTop: 8 }}>
              {chosen.map(s => (
                <View key={s.id} style={[z.rowBetween, { paddingVertical: 4 }]}>
                  <Text style={[z.body, { flex: 1 }]}>{`• ${s.title}`}</Text>
                  {s.unsent ? <Badge label="Unsynced" tone="warning" small /> : null}
                </View>
              ))}
            </View>
            <Text style={[z.sub, { marginTop: 8 }]}>{CLEAR_CONFIRM_TEXT}</Text>
            {unsentChosen.length ? (
              <>
                <Warning
                  text={`${unsentChosen.length === 1 ? 'One of these sections holds' : `${unsentChosen.length} of these sections hold`} work not yet synced. ${UNSYNCED_WARNING}`}
                  testID="clear-confirm-warning"
                />
                <Tick on={understood} onPress={() => setUnderstood(u => !u)} label={UNDERSTAND_LOSS} testID="clear-understand" />
              </>
            ) : null}
            <View style={st.buttons}>
              <ZButton title="Back" variant="ghost" onPress={back} style={{ flex: 1 }} testID="clear-back" />
              <ZButton
                title="Clear"
                variant="danger"
                disabled={busy || (unsentChosen.length > 0 && !understood)}
                onPress={clearSelected}
                style={{ flex: 1.2 }}
                testID="clear-confirm"
              />
            </View>
          </View>
        ) : null}

        {step === 'everything' ? (
          <View testID="clear-everything-step">
            <Text style={[z.title, { marginTop: 14 }]}>{EVERYTHING_TITLE}</Text>
            <Text style={[z.sub, { marginTop: 8 }]}>{EVERYTHING_TEXT}</Text>
            {anyUnsent ? (
              <>
                <Warning text={`Some of it is not synced. ${UNSYNCED_WARNING}`} testID="clear-everything-warning" />
                <Text style={[z.sub, { marginTop: 10 }]}>{`Type ${TYPE_TO_CONFIRM} to confirm`}</Text>
                <TextInput
                  value={typed}
                  onChangeText={setTyped}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder={TYPE_TO_CONFIRM}
                  placeholderTextColor={C.tMuted}
                  style={st.input}
                  accessibilityLabel={`Type ${TYPE_TO_CONFIRM} to confirm`}
                  testID="clear-type"
                />
              </>
            ) : null}
            <View style={st.buttons}>
              <ZButton title="Back" variant="ghost" onPress={back} style={{ flex: 1 }} testID="clear-back" />
              <ZButton
                title="Remove everything"
                variant="danger"
                disabled={busy || (anyUnsent && typed.trim().toUpperCase() !== TYPE_TO_CONFIRM)}
                onPress={clearEverything}
                style={{ flex: 1.4 }}
                testID="clear-everything-confirm"
              />
            </View>
          </View>
        ) : null}
      </Sheet>
    </Modal>
  );
}

function SectionRow({ s, on, onPress }: { s: ClearSection; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[st.row, on && st.rowOn]}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={`${s.title}, ${s.detail}${s.unsent ? ', unsynced' : ''}`}
      testID={`clear-row-${s.id}`}
    >
      <View style={[st.box, on && st.boxOn]}>{on ? <ZIcon name="check" size={14} color={C.tInverse} strokeWidth={2.4} /> : null}</View>
      <View style={{ marginLeft: 12 }}>
        <ZIcon name={s.icon} size={18} color={on ? C.primary : C.tMuted} />
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={st.rowTitle}>{s.title}</Text>
        <Text style={st.rowDetail} testID={`clear-detail-${s.id}`}>
          {s.detail}
        </Text>
        {s.note ? <Text style={st.rowNote}>{s.note}</Text> : null}
      </View>
      {s.unsent ? (
        <View style={{ marginLeft: 8 }}>
          <Badge label="Unsynced" tone="warning" small testID={`clear-unsent-${s.id}`} />
        </View>
      ) : null}
    </Pressable>
  );
}

function Warning({ text, testID }: { text: string; testID?: string }) {
  return (
    <View style={st.warning} testID={testID}>
      <ZIcon name="info" size={18} color={C.danger} />
      <Text style={st.warningText}>{text}</Text>
    </View>
  );
}

function Tick({ on, onPress, label, testID }: { on: boolean; onPress: () => void; label: string; testID?: string }) {
  return (
    <Pressable style={st.tick} onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={label} testID={testID}>
      <View style={[st.box, on && st.boxDanger]}>{on ? <ZIcon name="check" size={14} color={C.tInverse} strokeWidth={2.4} /> : null}</View>
      <Text style={[z.body, { flex: 1, marginLeft: 10 }]}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  overline: { fontSize: 11, fontWeight: '700', color: C.tSecondary, letterSpacing: 0.5 },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.muted, alignItems: 'center', justifyContent: 'center' },
  counter: { fontSize: 11, fontWeight: '600', color: C.tMuted, letterSpacing: 0.4 },
  link: { fontSize: 12, fontWeight: '700', color: C.primaryDark },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  rowOn: { backgroundColor: C.primaryBg, borderColor: C.primary, borderWidth: 1.4 },
  box: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.6, borderColor: C.tMuted, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: C.primary, borderColor: C.primary },
  boxDanger: { backgroundColor: C.danger, borderColor: C.danger },
  rowTitle: { fontSize: 13, fontWeight: '700', color: C.tPrimary },
  rowDetail: { fontSize: 11, color: C.tMuted, marginTop: 2 },
  rowNote: { fontSize: 11, color: C.tSecondary, marginTop: 2 },
  warning: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.dangerBg, borderRadius: 12, padding: 12, marginTop: 10 },
  warningText: { flex: 1, marginLeft: 10, fontSize: 12, color: C.danger },
  tick: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 16 },
  everything: { alignSelf: 'center', marginTop: 12, paddingVertical: 4 },
  everythingText: { fontSize: 12, fontWeight: '700', color: C.danger, textDecorationLine: 'underline' },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginTop: 6, fontSize: 15, color: C.tPrimary, letterSpacing: 2 },
});
