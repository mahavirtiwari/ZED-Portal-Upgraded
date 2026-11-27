import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ContentTextComponent } from '../../content/content-text';
import { TextPipe, t } from '../../content/page-text';
import { AlertDialog, AlertMessage, errorAlert } from '../shared/alert-dialog';
import { Crumb, PageHead } from '../shared/page-head';
import { StepTracker, TrackerStep } from '../shared/step-tracker';
import { SchemeAccount, inr } from '../schemes/schemes.api';
import {
  ACCOUNT_FIELD, BANK_SECTION, CHEQUE_FIELD, FormAnswers, FormField, FormItem, FormSection, IncentiveSchemesApi, PickEntry, SchemePage,
  claimOf, dateBound, eligibleOf, filesOf, holdText, lockedNote,
} from './incentive-schemes.api';
import { SchemeAnswersComponent } from './scheme-answers';
import { SchemeFieldComponent } from './scheme-field';

type StepKind = 'disclaimer' | 'instructions' | 'unit' | 'section' | 'bank' | 'summary';

interface Step {
  kind: StepKind;
  label: string;
  section?: FormSection;
}

/** An item being edited: a plain section (index 0) or an "Add more" item (index = count: a new one). */
interface Editor {
  section: string;
  index: number;
  pick: string | null;
  values: Record<string, string | null>;
}

/** The application's progress (the status tracker after submission). */
const STATUS_STEPS: { key: string; label: () => string }[] = [
  { key: 'Submitted', label: () => t('msme.incentiveScheme.status.submitted', 'Submitted') },
  { key: 'Desktop', label: () => t('msme.incentiveScheme.status.desktop', 'Desktop verification') },
  { key: 'Correction', label: () => t('msme.incentiveScheme.status.correction', 'Correction') },
  { key: 'Qc', label: () => t('msme.incentiveScheme.status.qc', 'Agency QC') },
  { key: 'Approved', label: () => t('msme.incentiveScheme.status.approved', 'Approved') },
  { key: 'Paid', label: () => t('msme.incentiveScheme.status.paid', 'Paid') },
];

/** The current step of the tracker for a status (past the last once paid). */
const STATUS_INDEX: Record<string, number> = {
  Submitted: 1, WithAgency: 1, WithAssessor: 1, Verifying: 1, OnHold: 1, Correction: 2, Qc: 3, Approved: 5, Paid: 6,
};

/**
 * 2026-11-20 (incentive schemes, approved design): the applicant's page of one scheme the Admin defined, in the look of the
 * Financial Assistance page. Steps: the standard blocks the scheme has on (disclaimer, instructions, unit confirmation), the
 * sections (a plain section as one form; an "Add more" section as its saved items and the item being edited), the bank
 * account, then the summary with the declaration. After submission: the status tracker and the history; during a correction
 * round only the answers found not valid are edited ("Submit corrections" by the due date); after a rejection, the reason and
 * "Apply again".
 */
@Component({
  selector: 'zed-msme-incentive-scheme',
  imports: [NgTemplateOutlet, RouterLink, PageHead, StepTracker, AlertDialog, ContentTextComponent, TextPipe, SchemeFieldComponent, SchemeAnswersComponent],
  templateUrl: './incentive-scheme.html',
  styleUrls: ['../shared/msme-page.scss', '../schemes/scheme-page.scss', '../schemes/financial-assistance.scss', '../schemes/financial-assistance-form.scss', './incentive-scheme.scss'],
})
export class IncentiveSchemePage {
  private readonly api = inject(IncentiveSchemesApi);

  protected readonly code = inject(ActivatedRoute).snapshot.paramMap.get('code') ?? '';
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly alert = signal<AlertMessage | null>(null);
  protected readonly page = signal<SchemePage | null>(null);
  protected readonly stepIndex = signal(0);
  protected readonly consent = signal(false);
  protected readonly unitConfirmed = signal(false);
  protected readonly declaration = signal(false);
  protected readonly editor = signal<Editor | null>(null);
  protected readonly cheque = signal<string[]>([]);
  /** Correction round: the items being corrected ("section/index" → values). */
  protected readonly fixes = signal<Record<string, Editor>>({});
  protected account: SchemeAccount = { accountNo: '', confirmAccountNo: '', ifscCode: '', branchAddress: '', bankName: '' };
  protected readonly chequeField = computed<FormField>(() => ({
    key: CHEQUE_FIELD, label: t('msme.incentiveScheme.bank.chequeLabel', 'Cancelled cheque copy'), type: 'document', required: true, maxFiles: 3,
  }));
  protected readonly bankSection = BANK_SECTION;
  protected readonly inr = inr;

