import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { PortalSwitchComponent } from '../admin-portal';
import { ConfirmService } from '../confirm-dialog';
import { IndianTimePipe } from '../utc-time';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { CollapseCard } from '../collapse-card';
import { MultiSelect, MultiSelectOption } from '../users/multi-select';
import { TextPipe, t } from '../../content/page-text';

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
  /** V4 (migration 0080): the assessor checks the answer (Valid / Not valid, which raises an NC). */
  validationRequired?: boolean;
  /** 2026-11-16: why this standard field has no "Validation required" switch (products and photos are checked already). */
  noValidation?: string | null;
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
  /** The Admin's own fields of this form can be "Validation required" (a form the unit fills in, checked by an assessor). */
  canValidate?: boolean;
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
  validationRequired: boolean;
  /** 2026-11-16: repeating entries: the most entries (empty: the default, 20) and the columns. */
  maxItems: number | null;
  columns: EditColumn[];
}

/** 2026-11-16: a column of the Admin's repeating entries in the pop-up (choices comma-separated). */
interface EditColumn {
  /** The saved column's key (its answers are kept), or null for a new one. */
  key: string | null;
  label: string;
  type: string;
  required: boolean;
  options: string;
  /** Photo: the most photos (1 to 5). */
  maxItems: number;
}

/** The types of a column of repeating entries: every own type and photo. */
export const COLUMN_TYPES = ['text', 'number', 'decimal', 'date', 'yesno', 'dropdown', 'multiselect', 'checkboxes', 'photo'];

