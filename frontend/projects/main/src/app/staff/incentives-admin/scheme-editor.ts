import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { TextPipe, t } from '../../content/page-text';
import { FieldDialogComponent } from './field-dialog';
import {
  ActivationMode, CARD_ICONS, DocumentRule, FormField, FormSection, GradingMode, LevelOption, SCHEME_LIMITS, SchemeDefinition, SchemesAdminApi,
  VerificationFlow, fieldTypeLabel, gradeKeyLabel, keyFrom,
} from './schemes-admin.api';

export type EditorTab = 'card' | 'grading' | 'form' | 'verification';

interface FieldEdit { section: FormSection; index: number; field: FormField; isNew: boolean; taken: string[]; copies: { value: string; label: string }[] }

/** A definition as the editor works on it: every list and part present (older JSON may leave some out). */
export function normalise(d: SchemeDefinition): SchemeDefinition {
  return {
    ...d,
    card: { title: '', icon: 'star', ...(d.card as Partial<SchemeDefinition['card']> | undefined) },
    activation: { mode: d.activation?.mode ?? 'Levels', levels: [...(d.activation?.levels ?? [])] },
    grading: { mode: d.grading?.mode ?? 'Level', rows: (d.grading?.rows ?? []).map((r) => ({ ...r })) },
    form: {
      blocks: { disclaimer: true, instructions: true, unitConfirm: true, bankAccount: true, declaration: true, ...(d.form?.blocks as Partial<SchemeDefinition['form']['blocks']> | undefined) },
      sections: (d.form?.sections ?? []).map((s) => ({
        ...s,
        pick: s.pick ? { ...s.pick, options: [...(s.pick.options ?? [])] } : null,
        fields: (s.fields ?? []).map((f) => ({ ...f, options: [...(f.options ?? [])] })),
      })),
      rules: (d.form?.rules ?? []).map((r) => ({ ...r, fields: [...(r.fields ?? [])] })),
    },
    verification: { flow: 'Desktop', correctionRounds: 2, correctionDays: 30, autoAllot: true, ...(d.verification as Partial<SchemeDefinition['verification']> | undefined) },
  };
}

/**
 * Admin → Incentive Schemes → a scheme (2026-11-20, approved design): (1) its card and when it opens (Registration, Handholding
 * or certification levels), (2) the grading (share % and maximum per level or per enterprise size), (3) the applicant's form
 * (standard blocks, sections, "Add more" sections with a pick list, fields, document rules), (4) the verification (desktop, or
 * desktop + onsite in phase 2; correction rounds and days; automatic allotment). Save sends the whole definition; the server
 * checks it and its message is shown.
 */
@Component({
  selector: 'zed-staff-scheme-editor',
  imports: [FormsModule, RouterLink, TextPipe, FieldDialogComponent],
  templateUrl: './scheme-editor.html',
  styleUrl: './scheme-editor.scss',
})
export class SchemeEditorPage {
  private readonly api = inject(SchemesAdminApi);
  private readonly code = inject(ActivatedRoute).snapshot.paramMap.get('code') ?? '';

  protected readonly icons = CARD_ICONS;
  protected readonly limits = SCHEME_LIMITS;
  protected readonly tabs: EditorTab[] = ['card', 'grading', 'form', 'verification'];
  protected readonly def = signal<SchemeDefinition | null>(null);
  protected readonly levels = signal<LevelOption[]>([]);
  protected readonly sizes = signal<string[]>([]);
  protected readonly tab = signal<EditorTab>('card');
  protected readonly sectionIndex = signal(0);
  protected readonly fieldEdit = signal<FieldEdit | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  /** Sections and fields added since the last save: their key can still change (answers are stored by key). */
  private fresh = new WeakSet<object>();

  constructor() {
    void this.load();
  }

  protected tabLabel(tab: EditorTab): string {
    switch (tab) {
      case 'card': return t('staff.incentivesAdmin.editor.tab.card', 'Card and activation');
      case 'grading': return t('staff.incentivesAdmin.editor.tab.grading', 'Grading');
      case 'form': return t('staff.incentivesAdmin.editor.tab.form', 'Form');
      case 'verification': return t('staff.incentivesAdmin.editor.tab.verification', 'Verification');
    }
  }

  protected isFresh(x: object): boolean {
    return this.fresh.has(x);
  }

  // ----- Card and activation -----

  protected hasLevel(d: SchemeDefinition, code: string): boolean {
    return d.activation.mode === 'Levels' && d.activation.levels.some((l) => l.toLowerCase() === code.toLowerCase());
  }

  protected setMode(d: SchemeDefinition, mode: ActivationMode): void {
    d.activation = { mode, levels: mode === 'Levels' ? d.activation.levels : [] };
    this.fitGrading(d);
  }

  protected toggleLevel(d: SchemeDefinition, code: string): void {
    const levels = d.activation.mode === 'Levels' ? d.activation.levels : [];
    d.activation = {
      mode: 'Levels',
      levels: levels.some((l) => l.toLowerCase() === code.toLowerCase()) ? levels.filter((l) => l.toLowerCase() !== code.toLowerCase()) : [...levels, code],
    };
  }

