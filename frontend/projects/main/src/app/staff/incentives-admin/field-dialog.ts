import { Component, OnInit, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TextPipe, t } from '../../content/page-text';
import { CHECK_STAGES, FIELD_TYPES, FormField, SCHEME_LIMITS, UNIQUE_TYPES, checkStageLabel, fieldTypeLabel, keyFrom } from './schemes-admin.api';

type BoundKind = '' | 'today' | 'certified' | 'days' | 'date';
interface Bound { kind: BoundKind; days: number | null; date: string }

/** "today", "certified", "days:N", "date:yyyy-MM-dd" ↔ the pop-up's choice. */
export function parseBound(v: string | null | undefined): Bound {
  if (v === 'today' || v === 'certified') return { kind: v, days: null, date: '' };
  if (v?.startsWith('days:')) return { kind: 'days', days: Number(v.slice(5)) || 0, date: '' };
  if (v?.startsWith('date:')) return { kind: 'date', days: null, date: v.slice(5) };
  return { kind: '', days: null, date: '' };
}

export function formatBound(b: Bound): string | null {
  switch (b.kind) {
    case 'today': case 'certified': return b.kind;
    case 'days': return b.days != null && b.days >= 0 ? `days:${Math.floor(b.days)}` : null;
    case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? `date:${b.date}` : null;
    default: return null;
  }
}

/**
 * The pop-up of a scheme form's field (Admin → Incentive Schemes → Form): its key, label, help, type and the limits of the
 * type (length, minimum / maximum, earliest / latest date, options, the field it copies, the claim, files).
 */
