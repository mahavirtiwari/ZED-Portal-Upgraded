import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { PhotoStore } from '../../db/photoStore';
import type { FormField } from '../../forms/appForms';
import type { Capturer } from '../../photo/usePhotoCapture';
import type { PhotoData } from '../../photo/photoData';
import { colors, dimens } from '../theme';
import { CustomFormField, FieldHelp } from './CustomFormField';
import { FieldLabel } from './Form';
import { PhotosField } from './PhotosField';

type Entry = Record<string, unknown>;

/**
 * 2026-11-16 (new): the Admin's repeating entries ("Add more", Admin → App Forms → Repeating entries): one card per entry
 * with the field's columns (the Admin's own types, and photos captured as the Basic Information photos), Remove, and
 * "+ Add more" up to the field's most entries. The value is the list of entries; a photo column holds its photos.
 */
export function RowsFormField({
  field,
  value,
  onChange,
  error,
  capturer,
  store,
  sourceOptions,
  testID,
}: {
  field: FormField;
  value: unknown;
  onChange: (entries: Entry[]) => void;
  error?: string | null;
  capturer: Capturer;
  store: PhotoStore;
  sourceOptions?: (source: string) => string[];
  testID?: string;
}) {
  const id = testID ?? `field-${field.key}`;
  const entries: Entry[] = Array.isArray(value) ? (value as unknown[]).filter((e): e is Entry => !!e && typeof e === 'object') : [];
  const max = field.maxItems ?? 20;
  const set = (index: number, key: string, v: unknown) => onChange(entries.map((e, i) => (i === index ? { ...e, [key]: v } : e)));
  return (
    <View style={styles.wrap} testID={id}>
      <FieldLabel label={field.required ? `${field.label} *` : field.label} error={error} />
      <FieldHelp text={field.help} />
      {entries.map((e, i) => (
        <View key={i} style={styles.entry} testID={`${id}-entry-${i}`}>
          <View style={styles.head}>
            <Text style={styles.title}>{`${field.label} ${i + 1}`}</Text>
            <Pressable onPress={() => onChange(entries.filter((_, j) => j !== i))} accessibilityRole="button" testID={`${id}-remove-${i}`}>
              <Text style={styles.remove}>Remove</Text>
            </Pressable>
          </View>
          {(field.columns ?? []).map(c =>
            c.type === 'photo' ? (
              <PhotosField
                key={c.key}
                label={c.required ? `${c.label} *` : c.label}
                photos={Array.isArray(e[c.key]) ? (e[c.key] as PhotoData[]) : []}
                maxPhotos={c.maxItems ?? 1}
                onChange={list => set(i, c.key, list)}
                capturer={capturer}
                store={store}
                testID={`${id}-${i}-${c.key}`}
              />
            ) : (
              <CustomFormField
                key={c.key}
                field={c}
                label={c.required ? `${c.label} *` : c.label}
                value={e[c.key]}
                onChange={v => set(i, c.key, v)}
                sourceOptions={sourceOptions}
                testID={`${id}-${i}-${c.key}`}
              />
            ),
          )}
        </View>
      ))}
      {entries.length < max ? (
        <Pressable style={styles.add} onPress={() => onChange([...entries, {}])} accessibilityRole="button" testID={`${id}-add`}>
          <Text style={styles.addText}>+ Add more</Text>
        </Pressable>
      ) : (
        <Text style={styles.note}>{`${max} entries at most.`}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: dimens.padding3 },
  entry: { borderWidth: 1, borderColor: '#dfe9ea', borderRadius: 10, padding: 10, marginTop: 8 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  title: { fontWeight: '700', color: '#23474a' },
  remove: { color: colors.error, fontWeight: '600' },
  add: { marginTop: 8, alignSelf: 'flex-start', borderWidth: 1, borderColor: '#45a5ad', borderRadius: 18, paddingVertical: 6, paddingHorizontal: 14 },
  addText: { color: '#2f7c83', fontWeight: '700' },
  note: { marginTop: 8, color: '#5f6f70' },
});
