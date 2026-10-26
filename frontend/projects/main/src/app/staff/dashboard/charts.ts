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

  /** Up to 86% of the plot: the value above the tallest column stays inside. */
  protected height(v: number): number {
    return (v / this.max()) * 86;
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

/**
 * A donut of a few categories, centred, with a legend under it that names each one with its value and share (identity
 * never by colour alone).
 */
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
    /* Centred: a large donut over its legend. */
    :host { display: flex; align-items: center; justify-content: center; }
    .dn { display: flex; flex-direction: column; align-items: center; gap: 14px; width: 100%; }
    .dn-svg { flex: 0 0 auto; width: 210px; height: 210px; }
    .dn-svg circle { transition: opacity .15s; cursor: default; }
    .dn-svg circle.is-dim { opacity: .35; }
    .dn-total { font-size: 15px; font-weight: 700; fill: #23474a; }
    .dn-caption { font-size: 9px; fill: #6b7f80; }
    .dn-legend { width: 100%; max-width: 340px; list-style: none; margin: 0; padding: 0; }
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

export type RankSort = 'high' | 'low' | 'name';

/**
 * A ranked list with a coloured header: rank (by count), name, a bar in proportion to the largest, the number. Every
 * row, in a scroll; the header's choice sorts by count (highest or lowest first) or by name.
 */
@Component({
  selector: 'zed-rank-list',
  template: `
    <div class="rk" [style.--head]="color()">
      <div class="rk-head">
        <span class="rk-title">{{ heading() }} <small>({{ items().length }})</small></span>
        <label class="rk-sort">
          <span class="visually-hidden">Sort {{ heading() }}</span>
          <select [value]="sort()" (change)="sort.set($any($event.target).value)">
            <option value="high">Highest first</option>
            <option value="low">Lowest first</option>
            <option value="name">A to Z</option>
          </select>
        </label>
      </div>
      <div class="rk-cols"><span>#</span><span>{{ heading() }}</span><span>{{ valueHeading() }}</span></div>
      <ol class="rk-list">
        @for (it of sorted(); track it.label) {
          <li [title]="it.label + ': ' + format(it.value)">
            <span class="rk-rank">{{ it.rank }}</span>
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
    .rk { --head: #23474a; border-radius: 10px; overflow: hidden; border: 1px solid #e4ecec; }
    .rk-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 12px; background: var(--head); color: #fff; }
    .rk-title { font-size: 14px; font-weight: 700; letter-spacing: .3px; }
    .rk-title small { font-weight: 500; opacity: .85; }
    .rk-sort select { font-size: 12px; border: 1px solid rgba(255,255,255,.55); border-radius: 6px; background: rgba(255,255,255,.15); color: #fff;
      padding: 3px 6px; cursor: pointer; }
    .rk-sort select option { color: #232527; }
    .rk-cols { display: grid; grid-template-columns: 30px 1fr auto; gap: 10px; padding: 6px 12px; font-size: 11px; font-weight: 700; color: #6b7f80;
      text-transform: uppercase; letter-spacing: .3px; background: #f7fafa; border-bottom: 1px solid #e4ecec; }
    .rk-cols span:first-child { text-align: right; }
    .rk-list { list-style: none; margin: 0; padding: 0 12px; height: 380px; overflow-y: auto; }
    .rk-list li { display: grid; grid-template-columns: 30px 1fr auto; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid #eef3f3; }
    .rk-rank { font-size: 12px; font-weight: 700; color: #6b7f80; text-align: right; font-variant-numeric: tabular-nums; }
    .rk-body { min-width: 0; }
    .rk-label { display: block; font-size: 13px; color: #232527; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rk-track { display: block; height: 6px; margin-top: 4px; border-radius: 3px; background: #eef3f3; }
    .rk-bar { display: block; height: 100%; border-radius: 3px; background: var(--head); min-width: 2px; opacity: .85; }
    .rk-value { font-size: 13px; font-weight: 700; color: #23474a; font-variant-numeric: tabular-nums; }
    .rk-empty { display: block !important; text-align: center; color: #6b7f80; padding: 18px; }`,
})
export class RankList {
  readonly items = input.required<ChartItem[]>();
  readonly heading = input('');
  readonly valueHeading = input('Units');
  /** The header's colour (and the bars'). */
  readonly color = input('#23474a');
  protected readonly sort = signal<RankSort>('high');
  private readonly max = computed(() => Math.max(1, ...this.items().map((i) => i.value)));
  /** Rows with their rank by count (1 = most), in the chosen order. */
  protected readonly sorted = computed(() => {
    const ranked = [...this.items()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)).map((it, i) => ({ ...it, rank: i + 1 }));
    switch (this.sort()) {
      case 'low': return [...ranked].reverse();
      case 'name': return [...ranked].sort((a, b) => a.label.localeCompare(b.label));
      default: return ranked;
    }
  });
  protected width(v: number): number {
    return (v / this.max()) * 100;
  }
  protected format(v: number): string {
    return formatCount(v);
  }
}

/** One period of a two-series trend (registrations and certifications). */
export interface TrendPoint {
  label: string;
  values: number[];
}

/**
 * Columns in pairs (one per series) with a legend that names the series, the values above the columns and a hover
 * tooltip with every series of the period.
 */
@Component({
  selector: 'zed-grouped-column-chart',
  template: `
    <div class="gc">
      <ul class="gc-legend">
        @for (s of series(); track s; let i = $index) {
          <li><span class="gc-swatch" [style.background]="colors()[i]"></span>{{ s }}</li>
        }
      </ul>
      <div class="gc-plot" [style.--cols]="items().length || 1" role="img" [attr.aria-label]="ariaLabel()">
        @for (it of items(); track it.label; let p = $index) {
          <div class="gc-group" tabindex="0" (mouseenter)="hover.set(p)" (mouseleave)="hover.set(-1)" (focus)="hover.set(p)" (blur)="hover.set(-1)"
               [attr.aria-label]="describe(it)">
            @for (v of it.values; track $index; let i = $index) {
              <div class="gc-col">
                <span class="gc-value">{{ short(v) }}</span>
                <span class="gc-bar" [style.height.%]="height(v)" [style.background]="colors()[i]" [class.is-dim]="hover() >= 0 && hover() !== p"></span>
              </div>
            }
            @if (hover() === p) {
              <span class="gc-tip" role="tooltip">
                <strong>{{ it.label }}</strong>
                @for (v of it.values; track $index; let i = $index) {
                  <span><span class="gc-swatch" [style.background]="colors()[i]"></span>{{ series()[i] }}: {{ format(v) }}</span>
                }
              </span>
            }
          </div>
        }
      </div>
      <div class="gc-axis" [style.--cols]="items().length || 1">
        @for (it of items(); track it.label) { <span class="gc-label">{{ it.label }}</span> }
      </div>
    </div>
  `,
  styles: `
    .gc-legend { display: flex; gap: 18px; list-style: none; margin: 0 0 6px; padding: 0; font-size: 13px; color: #3b4b4c; }
    .gc-legend li { display: flex; align-items: center; gap: 6px; }
    .gc-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: middle; }
    .gc-legend .gc-swatch { margin-right: 0; }
    .gc-plot { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 10px; align-items: end; height: var(--h, 240px);
      border-bottom: 1px solid #cbd9da; padding-top: 22px; }
    .gc-group { position: relative; height: 100%; display: flex; justify-content: center; align-items: flex-end; gap: 2px; outline: none; }
    .gc-group:focus-visible { outline: 2px solid #23474a; outline-offset: 2px; border-radius: 4px; }
    .gc-col { height: 100%; flex: 1 1 0; max-width: 34px; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; min-width: 0; }
    .gc-value { font-size: 10.5px; font-weight: 600; color: #23474a; margin-bottom: 3px; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .gc-bar { width: 100%; min-height: 2px; border-radius: 4px 4px 0 0; transition: opacity .15s; }
    .gc-bar.is-dim { opacity: .45; }
    .gc-axis { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 10px; margin-top: 6px; }
    .gc-label { font-size: 12px; color: #5f6f70; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .gc-tip { position: absolute; bottom: calc(100% + 4px); left: 50%; transform: translateX(-50%); z-index: 3; white-space: nowrap;
      display: flex; flex-direction: column; gap: 2px; background: #23474a; color: #fff; font-size: 12px; padding: 6px 10px; border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,.18); pointer-events: none; }`,
})
export class GroupedColumnChart {
  readonly items = input.required<TrendPoint[]>();
  readonly series = input.required<string[]>();
  readonly colors = input<string[]>(CHART_COLORS);
  readonly ariaLabel = input('');
  protected readonly hover = signal(-1);
  private readonly max = computed(() => Math.max(1, ...this.items().flatMap((i) => i.values)));

  /** Up to 86% of the plot: the value above the tallest column stays inside. */
  protected height(v: number): number {
    return (v / this.max()) * 86;
  }
  protected format(v: number): string {
    return formatCount(v);
  }
  protected short(v: number): string {
    if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
    if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return String(v);
  }
  protected describe(it: TrendPoint): string {
    return `${it.label}: ` + it.values.map((v, i) => `${this.series()[i]} ${formatCount(v)}`).join(', ');
  }
}