/** The name of a field type (Admin-editable page wording); an unknown type shows its code. */
export function fieldTypeName(type: string): string {
  switch (type) {
    case 'text': return t('staff.appForms.type.textLabel', 'Text');
    case 'number': return t('staff.appForms.type.numberLabel', 'Whole number');
    case 'decimal': return t('staff.appForms.type.decimalLabel', 'Number with decimals');
    case 'date': return t('staff.appForms.type.dateLabel', 'Date');
    case 'yesno': return t('staff.appForms.type.yesnoLabel', 'Yes / No');
    case 'dropdown': return t('staff.appForms.type.dropdownLabel', 'Drop-down (one choice)');
    case 'multiselect': return t('staff.appForms.type.multiselectLabel', 'List (several choices)');
    case 'checkboxes': return t('staff.appForms.type.checkboxesLabel', 'Check boxes (several choices)');
    case 'photo': return t('staff.appForms.type.photoLabel', 'Photo');
    case 'rows': return t('staff.appForms.type.rowsLabel', 'Repeating entries');
    default: return type;
  }
}

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
  imports: [IndianTimePipe, FormsModule, CollapseCard, MultiSelect, PortalSwitchComponent, TextPipe],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ 'App Forms' | t: 'staff.appForms.title' }}</h3>
        <p class="page-sub">{{ 'The Basic Information forms of the mobile apps: rename, reorder, make required, limit to levels and NIC sectors, or add fields of your own.' | t: 'staff.appForms.sub' }}</p>
      </div>
      @if (details()) {
        <div class="page-actions">
          <button type="button" class="btn btn-primary" (click)="add()">{{ 'Add field' | t: 'staff.appForms.addButton' }}</button>
        </div>
      }
    </div>
    <!-- One Admin (V4): the portal whose settings these are (each portal keeps its own). -->
    <zed-portal-switch />
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    @if (forms().length) {
      <div class="form-tiles" role="group" [attr.aria-label]="'Form' | t: 'staff.appForms.tilesAria'">
        @for (f of forms(); track f.key) {
          <button type="button" class="form-tile" [class.active]="f.key === formKey()" [attr.aria-pressed]="f.key === formKey()" [attr.data-key]="f.key" (click)="choose(f.key)">
            <span class="tile-name">{{ f.name }}</span>
            <span class="tile-app">{{ f.app }}</span>
            <span class="tile-counts">
              <span>{{ f.fields === 1 ? ('{count} field' | t: 'staff.appForms.tile.field' : { count: f.fields }) : ('{count} fields' | t: 'staff.appForms.tile.fields' : { count: f.fields }) }}</span>
              @if (f.customFields) { <span>{{ '{count} added' | t: 'staff.appForms.tile.addedCount' : { count: f.customFields } }}</span> }
              @if (f.disabled) { <span>{{ '{count} disabled' | t: 'staff.appForms.tile.disabledCount' : { count: f.disabled } }}</span> }
            </span>
            @if (f.updatedOn) { <span class="tile-updated">{{ 'Changed {date}' | t: 'staff.appForms.tile.changedNote' : { date: (f.updatedOn | indianTime: 'dd-MM-yyyy') } }}</span> }
          </button>
        }
      </div>
      <p class="sync-note">
        <span class="info-dot" aria-hidden="true">i</span>
        {{ 'A change reaches the apps the next time they load the form; apps without a connection keep the last form they loaded.' | t: 'staff.appForms.syncNote' }}
      </p>
    }

    @if (details(); as d) {
      @for (s of d.sections; track s.key; let first = $first) {
        <zed-collapse-card [title]="s.label" [summary]="sectionSummary(s.key)" [open]="first">
        <div class="table-responsive">
          <table class="table table-zed fields-table">
            <!-- 2026-11-15 (design approved): a compact list; small arrows, an On/Off switch, Edit and a Reset link. -->
            <colgroup>
              <col style="width: 52px" />
              <col />
              <col style="width: 140px" />
              <col style="width: 92px" />
              <col style="width: 280px" />
            </colgroup>
            <thead>
              <tr>
                <th class="text-center">#</th>
                <th>{{ 'Field' | t: 'staff.appForms.column.field' }}</th>
                <th>{{ 'Type' | t: 'staff.appForms.column.type' }}</th>
                <th>{{ 'Required' | t: 'staff.appForms.column.required' }}</th>
                <th class="text-end">{{ 'Action' | t: 'staff.appForms.column.action' }}</th>
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
                      @if (f.custom) { <span class="status-badge is-info">{{ 'Added' | t: 'staff.appForms.row.chip.added' }}</span> }
                      @if (f.validationRequired) { <span class="zed-chip" [title]="'The assessor checks this answer' | t: 'staff.appForms.row.validatedTooltip'">{{ 'Validated' | t: 'staff.appForms.row.chip.validated' }}</span> }
                      @else if (f.customised) { <span class="status-badge is-pending">{{ 'Changed' | t: 'staff.appForms.row.chip.changed' }}</span> }
                    </div>
                    @if (f.standardLabel && f.standardLabel !== f.label) { <small class="field-note">{{ 'Standard: {label}' | t: 'staff.appForms.row.standardNote' : { label: f.standardLabel } }}</small> }
                    @if (f.help) { <small class="field-help">{{ f.help }}</small> }
                    @if (f.shownWhen) { <small class="field-note"><span class="cond">{{ 'IF' | t: 'staff.appForms.row.ifChip' }}</span> {{ 'Asked when {condition}' | t: 'staff.appForms.row.askedWhenNote' : { condition: f.shownWhen } }}</small> }
                    @if (f.options?.length) { <small class="field-note">{{ 'Choices: {choices}' | t: 'staff.appForms.row.choicesNote' : { choices: f.options!.join(', ') } }}</small> }
                    @if (f.updatedOn) { <small class="changed-on">{{ f.updatedBy ? ('Changed {date} by {name}' | t: 'staff.appForms.row.changedByNote' : { date: (f.updatedOn | indianTime), name: f.updatedBy }) : ('Changed {date}' | t: 'staff.appForms.row.changedNote' : { date: (f.updatedOn | indianTime) }) }}</small> }
                    <div class="scope" [title]="scopeText(f)">
                      @if (f.levels?.length) {
                        @for (l of f.levels!; track l) { <span class="zed-chip">{{ levelName(l) }}</span> }
                      } @else {
                        <span class="scope-all">{{ 'All levels' | t: 'staff.appForms.row.allLevelsChip' }}</span>
                      }
                      @if (f.nicSectors?.length) {
                        @for (c of f.nicSectors!; track c) { <span class="zed-chip sector">{{ 'NIC {code}' | t: 'staff.appForms.row.nicChip' : { code: c } }}</span> }
                      } @else {
                        <span class="scope-all">{{ 'All sectors' | t: 'staff.appForms.row.allSectorsChip' }}</span>
                      }
                    </div>
                  </td>
                  <td><span class="type-name">{{ typeName(f) }}</span></td>
                  <td><span class="req-chip" [class.is-yes]="f.required">{{ f.required ? ('Yes' | t: 'staff.appForms.row.requiredYes') : ('No' | t: 'staff.appForms.row.requiredNo') }}</span></td>
                  <td>
                    <div class="af-actions">
                      <button type="button" class="btn btn-outline-primary btn-sm st-move" [title]="'Move up' | t: 'staff.appForms.row.moveUpAria'" [attr.aria-label]="'Move up' | t: 'staff.appForms.row.moveUpAria'" [disabled]="i === 0 || busy()" (click)="move(s.key, i, -1)">↑</button>
                      <button type="button" class="btn btn-outline-primary btn-sm st-move" [title]="'Move down' | t: 'staff.appForms.row.moveDownAria'" [attr.aria-label]="'Move down' | t: 'staff.appForms.row.moveDownAria'" [disabled]="last || busy()" (click)="move(s.key, i, 1)">↓</button>
                      <label class="af-switch" [class.off]="!f.enabled" [title]="status(f)">
                        <input type="checkbox" role="switch" [checked]="f.enabled" [disabled]="busy()" [attr.aria-label]="f.enabled ? ('Switch off {field}' | t: 'staff.appForms.row.switchOffAria' : { field: f.label }) : ('Switch on {field}' | t: 'staff.appForms.row.switchOnAria' : { field: f.label })" (click)="$event.preventDefault(); toggle(f)" />
                        <span class="af-track" aria-hidden="true"></span>{{ f.enabled ? ('On' | t: 'staff.appForms.row.onLabel') : ('Off' | t: 'staff.appForms.row.offLabel') }}
                      </label>
                      <button type="button" class="btn btn-outline-primary btn-sm" (click)="edit(f)">{{ 'Edit' | t: 'staff.appForms.row.editButton' }}</button>
                      @if (f.customised && !f.custom) { <button type="button" class="btn btn-outline-danger btn-sm" (click)="reset(f)">{{ 'Reset' | t: 'staff.appForms.row.resetButton' }}</button> }
                    </div>
                    @if (f.enabled && !f.active) { <small class="af-note">{{ status(f) }}</small> }
                  </td>
                </tr>
                @for (c of f.columns ?? []; track c.key) {
                  <tr class="column" [class.is-off]="!c.active" [attr.data-key]="c.key">
                    <td></td>
                    <td class="column-cell">↳ {{ c.label }}
                      @if (c.standardLabel && c.standardLabel !== c.label) { <small class="field-note">{{ 'Standard: {label}' | t: 'staff.appForms.row.standardNote' : { label: c.standardLabel } }}</small> }
                      @if (c.help) { <small class="field-help">{{ c.help }}</small> }
                      @if (c.updatedOn) { <small class="changed-on">{{ c.updatedBy ? ('Changed {date} by {name}' | t: 'staff.appForms.row.changedByNote' : { date: (c.updatedOn | indianTime), name: c.updatedBy }) : ('Changed {date}' | t: 'staff.appForms.row.changedNote' : { date: (c.updatedOn | indianTime) }) }}</small> }
                    </td>
                    <td><span class="type-name">{{ typeName(c) }}</span></td>
                    <td><span class="req-chip" [class.is-yes]="c.required">{{ c.required ? ('Yes' | t: 'staff.appForms.row.requiredYes') : ('No' | t: 'staff.appForms.row.requiredNo') }}</span></td>
                    <td>
                      <div class="af-actions">
                        <label class="af-switch" [class.off]="!c.enabled" [title]="c.enabled ? ('Shown' | t: 'staff.appForms.status.shownLabel') : ('Disabled' | t: 'staff.appForms.status.disabledLabel')">
                          <input type="checkbox" role="switch" [checked]="c.enabled" [disabled]="busy()" [attr.aria-label]="c.enabled ? ('Switch off {field}' | t: 'staff.appForms.row.switchOffAria' : { field: c.label }) : ('Switch on {field}' | t: 'staff.appForms.row.switchOnAria' : { field: c.label })" (click)="$event.preventDefault(); toggle(c)" />
                          <span class="af-track" aria-hidden="true"></span>{{ c.enabled ? ('On' | t: 'staff.appForms.row.onLabel') : ('Off' | t: 'staff.appForms.row.offLabel') }}
                        </label>
                        <button type="button" class="btn btn-outline-primary btn-sm" (click)="edit(c)">{{ 'Edit' | t: 'staff.appForms.row.editButton' }}</button>
                        @if (c.customised) { <button type="button" class="btn btn-outline-danger btn-sm" (click)="reset(c)">{{ 'Reset' | t: 'staff.appForms.row.resetButton' }}</button> }
                      </div>
                    </td>
                  </tr>
                }
              } @empty {
                <tr><td colspan="6" style="padding: 0"><div class="no-data">{{ 'No fields' | t: 'staff.appForms.fieldsEmpty' }}</div></td></tr>
              }
            </tbody>
          </table>
        </div>
        </zed-collapse-card>
      }
    } @else if (!busy() && !forms().length) {
      <div class="no-data">{{ 'No app forms on this portal' | t: 'staff.appForms.formsEmpty' }}</div>
    }

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="fieldTitle">
        <div class="modal-dialog modal-xl modal-dialog-scrollable field-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-start gap-3">
                <div>
                  <h3 class="registration-title m-0" id="fieldTitle">{{ e.field ? ('Edit field' | t: 'staff.appForms.dialog.editTitle') : ('Add field' | t: 'staff.appForms.dialog.addTitle') }}</h3>
                  <small class="text-muted">
                    {{ details()?.form?.name }} · {{ details()?.form?.app }}
                    @if (e.field && !e.custom) { · {{ 'standard field of the app' | t: 'staff.appForms.dialog.standardFieldNote' }} }
                  </small>
                </div>
                <button type="button" class="btn btn-link p-0" [attr.aria-label]="'Close' | t: 'staff.appForms.dialog.closeAria'" (click)="editing.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <div class="modal-body">
              <div class="dialog-grid">
                <div class="dialog-main">
                  <section class="dialog-section">
                    <h4><span class="sec-no">1</span> {{ 'Field' | t: 'staff.appForms.dialog.fieldHeading' }}</h4>
                    <div class="form-grid">
                      <label for="fieldLabel">{{ 'Label' | t: 'staff.appForms.dialog.fieldLabel.label' }}<span class="req">*</span></label>
                      <div>
                        <input type="text" class="form-control" id="fieldLabel" maxlength="200" [placeholder]="'The question the unit sees' | t: 'staff.appForms.dialog.fieldLabel.placeholder'" [(ngModel)]="e.label" />
                        @if (e.field?.standardLabel; as standard) { <small class="text-muted">{{ 'Standard: {label}' | t: 'staff.appForms.dialog.standardNote' : { label: standard } }}</small> }
                      </div>
                      <label class="top" for="fieldHelp">{{ 'Help text' | t: 'staff.appForms.dialog.help.label' }} <small class="text-muted fw-normal d-block">{{ '(optional, shown under the field)' | t: 'staff.appForms.dialog.help.note' }}</small></label>
                      <textarea class="form-control" id="fieldHelp" rows="2" maxlength="500" [placeholder]="'A hint for the unit' | t: 'staff.appForms.dialog.help.placeholder'" [(ngModel)]="e.help"></textarea>
                      @if (e.custom) {
                        <span class="label top">{{ 'Type' | t: 'staff.appForms.dialog.type.label' }}</span>
                        <div class="type-grid" role="radiogroup" [attr.aria-label]="'Type' | t: 'staff.appForms.dialog.type.label'">
                          @for (t of details()?.customTypes ?? []; track t) {
                            <label class="type-tile" [class.active]="e.type === t" [for]="'type-' + t">
                              <input type="radio" class="visually-hidden" name="fieldType" [id]="'type-' + t" [value]="t" [(ngModel)]="e.type" />
                              <span class="type-glyph" aria-hidden="true">{{ typeGlyph(t) }}</span>
                              <span class="type-name">{{ typeLabel(t) }}</span>
                            </label>
                          }
                        </div>
                        @if ((details()?.sections?.length ?? 0) > 1) {
                          <label for="fieldSection">{{ 'Section' | t: 'staff.appForms.dialog.section.label' }}</label>
                          <select class="form-select" id="fieldSection" [(ngModel)]="e.section">
                            @for (s of details()!.sections; track s.key) { <option [value]="s.key">{{ s.label }}</option> }
                          </select>
                        }
                        @if (isChoice(e.type)) {
                          <span class="label top">{{ 'Choices' | t: 'staff.appForms.dialog.choices.label' }}</span>
                          <div class="choices">
                            @for (o of e.options; track $index; let i = $index) {
                              <div class="choice">
                                <span class="choice-no">{{ i + 1 }}</span>
                                <input type="text" class="form-control" maxlength="100" [attr.aria-label]="'Choice {number}' | t: 'staff.appForms.dialog.choices.choiceAria' : { number: i + 1 }" [(ngModel)]="e.options[i]" />
                                <button type="button" class="btn btn-link choice-remove" [title]="'Remove' | t: 'staff.appForms.dialog.removeTooltip'" [attr.aria-label]="'Remove choice {number}' | t: 'staff.appForms.dialog.choices.removeAria' : { number: i + 1 }" (click)="removeOption(e, i)">✕</button>
                              </div>
                            }
                            <button type="button" class="btn btn-outline-primary btn-sm add-choice" (click)="addOption(e)">{{ 'Add choice' | t: 'staff.appForms.dialog.choices.addButton' }}</button>
                          </div>
                        }
                        @if (e.type === 'rows') {
                          <span class="label top">{{ 'Columns' | t: 'staff.appForms.dialog.columns.label' }}</span>
                          <div class="rows-editor" data-columns>
                            <p class="small text-muted mb-2">{{ 'One card per entry in the apps, with "+ Add more". Each entry asks these columns.' | t: 'staff.appForms.dialog.columns.note' }}</p>
                            @for (c of e.columns; track $index; let i = $index) {
                              <div class="col-row" [attr.data-column]="i">
                                <span class="choice-no">{{ i + 1 }}</span>
                                <input type="text" class="form-control" maxlength="200" [placeholder]="'Column label' | t: 'staff.appForms.dialog.columns.labelPlaceholder'" [attr.aria-label]="'Column {number} label' | t: 'staff.appForms.dialog.columns.labelAria' : { number: i + 1 }" [(ngModel)]="c.label" />
                                <select class="form-select" [attr.aria-label]="'Column {number} type' | t: 'staff.appForms.dialog.columns.typeAria' : { number: i + 1 }" [(ngModel)]="c.type">
                                  @for (t of columnTypes; track t) { <option [value]="t">{{ typeLabel(t) }}</option> }
                                </select>
                                <label class="col-req"><input type="checkbox" class="form-check-input" [(ngModel)]="c.required" [attr.aria-label]="'Column {number} required' | t: 'staff.appForms.dialog.columns.requiredAria' : { number: i + 1 }" /> {{ 'Required' | t: 'staff.appForms.dialog.columns.requiredLabel' }}</label>
                                <button type="button" class="btn btn-link choice-remove" [title]="'Remove' | t: 'staff.appForms.dialog.removeTooltip'" [attr.aria-label]="'Remove column {number}' | t: 'staff.appForms.dialog.columns.removeAria' : { number: i + 1 }" (click)="removeColumn(e, i)">✕</button>
                                @if (isChoice(c.type)) {
                                  <input type="text" class="form-control col-extra" [placeholder]="'Choices, separated by commas' | t: 'staff.appForms.dialog.columns.choicesPlaceholder'" [attr.aria-label]="'Column {number} choices' | t: 'staff.appForms.dialog.columns.choicesAria' : { number: i + 1 }" [(ngModel)]="c.options" />
                                }
                                @if (c.type === 'photo') {
                                  <label class="col-extra small">{{ 'Photos per entry' | t: 'staff.appForms.dialog.columns.photosLabel' }}
                                    <input type="number" class="form-control form-control-sm d-inline-block col-num" min="1" max="5" [attr.aria-label]="'Column {number} photos' | t: 'staff.appForms.dialog.columns.photosAria' : { number: i + 1 }" [(ngModel)]="c.maxItems" /></label>
                                }
                              </div>
                            }
                            <button type="button" class="btn btn-outline-primary btn-sm add-choice" (click)="addColumn(e)" [disabled]="e.columns.length >= 15">{{ 'Add column' | t: 'staff.appForms.dialog.columns.addButton' }}</button>
                            <label class="small d-block mt-2" for="rowsMax">{{ 'Most entries' | t: 'staff.appForms.dialog.columns.maxLabel' }}
                              <input type="number" id="rowsMax" class="form-control form-control-sm d-inline-block col-num" min="1" max="50" placeholder="20" [(ngModel)]="e.maxItems" /></label>
                          </div>
                        }
                      } @else {
                        <span class="label">{{ 'Type' | t: 'staff.appForms.dialog.type.label' }}</span>
                        <span><span class="type-pill"><span aria-hidden="true">{{ typeGlyph(e.field!.type) }}</span> {{ typeName(e.field!) }}</span>
                          <small class="text-muted d-block">{{ 'The type of a standard field cannot be changed.' | t: 'staff.appForms.dialog.type.fixedNote' }}</small></span>
                      }
                    </div>
                  </section>

                  <section class="dialog-section">
                    <h4><span class="sec-no">2</span> {{ 'Who is asked' | t: 'staff.appForms.dialog.whoHeading' }}</h4>
                    <div class="form-grid">
                      @if (levelOptions().length) {
                        <span class="label top">{{ 'Certification levels' | t: 'staff.appForms.dialog.levels.label' }}</span>
                        <div>
                          <div class="seg" role="group" [attr.aria-label]="'Certification levels' | t: 'staff.appForms.dialog.levels.label'">
                            <button type="button" [class.active]="!e.limitLevels" [attr.aria-pressed]="!e.limitLevels" (click)="limit('levels', false)">{{ 'Every level' | t: 'staff.appForms.dialog.levels.everyButton' }}</button>
                            <button type="button" [class.active]="e.limitLevels" [attr.aria-pressed]="e.limitLevels" (click)="limit('levels', true)">{{ 'Only these levels' | t: 'staff.appForms.dialog.levels.onlyButton' }}</button>
                          </div>
                          @if (e.limitLevels) {
                            <div class="mt-2"><zed-multi-select inputId="fieldLevels" [label]="'Certification levels' | t: 'staff.appForms.dialog.levels.label'" [options]="levelOptions()" [(value)]="e.levels" /></div>
                          }
                        </div>
                      }
                      <span class="label top">{{ 'NIC sectors' | t: 'staff.appForms.dialog.sectors.label' }}</span>
                      <div>
                        <div class="seg" role="group" [attr.aria-label]="'NIC sectors' | t: 'staff.appForms.dialog.sectors.label'">
                          <button type="button" [class.active]="!e.limitSectors" [attr.aria-pressed]="!e.limitSectors" (click)="limit('sectors', false)">{{ 'Every sector' | t: 'staff.appForms.dialog.sectors.everyButton' }}</button>
                          <button type="button" [class.active]="e.limitSectors" [attr.aria-pressed]="e.limitSectors" (click)="limit('sectors', true)">{{ 'Only these sectors' | t: 'staff.appForms.dialog.sectors.onlyButton' }}</button>
                        </div>
                        @if (e.limitSectors) {
                          <div class="mt-2"><zed-multi-select inputId="fieldSectors" [label]="'NIC sectors' | t: 'staff.appForms.dialog.sectors.label'" [options]="sectorOptions()" [(value)]="e.nicSectors" /></div>
                        }
                      </div>
                    </div>
                  </section>
                </div>

                <aside class="dialog-side">
                  <div class="dialog-preview" [attr.aria-label]="'Preview in the app' | t: 'staff.appForms.dialog.preview.heading'">
                    <h4>{{ 'Preview in the app' | t: 'staff.appForms.dialog.preview.heading' }}</h4>
                    <div class="phone">
                      <div class="phone-notch" aria-hidden="true"></div>
                      <div class="phone-field" [class.is-off]="!e.enabled">
                        <div class="pf-label">{{ e.label || ('Label' | t: 'staff.appForms.dialog.preview.emptyLabel') }}@if (e.required) {<span class="req">*</span>}</div>
                        @switch (previewKind(e)) {
                          @case ('yesno') { <div class="pf-radios"><span><i></i> {{ 'Yes' | t: 'staff.appForms.dialog.preview.yesLabel' }}</span><span><i></i> {{ 'No' | t: 'staff.appForms.dialog.preview.noLabel' }}</span></div> }
                          @case ('choice') {
                            @if (e.type === 'dropdown') {
                              <div class="pf-input pf-select">{{ firstChoice(e) || ('Select' | t: 'staff.appForms.dialog.preview.selectPlaceholder') }}</div>
                            } @else {
                              @for (o of previewChoices(e); track $index) { <div class="pf-check"><i></i> {{ o }}</div> }
                            }
                          }
                          @case ('photo') { <div class="pf-photo">{{ '+ Add photo' | t: 'staff.appForms.dialog.preview.addPhotoButton' }}</div> }
                          @case ('date') { <div class="pf-input">{{ 'dd-mm-yyyy' | t: 'staff.appForms.dialog.preview.datePlaceholder' }}</div> }
                          @case ('rows') { <div class="pf-input">{{ '+ Add entry' | t: 'staff.appForms.dialog.preview.addEntryButton' }}</div> }
                          @default { <div class="pf-input">{{ e.type === 'number' || e.type === 'decimal' ? '0' : '' }}</div> }
                        }
                        @if (e.help) { <div class="pf-help">{{ e.help }}</div> }
                      </div>
                      @if (!e.enabled) { <small class="text-muted d-block mt-2">{{ 'Disabled: the apps do not show it.' | t: 'staff.appForms.dialog.preview.disabledNote' }}</small> }
                    </div>
                    <small class="text-muted d-block mt-2">{{ scopeOf(e) }}</small>
                  </div>

                  <div class="side-settings">
                    <h4>{{ 'Settings' | t: 'staff.appForms.dialog.settingsHeading' }}</h4>
                    <label class="toggle-card form-switch" for="fieldRequired">
                      <input class="form-check-input" type="checkbox" role="switch" id="fieldRequired" [(ngModel)]="e.required" />
                      <span>
                        <strong>{{ 'Required' | t: 'staff.appForms.dialog.required.label' }}</strong>
                        <small class="text-muted d-block">
                          {{ e.required ? ('The unit must answer it.' | t: 'staff.appForms.dialog.required.onNote') : ('The unit may leave it empty.' | t: 'staff.appForms.dialog.required.offNote') }}
                          @if (e.field && !e.custom && e.field.standardRequired !== null) { {{ e.field.standardRequired ? ('(standard: required)' | t: 'staff.appForms.dialog.required.standardRequiredNote') : ('(standard: optional)' | t: 'staff.appForms.dialog.required.standardOptionalNote') }} }
                        </small>
                      </span>
                    </label>
                    <label class="toggle-card form-switch" for="fieldEnabled">
                      <input class="form-check-input" type="checkbox" role="switch" id="fieldEnabled" [(ngModel)]="e.enabled" />
                      <span>
                        <strong>{{ e.enabled ? ('Shown in the apps' | t: 'staff.appForms.dialog.enabled.onLabel') : ('Disabled' | t: 'staff.appForms.dialog.enabled.offLabel') }}</strong>
                        <small class="text-muted d-block">{{ e.enabled ? ('Asked in the form.' | t: 'staff.appForms.dialog.enabled.onNote') : ('Not shown; answers already given are kept.' | t: 'staff.appForms.dialog.enabled.offNote') }}</small>
                      </span>
                    </label>
                    @if (details()?.canValidate && !e.custom && e.field?.noValidation) {
                      <div class="toggle-card no-validation" data-no-validation>
                        <span><strong>{{ 'Validation required' | t: 'staff.appForms.dialog.validation.label' }}</strong><small class="text-muted d-block">{{ e.field.noValidation }}</small></span>
                      </div>
                    } @else if (details()?.canValidate && e.type !== 'rows') {
                      <label class="toggle-card form-switch" for="fieldValidated">
                        <input class="form-check-input" type="checkbox" role="switch" id="fieldValidated" [(ngModel)]="e.validationRequired" />
                        <span>
                          <strong>{{ 'Validation required' | t: 'staff.appForms.dialog.validation.label' }}</strong>
                          <small class="text-muted d-block">{{ 'The assessor checks this answer: Valid, or Not valid with a remark. Not valid raises an NC on this field.' | t: 'staff.appForms.dialog.validation.note' }}</small>
                        </span>
                      </label>
                    }
                  </div>
                </aside>
              </div>
              @if (modalError()) { <div class="alert alert-danger mt-3 mb-0" role="alert">{{ modalError() }}</div> }
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-default" (click)="editing.set(null)">{{ 'Cancel' | t: 'staff.appForms.dialog.cancelButton' }}</button>
              <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="save(e)">{{ 'Save' | t: 'staff.appForms.dialog.saveButton' }}</button>
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
  styleUrl: './app-forms-dialog.scss',
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
    .fields-table { table-layout: fixed; width: 100%; min-width: 820px; }
    .fields-table td { overflow-wrap: break-word; }
    .changed-on { display: block; font-size: 11.5px; color: #8a9899; margin-top: 4px; }
        .fields-table td { vertical-align: top; padding-top: 12px; padding-bottom: 12px; }
    .fields-table tbody tr:hover { background: var(--zt-pale, #f7fbfb); }
    .fields-table tr.is-off td { color: #8a9899; }
    .order-no {
      display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 14px;
      background: #eef6f6; color: #23474a; font-weight: 700; font-size: 13px;
    }
    .field-heading { display: block; text-transform: uppercase; letter-spacing: .04em; font-size: 11px; font-weight: 700; color: var(--zt-mid2, #2f7c83); margin-bottom: 2px; }
    .field-label { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .field-label strong { color: #232527; font-size: 14.5px; }
    .is-off .field-label strong { color: #8a9899; }
    .field-note, .field-help { display: block; font-size: 12.5px; margin-top: 2px; }
    .field-note { color: #5f6f70; }
    .field-help { color: #3b4b4c; }
    .cond { font-size: 11px; font-weight: 700; background: #fff4d6; color: #8a6100; border-radius: 4px; padding: 0 4px; margin-right: 2px; }
    .scope { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 0; margin-top: 6px; }
    .scope .zed-chip { font-size: 11px; padding: 1px 8px; }
    .scope .zed-chip.sector { background: #f1f0fb; color: #3f3a7a; }
    .type-name { font-size: 13px; color: #3b4b4c; }
    .status-badge.wrap { white-space: normal; }
    /* The row controls (af-actions, af-switch, req-chip): styles/_v4-blocks.scss; the buttons are the standard btn classes. */
    .af-actions .st-move { width: 32px; padding-left: 0; padding-right: 0; font-weight: 700; }
    /* position: relative keeps the switch's hidden input inside the table's scroll box (it widened the page on phones). */
    .af-switch { position: relative; white-space: nowrap; }
    /* Phone: one card per field, no sideways scroll. */
    @media (max-width: 767.98px) {
      .fields-table { min-width: 0; table-layout: auto; }
      .fields-table thead { display: none; }
      .fields-table, .fields-table tbody, .fields-table tr, .fields-table td { display: block; width: 100%; }
      .fields-table tr { border-bottom: 1px solid #dfe9ea; padding: 8px 0; }
      .fields-table td { border: 0; padding: 3px 0 !important; text-align: left !important; }
      .fields-table td:first-child { display: none; }
      .fields-table tr.column { padding-left: 16px; }
      .fields-table .af-actions { justify-content: flex-start; flex-wrap: wrap; }
      .fields-table .af-note { text-align: left; }
    }

    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }`,
})
export class AppFormsPage {
  private readonly http = inject(HttpClient);
  private readonly confirms = inject(ConfirmService);
  private static readonly url = '/api/staff/settings/app-forms';

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
    firstValueFrom(this.http.get<{ code: string; name: string; disabled?: boolean }[]>('/api/staff/masters/sectors'))
      .then((list) => this.sectorOptions.set(list.filter((x) => !x.disabled).map((x) => ({ value: x.code, label: `${x.code} - ${x.name}` }))))
      .catch(() => undefined);
  }

  protected inSection(section: string): AppFieldItem[] {
    return this.bySection().get(section) ?? [];
  }

  /** The header line of a section card: its fields, and how many are hidden from the app. */
  protected sectionSummary(section: string): string {
    const fields = this.inSection(section);
    const off = fields.filter((f) => !f.enabled).length;
    const count = fields.length === 1
      ? t('staff.appForms.summary.field', '{count} field', { count: fields.length })
      : t('staff.appForms.summary.fields', '{count} fields', { count: fields.length });
    return off ? `${count} · ${t('staff.appForms.summary.disabledCount', '{count} disabled', { count: off })}` : count;
  }

  protected levelName(code: string): string {
    return this.details()?.levels?.find((l) => l.code === code)?.name ?? code;
  }

  /** The pop-up's line under the preview: who is asked the field. */
  protected scopeOf(e: Editing): string {
    const levels = e.levels.map((l) => this.levelName(l)).join(', ');
    const sectors = e.nicSectors.join(', ');
    if (levels && sectors) return t('staff.appForms.dialog.scope.someNote', 'Asked for {levels}, of NIC sectors {sectors}.', { levels, sectors });
    if (levels) return t('staff.appForms.dialog.scope.levelsNote', 'Asked for {levels}, of units of every sector.', { levels });
    if (sectors) return t('staff.appForms.dialog.scope.sectorsNote', 'Asked for every level, of NIC sectors {sectors}.', { sectors });
    return t('staff.appForms.dialog.scope.allNote', 'Asked for every level, of units of every sector.');
  }

  /** How the preview draws the field. */
  protected previewKind(e: Editing): string {
    if (this.isChoice(e.type)) return 'choice';
    return ['yesno', 'photo', 'date', 'rows'].includes(e.type) ? e.type : 'input';
  }

  protected previewChoices(e: Editing): string[] {
    const choices = e.options.map((o) => o.trim()).filter((o) => o);
    return choices.length ? choices.slice(0, 5)
      : [t('staff.appForms.dialog.preview.choice1Label', 'Choice 1'), t('staff.appForms.dialog.preview.choice2Label', 'Choice 2')];
  }

  protected firstChoice(e: Editing): string {
    return e.options.map((o) => o.trim()).find((o) => o) ?? '';
  }

  /** "All levels · All sectors", or the levels and sectors it is limited to. */
  protected scopeText(f: AppFieldItem): string {
    const names = new Map((this.details()?.levels ?? []).map((l) => [l.code, l.name]));
    const levels = f.levels?.length ? f.levels.map((l) => names.get(l) ?? l).join(', ') : t('staff.appForms.row.scope.allLevelsTooltip', 'All levels');
    const sectors = f.nicSectors?.length ? t('staff.appForms.row.scope.nicTooltip', 'NIC {codes}', { codes: f.nicSectors.join(', ') })
      : t('staff.appForms.row.scope.allSectorsTooltip', 'all sectors');
    return `${levels} · ${sectors}`;
  }

  protected typeName(f: AppFieldItem): string {
    const name = fieldTypeName(f.type);
    return f.maxItems && f.type === 'photo' ? t('staff.appForms.type.upToLabel', '{type} (up to {count})', { type: name, count: f.maxItems }) : name;
  }

  /** The name of a type on the type tiles and the column type list. */
  protected typeLabel(type: string): string {
    return fieldTypeName(type);
  }

  protected status(f: AppFieldItem): string {
    if (!f.enabled) return t('staff.appForms.status.disabledLabel', 'Disabled');
    return f.active ? t('staff.appForms.status.shownLabel', 'Shown') : t('staff.appForms.status.hiddenLabel', 'Not shown (depends on a disabled field)');
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
      levels: [], nicSectors: [], limitLevels: false, limitSectors: false, validationRequired: false, maxItems: null,
      columns: [{ key: null, label: '', type: 'text', required: true, options: '', maxItems: 1 }],
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
      validationRequired: !!f.validationRequired,
      maxItems: f.custom && f.type === 'rows' ? (f.maxItems ?? null) : null,
      columns: f.custom && f.type === 'rows'
        ? (f.columns ?? []).map((c) => ({
          key: c.key.includes('/') ? c.key.slice(c.key.indexOf('/') + 1) : c.key, label: c.label, type: c.type, required: c.required,
          options: (c.options ?? []).join(', '), maxItems: c.maxItems ?? 1,
        }))
        : [{ key: null, label: '', type: 'text', required: true, options: '', maxItems: 1 }],
    });
  }

  protected readonly columnTypes = COLUMN_TYPES;

  protected addColumn(e: Editing): void {
    e.columns.push({ key: null, label: '', type: 'text', required: false, options: '', maxItems: 1 });
  }

  protected removeColumn(e: Editing, index: number): void {
    e.columns.splice(index, 1);
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
      validationRequired: e.type !== 'rows' && e.validationRequired && (e.custom || !e.field?.noValidation),
      columns: e.custom && e.type === 'rows'
        ? e.columns.map((c) => ({
          key: c.key, label: c.label.trim(), type: c.type, required: c.required,
          options: this.isChoice(c.type) ? c.options.split(',').map((o) => o.trim()).filter((o) => o) : null,
          maxItems: c.type === 'photo' ? Number(c.maxItems) || 1 : null,
        }))
        : null,
      maxItems: e.custom && e.type === 'rows' && e.maxItems ? Number(e.maxItems) : null,
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

  protected async reset(f: AppFieldItem): Promise<void> {
    const ok = await this.confirms.ask({
      title: t('staff.appForms.reset.title', 'Reset to the Standard Field?'),
      message: t('staff.appForms.reset.message', '"{field}" uses the standard label, help and settings again.', { field: f.label }),
      confirmLabel: t('staff.appForms.reset.confirmButton', 'Reset'), danger: true,
    });
    if (!ok) return;
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
