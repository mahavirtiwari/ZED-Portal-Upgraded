import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FieldBox, FieldLabel, Icon, OutlinedInput, TextField, useUi, zedDevice, type PhotoData, type PhotoStore } from '@zed/shared';
import { icons } from '../assets/icons';
import { DialogFrame, SaButton, sa } from './kit';

export const REQUIRED = 'Required';

/** DropdownInputHelper: read-only field ("Select one"), a "Select" list dialog; disabled when `disabled`. */
export function DropdownInput({
  label,
  options,
  value,
  onChange,
  error,
  disabled,
  testID,
}: {
  label: string;
  options: string[];
  value: string | null;
  onChange: (v: string) => void;
  error?: string | null;
  disabled?: boolean;
  testID?: string;
}) {
  const ui = useUi();
  return (
    <FieldBox testID={testID ? `${testID}-box` : undefined}>
      <FieldLabel label={label} />
      <OutlinedInput
        value={value ?? ''}
        placeholder="Select one"
        error={error}
        editable={!disabled}
        testID={testID}
        right={<Text style={styles.arrow}>▾</Text>}
        onPress={
          disabled
            ? undefined
            : async () => {
                const i = await ui.pickItem('Select', options);
                if (i != null && i >= 0) onChange(options[i]!);
              }
        }
      />
    </FieldBox>
  );
}

/** CommentInputFragment: "Enter Here" (multiline, required), ADD, and the close icon. */
function CommentDialog({ initial, onDone }: { initial: string | null; onDone: (text: string | null) => void }) {
  const [text, setText] = useState(initial ?? '');
  const [error, setError] = useState<string | null>(null);
  return (
    <DialogFrame onClose={() => onDone(null)}>
      <View testID="comment-dialog">
        <TextField label="Enter Here" value={text} onChange={t => (setText(t), setError(null))} error={error} multiline testID="comment-input" />
        <SaButton
          title="Add"
          onPress={() => (text.trim() === '' ? setError(REQUIRED) : onDone(text))}
          style={{ alignSelf: 'flex-end' }}
          testID="comment-add"
        />
      </View>
    </DialogFrame>
  );
}

export function promptComment(ui: ReturnType<typeof useUi>, initial: string | null): Promise<string | null> {
  return new Promise(resolve => {
    ui.custom(close => <CommentDialog initial={initial} onDone={t => (close(), resolve(t))} />, () => resolve(null));
  });
}

/**
 * MultiplePointsInputHelper: the points as a list (each with edit and delete when editable) and "ADD COMMENT", which
 * opens the comment dialog. `error` marks the label when a required list is empty.
 */
export function MultiplePointsInput({
  label,
  value,
  onChange,
  readOnly,
  error,
  testID,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  readOnly?: boolean;
  error?: string | null;
  testID?: string;
}) {
  const ui = useUi();
  return (
    <View style={styles.points} testID={testID}>
      <FieldLabel label={label} error={error} />
      {value.map((point, i) => (
        <View key={`${i}-${point}`} style={styles.point}>
          <View style={styles.pointRow}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.pointText} testID={testID ? `${testID}-${i}` : undefined}>
              {point}
            </Text>
          </View>
          {!readOnly ? (
            <View style={styles.pointActions}>
              <Pressable
                style={styles.iconButton}
                onPress={async () => {
                  const t = await promptComment(ui, point);
                  if (t != null) onChange(value.map((p, j) => (j === i ? t : p)));
                }}
                testID={testID ? `${testID}-${i}-edit` : undefined}>
                <Icon icon={icons.ic_baseline_edit_24} size={24} />
              </Pressable>
              <Pressable style={styles.iconButton} onPress={() => onChange(value.filter((_, j) => j !== i))} testID={testID ? `${testID}-${i}-delete` : undefined}>
                <Icon icon={icons.ic_delete_red_24dp} size={24} />
              </Pressable>
            </View>
          ) : null}
        </View>
      ))}
      {!readOnly ? (
        <SaButton
          title="Add Comment"
          style={{ alignSelf: 'flex-end' }}
          onPress={async () => {
            const t = await promptComment(ui, null);
            if (t != null) onChange([...value, t]);
          }}
          testID={testID ? `${testID}-add` : undefined}
        />
      ) : null}
    </View>
  );
}

/** DateInputHelper (yyyy-MM-dd, the picker limited to today on with `allowOnlyFuture`). */
export function DateInput({ label, value, onChange, error, allowOnlyFuture, testID }: { label: string; value: string; onChange: (v: string) => void; error?: string | null; allowOnlyFuture?: boolean; testID?: string }) {
  return (
    <FieldBox testID={testID ? `${testID}-box` : undefined}>
      <FieldLabel label={label} />
      <OutlinedInput
        value={value}
        error={error}
        testID={testID}
        onPress={async () => {
          const picked = await zedDevice().pickDateInRange(value || null, allowOnlyFuture ? Date.now() - 1000 : -1, -1);
          if (picked) onChange(picked);
        }}
      />
    </FieldBox>
  );
}

/** TimeInputHelper: TimePickerDialog, the time in the device's format. */
export function TimeInput({ label, value, onChange, error, testID }: { label: string; value: string; onChange: (v: string) => void; error?: string | null; testID?: string }) {
  const [last, setLast] = useState<{ hour: number; minute: number } | null>(null);
  return (
    <FieldBox testID={testID ? `${testID}-box` : undefined}>
      <FieldLabel label={label} />
      <OutlinedInput
        value={value}
        error={error}
        testID={testID}
        onPress={async () => {
          const picked = await zedDevice().pickTime(last?.hour ?? -1, last?.minute ?? -1);
          if (picked) {
            setLast({ hour: picked.hour, minute: picked.minute });
            onChange(picked.text);
          }
        }}
      />
    </FieldBox>
  );
}

/**
 * PhotosHelper.setValue: photos whose stored copy (photos_table) is gone are dropped, with the legacy snackbar.
 * Returns the photos to show (null while checking).
 */
export function usePresentPhotos<T extends PhotoData>(photos: T[] | null | undefined, store: PhotoStore, onRemoved: (kept: T[]) => void): T[] | null {
  const ui = useUi();
  const [shown, setShown] = useState<T[] | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const list = photos ?? [];
      const kept: T[] = [];
      for (const p of list) if (await store.get(p.photoId)) kept.push(p);
      if (!alive) return;
      if (kept.length !== list.length) {
        onRemoved(kept);
        ui.snackbar('Missing/corrupt images were removed, please capture again');
      }
      setShown(kept);
    })();
    return () => {
      alive = false;
    };
    // Checked once when the screen opens, as setValue did.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return shown;
}

const styles = StyleSheet.create({
  arrow: { color: sa.darkGrey, fontSize: 16, paddingHorizontal: 8 },
  points: { padding: 5 },
  point: { borderColor: sa.reviewStroke, borderWidth: 1, borderRadius: 8, padding: 8, margin: 8 },
  pointRow: { flexDirection: 'row', alignItems: 'flex-start' },
  bullet: { fontSize: 18, color: sa.black },
  pointText: { fontSize: 16, color: sa.black, paddingHorizontal: 8, flex: 1 },
  pointActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  iconButton: { padding: 8 },
});
