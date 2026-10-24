import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  basicInfoValue,
  CheckBoxGroup,
  CustomFormField,
  FieldHelp,
  isBasicInfoFieldShown,
  isFormChangedRefusal,
  isNetworkAvailable,
  isSuccess,
  MultiRow,
  MultiSelectionPicker,
  numberedLabel,
  PhotosField,
  REQUIRED,
  rowErrors,
  SelectionPicker,
  stampFormAnswers,
  TextField,
  useNavigation,
  useRoute,
  useUi,
  validateBasicInformation,
  valueOrNull,
  YesNo,
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
import { SaButton, SaFrame, sa } from '../ui/kit';
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

/**
 * BasicInformationActivity. New in V4: built from the Admin's form (docs/mobile/APP-FORMS.md `assessor.basicInfo`):
 * labels, help, order, required, disabled fields and the Admin's own fields; standard fields keep their legacy
 * controls. A server definition is numbered by position (1, 2, …), as the legacy labels were.
 */
export function BasicInformationScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
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
    if (!isBasicInfoFieldShown(def, info, f)) return null;
    const label = numberedLabel(def, f);
    const error = errors.get(f.key);
    if (f.custom) {
      return (
        <CustomFormField
          key={f.key}
          field={f}
          label={label}
          value={info.customAnswers?.[f.key]}
          onChange={v => change(b => (b.customAnswers = { ...(b.customAnswers ?? {}), [f.key]: v }), f.key)}
          error={error}
          sourceOptions={src => (src === 'countries' ? countryNames() : [])}
        />
      );
    }
    let control: React.ReactNode;
    switch (f.key) {
      case 'auditsConducted':
      case 'rawMaterialImported':
        control = (
          <YesNo
            label={label}
            value={info[f.key] ?? null}
            onChange={v => change(b => (b[f.key as 'auditsConducted'] = v), f.key, true)}
            error={error}
            testID={f.key === 'auditsConducted' ? 'audits' : 'raw-imported'}
          />
        );
        break;
      case 'productDetailsList':
        control = (
          <MultiRow
            label={label}
            rows={info.productDetailsList}
            rowText={p => p.productName ?? 'ProductDetails'}
            onAdd={() => openRow('product', null)}
            onEdit={row => openRow('product', row.id)}
            onDelete={row => change(b => (b.productDetailsList = b.productDetailsList.filter(p => p.id !== row.id)), f.key, true)}
            testID="products"
          />
        );
        break;
      case 'rawMaterialsList':
        control = (
          <MultiRow
            label={label}
            rows={info.rawMaterialsList}
            rowText={m => m.rawMaterialName ?? 'RawMaterialDetails'}
            onAdd={() => openRow('raw', null)}
            onEdit={row => openRow('raw', row.id)}
            onDelete={row => change(b => (b.rawMaterialsList = b.rawMaterialsList.filter(m => m.id !== row.id)), f.key, true)}
            testID="raw-materials"
          />
        );
        break;
      case 'monthlyManufacturingCapacityUnits':
      case 'monthlyUtilizationUnits':
        control = (
          <SelectionPicker
            label={label}
            items={f.options?.length ? f.options : CAPACITY_UNITS}
            value={str(f.key)}
            onChange={v => setValue(f.key, v)}
            error={error}
            testID={f.key === 'monthlyUtilizationUnits' ? 'util-units' : 'capacity-units'}
          />
        );
        break;
      case 'monthlyManufacturingCapacityValue':
      case 'monthlyUtilizationValue':
        control = (
          <TextField
            label={label}
            value={str(f.key)}
            onChange={v => setValue(f.key, v)}
            numeric
            error={error}
            testID={f.key === 'monthlyUtilizationValue' ? 'util-value' : 'capacity-value'}
          />
        );
        break;
      case 'energySources':
        control = (
          <CheckBoxGroup
            label={label}
            options={f.options?.length ? f.options : ENERGY_SOURCES}
            value={info.energySources}
            onChange={v => change(b => (b.energySources = v), f.key, true)}
            error={error === REQUIRED ? '' : error}
            testID="energy"
          />
        );
        break;
      case 'domesticCustomers':
      case 'internationalCustomers':
      case 'outsourcedProcesses':
        control = (
          <TextField
            label={label}
            value={str(f.key)}
            onChange={v => setValue(f.key, v)}
            error={error}
            testID={{ domesticCustomers: 'domestic', internationalCustomers: 'international', outsourcedProcesses: 'outsourced' }[f.key]}
          />
        );
        break;
      default:
        return <CustomFormField key={f.key} field={f} label={label} value={basicInfoValue(info, f)} onChange={v => setValue(f.key, v)} error={error} />;
    }
    return (
      <View key={f.key}>
        {control}
        <FieldHelp text={f.help} />
      </View>
    );
  };

  return (
    <SaFrame title="Basic Information" testID="basic-information">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {def.fields.map(renderField)}
        <View style={styles.buttons}>
          <SaButton title="Submit" onPress={() => onProceed(false)} testID="basic-submit" />
          <SaButton title="Save >" onPress={() => onProceed(true)} testID="basic-save" />
        </View>
      </ScrollView>
    </SaFrame>
  );
}

