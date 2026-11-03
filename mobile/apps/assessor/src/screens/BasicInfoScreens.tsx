import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  basicInfoValue,
  COMMENT_LENGTH,
  decimalFilter,
  isBasicInfoFieldShown,
  isFormChangedRefusal,
  isNetworkAvailable,
  isSuccess,
  numberedLabel,
  NUMERIC_MAX_LENGTH,
  numericFilter,
  percentageFilter,
  PhotosField,
  REQUIRED,
  rowErrors,
  stampFormAnswers,
  useNavigation,
  useRoute,
  useUi,
  validateBasicInformation,
  valueOrNull,
  zedDevice,
  type FormDefinition,
  type FormField,
} from '@zed/shared';
import countries from '../assets/countries.json';
import { useSa } from '../app/context';
import type { SaApp } from '../app/SaApp';
import { basicInfoSubmitted, submitBasicInformation } from '../flows/submissions';
import { ASSESSOR_BASIC_INFO, BUILT_IN_BASIC_INFO, CAPACITY_UNITS, ENERGY_SOURCES, STANDARD_KEYS } from '../forms';
import { useSaPhotoCapture } from '../photo/capture';
import { DATA_ERROR, newBasicInformation, normalizeBasicInformation, Status, YES, type BasicInformation, type ProductDetails, type RawMaterialDetails } from '../models';
import { C, Card, EmptyState, HeroHeader, Page, ZButton, ZIcon, z } from '../ui/zed';
import { randomUuid } from '../util/uuid';

const countryNames = () => (countries as Array<{ name?: string }>).map(c => c.name ?? '').filter(Boolean);

function useForm(app: SaApp): FormDefinition {
  useSyncExternalStore(
    l => app.forms.subscribe(l),
    () => app.forms.getRevision(),
  );
  return app.forms.get(ASSESSOR_BASIC_INFO);
}

const builtInColumns = (key: string) => BUILT_IN_BASIC_INFO.fields.find(f => f.key === key)!.columns!;

// ------------------------------------------------------------------ the design's form controls
// Each one keeps the behaviour of the @zed/shared control it stands in for (TextField, YesNo, SelectionPicker,
// MultiSelectionPicker, CheckBoxGroup, MultiRow, CustomFormField): the same filters, limits, dialogs and testIDs.

/** Grey full-width band with the section's title in ZED orange. */
function SectionBand({ title, right }: { title: string; right?: string }) {
  return (
    <View style={styles.band}>
      <Text style={styles.bandText}>{title.toUpperCase()}</Text>
      {right ? <Text style={styles.bandRight}>{right}</Text> : null}
    </View>
  );
}

type Base = { label?: string | null; required?: boolean; error?: string | null; help?: string | null; heading?: string | null; testID?: string };

/** Small caps label with the red required star; a field's error shows under its control, its help below. */
function Labelled({ label, required, error, help, heading, children, testID }: Base & { children: React.ReactNode }) {
  return (
    <View style={styles.field} testID={testID}>
      {heading ? <Text style={styles.heading}>{heading}</Text> : null}
      {label ? (
        <Text style={[styles.label, error != null && styles.labelError]}>
          {label.toUpperCase()}
          {required ? <Text style={styles.star}> *</Text> : null}
        </Text>
      ) : null}
      {children}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {help ? <Text style={styles.help}>{help}</Text> : null}
    </View>
  );
}

