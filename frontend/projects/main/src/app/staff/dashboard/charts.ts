import { Component, computed, input, signal } from '@angular/core';

/** One mark: a label, its value and, for categorical charts, its colour (slot of CHART_COLORS or a level colour). */
export interface ChartItem {
  label: string;
  value: number;
  color?: string;
}

/**
 * Categorical colours of the dashboard charts, in fixed order (never cycled): teal, orange, violet, amber. Validated
 * with the dataviz palette checks (CVD and normal-vision separation pass); amber is below 3:1 on white, so every chart
 * shows its values as text (legend / labels).
 */
export const CHART_COLORS = ['#00909a', '#eb6834', '#6250d6', '#eda100'];

/** Bronze, Silver and Gold keep their own colours (identity of the level), always with their name beside them. */
export const LEVEL_COLORS: Record<string, string> = { Bronze: '#b0683a', Silver: '#8a979c', Gold: '#c99a1e' };

export const formatCount = (n: number) => n.toLocaleString('en-IN');

const percent = (value: number, total: number) => (total ? `${((value / total) * 100).toFixed(1)}%` : '0%');

/**
 * Columns with their value above them, a baseline and a hover tooltip (label, value, share). One series: one colour
 * unless an item brings its own (the certification levels).
 */
@Component({
  selector: 'zed-column-chart',
  template: `
    <div class="cc" role="img" [attr.aria-label]="ariaLabel()">
      <div class="cc-plot" [style.--cols]="items().length || 1">
        @for (it of items(); track it.label; let i = $index) {
          <div class="cc-col" (mouseenter)="hover.set(i)" (mouseleave)="hover.set(-1)" (focus)="hover.set(i)" (blur)="hover.set(-1)" tabindex="0"
               [attr.aria-label]="it.label + ': ' + format(it.value)">
            <span class="cc-value">{{ compact() ? short(it.value) : format(it.value) }}</span>
            <span class="cc-bar" [style.height.%]="height(it.value)" [style.background]="it.color || color()" [class.is-dim]="hover() >= 0 && hover() !== i"></span>
            @if (hover() === i) {
              <span class="cc-tip" role="tooltip"><strong>{{ it.label }}</strong>{{ format(it.value) }} · {{ share(it.value) }}</span>
            }
          </div>
        }
      </div>
      <div class="cc-axis" [style.--cols]="items().length || 1">
        @for (it of items(); track it.label) { <span class="cc-label" [title]="it.label">{{ it.label }}</span> }
      </div>
    </div>
  `,
  styles: `
    .cc { position: relative; }
    .cc-plot { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 6px; align-items: end; height: var(--h, 220px);
      border-bottom: 1px solid #cbd9da; padding-top: 22px; }
    .cc-col { position: relative; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; outline: none; cursor: default; }
    .cc-col:focus-visible .cc-bar { outline: 2px solid #23474a; outline-offset: 2px; }
    .cc-value { font-size: 12px; font-weight: 600; color: #23474a; margin-bottom: 4px; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .cc-bar { width: min(100%, 56px); min-height: 2px; border-radius: 4px 4px 0 0; transition: opacity .15s; }
    .cc-bar.is-dim { opacity: .45; }
    .cc-axis { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 6px; margin-top: 6px; }
    .cc-label { font-size: 12px; color: #5f6f70; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cc-tip { position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); z-index: 3; white-space: nowrap;
      background: #23474a; color: #fff; font-size: 12px; padding: 6px 10px; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,.18); pointer-events: none; }
    .cc-tip strong { display: block; font-weight: 700; }`,
})
export class ColumnChart {
  readonly items = input.required<ChartItem[]>();
  readonly color = input('#00909a');
  /** Values as 1.2L / 5.3K above the columns (the tooltip keeps the full number). */
  readonly compact = input(false);
  readonly ariaLabel = input('');
  protected readonly hover = signal(-1);
  private readonly max = computed(() => Math.max(1, ...this.items().map((i) => i.value)));
  private readonly sum = computed(() => this.items().reduce((a, i) => a + i.value, 0));

  protected height(v: number): number {
    return (v / this.max()) * 100;
  }
  protected format(v: number): string {
    return formatCount(v);
  }
  protected share(v: number): string {
    return percent(v, this.sum());
  }
  protected short(v: number): string {
    if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
    if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return String(v);
  }
}

