import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { CollapseCard } from '../collapse-card';
import { MultiSelect, MultiSelectOption } from '../users/multi-select';

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
  /** V4: the level codes it is asked for, and the NIC 2-digit sectors of the units it is asked of; empty = all. */
  levels?: string[] | null;
  nicSectors?: string[] | null;
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
  /** The certification levels a field can be limited to (Administration → Certification Levels). */
  levels?: { code: string; name: string }[] | null;
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
  /** Empty: all levels / all sectors. */
  levels: string[];
  nicSectors: string[];
  /** "Only these levels / sectors" chosen (the lists show); off empties the list. */
  limitLevels: boolean;
  limitSectors: boolean;
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

/** A small sign per type, on the type tiles of the pop-up. */
const TYPE_GLYPHS: Record<string, string> = {
  text: 'Aa', number: '123', decimal: '1.5', date: '31', yesno: 'Y/N', dropdown: '▾', multiselect: '☰', checkboxes: '☑', photo: '▣', rows: '⊞',
};

/**
 * Admin → App Forms (new in V4): the mobile apps' Basic Information forms of this system. An Admin can rename a standard
 * field, change its help text and position, make it required or optional, or disable it (its type stays); and add fields
 * of their own (text, numbers, date, yes/no, choices), edit and disable them. The apps load the form when they open it.
 * V4 layout: Add field in the page head, one tile per form with its counts, a card per section with the field's levels and
 * sectors as chips; the pop-up has the field (its type as tiles) and who is asked ("every level / sector" or only the
 * ones chosen) beside the preview of the field in the app and its settings (required, shown).
 */