  protected readonly scheme = computed(() => this.page()?.scheme ?? null);
  protected readonly app = computed(() => this.page()?.application ?? null);
  protected readonly unit = computed(() => this.page()?.unit ?? {});
  protected readonly title = computed(() => this.scheme()?.card.title || this.scheme()?.name || t('msme.incentiveScheme.title', 'Incentive scheme'));

  /** What the page shows: the form, the submitted application, a correction round, a rejection, or why it cannot be applied for. */
  protected readonly mode = computed<'form' | 'status' | 'correction' | 'rejected' | 'closed'>(() => {
    const p = this.page();
    const a = p?.application;
    if (!p) return 'closed';
    if (!a || a.status === 'Draft') return p.canApply ? 'form' : 'closed';
    if (a.status === 'Correction') return 'correction';
    if (a.status === 'Rejected') return 'rejected';
    return 'status';
  });

  protected get crumbs(): Crumb[] {
    return [{ label: t('msme.incentiveScheme.crumb.home', 'Home'), link: '/msme/dashboard' },
      { label: t('msme.incentiveScheme.crumb.incentives', 'Incentives'), link: '/msme/dashboard', fragment: 'incentives' },
      { label: this.title() }];
  }

  protected readonly steps = computed<Step[]>(() => {
    const s = this.scheme();
    if (!s) return [];
    const out: Step[] = [];
    if (s.blocks.disclaimer) out.push({ kind: 'disclaimer', label: t('msme.incentiveScheme.step.disclaimer', 'Disclaimer') });
    if (s.blocks.instructions) out.push({ kind: 'instructions', label: t('msme.incentiveScheme.step.instructions', 'Instructions') });
    out.push({ kind: 'unit', label: t('msme.incentiveScheme.step.unit', 'Confirm unit') });
    for (const section of s.sections) out.push({ kind: 'section', label: section.title, section });
    if (s.blocks.bankAccount) out.push({ kind: 'bank', label: t('msme.incentiveScheme.step.bank', 'Bank account') });
    out.push({ kind: 'summary', label: t('msme.incentiveScheme.step.summary', 'Review & submit') });
    return out;
  });
  protected readonly step = computed<Step | null>(() => this.steps()[this.stepIndex()] ?? null);
  protected readonly trackerSteps = computed<TrackerStep[]>(() => this.steps().map((s) => ({ label: s.label })));
  protected readonly statusSteps = computed<TrackerStep[]>(() => STATUS_STEPS.map((s) => ({ label: s.label() })));
  protected readonly statusIndex = computed(() => STATUS_INDEX[this.app()?.status ?? ''] ?? 1);

  /** The grade the eligible amount is worked out with: the open window's, or the one stored at submission. */
  protected readonly grade = computed(() => {
    const a = this.app();
    if (a && a.status !== 'Draft' && a.sharePercent !== null) return { sharePercent: a.sharePercent, maxAmount: a.maxAmount ?? 0 };
    return this.page()?.window?.grade ?? null;
  });

  /** The answers with the item being edited as it would be saved (the live claim). */
  private readonly liveAnswers = computed<FormAnswers>(() => {
    const base = this.app()?.answers ?? { sections: {} };
    const e = this.editor();
    if (!e) return base;
    const items = [...(base.sections[e.section] ?? [])];
    items[e.index] = { pick: e.pick, values: e.values, saved: true };
    return { sections: { ...base.sections, [e.section]: items } };
  });
  protected readonly claim = computed(() => claimOf(this.scheme()?.sections ?? [], this.liveAnswers()));
  protected readonly eligible = computed(() => eligibleOf(this.claim(), this.grade()));