@Component({
  selector: 'zed-scheme-field-dialog',
  imports: [FormsModule, NgTemplateOutlet, TextPipe],
  template: `
    <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="fd-title">
      <div class="modal-dialog modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <div class="modal-title w-100 d-flex justify-content-between align-items-center">
              <h3 class="registration-title m-0" id="fd-title">{{ isNew() ? ('Add field' | t: 'staff.incentivesAdmin.field.addTitle') : ('Edit field' | t: 'staff.incentivesAdmin.field.editTitle') }}</h3>
              <button type="button" class="btn btn-link p-0" [attr.aria-label]="'Close' | t: 'staff.incentivesAdmin.field.closeAria'" (click)="cancelled.emit()"><img src="Images/svgicons/close.svg" alt="" /></button>
            </div>
          </div>
          @if (f) {
            <div class="modal-body fd-body">
              <label for="fd-label">{{ 'Label' | t: 'staff.incentivesAdmin.field.label' }}<span class="req">*</span></label>
              <input id="fd-label" class="form-control" maxlength="200" [(ngModel)]="f.label" (ngModelChange)="labelChanged()" />
              <label for="fd-key">{{ 'Key' | t: 'staff.incentivesAdmin.field.key' }}<span class="req">*</span></label>
              <input id="fd-key" class="form-control fd-mono" maxlength="40" [disabled]="!isNew()" [(ngModel)]="f.key" (ngModelChange)="keyTouched = true" />
              <label for="fd-help">{{ 'Help' | t: 'staff.incentivesAdmin.field.help' }}</label>
              <input id="fd-help" class="form-control" maxlength="300" [(ngModel)]="f.help" />
              <label for="fd-type">{{ 'Type' | t: 'staff.incentivesAdmin.field.type' }}</label>
              <select id="fd-type" class="form-select" [(ngModel)]="f.type">
                @for (ty of types; track ty) { <option [value]="ty">{{ typeLabel(ty) }}</option> }
              </select>
              <div class="fd-checks">
                <label><input type="checkbox" id="fd-required" [(ngModel)]="f.required" /> {{ 'Required' | t: 'staff.incentivesAdmin.field.required' }}</label>
                <label><input type="checkbox" id="fd-checks" [(ngModel)]="f.assessorChecks" /> {{ 'The assessor checks it' | t: 'staff.incentivesAdmin.field.assessorChecks' }}</label>
                @if (f.type === 'amount') {
                  <label><input type="checkbox" id="fd-claim" [(ngModel)]="f.isClaim" /> {{ 'Claim amount (adds up to the claim)' | t: 'staff.incentivesAdmin.field.claim' }}</label>
                }
                @if (canBeUnique()) {
                  <label><input type="checkbox" id="fd-unique" [(ngModel)]="f.unique" /> {{ 'Unique: the value cannot be used again in another application of the unit (e.g. an invoice number)' | t: 'staff.incentivesAdmin.field.unique' }}</label>
                }
              </div>
              @if (f.assessorChecks && onsiteFlow()) {
                <label for="fd-stage">{{ 'Checked at' | t: 'staff.incentivesAdmin.field.stage' }}</label>
                <select id="fd-stage" class="form-select" [(ngModel)]="f.checkStage">
                  @for (s of stages; track s) { <option [ngValue]="s">{{ stageLabel(s) }}</option> }
                </select>
                <small class="muted d-block mt-1">{{ 'Onsite: the onsite assessor marks it Valid / Not valid at the visit in the assessor app; the desktop assessor does not check it.' | t: 'staff.incentivesAdmin.field.stageHelp' }}</small>
              }
              @if (f.type === 'text' || f.type === 'longtext') {
                <label for="fd-maxlength">{{ 'Maximum length' | t: 'staff.incentivesAdmin.field.maxLength' }}</label>
                <input id="fd-maxlength" type="number" class="form-control" min="1" [max]="limits.text" [(ngModel)]="f.maxLength" />
              }
              @if (f.type === 'number' || f.type === 'amount') {
                <div class="fd-pair">
                  <span><label for="fd-min">{{ 'Minimum' | t: 'staff.incentivesAdmin.field.min' }}</label><input id="fd-min" type="number" class="form-control" [(ngModel)]="f.min" /></span>
                  <span><label for="fd-max">{{ 'Maximum' | t: 'staff.incentivesAdmin.field.max' }}</label><input id="fd-max" type="number" class="form-control" [(ngModel)]="f.max" /></span>
                </div>
                @if (f.type === 'number') {
                  <label class="mt-2"><input type="checkbox" id="fd-whole" [(ngModel)]="f.wholeNumber" /> {{ 'Whole numbers only (e.g. years, counts)' | t: 'staff.incentivesAdmin.field.wholeNumber' }}</label>
                }
              }
              @if (f.type === 'date') {
                <label for="fd-date-min">{{ 'Earliest date' | t: 'staff.incentivesAdmin.field.dateMin' }}</label>
                <ng-container *ngTemplateOutlet="bound; context: { $implicit: dateMin, id: 'fd-date-min' }" />
                <label for="fd-date-max">{{ 'Latest date' | t: 'staff.incentivesAdmin.field.dateMax' }}</label>
                <ng-container *ngTemplateOutlet="bound; context: { $implicit: dateMax, id: 'fd-date-max' }" />
              }
              <ng-template #bound let-b let-id="id">
                <div class="fd-pair">
                  <select [id]="id" class="form-select" [(ngModel)]="b.kind">
                    <option value="">{{ 'No limit' | t: 'staff.incentivesAdmin.field.bound.none' }}</option>
                    <option value="today">{{ 'Today' | t: 'staff.incentivesAdmin.field.bound.today' }}</option>
                    <option value="certified">{{ 'Certification date' | t: 'staff.incentivesAdmin.field.bound.certified' }}</option>
                    <option value="days">{{ 'Some days back' | t: 'staff.incentivesAdmin.field.bound.days' }}</option>
                    <option value="date">{{ 'A fixed date' | t: 'staff.incentivesAdmin.field.bound.date' }}</option>
                  </select>
                  @if (b.kind === 'days') { <input type="number" class="form-control" min="0" max="9999" [attr.aria-label]="'Days back' | t: 'staff.incentivesAdmin.field.bound.daysAria'" [(ngModel)]="b.days" /> }
                  @if (b.kind === 'date') { <input type="date" class="form-control" [attr.aria-label]="'Date' | t: 'staff.incentivesAdmin.field.bound.dateAria'" [(ngModel)]="b.date" /> }
                </div>
              </ng-template>
              @if (f.type === 'choice' || f.type === 'multichoice') {
                <label for="fd-options">{{ 'Options (one per line)' | t: 'staff.incentivesAdmin.field.options' }}<span class="req">*</span></label>
                <textarea id="fd-options" class="form-control" rows="4" [(ngModel)]="optionsText"></textarea>
              }
              @if (f.type === 'copy') {
                <label for="fd-copy">{{ 'Copies the field' | t: 'staff.incentivesAdmin.field.copyOf' }}<span class="req">*</span></label>
                <select id="fd-copy" class="form-select" [(ngModel)]="f.copyOf">
                  <option [ngValue]="null">{{ 'Choose…' | t: 'staff.incentivesAdmin.field.choose' }}</option>
                  @for (c of copyChoices(); track c.value) { <option [ngValue]="c.value">{{ c.label }}</option> }
                </select>
              }
              @if (f.type === 'document' || f.type === 'photo') {
                <label for="fd-files">{{ 'Files (at most)' | t: 'staff.incentivesAdmin.field.maxFiles' }}</label>
                <select id="fd-files" class="form-select" [(ngModel)]="f.maxFiles">
                  @for (n of [1, 2, 3]; track n) { <option [ngValue]="n">{{ n }}</option> }
                </select>
              }
              @if (error()) { <div class="alert alert-danger mt-3 mb-0" role="alert">{{ error() }}</div> }
            </div>
          }
          <div class="modal-footer">
            <button type="button" class="btn btn-default" (click)="cancelled.emit()">{{ 'Cancel' | t: 'staff.incentivesAdmin.field.cancelButton' }}</button>
            <button type="button" class="btn btn-primary" id="fd-ok" (click)="ok()">{{ 'OK' | t: 'staff.incentivesAdmin.field.okButton' }}</button>
          </div>
        </div>
      </div>
    </div>
    <div class="modal-backdrop show"></div>
  `,
  styles: `
    .fd-body > label { display: block; font-weight: 600; margin: 12px 0 4px; }
    .fd-body > label:first-child { margin-top: 0; }
    .fd-mono { font-family: monospace; }
    .fd-checks { display: flex; flex-direction: column; gap: 4px; margin-top: 12px; }
    .fd-checks label { display: flex; align-items: center; gap: 8px; font-weight: 400; cursor: pointer; }
    .fd-pair { display: flex; gap: 8px; }
    .fd-pair > * { flex: 1 1 0; min-width: 0; }
    .fd-pair label { display: block; font-weight: 600; margin: 12px 0 4px; }
  `,
})
export class FieldDialogComponent implements OnInit {
  readonly field = input.required<FormField>();
  readonly isNew = input(false);
  /** The other fields' keys of the section. */
  readonly takenKeys = input<string[]>([]);
  readonly copyChoices = input<{ value: string; label: string }[]>([]);
  /** Phase 2: the scheme's flow is Desktop + Onsite (then "Checked at" is asked). */
  readonly onsiteFlow = input(false);
  readonly saved = output<FormField>();
  readonly cancelled = output<void>();

