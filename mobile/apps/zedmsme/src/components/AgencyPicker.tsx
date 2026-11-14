import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, dimens } from '@zed/shared';
import type { FacilitatorAgency } from '../api';

/**
 * 2026-11-14 (approved): the agencies an applicant assisted by a ZED Facilitator may choose (Documents Upload), with a
 * search box; the final submit allots the case straight to the chosen one (Msme/FinalSubmit facilitatorAgencyId).
 */
export function AgencyPicker({
  agencies,
  selected,
  onSelect,
  loading,
  error,
  onRetry,
}: {
  agencies: FacilitatorAgency[] | null;
  selected: string | null;
  onSelect: (userId: string) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [search, setSearch] = useState('');
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (agencies ?? []).filter(a => !q || a.userName.toLowerCase().includes(q) || a.userId.toLowerCase().includes(q));
  }, [agencies, search]);

  return (
    <View style={styles.box} testID="agency-picker">
      <Text style={styles.label}>Assessment agency *</Text>
      <View style={styles.list}>
        <TextInput
          style={styles.search}
          placeholder="Search agencies"
          placeholderTextColor={colors.labelColor}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          testID="agency-search"
        />
        {loading ? <Text style={styles.note}>Loading the agencies…</Text> : null}
        {error ? (
          <Pressable onPress={onRetry} accessibilityRole="button" testID="agency-retry">
            <Text style={styles.error}>{error} Tap to try again.</Text>
          </Pressable>
        ) : null}
        {!loading && !error && agencies && shown.length === 0 ? (
          <Text style={styles.note}>{agencies.length === 0 ? 'No agency can take this application now.' : 'No agency matches the search.'}</Text>
        ) : null}
        <ScrollView style={styles.scroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {shown.map(a => (
            <Pressable
              key={a.userId}
              onPress={() => onSelect(a.userId)}
              style={[styles.item, selected === a.userId && styles.itemOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: selected === a.userId }}
              testID={`agency-${a.userId}`}>
              <Text style={[styles.name, selected === a.userId && styles.nameOn]}>{a.userName}</Text>
              <Text style={styles.id}>{a.userId}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <Text style={styles.note}>Your application goes straight to the agency you choose.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