/** TextField: digits only (numeric), a number (decimal) or 0..100 (percentage); multi-line with a counter. */
function TextBox({
  value,
  onChange,
  numeric,
  decimal,
  percentage,
  maxLength,
  multiline,
  autoCapitalize,
  ...base
}: Base & {
  value: string;
  onChange: (v: string) => void;
  numeric?: boolean;
  decimal?: boolean;
  percentage?: boolean;
  maxLength?: number | null;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  const [focused, setFocused] = useState(false);
  const limit = maxLength ?? (multiline ? COMMENT_LENGTH : numeric ? NUMERIC_MAX_LENGTH : undefined);
  return (
    <Labelled {...base} testID={base.testID ? `${base.testID}-box` : undefined}>
      <View style={[styles.box, focused && styles.boxFocused, base.error != null && styles.boxError]}>
        <TextInput
          style={[styles.input, multiline && styles.inputMulti]}
          value={value}
          onChangeText={t => onChange(percentage ? percentageFilter(value, t) : numeric ? numericFilter(t) : decimal ? decimalFilter(t) : t)}
          multiline={multiline}
          keyboardType={numeric ? 'number-pad' : decimal ? 'decimal-pad' : 'default'}
          maxLength={limit}
          autoCapitalize={autoCapitalize ?? (multiline ? 'sentences' : 'words')}
          placeholderTextColor={C.tMuted}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          testID={base.testID}
        />
      </View>
      {multiline && limit ? <Text style={styles.counter}>{`${value.length}/${limit}`}</Text> : null}
    </Labelled>
  );
}

/** YesNo: two radio cards, the chosen one tinted. */
function RadioPair({ value, onChange, ...base }: Base & { value: string | null; onChange: (v: string) => void }) {
  return (
    <Labelled {...base}>
      <View style={styles.pair}>
        {['Yes', 'No'].map(o => {
          const on = value === o;
          return (
            <Pressable
              key={o}
              style={[styles.radioCard, on && styles.radioCardOn, base.error != null && !on && styles.boxError]}
              onPress={() => onChange(o)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              testID={base.testID ? `${base.testID}-${o}` : undefined}
            >
              <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
              <Text style={[styles.radioText, on && styles.bold]}>{o}</Text>
            </Pressable>
          );
        })}
      </View>
    </Labelled>
  );
}

/** The drop-down look: value (or the placeholder) with a chevron, or a calendar mark for dates; opens the dialog. */
function DropBox({ text, placeholder, onPress, error, calendar, testID }: { text: string; placeholder: string; onPress: () => void; error?: string | null; calendar?: boolean; testID?: string }) {
  return (
    <Pressable style={[styles.box, error != null && styles.boxError]} onPress={onPress} testID={testID ? `${testID}-press` : undefined}>
      {calendar ? (
        <View style={styles.calendar}>
          <ZIcon name="calendar" size={18} color={C.primary} />
        </View>
      ) : null}
      <Text style={[styles.dropText, !text && styles.placeholder]} numberOfLines={2} testID={testID}>
        {text || placeholder}
      </Text>
      {calendar ? null : <ZIcon name="chevron-down" size={18} color={C.tMuted} />}
    </Pressable>
  );
}

/** SelectionPicker: "Pick" dialog with the items and OK/Cancel. */
function Select({ items, value, onChange, ...base }: Base & { items: string[]; value: string; onChange: (v: string) => void }) {
  const ui = useUi();
  return (
    <Labelled {...base} testID={base.testID ? `${base.testID}-box` : undefined}>
      <DropBox
        text={value}
        placeholder="Select"
        error={base.error}
        testID={base.testID}
        onPress={async () => {
          const i = await ui.pickOne('Pick', items);
          if (i == null) return;
          // prepareFieldValue: OK without a choice keeps the field as it was only if nothing was chosen before.
          if (i >= 0) onChange(items[i]!);
          else if (value === '') onChange('');
        }}
      />
    </Labelled>
  );
}

/** MultiSelectionPicker: the chosen values as chips (joined with ", " in the order they were ticked). */
function MultiSelect({ items, value, onChange, ...base }: Base & { items: string[]; value: string; onChange: (v: string) => void }) {
  const ui = useUi();
  const [selected, setSelected] = useState<number[]>(() => {
    const values = value ? value.split(', ') : [];
    return items.map((it, i) => (values.includes(it) ? i : -1)).filter(i => i >= 0);
  });
  const chosen = value ? value.split(', ') : [];
  return (
    <Labelled {...base}>
      {chosen.length ? (
        <View style={styles.chips}>
          {chosen.map(c => (
            <View key={c} style={styles.chip}>
              <Text style={styles.chipText}>{c}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.none}>None selected</Text>
      )}
      <DropBox
        text=""
        placeholder={chosen.length ? '+ Add more' : '+ Add'}
        error={base.error}
        testID={base.testID}
        onPress={async () => {
          const res = await ui.pickMany('Pick', items, selected);
          if (res == null) return;
          setSelected(res);
          onChange(
            res
              .filter(i => i < items.length)
              .map(i => items[i]!)
              .join(', '),
          );
        }}
      />
    </Labelled>
  );
}

/** CheckBoxGroup: values kept in the order of the options. */
function CheckGroup({ options, value, onChange, ...base }: Base & { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <Labelled {...base}>
      <View style={styles.chips}>
        {options.map(o => {
          const checked = value.includes(o);
          return (
            <Pressable
              key={o}
              style={[styles.check, checked && styles.checkOn]}
              onPress={() => onChange(options.filter(x => (x === o ? !checked : value.includes(x))))}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              testID={base.testID ? `${base.testID}-${o}` : undefined}
            >
              <View style={[styles.checkBox, checked && styles.checkBoxOn]}>{checked ? <ZIcon name="check" size={12} color={C.tInverse} strokeWidth={3} /> : null}</View>
              <Text style={[styles.checkText, checked && styles.checkTextOn]}>{o}</Text>
            </Pressable>
          );
        })}
      </View>
    </Labelled>
  );
}

/** MultiRow: the rows (edit / delete) and the outlined "+ Add" pill. */
function RowList<T extends { id: string }>({
  rows,
  rowText,
  addLabel,
  onAdd,
  onEdit,
  onDelete,
  ...base
}: Base & { rows: T[]; rowText: (row: T) => string; addLabel: string; onAdd: () => void; onEdit: (row: T) => void; onDelete: (row: T) => void }) {
  const ui = useUi();
  return (
    <Labelled {...base}>
      {rows.map((row, index) => (
        <View key={row.id} style={styles.rowItem}>
          <View style={styles.rowIndex}>
            <Text style={styles.rowIndexText}>{index + 1}</Text>
          </View>
          <Text style={styles.rowText} numberOfLines={2}>
            {rowText(row)}
          </Text>
          <Pressable onPress={() => onEdit(row)} hitSlop={8} style={styles.rowAction} accessibilityLabel="Edit" testID={base.testID ? `${base.testID}-edit-${index}` : undefined}>
            <ZIcon name="edit" size={18} color={C.primaryDark} />
          </Pressable>
          <Pressable
            style={styles.rowAction}
            hitSlop={8}
            accessibilityLabel="Delete"
            testID={base.testID ? `${base.testID}-delete-${index}` : undefined}
            onPress={() =>
              // Positive "No" and negative "Yes", as the legacy dialog.
              ui.alert('Delete!', 'Are you sure?', [{ text: 'Yes', onPress: () => onDelete(row) }, { text: 'No' }])
            }
          >
            <ZIcon name="close" size={18} color={C.danger} />
          </Pressable>
        </View>
      ))}
      <Pressable style={styles.addPill} onPress={onAdd} testID={base.testID ? `${base.testID}-add` : undefined}>
        <Text style={styles.addPillText}>{`+ ${addLabel}`}</Text>
      </Pressable>
    </Labelled>
  );
}

const asText = (v: unknown) => (v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v));
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(', ') : []);

/**
 * CustomFormField: a field the Admin added (text, whole number, decimal number, date, yes/no, drop-down, multi-select
 * list, check boxes). Values: text as typed, Yes/No, the chosen option(s) (a list for multi-select and check boxes),
 * dates as `yyyy-MM-dd`.
 */
function FormFieldControl({
  field,
  value,
  onChange,
  error,
  sourceOptions,
  label,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string | null;
  sourceOptions?: (source: string) => string[];
  label?: string;
}) {
  const options = field.options?.length ? field.options : field.optionsSource && sourceOptions ? sourceOptions(field.optionsSource) : [];
  const base: Base = { label: label ?? field.label, required: field.required, error, help: field.help, heading: field.heading, testID: `field-${field.key}` };
  switch (field.type) {
    case 'number':
    case 'decimal':
      return <TextBox {...base} value={asText(value)} onChange={onChange} numeric={field.type === 'number'} decimal={field.type === 'decimal'} maxLength={field.maxLength} />;
    case 'yesno':
      return <RadioPair {...base} value={typeof value === 'string' ? value : null} onChange={onChange} />;
    case 'dropdown':
      return <Select {...base} items={options} value={asText(value)} onChange={onChange} />;
    case 'multiselect':
      return <MultiSelect {...base} items={options} value={asList(value).join(', ')} onChange={v => onChange(v ? v.split(', ') : [])} />;
    case 'checkboxes':
      return <CheckGroup {...base} options={options} value={asList(value)} onChange={onChange} />;
    case 'date':
      return (
        <Labelled {...base} testID={`${base.testID}-box`}>
          <DropBox
            text={asText(value)}
            placeholder="Select date"
            calendar
            error={error}
            testID={base.testID}
            onPress={async () => {
              const picked = await zedDevice().pickDate(typeof value === 'string' && value ? value : null);
              if (picked != null) onChange(picked);
            }}
          />
        </Labelled>
      );
    default:
      return <TextBox {...base} value={asText(value)} onChange={onChange} maxLength={field.maxLength ?? 4000} autoCapitalize="sentences" />;
  }
}

/**
 * BasicInformationActivity. New in V4: built from the Admin's form (docs/mobile/APP-FORMS.md `assessor.basicInfo`):
 * labels, help, order, required, disabled fields and the Admin's own fields; standard fields keep their legacy
 * behaviour. A server definition is numbered by position (1, 2, …), as the legacy labels were.
 */
export function BasicInformationScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const def = useForm(app);
  const d = app.details!;
  const info = useMemo(() => {
    if (d.saBasicInformation == null) d.saBasicInformation = newBasicInformation();
    return normalizeBasicInformation(d.saBasicInformation);
  }, [d]);
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [, rerender] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isNetworkAvailable()
      .then(online => (online ? app.forms.refresh(ASSESSOR_BASIC_INFO, () => app.api.getFormDefinition(ASSESSOR_BASIC_INFO)) : false))
      .catch(() => undefined);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [app]);

  const change = (apply: (b: BasicInformation) => void, key?: string, immediate = false) => {
    apply(info);
    if (key && errors.has(key)) {
      const e = new Map(errors);
      e.delete(key);
      setErrors(e);
    }
    rerender(x => x + 1);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (immediate) app.update();
    else saveTimer.current = setTimeout(() => app.update(), 500);
  };
  const setValue = (key: string, v: unknown) => change(b => ((b as unknown as Record<string, unknown>)[key] = v), key);
  const str = (key: string) => {
    const v = basicInfoValue(info, { key, custom: false });
    return typeof v === 'string' ? v : '';
  };

  const onProceed = async (save: boolean) => {
    const e = validateBasicInformation(def, info);
    setErrors(e);
    if (e.size > 0) {
      const reason = [...e.values()].find(m => m !== REQUIRED);
      ui.toast(reason ?? DATA_ERROR);
      return;
    }
    if (info.rawMaterialImported !== YES) info.rawMaterialsList = [];
    stampFormAnswers(def, info, STANDARD_KEYS);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await app.update();
    if (save) {
      info.status = Status.COMPLETED;
      await app.update();
      nav.pop();
      return;
    }
    if (await isNetworkAvailable()) {
      ui.showLoading();
      const r = await submitBasicInformation(app, info);
      ui.hideLoading();
      if (isSuccess(r)) {
        await basicInfoSubmitted(app);
        ui.toast('Data submitted successfully');
        nav.pop();
      } else if (r.errorMessage) {
        ui.toast(r.errorMessage);
        if (isFormChangedRefusal(r.errorMessage)) await app.forms.refresh(ASSESSOR_BASIC_INFO, () => app.api.getFormDefinition(ASSESSOR_BASIC_INFO));
      }
    } else {
      ui.alert(
        'Alert',
        'Network not available, your data will be saved locally.',
        [
          {
            text: 'OK',
            onPress: async () => {
              info.status = Status.COMPLETED;
              await app.update();
              nav.pop();
            },
          },
        ],
        true,
      );
    }
  };

  const columnsOf = (key: string) => def.fields.find(x => x.key === key)?.columns ?? builtInColumns(key);

  const openRow = (type: 'product' | 'raw', rowId: string | null) =>
    nav.push('BasicInfoRow', {
      type,
      rowId,
      columns: columnsOf(type === 'product' ? 'productDetailsList' : 'rawMaterialsList'),
      onSubmit: (row: ProductDetails | RawMaterialDetails) =>
        change(
          b => {
            const list = (type === 'product' ? b.productDetailsList : b.rawMaterialsList) as Array<{ id: string }>;
            const next = list.some(x => x.id === row.id) ? list.map(x => (x.id === row.id ? row : x)) : [...list, row];
            if (type === 'product') b.productDetailsList = next as ProductDetails[];
            else b.rawMaterialsList = next as RawMaterialDetails[];
          },
          type === 'product' ? 'productDetailsList' : 'rawMaterialsList',
          true,
        ),
    });

  const renderField = (f: FormField) => {
    const label = numberedLabel(def, f);
    const error = errors.get(f.key);
    const base: Base = { label, required: f.required, error, help: f.help };
    if (f.custom) {
      return (
        <FormFieldControl
          field={f}
          label={label}
          value={info.customAnswers?.[f.key]}
          onChange={v => change(b => (b.customAnswers = { ...(b.customAnswers ?? {}), [f.key]: v }), f.key)}
          error={error}
          sourceOptions={src => (src === 'countries' ? countryNames() : [])}
        />
      );
    }
    switch (f.key) {
      case 'auditsConducted':
      case 'rawMaterialImported':
        return (
          <RadioPair
            {...base}
            value={info[f.key] ?? null}
            onChange={v => change(b => (b[f.key as 'auditsConducted'] = v), f.key, true)}
            testID={f.key === 'auditsConducted' ? 'audits' : 'raw-imported'}
          />
        );
      case 'productDetailsList':
        return (
          <RowList
            {...base}
            rows={info.productDetailsList}
            rowText={p => p.productName ?? 'ProductDetails'}
            addLabel="Add product"
            onAdd={() => openRow('product', null)}
            onEdit={row => openRow('product', row.id)}
            onDelete={row => change(b => (b.productDetailsList = b.productDetailsList.filter(p => p.id !== row.id)), f.key, true)}
            testID="products"
          />
        );
      case 'rawMaterialsList':
        return (
          <RowList
            {...base}
            rows={info.rawMaterialsList}
            rowText={m => m.rawMaterialName ?? 'RawMaterialDetails'}
            addLabel="Add material"
            onAdd={() => openRow('raw', null)}
            onEdit={row => openRow('raw', row.id)}
            onDelete={row => change(b => (b.rawMaterialsList = b.rawMaterialsList.filter(m => m.id !== row.id)), f.key, true)}
            testID="raw-materials"
          />
        );
      case 'monthlyManufacturingCapacityUnits':
      case 'monthlyUtilizationUnits':
        return (
          <Select
            {...base}
            items={f.options?.length ? f.options : CAPACITY_UNITS}
            value={str(f.key)}
            onChange={v => setValue(f.key, v)}
            testID={f.key === 'monthlyUtilizationUnits' ? 'util-units' : 'capacity-units'}
          />
        );
      case 'monthlyManufacturingCapacityValue':
      case 'monthlyUtilizationValue':
        return <TextBox {...base} value={str(f.key)} onChange={v => setValue(f.key, v)} numeric testID={f.key === 'monthlyUtilizationValue' ? 'util-value' : 'capacity-value'} />;
      case 'energySources':
        return (
          <CheckGroup
            {...base}
            options={f.options?.length ? f.options : ENERGY_SOURCES}
            value={info.energySources}
            onChange={v => change(b => (b.energySources = v), f.key, true)}
            error={error === REQUIRED ? '' : error}
            testID="energy"
          />
        );
      case 'domesticCustomers':
      case 'internationalCustomers':
      case 'outsourcedProcesses':
        return (
          <TextBox
            {...base}
            value={str(f.key)}
            onChange={v => setValue(f.key, v)}
            testID={{ domesticCustomers: 'domestic', internationalCustomers: 'international', outsourcedProcesses: 'outsourced' }[f.key]}
          />
        );
      default:
        return <FormFieldControl field={f} label={label} value={basicInfoValue(info, f)} onChange={v => setValue(f.key, v)} error={error} />;
    }
  };

  // The fields in the form's order, under a band each time the form's section changes.
  const body: React.ReactNode[] = [];
  let section: string | null = null;
  def.fields.forEach(f => {
    if (!isBasicInfoFieldShown(def, info, f)) return;
    if (f.section !== section) {
      section = f.section;
      body.push(<SectionBand key={`band-${f.key}`} title={def.sections.find(s => s.key === f.section)?.label ?? def.name} />);
    }
    body.push(
      <View key={f.key} style={styles.pad}>
        {renderField(f)}
      </View>,
    );
  });

  return (
    <Page testID="basic-information">
      <HeroHeader title="Basic Info" subtitle={app.zedId} onBack={() => nav.pop()} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}>
        {body}
        <View style={[styles.pad, styles.buttons]}>
          <ZButton title="Save Basic Info" onPress={() => onProceed(true)} testID="basic-save" />
          <ZButton title="Submit Basic Info" variant="outline" onPress={() => onProceed(false)} testID="basic-submit" />
        </View>
      </ScrollView>
    </Page>
  );
}