/** A donut of a few categories with a legend that names each one with its value and share (identity never by colour alone). */
@Component({
  selector: 'zed-donut-chart',
  template: `
    <div class="dn">
      <svg viewBox="0 0 120 120" class="dn-svg" role="img" [attr.aria-label]="ariaLabel()">
        <circle cx="60" cy="60" r="44" fill="none" stroke="#eef3f3" stroke-width="18" />
        @for (s of segments(); track s.label; let i = $index) {
          <circle cx="60" cy="60" r="44" fill="none" [attr.stroke]="s.color" stroke-width="18" [attr.stroke-dasharray]="s.dash" [attr.stroke-dashoffset]="s.offset"
                  transform="rotate(-90 60 60)" [class.is-dim]="hover() >= 0 && hover() !== i" (mouseenter)="hover.set(i)" (mouseleave)="hover.set(-1)" />
        }
        <text x="60" y="57" text-anchor="middle" class="dn-total">{{ centre() }}</text>
        <text x="60" y="72" text-anchor="middle" class="dn-caption">{{ hover() >= 0 ? items()[hover()].label : 'Total' }}</text>
      </svg>
      <ul class="dn-legend">
        @for (it of items(); track it.label; let i = $index) {
          <li (mouseenter)="hover.set(i)" (mouseleave)="hover.set(-1)" [class.is-on]="hover() === i">
            <span class="dn-swatch" [style.background]="it.color"></span>
            <span class="dn-label">{{ it.label }}</span>
            <span class="dn-value">{{ format(it.value) }}</span>
            <span class="dn-share">{{ share(it.value) }}</span>
          </li>
        }
      </ul>
    </div>
  `,
  styles: `
    .dn { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .dn-svg { flex: 0 0 150px; width: 150px; height: 150px; }
    .dn-svg circle { transition: opacity .15s; cursor: default; }
    .dn-svg circle.is-dim { opacity: .35; }
    .dn-total { font-size: 15px; font-weight: 700; fill: #23474a; }
    .dn-caption { font-size: 9px; fill: #6b7f80; }
    .dn-legend { flex: 1 1 160px; list-style: none; margin: 0; padding: 0; }
    .dn-legend li { display: grid; grid-template-columns: 12px 1fr auto 48px; align-items: center; gap: 8px; padding: 5px 6px; border-radius: 6px; font-size: 13px; }
    .dn-legend li.is-on { background: #eef6f6; }
    .dn-swatch { width: 12px; height: 12px; border-radius: 3px; }
    .dn-label { color: #232527; }
    .dn-value { font-weight: 700; color: #23474a; font-variant-numeric: tabular-nums; }
    .dn-share { color: #6b7f80; text-align: right; font-variant-numeric: tabular-nums; }`,
})
export class DonutChart {
  readonly items = input.required<ChartItem[]>();
  readonly ariaLabel = input('');
  protected readonly hover = signal(-1);
  private readonly sum = computed(() => this.items().reduce((a, i) => a + i.value, 0));
  /** Arcs on a circle of radius 44, a 2px gap between neighbours (only when there are several). */
  protected readonly segments = computed(() => {
    const c = 2 * Math.PI * 44;
    const total = this.sum() || 1;
    const gap = this.items().filter((i) => i.value > 0).length > 1 ? 2 : 0;
    let start = 0;
    return this.items().map((it) => {
      const len = (it.value / total) * c;
      const seg = { label: it.label, color: it.color ?? CHART_COLORS[0], dash: `${Math.max(0, len - gap)} ${c}`, offset: -start };
      start += len;
      return seg;
    });
  });
  protected centre(): string {
    const h = this.hover();
    const v = h >= 0 ? this.items()[h].value : this.sum();
    return h >= 0 ? percent(v, this.sum()) : formatCount(v);
  }
  protected format(v: number): string {
    return formatCount(v);
  }
  protected share(v: number): string {
    return percent(v, this.sum());
  }
}

/** A ranked list: rank, name, a bar in proportion to the first one, the number. Scrolls when long. */
@Component({
  selector: 'zed-rank-list',
  template: `
    <div class="rk">
      <div class="rk-head"><span>{{ heading() }}</span><span>{{ valueHeading() }}</span></div>
      <ol class="rk-list">
        @for (it of items(); track it.label; let i = $index) {
          <li [title]="it.label + ': ' + format(it.value)">
            <span class="rk-rank">{{ i + 1 }}</span>
            <span class="rk-body">
              <span class="rk-label">{{ it.label }}</span>
              <span class="rk-track"><span class="rk-bar" [style.width.%]="width(it.value)"></span></span>
            </span>
            <span class="rk-value">{{ format(it.value) }}</span>
          </li>
        } @empty {
          <li class="rk-empty">No data</li>
        }
      </ol>
    </div>
  `,
  styles: `
    .rk-head { display: flex; justify-content: space-between; padding: 0 4px 8px; font-size: 12px; font-weight: 700; color: #5f6f70; text-transform: uppercase; letter-spacing: .3px; border-bottom: 1px solid #dfe9ea; }
    .rk-list { list-style: none; margin: 0; padding: 0; max-height: 380px; overflow-y: auto; }
    .rk-list li { display: grid; grid-template-columns: 26px 1fr auto; gap: 10px; align-items: center; padding: 8px 4px; border-bottom: 1px solid #eef3f3; }
    .rk-rank { font-size: 12px; font-weight: 700; color: #6b7f80; text-align: right; font-variant-numeric: tabular-nums; }
    .rk-body { min-width: 0; }
    .rk-label { display: block; font-size: 13px; color: #232527; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rk-track { display: block; height: 6px; margin-top: 4px; border-radius: 3px; background: #eef3f3; }
    .rk-bar { display: block; height: 100%; border-radius: 3px; background: #00909a; min-width: 2px; }
    .rk-value { font-size: 13px; font-weight: 700; color: #23474a; font-variant-numeric: tabular-nums; }
    .rk-empty { display: block !important; text-align: center; color: #6b7f80; padding: 18px; }`,
})
export class RankList {
  readonly items = input.required<ChartItem[]>();
  readonly heading = input('');
  readonly valueHeading = input('Units');
  private readonly max = computed(() => Math.max(1, ...this.items().map((i) => i.value)));
  protected width(v: number): number {
    return (v / this.max()) * 100;
  }
  protected format(v: number): string {
    return formatCount(v);
  }
}
