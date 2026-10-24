import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';

export interface AppFormItem {
  key: string;
  name: string;
  /** Which app fills it in. */
  app: string;
  fields: number;
  customFields: number;
  disabled: number;
  updatedOn: string | null;
}

export interface AppFieldItem {
  /** Stable key; a column of a row field is `rows/column`. */
  key: string;
  label: string;
  help: string | null;
  heading: string | null;
  type: string;
  required: boolean;
  enabled: boolean;
  /** Sent to the apps: enabled, and the field it depends on is shown. */
  active: boolean;
  /** Added by the Admin (otherwise a standard field of the app). */
  custom: boolean;
  section: string;
  order: number;
  options: string[] | null;
  optionsSource: string | null;
  maxItems: number | null;
  /** "Whether Exported? is Yes": the field is asked only then. */
  shownWhen: string | null;
  standardLabel: string | null;
  standardHelp: string | null;
  standardRequired: boolean | null;
  customised: boolean;
  updatedBy: string | null;
  updatedOn: string | null;
  columns: AppFieldItem[] | null;
}

export interface AppFormSection {
  key: string;
  label: string;
}

export interface AppFormDetails {
  form: AppFormItem;
  version: string;
  numbered: boolean;
  sections: AppFormSection[];
  customTypes: string[];
  fields: AppFieldItem[];
}

interface Editing {
  /** Null: a new field of the Admin's own. */
  field: AppFieldItem | null;
  custom: boolean;
  label: string;
  help: string;
  type: string;
  required: boolean;
  enabled: boolean;
  section: string;
  options: string[];
}

export const FIELD_TYPES: Record<string, string> = {
  text: 'Text',
  number: 'Whole number',
  decimal: 'Number with decimals',
  date: 'Date',
  yesno: 'Yes / No',
  dropdown: 'Drop-down (one choice)',
  multiselect: 'List (several choices)',
  checkboxes: 'Check boxes (several choices)',
  photo: 'Photo',
  rows: 'Repeating entries',
};

const CHOICE_TYPES = ['dropdown', 'multiselect', 'checkboxes'];

/**
 * Admin → App Forms (new in V4): the mobile apps' Basic Information forms of this system. An Admin can rename a standard
 * field, change its help text and position, make it required or optional, or disable it (its type stays); and add fields
 * of their own (text, numbers, date, yes/no, choices), edit and disable them. The apps load the form when they open it.
 */
