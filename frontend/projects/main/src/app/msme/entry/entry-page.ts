import { ContentTextComponent } from '../../content/content-text';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { AlertDialog, AlertMessage, errorAlert, successAlert } from '../shared/alert-dialog';
import { levelName } from '../shared/levels';
import { EntryField } from './entry-field';
import { CellValue, FormValues, emptyRow, initialValues, isShown, missing, sortedFields, toRequest } from './entry-form';
import { EntryApi, EntryEvidence, EntryNc, EntryState, FormField, isWebEntryLevel } from './entry.api';
import { RequirementVideo } from '../shared/requirement-video';
import { Crumb, PageHead } from '../shared/page-head';

type Tab = 'basic' | 'documents' | 'nc' | 'submit';

/** Rows the page lets the unit add, as the app. */
const MAX_ROWS = 20;

/**
 * ZED-X basic information, documents and final submit on the web (api/msme/entry). The MSME app enters these for
 * Bronze, Silver and Gold; its source is not in the repository, so ZED-X is entered here. The form is the Admin's
 * Basic Information form (Admin → App Forms) for the unit's level and NIC sector, the documents are the unit's own
 * questionnaire (NIC sector-wise, Administration → Certification Levels).
 */
@Component({
  selector: 'zed-msme-entry',
  imports: [RouterLink, EntryField, AlertDialog, ContentTextComponent, RequirementVideo, PageHead],
  templateUrl: './entry-page.html',
  styleUrl: '../shared/msme-page.scss',
  styles: `
    /* 2026-11-14 (approved): the step tracker, a card per step. */
    .entry-tabs { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-bottom: 14px; }
    .entry-tabs button { display: flex; align-items: center; gap: 10px; text-align: left; background: #fff; border: 1px solid #dfe9ea;
      border-radius: 10px; padding: 10px 12px; font-weight: 700; font-size: 14px; color: #23474a; }
    .entry-tabs button:hover { border-color: #9cc9cd; }
    .entry-tabs button.active { border: 2px solid #2f7c83; padding: 9px 11px; }
    .entry-tabs button.done { background: #eef8f2; border-color: #bfe3cb; }
    .entry-tabs button.done.active { border-color: #1e7a3c; }
    .entry-tabs .st-num { flex: none; width: 28px; height: 28px; border-radius: 14px; display: grid; place-items: center; background: #eef6f6;
      color: #2f7c83; font-size: 13px; font-weight: 800; }
    .entry-tabs button.done .st-num { background: #1e7a3c; color: #fff; }
    .entry-tabs button.is-nc .st-num { background: #f8d9d5; color: #c0392b; }
    .entry-tabs .st-text { min-width: 0; }
    .entry-tabs .count { display: block; font-weight: 500; font-size: 12px; color: #5f6f70; }
    .entry-card { background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; padding: 18px 20px 0; }
    .entry-card .stepper-footer-sec { display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid #eef3f3; margin: 14px -20px 0;
      padding: 12px 20px; background: #fafcfc; border-radius: 0 0 12px 12px; }
    .entry-card > :last-child:not(.stepper-footer-sec) { margin-bottom: 18px; }
    @media (max-width: 575.98px) { .entry-card { padding: 14px 12px 0; } .entry-card .stepper-footer-sec { margin: 14px -12px 0; padding: 12px; } }
    .field-row { margin-bottom: 14px; }
    .field-row > label, .field-label { font-weight: 600; display: block; margin-bottom: 4px; }
    .req { color: #c00; }
    .help { font-size: 12px; color: #6c757d; display: block; margin-top: 2px; }
    .rows-table td, .rows-table th { vertical-align: top; }
    .rows-table th { font-size: 13px; }
    .doc-section { margin-bottom: 18px; }
    .doc-section h5 { background: #f1f4f8; padding: 8px 10px; margin: 0 0 8px; font-size: 15px; }
    .doc-req { margin: 0 0 10px 6px; }
    .doc-req .req-name { font-weight: 600; margin-bottom: 6px; }
    .doc-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 8px; border: 1px solid #e6e9ee; border-radius: 4px; margin-bottom: 6px; }
    .doc-row .doc-name { flex: 1 1 260px; }
    .badge-ok { background: #e3f4e8; color: #1e7a3c; }
    .badge-req { background: #fbe4e1; color: #b03a2e; }
    .badge-opt { background: #eef1f1; color: #5f6f70; }
    .doc-badge { font-size: 11.5px; font-weight: 700; padding: 2px 10px; border-radius: 10px; white-space: nowrap; }
    /* A document row on fixed columns (name, status, file, button), so that the pickers line up under each other. */
    .doc-row.doc-grid { display: grid; grid-template-columns: minmax(0, 1fr) 150px; gap: 10px; }
    .doc-row.doc-grid.can-upload { grid-template-columns: minmax(0, 1fr) 150px minmax(0, 260px) 92px; }
    .doc-grid .doc-name { flex: none; min-width: 0; }
    .doc-grid .doc-status { display: flex; align-items: center; gap: 6px; }
    .doc-grid input[type=file] { width: 100% !important; }
    .doc-grid > .btn { width: 100%; }
    @media (max-width: 767.98px) {
      .doc-row.doc-grid, .doc-row.doc-grid.can-upload { grid-template-columns: minmax(0, 1fr) auto; }
      .doc-grid input[type=file] { grid-column: 1; }
    }
    .doc-req .req-name { color: #23474a; }
    .doc-section h5 { border-radius: 6px; color: #23474a; font-weight: 700; }
    .checklist li { margin-bottom: 6px; }
  `,
})
export class EntryPage implements OnInit {
  private readonly api = inject(EntryApi);

