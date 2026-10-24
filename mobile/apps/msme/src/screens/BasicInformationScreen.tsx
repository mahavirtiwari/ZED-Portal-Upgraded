import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  CheckBoxGroup,
  CustomFormField,
  DATA_ERROR,
  dimens,
  FieldHelp,
  isFormChangedRefusal,
  isNetworkAvailable,
  isNetworkError,
  isSuccess,
  MultiRow,
  PhotosField,
  REQUIRED,
  ScreenFrame,
  SelectionPicker,
  TextField,
  textStyles,
  useNavigation,
  useRoute,
  useUi,
  YesNo,
  ZedButton,
  type FormDefinition,
  type FormField,
} from '@zed/shared';
import countries from '../assets/countries.json';
import { useMsme } from '../app/context';
import type { MsmeApp } from '../app/MsmeApp';
import { useScreenCapture } from '../components/capture';
import { basicInfoValue, CAPACITY_UNITS, ENERGY_SOURCES, isShown, MSME_BASIC_INFO, stampFormAnswers, validateBasicInformation } from '../forms';
import {
  certificationDetailsOf,
  certificationLabel,
  newBasicInformation,
  normalizeBasicInformation,
  YES,
  type BasicInformation,
  type CertificationType,
  type ProductDetails,
  type RawMaterialDetails,
} from '../models';
import { queueBasicInfo, syncNow } from '../sync/queue';
import { submitBasicInformation } from '../sync/submissions';
import { ProductDialog, RawMaterialDialog } from './RowInfoDialog';

export { CAPACITY_UNITS, ENERGY_SOURCES };

const countryNames = () => (countries as Array<{ name?: string }>).map(c => c.name ?? '').filter(Boolean);

/** The Basic Information form in use (the server's, kept for offline use, else the app's own); re-renders on change. */
function useBasicInfoForm(app: MsmeApp): FormDefinition {
  useSyncExternalStore(
    l => app.forms.subscribe(l),
    () => app.forms.getRevision(),
  );
  return app.forms.get(MSME_BASIC_INFO);
}

/**
 * BasicInformationActivity. New in V4: built from the Admin's form (docs/mobile/APP-FORMS.md): fields, labels, help,
 * order and required come from the definition; standard fields keep their legacy controls; the Admin's own fields
 * are added. The answers are kept in the draft as they are entered (the legacy screen kept them only on Proceed).
 */
