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
// 2026-11-18 (the user: staff pages 'not aligned with SVG files'): the dashboard design's level colours.
export const LEVEL_COLORS: Record<string, string> = { Bronze: '#c9714f', Silver: '#7b838a', Gold: '#c9a23f' };

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

/** A share as a whole percent ("71%"), "<1%" for a small non-zero one. */
export function wholePercent(value: number, total: number): string {
  if (!total || !value) return '0%';
  const p = Math.round((value / total) * 100);
  return p < 1 ? '<1%' : `${p}%`;
}

/**
 * 2026-11-17 (approved staff redesign, "Who is registering"): one category split as a single stacked bar with a legend
 * that names each part with its share (identity never by colour alone); the count is in the tooltip.
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): as staff-00: a 12px bar of separate rounded parts 2px
 * apart, 12.5/700 heading, 11/500 grey legend.
 */
@Component({
  selector: 'zed-stacked-bar',
  template: `
    <div class="sb">
      @if (heading()) { <div class="sb-head">{{ heading() }}</div> }
      @if (sum()) {
        <div class="sb-bar" role="img" [attr.aria-label]="describe()">
          @for (it of items(); track it.label) {
            @if (it.value) { <span [style.width.%]="(it.value / sum()) * 100" [style.background]="it.color" [title]="it.label + ': ' + format(it.value)"></span> }
          }
        </div>
        <ul class="sb-legend">
          @for (it of items(); track it.label) {
            <li [title]="format(it.value)"><span class="sb-dot" [style.background]="it.color"></span><span class="sb-label">{{ it.label }}</span>&ngsp;<span class="sb-share">{{ share(it.value) }}</span></li>
          }
        </ul>
      } @else {
        <div class="sb-empty">No data</div>
      }
    </div>
  `,
  styles: `
    .sb-head { font-size: 12.5px; font-weight: 700; color: #17373b; margin-bottom: 7px; }
    .sb-bar { display: flex; gap: 2px; height: 12px; }
    .sb-bar span { display: block; height: 100%; min-width: 2px; border-radius: 3px; }
    .sb-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; list-style: none; margin: 10px 0 0; padding: 0; font-size: 11px; font-weight: 500; color: #6f8487; }
    .sb-legend li { display: inline-flex; align-items: center; gap: 5px; }
    .sb-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
    .sb-share { font-variant-numeric: tabular-nums; }
    .sb-empty { font-size: 12.5px; color: #6b7f80; padding: 4px 0; }`,
})
export class StackedBar {
  readonly items = input.required<ChartItem[]>();
  readonly heading = input('');
  protected readonly sum = computed(() => this.items().reduce((a, i) => a + i.value, 0));
  protected format(v: number): string {
    return formatCount(v);
  }
  protected share(v: number): string {
    return wholePercent(v, this.sum());
  }
  protected describe(): string {
    return `${this.heading()}: ` + this.items().map((i) => `${i.label} ${this.share(i.value)}`).join(', ');
  }
}

export type RankSort = 'high' | 'low' | 'name';

/**
 * A ranked list: rank (by count), name, the number and a bar in proportion to the largest. V4 2026-11-17 (approved staff
 * redesign): the top five under the card's title, "View all" opens every row with the sort (by count, highest or lowest
 * first, or by name).
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): as staff-00: 16/700 title, 12/700 rank, 13/600 name,
 * a 5px light-teal bar; "View All" (title case) opens the full list in the card (there is no separate full-list page).
 */
