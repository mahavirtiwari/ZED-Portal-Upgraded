import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { TextPipe, t } from '../../content/page-text';
import { uploadProblem } from '../schemes/schemes.api';
import { FormField, IncentiveSchemesApi, filesOf } from './incentive-schemes.api';

/**
 * One field of a scheme's generic form (2026-11-20, approved design), drawn by its type: text / long text with a counter,
 * number, amount (₹, two decimals), date within its bounds, choice (radios, or a drop-down for many options), multiple choice,
 * yes / no, copy (the read-only value of its source) and document / photo (the files with View / Remove, "+ Upload" up to the
 * field's files). The value is a string as the API keeps it (a JSON list for documents and multiple choice).
 */
@Component({
  selector: 'zed-scheme-field',
  imports: [NgTemplateOutlet, TextPipe],
  host: { class: 'isf', '[class.isf-flag]': '!!remark()', '[class.isf-wide]': 'wide()' },
  template: `
    @let f = field();
    <label class="isf-label" [attr.for]="id()">{{ f.label }}@if (f.required && f.type !== 'copy') { <span class="req" aria-hidden="true">*</span> }</label>
    @if (f.help) { <small class="isf-help">{{ f.help }}</small> }
    @if (remark() !== null) {
      <p class="isf-remark" role="note"><b>{{ 'Not valid' | t: 'msme.incentiveScheme.field.notValid' }}</b>@if (remark()) { : {{ remark() }} }</p>
    }
    @switch (f.type) {
      @case ('longtext') {
        <textarea class="form-control" rows="3" [id]="id()" [attr.maxlength]="maxLength()" [disabled]="readonly()" [value]="value() ?? ''" (input)="set($any($event.target).value)"></textarea>
        <small class="isf-count">{{ (value() ?? '').length }} / {{ maxLength() }}</small>
      }
      @case ('number') {
        <input type="number" class="form-control" [attr.step]="f.wholeNumber ? 1 : null" [attr.inputmode]="f.wholeNumber ? 'numeric' : 'decimal'" [id]="id()" [attr.min]="f.min" [attr.max]="f.max" [disabled]="readonly()" [value]="value() ?? ''" (input)="set($any($event.target).value)" />
      }
      @case ('amount') {
        <div class="input-group">
          <span class="input-group-text">₹</span>
          <input type="number" class="form-control" step="0.01" inputmode="decimal" [id]="id()" [attr.min]="f.min ?? 0" [attr.max]="f.max" [disabled]="readonly()" [value]="value() ?? ''" (input)="set($any($event.target).value)" />
        </div>
      }
      @case ('date') {
        <input type="date" class="form-control" [id]="id()" [attr.min]="minDate() || null" [attr.max]="maxDate() || null" [disabled]="readonly()" [value]="value() ?? ''" (input)="set($any($event.target).value)" />
      }
      @case ('choice') {
        @if ((f.options ?? []).length <= 4) {
          <div class="isf-radios" role="radiogroup" [attr.aria-label]="f.label">
            @for (o of f.options ?? []; track o) {
              <label class="isf-opt"><input type="radio" [name]="id()" [value]="o" [checked]="value() === o" [disabled]="readonly()" (change)="set(o)" /> <span>{{ o }}</span></label>
            }
          </div>
        } @else {
          <select class="form-select" [id]="id()" [disabled]="readonly()" (change)="set($any($event.target).value)">
            <option value="" [selected]="!value()">{{ '-Select-' | t: 'msme.incentiveScheme.field.select' }}</option>
            @for (o of f.options ?? []; track o) { <option [value]="o" [selected]="value() === o">{{ o }}</option> }
          </select>
        }
      }
      @case ('multichoice') {
        <div class="isf-radios" role="group" [attr.aria-label]="f.label">
          @for (o of f.options ?? []; track o) {
            <label class="isf-opt"><input type="checkbox" [checked]="picked().includes(o)" [disabled]="readonly()" (change)="toggle(o)" /> <span>{{ o }}</span></label>
          }
        </div>
      }
      @case ('yesno') {
        <div class="isf-radios" role="radiogroup" [attr.aria-label]="f.label">
          <label class="isf-opt"><input type="radio" [name]="id()" value="Yes" [checked]="value() === 'Yes'" [disabled]="readonly()" (change)="set('Yes')" /> <span>{{ 'Yes' | t: 'msme.incentiveScheme.field.yes' }}</span></label>
          <label class="isf-opt"><input type="radio" [name]="id()" value="No" [checked]="value() === 'No'" [disabled]="readonly()" (change)="set('No')" /> <span>{{ 'No' | t: 'msme.incentiveScheme.field.no' }}</span></label>
        </div>
      }
      @case ('copy') {
        <input class="form-control" [id]="id()" readonly [value]="copy() ?? ''" />
      }
      @case ('document') { <ng-container [ngTemplateOutlet]="docs" /> }
      @case ('photo') { <ng-container [ngTemplateOutlet]="docs" /> }
      @default {
        <input class="form-control" [id]="id()" [attr.maxlength]="maxLength()" [disabled]="readonly()" [value]="value() ?? ''" (input)="set($any($event.target).value)" />
        <small class="isf-count">{{ (value() ?? '').length }} / {{ maxLength() }}</small>
      }
    }
    <ng-template #docs>
      <ul class="isf-files">
        @for (name of files(); track name) {
          <li>
            <a [href]="fileUrl(name)" target="_blank" rel="noopener">{{ name.endsWith('.pdf') ? ('PDF document' | t: 'msme.incentiveScheme.field.pdf') : ('Image' | t: 'msme.incentiveScheme.field.image') }} {{ $index + 1 }}</a>
            @if (!readonly()) {
              <button type="button" class="isf-remove" [attr.aria-label]="'Remove {label}' | t: 'msme.incentiveScheme.field.removeAria' : { label: f.label }" (click)="remove(name)">&times;</button>
            }
          </li>
        } @empty {
          <li class="isf-none">{{ 'No file uploaded' | t: 'msme.incentiveScheme.field.noFile' }}</li>
        }
      </ul>
      @if (!readonly() && files().length < maxFiles()) {
        <label class="isf-upload" [class.disabled]="uploading()">
          {{ '+ Upload' | t: 'msme.incentiveScheme.field.uploadButton' }}
          <input type="file" [id]="id()" [attr.accept]="f.type === 'photo' ? 'image/jpeg,image/png' : 'image/jpeg,image/png,application/pdf'" [disabled]="uploading()" (change)="pick($event)" />
        </label>
      }
      <small class="isf-hint">
        @if (f.type === 'photo') { {{ 'JPG / PNG ≤ 5 MB, up to {n} file(s)' | t: 'msme.incentiveScheme.field.photoHint' : { n: maxFiles() } }} }
        @else { {{ 'PDF / JPG / PNG ≤ 5 MB, up to {n} file(s)' | t: 'msme.incentiveScheme.field.documentHint' : { n: maxFiles() } }} }
      </small>
    </ng-template>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    :host(.isf-wide) { grid-column: 1 / -1; }
    :host(.isf-flag) { padding: 10px 12px; border: 1px solid #f0c36d; border-radius: 10px; background: #fffaf0; }
    .isf-label { margin: 0; font-size: 13px; font-weight: 700; color: #3b4b4c; }
    .req { color: #c0392b; margin-left: 2px; }
    .isf-help, .isf-count, .isf-hint { font-size: 12px; color: #6f8487; }
    .isf-count { align-self: flex-end; }
    .isf-remark { margin: 0; font-size: 12.5px; color: #8a5a00; }
    .form-control, .form-select { border-radius: 8px; border-color: #cfdcdd; }
    .isf-radios { display: flex; flex-wrap: wrap; gap: 8px; }
    .isf-opt { display: inline-flex; align-items: center; gap: 8px; margin: 0; padding: 7px 12px; border: 1px solid #cfdcdd; border-radius: 8px; font-size: 14px; cursor: pointer; }
    .isf-opt:has(input:checked) { border-color: #24666b; background: #eef5f4; }
    .isf-opt input { accent-color: #24666b; }
    .isf-files { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .isf-files li { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; border-radius: 8px; background: #f3f6f6; overflow-wrap: anywhere; }
    .isf-files a { color: #24666b; font-weight: 600; text-decoration: none; }
    .isf-none { color: #6f8487; font-size: 13px; }
    .isf-remove { border: 0; background: none; font-size: 18px; line-height: 1; color: #6f8487; cursor: pointer; }
    .isf-upload { position: relative; overflow: hidden; align-self: flex-start; padding: 7px 16px; border-radius: 8px; font-size: 13px; font-weight: 700; color: #fff; background: #24666b; cursor: pointer; }
    .isf-upload.disabled { opacity: .6; }
    .isf-upload input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  `,
})
export class SchemeFieldComponent {
  private readonly api = inject(IncentiveSchemesApi);