  /** Route parameter (ZEDX). */
  readonly certification = input.required<string>();

  protected readonly state = signal<EntryState | null>(null);
  protected readonly loading = signal(true);
  /** Home › Dashboard › <level> certification › Basic information. */
  protected readonly crumbs = computed<Crumb[]>(() => [
    { label: 'Home', link: '/msme/dashboard' },
    { label: `${levelName(this.certification())} certification`, link: ['/msme/certification', this.certification()] },
    { label: 'Basic information' },
  ]);
  protected readonly loadError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly alert = signal<AlertMessage | null>(null);
  protected readonly tab = signal<Tab>('basic');
  protected readonly form = signal<FormValues>({ values: {}, rows: {} });
  /** Files chosen per evidence, not yet uploaded. */
  protected readonly chosen = signal<Record<number, File[]>>({});
  protected readonly confirmed = signal(false);

  protected readonly levelName = levelName;
  protected readonly maxRows = MAX_ROWS;

  protected readonly fields = computed(() => {
    const s = this.state();
    return s ? sortedFields(s.form) : [];
  });
  protected readonly sections = computed(() => {
    const s = this.state();
    if (!s) return [];
    return s.form.sections.map((sec) => ({ ...sec, fields: this.fields().filter((f) => f.section === sec.key) }));
  });
  protected readonly editable = computed(() => !!this.state()?.editable);
  /** NC answers on the web only while the server has web entry on (2026-11-14: off; answered in the ZED MSME app). */
  protected readonly ncAnswerable = computed(() => !!this.state()?.webEntry && !!this.state()?.nc);
  protected readonly evidences = computed(() =>
    (this.state()?.sections ?? []).flatMap((s) => s.requirements.flatMap((r) => r.evidences)),
  );
  protected readonly requiredCount = computed(() => this.evidences().filter((e) => e.required).length);
  protected readonly requiredDone = computed(() => this.evidences().filter((e) => e.required && e.uploaded).length);
  /** The open NC, when there is one: then only its answers can be given and submitted. */
  protected readonly nc = computed<EntryNc | null>(() => this.state()?.nc ?? null);
  protected readonly ncItems = computed(() => {
    const nc = this.nc();
    if (!nc) return { total: 0, answered: 0 };
    const items = [
      ...nc.sections.flatMap((s) => s.requirements.map((r) => r.answered)),
      ...nc.products.map((p) => p.answered),
      ...(nc.siteExterior ? [nc.siteExterior.answered] : []),
    ];
    return { total: items.length, answered: items.filter((a) => a).length };
  });
  protected readonly readyToSubmit = computed(() =>
    this.nc()
      ? this.ncItems().answered === this.ncItems().total
      : !!this.state()?.basicInfoSaved && this.requiredDone() === this.requiredCount() && this.editable(),
  );
  /** Files and remarks typed for the NC answers, by item (r-{id}, p-{id}-photo, p-{id}-label, site). */
  protected readonly ncFiles = signal<Record<string, File[]>>({});
  protected readonly ncRemarks = signal<Record<string, string>>({});

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    if (!isWebEntryLevel(this.certification())) {
      this.loadError.set('Details of this certification are entered in the ZED MSME app; see View Details.');
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    try {
      const first = !this.state();
      const s = await firstValueFrom(this.api.state(this.certification()));
      this.state.set(s);
      this.form.set(initialValues(s));
      this.loadError.set(null);
      if (first && s.nc) this.tab.set('nc');
    } catch (e) {
      this.loadError.set(apiErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected shown(f: FormField): boolean {
    return isShown(f, this.form());
  }

  protected value(key: string): CellValue {
    return this.form().values[key] ?? null;
  }

  protected setValue(key: string, v: CellValue): void {
    this.form.update((f) => ({ ...f, values: { ...f.values, [key]: v } }));
  }

  protected rows(key: string) {
    return this.form().rows[key] ?? [];
  }

  protected setCell(key: string, index: number, column: string, v: CellValue): void {
    this.form.update((f) => ({
      ...f,
      rows: { ...f.rows, [key]: (f.rows[key] ?? []).map((r, i) => (i === index ? { ...r, [column]: v } : r)) },
    }));
  }

  protected addRow(f: FormField): void {
    this.form.update((x) => ({ ...x, rows: { ...x.rows, [f.key]: [...(x.rows[f.key] ?? []), emptyRow(f)] } }));
  }

  protected removeRow(key: string, index: number): void {
    this.form.update((x) => {
      const rows = (x.rows[key] ?? []).filter((_, i) => i !== index);
      const field = this.fields().find((f) => f.key === key);
      return { ...x, rows: { ...x.rows, [key]: rows.length || !field ? rows : [emptyRow(field)] } };
    });
  }

  protected columns(f: FormField): FormField[] {
    return (f.columns ?? []).filter((c) => isShown(c, this.form()));
  }

  // ---------- Saving ----------

  protected async saveBasicInfo(): Promise<void> {
    const s = this.state();
    if (!s || this.busy()) return;
    const gap = missing(s.form, this.form());
    if (gap) {
      this.alert.set(errorAlert(gap));
      return;
    }
    this.busy.set(true);
    try {
      const position = await this.position();
      const r = await firstValueFrom(this.api.saveBasicInfo(s.certification, toRequest(s.form, this.form(), position)));
      await this.load();
      this.alert.set(successAlert(r.message));
      this.tab.set('documents');
    } catch (e) {
      this.alert.set(errorAlert(apiErrorMessage(e)));
    } finally {
      this.busy.set(false);
    }
  }

  /** The unit's location for the photo rows, as the app records it; nothing when the browser does not give it. */
  private position(): Promise<{ latitude: string; longitude: string } | null> {
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geo) return Promise.resolve(null);
    return new Promise((resolve) => {
      geo.getCurrentPosition(
        (p) => resolve({ latitude: String(p.coords.latitude), longitude: String(p.coords.longitude) }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 15 * 60 * 1000 },
      );
    });
  }

  protected choose(e: EntryEvidence, event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    this.chosen.update((c) => ({ ...c, [e.id]: files }));
  }

  protected chosenFor(e: EntryEvidence): File[] {
    return this.chosen()[e.id] ?? [];
  }

  protected async upload(e: EntryEvidence): Promise<void> {
    const s = this.state();
    const files = this.chosenFor(e);
    if (!s || files.length === 0 || this.busy()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.uploadEvidence(s.certification, e.id, files));
      this.chosen.update((c) => {
        const next = { ...c };
        delete next[e.id];
        return next;
      });
      await this.reloadKeepingForm();
    } catch (err) {
      this.alert.set(errorAlert(apiErrorMessage(err)));
    } finally {
      this.busy.set(false);
    }
  }

  /** New document states without losing answers typed but not yet saved. */
  private async reloadKeepingForm(): Promise<void> {
    const s = await firstValueFrom(this.api.state(this.certification()));
    this.state.set(s);
  }

  // ---------- NC answers ----------

  protected chooseNc(key: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    this.ncFiles.update((c) => ({ ...c, [key]: files }));
  }

  protected ncFilesFor(key: string): File[] {
    return this.ncFiles()[key] ?? [];
  }

  protected remark(key: string): string {
    return this.ncRemarks()[key] ?? '';
  }

  protected setRemark(key: string, value: string): void {
    this.ncRemarks.update((r) => ({ ...r, [key]: value }));
  }

  protected answerRequirement(id: number): Promise<void> {
    const key = `r-${id}`;
    return this.answer([key], (level) => this.api.ncRequirement(level, id, this.ncFilesFor(key), this.remark(key)));
  }

  protected answerProduct(id: number): Promise<void> {
    const photo = this.ncFilesFor(`p-${id}-photo`)[0];
    const label = this.ncFilesFor(`p-${id}-label`)[0];
    if (!photo || !label) {
      this.alert.set(errorAlert('Please choose the product photo and the product label/description.'));
      return Promise.resolve();
    }
    return this.answer([`p-${id}-photo`, `p-${id}-label`, `p-${id}`], (level) => this.api.ncProduct(level, id, photo, label, this.remark(`p-${id}`)));
  }

  protected async answerSite(): Promise<void> {
    const position = await this.position();
    return this.answer(['site'], (level) => this.api.ncSiteExterior(level, this.ncFilesFor('site'), this.remark('site'), position));
  }

  private async answer(keys: string[], call: (level: string) => Observable<{ message: string }>): Promise<void> {
    const s = this.state();
    if (!s || this.busy()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(call(s.certification));
      this.ncFiles.update((c) => Object.fromEntries(Object.entries(c).filter(([k]) => !keys.includes(k))));
      await this.reloadKeepingForm();
    } catch (e) {
      this.alert.set(errorAlert(apiErrorMessage(e)));
    } finally {
      this.busy.set(false);
    }
  }

  protected async finalSubmit(): Promise<void> {
    const s = this.state();
    if (!s || !this.readyToSubmit() || !this.confirmed() || this.busy()) return;
    this.busy.set(true);
    try {
      const r = await firstValueFrom(this.api.finalSubmit(s.certification));
      await this.load();
      this.alert.set(successAlert(r.message));
    } catch (e) {
      this.alert.set(errorAlert(apiErrorMessage(e)));
    } finally {
      this.busy.set(false);
    }
  }
}