@Component({
  selector: 'zed-staff-app-forms',
  imports: [DatePipe, FormsModule],
  template: `
    <div class="container-fluid form-page" id="zed_user_form">
      <div class="row justify-content-center mt-3">
        <div class="col-lg-11">
          <h3 class="registration-title">App Forms</h3>
          <p class="text-muted">
            Fields of the mobile apps' Basic Information forms. A change reaches the apps the next time they load the form; apps without a
            connection keep the last form they loaded.
          </p>
          @if (error()) {
            <div class="alert alert-danger" role="alert">{{ error() }}</div>
          }
          @if (success()) {
            <div class="alert alert-success" role="status">{{ success() }}</div>
          }
          <div class="row mb-3 g-2 align-items-end">
            <div class="col-sm-8 col-md-6">
              <label class="form-label" for="appForm"><strong>Form</strong></label>
              <select class="form-select" id="appForm" [ngModel]="formKey()" (ngModelChange)="choose($event)">
                @for (f of forms(); track f.key) {
                  <option [value]="f.key">{{ f.name }} · {{ f.app }}</option>
                }
              </select>
            </div>
            @if (details()) {
              <div class="col-sm-4 col-md-6 text-sm-end">
                <button type="button" class="btn btn-primary" (click)="add()">Add field</button>
              </div>
            }
          </div>

          @if (details(); as d) {
            @for (s of d.sections; track s.key) {
              <h5 class="mt-3">{{ s.label }}</h5>
              <div class="table-responsive">
                <table class="table table-zed table-bordered bg-white">
                  <thead>
                    <tr class="btn-default text-center"><th>#</th><th>Field</th><th>Type</th><th>Required</th><th>Status</th><th>Last change</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    @for (f of inSection(s.key); track f.key; let i = $index, last = $last) {
                      <tr [class.text-muted]="!f.active" [attr.data-key]="f.key">
                        <td class="text-center">{{ i + 1 }}</td>
                        <td>
                          @if (f.heading) { <small class="text-muted d-block">{{ f.heading }}</small> }
                          {{ f.label }}
                          @if (f.custom) { <span class="badge bg-info text-dark ms-1">Added</span> }
                          @if (f.standardLabel && f.standardLabel !== f.label) { <small class="text-muted d-block">Standard: {{ f.standardLabel }}</small> }
                          @if (f.help) { <small class="d-block">{{ f.help }}</small> }
                          @if (f.shownWhen) { <small class="text-muted d-block">Asked when {{ f.shownWhen }}</small> }
                          @if (f.options?.length) { <small class="text-muted d-block">Choices: {{ f.options!.join(', ') }}</small> }
                        </td>
                        <td>{{ typeName(f) }}</td>
                        <td class="text-center">{{ f.required ? 'Yes' : 'No' }}</td>
                        <td>
                          <span [class]="f.enabled ? (f.active ? 'text-success' : 'text-warning') : 'text-danger'">{{ status(f) }}</span>
                        </td>
                        <td>@if (f.updatedOn) { {{ f.updatedOn | date: 'dd-MM-yyyy HH:mm' }}<br /><small class="text-muted">{{ f.updatedBy }}</small> }</td>
                        <td class="text-nowrap">
                          <button type="button" class="btn btn-default btn-sm" title="Move up" aria-label="Move up" [disabled]="i === 0 || busy()" (click)="move(s.key, i, -1)">↑</button>
                          <button type="button" class="btn btn-default btn-sm ms-1" title="Move down" aria-label="Move down" [disabled]="last || busy()" (click)="move(s.key, i, 1)">↓</button>
                          <button type="button" class="btn btn-primary btn-sm ms-1" (click)="edit(f)">Edit</button>
                          <button type="button" class="btn btn-default btn-sm ms-1" (click)="toggle(f)">{{ f.enabled ? 'Disable' : 'Enable' }}</button>
                          @if (f.customised && !f.custom) { <button type="button" class="btn btn-default btn-sm ms-1" (click)="reset(f)">Reset</button> }
                        </td>
                      </tr>
                      @for (c of f.columns ?? []; track c.key) {
                        <tr class="column" [class.text-muted]="!c.active" [attr.data-key]="c.key">
                          <td></td>
                          <td class="ps-4">↳ {{ c.label }}
                            @if (c.standardLabel && c.standardLabel !== c.label) { <small class="text-muted d-block">Standard: {{ c.standardLabel }}</small> }
                            @if (c.help) { <small class="d-block">{{ c.help }}</small> }
                          </td>
                          <td>{{ typeName(c) }}</td>
                          <td class="text-center">{{ c.required ? 'Yes' : 'No' }}</td>
                          <td><span [class]="c.enabled ? 'text-success' : 'text-danger'">{{ c.enabled ? 'Shown' : 'Disabled' }}</span></td>
                          <td>@if (c.updatedOn) { {{ c.updatedOn | date: 'dd-MM-yyyy HH:mm' }}<br /><small class="text-muted">{{ c.updatedBy }}</small> }</td>
                          <td class="text-nowrap">
                            <button type="button" class="btn btn-primary btn-sm" (click)="edit(c)">Edit</button>
                            <button type="button" class="btn btn-default btn-sm ms-1" (click)="toggle(c)">{{ c.enabled ? 'Disable' : 'Enable' }}</button>
                            @if (c.customised) { <button type="button" class="btn btn-default btn-sm ms-1" (click)="reset(c)">Reset</button> }
                          </td>
                        </tr>
                      }
                    } @empty {
                      <tr><td colspan="7" style="padding: 0"><div class="no-data">No fields</div></td></tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          } @else if (!busy() && !forms().length) {
            <div class="no-data">No app forms on this portal</div>
          }
        </div>
      </div>
    </div>

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="fieldTitle">
        <div class="modal-dialog modal-lg modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header justify-content-between">
              <div class="modal-title" id="fieldTitle"><strong>{{ e.field ? 'Edit field' : 'Add field' }}</strong>
                @if (e.field && !e.custom) { <small class="text-muted"> · standard field of the app</small> }
              </div>
              <button type="button" class="close btn btn-link" aria-label="Close" (click)="editing.set(null)"><strong>x&nbsp;</strong></button>
            </div>
            <div class="modal-body">
              <div class="mb-3">
                <label class="form-label" for="fieldLabel"><strong>Label</strong></label>
                <input type="text" class="form-control" id="fieldLabel" maxlength="200" [(ngModel)]="e.label" />
                @if (e.field?.standardLabel; as standard) { <small class="text-muted">Standard: {{ standard }}</small> }
              </div>
              <div class="mb-3">
                <label class="form-label" for="fieldHelp"><strong>Help text</strong> <small class="text-muted">(optional, shown under the field)</small></label>
                <textarea class="form-control" id="fieldHelp" rows="2" maxlength="500" [(ngModel)]="e.help"></textarea>
              </div>
              @if (e.custom) {
                <div class="row g-3 mb-3">
                  <div class="col-sm-6">
                    <label class="form-label" for="fieldType"><strong>Type</strong></label>
                    <select class="form-select" id="fieldType" [(ngModel)]="e.type">
                      @for (t of details()?.customTypes ?? []; track t) { <option [value]="t">{{ types[t] ?? t }}</option> }
                    </select>
                  </div>
                  @if ((details()?.sections?.length ?? 0) > 1) {
                    <div class="col-sm-6">
                      <label class="form-label" for="fieldSection"><strong>Section</strong></label>
                      <select class="form-select" id="fieldSection" [(ngModel)]="e.section">
                        @for (s of details()!.sections; track s.key) { <option [value]="s.key">{{ s.label }}</option> }
                      </select>
                    </div>
                  }
                </div>
                @if (isChoice(e.type)) {
                  <div class="mb-3 choices">
                    <span class="form-label d-block"><strong>Choices</strong></span>
                    @for (o of e.options; track $index; let i = $index) {
                      <div class="input-group input-group-sm mb-1">
                        <input type="text" class="form-control" maxlength="100" [attr.aria-label]="'Choice ' + (i + 1)" [(ngModel)]="e.options[i]" />
                        <button type="button" class="btn btn-outline-secondary" [attr.aria-label]="'Remove choice ' + (i + 1)" (click)="removeOption(e, i)">Remove</button>
                      </div>
                    }
                    <button type="button" class="btn btn-link btn-sm p-0" (click)="addOption(e)">Add choice</button>
                  </div>
                }
              } @else {
                <p class="mb-3"><strong>Type:</strong> {{ typeName(e.field!) }} <small class="text-muted">(the type of a standard field cannot be changed)</small></p>
              }
              <div class="form-check mb-2">
                <input class="form-check-input" type="checkbox" id="fieldRequired" [(ngModel)]="e.required" />
                <label class="form-check-label" for="fieldRequired">Required
                  @if (e.field && !e.custom && e.field.standardRequired !== null) { <small class="text-muted">(standard: {{ e.field.standardRequired ? 'required' : 'optional' }})</small> }
                </label>
              </div>
              <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" role="switch" id="fieldEnabled" [(ngModel)]="e.enabled" />
                <label class="form-check-label" for="fieldEnabled">{{ e.enabled ? 'Shown in the apps' : 'Disabled (not shown, answers are kept)' }}</label>
              </div>
              @if (modalError()) { <div class="alert alert-danger mt-3" role="alert">{{ modalError() }}</div> }
            </div>
            <div class="modal-footer">
              <input type="button" class="btn btn-default" value="CANCEL" (click)="editing.set(null)" />
              <input type="button" class="btn btn-primary" value="SAVE" [disabled]="busy()" (click)="save(e)" />
            </div>
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
    tr.column td { background: #f8f9fa; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }`,
})
export class AppFormsPage {
  private readonly http = inject(HttpClient);
  private static readonly url = '/api/staff/settings/app-forms';

