import { Component, computed, input, model, signal } from '@angular/core';

export interface MultiSelectOption {
  value: string;
  label: string;
}

/**
 * Multiple choice list with a filter box. Replaces the select2 multi-selects of the old pages
 * (Applicable States, NIC Sector, Area of Knowledge, Technology sectors/categories) without jQuery.
 * 2026-11-07 (design approved): the options as tiles in columns (3 for short names such as states, 2 for long ones
 * such as NIC sectors, 1 on a phone), a "n of N selected" count with Select all / Clear, the choices as removable chips,
 * and a taller list.
 */
@Component({
  selector: 'zed-multi-select',
  template: `
    <div class="zed-multi" [class.disabled]="disabled()">
      <div class="ms-head">
        <span class="ms-count" [class.has]="value().length > 0" aria-live="polite">
          {{ value().length ? value().length + ' of ' + options().length + ' selected' : 'None selected' }}
        </span>
        @if (!disabled()) {
          <span class="ms-actions">
            <button type="button" class="btn btn-sm btn-outline-secondary" (click)="selectAll()" [disabled]="allShownSelected()">Select all</button>
            <button type="button" class="btn btn-sm btn-outline-secondary" (click)="clear()" [disabled]="value().length === 0">Clear</button>
          </span>
        }
      </div>
      @if (value().length) {
        <div class="chips">
          @for (v of value(); track v) {
            <span class="chip">
              {{ labelOf(v) }}
              @if (!disabled()) {
                <button type="button" class="chip-remove" [attr.aria-label]="'Remove ' + labelOf(v)" (click)="toggle(v)">×</button>
              }
            </span>
          }
        </div>
      }
      @if (!disabled()) {
        <div class="filter-box">
          <span class="filter-icon" aria-hidden="true">&#9906;</span>
          <input type="search" class="form-control input-100 filter" [attr.id]="inputId()" [attr.aria-label]="label() + ' filter'"
                 placeholder="Type to filter…" [value]="filter()" (input)="filter.set($any($event.target).value)" />
        </div>
        <ul class="options" [class.wide]="wide()" role="group" [attr.aria-label]="label()">
          @for (o of filtered(); track o.value) {
            <li>
              <label class="option" [class.on]="value().includes(o.value)">
                <input type="checkbox" [checked]="value().includes(o.value)" (change)="toggle(o.value)" />
                <span>{{ o.label }}</span>
              </label>
            </li>
          } @empty {
            <li class="text-muted no-match">No match</li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    .zed-multi { border: 1px solid #ced4da; border-radius: 10px; padding: 10px 12px; background: #fff; }
    .zed-multi.disabled { background: #e9ecef; }
    .ms-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
    .ms-count { font-size: 13px; font-weight: 600; color: #6c757d; background: #f1f3f4; border-radius: 12px; padding: 2px 10px; }
    .ms-count.has { color: #1f5c61; background: #e4f3f4; }
    .ms-actions { margin-left: auto; display: flex; gap: 6px; }
    .ms-actions .btn { font-size: 12px; padding: 2px 10px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .chip { display: inline-flex; align-items: center; background: #e4f3f4; border: 1px solid #b9dfe2; border-radius: 14px; padding: 1px 6px 1px 10px; font-size: 12px; color: #1f5c61; }
    .chip-remove { border: 0; background: none; padding: 0 0 0 6px; line-height: 1; color: #1f5c61; font-size: 15px; }
    .filter-box { position: relative; margin-bottom: 8px; }
    .filter-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%) rotate(-45deg); color: #9aa5a6; font-size: 15px; pointer-events: none; }
    .filter { height: 34px; padding-left: 30px; }
    .options {
      list-style: none; margin: 0; padding: 2px; max-height: 300px; overflow-y: auto;
      display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 6px;
    }
    .options.wide { grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
    .option {
      display: flex; gap: 8px; align-items: center; width: 100%; height: 100%; box-sizing: border-box; font-size: 13px; cursor: pointer; margin: 0;
      padding: 6px 10px; border: 1px solid #e3e8e9; border-radius: 8px; color: #343a40; transition: background-color .12s, border-color .12s;
    }
    .option:hover { background: #f5fafa; border-color: #b9dfe2; }
    .option.on { background: #e4f3f4; border-color: #45a5ad; color: #1f5c61; font-weight: 600; }
    .option input { accent-color: #45a5ad; flex: none; margin: 0; }
    /* Not .small: the old site styles paint .small yellow (the Small enterprise badge). */
    .no-match { font-size: .875em; padding: 4px 2px; grid-column: 1 / -1; }
    @media (max-width: 575.98px) { .options, .options.wide { grid-template-columns: 1fr; } }
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
  /** Long names (NIC sectors) get wider columns: 2 instead of 3. */
  protected readonly wide = computed(() => this.options().some((o) => o.label.length > 32));
  protected readonly allShownSelected = computed(() => {
    const v = this.value();
    return this.filtered().every((o) => v.includes(o.value));
  });

  protected labelOf(v: string): string {
    return this.options().find((o) => o.value === v)?.label ?? v;
  }

  protected toggle(v: string): void {
    const current = this.value();
    this.value.set(current.includes(v) ? current.filter((x) => x !== v) : [...current, v]);
  }

  /** Every option shown (the filter's matches) is added to the choices. */
  protected selectAll(): void {
    const current = this.value();
    this.value.set([...current, ...this.filtered().map((o) => o.value).filter((v) => !current.includes(v))]);
  }

  protected clear(): void {
    this.value.set([]);
  }
}
