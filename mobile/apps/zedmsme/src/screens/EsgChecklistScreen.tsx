import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  colors,
  dimens,
  FieldBox,
  FieldLabel,
  isNetworkAvailable,
  isSuccess,
  ScreenFrame,
  shapes,
  SingleChoice,
  textStyles,
  useBackHandler,
  useNavigation,
  useRoute,
  useUi,
  ZedButton,
} from '@zed/shared';
import type { EsgField, EsgResponse } from '../api';
import { useMsme } from '../app/context';
import { areAllFieldsFilled, buildEsgJson, toSubmitRequest } from '../esg';
import { certificationDetailsOf, certificationLabel, Status, type CertificationType } from '../models';
import { useLevelName } from '../levels';

/** ESGCheckListActivity: the dynamic checklist from GetEsgChecklist (needs the network, as before). */
export function EsgChecklistScreen() {
  const app = useMsme();
  const nav = useNavigation();
  const ui = useUi();
  const type = useRoute<{ certificationType: CertificationType }>().params.certificationType;
  const levelTitle = useLevelName(type);
  const [esg, setEsg] = useState<EsgResponse | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const fetchChecklist = useCallback(async () => {
    if (!(await isNetworkAvailable())) {
      ui.alert('Error', 'Please check the network connection and retry.', [{ text: 'Cancel' }, { text: 'Retry', onPress: () => fetchChecklist() }], false);
      return;
    }
    ui.showLoading();
    try {
      const r = await app.api.getEsgChecklist();
      setEsg({ ...r, sections: r.sections ?? [] });
    } catch (e) {
      // The legacy screen stayed empty (and crashed on Proceed); show why instead.
      setEsg({ sections: [] });
      ui.toast(e instanceof Error ? e.message : 'Unknown Error Occurred', { long: true });
    } finally {
      ui.hideLoading();
    }
  }, [app, ui]);

  useEffect(() => {
    fetchChecklist();
  }, [fetchChecklist]);

  useBackHandler(() => {
    ui.alert('Alert', 'Going back will loose the filled data.', [{ text: 'Cancel' }, { text: 'Ok', onPress: () => nav.pop() }]);
    return true;
  });

  const proceed = async () => {
    if (!esg || !app.loginId) return;
    const json = buildEsgJson(esg, answers, app.loginId, type, app.versionName);
    if (!areAllFieldsFilled(json)) {
      ui.alert('Error', 'Please answer to all the questions.', [{ text: 'OK' }], false);
      return;
    }
    if (!(await isNetworkAvailable())) {
      ui.alert('Error', 'Please check the network connection.', [{ text: 'OK' }], false);
      return;
    }
    ui.showLoading();
    let r;
    try {
      r = await app.api.submitEsgChecklist(toSubmitRequest(json));
      if (!isSuccess(r) && r.errorMessage != null) r.errorMessage = `Error occurred while submitting basic info: ${r.errorMessage}`;
    } catch (e) {
      r = { status: '0', errorMessage: e instanceof Error ? e.message : null };
    } finally {
      ui.hideLoading();
    }
    if (isSuccess(r)) {
      const info = certificationDetailsOf(app.user?.MsmeDetails?.msmeStatus, type)?.basicInformation;
      if (info) info.status = Status.SUBMITTED;
      nav.replace('Evidences', { certificationType: type });
      await app.persist();
    } else if (r.errorMessage) {
      ui.toast(r.errorMessage, { long: true });
    }
  };

  const set = (id: string, v: string) => setAnswers(a => ({ ...a, [id]: v }));

  return (
    <ScreenFrame
      title={certificationLabel(type, levelTitle)}
      backBar={{
        zedId: app.user?.MsmeDetails?.ZedId,
        onBack: () =>
          ui.alert('Alert', 'Going back will loose the filled data.', [{ text: 'Cancel' }, { text: 'Ok', onPress: () => nav.pop() }]),
      }}
      testID="esg-checklist">
      <ScrollView keyboardShouldPersistTaps="handled">
        <View style={styles.container}>
          {esg?.sections.map((section, sIndex) => (
            <View key={sIndex}>
              <Text style={[textStyles.subheading, { marginTop: 10, marginBottom: 20 }]}>{section.section_title}</Text>
              {section.fields.map(field =>
                field.type === 'single_choice' ? (
                  // 2026-11-07: the options on one line, and a follow-up question ("If yes, ...") inside the same box,
                  // linked to its question, shown when the answer asks for it.
                  <SingleChoice
                    key={field.id}
                    compact
                    label={field.question}
                    options={field.options ?? []}
                    value={answers[field.id] ?? null}
                    onChange={v => set(field.id, v)}
                    testID={`esg-${field.id}`}>
                    {(field.dependent_fields ?? []).map(dep =>
                      answers[field.id] === dep.selected_option ? <Dependent key={dep.id} field={dep} value={answers[dep.id]} onChange={v => set(dep.id, v)} /> : null,
                    )}
                  </SingleChoice>
                ) : field.type === 'text' ? (
                  <TextFieldBox key={field.id} label={field.question} value={answers[field.id] ?? ''} onChange={v => set(field.id, v)} testID={`esg-${field.id}`} />
                ) : null,
              )}
            </View>
          ))}
          <ZedButton title="Proceed" small onPress={proceed} testID="esg-proceed" />
        </View>
      </ScrollView>
    </ScreenFrame>
  );
}

/** A follow-up question inside its question's box, linked by a teal bar on the left. */
function Dependent({ field, value, onChange }: { field: EsgField; value?: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.linked} testID={`esg-${field.id}-linked`}>
      <FieldLabel label={field.question} />
      {field.type === 'text_box' ? (
        <TextInput value={value ?? ''} onChangeText={onChange} style={styles.edit} multiline placeholder="Type your answer" testID={`esg-${field.id}`} />
      ) : field.type === 'single_choice' ? (
        <SingleChoice compact options={field.options ?? []} value={value ?? null} onChange={onChange} style={styles.innerChoice} testID={`esg-${field.id}`} />
      ) : null}
    </View>
  );
}

/** text_field.xml: label and a plain 50 dp EditText inside the grey box (padding 16, margin 10). */
function TextFieldBox({ label, value, onChange, testID }: { label: string; value: string; onChange: (v: string) => void; testID?: string }) {
  return (
    <FieldBox style={{ margin: 10, padding: 16 }}>
      <FieldLabel label={label} />
      <TextInput value={value} onChangeText={onChange} style={styles.edit} testID={testID} />
    </FieldBox>
  );
}

const styles = StyleSheet.create({
  container: { margin: dimens.padding2, padding: dimens.padding1 },
  // A visible box (2026-11-07: the field had no border and looked like plain text).
  edit: {
    minHeight: 56,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: dimens.textSize,
    color: colors.black,
    borderWidth: 1,
    borderColor: '#9A9A9A',
    borderRadius: 6,
    backgroundColor: colors.white,
    textAlignVertical: 'top',
  },
  linked: { marginTop: dimens.padding3, borderLeftWidth: 3, borderLeftColor: colors.appColor, paddingLeft: dimens.padding3 },
  innerChoice: { margin: 0, padding: 0, borderWidth: 0 },
});