export function BasicInformationScreen() {
  const app = useMsme();
  const nav = useNavigation();
  const ui = useUi();
  const type = useRoute<{ certificationType: CertificationType }>().params.certificationType;
  const capturer = useScreenCapture('toast');
  const def = useBasicInfoForm(app);

  // The details' basic information is created on first visit and edited in place, as before.
  const info: BasicInformation | null = useMemo(() => {
    const details = certificationDetailsOf(app.user?.MsmeDetails?.msmeStatus, type);
    if (!details) return null;
    if (details.basicInformation == null) details.basicInformation = newBasicInformation();
    return normalizeBasicInformation(details.basicInformation);
  }, [app.user, type]);

  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [, rerender] = useState(0);
  const [productDialog, setProductDialog] = useState<{ row: ProductDetails | null } | null>(null);
  const [materialDialog, setMaterialDialog] = useState<{ row: RawMaterialDetails | null } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A newer definition is asked for when the screen opens online (the kept one is shown meanwhile).
  useEffect(() => {
    isNetworkAvailable()
      .then(online => (online ? app.forms.refresh(MSME_BASIC_INFO, () => app.api.getFormDefinition(MSME_BASIC_INFO)) : false))
      .catch(() => undefined);
  }, [app]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  if (!info) {
    nav.pop();
    return null;
  }

  /** Changes the draft and keeps it (typing is saved after a short pause). */
  const change = (apply: (b: BasicInformation) => void, key?: string, immediate = false) => {
    apply(info);
    if (key && errors.has(key)) {
      const e = new Map(errors);
      e.delete(key);
      setErrors(e);
    }
    rerender(x => x + 1);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (immediate) app.persist();
    else saveTimer.current = setTimeout(() => app.persist(), 500);
  };
  const setValue = (key: string, v: unknown) => change(b => ((b as unknown as Record<string, unknown>)[key] = v), key);
  const str = (key: string) => {
    const v = basicInfoValue(info, { key, custom: false });
    return typeof v === 'string' ? v : '';
  };

  const onProceed = async () => {
    const e = validateBasicInformation(def, info);
    setErrors(e);
    if (e.size > 0) {
      // The legacy toast; a rule other than "required" says what is wrong.
      const reason = [...e.values()].find(m => m !== REQUIRED);
      ui.toast(reason ?? DATA_ERROR, { long: true });
      return;
    }
    if (info.rawMaterialImported !== YES) info.rawMaterialsList = [];
    stampFormAnswers(def, info);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await app.persist();

    if (await isNetworkAvailable()) {
      ui.showLoading();
      let r;
      try {
        r = await submitBasicInformation(app, type, info);
      } catch (err) {
        // No answer from the server: kept and sent when the connection returns.
        if (isNetworkError(err)) await queueBasicInfo(app, type);
        r = { status: '0', errorMessage: err instanceof Error ? err.message : null };
      } finally {
        ui.hideLoading();
      }
      if (isSuccess(r)) {
        nav.replace('EsgChecklist', { certificationType: type });
        await app.persist();
      } else if (r.errorMessage) {
        ui.toast(r.errorMessage, { long: true });
        // The Admin changed the form since it was loaded: the new one is shown to be filled in again.
        if (isFormChangedRefusal(r.errorMessage)) await app.forms.refresh(MSME_BASIC_INFO, () => app.api.getFormDefinition(MSME_BASIC_INFO));
      }
    } else {
      // Offline: as before the checklist opens; new, the basic information is queued for when the network returns.
      await queueBasicInfo(app, type);
      nav.replace('EsgChecklist', { certificationType: type });
      syncNow(app).catch(() => undefined);
    }
  };

  const renderField = (f: FormField) => {
    if (!isShown(def, info, f)) return null;
    const error = errors.get(f.key);
    const help = <FieldHelp text={f.help} />;
    if (f.custom) {
      return (
        <CustomFormField
          key={f.key}
          field={f}
          value={info.customAnswers?.[f.key]}
          onChange={v => change(b => (b.customAnswers = { ...(b.customAnswers ?? {}), [f.key]: v }), f.key)}
          error={error}
          sourceOptions={src => (src === 'countries' ? countryNames() : [])}
        />
      );
    }
    let control: React.ReactNode;
    switch (f.key) {
      case 'assessorSelfie':
        control = (
          <PhotosField
            label={f.label}
            photos={info.assessorSelfie ? [info.assessorSelfie] : []}
            maxPhotos={f.maxItems ?? 1}
            onChange={list => change(b => (b.assessorSelfie = list[0] ?? null), f.key, true)}
            capturer={capturer}
            store={app.photos}
            testID="selfie"
          />
        );
        break;
      case 'siteExteriorPhotos':
        control = (
          <PhotosField
            label={f.label}
            photos={info.siteExteriorPhotos}
            maxPhotos={f.maxItems ?? 2}
            onChange={list => change(b => (b.siteExteriorPhotos = list), f.key, true)}
            capturer={capturer}
            store={app.photos}
            testID="site-photos"
          />
        );
        break;
      case 'auditsConducted':
      case 'rawMaterialImported':
        control = (
          <YesNo
            label={f.label}
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
            label={f.label}
            rows={info.productDetailsList}
            rowText={p => p.productName ?? 'ProductDetails'}
            onAdd={() => setProductDialog({ row: null })}
            onEdit={row => setProductDialog({ row })}
            onDelete={row => change(b => (b.productDetailsList = b.productDetailsList.filter(p => p.id !== row.id)), f.key, true)}
            testID="products"
          />
        );
        break;
      case 'rawMaterialsList':
        control = (
          <MultiRow
            label={f.label}
            rows={info.rawMaterialsList}
            rowText={m => m.rawMaterialName ?? 'RawMaterialDetails'}
            onAdd={() => setMaterialDialog({ row: null })}
            onEdit={row => setMaterialDialog({ row })}
            onDelete={row => change(b => (b.rawMaterialsList = b.rawMaterialsList.filter(m => m.id !== row.id)), f.key, true)}
            testID="raw-materials"
          />
        );
        break;
      case 'monthlyManufacturingCapacityUnits':
      case 'monthlyUtilizationUnits':
        control = (
          <SelectionPicker
            label={f.label}
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
            label={f.label}
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
            label={f.label}
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
            label={f.label}
            value={str(f.key)}
            onChange={v => setValue(f.key, v)}
            error={error}
            testID={{ domesticCustomers: 'domestic', internationalCustomers: 'international', outsourcedProcesses: 'outsourced' }[f.key]}
          />
        );
        break;
      default:
        // A standard field this build does not know: shown with the control of its type, sent in its property.
        return <CustomFormField key={f.key} field={f} value={basicInfoValue(info, f)} onChange={v => setValue(f.key, v)} error={error} />;
    }
    return (
      <View key={f.key}>
        {control}
        {help}
      </View>
    );
  };

  const columnsOf = (key: string) => def.fields.find(x => x.key === key)?.columns ?? undefined;

  return (
    <ScreenFrame title={certificationLabel(type)} backBar={{ zedId: app.user?.MsmeDetails?.ZedId, onBack: () => nav.pop() }} testID="basic-information">
      <ScrollView keyboardShouldPersistTaps="handled">
        <View style={styles.container}>
          {def.sections.map(section => {
            const fields = def.fields.filter(f => f.section === section.key);
            if (fields.length === 0) return null;
            return (
              <View key={section.key}>
                <Text style={textStyles.subheading}>{section.label}</Text>
                {fields.map(renderField)}
              </View>
            );
          })}
          {/* Fields of a section the definition does not list. */}
          {def.fields.filter(f => !def.sections.some(s => s.key === f.section)).map(renderField)}
          <ZedButton title="Proceed" small onPress={onProceed} testID="basic-proceed" />
        </View>
      </ScrollView>
      {productDialog ? (
        <ProductDialog
          product={productDialog.row}
          columns={columnsOf('productDetailsList')}
          onClose={() => setProductDialog(null)}
          onSubmit={p =>
            // MultiRowHelper.addRow: an existing id is replaced in place, a new one is appended.
            change(
              b => (b.productDetailsList = b.productDetailsList.some(x => x.id === p.id) ? b.productDetailsList.map(x => (x.id === p.id ? p : x)) : [...b.productDetailsList, p]),
              'productDetailsList',
              true,
            )
          }
        />
      ) : null}
      {materialDialog ? (
        <RawMaterialDialog
          material={materialDialog.row}
          columns={columnsOf('rawMaterialsList')}
          onClose={() => setMaterialDialog(null)}
          onSubmit={m =>
            change(
              b => (b.rawMaterialsList = b.rawMaterialsList.some(x => x.id === m.id) ? b.rawMaterialsList.map(x => (x.id === m.id ? m : x)) : [...b.rawMaterialsList, m]),
              'rawMaterialsList',
              true,
            )
          }
        />
      ) : null}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  container: { margin: dimens.padding2, padding: dimens.padding1 },
});