@Component({
  selector: 'zed-rank-list',
  template: `
    <div class="rk">
      <div class="rk-head">
        <span class="rk-title">{{ heading() }}</span>
        @if (all()) {
          <label class="rk-sort">
            <span class="visually-hidden">Sort {{ heading() }}</span>
            <select [value]="sort()" (change)="sort.set($any($event.target).value)">
              <option value="high">Highest first</option>
              <option value="low">Lowest first</option>
              <option value="name">A to Z</option>
            </select>
          </label>
        }
        @if (sorted().length > limit()) {
          <button type="button" class="rk-more no-export" [attr.aria-expanded]="all()" (click)="toggle()">{{ all() ? 'Show Top ' + limit() : 'View All' }}</button>
        }
      </div>
      <ol class="rk-list">
        @for (it of shown(); track it.label) {
          <li [title]="it.label + ': ' + format(it.value) + ' ' + valueHeading().toLowerCase()">
            <span class="rk-rank">{{ it.rank }}</span>
            <span class="rk-label">{{ it.label }}</span>
            <span class="rk-value">{{ format(it.value) }}</span>
            <span class="rk-track"><span class="rk-bar" [style.width.%]="width(it.value)"></span></span>
          </li>
        } @empty {
          <li class="rk-empty">No data</li>
        }
      </ol>
    </div>
  `,
  styles: `
    .rk { height: 100%; border-radius: 14px; border: 1px solid #dde7e8; background: #fff; box-shadow: 0 3px 10px rgba(16, 61, 64, .06); }
    .rk-head { display: flex; align-items: center; gap: 10px; min-height: 56px; padding: 8px 24px; border-bottom: 1px solid #dde7e8; }
    .rk-title { flex: 1; min-width: 0; font-size: 16px; font-weight: 700; color: #17373b; }
    .rk-sort select { font-size: 12px; border: 1px solid #cbd9da; border-radius: 6px; background: #fff; color: #23474a; padding: 3px 6px; }
    .rk-more { border: 0; background: none; padding: 0; color: #24666b; font-size: 13px; font-weight: 700; white-space: nowrap; }
    .rk-more:hover { text-decoration: underline; }
    .rk-list { list-style: none; margin: 0; padding: 4px 24px 16px; }
    .rk-list li { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; align-items: center; padding: 10px 0 0; line-height: 16px; }
    .rk-rank { font-size: 12px; font-weight: 700; color: #6f8487; font-variant-numeric: tabular-nums; }
    .rk-label { font-size: 13px; font-weight: 600; color: #17373b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rk-value { padding-left: 8px; font-size: 13px; font-weight: 700; color: #17373b; font-variant-numeric: tabular-nums; }
    .rk-track { grid-column: 2 / 4; display: block; height: 5px; margin-top: 4px; border-radius: 3px; background: #e9efef; }
    .rk-bar { display: block; height: 100%; border-radius: 3px; background: #3ba3ad; min-width: 2px; }
    .rk-empty { display: block !important; text-align: center; color: #6b7f80; padding: 18px; }`,
})
export class RankList {
  readonly items = input.required<ChartItem[]>();
  readonly heading = input('');
  /** What the numbers count (the rows' tooltip). */
  readonly valueHeading = input('Units');
  /** Rows before "View all". */
  readonly limit = input(5);
  protected readonly sort = signal<RankSort>('high');
  protected readonly all = signal(false);
  protected readonly shown = computed(() => (this.all() ? this.sorted() : this.sorted().slice(0, this.limit())));
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
  protected toggle(): void {
    this.all.update((v) => !v);
    if (!this.all()) this.sort.set('high');
  }
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
  /** The period in full for the tooltip and screen readers ("Nov 2026" under an axis label "Nov"). */
  tip?: string;
  values: number[];
}

/**
 * A round axis top at or above the largest value (1, 2, 2.5, 5 or 10 times a power of ten) and its four steps.
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): whole steps only (counts of units: no 0.5 or 2.5).
 */
