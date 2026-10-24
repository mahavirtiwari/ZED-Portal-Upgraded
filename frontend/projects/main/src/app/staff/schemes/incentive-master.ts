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
    <div class="container form-page" id="zed_user_form">
      <div class="row justify-content-center mt-3">
        <div class="col-sm-10">
          <!-- As the live page: the type comes from the menu's Incentives drop-down (?type=). -->
          <h3 class="registration-title">Incentives ({{ typeLabel() }})</h3>
          @if (error()) {
            <div class="alert alert-danger" role="alert">{{ error() }}</div>
          }
          @if (success()) {
            <div class="alert alert-success" role="status">{{ success() }}</div>
          }

          <form class="jumbotron form-horizontal mb-3" (ngSubmit)="save()" novalidate>
            @for (f of fields; track f.key) {
              <div class="row mb-3">
                <label class="col-sm-3" [for]="'inc-' + f.key">{{ f.label }}@if (f.required) {<span style="color: red">*</span>}</label>
                <div class="col-sm-9">
                  <input class="form-control" [id]="'inc-' + f.key" [name]="f.key" [attr.maxlength]="f.max" [ngModel]="form()[f.key]" (ngModelChange)="patch(f.key, $event)" />
                  @if (f.hint) { <small class="text-muted">{{ f.hint }}</small> }
                </div>
              </div>
            }
            <div class="row mb-3">
              <div class="col-sm-3">Applicable for<span style="color: red">*</span></div>
              <div class="col-sm-9 d-flex gap-3">
                <label><input type="checkbox" name="b" [ngModel]="form().applicableForBronze" (ngModelChange)="patchBool('applicableForBronze', $event)" /> Bronze</label>
                <label><input type="checkbox" name="s" [ngModel]="form().applicableForSilver" (ngModelChange)="patchBool('applicableForSilver', $event)" /> Silver</label>
                <label><input type="checkbox" name="g" [ngModel]="form().applicableForGold" (ngModelChange)="patchBool('applicableForGold', $event)" /> Gold</label>
              </div>
            </div>
            <div class="row mb-3">
              <div class="col-sm-3">Active<span style="color: red">*</span></div>
              <div class="col-sm-9"><input type="checkbox" name="active" aria-label="Active" [ngModel]="form().activeStatus" (ngModelChange)="patchBool('activeStatus', $event)" /></div>
            </div>
            <div class="d-flex justify-content-end gap-2">
              <button type="submit" class="btn btn-primary" style="min-width: 200px" [disabled]="busy()">SAVE</button>
            </div>
          </form>

          <div class="table-responsive">
            <table class="table table-bordered table-zed">
              <thead>
                <tr>
                  <th>S.No</th><th>Incentive</th><th>Details</th><th>Ministry/Department Associated</th><th>Contact Person</th>
                  <th>Web Link</th><th>Applicable for</th><th>Action</th><th>Upload Documents</th>
                </tr>
              </thead>
              <tbody>
                @for (item of view.page(); track item.incentive['Id']) {
                  <tr>
                    <td>{{ view.serial($index) }}</td>
                    <td>{{ item.incentive['Incentive'] }}</td>
                    <td>{{ item.incentive['Details'] }}</td>
                    <td>{{ item.incentive['MinistryOrDepartment'] }}</td>
                    <td>{{ item.incentive['ContactPerson'] }}</td>
                    <td>
                      @if (httpLink(item.incentive['WebLink']); as link) {
                        <a [href]="link" target="_blank" rel="noopener noreferrer">Web Link</a>
                      } @else { {{ item.incentive['WebLink'] }} }
                    </td>
                    <td>
                      @if (item.incentive['ApplicableForBronze']) { Bronze<br /> }
                      @if (item.incentive['ApplicableForSilver']) { Silver<br /> }
                      @if (item.incentive['ApplicableForGold']) { Gold }
                    </td>
                    <td><button type="button" class="btn btn-danger btn-sm" style="width: 100px" (click)="edit(item)">Edit</button></td>
                    <td style="min-width: 200px">
                      @for (n of [1, 2]; track n) {
                        <div class="mb-2">
                          @if (n === 1 ? item.hasDocument1 : item.hasDocument2) {
                            <a [href]="docUrl(item, n)" target="_blank" rel="noopener" [attr.aria-label]="'Document ' + n"><img src="Images/svgicons/pdf-icon.svg" alt="" /></a>
                          }
                          <label class="btn btn-md btn-primary mt-1 mb-0">
                            Doc {{ n }}
                            <input type="file" class="d-none" accept="application/pdf" (change)="uploadDoc(item, n === 1 ? 1 : 2, $event)" />
                          </label>
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
        </div>
      </div>
    </div>
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
                    <label [for]="'edit-' + f.key"><strong>{{ f.label }}@if (f.required) {<span style="color: red">*</span>}</strong></label>
                    <input class="form-control" [id]="'edit-' + f.key" [name]="'edit-' + f.key" [attr.maxlength]="f.max" [ngModel]="e[f.key]" (ngModelChange)="patchEdit(f.key, $event)" />
                  </div>
                }
                <div class="mb-2">
                  <strong>Active<span style="color: red">*</span></strong>
                  <input type="checkbox" class="ms-2" name="edit-active" aria-label="Active" [ngModel]="e.activeStatus" (ngModelChange)="patchEdit('activeStatus', $event)" />
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
  styles: `.loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }`,
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
