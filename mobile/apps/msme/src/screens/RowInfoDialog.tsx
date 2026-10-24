import React, { useMemo, useState } from 'react';
import { ToastAndroid } from 'react-native';
import {
  ENTER_REQUIRED_DATA,
  FieldHelp,
  MultiSelectionPicker,
  PhotosField,
  TextField,
  valueOrNull,
  YesNo,
  ZedButton,
  ZedDialog,
  type FormField,
} from '@zed/shared';
import countries from '../assets/countries.json';
import { useMsme } from '../app/context';
import { randomUuid, useScreenCapture } from '../components/capture';
import { BUILT_IN_BASIC_INFO, rowErrors } from '../forms';
import type { ProductDetails, RawMaterialDetails } from '../models';

const builtInColumns = (key: string) => BUILT_IN_BASIC_INFO.fields.find(f => f.key === key)!.columns!;

/** The column of a row field, if the form shows it. */
const columnOf = (columns: readonly FormField[], key: string) => columns.find(c => c.key === key);

/**
 * RowInfoFragment: adds or edits a product or a raw material of the basic information. The columns (labels, help,
 * required, shown) come from the form definition; standard columns keep their legacy controls.
 */
export function ProductDialog({
  product,
  columns = builtInColumns('productDetailsList'),
  onSubmit,
  onClose,
}: {
  /** The row being edited, or null for "Add". */
  product: ProductDetails | null;
  columns?: readonly FormField[];
  onSubmit: (p: ProductDetails) => void;
  onClose: () => void;
}) {
  const app = useMsme();
  const capturer = useScreenCapture('snackbar');
  const [p, setP] = useState<ProductDetails>(() => (product ? { ...product } : { id: randomUuid() }));
  const [name, setName] = useState(product?.productName ?? '');
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const nameCol = columnOf(columns, 'productName');
  const exportedCol = columnOf(columns, 'exported');
  const photoCol = columnOf(columns, 'productPhoto');
  const descriptionCol = columnOf(columns, 'productDescriptionPhoto');

  const submit = () => {
    const next = { ...p, productName: valueOrNull(name) };
    const e = rowErrors(columns, next);
    setErrors(e);
    if (e.size === 0) {
      onClose();
      onSubmit(next);
    } else {
      ToastAndroid.showWithGravity(ENTER_REQUIRED_DATA, ToastAndroid.SHORT, ToastAndroid.CENTER);
    }
  };

  return (
    <ZedDialog visible title="Add Product" onClose={onClose} testID="product-dialog">
      {nameCol ? (
        <>
          <TextField label={nameCol.label} value={name} onChange={setName} error={errors.get('productName')} testID="product-name" />
          <FieldHelp text={nameCol.help} />
        </>
      ) : null}
      {exportedCol ? (
        <>
          <YesNo label={exportedCol.label} value={p.exported ?? null} onChange={v => setP({ ...p, exported: v })} error={errors.get('exported')} testID="product-exported" />
          <FieldHelp text={exportedCol.help} />
        </>
      ) : null}
      {photoCol ? (
        <>
          <PhotosField
            label={photoCol.label}
            photos={p.productPhoto ? [p.productPhoto] : []}
            onChange={list => setP(x => ({ ...x, productPhoto: list[0] ?? x.productPhoto }))}
            capturer={capturer}
            store={app.photos}
            testID="product-photo"
          />
          <FieldHelp text={photoCol.help} />
        </>
      ) : null}
      {descriptionCol ? (
        <>
          <PhotosField
            label={descriptionCol.label}
            photos={p.productDescriptionPhoto ? [p.productDescriptionPhoto] : []}
            onChange={list => setP(x => ({ ...x, productDescriptionPhoto: list[0] ?? x.productDescriptionPhoto }))}
            capturer={capturer}
            store={app.photos}
            allowPick
            testID="product-description-photo"
          />
          <FieldHelp text={descriptionCol.help} />
        </>
      ) : null}
      <ZedButton title="Submit" small onPress={submit} testID="product-submit" />
    </ZedDialog>
  );
}

export function RawMaterialDialog({
  material,
  columns = builtInColumns('rawMaterialsList'),
  onSubmit,
  onClose,
}: {
  material: RawMaterialDetails | null;
  columns?: readonly FormField[];
  onSubmit: (m: RawMaterialDetails) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(material?.rawMaterialName ?? '');
  const [percentage, setPercentage] = useState(material?.rawMaterialPercentage ?? '');
  const [country, setCountry] = useState(material?.countryName ?? '');
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const countryNames = useMemo(() => (countries as Array<{ name?: string }>).map(c => c.name ?? '').filter(Boolean), []);
  const nameCol = columnOf(columns, 'rawMaterialName');
  const percentageCol = columnOf(columns, 'rawMaterialPercentage');
  const countryCol = columnOf(columns, 'countryName');

  const submit = () => {
    const next: RawMaterialDetails = {
      id: material?.id ?? randomUuid(),
      rawMaterialName: valueOrNull(name),
      rawMaterialPercentage: valueOrNull(percentage),
      countryName: valueOrNull(country),
    };
    const e = rowErrors(columns, next);
    setErrors(e);
    if (e.size === 0) {
      onClose();
      onSubmit(next);
    } else {
      ToastAndroid.showWithGravity(ENTER_REQUIRED_DATA, ToastAndroid.SHORT, ToastAndroid.CENTER);
    }
  };

  return (
    <ZedDialog visible title="Add Raw Material" onClose={onClose} testID="raw-material-dialog">
      {nameCol ? (
        <>
          <TextField label={nameCol.label} value={name} onChange={setName} error={errors.get('rawMaterialName')} testID="raw-name" />
          <FieldHelp text={nameCol.help} />
        </>
      ) : null}
      {percentageCol ? (
        <>
          <TextField label={percentageCol.label} value={percentage} onChange={setPercentage} numeric percentage error={errors.get('rawMaterialPercentage')} testID="raw-percentage" />
          <FieldHelp text={percentageCol.help} />
        </>
      ) : null}
      {countryCol ? (
        <>
          <MultiSelectionPicker
            label={countryCol.label}
            items={countryCol.options?.length ? countryCol.options : countryNames}
            value={country}
            onChange={setCountry}
            error={errors.get('countryName')}
            testID="raw-country"
          />
          <FieldHelp text={countryCol.help} />
        </>
      ) : null}
      <ZedButton title="Submit" small onPress={submit} testID="raw-submit" />
    </ZedDialog>
  );
}
