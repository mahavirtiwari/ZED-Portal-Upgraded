import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { CatalogueItem, INCENTIVE_TYPES, IncentiveForm, IncentivesApi } from './incentives.api';

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
  imports: [FormsModule],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="row justify-content-center mt-3">
        <div class="col-sm-10">
          <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <h3 class="registration-title">Incentives ({{ typeLabel() }})</h3>
            <select class="form-select w-auto" aria-label="Incentive type" [ngModel]="type()" (ngModelChange)="changeType($event)">
              @for (t of types; track t.value) { <option [value]="t.value">{{ t.label }}</option> }
            </select>
          </div>
          @if (error()) {
            <div class="alert alert-danger" role="alert">{{ error() }}</div>
          }
          @if (success()) {
            <div class="alert alert-success" role="status">{{ success() }}</div>
          }

          <form class="jumbotron form-horizontal mb-3" (ngSubmit)="save()" novalidate>
            <h5>{{ editingId() ? 'Edit Incentive' : 'Add Incentive' }}</h5>
            @for (f of fields; track f.key) {
              <div class="row mb-3">
                <label class="col-sm-3" [for]="'inc-' + f.key">{{ f.label }}@if (f.required) {<span style="color: red">*</span>}</label>
                <div class="col-sm-9">
                  <input class="form-control" [id]="'inc-' + f.key" [name]="f.key" [attr.maxlength]="f.max" [ngModel]="form()[f.key]" (ngModelChange)="patch(f.key, $event)" />
                  @if (f.hint) { <small class="text-muted">{{ f.hint }}</small> }
                </div>
              </div>
            }
            @if (!editingId()) {
              <div class="row mb-3">
                <div class="col-sm-3">Applicable for<span style="color: red">*</span></div>
                <div class="col-sm-9 d-flex gap-3">
                  <label><input type="checkbox" name="b" [ngModel]="form().applicableForBronze" (ngModelChange)="patchBool('applicableForBronze', $event)" /> Bronze</label>
                  <label><input type="checkbox" name="s" [ngModel]="form().applicableForSilver" (ngModelChange)="patchBool('applicableForSilver', $event)" /> Silver</label>
                  <label><input type="checkbox" name="g" [ngModel]="form().applicableForGold" (ngModelChange)="patchBool('applicableForGold', $event)" /> Gold</label>
                </div>
              </div>
            }
            <div class="row mb-3">
              <div class="col-sm-3">Active</div>
              <div class="col-sm-9"><input type="checkbox" name="active" aria-label="Active" [ngModel]="form().activeStatus" (ngModelChange)="patchBool('activeStatus', $event)" /></div>
            </div>
            <div class="d-flex justify-content-end gap-2">
              @if (editingId()) { <button type="button" class="btn btn-default" (click)="cancelEdit()">CANCEL</button> }
              <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ editingId() ? 'UPDATE' : 'SUBMIT' }}</button>
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
                @for (item of items(); track item.incentive['Id']) {
                  <tr>
                    <td>{{ $index + 1 }}</td>
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
        </div>
      </div>
    </div>
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `.loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }`,
})
export class IncentiveMasterPage {
  private readonly api = inject(IncentivesApi);
  private readonly router = inject(Router);

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
  protected readonly form = signal<IncentiveForm>(emptyForm(this.type()));
  protected readonly editingId = signal<number | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');

  constructor() {
    void this.load();
  }

  protected typeLabel(): string {
    return this.types.find((t) => t.value === this.type())?.label ?? this.type();
  }

  protected changeType(value: string): void {
    this.type.set(value);
    this.cancelEdit();
    void this.router.navigate([], { queryParams: { type: value }, replaceUrl: true });
    void this.load();
  }

  protected patch(key: keyof IncentiveForm, value: string): void {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  protected patchBool(key: keyof IncentiveForm, value: boolean): void {
    this.form.update((f) => ({ ...f, [key]: !!value }));
  }

  protected edit(item: CatalogueItem): void {
    const r = item.incentive;
    const s = (k: string) => (r[k] === null || r[k] === undefined ? '' : String(r[k]));
    this.success.set('');
    this.editingId.set(Number(r['Id']));
    this.form.set({
      incentiveType: this.type(), incentive: s('Incentive'), details: s('Details'), ministryOrDepartment: s('MinistryOrDepartment'),
      contactPerson: s('ContactPerson'), webLink: s('WebLink'), email: s('Email'), mobileNo: s('MobileNo'), videoLink: s('VideoLink'),
      applicableForBronze: !!r['ApplicableForBronze'], applicableForSilver: !!r['ApplicableForSilver'], applicableForGold: !!r['ApplicableForGold'],
      activeStatus: !!r['ActiveStatus'],
    });
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.form.set(emptyForm(this.type()));
  }

  protected async save(): Promise<void> {
    const f = { ...this.form(), incentiveType: this.type() };
    const missing = this.fields.find((x) => x.required && !String(f[x.key] ?? '').trim());
    if (missing) {
      this.error.set(`${missing.label} required.`);
      return;
    }
    const id = this.editingId();
    await this.run(() => (id ? this.api.update(id, f) : this.api.create(f)), () => this.cancelEdit());
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
