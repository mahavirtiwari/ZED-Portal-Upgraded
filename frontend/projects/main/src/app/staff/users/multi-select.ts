import { Component, computed, input, model, signal } from '@angular/core';

export interface MultiSelectOption {
  value: string;
  label: string;
}

/**
 * Multiple choice list with a filter box. Replaces the select2 multi-selects of the old pages
 * (Applicable States, NIC Sector, Area of Knowledge, Technology sectors/categories) without jQuery.
 */
@Component({
  selector: 'zed-multi-select',
  template: `
    <div class="zed-multi" [class.disabled]="disabled()">
      <div class="chips" aria-live="polite">
        @for (v of value(); track v) {
          <span class="chip">
            {{ labelOf(v) }}
            @if (!disabled()) {
              <button type="button" class="chip-remove" [attr.aria-label]="'Remove ' + labelOf(v)" (click)="toggle(v)">×</button>
            }
          </span>
        } @empty {
          <span class="text-muted small">None selected</span>
        }
      </div>
      @if (!disabled()) {
        <input type="search" class="form-control input-100 filter" [attr.id]="inputId()" [attr.aria-label]="label() + ' filter'"
               placeholder="Type to filter…" [value]="filter()" (input)="filter.set($any($event.target).value)" />
        <ul class="options" role="group" [attr.aria-label]="label()">
          @for (o of filtered(); track o.value) {
            <li>
              <label>
                <input type="checkbox" [checked]="value().includes(o.value)" (change)="toggle(o.value)" />
                {{ o.label }}
              </label>
            </li>
          } @empty {
            <li class="text-muted small">No match</li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    .zed-multi { border: 1px solid #ced4da; border-radius: 4px; padding: 6px; background: #fff; }
    .zed-multi.disabled { background: #e9ecef; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
    .chip { background: #e4f3f4; border: 1px solid #45a5ad; border-radius: 3px; padding: 0 6px; font-size: 13px; }
    .chip-remove { border: 0; background: none; padding: 0 0 0 4px; line-height: 1; }
    .filter { margin-bottom: 4px; height: 32px; }
    .options { list-style: none; margin: 0; padding: 0; max-height: 170px; overflow-y: auto; }
    .options label { display: flex; gap: 6px; align-items: baseline; font-size: 14px; cursor: pointer; margin: 0; padding: 1px 2px; }
  `,
})
export class MultiSelect {
  readonly options = input.required<MultiSelectOption[]>();
  readonly value = model<string[]>([]);
  readonly disabled = input(false);
  readonly label = input('Options');
  readonly inputId = input<string | null>(null);

  protected readonly filter = signal('');
  protected readonly filtered = computed(() => {
    const f = this.filter().trim().toLowerCase();
    return f ? this.options().filter((o) => o.label.toLowerCase().includes(f)) : this.options();
  });

  protected labelOf(v: string): string {
    return this.options().find((o) => o.value === v)?.label ?? v;
  }

  protected toggle(v: string): void {
    const current = this.value();
    this.value.set(current.includes(v) ? current.filter((x) => x !== v) : [...current, v]);
  }
}
