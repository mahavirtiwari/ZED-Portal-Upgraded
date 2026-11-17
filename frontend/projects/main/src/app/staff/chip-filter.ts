import { Component, input, model } from '@angular/core';

/** One choice of a chip filter: its key (the value), its text and, optionally, how many rows it has. */
export interface FilterChip {
  key: string;
  label: string;
  count?: number | null;
}

/**
 * 2026-11-17 (approved staff redesign, e.g. Assessment Agencies' "Status" and "Sector type"): a label and a row of chips,
 * one chosen at a time (<code>aria-pressed</code>), each with its count. Bind the chosen key with <code>[(value)]</code>.
 */
@Component({
  selector: 'zed-chip-filter',
  host: { class: 'zed-chip-filter' },
  template: `
    <div class="cf" role="group" [attr.aria-label]="label()">
      <span class="cf-label" aria-hidden="true">{{ label() }}</span>
      @for (c of chips(); track c.key) {
        <button type="button" class="cf-chip" [class.on]="c.key === value()" [attr.aria-pressed]="c.key === value()" (click)="value.set(c.key)">
          {{ c.label }}@if (c.count !== null && c.count !== undefined) {&ngsp;<span class="cf-n">{{ c.count }}</span> }
        </button>
      }
    </div>
  `,
  styles: `
    :host { display: inline-block; max-width: 100%; }
    .cf { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .cf-label { margin-right: 4px; font-size: 13.5px; color: #5f6f70; }
    .cf-chip { display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 14px; border: 1px solid #d5e1e2; border-radius: 17px;
      background: #fff; color: var(--zt-ink, #173f44); font-size: 13.5px; font-weight: 600; line-height: 1; white-space: nowrap; }
    .cf-chip:hover:not(.on) { background: #f2f8f7; border-color: var(--zt-soft, #d4ebe6); }
    .cf-chip:focus-visible { outline: 2px solid var(--zt-mid2, #2a8a8c); outline-offset: 2px; }
    .cf-chip.on { background: var(--zt-dark, #1f5c61); border-color: var(--zt-dark, #1f5c61); color: #fff; }
    .cf-n { min-width: 22px; padding: 2px 7px; border-radius: 10px; background: #eef2f2; color: #5f6f70; font-size: 11.5px; font-weight: 700; text-align: center; }
    .cf-chip.on .cf-n { background: rgba(255, 255, 255, 0.22); color: #fff; }
  `,
})
export class ChipFilter {
  /** What is filtered ("Status"); also the group's accessible name. */
  readonly label = input.required<string>();
  readonly chips = input.required<FilterChip[]>();
  /** The chosen chip's key. */
  readonly value = model<string>('');
}
