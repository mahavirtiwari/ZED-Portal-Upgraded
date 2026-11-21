import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';

/** One count of the strip: a number and what it counts. */
export interface ListCount {
  label: string;
  /** A count, or a formatted figure (2026-11-18: the Expenditure tab's "₹ 41.6 L"). */
  value: number | string;
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
    <div class="lc" [class.lc-sub-rows]="subRows()" [attr.role]="buttons() ? 'group' : 'list'" [attr.aria-label]="label()">
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
      <span class="lc-label">{{ c.label }}@if (c.sub) {&ngsp;<small class="lc-sub">@for (p of parts(c.sub); track $index) {<span class="lc-part">{{ p }}</span>&ngsp;}</small> }</span>
      @if (c.delta !== null && c.delta !== undefined && c.delta !== '') {
        <span class="lc-delta" [class.down]="('' + c.delta).startsWith('-')">{{ c.delta }}</span>
      }
    </ng-template>
  `,
  styles: `
    /* 2026-11-18 (the user: staff pages 'not aligned with SVG files'): the designs' tiles: 80px, 14px corners, a soft shadow, the
       number 24px in its tone (teal, green, amber, red), the label 12.5px; the chosen tile outlined 2px in teal on a pale fill. */
    .lc { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin-bottom: 16px; }
    .lc-item { position: relative; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 3px; min-width: 0;
      min-height: 80px; text-align: left; background: #fff; border: 1px solid #dde7e8; border-radius: 14px; padding: 14px 18px;
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.09); color: inherit; }
    .lc-btn { font: inherit; cursor: pointer; }
    .lc-btn:hover { border-color: var(--zt-soft, #c5dfe0); background: #fbfdfd; }
    .lc-btn:focus-visible { outline: 2px solid var(--zt-mid2, #2a8a8c); outline-offset: 2px; }
    .lc-btn.on { border: 2px solid var(--zt-dark, #24666b); padding: 13px 17px; background: #f1f9f9; }
    .lc-item b { display: block; font-size: 24px; font-weight: 800; color: var(--zt-dark, #24666b); line-height: 1.15; }
    .lc-item b.is-warn { color: #9a5f06; }
    .lc-item b.is-bad { color: #c8473c; }
    .lc-item b.is-good { color: #2f9e58; }
    .lc-item b.is-info { color: var(--zt-dark, #24666b); }
    .lc-label { font-size: 12.5px; color: #3d5559; font-weight: 500; line-height: 1.4; overflow-wrap: break-word; }
    .lc-sub { margin-left: 4px; font-size: 11.5px; font-weight: 600; color: var(--zt-mid2, #2a8a8c); }
    /* 2026-11-21 (UI audit L2): "Desktop 1 · Site 0" breaks only between its parts, never inside "Desktop 1". */
    .lc-part { white-space: nowrap; }
    /* 2026-11-21 (Assessment Agency UI audit, item 7): with subRows each part of the line on its own row, at every width. */
    .lc-sub-rows .lc-sub { display: block; margin: 2px 0 0; }
    .lc-sub-rows .lc-part { display: block; }
    .lc-delta { position: absolute; right: 16px; bottom: 14px; font-size: 12px; font-weight: 700; color: #2f9e58; }
    .lc-delta.down { color: #c8473c; }
    @media (max-width: 575.98px) {
      .lc { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .lc-item { min-height: 68px; }
      .lc-item b { font-size: 20px; }
    }
  `,
})
export class ListCounts {
  /** A line's parts ("Desktop 1 · Site 0" → "Desktop 1", "· Site 0"), each kept on one line. */
  protected parts(sub: string): string[] {
    return sub.split(' · ').map((p, i) => (i && !this.subRows() ? '· ' + p : p));
  }

  /** Each part of a tile's line on its own row ("Desktop 1" / "Site 0"), without the dots between them. */
  readonly subRows = input(false);

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
