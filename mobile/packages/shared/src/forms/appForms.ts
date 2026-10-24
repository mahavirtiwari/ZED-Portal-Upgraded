import type { KeyValueStore } from '../db/keyValueStore';
import { REQUIRED } from './validation';

/**
 * New in V4: the apps' Basic Information forms as the Admin set them (Admin → App Forms), from
 * `Forms/Definition?form=<key>` (docs/mobile/APP-FORMS.md). Standard fields keep their legacy controls; the definition
 * changes only labels, help, order, required and whether they are shown. Custom fields (`cf_…`) are sent in
 * `customFields` with `formVersion`.
 */
export type FormFieldType = 'text' | 'number' | 'decimal' | 'date' | 'yesno' | 'dropdown' | 'multiselect' | 'checkboxes' | 'photo' | 'rows';

export type FormField = {
  key: string;
  label: string;
  type: FormFieldType | string;
  required: boolean;
  custom: boolean;
  section: string;
  order: number;
  help?: string | null;
  heading?: string | null;
  options?: string[] | null;
  optionsSource?: string | null;
  separator?: string | null;
  maxItems?: number | null;
  maxLength?: number | null;
  min?: number | null;
  max?: number | null;
  when?: { field: string; equals: string } | null;
  columns?: FormField[] | null;
};

export type FormDefinition = {
  status?: string | null;
  errorMessage?: string | null;
  form: string;
  name: string;
  numbered: boolean;
  sections: Array<{ key: string; label: string }>;
  fields: FormField[];
  version: string;
  updatedOn?: string | null;
};

/** The version sent with the app's built-in form (no server definition yet): never a server version. */
export const BUILT_IN_FORM_VERSION = 'built-in';

/** The end of the server's refusal when the definition changed after the app loaded it. */
export const FORM_CHANGED_NOTE = 'The form was changed on the server';

export function isFormChangedRefusal(message: string | null | undefined): boolean {
  return message != null && message.includes(FORM_CHANGED_NOTE);
}