  protected readonly types = FIELD_TYPES;
  protected readonly forms = signal<AppFormItem[]>([]);
  protected readonly formKey = signal('');
  protected readonly details = signal<AppFormDetails | null>(null);
  protected readonly editing = signal<Editing | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly modalError = signal('');
  private readonly bySection = computed(() => {
    const map = new Map<string, AppFieldItem[]>();
    for (const f of this.details()?.fields ?? []) map.set(f.section, [...(map.get(f.section) ?? []), f]);
    return map;
  });

  constructor() {
    void this.loadForms();
  }

  protected inSection(section: string): AppFieldItem[] {
    return this.bySection().get(section) ?? [];
  }

  protected typeName(f: AppFieldItem): string {
    const name = FIELD_TYPES[f.type] ?? f.type;
    return f.maxItems && f.type === 'photo' ? `${name} (up to ${f.maxItems})` : name;
  }

  protected status(f: AppFieldItem): string {
    if (!f.enabled) return 'Disabled';
    return f.active ? 'Shown' : 'Not shown (depends on a disabled field)';
  }

  protected isChoice(type: string): boolean {
    return CHOICE_TYPES.includes(type);
  }

  protected async choose(key: string): Promise<void> {
    this.formKey.set(key);
    this.success.set('');
    await this.loadForm();
  }