/** RowInfoFragment: the product or raw-material form over the basic information, with its "Submit". */
export function BasicInfoRowScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const { params } = useRoute<{ type: 'product' | 'raw'; rowId: string | null; columns: FormField[]; onSubmit: (row: ProductDetails | RawMaterialDetails) => void }>();
  const capturer = useSaPhotoCapture();
  const info = app.details?.saBasicInformation;
  const columns = params.columns;
  const col = (key: string) => columns.find(c => c.key === key);
  const isProduct = params.type === 'product';

  const [product, setProduct] = useState<ProductDetails>(() => ({ ...(info?.productDetailsList.find(p => p.id === params.rowId) ?? { id: randomUuid() }) }));
  const [material, setMaterial] = useState<RawMaterialDetails>(() => ({ ...(info?.rawMaterialsList.find(m => m.id === params.rowId) ?? { id: randomUuid() }) }));
  const [errors, setErrors] = useState<Map<string, string>>(new Map());

  const submit = () => {
    const row = params.type === 'product' ? { ...product, productName: valueOrNull(product.productName ?? '') } : material;
    const e = rowErrors(columns, row as Record<string, unknown>);
    setErrors(e);
    if (e.size > 0) return ui.snackbar('All the fields are required');
    params.onSubmit(row);
    nav.pop();
  };

  const labelled = (key: string, node: (c: FormField, base: Base) => React.ReactNode) => {
    const c = col(key);
    return c ? <React.Fragment key={key}>{node(c, { label: c.label, required: c.required, error: errors.get(key), help: c.help })}</React.Fragment> : null;
  };

  /** PhotosField (capture, gallery / PDF pick, view, delete) keeps its own control under the design's capture row. */
  const photoField = (c: FormField, base: Base, captured: boolean, photos: React.ReactNode) => (
    <Labelled {...base} label={null}>
      <View style={[styles.photoHead, captured && styles.photoHeadDone]}>
        <View style={styles.photoWell}>
          <ZIcon name={captured ? 'image' : 'camera'} size={20} color={C.primary} />
        </View>
        <View style={styles.photoTexts}>
          <Text style={styles.photoTitle}>
            {c.label}
            {base.required ? <Text style={styles.star}> *</Text> : null}
          </Text>
          <Text style={styles.photoSub}>{captured ? 'Geo-tagged automatically' : 'Tap Add to capture'}</Text>
        </View>
      </View>
      {photos}
    </Labelled>
  );

  return (
    <Page testID="basic-info-row">
      <HeroHeader title="Basic Info" subtitle={app.zedId} onBack={() => nav.pop()} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}>
        <SectionBand title={isProduct ? 'Products / articles details' : 'Raw material / bought-out part'} />
        <View style={styles.pad}>
          {isProduct ? (
            <>
              {labelled('productName', (_c, base) => (
                <TextBox {...base} value={product.productName ?? ''} onChange={v => setProduct(p => ({ ...p, productName: v }))} testID="product-name" />
              ))}
              {labelled('exported', (_c, base) => (
                <RadioPair {...base} value={product.exported ?? null} onChange={v => setProduct(p => ({ ...p, exported: v }))} testID="product-exported" />
              ))}
              {labelled('productPhoto', (c, base) =>
                photoField(
                  c,
                  base,
                  !!product.productPhoto,
                  <PhotosField
                    photos={product.productPhoto ? [product.productPhoto] : []}
                    onChange={list => setProduct(p => ({ ...p, productPhoto: list[0] ?? p.productPhoto }))}
                    capturer={capturer}
                    store={app.photos}
                    testID="product-photo"
                  />,
                ),
              )}
              {labelled('productDescriptionPhoto', (c, base) =>
                photoField(
                  c,
                  base,
                  !!product.productDescriptionPhoto,
                  <PhotosField
                    photos={product.productDescriptionPhoto ? [product.productDescriptionPhoto] : []}
                    onChange={list => setProduct(p => ({ ...p, productDescriptionPhoto: list[0] ?? p.productDescriptionPhoto }))}
                    capturer={capturer}
                    store={app.photos}
                    allowPick
                    testID="product-description-photo"
                  />,
                ),
              )}
            </>
          ) : (
            <>
              {labelled('rawMaterialName', (_c, base) => (
                <TextBox {...base} value={material.rawMaterialName ?? ''} onChange={v => setMaterial(m => ({ ...m, rawMaterialName: valueOrNull(v) ?? v }))} testID="raw-name" />
              ))}
              {labelled('rawMaterialPercentage', (_c, base) => (
                <TextBox {...base} value={material.rawMaterialPercentage ?? ''} onChange={v => setMaterial(m => ({ ...m, rawMaterialPercentage: v }))} numeric percentage testID="raw-percentage" />
              ))}
              {labelled('countryName', (c, base) => (
                <MultiSelect
                  {...base}
                  items={c.options?.length ? c.options : countryNames()}
                  value={material.countryName ?? ''}
                  onChange={v => setMaterial(m => ({ ...m, countryName: v }))}
                  testID="raw-country"
                />
              ))}
            </>
          )}
          <ZButton title={isProduct ? 'Save product' : 'Save material'} onPress={submit} style={styles.rowSubmit} testID="row-submit" />
        </View>
      </ScrollView>
    </Page>
  );
}