@Component({
  selector: 'zed-staff-app-forms',
  imports: [DatePipe, FormsModule, CollapseCard, MultiSelect],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">App Forms</h3>
        <p class="page-sub">The Basic Information forms of the mobile apps: rename, reorder, make required, limit to levels and NIC sectors, or add fields of your own.</p>
      </div>
      @if (details()) {
        <div class="page-actions">
          <button type="button" class="btn btn-primary" (click)="add()">Add field</button>
        </div>
      }
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    @if (forms().length) {
      <div class="form-tiles" role="group" aria-label="Form">
        @for (f of forms(); track f.key) {
          <button type="button" class="form-tile" [class.active]="f.key === formKey()" [attr.aria-pressed]="f.key === formKey()" [attr.data-key]="f.key" (click)="choose(f.key)">
            <span class="tile-name">{{ f.name }}</span>
            <span class="tile-app">{{ f.app }}</span>
            <span class="tile-counts">
              <span>{{ f.fields }} fields</span>
              @if (f.customFields) { <span>{{ f.customFields }} added</span> }
              @if (f.disabled) { <span>{{ f.disabled }} disabled</span> }
            </span>
            @if (f.updatedOn) { <span class="tile-updated">Changed {{ f.updatedOn | date: 'dd-MM-yyyy' }}</span> }
          </button>
        }
      </div>
      <p class="sync-note">
        <span class="info-dot" aria-hidden="true">i</span>
        A change reaches the apps the next time they load the form; apps without a connection keep the last form they loaded.
      </p>
    }

    @if (details(); as d) {
      @for (s of d.sections; track s.key; let first = $first) {
        <zed-collapse-card [title]="s.label" [summary]="sectionSummary(s.key)" [open]="first">
        <div class="table-responsive">
          <table class="table table-zed fields-table">
            <colgroup>
              <col style="width: 56px" />
              <col />
              <col style="width: 150px" />
              <col style="width: 96px" />
              <col style="width: 130px" />
              <col style="width: 290px" />
            </colgroup>
            <thead>
              <tr>
                <th class="text-center">#</th>
                <th>Field</th>
                <th>Type</th>
                <th class="text-center">Required</th>
                <th class="text-center">Status</th>
                <th class="text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              @for (f of inSection(s.key); track f.key; let i = $index, last = $last) {
                <tr [class.is-off]="!f.active" [attr.data-key]="f.key">
                  <td class="text-center"><span class="order-no">{{ i + 1 }}</span></td>
                  <td>
                    @if (f.heading) { <small class="field-heading">{{ f.heading }}</small> }
                    <div class="field-label">
                      <strong>{{ f.label }}</strong>
                      @if (f.custom) { <span class="status-badge is-info">Added</span> }
                      @else if (f.customised) { <span class="status-badge is-pending">Changed</span> }
                    </div>
                    @if (f.standardLabel && f.standardLabel !== f.label) { <small class="field-note">Standard: {{ f.standardLabel }}</small> }
                    @if (f.help) { <small class="field-help">{{ f.help }}</small> }
                    @if (f.shownWhen) { <small class="field-note"><span class="cond">IF</span> Asked when {{ f.shownWhen }}</small> }
                    @if (f.options?.length) { <small class="field-note">Choices: {{ f.options!.join(', ') }}</small> }
                    @if (f.updatedOn) { <small class="changed-on">Changed {{ f.updatedOn | date: 'dd-MM-yyyy HH:mm' }}@if (f.updatedBy) { by {{ f.updatedBy }} }</small> }
                    <div class="scope" [title]="scopeText(f)">
                      @if (f.levels?.length) {
                        @for (l of f.levels!; track l) { <span class="zed-chip">{{ levelName(l) }}</span> }
                      } @else {
                        <span class="scope-all">All levels</span>
                      }
                      @if (f.nicSectors?.length) {
                        @for (c of f.nicSectors!; track c) { <span class="zed-chip sector">NIC {{ c }}</span> }
                      } @else {
                        <span class="scope-all">All sectors</span>
                      }
                    </div>
                  </td>
                  <td><span class="type-name">{{ typeName(f) }}</span></td>
                  <td class="text-center"><span class="status-badge" [class.is-info]="f.required" [class.is-inactive]="!f.required">{{ f.required ? 'Yes' : 'No' }}</span></td>
                  <td class="text-center">
                    <span class="status-badge wrap" [class.is-active]="f.enabled && f.active" [class.is-pending]="f.enabled && !f.active" [class.is-inactive]="!f.enabled">{{ status(f) }}</span>
                  </td>
                  <td>
                    <div class="row-actions justify-content-center">
                      <span class="move">
                        <button type="button" class="btn btn-default" title="Move up" aria-label="Move up" [disabled]="i === 0 || busy()" (click)="move(s.key, i, -1)">↑</button>
                        <button type="button" class="btn btn-default" title="Move down" aria-label="Move down" [disabled]="last || busy()" (click)="move(s.key, i, 1)">↓</button>
                      </span>
                      <button type="button" class="btn btn-outline-primary" (click)="edit(f)">Edit</button>
                      <button type="button" class="btn" [class.btn-outline-danger]="f.enabled" [class.btn-outline-primary]="!f.enabled" (click)="toggle(f)">{{ f.enabled ? 'Disable' : 'Enable' }}</button>
                      @if (f.customised && !f.custom) { <button type="button" class="btn btn-default" (click)="reset(f)">Reset</button> }
                    </div>
                  </td>
                </tr>
                @for (c of f.columns ?? []; track c.key) {
                  <tr class="column" [class.is-off]="!c.active" [attr.data-key]="c.key">
                    <td></td>
                    <td class="column-cell">↳ {{ c.label }}
                      @if (c.standardLabel && c.standardLabel !== c.label) { <small class="field-note">Standard: {{ c.standardLabel }}</small> }
                      @if (c.help) { <small class="field-help">{{ c.help }}</small> }
                      @if (c.updatedOn) { <small class="changed-on">Changed {{ c.updatedOn | date: 'dd-MM-yyyy HH:mm' }}@if (c.updatedBy) { by {{ c.updatedBy }} }</small> }
                    </td>
                    <td><span class="type-name">{{ typeName(c) }}</span></td>
                    <td class="text-center"><span class="status-badge" [class.is-info]="c.required" [class.is-inactive]="!c.required">{{ c.required ? 'Yes' : 'No' }}</span></td>
                    <td class="text-center"><span class="status-badge" [class.is-active]="c.enabled" [class.is-inactive]="!c.enabled">{{ c.enabled ? 'Shown' : 'Disabled' }}</span></td>
                    <td>
                      <div class="row-actions justify-content-center">
                        <button type="button" class="btn btn-outline-primary" (click)="edit(c)">Edit</button>
                        <button type="button" class="btn" [class.btn-outline-danger]="c.enabled" [class.btn-outline-primary]="!c.enabled" (click)="toggle(c)">{{ c.enabled ? 'Disable' : 'Enable' }}</button>
                        @if (c.customised) { <button type="button" class="btn btn-default" (click)="reset(c)">Reset</button> }
                      </div>
                    </td>
                  </tr>
                }
              } @empty {
                <tr><td colspan="6" style="padding: 0"><div class="no-data">No fields</div></td></tr>
              }
            </tbody>
          </table>
        </div>
        </zed-collapse-card>
      }
    } @else if (!busy() && !forms().length) {
      <div class="no-data">No app forms on this portal</div>
    }

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="fieldTitle">
        <div class="modal-dialog modal-xl modal-dialog-scrollable field-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-start gap-3">
                <div>
                  <h3 class="registration-title m-0" id="fieldTitle">{{ e.field ? 'Edit field' : 'Add field' }}</h3>
                  <small class="text-muted">
                    {{ details()?.form?.name }} · {{ details()?.form?.app }}
                    @if (e.field && !e.custom) { · standard field of the app }
                  </small>
                </div>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="editing.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <div class="modal-body">
              <div class="dialog-grid">
                <div class="dialog-main">
                  <section class="dialog-section">
                    <h4><span class="sec-no">1</span> Field</h4>
                    <div class="form-grid">
                      <label for="fieldLabel">Label<span class="req">*</span></label>
                      <div>
                        <input type="text" class="form-control" id="fieldLabel" maxlength="200" placeholder="The question the unit sees" [(ngModel)]="e.label" />
                        @if (e.field?.standardLabel; as standard) { <small class="text-muted">Standard: {{ standard }}</small> }
                      </div>
                      <label class="top" for="fieldHelp">Help text <small class="text-muted fw-normal d-block">(optional, shown under the field)</small></label>
                      <textarea class="form-control" id="fieldHelp" rows="2" maxlength="500" placeholder="A hint for the unit" [(ngModel)]="e.help"></textarea>
                      @if (e.custom) {
                        <span class="label top">Type</span>
                        <div class="type-grid" role="radiogroup" aria-label="Type">
                          @for (t of details()?.customTypes ?? []; track t) {
                            <label class="type-tile" [class.active]="e.type === t" [for]="'type-' + t">
                              <input type="radio" class="visually-hidden" name="fieldType" [id]="'type-' + t" [value]="t" [(ngModel)]="e.type" />
                              <span class="type-glyph" aria-hidden="true">{{ typeGlyph(t) }}</span>
                              <span class="type-name">{{ types[t] ?? t }}</span>
                            </label>
                          }
                        </div>
                        @if ((details()?.sections?.length ?? 0) > 1) {
                          <label for="fieldSection">Section</label>
                          <select class="form-select" id="fieldSection" [(ngModel)]="e.section">
                            @for (s of details()!.sections; track s.key) { <option [value]="s.key">{{ s.label }}</option> }
                          </select>
                        }
                        @if (isChoice(e.type)) {
                          <span class="label top">Choices</span>
                          <div class="choices">
                            @for (o of e.options; track $index; let i = $index) {
                              <div class="choice">
                                <span class="choice-no">{{ i + 1 }}</span>
                                <input type="text" class="form-control" maxlength="100" [attr.aria-label]="'Choice ' + (i + 1)" [(ngModel)]="e.options[i]" />
                                <button type="button" class="btn btn-link choice-remove" title="Remove" [attr.aria-label]="'Remove choice ' + (i + 1)" (click)="removeOption(e, i)">✕</button>
                              </div>
                            }
                            <button type="button" class="btn btn-outline-primary btn-sm add-choice" (click)="addOption(e)">Add choice</button>
                          </div>
                        }
                      } @else {
                        <span class="label">Type</span>
                        <span><span class="type-pill"><span aria-hidden="true">{{ typeGlyph(e.field!.type) }}</span> {{ typeName(e.field!) }}</span>
                          <small class="text-muted d-block">The type of a standard field cannot be changed.</small></span>
                      }
                    </div>
                  </section>

                  <section class="dialog-section">
                    <h4><span class="sec-no">2</span> Who is asked</h4>
                    <div class="form-grid">
                      @if (levelOptions().length) {
                        <span class="label top">Certification levels</span>
                        <div>
                          <div class="seg" role="group" aria-label="Certification levels">
                            <button type="button" [class.active]="!e.limitLevels" [attr.aria-pressed]="!e.limitLevels" (click)="limit('levels', false)">Every level</button>
                            <button type="button" [class.active]="e.limitLevels" [attr.aria-pressed]="e.limitLevels" (click)="limit('levels', true)">Only these levels</button>
                          </div>
                          @if (e.limitLevels) {
                            <div class="mt-2"><zed-multi-select inputId="fieldLevels" label="Certification levels" [options]="levelOptions()" [(value)]="e.levels" /></div>
                          }
                        </div>
                      }
                      <span class="label top">NIC sectors</span>
                      <div>
                        <div class="seg" role="group" aria-label="NIC sectors">
                          <button type="button" [class.active]="!e.limitSectors" [attr.aria-pressed]="!e.limitSectors" (click)="limit('sectors', false)">Every sector</button>
                          <button type="button" [class.active]="e.limitSectors" [attr.aria-pressed]="e.limitSectors" (click)="limit('sectors', true)">Only these sectors</button>
                        </div>
                        @if (e.limitSectors) {
                          <div class="mt-2"><zed-multi-select inputId="fieldSectors" label="NIC sectors" [options]="sectorOptions()" [(value)]="e.nicSectors" /></div>
                        }
                      </div>
                    </div>
                  </section>
                </div>

                <aside class="dialog-side">
                  <div class="dialog-preview" aria-label="Preview in the app">
                    <h4>Preview in the app</h4>
                    <div class="phone">
                      <div class="phone-notch" aria-hidden="true"></div>
                      <div class="phone-field" [class.is-off]="!e.enabled">
                        <div class="pf-label">{{ e.label || 'Label' }}@if (e.required) {<span class="req">*</span>}</div>
                        @switch (previewKind(e)) {
                          @case ('yesno') { <div class="pf-radios"><span><i></i> Yes</span><span><i></i> No</span></div> }
                          @case ('choice') {
                            @if (e.type === 'dropdown') {
                              <div class="pf-input pf-select">{{ firstChoice(e) || 'Select' }}</div>
                            } @else {
                              @for (o of previewChoices(e); track $index) { <div class="pf-check"><i></i> {{ o }}</div> }
                            }
                          }
                          @case ('photo') { <div class="pf-photo">+ Add photo</div> }
                          @case ('date') { <div class="pf-input">dd-mm-yyyy</div> }
                          @case ('rows') { <div class="pf-input">+ Add entry</div> }
                          @default { <div class="pf-input">{{ e.type === 'number' || e.type === 'decimal' ? '0' : '' }}</div> }
                        }
                        @if (e.help) { <div class="pf-help">{{ e.help }}</div> }
                      </div>
                      @if (!e.enabled) { <small class="text-muted d-block mt-2">Disabled: the apps do not show it.</small> }
                    </div>
                    <small class="text-muted d-block mt-2">{{ scopeOf(e) }}</small>
                  </div>

                  <div class="side-settings">
                    <h4>Settings</h4>
                    <label class="toggle-card form-switch" for="fieldRequired">
                      <input class="form-check-input" type="checkbox" role="switch" id="fieldRequired" [(ngModel)]="e.required" />
                      <span>
                        <strong>Required</strong>
                        <small class="text-muted d-block">
                          {{ e.required ? 'The unit must answer it.' : 'The unit may leave it empty.' }}
                          @if (e.field && !e.custom && e.field.standardRequired !== null) { (standard: {{ e.field.standardRequired ? 'required' : 'optional' }}) }
                        </small>
                      </span>
                    </label>
                    <label class="toggle-card form-switch" for="fieldEnabled">
                      <input class="form-check-input" type="checkbox" role="switch" id="fieldEnabled" [(ngModel)]="e.enabled" />
                      <span>
                        <strong>{{ e.enabled ? 'Shown in the apps' : 'Disabled' }}</strong>
                        <small class="text-muted d-block">{{ e.enabled ? 'Asked in the form.' : 'Not shown; answers already given are kept.' }}</small>
                      </span>
                    </label>
                  </div>
                </aside>
              </div>
              @if (modalError()) { <div class="alert alert-danger mt-3 mb-0" role="alert">{{ modalError() }}</div> }
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
    /* The forms, one tile each. */
    .form-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; margin-bottom: 10px; }
    .form-tile {
      display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; padding: 14px 16px; border-radius: 12px;
      border: 1px solid #dfe9ea; background: #fff; box-shadow: 0 2px 8px rgba(16, 61, 64, 0.06); cursor: pointer; color: inherit;
    }
    .form-tile:hover { border-color: #45a5ad; }
    .form-tile.active { border: 2px solid #45a5ad; padding: 13px 15px; background: #f4fafa; }
    .tile-name { font-weight: 700; color: #23474a; font-size: 15px; }
    .tile-app { color: #5f6f70; font-size: 13px; }
    .tile-counts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .tile-counts span { font-size: 12px; font-weight: 600; background: #eef6f6; color: #23474a; border-radius: 10px; padding: 1px 8px; }
    .tile-updated { font-size: 12px; color: #5f6f70; margin-top: 4px; }
    .sync-note { display: flex; gap: 8px; align-items: flex-start; color: #5f6f70; font-size: 13px; margin: 0 0 16px; }
    .info-dot {
      flex: 0 0 18px; height: 18px; border-radius: 9px; background: #45a5ad; color: #fff; font-size: 12px; font-weight: 700;
      display: inline-flex; align-items: center; justify-content: center; font-style: italic; font-family: Georgia, serif;
    }

    /* The fields of a section. */
    zed-collapse-card .table-responsive { margin-bottom: 0; }
    .fields-table { table-layout: fixed; width: 100%; min-width: 900px; }
    .fields-table td { overflow-wrap: anywhere; }
    .changed-on { display: block; font-size: 11.5px; color: #8a9899; margin-top: 4px; }
    .row-actions .btn { text-transform: none; }
    .fields-table td { vertical-align: top; padding-top: 12px; padding-bottom: 12px; }
    .fields-table tbody tr:hover { background: #f7fbfb; }
    .fields-table tr.is-off td { color: #8a9899; }
    .order-no {
      display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 14px;
      background: #eef6f6; color: #23474a; font-weight: 700; font-size: 13px;
    }
    .field-heading { display: block; text-transform: uppercase; letter-spacing: .04em; font-size: 11px; font-weight: 700; color: #2f7c83; margin-bottom: 2px; }
    .field-label { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .field-label strong { color: #232527; font-size: 14.5px; }
    .is-off .field-label strong { color: #8a9899; }
    .field-note, .field-help { display: block; font-size: 12.5px; margin-top: 2px; }
    .field-note { color: #5f6f70; }
    .field-help { color: #3b4b4c; }
    .cond { font-size: 10px; font-weight: 700; background: #fff4d6; color: #8a6100; border-radius: 4px; padding: 0 4px; margin-right: 2px; }
    .scope { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 0; margin-top: 6px; }
    .scope .zed-chip { font-size: 11px; padding: 1px 8px; }
    .scope .zed-chip.sector { background: #f1f0fb; color: #3f3a7a; }
    .scope-all { font-size: 11px; color: #5f6f70; border: 1px dashed #cbd9da; border-radius: 10px; padding: 0 8px; margin: 2px 4px 2px 0; }
    .type-name { font-size: 13px; color: #3b4b4c; }
    .status-badge.wrap { white-space: normal; }
    tr.column td { background: #f8fbfb; }
    .column-cell { padding-left: 28px !important; border-left: 3px solid #cfe5e6; font-size: 14px; color: #232527; }
    .move { display: inline-flex; }
    .move .btn { min-width: 30px; padding: 4px 6px; }
    .move .btn:first-child { border-top-right-radius: 0; border-bottom-right-radius: 0; }
    .move .btn:last-child { border-top-left-radius: 0; border-bottom-left-radius: 0; margin-left: -1px; }

    /* The pop-up: the field and who is asked on the left; the preview and the settings on the right. */
    .sec-no { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 10px; background: #45a5ad; color: #fff; font-size: 11px; margin-right: 6px; vertical-align: 1px; }
    .type-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 8px; }
    .type-tile { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 6px; border: 1px solid #dfe9ea; border-radius: 10px;
      background: #fff; cursor: pointer; text-align: center; margin: 0; transition: border-color .1s, background .1s; }
    .type-tile:hover { border-color: #45a5ad; }
    .type-tile.active { border: 2px solid #45a5ad; padding: 9px 5px; background: #f4fafa; }
    .type-tile:focus-within { outline: 2px solid #45a5ad; outline-offset: 2px; }
    .type-glyph { font: 700 15px/1 Consolas, 'Courier New', monospace; color: #2f7c83; height: 18px; }
    .type-name { font-size: 12px; font-weight: 600; color: #3b4b4c; line-height: 1.25; }
    .type-pill { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; background: #eef6f6; color: #23474a; border-radius: 12px; padding: 2px 10px; }
    .seg { display: inline-flex; flex-wrap: wrap; border: 1px solid #cbd9da; border-radius: 8px; overflow: hidden; }
    .seg button { border: 0; background: #fff; color: #2f7c83; font-size: 13px; font-weight: 600; padding: 6px 14px; cursor: pointer; }
    .seg button + button { border-left: 1px solid #cbd9da; }
    .seg button:hover { background: #eef6f6; }
    .seg button.active { background: #45a5ad; color: #fff; }
    .dialog-side { position: sticky; top: 0; display: flex; flex-direction: column; gap: 14px; }
    .side-settings { border: 1px solid #dfe9ea; border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
    .side-settings h4 { font-size: 14px; font-weight: 700; color: #23474a; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 4px; }
    .phone-notch { width: 54px; height: 5px; border-radius: 3px; background: #dfe5e6; margin: -6px auto 12px; }
    /* Wider than the skin's 760px form pop-ups (.zed-legacy.zed-v4 .modal-dialog:has(.form-grid)). */
    .modal > .modal-dialog.modal-xl.field-dialog { max-width: 1040px; width: calc(100% - 32px); margin-left: auto; margin-right: auto; }
    .modal .field-dialog .form-grid { grid-template-columns: 150px minmax(0, 1fr); }
    .field-dialog .form-grid > .label { display: block; text-align: left; white-space: normal; text-transform: none; padding: 0; font-size: 14px;
      font-weight: 600; color: #3b4b4c; background: none; border-radius: 0; }
    .field-dialog .form-grid > .label.top { padding-top: 8px; }
    .modal .field-dialog textarea.form-control { min-height: 64px; height: auto; }
    .dialog-grid { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 20px; align-items: start; }
    .dialog-section { border: 1px solid #dfe9ea; border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; }
    .dialog-section:last-child { margin-bottom: 0; }
    .dialog-section h4, .dialog-preview h4 { font-size: 14px; font-weight: 700; color: #23474a; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 12px; }
    .form-grid > .top { align-self: start; padding-top: 8px; }
    .choices { display: flex; flex-direction: column; gap: 6px; }
    .choice { display: flex; align-items: center; gap: 8px; }
    .choice-no { flex: 0 0 24px; height: 24px; border-radius: 12px; background: #eef6f6; color: #23474a; font-size: 12px; font-weight: 700;
      display: inline-flex; align-items: center; justify-content: center; }
    .choice-remove { color: #a8303a; text-decoration: none; padding: 2px 8px; }
    .add-choice { align-self: flex-start; }
    .toggle-card { display: flex; gap: 10px; align-items: flex-start; border: 1px solid #dfe9ea; border-radius: 10px; padding: 10px 12px; margin: 0; cursor: pointer; }
    .toggle-card .form-check-input { flex: 0 0 auto; margin: 3px 0 0; }
    .toggle-card.form-switch { padding-left: 12px; }
    .toggle-card.form-switch .form-check-input { margin-left: 0; width: 2em; }
    .dialog-preview { background: #f4f8f8; border-radius: 12px; padding: 14px; }
    .phone { background: #fff; border: 1px solid #dfe9ea; border-radius: 18px; padding: 16px 14px; box-shadow: 0 2px 8px rgba(16, 61, 64, 0.06); }
    .phone-field.is-off { opacity: .45; }
    .pf-label { font-size: 13px; font-weight: 600; color: #232527; margin-bottom: 6px; overflow-wrap: anywhere; }
    .pf-input { border: 1px solid #cbd9da; border-radius: 8px; min-height: 34px; padding: 6px 10px; font-size: 13px; color: #8a9899; }
    .pf-select { position: relative; padding-right: 26px; }
    .pf-select::after { content: ''; position: absolute; right: 10px; top: 12px; width: 7px; height: 7px; border-right: 2px solid #5f6f70; border-bottom: 2px solid #5f6f70; transform: rotate(45deg); }
    .pf-radios { display: flex; gap: 18px; font-size: 13px; }
    .pf-radios i, .pf-check i { display: inline-block; width: 14px; height: 14px; border: 1.5px solid #8a9899; border-radius: 50%; vertical-align: -2px; margin-right: 4px; }
    .pf-check { font-size: 13px; margin-bottom: 4px; }
    .pf-check i { border-radius: 3px; }
    .pf-photo { border: 1.5px dashed #45a5ad; border-radius: 8px; color: #2f7c83; font-size: 13px; font-weight: 600; text-align: center; padding: 18px 8px; }
    .pf-help { font-size: 12px; color: #5f6f70; margin-top: 6px; overflow-wrap: anywhere; }

    @media (max-width: 991.98px) {
      .dialog-grid { grid-template-columns: minmax(0, 1fr); }
      .dialog-side { position: static; }
    }
    @media (max-width: 575.98px) {
      .modal .field-dialog .form-grid { grid-template-columns: minmax(0, 1fr); }
    }
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

  /** The levels and NIC sectors a field can be limited to. */
  protected readonly levelOptions = computed<MultiSelectOption[]>(() => (this.details()?.levels ?? []).map((l) => ({ value: l.code, label: l.name })));
  protected readonly sectorOptions = signal<MultiSelectOption[]>([]);

  constructor() {
    void this.loadForms();
    firstValueFrom(this.http.get<{ code: string; name: string }[]>('/api/staff/masters/sectors'))
      .then((list) => this.sectorOptions.set(list.map((x) => ({ value: x.code, label: `${x.code} - ${x.name}` }))))
      .catch(() => undefined);
  }

  protected inSection(section: string): AppFieldItem[] {
    return this.bySection().get(section) ?? [];
  }

  /** The header line of a section card: its fields, and how many are hidden from the app. */
  protected sectionSummary(section: string): string {
    const fields = this.inSection(section);
    const off = fields.filter((f) => !f.enabled).length;
    return `${fields.length} ${fields.length === 1 ? 'field' : 'fields'}` + (off ? ` · ${off} disabled` : '');
  }

  protected levelName(code: string): string {
    return this.details()?.levels?.find((l) => l.code === code)?.name ?? code;
  }

  /** The pop-up's line under the preview: who is asked the field. */
  protected scopeOf(e: Editing): string {
    const levels = e.levels.length ? e.levels.map((l) => this.levelName(l)).join(', ') : 'every level';
    const sectors = e.nicSectors.length ? `NIC sectors ${e.nicSectors.join(', ')}` : 'units of every sector';
    return `Asked for ${levels}, of ${sectors}.`;
  }

  /** How the preview draws the field. */
  protected previewKind(e: Editing): string {
    if (this.isChoice(e.type)) return 'choice';
    return ['yesno', 'photo', 'date', 'rows'].includes(e.type) ? e.type : 'input';
  }

  protected previewChoices(e: Editing): string[] {
    const choices = e.options.map((o) => o.trim()).filter((o) => o);
    return choices.length ? choices.slice(0, 5) : ['Choice 1', 'Choice 2'];
  }

  protected firstChoice(e: Editing): string {
    return e.options.map((o) => o.trim()).find((o) => o) ?? '';
  }

  /** "All levels · All sectors", or the levels and sectors it is limited to. */
  protected scopeText(f: AppFieldItem): string {
    const names = new Map((this.details()?.levels ?? []).map((l) => [l.code, l.name]));
    const levels = f.levels?.length ? f.levels.map((l) => names.get(l) ?? l).join(', ') : 'All levels';
    const sectors = f.nicSectors?.length ? `NIC ${f.nicSectors.join(', ')}` : 'all sectors';
    return `${levels} · ${sectors}`;
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
    this.editing.set({
      field: null, custom: true, label: '', help: '', type: 'text', required: false, enabled: true, section: d.sections[0]?.key ?? '', options: [''],
      levels: [], nicSectors: [], limitLevels: false, limitSectors: false,
    });
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
      levels: [...(f.levels ?? [])],
      nicSectors: [...(f.nicSectors ?? [])],
      limitLevels: !!f.levels?.length,
      limitSectors: !!f.nicSectors?.length,
    });
  }

  protected typeGlyph(type: string): string {
    return TYPE_GLYPHS[type] ?? '•';
  }

  /** "Every level / sector" (the list emptied) or "Only these" (the list to choose from). */
  protected limit(what: 'levels' | 'sectors', on: boolean): void {
    // From the field as it is now, not as the button last saw it.
    const now = this.editing();
    if (!now) return;
    const next = { ...now };
    if (what === 'levels') {
      next.limitLevels = on;
      if (!on) next.levels = [];
    } else {
      next.limitSectors = on;
      if (!on) next.nicSectors = [];
    }
    this.editing.set(next);
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
      levels: e.levels,
      nicSectors: e.nicSectors,
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
