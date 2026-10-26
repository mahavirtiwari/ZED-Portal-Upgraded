import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { CatalogueItem, INCENTIVE_TYPES, IncentiveForm, IncentivesApi } from './incentives.api';
import { PagedView, PagerComponent } from '../pager';

export const MAX_INCENTIVE_DOC_BYTES = 2 * 1024 * 1024;

function emptyForm(type: string): IncentiveForm {
  return {
    incentiveType: type, incentive: '', details: '', ministryOrDepartment: '', contactPerson: '', webLink: '', email: '',
    mobileNo: '', videoLink: '', applicableForBronze: false, applicableForSilver: false, applicableForGold: false, activeStatus: true,
  };
}

/**
 * Incentive catalogue for the Admin role (shown on the public incentive pages). Port of
 * Views/Incentive/Index.cshtml: add, edit and the two PDF documents of each incentive. The type comes
 * from the `type` query parameter, as the legacy menu's `IncentiveType`.
 */
@Component({
  selector: 'zed-staff-incentive-master',
  imports: [FormsModule, PagerComponent],
  template: `
    <!-- As the live page: the type comes from the menu's Incentives drop-down (?type=). -->
    <div class="page-head">
      <div>
        <h3 class="registration-title">Incentives ({{ typeLabel() }})</h3>
        <p class="page-sub">Incentives shown on the public incentive pages: add one here, then edit it or attach its documents in the list.</p>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    <form class="zed-card" (ngSubmit)="save()" novalidate>
      <h4>Add Incentive</h4>
      <div class="form-grid">
        @for (f of fields; track f.key) {
          <label [for]="'inc-' + f.key">{{ f.label }}@if (f.required) {<span class="req">*</span>}</label>
          <div>
            <input class="form-control" [id]="'inc-' + f.key" [name]="f.key" [attr.maxlength]="f.max" [ngModel]="form()[f.key]" (ngModelChange)="patch(f.key, $event)" />
            @if (f.hint) { <small class="muted">{{ f.hint }}</small> }
          </div>
        }
        <div class="label">Applicable for<span class="req">*</span></div>
        <div class="check-row">
          <label class="form-check-label"><input type="checkbox" class="form-check-input" name="b" [ngModel]="form().applicableForBronze" (ngModelChange)="patchBool('applicableForBronze', $event)" /> Bronze</label>
          <label class="form-check-label"><input type="checkbox" class="form-check-input" name="s" [ngModel]="form().applicableForSilver" (ngModelChange)="patchBool('applicableForSilver', $event)" /> Silver</label>
          <label class="form-check-label"><input type="checkbox" class="form-check-input" name="g" [ngModel]="form().applicableForGold" (ngModelChange)="patchBool('applicableForGold', $event)" /> Gold</label>
        </div>
        <div class="label">Active<span class="req">*</span></div>
        <div><input type="checkbox" class="form-check-input" name="active" aria-label="Active" [ngModel]="form().activeStatus" (ngModelChange)="patchBool('activeStatus', $event)" /></div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" [disabled]="busy()">SAVE</button>
      </div>
    </form>

    <div class="table-responsive">
      <table class="table table-bordered table-zed">
        <thead>
          <tr>
            <th class="text-center" style="width: 60px">S.No</th><th>Incentive</th><th>Details</th><th>Ministry/Department Associated</th><th>Contact Person</th>
            <th class="text-center">Web Link</th><th class="text-center">Applicable for</th><th class="text-center" style="width: 90px">Action</th><th class="text-center" style="width: 170px">Upload Documents</th>
          </tr>
        </thead>
        <tbody>
          @for (item of view.page(); track item.incentive['Id']) {
            <tr>
              <td class="text-center">{{ view.serial($index) }}</td>
              <td><strong>{{ item.incentive['Incentive'] }}</strong></td>
              <td class="description">
                @if (details(item); as d) {
                  <div [class.clamp-3]="!expanded().has(id(item))" [title]="d">{{ d }}</div>
                  @if (d.length > 160) {
                    <button type="button" class="btn btn-link btn-sm p-0" (click)="toggle(id(item))">{{ expanded().has(id(item)) ? 'less' : 'more' }}</button>
                  }
                }
              </td>
              <td>{{ item.incentive['MinistryOrDepartment'] }}</td>
              <td>{{ item.incentive['ContactPerson'] }}</td>
              <td class="text-center">
                @if (httpLink(item.incentive['WebLink']); as link) {
                  <a [href]="link" target="_blank" rel="noopener noreferrer">Web Link</a>
                } @else { {{ item.incentive['WebLink'] }} }
              </td>
              <td class="text-center">
                @if (item.incentive['ApplicableForBronze']) { <span class="zed-chip">Bronze</span> }
                @if (item.incentive['ApplicableForSilver']) { <span class="zed-chip">Silver</span> }
                @if (item.incentive['ApplicableForGold']) { <span class="zed-chip">Gold</span> }
              </td>
              <td class="text-center"><div class="row-actions justify-content-center"><button type="button" class="btn btn-outline-primary" (click)="edit(item)">Edit</button></div></td>
              <td class="text-center">
                @for (n of [1, 2]; track n) {
                  <div class="doc-line">
                    <label class="btn btn-sm btn-outline-primary mb-0">
                      Doc {{ n }}
                      <input type="file" class="d-none" accept="application/pdf" (change)="uploadDoc(item, n === 1 ? 1 : 2, $event)" />
                    </label>
                    @if (n === 1 ? item.hasDocument1 : item.hasDocument2) {
                      <a [href]="docUrl(item, n)" target="_blank" rel="noopener" [attr.aria-label]="'Document ' + n"><img src="Images/svgicons/pdf-icon.svg" alt="" height="26" /></a>
                    }
                  </div>
                }
              </td>
            </tr>
          } @empty {
            @if (!busy()) { <tr><td colspan="9" style="padding: 0"><div class="no-data">No Data</div></td></tr> }
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="view" />
    @if (editingId() && editForm(); as e) {
      <!-- As the live page: Edit opens the "Edit Incentive" pop-up. -->
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="edit-incentive-title">
        <div class="modal-dialog modal-popup modal-lg">
          <div class="modal-content">
            <div class="modal-header">
              <h3 class="registration-title m-0" id="edit-incentive-title">Edit Incentive</h3>
              <button type="button" class="btn-close" aria-label="Close" (click)="cancelEdit()"></button>
            </div>
            <form (ngSubmit)="saveEdit()" novalidate>
              <div class="modal-body">
                @for (f of fields; track f.key) {
                  <div class="mb-2">
                    <label class="form-label" [for]="'edit-' + f.key">{{ f.label }}@if (f.required) {<span class="req">*</span>}</label>
                    <input class="form-control" [id]="'edit-' + f.key" [name]="'edit-' + f.key" [attr.maxlength]="f.max" [ngModel]="e[f.key]" (ngModelChange)="patchEdit(f.key, $event)" />
                  </div>
                }
                <div class="mb-2">
                  <span class="form-label">Active<span class="req">*</span></span>
                  <input type="checkbox" class="form-check-input ms-2" name="edit-active" aria-label="Active" [ngModel]="e.activeStatus" (ngModelChange)="patchEdit('activeStatus', $event)" />
                </div>
                @if (editError()) { <div class="alert alert-danger mb-0" role="alert">{{ editError() }}</div> }
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" (click)="cancelEdit()">CANCEL</button>
                <button type="submit" class="btn btn-primary" [disabled]="busy()">UPDATE</button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    .check-row { display: flex; flex-wrap: wrap; gap: 8px 20px; }
    .check-row .form-check-input { margin-right: 6px; }
    .description { white-space: pre-wrap; min-width: 220px; }
    .doc-line { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 6px; }
    .doc-line:last-child { margin-bottom: 0; }
  `,
})
export class IncentiveMasterPage {
  private readonly api = inject(IncentivesApi);

