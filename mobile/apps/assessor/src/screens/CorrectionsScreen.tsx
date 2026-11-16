import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { isNetworkAvailable, useNavigation, useUi, type FormField } from '@zed/shared';
import { useSa } from '../app/context';
import type { FormCorrection } from '../api';
import { Badge, C, Card, EmptyState, HeroHeader, Page, z, ZButton, ZScroll } from '../ui/zed';
import { FormFieldControl } from './BasicInfoScreens';

/** The field of a correction, as the Basic Information form draws it (the Admin's own field: type, choices, help). */
export const fieldOf = (c: FormCorrection): FormField => ({
  key: c.key, label: c.label, type: c.type, required: true, custom: true, section: 'basic', order: 0, help: c.help ?? null, options: c.options ?? null,
});

const keyOf = (c: FormCorrection) => `${c.zedId}|${c.certificationType}|${c.form}|${c.key}`;

/**
 * 2026-11-16 (new): the site assessor's Basic Information answers the assessment agency found Not valid on its review
 * (Admin → App Forms → Validation required on the site assessment form). Each shows the agency's remark and the answer
 * sent, and takes the corrected answer, which the agency checks again. Every unit of the assessor under the agency's
 * review (the assessment's local data is gone after the final submit).
 */
export function CorrectionsScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const [items, setItems] = useState<FormCorrection[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!(await isNetworkAvailable())) {
      ui.toast('Please check your internet connection');
      setItems(prev => prev ?? []);
      return;
    }
    try {
      setItems(await app.formCorrections());
    } catch {
      setItems(prev => prev ?? []);
    }
  }, [app, ui]);

  useEffect(() => {
    load();
  }, [load]);

  const send = async (c: FormCorrection) => {
    const k = keyOf(c);
    const value = answers[k];
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
      setErrors(e => ({ ...e, [k]: 'Please enter the corrected answer.' }));
      return;
    }
    setBusy(k);
    try {
      const refused = await app.submitFormCorrection(c, value);
      if (refused) {
        setErrors(e => ({ ...e, [k]: refused }));
        return;
      }
      ui.toast('Sent. The agency checks the corrected answer again.');
      await load();
    } catch {
      setErrors(e => ({ ...e, [k]: 'The answer could not be sent. Please try again.' }));
    } finally {
      setBusy(null);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Page testID="corrections">
      <HeroHeader title="Corrections from the agency" subtitle="Basic Information" onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={z.screenPad} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[C.primary]} />}>
        {items && items.length === 0 ? (
          <EmptyState icon="check" headline="Nothing to correct" lines={['The agency has not sent back any answer.', 'Pull down to refresh.']} testID="corrections-empty" />
        ) : null}
        {(items ?? []).map(c => {
          const k = keyOf(c);
          return (
            <Card key={k} style={st.card} testID={`correction-${c.key}`}>
              <View style={z.rowBetween}>
                <Text style={z.muted}>{`${c.zedId} · ${c.certificationType}`}</Text>
                <Badge label="Not valid" tone="danger" small />
              </View>
              <Text style={[z.title, { marginTop: 6 }]}>{c.label}</Text>
              {c.remarks ? <Text style={st.remark} testID={`correction-${c.key}-remark`}>{`Agency: ${c.remarks}`}</Text> : null}
              {c.value ? <Text style={z.muted}>{`Answer sent: ${c.value}`}</Text> : null}
              <View style={{ marginTop: 10 }}>
                <FormFieldControl
                  field={fieldOf(c)}
                  label="Corrected answer"
                  value={answers[k]}
                  error={errors[k]}
                  onChange={v => {
                    setAnswers(a => ({ ...a, [k]: v }));
                    setErrors(e => ({ ...e, [k]: null }));
                  }}
                />
              </View>
              <ZButton title="SEND CORRECTION" onPress={() => send(c)} disabled={busy === k} testID={`correction-${c.key}-send`} />
            </Card>
          );
        })}
      </ZScroll>
    </Page>
  );
}

const st = StyleSheet.create({
  card: { marginBottom: 12 },
  remark: { color: C.danger, marginTop: 4, marginBottom: 4 },
});