/** RowInfoFragment: the product or raw-material form over the basic information, with its "Submit". */
export function BasicInfoRowScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const { params } = useRoute<{ type: 'product' | 'raw'; rowId: string | null; columns: FormField[]; onSubmit: (row: ProductDetails | RawMaterialDetails) => void }>();
  const capturer = useSaPhotoCapture();
  const info = app.details?.saBasicInformation;
  const columns = params.columns;
  const col = (key: string) => columns.find(c => c.key === key);

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

  const labelled = (key: string, node: (c: FormField) => React.ReactNode) => {
    const c = col(key);
    return c ? (
      <View key={key}>
        {node(c)}
        <FieldHelp text={c.help} />
      </View>
    ) : null;
  };

  return (
    <SaFrame title="Basic Information" testID="basic-info-row">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {params.type === 'product' ? (
          <>
            {labelled('productName', c => (
              <TextField label={c.label} value={product.productName ?? ''} onChange={v => setProduct(p => ({ ...p, productName: v }))} error={errors.get('productName')} testID="product-name" />
            ))}
            {labelled('exported', c => (
              <YesNo label={c.label} value={product.exported ?? null} onChange={v => setProduct(p => ({ ...p, exported: v }))} error={errors.get('exported')} testID="product-exported" />
            ))}
            {labelled('productPhoto', c => (
              <PhotosField
                label={c.label}
                photos={product.productPhoto ? [product.productPhoto] : []}
                onChange={list => setProduct(p => ({ ...p, productPhoto: list[0] ?? p.productPhoto }))}
                capturer={capturer}
                store={app.photos}
                testID="product-photo"
              />
            ))}
            {labelled('productDescriptionPhoto', c => (
              <PhotosField
                label={c.label}
                photos={product.productDescriptionPhoto ? [product.productDescriptionPhoto] : []}
                onChange={list => setProduct(p => ({ ...p, productDescriptionPhoto: list[0] ?? p.productDescriptionPhoto }))}
                capturer={capturer}
                store={app.photos}
                allowPick
                testID="product-description-photo"
              />
            ))}
          </>
        ) : (
          <>
            {labelled('rawMaterialName', c => (
              <TextField label={c.label} value={material.rawMaterialName ?? ''} onChange={v => setMaterial(m => ({ ...m, rawMaterialName: valueOrNull(v) ?? v }))} error={errors.get('rawMaterialName')} testID="raw-name" />
            ))}
            {labelled('rawMaterialPercentage', c => (
              <TextField
                label={c.label}
                value={material.rawMaterialPercentage ?? ''}
                onChange={v => setMaterial(m => ({ ...m, rawMaterialPercentage: v }))}
                numeric
                percentage
                error={errors.get('rawMaterialPercentage')}
                testID="raw-percentage"
              />
            ))}
            {labelled('countryName', c => (
              <MultiSelectionPicker
                label={c.label}
                items={c.options?.length ? c.options : countryNames()}
                value={material.countryName ?? ''}
                onChange={v => setMaterial(m => ({ ...m, countryName: v }))}
                error={errors.get('countryName')}
                testID="raw-country"
              />
            ))}
          </>
        )}
        <SaButton title="Submit" large onPress={submit} testID="row-submit" />
      </ScrollView>
    </SaFrame>
  );
}

/** BasicDetailsDisplayActivity: the basic information the API sent ("Show Company Details"). */
export function BasicDetailsDisplayScreen() {
  const app = useSa();
  const b = app.details?.basicInformation;
  const row = (label: string, value: string | null | undefined, id: string) =>
    value != null && value.trim() !== '' ? (
      <View key={id} style={styles.dRow} testID={`basic-${id}`}>
        <Text style={styles.dLabel}>{label}</Text>
        <Text style={styles.dValue}>{value}</Text>
      </View>
    ) : null;
  // The list rows (basic_info_row) show their labels even when a value is empty.
  const always = (label: string, value: string | null | undefined) => (
    <View style={styles.dRow}>
      <Text style={styles.dLabel}>{label}</Text>
      <Text style={styles.dValue}>{value ?? ''}</Text>
    </View>
  );
  return (
    <SaFrame title="Basic Information" testID="basic-details">
      <ScrollView contentContainerStyle={styles.content}>
        {b ? (
          <>
            {row('Audits Conducted', b.auditsConducted, 'audits')}
            {row('Domestic Customers', b.domesticCustomers, 'domestic')}
            {row('International Customers', b.internationalCustomers, 'international')}
            {row('Raw Material Imported', b.rawMaterialImported, 'raw-imported')}
            {row('Outsourced Processes', b.outsourcedProcesses, 'outsourced')}
            {row('Energy Sources', b.energySources?.length ? b.energySources.join(', ') : null, 'energy')}
            <Text style={styles.dHeader}>Products</Text>
            {(b.productDetailsList ?? []).map((p, i) => (
              <View key={i} style={styles.dItem}>
                {always('Name of Product manufactured', p.productName)}
                {always('Exported', p.exported)}
              </View>
            ))}
            <Text style={styles.dHeader}>Raw Materials</Text>
            {(b.rawMaterialsList ?? []).map((m, i) => (
              <View key={i} style={styles.dItem}>
                {always('Name of Raw Material', m.rawMaterialName)}
                {always('% of raw material imported', m.rawMaterialPercentage)}
                {always('Name of Country', m.countryName)}
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </SaFrame>
  );
}

const styles = StyleSheet.create({
  content: { padding: 12, paddingBottom: 24 },
  buttons: { flexDirection: 'row', justifyContent: 'center' },
  dRow: { paddingVertical: 4 },
  dLabel: { color: sa.coolGrey, fontSize: 15 },
  dValue: { color: sa.darkGrey, fontSize: 15 },
  dHeader: { color: sa.darkGrey, fontSize: 16, fontWeight: 'bold', marginTop: 12, marginBottom: 4 },
  dItem: { borderBottomColor: sa.divider, borderBottomWidth: 1, paddingVertical: 4 },
});