  constructor() {
    // 2026-11-27 (UI review): the tab names the scheme ("ZED | Technology Upgradation"), not "Incentive Scheme".
    const tab = inject(Title);
    effect(() => { if (this.scheme()) tab.setTitle(`ZED | ${this.title()}`); });
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.apply(await firstValueFrom(this.api.page(this.code)));
    } catch (err) {
      this.alert.set(errorAlert(apiErrorMessage(err)));
    } finally {
      this.loading.set(false);
    }
  }

  /** A new answer of the API: the page, and the local copies of the bank block and the correction items. */
  private apply(p: SchemePage): void {
    this.page.set(p);
    const a = p.application;
    const bank = a?.answers.sections[BANK_SECTION]?.[0];
    if (bank) this.cheque.set(filesOf(bank.values[CHEQUE_FIELD]));
    if (a?.account && !this.account.accountNo) {
      this.account = { accountNo: a.account.accountNo ?? '', confirmAccountNo: a.account.accountNo ?? '', ifscCode: a.account.ifscCode ?? '',
        branchAddress: a.account.branchAddress ?? '', bankName: a.account.bankName ?? '' };
    }
    if (a?.status === 'Correction') {
      const fixes: Record<string, Editor> = {};
      for (const key of this.flaggedItems()) {
        const [section, index] = key.split('/');
        const item = a.answers.sections[section]?.[Number(index)];
        if (item) fixes[key] = { section, index: Number(index), pick: item.pick ?? null, values: { ...item.values } };
      }
      this.fixes.set(fixes);
    }
  }

  protected run<T>(work: () => Promise<T>): Promise<T | undefined> {
    this.busy.set(true);
    return work()
      .catch((err) => {
        this.alert.set(errorAlert(apiErrorMessage(err)));
        return undefined;
      })
      .finally(() => this.busy.set(false));
  }

  protected fail(message: string): void {
    this.alert.set(errorAlert(message));
  }

  // ----- steps -----

  protected async go(index: number): Promise<void> {
    const target = this.steps()[index];
    if (!target) return;
    if ((target.kind === 'section' || target.kind === 'bank') && !this.app()) {
      const p = await this.run(() => firstValueFrom(this.api.draft(this.code)));
      if (!p) return;
      this.apply(p);
    }
    this.editor.set(null);
    if (target.kind === 'section' && target.section && !target.section.repeating) this.openPlain(target.section);
    if (target.kind === 'section' && target.section?.repeating && !this.items(target.section).length) this.openItem(target.section, 0);
    this.stepIndex.set(index);
    window.scrollTo?.(0, 0);
  }

  protected back(): void {
    void this.go(this.stepIndex() - 1);
  }

  /** "Proceed" of the current step: its own check (or save), then the next step. */
  protected async next(): Promise<void> {
    const s = this.step();
    if (!s) return;
    if (s.kind === 'disclaimer' && !this.consent()) return this.fail(t('msme.incentiveScheme.error.consent', 'Please accept the disclaimer.'));
    if (s.kind === 'unit' && this.scheme()!.blocks.unitConfirm && !this.unitConfirmed())
      return this.fail(t('msme.incentiveScheme.error.unit', 'Please confirm the unit details.'));
    if (s.kind === 'section' && s.section) {
      if (!s.section.repeating) {
        if (!(await this.saveEditor())) return;
      } else {
        if (this.editor()) return this.fail(t('msme.incentiveScheme.error.unsaved', 'Please save or cancel the item you are editing.'));
        if (this.items(s.section).length < s.section.minItems)
          return this.fail(t('msme.incentiveScheme.error.minItems', 'Please add at least {n}.', { n: s.section.minItems }));
      }
    }
    if (s.kind === 'bank' && !this.bankValid()) return;
    await this.go(this.stepIndex() + 1);
  }

  // ----- sections and items -----

  protected items(s: FormSection): FormItem[] {
    return (this.app()?.answers.sections[s.key] ?? []).filter((i) => i.saved || !s.repeating);
  }

  private openPlain(s: FormSection): void {
    const item = this.app()?.answers.sections[s.key]?.[0];
    this.editor.set({ section: s.key, index: 0, pick: null, values: { ...(item?.values ?? {}) } });
  }

  protected openItem(s: FormSection, index: number): void {
    const item = this.app()?.answers.sections[s.key]?.[index];
    this.editor.set({ section: s.key, index, pick: item?.pick ?? null, values: { ...(item?.values ?? {}) } });
  }

  protected cancelItem(): void {
    this.editor.set(null);
  }

  protected setValue(key: string, value: string | null): void {
    this.editor.update((e) => (e ? { ...e, values: { ...e.values, [key]: value } } : e));
  }

  protected setPick(value: string): void {
    this.editor.update((e) => (e ? { ...e, pick: value || null } : e));
  }

  /** The entries an item may pick: the section's list, without those other items picked (NoRepeat). */
  protected picks(s: FormSection, index: number): PickEntry[] {
    const all = this.page()?.picks[s.key] ?? [];
    if (!s.pick?.noRepeat) return all;
    const taken = new Set((this.app()?.answers.sections[s.key] ?? []).filter((_, i) => i !== index).map((i) => i.pick));
    return all.filter((p) => !taken.has(p.code));
  }

  /** The value a copy field shows: the field of the same item, or "section.field" of a plain section. */
  protected copyOf(f: FormField, values: Record<string, string | null>): string | null {
    const source = f.copyOf ?? '';
    const dot = source.indexOf('.');
    if (dot < 0) return values[source] ?? null;
    return this.app()?.answers.sections[source.slice(0, dot)]?.[0]?.values[source.slice(dot + 1)] ?? null;
  }

  protected min(f: FormField): string {
    return dateBound(f.dateMin, this.page()?.window?.openedOn, false);
  }

  protected max(f: FormField): string {
    return dateBound(f.dateMax, this.page()?.window?.openedOn, true);
  }

  /** Saves the item being edited (a plain section or an "Add more" item); true when saved. */
  protected async saveEditor(): Promise<boolean> {
    const e = this.editor();
    const s = this.scheme()?.sections.find((x) => x.key === e?.section);
    if (!e || !s) return false;
    const missing = s.fields.find((f) => f.required && f.type !== 'copy' && !e.values[f.key]);
    if (s.pick && !e.pick) {
      this.fail(t('msme.incentiveScheme.error.pick', 'Please choose {label}.', { label: s.pick.label || t('msme.incentiveScheme.pickFallback', 'an entry') }));
      return false;
    }
    if (missing) {
      this.fail(t('msme.incentiveScheme.error.required', 'Please fill in "{label}".', { label: missing.label }));
      return false;
    }
    const p = await this.run(() => firstValueFrom(s.repeating
      ? this.api.saveItem(this.code, s.key, e.index, e.pick, e.values)
      : this.api.saveSection(this.code, s.key, e.values)));
    if (!p) return false;
    this.apply(p);
    if (s.repeating) this.editor.set(null);
    return true;
  }

  protected async removeItem(s: FormSection, index: number): Promise<void> {
    const p = await this.run(() => firstValueFrom(this.api.removeItem(this.code, s.key, index)));
    if (p) {
      this.apply(p);
      this.editor.set(null);
    }
  }

  /** An item card's claim (its claim fields) and number of documents. */
  protected itemClaim(s: FormSection, item: FormItem): number {
    return claimOf([s], { sections: { [s.key]: [{ ...item, saved: true }] } });
  }

  protected itemDocs(s: FormSection, item: FormItem): number {
    return s.fields.filter((f) => f.type === 'document' || f.type === 'photo').reduce((n, f) => n + filesOf(item.values[f.key]).length, 0);
  }

  // ----- bank and submission -----

  protected bankValid(): boolean {
    const a = this.account;
    if (![a.accountNo, a.confirmAccountNo, a.ifscCode, a.branchAddress, a.bankName].every((v) => v.trim())) {
      this.fail(t('msme.incentiveScheme.error.bankRequired', 'Please enter the account details.'));
      return false;
    }
    if (!/^[0-9]{9,18}$/.test(a.accountNo.trim())) {
      this.fail(t('msme.incentiveScheme.error.accountNo', 'Please enter a valid account number (9 to 18 digits).'));
      return false;
    }
    if (a.accountNo.trim() !== a.confirmAccountNo.trim()) {
      this.fail(t('msme.incentiveScheme.error.accountMismatch', 'Account Number and Re-Enter Account Number must match.'));
      return false;
    }
    if (!/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(a.ifscCode.trim())) {
      this.fail(t('msme.incentiveScheme.error.ifsc', 'Invalid IFSC Code format. Please enter the correct 11-digit code.'));
      return false;
    }
    if (!this.cheque().length) {
      this.fail(t('msme.incentiveScheme.error.cheque', 'Please upload the cancelled cheque.'));
      return false;
    }
    return true;
  }

  protected setCheque(value: string | null): void {
    this.cheque.set(filesOf(value));
  }

  protected chequeValue(): string | null {
    return this.cheque().length ? JSON.stringify(this.cheque()) : null;
  }

  protected setAccount(key: keyof SchemeAccount, value: string): void {
    this.account = { ...this.account, [key]: value };
  }

  protected async submit(): Promise<void> {
    const blocks = this.scheme()!.blocks;
    if (blocks.declaration && !this.declaration()) return this.fail(t('msme.incentiveScheme.error.declaration', 'Please accept the declaration.'));
    const p = await this.run(() => firstValueFrom(this.api.submit(this.code, {
      account: blocks.bankAccount ? { ...this.account, ifscCode: this.account.ifscCode.trim().toUpperCase() } : null,
      cheque: this.cheque(),
      unitConfirmed: this.unitConfirmed() || !blocks.unitConfirm,
      declaration: this.declaration() || !blocks.declaration,
    })));
    if (p) {
      this.apply(p);
      window.scrollTo?.(0, 0);
    }
  }

  /** "Apply again" after a rejection: a new draft, then the form from its first step. */
  protected async applyAgain(): Promise<void> {
    const p = await this.run(() => firstValueFrom(this.api.draft(this.code)));
    if (!p) return;
    this.apply(p);
    this.consent.set(false);
    this.unitConfirmed.set(false);
    this.declaration.set(false);
    this.stepIndex.set(0);
  }

  // ----- correction round -----

  /** The paths found not valid in the open correction round. */
  protected readonly flagged = computed(() => new Set((this.app()?.checks ?? []).map((c) => c.path)));

  /** The items with an answer found not valid ("section/index"). */
  protected flaggedItems(): string[] {
    const keys = (this.app()?.checks ?? []).map((c) => c.path.split('/')).filter((p) => p[0] !== BANK_SECTION).map((p) => `${p[0]}/${p[1]}`);
    return [...new Set(keys)];
  }

  protected readonly bankFlagged = computed(() => this.flagged().has(`${BANK_SECTION}/0/${ACCOUNT_FIELD}`));
  protected readonly chequeFlagged = computed(() => this.flagged().has(`${BANK_SECTION}/0/${CHEQUE_FIELD}`));

  protected sectionOf(key: string): FormSection | undefined {
    return this.scheme()?.sections.find((s) => s.key === key.split('/')[0]);
  }

  protected remark(path: string): string | null {
    const c = this.app()?.checks.find((x) => x.path === path);
    return c ? c.remarks ?? '' : null;
  }

  protected setFix(key: string, field: string, value: string | null): void {
    this.fixes.update((all) => ({ ...all, [key]: { ...all[key], values: { ...all[key].values, [field]: value } } }));
  }

  protected async saveFix(key: string): Promise<void> {
    const e = this.fixes()[key];
    const s = this.sectionOf(key);
    if (!e || !s) return;
    const p = await this.run(() => firstValueFrom(s.repeating
      ? this.api.saveItem(this.code, s.key, e.index, e.pick, e.values)
      : this.api.saveSection(this.code, s.key, e.values)));
    if (p) this.apply(p);
  }

  protected async submitCorrections(): Promise<void> {
    if (this.bankFlagged() && !this.bankValid()) return;
    const p = await this.run(() => firstValueFrom(this.api.correction(this.code, {
      account: this.bankFlagged() ? { ...this.account, ifscCode: this.account.ifscCode.trim().toUpperCase() } : null,
      cheque: this.chequeFlagged() ? this.cheque() : null,
    })));
    if (p) {
      this.apply(p);
      window.scrollTo?.(0, 0);
    }
  }

  /** The status as the applicant reads it. */
  protected statusLabel(status: string): string {
    switch (status) {
      case 'Draft': return t('msme.incentiveScheme.status.draft', 'Draft');
      case 'Submitted': case 'WithAgency': return t('msme.incentiveScheme.status.submitted', 'Submitted');
      case 'WithAssessor': case 'Verifying': return t('msme.incentiveScheme.status.desktop', 'Desktop verification');
      case 'Correction': return t('msme.incentiveScheme.status.correction', 'Correction');
      case 'Qc': return t('msme.incentiveScheme.status.qc', 'Agency QC');
      case 'Approved': return t('msme.incentiveScheme.status.approved', 'Approved');
      case 'Paid': return t('msme.incentiveScheme.status.paid', 'Paid');
      case 'Rejected': return t('msme.incentiveScheme.status.rejected', 'Rejected');
      case 'OnHold': return t('msme.incentiveScheme.status.onHold', 'On hold');
      default: return status;
    }
  }

  /** Why the application is on hold, in the applicant's words (2026-11-20). */
  protected holdText(): string {
    return holdText(this.app()?.holdKind);
  }

  protected lockedText(): string {
    const p = this.page();
    if (!p) return '';
    if (p.state === 'availed') return t('msme.incentiveScheme.availed', 'You have availed this scheme for your current certification.');
    return lockedNote(p.note, p.scheme.activationLevels) ?? p.message ?? '';
  }

  protected date(iso: string | null | undefined): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
    return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
  }
}