  protected readonly types = INCENTIVE_TYPES;
  protected readonly fields: { key: keyof IncentiveForm; label: string; max: number; required: boolean; hint?: string }[] = [
    { key: 'incentive', label: 'Incentive', max: 4000, required: true },
    { key: 'details', label: 'Details', max: 4000, required: true },
    { key: 'ministryOrDepartment', label: 'Ministry/Department Associated', max: 4000, required: true },
    { key: 'contactPerson', label: 'Contact Person with Designation', max: 2000, required: true },
    { key: 'email', label: 'Email', max: 200, required: true },
    { key: 'mobileNo', label: 'Mobile/ Phone Number', max: 15, required: true },
    { key: 'webLink', label: 'Web Link', max: 1000, required: true, hint: 'Full address starting with https:// (or --- for none).' },
    { key: 'videoLink', label: 'Video Link', max: 2000, required: false, hint: 'Full address starting with https://.' },
  ];

  protected readonly type = signal(inject(ActivatedRoute).snapshot.queryParamMap.get('type') || 'Common');
  protected readonly items = signal<CatalogueItem[]>([]);
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly view = new PagedView(() => this.items());
  protected readonly form = signal<IncentiveForm>(emptyForm(this.type()));
  protected readonly editingId = signal<number | null>(null);
  /** The incentive in the Edit pop-up (the form above the list only adds). */
  protected readonly editForm = signal<IncentiveForm | null>(null);
  protected readonly editError = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  /** Incentives whose details are unfolded (long details show three lines). */
  protected readonly expanded = signal<ReadonlySet<number>>(new Set());