  // ----- Grading -----

  /** The rows the grading may have: the activation's levels (or Registration / Handholding) and All, or the sizes. */
  protected gradeKeys(d: SchemeDefinition): string[] {
    if (d.grading.mode === 'Size') return this.sizes();
    if (d.activation.mode !== 'Levels') return [d.activation.mode, 'All'];
    return [...d.activation.levels, 'All'];
  }

  protected freeKeys(d: SchemeDefinition, current?: string): string[] {
    return this.gradeKeys(d).filter((k) => k === current || !d.grading.rows.some((r) => r.key === k));
  }

  protected keyLabel(key: string): string {
    return gradeKeyLabel(key, this.levels());
  }

  protected setGradingMode(d: SchemeDefinition, mode: GradingMode): void {
    d.grading.mode = mode;
    this.fitGrading(d);
  }

  protected addGrade(d: SchemeDefinition): void {
    const key = this.freeKeys(d)[0];
    if (key) d.grading.rows = [...d.grading.rows, { key, sharePercent: d.grading.rows[0]?.sharePercent ?? 0, maxAmount: d.grading.rows[0]?.maxAmount ?? 0 }];
  }

  protected removeGrade(d: SchemeDefinition, i: number): void {
    d.grading.rows = d.grading.rows.filter((_, n) => n !== i);
  }

  /** Keeps the rows that still fit the mode and activation; one row when none does. */
  private fitGrading(d: SchemeDefinition): void {
    const keys = this.gradeKeys(d);
    const kept = d.grading.rows.filter((r) => keys.includes(r.key));
    if (!kept.length && keys.length) kept.push({ key: keys[0], sharePercent: d.grading.rows[0]?.sharePercent ?? 0, maxAmount: d.grading.rows[0]?.maxAmount ?? 0 });
    d.grading.rows = kept;
  }

  // ----- Form: sections -----

  protected section(d: SchemeDefinition): FormSection | null {
    return d.form.sections[this.sectionIndex()] ?? null;
  }

  protected addSection(d: SchemeDefinition, repeating: boolean): void {
    if (d.form.sections.length >= SCHEME_LIMITS.sections) return;
    const title = repeating ? t('staff.incentivesAdmin.editor.section.newRepeating', 'Items') : t('staff.incentivesAdmin.editor.section.newPlain', 'New section');
    const s: FormSection = {
      key: keyFrom(title, d.form.sections.map((x) => x.key)), title, help: null, repeating,
      minItems: 1, maxItems: repeating ? 10 : 1, pick: null, fields: [],
    };
    this.fresh.add(s);
    d.form.sections = [...d.form.sections, s];
    this.sectionIndex.set(d.form.sections.length - 1);
  }

  protected moveSection(d: SchemeDefinition, i: number, by: -1 | 1): void {
    const list = [...d.form.sections];
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    d.form.sections = list;
    if (this.sectionIndex() === i) this.sectionIndex.set(j);
    else if (this.sectionIndex() === j) this.sectionIndex.set(i);
  }

  protected deleteSection(d: SchemeDefinition, i: number): void {
    const gone = new Set(d.form.sections[i].fields.map((f) => f.key));
    d.form.sections = d.form.sections.filter((_, n) => n !== i);
    this.dropFromRules(d, gone);
    this.sectionIndex.set(Math.max(0, Math.min(this.sectionIndex(), d.form.sections.length - 1)));
  }

  protected titleChanged(d: SchemeDefinition, s: FormSection): void {
    if (this.fresh.has(s)) s.key = keyFrom(s.title, d.form.sections.filter((x) => x !== s).map((x) => x.key));
  }

  protected setRepeating(s: FormSection, repeating: boolean): void {
    s.repeating = repeating;
    if (repeating) {
      s.maxItems = Math.max(s.maxItems, 2);
    } else {
      s.minItems = 1;
      s.maxItems = 1;
      s.pick = null;
    }
  }

  protected pickKind(s: FormSection): string {
    return s.pick?.kind ?? '';
  }

  protected setPick(s: FormSection, kind: string): void {
    if (!kind) s.pick = null;
    else if (kind === 'Technologies') s.pick = { kind, label: s.pick?.label || t('staff.incentivesAdmin.editor.pick.technologyLabel', 'Technology'), options: [], sectorFilter: true, noRepeat: s.pick?.noRepeat ?? true };
    else s.pick = { kind: 'Options', label: s.pick?.label ?? '', options: s.pick?.options ?? [], sectorFilter: false, noRepeat: s.pick?.noRepeat ?? true };
  }

  protected lines(list: readonly string[] | null | undefined): string {
    return (list ?? []).join('\n');
  }

  protected setPickOptions(s: FormSection, text: string): void {
    if (s.pick) s.pick.options = text.split('\n').map((o) => o.trim()).filter((o) => o);
  }

  // ----- Form: fields -----

  protected typeLabel(type: string): string {
    return fieldTypeLabel(type);
  }

