import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, dimens, htmlToPlain, RadioButton, shapes, useAppText } from '@zed/shared';
import type { ConsultantOrganisation, ConsultantOrganisationsResponse, PaymentTokenRequest } from '../api';

/** The Admin's text (Admin → Texts → MSME app), the standard wording until it arrives. */
export const CO_QUESTION_KEY = 'app.msme.handholding.payment.coQuestion';
const CO_QUESTION = 'Did any Consultant Organisation assist you?';

export const CO_ANSWER_REQUIRED = 'Please answer whether any Consultant Organisation assisted you.';
export const CO_CHOICE_REQUIRED = 'Please choose the Consultant Organisation that assisted you.';
const LOAD_ERROR = 'The Consultant Organisations could not be loaded.';

/** The unit's answer: not answered yet, No, or Yes with the organisation chosen (null until one is). */
export type CoAnswer = { assisted: 'yes' | 'no' | null; coId: string | null };

export const NO_CO_ANSWER: CoAnswer = { assisted: null, coId: null };

/** Why the answer cannot be sent yet (the server refuses the same), or null. */
export function coAnswerProblem(answer: CoAnswer): string | null {
  if (answer.assisted == null) return CO_ANSWER_REQUIRED;
  if (answer.assisted === 'yes' && !answer.coId) return CO_CHOICE_REQUIRED;
  return null;
}

/** The answer's fields of the handholding payment request (ConsultancyPay/GetToken, SubmitZeroPaymentDetails). */
export function coAnswerFields(answer: CoAnswer): Pick<PaymentTokenRequest, 'AssistedByCo' | 'AssistedCoId'> {
  return answer.assisted === 'yes'
    ? { AssistedByCo: 'Yes', AssistedCoId: answer.coId }
    : { AssistedByCo: answer.assisted === 'no' ? 'No' : null, AssistedCoId: null };
}

/** The organisations matching the search, by name or user id (any case). */
export function filterOrganisations(all: ConsultantOrganisation[], search: string): ConsultantOrganisation[] {
  const q = search.trim().toLowerCase();
  return q ? all.filter(o => o.userName.toLowerCase().includes(q) || o.userId.toLowerCase().includes(q)) : all;
}

/**
 * 2026-11-21 (the product owner's rule): the handholding milestone 1 payment asks "Did any Consultant Organisation assist you?"
 * (required; milestone 1 only). Yes shows a searchable list of the organisations the unit may name (active, purchase order not
 * used up: ConsultancyPay/GetConsultantOrganisations, loaded once, the first time Yes is chosen) and one must be chosen; the
 * paid milestone then goes straight to it, else by round robin (the server). Send {@link coAnswerFields} with the payment request.
 */
export function CoAssistQuestion({
  value,
  onChange,
  load,
}: {
  value: CoAnswer;
  onChange: (answer: CoAnswer) => void;
  /** ConsultancyPay/GetConsultantOrganisations for the unit and level (MsmeApi.getConsultantOrganisations). */
  load: () => Promise<ConsultantOrganisationsResponse>;
}) {
  const question = useAppText(CO_QUESTION_KEY, undefined, CO_QUESTION);
  const [organisations, setOrganisations] = useState<ConsultantOrganisation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const shown = useMemo(() => filterOrganisations(organisations ?? [], search), [organisations, search]);
  const chosen = organisations?.find(o => o.userId === value.coId) ?? null;

  const fetchList = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await load();
      if (r?.status !== '1') throw new Error(r?.errorMessage?.trim() || LOAD_ERROR);
      setOrganisations(r.organisations ?? []);
    } catch (e) {
      setError(e instanceof Error && e.message.trim() ? e.message : LOAD_ERROR);
    } finally {
      setLoading(false);
    }
  };

  const answer = (assisted: 'yes' | 'no') => {
    onChange({ assisted, coId: assisted === 'yes' ? value.coId : null });
    if (assisted === 'yes' && organisations == null && !loading) void fetchList();
  };

  return (
    <View testID="co-question">
      <View style={[shapes.greyOutlineRectangle, styles.question]}>
        <Text style={styles.questionText}>{question?.html ? htmlToPlain(question.html) : CO_QUESTION}</Text>
        <RadioButton label="Yes" selected={value.assisted === 'yes'} onPress={() => answer('yes')} style={{ margin: dimens.padding1 }} testID="co-yes" />
        <RadioButton label="No" selected={value.assisted === 'no'} onPress={() => answer('no')} style={{ margin: dimens.padding1 }} testID="co-no" />
      </View>
      {value.assisted === 'yes' ? (
        <View style={styles.box} testID="co-picker">
          <Text style={styles.label}>Consultant Organisation *</Text>
          <View style={styles.list}>
            <TextInput
              style={styles.search}
              placeholder="Type a name or ID to search"
              placeholderTextColor={colors.labelColor}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
              testID="co-search"
            />
            {loading ? <Text style={styles.note}>Loading the Consultant Organisations…</Text> : null}
            {error ? (
              <Pressable onPress={() => void fetchList()} accessibilityRole="button" testID="co-retry">
                <Text style={styles.error}>{error} Tap to try again.</Text>
              </Pressable>
            ) : null}
            {!loading && !error && organisations && shown.length === 0 ? (
              <Text style={styles.note}>
                {organisations.length === 0 ? 'No Consultant Organisation can be chosen now.' : 'No Consultant Organisation matches the search.'}
              </Text>
            ) : null}
            <ScrollView style={styles.scroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {shown.map(o => (
                <Pressable
                  key={o.userId}
                  onPress={() => onChange({ assisted: 'yes', coId: o.userId })}
                  style={[styles.item, value.coId === o.userId && styles.itemOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: value.coId === o.userId }}
                  testID={`co-${o.userId}`}>
                  <Text style={[styles.name, value.coId === o.userId && styles.nameOn]}>{o.userName}</Text>
                  <Text style={styles.id}>{o.userId}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          <Text style={styles.note} testID="co-chosen">
            {chosen ? `Chosen: ${chosen.userName} (${chosen.userId})` : 'Milestone 1 is allotted to the organisation you choose.'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  question: { marginHorizontal: dimens.padding2, marginBottom: dimens.padding2, padding: dimens.padding2 },
  questionText: { fontWeight: 'bold', color: colors.black, fontSize: dimens.textSize14, marginBottom: dimens.padding1 },
  box: { marginHorizontal: dimens.padding2, marginBottom: dimens.padding2 },
  label: { fontWeight: 'bold', color: colors.black, fontSize: dimens.textSize14, marginBottom: dimens.padding1 },
  list: { borderWidth: 1.5, borderColor: colors.appColorDark, borderRadius: 6, backgroundColor: colors.white, overflow: 'hidden' },
  search: { borderBottomWidth: 1, borderBottomColor: '#e1ecec', paddingHorizontal: dimens.padding2, paddingVertical: dimens.padding1, color: colors.black },
  scroll: { maxHeight: 220 },
  item: { paddingHorizontal: dimens.padding2, paddingVertical: dimens.padding1, borderBottomWidth: 1, borderBottomColor: '#f0f4f4' },
  itemOn: { backgroundColor: '#eef7f8' },
  name: { color: colors.black, fontSize: dimens.textSize14 },
  nameOn: { fontWeight: 'bold', color: colors.appColorDark },
  id: { color: colors.labelColor, fontSize: 12 },
  note: { color: colors.labelColor, fontSize: 12, marginTop: dimens.padding1, paddingHorizontal: dimens.padding1 },
  error: { color: colors.error, fontSize: 12, padding: dimens.padding2 },
});
