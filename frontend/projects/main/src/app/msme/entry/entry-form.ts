import { EntryFile, EntryState, FormDefinition, FormField } from './entry.api';

/** A photo slot of the form: a saved file, or a file chosen on this page. */
export interface PhotoSlot {
  saved?: EntryFile;
  file?: File;
}

export type CellValue = string | string[] | PhotoSlot[] | null;
export type RowValues = Record<string, CellValue>;

/** The whole form: top-level answers, and the rows of each "rows" field. */
export interface FormValues {
  values: Record<string, CellValue>;
  rows: Record<string, RowValues[]>;
}

export const PRODUCTS = 'productDetailsList';
export const RAW_MATERIALS = 'rawMaterialsList';
export const SITE_PHOTOS = 'siteExteriorPhotos';

/** Types answered with several values. */
export const MULTIPLE = ['checkboxes', 'multiselect'];

export const sortedFields = (def: FormDefinition): FormField[] => [...def.fields].sort((a, b) => a.order - b.order);

const text = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const slot = (f: EntryFile | null | undefined): PhotoSlot[] => (f ? [{ saved: f }] : []);

/** A stored answer of the Admin's field: several choices are kept as a JSON array text. */
function customValue(field: FormField, stored: string | null | undefined): CellValue {
  if (!MULTIPLE.includes(field.type)) return stored ?? null;
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** The form filled with what is saved (empty rows to start with when nothing is). */
export function initialValues(state: EntryState): FormValues {
  const values: Record<string, CellValue> = {};
  const saved = state.saved;
  for (const f of state.form.fields) {
    if (f.type === 'rows') continue;
    if (f.custom) values[f.key] = customValue(f, saved.custom[f.key]);
    else if (f.key === SITE_PHOTOS) values[f.key] = saved.siteExteriorPhotos.map((p) => ({ saved: p }));
    else if (f.type === 'photo') values[f.key] = [];
    else if (MULTIPLE.includes(f.type)) values[f.key] = Array.isArray(saved.answers[f.key]) ? (saved.answers[f.key] as string[]) : [];
    else values[f.key] = text(saved.answers[f.key]);
  }
  const products = saved.products.map((p): RowValues => ({
    productName: p.productName,
    exported: p.exported,
    productPhoto: slot(p.productPhoto),
    productDescriptionPhoto: slot(p.productDescriptionPhoto),
  }));
  const raw = saved.rawMaterials.map((m): RowValues => ({
    rawMaterialName: m.rawMaterialName,
    rawMaterialPercentage: m.rawMaterialPercentage,
    countryName: m.countryName ? m.countryName.split(',').map((c) => c.trim()).filter((c) => c) : [],
  }));
  const rows: Record<string, RowValues[]> = {};
  for (const f of state.form.fields.filter((x) => x.type === 'rows')) {
    rows[f.key] = f.key === PRODUCTS ? products : f.key === RAW_MATERIALS ? raw : [];
    if (rows[f.key].length === 0) rows[f.key] = [emptyRow(f)];
  }
  return { values, rows };
}

export function emptyRow(field: FormField): RowValues {
  const row: RowValues = {};
  for (const c of field.columns ?? []) row[c.key] = c.type === 'photo' || MULTIPLE.includes(c.type) ? [] : null;
  return row;
}

/**
 * Whether a field is shown: its condition is met. A condition on a column ("productDetailsList/exported") is met when
 * any row has the answer, as in the app.
 */
export function isShown(field: FormField, form: FormValues): boolean {
  const when = field.when;
  if (!when) return true;
  const [parent, column] = when.field.split('/');
  const same = (v: CellValue | undefined) => typeof v === 'string' && v.trim().toLowerCase() === when.equals.toLowerCase();
  if (column) return (form.rows[parent] ?? []).some((r) => same(r[column]));
  const v = form.values[parent];
  return Array.isArray(v) ? (v as unknown[]).some((x) => typeof x === 'string' && same(x)) : same(v);
}

const isFilled = (v: CellValue | undefined): boolean => (Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && String(v).trim() !== '');

/** The first required answer missing, as "Please fill in: …" (the server checks again). */
export function missing(def: FormDefinition, form: FormValues): string | null {
  for (const f of sortedFields(def)) {
    if (!isShown(f, form)) continue;
    if (f.type === 'rows') {
      const rows = (form.rows[f.key] ?? []).filter((r) => Object.values(r).some(isFilled));
      if (f.required && rows.length === 0) return `Please fill in: ${f.label}.`;
      for (const c of f.columns ?? []) {
        if (c.required && rows.some((r) => !isFilled(r[c.key]))) return `Please fill in ${c.label} for every entry of ${f.label}.`;
      }
    } else if (f.required && !isFilled(form.values[f.key])) {
      return `Please fill in: ${f.label}.`;
    }
  }
  return null;
}

/**
 * The request of POST basic-info: the `data` part and the new files under upload names (f0, f1, ...). Rows left
 * completely empty are not sent; the raw materials only when they are imported.
 */
export function toRequest(def: FormDefinition, form: FormValues, position: { latitude: string; longitude: string } | null): FormData {
  const body = new FormData();
  let n = 0;
  const ref = (slots: CellValue | undefined) => {
    const s = (Array.isArray(slots) ? (slots as PhotoSlot[]) : [])[0];
    if (!s) return null;
    if (s.file) {
      const upload = `f${n++}`;
      body.append(upload, s.file, s.file.name);
      return { upload };
    }
    return s.saved ? { id: s.saved.id } : null;
  };
  const filled = (key: string) => (form.rows[key] ?? []).filter((r) => Object.values(r).some(isFilled));

  const answers: Record<string, CellValue> = {};
  const customFields: Record<string, CellValue> = {};
  for (const f of def.fields) {
    if (f.type === 'rows' || f.type === 'photo') continue;
    const v = isShown(f, form) ? form.values[f.key] ?? null : null;
    if (f.custom) customFields[f.key] = v;
    else answers[f.key] = v;
  }

  const sitePhotos = Array.isArray(form.values[SITE_PHOTOS]) ? (form.values[SITE_PHOTOS] as PhotoSlot[]) : [];
  const data = {
    answers,
    customFields,
    formVersion: def.version,
    products: filled(PRODUCTS).map((r) => ({
      productName: r['productName'],
      exported: r['exported'],
      productPhoto: ref(r['productPhoto']),
      productDescriptionPhoto: ref(r['productDescriptionPhoto']),
    })),
    rawMaterials: form.values['rawMaterialImported'] === 'Yes'
      ? filled(RAW_MATERIALS).map((r) => ({
          rawMaterialName: r['rawMaterialName'],
          rawMaterialPercentage: r['rawMaterialPercentage'],
          countryName: Array.isArray(r['countryName']) ? (r['countryName'] as string[]).join(', ') : r['countryName'],
        }))
      : [],
    siteExteriorPhotos: sitePhotos.map((s) => ref([s])).filter((x) => x),
    latitude: position?.latitude ?? null,
    longitude: position?.longitude ?? null,
  };
  body.append('data', JSON.stringify(data));
  return body;
}