  protected addField(d: SchemeDefinition, s: FormSection): void {
    if (s.fields.length >= SCHEME_LIMITS.fields) return;
    this.openField(d, s, -1, { key: '', label: '', help: null, type: 'text', required: true, assessorChecks: false, maxLength: 200, options: [], isClaim: false });
  }

  protected editField(d: SchemeDefinition, s: FormSection, i: number): void {
    this.openField(d, s, i, s.fields[i]);
  }

  private openField(d: SchemeDefinition, s: FormSection, index: number, field: FormField): void {
    const si = d.form.sections.indexOf(s);
    // A copy field copies an earlier field: before it in the section, or any field of an earlier section ("section.field").
    const earlier = (index < 0 ? s.fields : s.fields.slice(0, index)).filter((f) => f.type !== 'copy').map((f) => ({ value: f.key, label: f.label }));
    const before = d.form.sections.slice(0, si).flatMap((x) => x.fields.filter((f) => f.type !== 'copy').map((f) => ({ value: `${x.key}.${f.key}`, label: `${x.title} → ${f.label}` })));
    this.fieldEdit.set({
      section: s, index, field, isNew: index < 0 || this.fresh.has(field),
      taken: s.fields.filter((_, n) => n !== index).map((f) => f.key), copies: [...earlier, ...before],
    });
  }

  protected fieldSaved(d: SchemeDefinition, e: FieldEdit, f: FormField): void {
    if (e.isNew) this.fresh.add(f);
    const old = e.index >= 0 ? e.section.fields[e.index] : null;
    e.section.fields = e.index < 0 ? [...e.section.fields, f] : e.section.fields.map((x, n) => (n === e.index ? f : x));
    if (old && old.key !== f.key) this.renameInRules(d, old.key, f.key);
    if (old && (old.type === 'document' || old.type === 'photo') && f.type !== 'document' && f.type !== 'photo') this.dropFromRules(d, new Set([f.key]));
    this.fieldEdit.set(null);
  }

  protected moveField(s: FormSection, i: number, by: -1 | 1): void {
    const list = [...s.fields];
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    s.fields = list;
  }

  protected deleteField(d: SchemeDefinition, s: FormSection, i: number): void {
    const key = s.fields[i].key;
    s.fields = s.fields.filter((_, n) => n !== i);
    this.dropFromRules(d, new Set([key]));
  }

  // ----- Form: document rules -----

  protected documentFields(d: SchemeDefinition): { key: string; label: string }[] {
    return d.form.sections.flatMap((s) => s.fields.filter((f) => f.type === 'document' || f.type === 'photo').map((f) => ({ key: f.key, label: `${f.label} (${s.title})` })))
      .filter((f, i, all) => all.findIndex((x) => x.key === f.key) === i);
  }

  protected addRule(d: SchemeDefinition): void {
    d.form.rules = [...d.form.rules, { kind: 'AtLeast', count: 1, fields: [], message: null }];
  }

  protected removeRule(d: SchemeDefinition, i: number): void {
    d.form.rules = d.form.rules.filter((_, n) => n !== i);
  }

  protected toggleRuleField(r: DocumentRule, key: string): void {
    r.fields = r.fields.includes(key) ? r.fields.filter((k) => k !== key) : [...r.fields, key];
  }

  private dropFromRules(d: SchemeDefinition, keys: Set<string>): void {
    for (const r of d.form.rules) r.fields = r.fields.filter((k) => !keys.has(k));
  }

  private renameInRules(d: SchemeDefinition, from: string, to: string): void {
    for (const r of d.form.rules) r.fields = r.fields.map((k) => (k === from ? to : k));
  }

  // ----- Verification -----

  protected setFlow(d: SchemeDefinition, flow: VerificationFlow): void {
    d.verification.flow = flow;
  }

  // ----- Save -----

  protected async save(): Promise<void> {
    const d = this.def();
    if (!d) return;
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      // An emptied number box is null: the server's whole numbers need a value.
      const n = (v: number | null | undefined) => v ?? 0;
      const body: SchemeDefinition = {
        ...d,
        orderNo: n(d.orderNo),
        card: { ...d.card, highlight: d.card.highlight?.trim() || null, details: d.card.details?.trim() || null },
        grading: { ...d.grading, rows: d.grading.rows.map((g) => ({ ...g, sharePercent: n(g.sharePercent), maxAmount: n(g.maxAmount) })) },
        form: {
          ...d.form,
          sections: d.form.sections.map((s) => ({ ...s, minItems: n(s.minItems), maxItems: n(s.maxItems) })),
          rules: d.form.rules.map((r) => ({ ...r, count: n(r.count), message: r.message?.trim() || null })),
        },
        verification: { ...d.verification, correctionRounds: n(d.verification.correctionRounds), correctionDays: n(d.verification.correctionDays) },
      };
      this.success.set((await firstValueFrom(this.api.save(body))).message);
      this.fresh = new WeakSet<object>();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    this.busy.set(true);
    try {
      const [meta, d] = await Promise.all([firstValueFrom(this.api.list()), firstValueFrom(this.api.get(this.code))]);
      this.levels.set(meta.levels);
      this.sizes.set(meta.sizes);
      this.def.set(normalise(d));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
