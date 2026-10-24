import React, { useEffect, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { COMMENT_LENGTH, NUMERIC_MAX_LENGTH, numericFilter, percentageFilter, REQUIRED } from '../../forms/validation';
import { sharedIcons } from '../sharedIcons';
import { colors, dimens, shapes, textStyles } from '../theme';
import { useUi } from '../UiHost';
import { Icon } from './Icon';

/** The grey outlined box every view helper sits in (grey_outline_rectangle, margin 5, padding 8). */
export function FieldBox({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <View style={[styles.box, style]} testID={testID}>
      {children}
    </View>
  );
}

/** @style/DefaultLabel; an error shows the label's error marker as TextView.setError did. */
export function FieldLabel({ label, error, style }: { label?: string | null; error?: string | null; style?: StyleProp<TextStyle> }) {
  if (!label) return null;
  return (
    <View style={styles.labelRow}>
      <Text style={[textStyles.defaultLabel, styles.labelText, style]}>{label}</Text>
      {error != null ? <ErrorMark text={error} /> : null}
    </View>
  );
}

function ErrorMark({ text }: { text: string }) {
  return (
    <View style={styles.errorMark}>
      <Text style={styles.errorMarkIcon}>!</Text>
      {text ? <Text style={styles.errorMarkText}>{text}</Text> : null}
    </View>
  );
}

/** Material TextInputLayout.OutlinedBox look. */
export function OutlinedInput({
  value,
  onChangeText,
  error,
  multiline,
  keyboardType,
  maxLength,
  editable = true,
  secureTextEntry,
  placeholder,
  autoCapitalize,
  showCounter,
  testID,
  right,
  onPress,
}: {
  value: string;
  onChangeText?: (t: string) => void;
  error?: string | null;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
  editable?: boolean;
  secureTextEntry?: boolean;
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  showCounter?: boolean;
  testID?: string;
  right?: React.ReactNode;
  /** Non-editable picker fields open a dialog on tap. */
  onPress?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const input = (
    <View
      style={[
        styles.outline,
        focused && styles.outlineFocused,
        error != null && styles.outlineError,
        !editable && !onPress && { backgroundColor: colors.lightGrey },
      ]}>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
        keyboardType={keyboardType}
        maxLength={maxLength}
        editable={editable && !onPress}
        secureTextEntry={secureTextEntry}
        placeholder={placeholder}
        placeholderTextColor={colors.labelColor}
        autoCapitalize={autoCapitalize}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        textAlignVertical={multiline ? 'top' : 'center'}
        testID={testID}
        pointerEvents={onPress ? 'none' : 'auto'}
      />
      {right}
    </View>
  );
  return (
    <View>
      {onPress ? (
        <Pressable onPress={onPress} testID={testID ? `${testID}-press` : undefined}>
          {input}
        </Pressable>
      ) : (
        input
      )}
      <View style={styles.helperRow}>
        <Text style={styles.errorText}>{error ?? ''}</Text>
        {showCounter && maxLength ? (
          <Text style={styles.counter}>
            {value.length}/{maxLength}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** TextInputHelper: layout_text_input / numeric_input_layout / multiline_text_input_layout. */
export function TextField({
  label,
  value,
  onChange,
  error,
  numeric,
  percentage,
  multiline,
  disabled,
  testID,
  autoCapitalize,
}: {
  label?: string | null;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  numeric?: boolean;
  /** enablePercentageValidator */
  percentage?: boolean;
  multiline?: boolean;
  disabled?: boolean;
  testID?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return (
    <FieldBox testID={testID ? `${testID}-box` : undefined}>
      <FieldLabel label={label} />
      <OutlinedInput
        value={value}
        onChangeText={t => onChange(percentage ? percentageFilter(value, t) : numeric ? numericFilter(t) : t)}
        error={error}
        multiline={multiline}
        keyboardType={numeric ? 'number-pad' : 'default'}
        maxLength={multiline ? COMMENT_LENGTH : numeric ? NUMERIC_MAX_LENGTH : undefined}
        showCounter={multiline}
        editable={!disabled}
        autoCapitalize={autoCapitalize ?? (multiline ? 'sentences' : 'words')}
        testID={testID}
      />
    </FieldBox>
  );
}

/** AppCompatRadioButton with buttonTint app_color. */
export function RadioButton({
  label,
  selected,
  onPress,
  style,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <Pressable style={[styles.radio, style]} onPress={onPress} testID={testID} accessibilityRole="radio" accessibilityState={{ selected }}>
      <View style={[styles.radioOuter, { borderColor: selected ? colors.appColor : '#757575' }]}>
        {selected ? <View style={styles.radioInner} /> : null}
      </View>
      <Text style={styles.radioLabel}>{label}</Text>
    </Pressable>
  );
}

/** YesNoHelper (layout_yes_no, or layout_yes_no_single_row). */
export function YesNo({
  label,
  value,
  onChange,
  error,
  singleRow,
  testID,
  yesLabel = 'Yes',
  noLabel = 'No',
}: {
  label?: string | null;
  value: string | null;
  onChange: (v: string) => void;
  error?: string | null;
  singleRow?: boolean;
  testID?: string;
  yesLabel?: string;
  noLabel?: string;
}) {
  const options = [yesLabel, noLabel];
  if (singleRow) {
    return (
      <View style={[styles.box, styles.singleRow]} testID={testID}>
        <View style={{ flex: 1 }}>
          <FieldLabel label={label} error={error} style={{ fontWeight: 'normal' }} />
        </View>
        {options.map(o => (
          <RadioButton key={o} label={o} selected={value === o} onPress={() => onChange(o)} style={{ margin: dimens.padding1 }} testID={testID ? `${testID}-${o}` : undefined} />
        ))}
      </View>
    );
  }
  return (
    <FieldBox testID={testID}>
      <FieldLabel label={label} error={error} />
      <View style={[styles.dashed, styles.row]}>
        {options.map(o => (
          <RadioButton key={o} label={o} selected={value === o} onPress={() => onChange(o)} style={{ flex: 1 }} testID={testID ? `${testID}-${o}` : undefined} />
        ))}
      </View>
    </FieldBox>
  );
}

/** A radio group of any options (ESG single_choice_field). */
export function SingleChoice({
  label,
  options,
  value,
  onChange,
  testID,
  style,
}: {
  label?: string | null;
  options: string[];
  value: string | null;
  onChange: (v: string) => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <FieldBox style={[{ margin: 10 }, style]} testID={testID}>
      <FieldLabel label={label} />
      <View style={[styles.dashed, styles.row, { flexWrap: 'wrap' }]}>
        {options.map(o => (
          <RadioButton key={o} label={o} selected={value === o} onPress={() => onChange(o)} style={{ marginRight: 25 }} testID={testID ? `${testID}-${o}` : undefined} />
        ))}
      </View>
    </FieldBox>
  );
}

/** @style/DefaultCheckBox */
export function CheckBox({ label, checked, onChange, testID }: { label: string; checked: boolean; onChange: (c: boolean) => void; testID?: string }) {
  return (
    <Pressable style={styles.checkRow} onPress={() => onChange(!checked)} testID={testID} accessibilityRole="checkbox" accessibilityState={{ checked }}>
      <View style={[styles.checkbox, checked && { backgroundColor: colors.appColor, borderColor: colors.appColor }]}>
        {checked ? <Text style={styles.checkTick}>✓</Text> : null}
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

/** CheckBoxHelper (layout_checkbox_group). */
export function CheckBoxGroup({
  label,
  options,
  value,
  onChange,
  error,
  testID,
}: {
  label?: string | null;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  error?: string | null;
  testID?: string;
}) {
  return (
    <FieldBox testID={testID}>
      <FieldLabel label={label} error={error} />
      <View style={{ padding: dimens.padding1 }}>
        {options.map(o => (
          <CheckBox
            key={o}
            label={o}
            checked={value.includes(o)}
            // Values are kept in the order of the options, as getValue walks the check boxes.
            onChange={c => onChange(options.filter(x => (x === o ? c : value.includes(x))))}
            testID={testID ? `${testID}-${o}` : undefined}
          />
        ))}
      </View>
    </FieldBox>
  );
}

/** SelectionPickerInputHelper: read-only field, "Pick" dialog with the items and OK/Cancel. */
export function SelectionPicker({
  label,
  items,
  value,
  onChange,
  error,
  testID,
}: {
  label?: string | null;
  items: string[];
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  testID?: string;
}) {
  const ui = useUi();
  return (
    <View style={styles.pickerBox} testID={testID ? `${testID}-box` : undefined}>
      <FieldLabel label={label} />
      <OutlinedInput
        value={value}
        error={error}
        testID={testID}
        right={<Image source={dropDown} style={styles.dropDown} />}
        onPress={async () => {
          const i = await ui.pickOne('Pick', items);
          if (i == null) return;
          // prepareFieldValue: OK without a choice keeps the field as it was only if nothing was chosen before.
          if (i >= 0) onChange(items[i]!);
          else if (value === '') onChange('');
        }}
      />
    </View>
  );
}

/** MultiSelectionInputHelper: values joined with ", " in the order they were ticked. */
export function MultiSelectionPicker({
  label,
  items,
  value,
  onChange,
  error,
  testID,
}: {
  label?: string | null;
  items: string[];
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  testID?: string;
}) {
  const ui = useUi();
  const [selected, setSelected] = useState<number[]>(() => {
    const values = value ? value.split(', ') : [];
    return items.map((it, i) => (values.includes(it) ? i : -1)).filter(i => i >= 0);
  });
  return (
    <View style={styles.pickerBox}>
      <FieldLabel label={label} />
      <OutlinedInput
        value={value}
        error={error}
        testID={testID}
        right={<Image source={dropDown} style={styles.dropDown} />}
        onPress={async () => {
          const res = await ui.pickMany('Pick', items, selected);
          if (res == null) return;
          setSelected(res);
          onChange(res.filter(i => i < items.length).map(i => items[i]!).join(', '));
        }}
      />
    </View>
  );
}

/** StaticTextHelper: read-only text, three lines, "VIEW" opens the full text. */
export function StaticText({ label, value, onViewMore }: { label?: string | null; value: string; onViewMore: (text: string) => void }) {
  const [lines, setLines] = useState(0);
  return (
    <FieldBox>
      <FieldLabel label={label} />
      <Text
        style={styles.staticValue}
        numberOfLines={3}
        onTextLayout={e => setLines(e.nativeEvent.lines.length)}>
        {value}
      </Text>
      {/* measure the full height once to know whether it was cut */}
      <Text style={[styles.staticValue, styles.measure]} onTextLayout={e => setLines(e.nativeEvent.lines.length)}>
        {value}
      </Text>
      {lines > 3 ? (
        <Pressable onPress={() => onViewMore(value)} style={styles.viewMore}>
          <Text style={{ color: colors.appColorDark, fontSize: dimens.textSize }}>VIEW</Text>
        </Pressable>
      ) : null}
    </FieldBox>
  );
}

/** MultiRowHelper: numbered rows with edit and delete, and an Add button. */
export function MultiRow<T extends { id: string }>({
  label,
  rows,
  rowText,
  onAdd,
  onEdit,
  onDelete,
  testID,
}: {
  label?: string | null;
  rows: T[];
  rowText: (row: T) => string;
  onAdd: () => void;
  onEdit: (row: T) => void;
  onDelete: (row: T) => void;
  testID?: string;
}) {
  const ui = useUi();
  return (
    <FieldBox testID={testID}>
      <FieldLabel label={label} />
      <View style={[styles.dashed, { padding: dimens.padding1 }]}>
        {rows.map((row, index) => (
          <View key={row.id} style={styles.textRow}>
            <Text style={styles.textRowLabel}>{`${index + 1}. ${rowText(row)}`}</Text>
            <Pressable onPress={() => onEdit(row)} style={styles.iconButton} testID={testID ? `${testID}-edit-${index}` : undefined}>
              <Icon icon={sharedIcons.ic_edit_teal} />
            </Pressable>
            <Pressable
              style={styles.iconButton}
              testID={testID ? `${testID}-delete-${index}` : undefined}
              onPress={() =>
                // Positive "No" and negative "Yes", as the legacy dialog.
                ui.alert('Delete!', 'Are you sure?', [
                  { text: 'Yes', onPress: () => onDelete(row) },
                  { text: 'No' },
                ])
              }>
              <Icon icon={sharedIcons.ic_delete} />
            </Pressable>
          </View>
        ))}
        <ZedIconButton title="Add" icon="add" onPress={onAdd} style={{ margin: dimens.padding2 }} testID={testID ? `${testID}-add` : undefined} />
      </View>
    </FieldBox>
  );
}

/** @style/ZEDButton (MaterialButton: colorPrimary background, white bold 14sp, all caps, padding 16, margin 8). */
export function ZedButton({
  title,
  onPress,
  disabled,
  style,
  textStyle,
  small,
  allCaps = true,
  testID,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  small?: boolean;
  allCaps?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        small && { alignSelf: 'flex-end' },
        disabled && styles.buttonDisabled,
        pressed && !disabled && { opacity: 0.85 },
        style,
      ]}>
      <Text style={[styles.buttonText, disabled && { color: 'rgba(0,0,0,0.38)' }, textStyle]}>{allCaps ? title.toUpperCase() : title}</Text>
    </Pressable>
  );
}

/** @style/ZEDButtonOutlined */
export function OutlinedButton({
  title,
  onPress,
  style,
  color = colors.appColor,
  testID,
}: {
  title: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  color?: string;
  testID?: string;
}) {
  return (
    <Pressable onPress={onPress} testID={testID} style={({ pressed }) => [styles.outlinedButton, pressed && { backgroundColor: colors.appColor3 }, style]}>
      <Text style={[styles.buttonText, { color }]}>{title.toUpperCase()}</Text>
    </Pressable>
  );
}

/** Widget.MaterialComponents.Button.TextButton */
export function TextButton({ title, onPress, style, testID }: { title: string; onPress: () => void; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <Pressable onPress={onPress} testID={testID} style={({ pressed }) => [styles.textButton, pressed && { backgroundColor: colors.appColor3 }, style]}>
      <Text style={[styles.buttonText, { color: colors.appColor }]}>{title.toUpperCase()}</Text>
    </Pressable>
  );
}

/** Widget.MaterialComponents.Button.Icon with ic_baseline_add_24 ("Add" of the photo and row helpers). */
export function ZedIconButton({
  title,
  icon,
  onPress,
  style,
  testID,
}: {
  title: string;
  icon: 'add' | 'sync';
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <Pressable onPress={onPress} testID={testID} style={({ pressed }) => [styles.iconTextButton, pressed && { opacity: 0.85 }, style]}>
      <Icon icon={icon === 'add' ? sharedIcons.ic_baseline_add_24 : sharedIcons.ic_sync_black_24dp} size={18} tint={colors.white} />
      <Text style={[styles.buttonText, { marginLeft: 8 }]}>{title.toUpperCase()}</Text>
    </Pressable>
  );
}

/**
 * BaseDialogFragment: a full-width dialog with a bold title, the close (X) button and the content.
 * `cancelable` false ignores the back button (dialog?.setCancelable(false)).
 */
export function ZedDialog({
  visible,
  title,
  onClose,
  cancelable = true,
  children,
  testID,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  cancelable?: boolean;
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => (cancelable ? onClose() : undefined)}>
      <View style={styles.dialogScrim}>
        <View style={styles.dialogCard} testID={testID}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: dimens.padding3 }}>
            <View style={styles.dialogHeader}>
              <Text style={styles.dialogTitle}>{title}</Text>
              <Pressable onPress={onClose} testID={testID ? `${testID}-close` : 'dialog-close'}>
                <Icon icon={sharedIcons.ic_close_dialog} size={36} />
              </Pressable>
            </View>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** Clears an error marker as soon as the field changes (the legacy markers went away when edited). */
export function useFieldErrors<K extends string>() {
  const [errors, setErrors] = useState<Partial<Record<K, string>>>({});
  const clear = (k: K) => setErrors(e => (e[k] == null ? e : { ...e, [k]: undefined }));
  return { errors, setErrors, clear };
}

export function useDebouncedEffect(effect: () => void, deps: unknown[], ms = 300) {
  useEffect(() => {
    const t = setTimeout(effect, ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export { REQUIRED };

const dropDown = require('../assets/ic_arrow_drop_down_black_18dp.png');

const styles = StyleSheet.create({
  box: { ...shapes.greyOutlineRectangle, margin: dimens.padding1, padding: dimens.padding2 },
  labelRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  labelText: { flexShrink: 1 },
  errorMark: { flexDirection: 'row', alignItems: 'center', marginLeft: 6, marginBottom: dimens.padding1 },
  errorMarkIcon: {
    color: colors.white,
    backgroundColor: colors.error,
    width: 18,
    height: 18,
    borderRadius: 9,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: 'bold',
    lineHeight: 18,
  },
  errorMarkText: { color: colors.error, fontSize: 12, marginLeft: 4 },
  outline: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.38)',
    borderRadius: 4,
    backgroundColor: colors.white,
    minHeight: 56,
  },
  outlineFocused: { borderWidth: 2, borderColor: colors.appColor },
  outlineError: { borderWidth: 2, borderColor: colors.error },
  input: { flex: 1, fontSize: dimens.textSize, color: colors.black, paddingHorizontal: 16, paddingVertical: 12 },
  inputMultiline: { minHeight: 90, maxHeight: 200 },
  helperRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, minHeight: 4 },
  errorText: { color: colors.error, fontSize: 12 },
  counter: { color: 'rgba(0,0,0,0.6)', fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center' },
  singleRow: { flexDirection: 'row', alignItems: 'center', padding: 0, paddingHorizontal: dimens.padding2 },
  dashed: { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.progressBarColor, borderRadius: 5, padding: dimens.padding2 },
  radio: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  radioOuter: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', margin: 6 },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.appColor },
  radioLabel: { fontSize: dimens.textSize, color: colors.black, marginLeft: 4 },
  checkRow: { flexDirection: 'row', alignItems: 'center', padding: dimens.padding1, margin: dimens.padding2 },
  checkbox: { width: 20, height: 20, borderWidth: 2, borderColor: '#757575', borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  checkTick: { color: colors.white, fontSize: 14, lineHeight: 16, fontWeight: 'bold' },
  checkLabel: { color: colors.darkGrey, fontSize: dimens.textSize, marginLeft: 12, flexShrink: 1 },
  pickerBox: { margin: dimens.padding1, padding: dimens.padding1 },
  dropDown: { width: 18, height: 18, marginRight: 12 },
  staticValue: {
    borderColor: colors.progressBarColor,
    borderWidth: 2,
    borderRadius: 5,
    backgroundColor: colors.appColor3,
    padding: dimens.padding1,
    fontSize: dimens.textSize,
    color: colors.black,
  },
  measure: { position: 'absolute', opacity: 0, left: 0, right: 0 },
  viewMore: { alignSelf: 'flex-end', padding: dimens.padding1 },
  textRow: { ...shapes.greyRectangle, flexDirection: 'row', alignItems: 'center', margin: dimens.padding1 },
  textRowLabel: { flex: 1, padding: dimens.padding2, fontSize: dimens.textSize, color: colors.black },
  iconButton: { margin: 5 },
  button: {
    backgroundColor: colors.appColor,
    borderRadius: 4,
    padding: dimens.padding4,
    margin: dimens.padding2,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
  buttonDisabled: { backgroundColor: 'rgba(0,0,0,0.12)', elevation: 0 },
  buttonText: { color: colors.white, fontSize: 14, fontWeight: 'bold', letterSpacing: 1.25, textAlign: 'center' },
  outlinedButton: {
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
    borderRadius: 4,
    padding: dimens.padding4,
    margin: dimens.padding2,
    alignItems: 'center',
  },
  textButton: { paddingHorizontal: 8, paddingVertical: 10, minWidth: 72, alignItems: 'center', borderRadius: 4 },
  iconTextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.appColor,
    borderRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
    margin: dimens.padding1,
    elevation: 2,
  },
  dialogScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.32)', justifyContent: 'center', padding: 16 },
  dialogCard: { backgroundColor: colors.white, borderRadius: 4, maxHeight: '92%', elevation: 24 },
  dialogHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dialogTitle: { fontSize: dimens.textSize3, fontWeight: 'bold', color: colors.black, flex: 1 },
});