/** BasicDetailsDisplayActivity: the basic information the API sent ("Show Company Details"). */
export function BasicDetailsDisplayScreen() {
  const app = useSa();
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const b = app.details?.basicInformation;
  const row = (label: string, value: string | null | undefined, id: string) =>
    value != null && value.trim() !== '' ? (
      <View key={id} style={styles.dRow} testID={`basic-${id}`}>
        <Text style={styles.dLabel}>{label.toUpperCase()}</Text>
        <Text style={styles.dValue}>{value}</Text>
      </View>
    ) : null;
  // The list rows (basic_info_row) show their labels even when a value is empty.
  const always = (label: string, value: string | null | undefined) => (
    <View style={styles.dRow}>
      <Text style={styles.dLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.dValue}>{value ?? ''}</Text>
    </View>
  );
  const products = b?.productDetailsList ?? [];
  const materials = b?.rawMaterialsList ?? [];
  return (
    <Page testID="basic-details">
      <HeroHeader title="Basic Info" subtitle={app.zedId} onBack={() => nav.pop()} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}>
        {b ? (
          <>
            <SectionBand title="Basic information" />
            <View style={styles.pad}>
              <Card>
                {row('Audits Conducted', b.auditsConducted, 'audits')}
                {row('Domestic Customers', b.domesticCustomers, 'domestic')}
                {row('International Customers', b.internationalCustomers, 'international')}
                {row('Raw Material Imported', b.rawMaterialImported, 'raw-imported')}
                {row('Outsourced Processes', b.outsourcedProcesses, 'outsourced')}
                {row('Energy Sources', b.energySources?.length ? b.energySources.join(', ') : null, 'energy')}
              </Card>
            </View>
            <SectionBand title="Products" right={`${products.length}`} />
            <View style={styles.pad}>
              {products.length ? null : <Text style={styles.none}>None added</Text>}
              {products.map((p, i) => (
                <Card key={i}>
                  {always('Name of Product manufactured', p.productName)}
                  {always('Exported', p.exported)}
                </Card>
              ))}
            </View>
            <SectionBand title="Raw Materials" right={`${materials.length}`} />
            <View style={styles.pad}>
              {materials.length ? null : <Text style={styles.none}>None added</Text>}
              {materials.map((m, i) => (
                <Card key={i}>
                  {always('Name of Raw Material', m.rawMaterialName)}
                  {always('% of raw material imported', m.rawMaterialPercentage)}
                  {always('Name of Country', m.countryName)}
                </Card>
              ))}
            </View>
          </>
        ) : (
          <EmptyState icon="document" headline="No basic information yet" lines={["The unit's basic details have not been received."]} />
        )}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 8 },
  pad: { paddingHorizontal: 20 },
  buttons: { gap: 10, marginTop: 12 },
  band: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.muted, height: 36, paddingHorizontal: 20, marginTop: 8, marginBottom: 12 },
  bandText: { fontSize: 11, fontWeight: '700', color: C.primary, letterSpacing: 1 },
  bandRight: { fontSize: 11, fontWeight: '700', color: C.tSecondary },
  field: { marginBottom: 14 },
  heading: { ...z.title, marginBottom: 8 },
  label: { fontSize: 10, fontWeight: '700', color: C.tMuted, letterSpacing: 0.5, marginBottom: 8 },
  labelError: { color: C.danger },
  star: { color: C.danger, fontSize: 12 },
  error: { color: C.danger, fontSize: 12, marginTop: 4 },
  help: { fontSize: 11, color: C.tMuted, marginTop: 4 },
  box: { flexDirection: 'row', alignItems: 'center', minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, paddingHorizontal: 12 },
  boxFocused: { borderColor: C.primary },
  boxError: { borderColor: C.danger },
  input: { flex: 1, fontSize: 13, color: C.tPrimary, paddingVertical: 10 },
  inputMulti: { minHeight: 88, textAlignVertical: 'top' },
  counter: { fontSize: 11, color: C.tMuted, textAlign: 'right', marginTop: 4 },
  pair: { flexDirection: 'row', gap: 8 },
  radioCard: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 42, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, paddingHorizontal: 10 },
  radioCardOn: { backgroundColor: C.primaryBg, borderColor: C.primary },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  radioOn: { borderColor: C.primary },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary },
  radioText: { fontSize: 13, color: C.tPrimary },
  bold: { fontWeight: '700' },
  calendar: { marginRight: 10 },
  dropText: { flex: 1, fontSize: 13, color: C.tPrimary, paddingVertical: 10 },
  placeholder: { color: C.tMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { height: 30, borderRadius: 15, paddingHorizontal: 12, backgroundColor: C.primaryBg, justifyContent: 'center' },
  chipText: { fontSize: 11, fontWeight: '600', color: C.primary },
  none: { fontSize: 11, color: C.tMuted, marginBottom: 8 },
  check: { flexDirection: 'row', alignItems: 'center', minHeight: 34, borderRadius: 17, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, paddingHorizontal: 12 },
  checkOn: { borderColor: C.primary, backgroundColor: C.primaryBg },
  checkBox: { width: 16, height: 16, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  checkBoxOn: { backgroundColor: C.primary, borderColor: C.primary },
  checkText: { fontSize: 12, color: C.tPrimary },
  checkTextOn: { color: C.primaryDark, fontWeight: '700' },
  rowItem: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, paddingHorizontal: 12, marginBottom: 8 },
  rowIndex: { width: 24, height: 24, borderRadius: 12, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  rowIndexText: { fontSize: 11, fontWeight: '700', color: C.primaryDark },
  rowText: { flex: 1, fontSize: 13, color: C.tPrimary },
  rowAction: { padding: 6, marginLeft: 4 },
  addPill: { alignSelf: 'flex-start', height: 36, borderRadius: 18, borderWidth: 1, borderColor: C.primary, backgroundColor: C.surface, paddingHorizontal: 16, justifyContent: 'center', marginTop: 2 },
  addPillText: { fontSize: 12, fontWeight: '700', color: C.primary },
  rowSubmit: { marginTop: 8 },
  photoHead: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: C.primary, backgroundColor: C.surface, padding: 12, marginBottom: 6 },
  photoHeadDone: { backgroundColor: C.primaryBg, borderColor: C.primaryBg },
  photoWell: { width: 36, height: 36, borderRadius: 8, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  photoTexts: { flex: 1 },
  photoTitle: { fontSize: 13, fontWeight: '700', color: C.tPrimary },
  photoSub: { fontSize: 11, color: C.tMuted, marginTop: 2 },
  dRow: { paddingVertical: 6 },
  dLabel: { fontSize: 10, fontWeight: '700', color: C.tMuted, letterSpacing: 0.5 },
  dValue: { fontSize: 14, color: C.tPrimary, marginTop: 2 },
});