  readonly field = input.required<FormField>();
  readonly value = input<string | null | undefined>(null);
  readonly code = input.required<string>();
  readonly section = input.required<string>();
  readonly item = input(0);
  readonly readonly = input(false);
  /** The value a copy field shows. */
  readonly copy = input<string | null | undefined>(null);
  readonly minDate = input('');
  readonly maxDate = input('');
  /** The assessor's remark when the answer was found not valid ('' without a remark), else null. */
  readonly remark = input<string | null>(null);
  readonly valueChange = output<string | null>();
  readonly failed = output<string>();

  protected readonly uploading = signal(false);
  protected readonly id = computed(() => `isf-${this.section()}-${this.item()}-${this.field().key}`);
  protected readonly maxLength = computed(() => this.field().maxLength ?? (this.field().type === 'longtext' ? 2000 : 200));
  protected readonly maxFiles = computed(() => Math.min(Math.max(this.field().maxFiles ?? 1, 1), 3));
  protected readonly files = computed(() => filesOf(this.value()));
  protected readonly picked = computed(() => filesOf(this.value()));
  protected readonly wide = computed(() => ['longtext', 'document', 'photo', 'multichoice'].includes(this.field().type));

  protected set(v: string): void {
    this.valueChange.emit(v === '' ? null : v);
  }

  protected toggle(option: string): void {
    const list = this.picked();
    const next = list.includes(option) ? list.filter((o) => o !== option) : [...list, option];
    this.valueChange.emit(next.length ? JSON.stringify(next) : null);
  }

  protected fileUrl(name: string): string {
    return this.api.fileUrl(this.code(), name);
  }

  protected remove(name: string): void {
    const next = this.files().filter((n) => n !== name);
    this.valueChange.emit(next.length ? JSON.stringify(next) : null);
  }

  protected async pick(event: Event): Promise<void> {
    const el = event.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    const problem = uploadProblem(file);
    if (problem) {
      this.failed.emit(problem);
      return;
    }
    if (this.field().type === 'photo' && !file.type.startsWith('image/')) {
      this.failed.emit(t('msme.incentiveScheme.field.photoError', 'Please upload a photo (JPG / PNG).'));
      return;
    }
    this.uploading.set(true);
    try {
      const up = await firstValueFrom(this.api.upload(this.code(), this.section(), this.item(), this.field().key, file));
      this.valueChange.emit(JSON.stringify([...this.files(), up.fileName]));
    } catch (err) {
      this.failed.emit(apiErrorMessage(err));
    } finally {
      this.uploading.set(false);
    }
  }
}
