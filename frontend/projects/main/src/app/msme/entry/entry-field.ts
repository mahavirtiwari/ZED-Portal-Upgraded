import { Component, OnDestroy, computed, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MultiSelect, MultiSelectOption } from '../../staff/users/multi-select';
import { COUNTRIES } from './countries';
import { CellValue, PhotoSlot } from './entry-form';
import { FormField } from './entry.api';

/** Product label/description: a photo or a PDF, as in the app. */
const PDF_ALLOWED = ['productDescriptionPhoto'];

/**
 * One answer of the Admin's form (Admin → App Forms) by its type: text, number, decimal, date, yes/no, dropdown,
 * check boxes, multiple choice and photos. Used for the top-level fields and for the columns of a "rows" field.
 */
@Component({
  selector: 'zed-entry-field',
  imports: [FormsModule, MultiSelect],
  template: `
    @let f = field();
    @switch (f.type) {
      @case ('yesno') {
        <div class="yes-no" role="radiogroup" [attr.aria-label]="f.label">
          @for (o of ['Yes', 'No']; track o) {
            <label class="radio-inline me-3">
              <input type="radio" [name]="inputId()" [checked]="value() === o" [disabled]="disabled()" (change)="value.set(o)" /> {{ o }}
            </label>
          }
        </div>
      }
      @case ('dropdown') {
        <select class="form-control" [id]="inputId()" [disabled]="disabled()" [ngModel]="value() ?? ''" (ngModelChange)="value.set($event || null)">
          <option value="">Select</option>
          @for (o of f.options ?? []; track o) { <option [value]="o">{{ o }}</option> }
        </select>
      }
      @case ('checkboxes') {
        <div class="checks">
          @for (o of f.options ?? []; track o) {
            <label class="checkbox-inline me-3">
              <input type="checkbox" [checked]="list().includes(o)" [disabled]="disabled()" (change)="toggle(o)" /> {{ o }}
            </label>
          }
        </div>
      }
      @case ('multiselect') {
        <zed-multi-select [inputId]="inputId()" [label]="f.label" [options]="choices()" [disabled]="disabled()" [value]="list()" (valueChange)="value.set($event)" />
      }
      @case ('photo') {
        <div class="photos">
          @for (s of slots(); track $index) {
            <div class="photo-slot">
              @if (isPdf(s)) {
                <a [href]="s.saved?.url ?? preview(s)" target="_blank" rel="noopener" class="pdf-link">PDF {{ s.file?.name ?? '' }}</a>
              } @else {
                <a [href]="s.saved?.url ?? preview(s)" target="_blank" rel="noopener"><img [src]="s.saved?.url ?? preview(s)" [alt]="f.label" /></a>
              }
              @if (!disabled()) {
                <button type="button" class="btn btn-link btn-sm text-danger p-0" [attr.aria-label]="'Remove ' + f.label" (click)="remove($index)">Remove</button>
              }
            </div>
          }
          @if (!disabled() && slots().length < max()) {
            <label class="btn btn-outline-primary btn-sm add-photo">
              {{ pdf() ? 'Add photo / PDF' : 'Add photo' }}
              <input type="file" class="visually-hidden" [id]="inputId()" [attr.aria-label]="f.label" [accept]="accept()" (change)="add($event)" />
            </label>
          }
        </div>
      }
      @case ('date') {
        <input type="date" class="form-control" [id]="inputId()" [disabled]="disabled()" [ngModel]="value() ?? ''" (ngModelChange)="value.set($event || null)" />
      }
      @default {
        @if (f.type === 'text' && (f.maxLength ?? 0) === 0 && !inRow()) {
          <textarea class="form-control" rows="2" maxlength="2000" [id]="inputId()" [disabled]="disabled()"
                    [ngModel]="value() ?? ''" (ngModelChange)="value.set($event)"></textarea>
        } @else {
          <input class="form-control" [id]="inputId()" [disabled]="disabled()" [attr.inputmode]="f.type === 'text' ? null : 'decimal'"
                 [attr.maxlength]="f.maxLength ?? (f.type === 'text' ? 200 : 20)" [ngModel]="value() ?? ''" (ngModelChange)="value.set($event)" />
        }
      }
    }
  `,
  styles: `
    .photos { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-start; }
    .photo-slot { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
    .photo-slot img { width: 96px; height: 72px; object-fit: cover; border: 1px solid #dee2e6; border-radius: 4px; }
    .pdf-link { display: inline-block; padding: 24px 12px; border: 1px solid #dee2e6; border-radius: 4px; font-size: 12px; max-width: 120px; overflow-wrap: anywhere; }
    .add-photo { cursor: pointer; margin: 0; }
  `,
})
export class EntryField implements OnDestroy {
  readonly field = input.required<FormField>();
  readonly value = model<CellValue>(null);
  readonly inputId = input.required<string>();
  readonly disabled = input(false);
  /** A column of a "rows" field (always one line). */
  readonly inRow = input(false);

  private readonly previews = new Map<File, string>();

  protected readonly list = computed(() => (Array.isArray(this.value()) ? (this.value() as string[]) : []));
  protected readonly slots = computed(() => (Array.isArray(this.value()) ? (this.value() as PhotoSlot[]) : []));
  protected readonly max = computed(() => this.field().maxItems ?? 1);
  protected readonly pdf = computed(() => PDF_ALLOWED.includes(this.field().key));
  protected readonly accept = computed(() => (this.pdf() ? 'image/jpeg,image/png,application/pdf' : 'image/jpeg,image/png'));
  protected readonly choices = computed<MultiSelectOption[]>(() =>
    (this.field().optionsSource === 'countries' ? COUNTRIES : this.field().options ?? []).map((o) => ({ value: o, label: o })),
  );

  protected toggle(option: string): void {
    const cur = this.list();
    this.value.set(cur.includes(option) ? cur.filter((x) => x !== option) : [...cur, option]);
  }

  protected add(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.value.set([...this.slots(), { file }]);
  }

  protected remove(index: number): void {
    const s = this.slots()[index];
    if (s?.file) this.revoke(s.file);
    this.value.set(this.slots().filter((_, i) => i !== index));
  }

  protected isPdf(s: PhotoSlot): boolean {
    return s.saved ? s.saved.isPdf : s.file?.type === 'application/pdf' || !!s.file?.name.toLowerCase().endsWith('.pdf');
  }

  /** A local address to show a chosen photo before it is saved. */
  protected preview(s: PhotoSlot): string {
    if (!s.file || typeof URL.createObjectURL !== 'function') return '';
    let url = this.previews.get(s.file);
    if (!url) {
      url = URL.createObjectURL(s.file);
      this.previews.set(s.file, url);
    }
    return url;
  }

  private revoke(file: File): void {
    const url = this.previews.get(file);
    if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
    this.previews.delete(file);
  }

  ngOnDestroy(): void {
    for (const f of [...this.previews.keys()]) this.revoke(f);
  }
}
