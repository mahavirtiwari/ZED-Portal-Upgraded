import { Component, ElementRef, HostListener, computed, inject, input, model, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TextPipe, t } from '../../content/page-text';

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
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): two compact variants for the staff designs; the default
 * ('list') is unchanged for the other pages.
 * - 'chips' (staff-02, Add agency): the label with "3 of 36 selected · Select all · Clear" on one line, then a chip field
 *   ("Maharashtra × Goa × … Type to add a state") whose matches drop down while it has the focus.
 * - 'dropdown' (popup-02, Add operation admin): a select-like button ("36 of 36 selected (every state)") that opens the
 *   filter, Select all / Clear and the ticks in a panel, so a pop-up fits on a laptop screen without scrolling.
 */
@Component({
  selector: 'zed-multi-select',
  template: `
    @switch (variant()) {
      @case ('chips') {
        <div class="msc" [class.open]="open()" [class.disabled]="disabled()" (focusout)="left($event)">
          <div class="msc-top">
            @if (heading()) { <label class="msc-label" [attr.for]="inputId()">{{ heading() }}@if (required()) {<span class="req">*</span>}</label> }
            <span class="msc-meta" aria-live="polite">{{ countText() }}
              @if (!disabled()) {
                · <button type="button" class="msc-link" (click)="selectAll()" [disabled]="allShownSelected()">{{ 'Select all' | t: 'common.multiSelect.selectAllButton' }}</button>
                · <button type="button" class="msc-link" (click)="clear()" [disabled]="value().length === 0">{{ 'Clear' | t: 'common.multiSelect.clearButton' }}</button>
              }
            </span>
          </div>
          <div class="msc-box" (click)="focusInput()">
            @for (v of value(); track v) {
              <span class="chip">{{ labelOf(v) }}
                @if (!disabled()) { <button type="button" class="chip-remove" [attr.aria-label]="'Remove {option}' | t: 'common.multiSelect.removeAria' : { option: labelOf(v) }" (click)="toggle(v); $event.stopPropagation()">×</button> }
              </span>
            }
            @if (!disabled()) {
              <input type="text" class="msc-input" autocomplete="off" role="combobox" [attr.aria-expanded]="open()" [attr.id]="inputId()"
                     [attr.aria-label]="'{field}: type to add' | t: 'common.multiSelect.addAria' : { field: heading() || shownLabel() }" [placeholder]="placeholder() || ('Type to add' | t: 'common.multiSelect.addPlaceholder')" [value]="filter()"
                     (input)="filter.set($any($event.target).value); open.set(true)" (focus)="open.set(true)" (keydown.escape)="open.set(false)" />
            }
          </div>
          @if (!disabled()) {
            <ul class="options msc-list" [class.wide]="wide()" role="group" [attr.aria-label]="shownLabel()">
              <ng-container *ngTemplateOutlet="ticks" />
            </ul>
          }
        </div>
      }
      @case ('dropdown') {
        <div class="msd" [class.open]="open()" [class.disabled]="disabled()" (focusout)="left($event)">
          <button type="button" class="form-select msd-btn" [attr.id]="inputId()" [disabled]="disabled()" [attr.aria-expanded]="open()"
                  [attr.aria-label]="'{field}: {summary}' | t: 'common.multiSelect.buttonAria' : { field: shownLabel(), summary: summary() }" (click)="open.set(!open())" (keydown.escape)="open.set(false)">{{ summary() }}</button>
          <div class="msd-panel">
            <div class="ms-head">
              <span class="ms-count" [class.has]="value().length > 0">{{ countText() }}</span>
              <span class="ms-actions">
                <button type="button" class="msc-link" (click)="selectAll()" [disabled]="allShownSelected()">{{ 'Select all' | t: 'common.multiSelect.selectAllButton' }}</button>
                <button type="button" class="msc-link" (click)="clear()" [disabled]="value().length === 0">{{ 'Clear' | t: 'common.multiSelect.clearButton' }}</button>
              </span>
            </div>
            <input type="search" class="form-control filter" [attr.aria-label]="'{field} filter' | t: 'common.multiSelect.filterAria' : { field: shownLabel() }" [placeholder]="'Type to filter…' | t: 'common.multiSelect.filterPlaceholder'" [value]="filter()"
                   (input)="filter.set($any($event.target).value)" />
            <ul class="options msd-list" role="group" [attr.aria-label]="shownLabel()">
              <ng-container *ngTemplateOutlet="ticks" />
            </ul>
          </div>
        </div>
      }
      @default {
        <div class="zed-multi" [class.disabled]="disabled()">
          <div class="ms-head">
            <span class="ms-count" [class.has]="value().length > 0" aria-live="polite">{{ countText() }}</span>
            @if (!disabled()) {
              <span class="ms-actions">
                <button type="button" class="btn btn-sm btn-outline-secondary" (click)="selectAll()" [disabled]="allShownSelected()">{{ 'Select all' | t: 'common.multiSelect.selectAllButton' }}</button>
                <button type="button" class="btn btn-sm btn-outline-secondary" (click)="clear()" [disabled]="value().length === 0">{{ 'Clear' | t: 'common.multiSelect.clearButton' }}</button>
              </span>
            }
          </div>
          @if (value().length) {
            <div class="chips">
              @for (v of value(); track v) {
                <span class="chip">
                  {{ labelOf(v) }}
                  @if (!disabled()) {
                    <button type="button" class="chip-remove" [attr.aria-label]="'Remove {option}' | t: 'common.multiSelect.removeAria' : { option: labelOf(v) }" (click)="toggle(v)">×</button>
                  }
                </span>
              }
            </div>
          }
          @if (!disabled()) {
            <div class="filter-box">
              <span class="filter-icon" aria-hidden="true">&#9906;</span>
              <input type="search" class="form-control input-100 filter" [attr.id]="inputId()" [attr.aria-label]="'{field} filter' | t: 'common.multiSelect.filterAria' : { field: shownLabel() }"
                     [placeholder]="'Type to filter…' | t: 'common.multiSelect.filterPlaceholder'" [value]="filter()" (input)="filter.set($any($event.target).value)" />
            </div>
            <ul class="options" [class.wide]="wide()" role="group" [attr.aria-label]="shownLabel()">
              <ng-container *ngTemplateOutlet="ticks" />
            </ul>
          }
        </div>
      }
    }
    <ng-template #ticks>
      @for (o of filtered(); track o.value) {
        <li>
          <label class="option" [class.on]="value().includes(o.value)">
            <input type="checkbox" [checked]="value().includes(o.value)" (change)="toggle(o.value)" />
            <span>{{ o.label }}</span>
          </label>
        </li>
      } @empty {
        <li class="text-muted no-match">{{ 'No match' | t: 'common.multiSelect.noMatch' }}</li>
      }
    </ng-template>
  `,
  imports: [NgTemplateOutlet, TextPipe],
  styles: `
    :host { display: block; min-width: 0; max-width: 100%; }
    .zed-multi { border: 1px solid #ced4da; border-radius: 10px; padding: 10px 12px; background: #fff; }
    .zed-multi.disabled { background: #e9ecef; }
    .ms-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
    .ms-count { font-size: 13px; font-weight: 600; color: #6c757d; background: #f1f3f4; border-radius: 12px; padding: 2px 10px; }
    .ms-count.has { color: #1f5c61; background: #e4f3f4; }
    .ms-actions { margin-left: auto; display: flex; gap: 6px; }
    .ms-actions .btn { font-size: 12px; padding: 2px 10px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; min-width: 0; }
    /* 2026-11-21 (Assessment Agency UI audit, item 2): a long option (an NIC code's description) wraps inside its chip instead
       of widening the page on a phone or tablet (the old site styles give chips white-space: nowrap). */
    .chip { display: inline-flex; align-items: center; background: #e4f3f4; border: 1px solid #b9dfe2; border-radius: 14px; padding: 1px 6px 1px 10px; font-size: 12px; color: #1f5c61;
      white-space: normal; max-width: 100%; min-width: 0; overflow-wrap: anywhere; text-align: left; }
    .chip-remove { flex: none; border: 0; background: none; padding: 0 0 0 6px; line-height: 1; color: #1f5c61; font-size: 15px; }
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
      min-width: 0; overflow-wrap: anywhere;
      padding: 6px 10px; border: 1px solid #e3e8e9; border-radius: 8px; color: #343a40; transition: background-color .12s, border-color .12s;
    }
    .option:hover { background: #f5fafa; border-color: #b9dfe2; }
    .option.on { background: #e4f3f4; border-color: #45a5ad; color: #1f5c61; font-weight: 600; }
    .option input { accent-color: #45a5ad; flex: none; margin: 0; }
    /* Not .small: the old site styles paint .small yellow (the Small enterprise badge). */
    .no-match { font-size: .875em; padding: 4px 2px; grid-column: 1 / -1; }
    @media (max-width: 575.98px) { .options, .options.wide { grid-template-columns: minmax(0, 1fr); } }

    /* 'chips' and 'dropdown' (2026-11-18): the designs' 9px fields with a #b9cdcf line, teal text links, a floating list. */
    .msc, .msd { position: relative; }
    .msc-top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin-bottom: 6px; }
    .msc-label { margin: 0; font-size: 12.5px; font-weight: 600; color: #17373b; }
    .msc-label .req { color: #c8473c; margin-left: 2px; }
    .msc-meta { margin-left: auto; font-size: 12px; font-weight: 600; color: #24666b; white-space: nowrap; max-width: 100%; }
    /* On a phone the count and Select all / Clear take their own line rather than pushing the field wider. */
    @media (max-width: 575.98px) { .msc-meta { white-space: normal; margin-left: 0; } }
    .msc-link { border: 0; background: none; padding: 0 2px; font: inherit; color: #24666b; }
    .msc-link:hover:not(:disabled) { text-decoration: underline; }
    .msc-link:disabled { color: #9aadaf; }
    .msc-box { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; min-height: 44px; padding: 8px; border: 1.2px solid #b9cdcf; border-radius: 9px; background: #fff; cursor: text; }
    .msc.open .msc-box { border-color: #24666b; box-shadow: 0 0 0 3px rgba(69, 165, 173, .18); }
    .msc.disabled .msc-box { background: #eef3f3; cursor: default; }
    .msc-box .chip { min-height: 26px; padding: 2px 8px 2px 12px; border: 0; border-radius: 13px; background: #e6f2f3; color: #24666b; font-size: 12px; font-weight: 600; }
    .msc-box .chip-remove { color: #24666b; font-weight: 700; padding-left: 8px; }
    .msc-input { flex: 1 1 140px; min-width: 0; border: 0; outline: 0; padding: 2px 4px; font-size: 12.5px; background: transparent; }
    .msc-list, .msd-panel { display: none; position: absolute; left: 0; right: 0; z-index: 30; margin-top: 4px; padding: 8px; max-height: 240px; background: #fff;
      border: 1px solid #dde7e8; border-radius: 12px; box-shadow: 0 10px 28px rgba(16, 61, 64, .18); }
    .msc.open .msc-list { display: grid; }
    .msd-btn { width: 100%; height: 40px; text-align: left; font-size: 13px; font-weight: 500; color: #17373b; border: 1.2px solid #b9cdcf; border-radius: 9px; background-color: #fff; }
    .msd.open .msd-panel { display: block; max-height: none; }
    .msd-panel .ms-actions { gap: 10px; font-size: 12px; font-weight: 600; }
    .msd-panel .filter { height: 34px; padding-left: 10px; margin-bottom: 8px; background-image: none; }
    .msd-list { max-height: 170px; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 4px; }
    .msd-list .option, .msc-list .option { padding: 5px 8px; font-size: 12.5px; }
  `,
})
export class MultiSelect {
  readonly options = input.required<MultiSelectOption[]>();
  readonly value = model<string[]>([]);
  readonly disabled = input(false);
  /** The list's name for screen readers; empty: the standard "Options" (Admin → Texts → Page wording). */
  readonly label = input('');
  readonly inputId = input<string | null>(null);
  /** 'list' (default, the tiles in columns), 'chips' (a chip field) or 'dropdown' (a select-like button). */
  readonly variant = input<'list' | 'chips' | 'dropdown'>('list');
  /** 'chips': the field's own label on the count line (the page then leaves out its label). */
  readonly heading = input<string | null>(null);
  readonly required = input(false);
  /** 'chips': the input's placeholder ("Type to add a state"). */
  readonly placeholder = input('');
  /** 'dropdown': the button's text when every option is chosen ("(every state)"). */
  readonly allText = input('');

  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly open = signal(false);
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
  protected readonly shownLabel = computed(() => this.label() || t('common.multiSelect.label', 'Options'));
  protected readonly countText = computed(() => (this.value().length
    ? t('common.multiSelect.count', '{count} of {total} selected', { count: this.value().length, total: this.options().length })
    : t('common.multiSelect.none', 'None selected')));
  /** 'dropdown': "36 of 36 selected (every state)", "1 selected: Mahavir Agency". */
  protected readonly summary = computed(() => {
    const v = this.value();
    const n = this.options().length;
    if (!v.length) return t('common.multiSelect.none', 'None selected');
    if (n && v.length === n)
      return t('common.multiSelect.countAll', '{count} of {total} selected ({all})', { count: v.length, total: n, all: this.allText() || t('common.multiSelect.allText', 'every option') });
    return v.length <= 2 ? t('common.multiSelect.countNamed', '{count} selected: {names}', { count: v.length, names: v.map((x) => this.labelOf(x)).join(', ') })
      : t('common.multiSelect.count', '{count} of {total} selected', { count: v.length, total: n });
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

  protected focusInput(): void {
    (this.host.nativeElement as HTMLElement).querySelector<HTMLInputElement>('.msc-input')?.focus();
  }

  /** The focus left the field and its list: the list closes. */
  protected left(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (!next || !(this.host.nativeElement as HTMLElement).contains(next)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  protected escape(): void {
    this.open.set(false);
  }
}