/** "Not answered": null, blank text, empty list. */
export function isAnswered(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** The value at a property path (`energyManagement.electrical.unit`). */
export function valueAtPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const sameAnswer = (v: unknown, expected: string) =>
  v != null && (Array.isArray(v) ? v.some(x => String(x).toLowerCase() === expected.toLowerCase()) : String(v).trim().toLowerCase() === expected.toLowerCase());

/**
 * `when: { field, equals }`: asked only when that field's answer equals the value (case-insensitive); `rows/column`:
 * when any entry's column has it.
 */
export function isFieldShown(field: FormField, valueOf: (key: string) => unknown): boolean {
  const w = field.when;
  if (!w) return true;
  const slash = w.field.indexOf('/');
  if (slash > 0) {
    const rows = valueOf(w.field.substring(0, slash));
    const column = w.field.substring(slash + 1);
    return Array.isArray(rows) && rows.some(r => sameAnswer(valueAtPath(r, column), w.equals));
  }
  return sameAnswer(valueOf(w.field), w.equals);
}

const WHOLE = /^-?\d{1,18}$/;
const DECIMAL = /^-?\d+(\.\d{1,6})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The rules of one answered value (type, length, range, choices, count), as the server applies them. */
export function checkAnswer(field: FormField, v: unknown): string | null {
  if (!isAnswered(v)) return null;
  const text = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : null;
  switch (field.type) {
    case 'number':
      if (field.custom && (text == null || !WHOLE.test(text))) return `${field.label}: please enter a whole number.`;
      break;
    case 'decimal':
      if (text == null || !DECIMAL.test(text)) return `${field.label}: please enter a number.`;
      break;
    case 'date':
      if (text == null || !DATE.test(text)) return `${field.label}: please enter a date.`;
      break;
    case 'yesno':
      if (text != null && !['yes', 'no'].includes(text.toLowerCase())) return `${field.label}: please answer Yes or No.`;
      break;
    case 'dropdown':
      if (field.options?.length && text != null && !field.options.some(o => o.toLowerCase() === text.toLowerCase()))
        return `${field.label}: "${text}" is not one of the choices.`;
      break;
    default:
      break;
  }
  if (text != null && field.maxLength != null && text.length > field.maxLength) return `${field.label}: at most ${field.maxLength} characters.`;
  if (text != null && (field.type === 'number' || field.type === 'decimal') && text !== '' && !isNaN(Number(text))) {
    const n = Number(text);
    if (field.min != null && n < field.min) return `${field.label}: at least ${field.min}.`;
    if (field.max != null && n > field.max) return `${field.label}: at most ${field.max}.`;
  }
  if (Array.isArray(v) && field.maxItems != null && v.length > field.maxItems) return `${field.label}: at most ${field.maxItems}.`;
  return null;
}

/**
 * Checks the shown fields of a form: required ones answered (rows: at least one entry and every required column of
 * every entry), and every answer against its rules. Errors by field key, in display order; required ones say
 * {@link REQUIRED} (the legacy marker), the others their reason.
 */
export function validateForm(def: FormDefinition, valueOf: (field: FormField) => unknown): Map<string, string> {
  const errors = new Map<string, string>();
  const byKey = (key: string) => {
    const f = def.fields.find(x => x.key === key);
    return f ? valueOf(f) : undefined;
  };
  for (const f of def.fields) {
    if (!isFieldShown(f, byKey)) continue;
    const v = valueOf(f);
    if (f.type === 'rows') {
      const rows = Array.isArray(v) ? (v as unknown[]) : [];
      if (f.required && rows.length === 0) {
        errors.set(f.key, REQUIRED);
        continue;
      }
      if (f.maxItems != null && rows.length > f.maxItems) {
        errors.set(f.key, `${f.label}: at most ${f.maxItems}.`);
        continue;
      }
      const missing = (f.columns ?? []).find(c => c.required && rows.some(r => !isAnswered(valueAtPath(r, c.key))));
      if (missing) errors.set(f.key, `Please fill in ${missing.label} for every entry of ${f.label}.`);
      continue;
    }
    if (f.required && !isAnswered(v)) {
      errors.set(f.key, REQUIRED);
      continue;
    }
    const e = checkAnswer(f, v);
    if (e) errors.set(f.key, e);
  }
  return errors;
}

/** The `customFields` of a submit: every shown custom field, unanswered as null; numbers as JSON numbers. */
export function customFieldsPayload(def: FormDefinition, answers: Record<string, unknown>, valueOf: (key: string) => unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of def.fields) {
    if (!f.custom || !isFieldShown(f, valueOf)) continue;
    const v = answers[f.key];
    if (!isAnswered(v)) {
      out[f.key] = null;
      continue;
    }
    if ((f.type === 'number' || f.type === 'decimal') && typeof v === 'string' && !isNaN(Number(v.trim()))) out[f.key] = Number(v.trim());
    else out[f.key] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

/** The standard fields the definition leaves out (disabled by the Admin): their request property is not sent. */
export function hiddenStandardKeys(def: FormDefinition, standardKeys: readonly string[]): string[] {
  const shown = new Set(def.fields.filter(f => !f.custom).map(f => f.key));
  return standardKeys.filter(k => !shown.has(k));
}

export function fieldByKey(def: FormDefinition, key: string): FormField | undefined {
  return def.fields.find(f => f.key === key);
}

/** Keeps the last definition of each form for offline use; the app's built-in form when there is none. */
export class AppForms {
  private server = new Map<string, FormDefinition>();
  private listeners = new Set<() => void>();
  private revision = 0;

  constructor(
    private readonly store: KeyValueStore | null,
    private readonly builtIn: Readonly<Record<string, FormDefinition>>,
  ) {}

  async load(formKeys: readonly string[]): Promise<void> {
    if (!this.store) return;
    for (const k of formKeys) {
      const d = await this.store.get<FormDefinition>(`forms.${k}`);
      if (d && Array.isArray(d.fields)) this.server.set(k, d);
    }
    this.changed();
  }

  /** The definition to fill in now. */
  get(formKey: string): FormDefinition {
    const d = this.server.get(formKey) ?? this.builtIn[formKey];
    if (!d) throw new Error(`No form ${formKey}`);
    return d;
  }

  /** Whether the definition in use came from the server. */
  isFromServer(formKey: string): boolean {
    return this.server.has(formKey);
  }

  /** Asks the server; a valid answer replaces the kept one. Returns true when the version changed. */
  async refresh(formKey: string, fetchDefinition: () => Promise<FormDefinition>): Promise<boolean> {
    try {
      const d = await fetchDefinition();
      if (d.status !== '1' || !Array.isArray(d.fields) || typeof d.version !== 'string') return false;
      const before = this.server.get(formKey)?.version;
      this.server.set(formKey, d);
      await this.store?.set(`forms.${formKey}`, d);
      if (before !== d.version) {
        this.changed();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getRevision(): number {
    return this.revision;
  }

  private changed() {
    this.revision++;
    for (const l of this.listeners) l();
  }
}
