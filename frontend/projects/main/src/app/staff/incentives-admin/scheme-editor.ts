import { Component, HostListener, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { DashIcon } from '../../msme/dashboard/dash-icon';
import { TextPipe, t } from '../../content/page-text';
import { HasUnsavedChanges } from '../unsaved-changes.guard';
import { FieldDialogComponent } from './field-dialog';
import {
  ActivationMode, CARD_ICONS, DocumentRule, FA_SCHEME_CODE, FormField, FormSection, GradingMode, LevelOption, SCHEME_LIMITS, SchemeDefinition, SchemesAdminApi,
  VerificationFlow, CheckStage, checkStageLabel, fieldTypeLabel, gradeKeyLabel, keyFrom, rupees,
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
    verification: { flow: 'Desktop', correctionRounds: 2, correctionDays: 30, autoAllot: true, onsitePhotosMin: 1, onsitePhotosMax: 3, ...(d.verification as Partial<SchemeDefinition['verification']> | undefined) },
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
  imports: [FormsModule, RouterLink, TextPipe, FieldDialogComponent, DashIcon],
  templateUrl: './scheme-editor.html',
  styleUrl: './scheme-editor.scss',
})
export class SchemeEditorPage implements HasUnsavedChanges {
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
  /** 2026-11-23 (approved design): the definition as last loaded or saved, per tab, to count the unsaved changes. */
  private saved: Record<EditorTab, string> | null = null;

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

  /** 2026-11-20: the built-in Financial Assistance scheme (the dashboard card opens it): levels only. */
  protected isFa(d: SchemeDefinition): boolean {
    return d.code.toUpperCase() === FA_SCHEME_CODE;
  }

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
    this.fitGrading(d);
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

  /**
   * Keeps the rows that still fit the mode and activation, and adds the rows every claim needs (2026-11-23: switching to
   * "By enterprise size" left one row, so Save was refused "add the share and maximum of Micro enterprises"): each size, or
   * each level the scheme opens after (unless an All row covers them), with the share and maximum of the first row.
   */
  private fitGrading(d: SchemeDefinition): void {
    const keys = this.gradeKeys(d);
    const first = d.grading.rows[0];
    const kept = d.grading.rows.filter((r) => keys.includes(r.key));
    const template = kept[0] ?? first;
    const needed = d.grading.mode === 'Size' ? keys : kept.some((r) => r.key === 'All') ? [] : keys.filter((k) => k !== 'All');
    for (const k of needed) {
      if (!kept.some((r) => r.key === k)) kept.push({ key: k, sharePercent: template?.sharePercent ?? 0, maxAmount: template?.maxAmount ?? 0 });
    }
    if (!kept.length && keys.length) kept.push({ key: keys[0], sharePercent: template?.sharePercent ?? 0, maxAmount: template?.maxAmount ?? 0 });
    d.grading.rows = kept;
  }