export function axisTicks(max: number): number[] {
  if (max <= 0) return [0, 1, 2, 3, 4];
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, Math.ceil(([1, 2, 2.5, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow));
  return [0, 1, 2, 3, 4].map((i) => i * step);
}

/**
 * Columns in pairs (one per series) on a value axis with grid lines; a hover or focus tooltip gives every series of the
 * period. The legend can be left to the card (legend = false).
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): 18px columns 4px apart, 10.5/11px grey axis text.
 */
@Component({
  selector: 'zed-grouped-column-chart',
  template: `
    <div class="gc">
      @if (legend()) {
        <ul class="gc-legend">
          @for (s of series(); track s; let i = $index) {
            <li><span class="gc-swatch" [style.background]="colors()[i]"></span>{{ s }}</li>
          }
        </ul>
      }
      <div class="gc-frame">
        <div class="gc-ticks" aria-hidden="true">
          @for (t of ticks(); track $index) { <span [style.bottom.%]="$index * 25">{{ tick(t) }}</span> }
        </div>
        <div class="gc-area">
          @for (t of ticks(); track $index) { <span class="gc-grid" [style.bottom.%]="$index * 25" aria-hidden="true"></span> }
          <div class="gc-plot" [style.--cols]="items().length || 1" role="img" [attr.aria-label]="ariaLabel()">
            @for (it of items(); track it.label; let p = $index) {
              <div class="gc-group" tabindex="0" (mouseenter)="hover.set(p)" (mouseleave)="hover.set(-1)" (focus)="hover.set(p)" (blur)="hover.set(-1)"
                   [attr.aria-label]="describe(it)">
                @for (v of it.values; track $index; let i = $index) {
                  <span class="gc-bar" [style.height.%]="height(v)" [style.background]="colors()[i]" [class.is-dim]="hover() >= 0 && hover() !== p"></span>
                }
                @if (hover() === p) {
                  <span class="gc-tip" role="tooltip">
                    <strong>{{ it.tip || it.label }}</strong>
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
      </div>
    </div>
  `,
  styles: `
    .gc-legend { display: flex; gap: 18px; list-style: none; margin: 0 0 6px; padding: 0; font-size: 13px; color: #3b4b4c; }
    .gc-legend li { display: flex; align-items: center; gap: 6px; }
    .gc-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
    .gc-legend .gc-swatch { margin-right: 0; }
    .gc-frame { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px; padding-top: 8px; }
    .gc-ticks { position: relative; height: var(--h, 200px); min-width: 28px; }
    .gc-ticks span { position: absolute; right: 0; transform: translateY(50%); font-size: 10.5px; font-weight: 500; color: #6f8487; font-variant-numeric: tabular-nums; }
    .gc-area { position: relative; min-width: 0; }
    .gc-grid { position: absolute; left: 0; right: 0; border-top: 1px solid #edf2f2; }
    .gc-grid:first-child { border-color: #cbd9da; }
    .gc-plot { position: relative; display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 10px; align-items: end; height: var(--h, 200px); }
    .gc-group { position: relative; height: 100%; display: flex; justify-content: center; align-items: flex-end; gap: 4px; outline: none; }
    .gc-group:focus-visible { outline: 2px solid #23474a; outline-offset: 2px; border-radius: 4px; }
    .gc-bar { flex: 1 1 0; max-width: 18px; min-height: 2px; border-radius: 3px 3px 0 0; transition: opacity .15s; }
    .gc-bar.is-dim { opacity: .45; }
    .gc-axis { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 10px; margin-top: 6px; }
    .gc-label { font-size: 11px; font-weight: 500; color: #6f8487; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .gc-tip { position: absolute; bottom: calc(100% + 4px); left: 50%; transform: translateX(-50%); z-index: 3; white-space: nowrap;
      display: flex; flex-direction: column; gap: 2px; background: #23474a; color: #fff; font-size: 12px; padding: 6px 10px; border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,.18); pointer-events: none; }`,
})
export class GroupedColumnChart {
  readonly items = input.required<TrendPoint[]>();
  readonly series = input.required<string[]>();
  readonly colors = input<string[]>(CHART_COLORS);
  readonly ariaLabel = input('');
  /** The series' legend above the plot (false: the card shows it). */
  readonly legend = input(true);
  protected readonly hover = signal(-1);
  protected readonly ticks = computed(() => axisTicks(Math.max(0, ...this.items().flatMap((i) => i.values))));

  protected height(v: number): number {
    const top = this.ticks()[4] || 1;
    return Math.min(100, (v / top) * 100);
  }
  protected format(v: number): string {
    return formatCount(v);
  }
  protected tick(v: number): string {
    if (v >= 1e7) return `${+(v / 1e7).toFixed(1)}Cr`;
    if (v >= 1e5) return `${+(v / 1e5).toFixed(1)}L`;
    return formatCount(v);
  }
  protected describe(it: TrendPoint): string {
    return `${it.tip || it.label}: ` + it.values.map((v, i) => `${this.series()[i]} ${formatCount(v)}`).join(', ');
  }
}