  protected add(): void {
    const d = this.details();
    if (!d) return;
    this.modalError.set('');
    this.editing.set({ field: null, custom: true, label: '', help: '', type: 'text', required: false, enabled: true, section: d.sections[0]?.key ?? '', options: [''] });
  }

  protected edit(f: AppFieldItem): void {
    this.modalError.set('');
    this.editing.set({
      field: f,
      custom: f.custom,
      label: f.label,
      help: f.help ?? '',
      type: f.type,
      required: f.required,
      enabled: f.enabled,
      section: f.section,
      options: f.options?.length ? [...f.options] : [''],
    });
  }

  protected addOption(e: Editing): void {
    e.options.push('');
  }

  protected removeOption(e: Editing, index: number): void {
    e.options.splice(index, 1);
    if (!e.options.length) e.options.push('');
  }

  protected async save(e: Editing): Promise<void> {
    const body = {
      key: e.field?.key ?? null,
      label: e.label.trim(),
      help: e.help.trim() || null,
      type: e.custom ? e.type : null,
      required: e.required,
      enabled: e.enabled,
      section: e.custom ? e.section : null,
      options: e.custom && this.isChoice(e.type) ? e.options.map((o) => o.trim()).filter((o) => o) : null,
    };
    this.busy.set(true);
    this.modalError.set('');
    try {
      const url = `${AppFormsPage.url}/${encodeURIComponent(this.formKey())}/fields`;
      const r = e.field
        ? await firstValueFrom(this.http.put<MessageResponse>(url, body))
        : await firstValueFrom(this.http.post<MessageResponse>(url, body));
      this.editing.set(null);
      this.success.set(r.message);
      await this.loadForm();
    } catch (err) {
      this.modalError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected toggle(f: AppFieldItem): Promise<void> {
    return this.change(() => this.http.put<MessageResponse>(`${this.formUrl()}/enabled`, { key: f.key, enabled: !f.enabled }));
  }

  protected move(section: string, index: number, by: -1 | 1): Promise<void> {
    const keys = this.inSection(section).map((f) => f.key);
    const target = index + by;
    if (target < 0 || target >= keys.length) return Promise.resolve();
    [keys[index], keys[target]] = [keys[target], keys[index]];
    return this.change(() => this.http.put<MessageResponse>(`${this.formUrl()}/order`, { section, keys }));
  }

  protected reset(f: AppFieldItem): Promise<void> {
    if (!confirm(`Use the standard field again for "${f.label}"?`)) return Promise.resolve();
    return this.change(() => this.http.post<MessageResponse>(`${this.formUrl()}/reset`, { key: f.key }));
  }

  private formUrl(): string {
    return `${AppFormsPage.url}/${encodeURIComponent(this.formKey())}`;
  }

  private async change(request: () => Observable<MessageResponse>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const r = await firstValueFrom(request());
      this.success.set(r.message);
      await this.loadForm();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async loadForms(): Promise<void> {
    this.busy.set(true);
    try {
      const forms = await firstValueFrom(this.http.get<AppFormItem[]>(AppFormsPage.url));
      this.forms.set(forms);
      if (forms.length) {
        this.formKey.set(forms[0].key);
        await this.loadForm();
      }
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async loadForm(): Promise<void> {
    this.busy.set(true);
    try {
      this.details.set(await firstValueFrom(this.http.get<AppFormDetails>(this.formUrl())));
    } catch (err) {
      this.details.set(null);
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