  constructor() {
    // The type follows ?type= (the menu's Incentives drop-down).
    inject(ActivatedRoute).queryParamMap.pipe(takeUntilDestroyed()).subscribe((q) => {
      const type = q.get('type') || 'Common';
      if (type !== this.type() || this.items().length === 0) {
        this.type.set(type);
        this.cancelEdit();
        this.form.set(emptyForm(type));
        void this.load();
      }
    });
  }

  protected id(item: CatalogueItem): number {
    return Number(item.incentive['Id']);
  }

  protected details(item: CatalogueItem): string {
    const d = item.incentive['Details'];
    return d === null || d === undefined ? '' : String(d);
  }

  protected toggle(id: number): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  protected typeLabel(): string {
    return this.types.find((t) => t.value === this.type())?.label ?? this.type();
  }

  protected patch(key: keyof IncentiveForm, value: string): void {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  protected patchBool(key: keyof IncentiveForm, value: boolean): void {
    this.form.update((f) => ({ ...f, [key]: !!value }));
  }

  protected patchEdit(key: keyof IncentiveForm, value: string | boolean): void {
    this.editForm.update((f) => (f ? { ...f, [key]: key === 'activeStatus' ? !!value : value } : f));
  }

  protected edit(item: CatalogueItem): void {
    const r = item.incentive;
    const s = (k: string) => (r[k] === null || r[k] === undefined ? '' : String(r[k]));
    this.success.set('');
    this.editError.set('');
    this.editingId.set(Number(r['Id']));
    this.editForm.set({
      incentiveType: this.type(), incentive: s('Incentive'), details: s('Details'), ministryOrDepartment: s('MinistryOrDepartment'),
      contactPerson: s('ContactPerson'), webLink: s('WebLink'), email: s('Email'), mobileNo: s('MobileNo'), videoLink: s('VideoLink'),
      applicableForBronze: !!r['ApplicableForBronze'], applicableForSilver: !!r['ApplicableForSilver'], applicableForGold: !!r['ApplicableForGold'],
      activeStatus: !!r['ActiveStatus'],
    });
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.editForm.set(null);
  }

  /** Adds an incentive of the current type (the form above the list). */
  protected async save(): Promise<void> {
    const f = { ...this.form(), incentiveType: this.type() };
    const missing = this.fields.find((x) => x.required && !String(f[x.key] ?? '').trim());
    if (missing) {
      this.error.set(`${missing.label} required.`);
      return;
    }
    await this.run(() => this.api.create(f), () => this.form.set(emptyForm(this.type())));
  }

  /** Saves the Edit pop-up. */
  protected async saveEdit(): Promise<void> {
    const id = this.editingId();
    const e = this.editForm();
    if (!id || !e) return;
    const f = { ...e, incentiveType: this.type() };
    const missing = this.fields.find((x) => x.required && !String(f[x.key] ?? '').trim());
    if (missing) {
      this.editError.set(`${missing.label} required.`);
      return;
    }
    await this.run(() => this.api.update(id, f), () => this.cancelEdit());
  }

  protected async uploadDoc(item: CatalogueItem, n: 1 | 2, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_INCENTIVE_DOC_BYTES || !/\.pdf$/i.test(file.name)) {
      this.error.set('Please upload a valid PDF document (less than 2 MB).');
      return;
    }
    await this.run(() => this.api.uploadDocument(Number(item.incentive['Id']), n, this.type(), file), () => undefined);
  }

  protected docUrl(item: CatalogueItem, n: number): string {
    return `/api/staff/schemes/incentive-master/${encodeURIComponent(String(item.incentive['Id']))}/documents/${n}`;
  }

  /** Only http(s) links are rendered as links. */
  protected httpLink(value: unknown): string | null {
    const s = typeof value === 'string' ? value.trim() : '';
    return /^https?:\/\/[^\s]+$/i.test(s) ? s : null;
  }

  private async load(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      this.items.set(await firstValueFrom(this.api.catalogue(this.type())));
    } catch (err) {
      this.items.set([]);
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async run(action: () => ReturnType<IncentivesApi['create']>, done: () => void): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const r = await firstValueFrom(action());
      done();
      this.success.set(r.message);
      this.items.set(await firstValueFrom(this.api.catalogue(this.type())));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
