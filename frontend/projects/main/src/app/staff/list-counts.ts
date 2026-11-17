import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';

/** One count of the strip: a number and what it counts. */
export interface ListCount {
  label: string;
  value: number;
  /** Colours the number: 'warn' (waiting on you), 'bad' (NC, rejected), 'good' (done), 'info'. */
  tone?: 'warn' | 'bad' | 'good' | 'info';
  /** A short line beside the label (e.g. "312 this month"). */
  sub?: string | null;
  /** A change shown on the right ("+1,042"): green when it starts with "+", red with "-". */
  delta?: string | number | null;
  /** Names the tile for `selected` and `pick` (default: its label). */
  key?: string;
}

/**
 * 2026-11-14 (approved frame A): the counts above a staff list (allotted, to accept, NC raised, ...).
 * 2026-11-17 (approved staff redesign): white tiles with the number coloured by its tone, an optional line and change; with
 * <code>clickable</code> (or a <code>selected</code> key) each tile is a button that filters the list: the chosen one is
 * outlined (<code>aria-pressed</code>) and <code>pick</code> gives the tile. Without them the tiles only show the counts.
 */
@Component({
  selector: 'zed-list-counts',
  imports: [NgTemplateOutlet],
  host: { class: 'd-block' },
  template: `
    <div class="lc" [attr.role]="buttons() ? 'group' : 'list'" [attr.aria-label]="label()">
      @for (c of counts(); track c.key ?? c.label) {
        @if (buttons()) {
          <button type="button" class="lc-item lc-btn" [class.on]="isOn(c)" [attr.aria-pressed]="isOn(c)" (click)="pick.emit(c)">
            <ng-container *ngTemplateOutlet="body; context: { $implicit: c }" />
          </button>
        } @else {
          <div class="lc-item" role="listitem"><ng-container *ngTemplateOutlet="body; context: { $implicit: c }" /></div>
        }
      }
    </div>
    <ng-template #body let-c>
      <b [class]="c.tone ? 'is-' + c.tone : ''">{{ c.value }}</b>&ngsp;
      <span class="lc-label">{{ c.label }}@if (c.sub) {&ngsp;<small class="lc-sub">{{ c.sub }}</small> }</span>
      @if (c.delta !== null && c.delta !== undefined && c.delta !== '') {
        <span class="lc-delta" [class.down]="('' + c.delta).startsWith('-')">{{ c.delta }}</span>
      }
    </ng-template>
  `,
  styles: `
    .lc { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; margin-bottom: 16px; }
    .lc-item { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; text-align: left;
      background: #fff; border: 1px solid #e1eaea; border-radius: 12px; padding: 14px 16px; box-shadow: 0 2px 8px rgba(16, 61, 64, 0.05); color: inherit; }
    .lc-btn { font: inherit; cursor: pointer; }
    .lc-btn:hover { border-color: var(--zt-soft, #d4ebe6); background: #fbfdfd; }
    .lc-btn:focus-visible { outline: 2px solid var(--zt-mid2, #2a8a8c); outline-offset: 2px; }
    .lc-btn.on { border: 2px solid var(--zt-dark, #1f5c61); padding: 13px 15px; background: #f4faf9; }
    .lc-item b { display: block; font-size: 24px; font-weight: 800; color: var(--zt-ink, #173f44); line-height: 1.15; }
    .lc-item b.is-warn { color: #b26a00; }
    .lc-item b.is-bad { color: #c0392b; }
    .lc-item b.is-good { color: #1e8a4c; }
    .lc-item b.is-info { color: var(--zt-mid2, #2a8a8c); }
    .lc-label { font-size: 13px; color: #5f6f70; font-weight: 600; overflow-wrap: anywhere; }
    .lc-sub { margin-left: 4px; font-size: 11.5px; font-weight: 600; color: var(--zt-mid2, #2a8a8c); }
    .lc-delta { position: absolute; right: 14px; bottom: 14px; font-size: 12px; font-weight: 700; color: #1e8a4c; }
    .lc-delta.down { color: #c0392b; }
    @media (max-width: 575.98px) {
      .lc { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .lc-item b { font-size: 20px; }
    }
  `,
})
export class ListCounts {
  readonly counts = input.required<ListCount[]>();
  /** The tiles are buttons that filter the list (also when `selected` is given). */
  readonly clickable = input(false);
  /** The key (or label) of the chosen tile; undefined: none chosen and, unless `clickable`, plain tiles. */
  readonly selected = input<string | null | undefined>(undefined);
  /** A name for the strip (screen readers), e.g. "Agencies by status". */
  readonly label = input<string | null>(null);
  /** The tile clicked (clickable tiles only). */
  readonly pick = output<ListCount>();

  protected readonly buttons = computed(() => this.clickable() || this.selected() !== undefined);

  protected isOn(c: ListCount): boolean {
    const s = this.selected();
    return s !== undefined && s !== null && s === (c.key ?? c.label);
  }
}