  /** "A claim of ₹80,000 at Silver pays ₹50,000 (the cap)": the first row with a share and a maximum, or null. */
  protected example(d: SchemeDefinition): string | null {
    const g = d.grading.rows.find((r) => (r.sharePercent ?? 0) > 0 && (r.maxAmount ?? 0) > 0);
    if (!g) return null;
    const capAt = (g.maxAmount * 100) / g.sharePercent;
    const claim = Math.max(10000, Math.ceil((capAt * 1.2) / 10000) * 10000);
    const pays = Math.min(Math.round((claim * g.sharePercent) / 100), g.maxAmount);
    return t('staff.incentivesAdmin.editor.grading.example', 'Example: a claim of {claim} ({key}) pays {pays}{cap}', {
      claim: rupees(claim), key: this.keyLabel(g.key), pays: rupees(pays),
      cap: pays === g.maxAmount ? t('staff.incentivesAdmin.editor.grading.exampleCap', ' (the maximum)') : '',
    });
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

  protected stageLabel(stage: CheckStage | null | undefined): string {
    return checkStageLabel(stage);
  }

  protected setFlow(d: SchemeDefinition, flow: VerificationFlow): void {
    d.verification.flow = flow;
  }

  // ----- Save -----

  protected async save(): Promise<void> {
    const d = this.def();
    if (!d) return;
    this.error.set('');
    this.success.set('');
    // 2026-11-23 (approved design): the checks the server makes most often, shown on their tab before sending.
    const bad = this.tabs.find((x) => this.issues(d, x).length);
    if (bad) {
      this.tab.set(bad);
      this.error.set(this.issues(d, bad)[0]);
      return;
    }
    this.busy.set(true);
    try {
      // An emptied number box is null: the server's whole numbers need a value.
      const n = (v: number | null | undefined) => v ?? 0;
      const body: SchemeDefinition = {
        ...d,
        orderNo: n(d.orderNo),
        card: { ...d.card, highlight: d.card.highlight?.trim() || null, details: d.card.details?.trim() || null },
        disclaimer: d.disclaimer?.trim() || null,
        instructions: d.instructions?.trim() || null,
        declaration: d.declaration?.trim() || null,
        grading: { ...d.grading, rows: d.grading.rows.map((g) => ({ ...g, sharePercent: n(g.sharePercent), maxAmount: n(g.maxAmount) })) },
        form: {
          ...d.form,
          sections: d.form.sections.map((s) => ({ ...s, minItems: n(s.minItems), maxItems: n(s.maxItems) })),
          rules: d.form.rules.map((r) => ({ ...r, count: n(r.count), message: r.message?.trim() || null })),
        },
        verification: {
          ...d.verification, correctionRounds: n(d.verification.correctionRounds), correctionDays: n(d.verification.correctionDays),
          onsitePhotosMin: n(d.verification.onsitePhotosMin), onsitePhotosMax: d.verification.onsitePhotosMax ?? 1,
        },
      };
      this.success.set((await firstValueFrom(this.api.save(body))).message);
      this.fresh = new WeakSet<object>();
      this.saved = this.snapshot(d);
    } catch (err) {
      const message = apiErrorMessage(err);
      this.error.set(message);
      this.tab.set(this.tabOfProblem(message));
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
      const def = normalise(d);
      this.def.set(def);
      this.saved = this.snapshot(def);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  // ----- Unsaved changes and checks (2026-11-23, approved design) -----

  /** Each tab's part of the definition as JSON. */
  private snapshot(d: SchemeDefinition): Record<EditorTab, string> {
    return {
      card: JSON.stringify([d.name, d.card, d.orderNo, d.active, d.activation]),
      grading: JSON.stringify(d.grading),
      form: JSON.stringify([d.form, d.disclaimer ?? null, d.instructions ?? null, d.declaration ?? null]),
      verification: JSON.stringify(d.verification),
    };
  }

  /** The tabs with changes not saved yet. */
  protected changedTabs(): EditorTab[] {
    const d = this.def();
    if (!d || !this.saved) return [];
    const now = this.snapshot(d);
    return this.tabs.filter((x) => now[x] !== this.saved![x]);
  }

  hasUnsavedChanges(): boolean {
    return !this.busy() && this.changedTabs().length > 0;
  }

  @HostListener('window:beforeunload', ['$event'])
  protected beforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }

  /** Discard: back to the definition as last loaded or saved. */
  protected discard(): void {
    const d = this.def();
    if (!d || !this.saved) return;
    const back = normalise({
      ...d,
      ...(([name, card, orderNo, active, activation]) => ({ name, card, orderNo, active, activation }))(JSON.parse(this.saved.card)),
      grading: JSON.parse(this.saved.grading),
      ...(([form, disclaimer, instructions, declaration]) => ({ form, disclaimer, instructions, declaration }))(JSON.parse(this.saved.form)),
      verification: JSON.parse(this.saved.verification),
    });
    this.def.set(back);
    this.fresh = new WeakSet<object>();
    this.error.set('');
    this.success.set(t('staff.incentivesAdmin.editor.discarded', 'Changes discarded.'));
  }

  /** What would stop Save on a tab (the server's commonest refusals), in its words. */
  protected issues(d: SchemeDefinition, tab: EditorTab): string[] {
    const out: string[] = [];
    if (tab === 'card') {
      if (!d.name?.trim()) out.push(t('staff.incentivesAdmin.editor.issue.name', 'Card and activation: enter the scheme name.'));
      if (!d.card.title?.trim()) out.push(t('staff.incentivesAdmin.editor.issue.title', 'Card and activation: enter the card title.'));
      if (d.activation.mode === 'Levels' && !d.activation.levels.length) out.push(t('staff.incentivesAdmin.editor.issue.levels', 'Card and activation: choose when the scheme opens.'));
    } else if (tab === 'grading') {
      const has = (k: string) => d.grading.rows.some((r) => r.key.toLowerCase() === k.toLowerCase());
      const missing = d.grading.mode === 'Size' ? this.sizes().filter((k) => !has(k))
        : has('All') ? [] : this.gradeKeys(d).filter((k) => k !== 'All' && !has(k));
      if (missing.length) out.push(t('staff.incentivesAdmin.editor.issue.gradeMissing', 'Grading: add a row for {keys}.', { keys: missing.map((k) => this.keyLabel(k)).join(', ') }));
      if (d.grading.rows.some((r) => r.sharePercent == null || r.sharePercent < 0 || r.sharePercent > 100)) out.push(t('staff.incentivesAdmin.editor.issue.share', 'Grading: the share is 0 to 100 %.'));
      if (d.grading.rows.some((r) => r.maxAmount == null || r.maxAmount < 0)) out.push(t('staff.incentivesAdmin.editor.issue.max', 'Grading: enter the maximum of each row.'));
    } else if (tab === 'form') {
      if (!d.form.sections.length) out.push(t('staff.incentivesAdmin.editor.issue.noSection', 'Form: add at least one section.'));
      d.form.sections.forEach((s, i) => {
        if (!s.title?.trim()) out.push(t('staff.incentivesAdmin.editor.issue.sectionTitle', 'Form: section {n} has no title.', { n: i + 1 }));
        if (!s.fields.length) out.push(t('staff.incentivesAdmin.editor.issue.sectionFields', 'Form: "{title}" has no field.', { title: s.title || i + 1 }));
      });
    } else {
      const v = d.verification;
      if (v.correctionRounds == null || v.correctionRounds < 0 || v.correctionRounds > 5) out.push(t('staff.incentivesAdmin.editor.issue.rounds', 'Verification: correction rounds 0 to 5.'));
      if (v.correctionDays == null || v.correctionDays < 1 || v.correctionDays > 180) out.push(t('staff.incentivesAdmin.editor.issue.days', 'Verification: days to answer a correction 1 to 180.'));
    }
    return out;
  }

  /** The tab a server refusal is about, from its first words. */
  private tabOfProblem(message: string): EditorTab {
    const m = message.toLowerCase();
    if (m.startsWith('grading')) return 'grading';
    if (/^(correction|choose the verification|onsite photos)/.test(m)) return 'verification';
    if (/(scheme name|card title|icon|opens after|activat|order)/.test(m)) return 'card';
    return m.includes('section') || m.includes('field') || m.includes('document') || m.includes('disclaimer') || m.includes('instructions') || m.includes('declaration') ? 'form' : this.tab();
  }
}
