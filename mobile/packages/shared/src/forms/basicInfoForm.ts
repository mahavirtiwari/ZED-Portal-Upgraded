import {
  customFieldsPayload,
  hiddenStandardKeys,
  isAnswered,
  isFieldShown,
  validateForm,
  valueAtPath,
  type FormDefinition,
  type FormField,
} from './appForms';

/**
 * The legacy Basic Information object of the MSME, site assessor and consultant apps, with the properties the Admin
 * forms add to the draft on the phone (never sent inside `basicInformation`).
 */
export type BasicInfoDraft = {
  assessorSelfie?: unknown;
  customAnswers?: Record<string, unknown> | null;
  customFields?: Record<string, unknown> | null;
  formVersion?: string | null;
  omittedFields?: string[] | null;
  optionalFields?: string[] | null;
};

/** Properties of the draft that are the app's own and never go into `basicInformation`. */
export const LOCAL_FORM_PROPERTIES = ['customAnswers', 'customFields', 'formVersion', 'omittedFields', 'optionalFields'] as const;

/** The answer of a field in the draft: standard fields from their legacy property, custom ones from `customAnswers`. */
export function basicInfoValue(info: BasicInfoDraft, f: Pick<FormField, 'key' | 'custom'>): unknown {
  if (f.custom) return info.customAnswers?.[f.key];
  if (f.key === 'assessorSelfie') return info.assessorSelfie ? [info.assessorSelfie] : [];
  return valueAtPath(info, f.key);
}

const valueOfKey = (def: FormDefinition, info: BasicInfoDraft) => (key: string) => {
  const f = def.fields.find(x => x.key === key);
  return basicInfoValue(info, f ?? { key, custom: key.startsWith('cf_') });
};

export function isBasicInfoFieldShown(def: FormDefinition, info: BasicInfoDraft, f: FormField): boolean {
  return isFieldShown(f, valueOfKey(def, info));
}

/** BasicInformation.isValid, driven by the definition: errors by field key (empty when valid). */
export function validateBasicInformation(def: FormDefinition, info: BasicInfoDraft): Map<string, string> {
  return validateForm(def, f => basicInfoValue(info, f));
}

/** A product or raw-material row against its (shown) columns, as RowInfoFragment checked it. */
export function rowErrors(columns: readonly FormField[], row: Record<string, unknown>): Map<string, string> {
  const errors = new Map<string, string>();
  for (const c of columns) if (c.required && !isAnswered(row[c.key])) errors.set(c.key, 'Required');
  return errors;
}

/**
 * Proceed/Submit: records what the submit must carry with the answers (kept in the draft, so a queued submit sends
 * the same): the definition's version, the shown custom fields' answers, and which standard fields the Admin left
 * out or made optional.
 */
export function stampFormAnswers(def: FormDefinition, info: BasicInfoDraft, standardKeys: readonly string[]): void {
  info.formVersion = def.version;
  info.customFields = customFieldsPayload(def, info.customAnswers ?? {}, valueOfKey(def, info));
  info.omittedFields = hiddenStandardKeys(def, standardKeys);
  info.optionalFields = def.fields.filter(f => !f.custom && !f.required).map(f => f.key);
}

/** Empties the value at a property path (`energyManagement.solar.unit`): null, or an empty list. */
function emptyAtPath(obj: Record<string, unknown>, path: string) {
  const parts = path.split('.');
  let cur: Record<string, unknown> | null = obj;
  for (const part of parts.slice(0, -1)) {
    const next: unknown = cur?.[part];
    if (next == null || typeof next !== 'object') return;
    cur = next as Record<string, unknown>;
  }
  const last = parts[parts.length - 1]!;
  if (cur) cur[last] = Array.isArray(cur[last]) ? [] : null;
}

/**
 * The copy of the draft that goes into `basicInformation`: the app's own properties removed and the standard fields
 * the Admin disabled emptied (null, or an empty list), plus the `customFields`/`formVersion` to send next to it.
 */
export function basicInfoForSubmit<T extends BasicInfoDraft>(info: T): { basicInformation: T; form?: { customFields: Record<string, unknown>; formVersion: string } } {
  const copy = JSON.parse(JSON.stringify(info)) as Record<string, unknown>;
  for (const k of LOCAL_FORM_PROPERTIES) delete copy[k];
  for (const k of info.omittedFields ?? []) emptyAtPath(copy, k);
  return {
    basicInformation: copy as T,
    form: info.formVersion ? { customFields: info.customFields ?? {}, formVersion: info.formVersion } : undefined,
  };
}

/** `numbered: true` (site assessment form): the top-level fields are numbered 1, 2, … in the order given. */
export function numberedLabel(def: FormDefinition, f: FormField): string {
  if (!def.numbered) return f.label;
  const n = def.fields.indexOf(f) + 1;
  return n > 0 ? `${n}. ${f.label}` : f.label;
}
