import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { FormField } from '../../forms/appForms';
import { zedDevice } from '../../native';
import { dimens, colors, textStyles } from '../theme';
import { CheckBoxGroup, FieldBox, FieldLabel, MultiSelectionPicker, OutlinedInput, SelectionPicker, TextField, YesNo } from './Form';

/** Help text of a form field (docs/mobile/APP-FORMS.md `help`), under the control. */
export function FieldHelp({ text }: { text?: string | null }) {
  if (!text) return null;
  return <Text style={styles.help}>{text}</Text>;
}

/** Sub-heading above a field (`heading`). */
export function FieldHeading({ text }: { text?: string | null }) {
  if (!text) return null;
  return <Text style={[textStyles.subheading, styles.heading]}>{text}</Text>;
}

type Props = {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string | null;
  /** Options of `optionsSource` (e.g. `countries`). */
  sourceOptions?: (source: string) => string[];
  label?: string;
  testID?: string;
};

const asText = (v: unknown) => (v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v));
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(', ') : []);

/**
 * A field the Admin added (text, whole number, decimal number, date, yes/no, drop-down, multi-select list, check
 * boxes), with the look of the legacy controls. Values: text as typed, Yes/No, the chosen option(s) (a list for
 * multi-select and check boxes), dates as `yyyy-MM-dd`.
 */
export function CustomFormField({ field, value, onChange, error, sourceOptions, label, testID }: Props) {
  const title = label ?? field.label;
  const options = field.options?.length ? field.options : field.optionsSource && sourceOptions ? sourceOptions(field.optionsSource) : [];
  const id = testID ?? `field-${field.key}`;
  let control: React.ReactNode;
  switch (field.type) {
    case 'number':
    case 'decimal':
      control = (
        <TextField label={title} value={asText(value)} onChange={onChange} numeric={field.type === 'number'} decimal={field.type === 'decimal'} maxLength={field.maxLength} error={error} testID={id} />
      );
      break;
    case 'yesno':
      control = <YesNo label={title} value={typeof value === 'string' ? value : null} onChange={onChange} error={error} testID={id} />;
      break;
    case 'dropdown':
      control = <SelectionPicker label={title} items={options} value={asText(value)} onChange={onChange} error={error} testID={id} />;
      break;
    case 'multiselect':
      control = (
        <MultiSelectionPicker label={title} items={options} value={asList(value).join(', ')} onChange={v => onChange(v ? v.split(', ') : [])} error={error} testID={id} />
      );
      break;
    case 'checkboxes':
      control = <CheckBoxGroup label={title} options={options} value={asList(value)} onChange={onChange} error={error} testID={id} />;
      break;
    case 'date':
      control = (
        <FieldBox testID={`${id}-box`}>
          <FieldLabel label={title} />
          <OutlinedInput
            value={asText(value)}
            error={error}
            testID={id}
            right={<Image source={calendar} style={styles.icon} />}
            onPress={async () => {
              const picked = await zedDevice().pickDate(typeof value === 'string' && value ? value : null);
              if (picked != null) onChange(picked);
            }}
          />
        </FieldBox>
      );
      break;
    default:
      control = <TextField label={title} value={asText(value)} onChange={onChange} maxLength={field.maxLength ?? 4000} error={error} testID={id} autoCapitalize="sentences" />;
  }
  return (
    <View>
      <FieldHeading text={field.heading} />
      {control}
      <FieldHelp text={field.help} />
    </View>
  );
}

// The drop-down arrow of the pickers doubles as the date field's marker.
const calendar = require('../assets/ic_arrow_drop_down_black_18dp.png');

const styles = StyleSheet.create({
  help: { color: colors.labelColor, fontSize: 13, marginTop: -dimens.padding1, marginBottom: dimens.padding1, marginHorizontal: dimens.padding1 },
  heading: { marginTop: dimens.padding2 },
  icon: { width: 24, height: 24 },
});