  protected readonly types = FIELD_TYPES;
  protected readonly stages = CHECK_STAGES;
  protected readonly limits = SCHEME_LIMITS;
  protected readonly error = signal('');
  protected f: FormField | null = null;
  protected optionsText = '';
  protected dateMin: Bound = parseBound(null);
  protected dateMax: Bound = parseBound(null);
  protected keyTouched = false;

  ngOnInit(): void {
    const x = this.field();
    this.f = { ...x, options: [...(x.options ?? [])], checkStage: x.checkStage ?? 'desktop' };
    this.optionsText = this.f.options.join('\n');
    this.dateMin = parseBound(x.dateMin);
    this.dateMax = parseBound(x.dateMax);
    this.keyTouched = !!x.key;
  }

  protected stageLabel(stage: (typeof CHECK_STAGES)[number]): string {
    return checkStageLabel(stage);
  }

  /** 2026-11-20: a text, number, amount or date can be unique (SchemeRules.UniqueTypes). */
  protected canBeUnique(): boolean {
    return !!this.f && UNIQUE_TYPES.includes(this.f.type);
  }

  protected typeLabel(type: string): string {
    return fieldTypeLabel(type);
  }

  protected labelChanged(): void {
    if (this.f && this.isNew() && !this.keyTouched) this.f.key = keyFrom(this.f.label, this.takenKeys());
  }

  protected ok(): void {
    const f = this.f;
    if (!f) return;
    const key = f.key.trim();
    const options = this.optionsText.split('\n').map((o) => o.trim()).filter((o) => o);
    if (!f.label.trim()) return this.error.set(t('staff.incentivesAdmin.field.error.label', 'Enter the label.'));
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) return this.error.set(t('staff.incentivesAdmin.field.error.key', 'The key: small letters, digits and _, starting with a letter.'));
    if (this.takenKeys().includes(key)) return this.error.set(t('staff.incentivesAdmin.field.error.keyTaken', 'Another field of the section has this key.'));
    const isChoice = f.type === 'choice' || f.type === 'multichoice';
    if (isChoice && (options.length === 0 || options.length > SCHEME_LIMITS.options)) return this.error.set(t('staff.incentivesAdmin.field.error.options', 'Enter 1 to 50 options.'));
    if (f.type === 'copy' && !f.copyOf) return this.error.set(t('staff.incentivesAdmin.field.error.copy', 'Choose the field it copies.'));
    const isNumber = f.type === 'number' || f.type === 'amount';
    const whole = f.type === 'number' && !!f.wholeNumber;
    if (whole && [f.min, f.max].some((v) => v != null && !Number.isInteger(Number(v))))
      return this.error.set(t('staff.incentivesAdmin.field.error.wholeBounds', 'The minimum and maximum of a whole-number field are whole numbers.'));
    const isText = f.type === 'text' || f.type === 'longtext';
    const isFile = f.type === 'document' || f.type === 'photo';
    // Only the limits of the chosen type are kept.
    this.saved.emit({
      key,
      label: f.label.trim(),
      help: f.help?.trim() || null,
      type: f.type,
      required: f.required,
      assessorChecks: f.assessorChecks,
      maxLength: isText && f.maxLength ? f.maxLength : null,
      min: isNumber ? (f.min ?? null) : null,
      max: isNumber ? (f.max ?? null) : null,
      dateMin: f.type === 'date' ? formatBound(this.dateMin) : null,
      dateMax: f.type === 'date' ? formatBound(this.dateMax) : null,
      options: isChoice ? options : [],
      copyOf: f.type === 'copy' ? f.copyOf : null,
      isClaim: f.type === 'amount' && f.isClaim,
      // 2026-11-20 (no duplicate claims): text, number, amount and date fields only.
      unique: UNIQUE_TYPES.includes(f.type) && !!f.unique,
      wholeNumber: f.type === 'number' && !!f.wholeNumber,
      maxFiles: isFile ? (f.maxFiles ?? 1) : null,
      // Desktop is the default (not stored); a Desktop-only scheme keeps the choice but ignores it.
      checkStage: f.assessorChecks && f.checkStage && f.checkStage !== 'desktop' ? f.checkStage : null,
    });
  }
}
