import { Component, Signal, WritableSignal, computed, input, linkedSignal, model, signal } from '@angular/core';

/** "Show N Entries" choices of the old list pages. */
export const PAGE_SIZES: readonly number[] = [10, 20, 50, 100];

type Row = Record<string, unknown>;
export type PageStep = 'first' | 'prev' | 'next' | 'last' | -2 | -1 | 1 | 2;

/** What the pager bar needs: paging done in the browser (ClientPager) or by the server (ServerPager). */
export interface Pager {
  readonly pageNo: Signal<number>;
  readonly pageSize: Signal<number>;
  readonly lastPage: Signal<number>;
  readonly pages: Signal<number[]>;
  /** Records in the list (after the search box). */
  readonly total: Signal<number>;
  setPageSize(value: number | string): void;
  /** First / Prev / Next / Last (the old -2 / -1 / 1 / 2), or a page number from the page drop-down. */
  go(where: PageStep): void;
  goTo(page: number | string): void;
}

function pagesOf(last: number): number[] {
  return Array.from({ length: last }, (_, i) => i + 1);
}

function step(where: PageStep, current: number, last: number): number {
  switch (where) {
    case 'first': case -2: return 1;
    case 'last': case 2: return last;
    case 'prev': case -1: return current - 1;
    default: return current + 1;
  }
}

/**
 * Paging and text search in the browser over a loaded list, as the old pages did (GetCurrentPageData): the whole list
 * is loaded once per filter change, then paged and searched here. A new list or search goes back to page 1.
 */
export class ClientPager<T extends object = Row> implements Pager {
  readonly all = signal<T[]>([]);
  readonly search = signal('');
  readonly pageSize: WritableSignal<number>;
  readonly pageNo = signal(1);

  /** Rows matching the search box: any value of the row contains the text (the old JSON.stringify match). */
  readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const rows = this.all();
    return q ? rows.filter((r) => Object.values(r).some((v) => v !== null && v !== undefined && String(v).toLowerCase().includes(q))) : rows;
  });
  readonly total = computed(() => this.filtered().length);
  readonly lastPage = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  readonly pages = computed(() => pagesOf(this.lastPage()));
  /** The rows of the current page. */
  readonly page = computed(() => {
    const size = this.pageSize();
    const start = (Math.min(this.pageNo(), this.lastPage()) - 1) * size;
    return this.filtered().slice(start, start + size);
  });

  constructor(defaultPageSize = 10) {
    this.pageSize = signal(defaultPageSize);
  }

  /** S.No. of the row at <paramref name="index"/> of the current page. */
  serial(index: number): number {
    return (Math.min(this.pageNo(), this.lastPage()) - 1) * this.pageSize() + index + 1;
  }

  set(rows: T[]): void {
    this.all.set(rows);
    this.pageNo.set(1);
  }

  /** Replaces the list but stays on the current page when it still exists (after an action on one row). */
  refresh(rows: T[]): void {
    this.all.set(rows);
    this.pageNo.update((p) => Math.min(p, this.lastPage()));
  }

  setSearch(value: string): void {
    this.search.set(value);
    this.pageNo.set(1);
  }

  setPageSize(value: number | string): void {
    this.pageSize.set(Number(value) || PAGE_SIZES[0]);
    this.pageNo.set(1);
  }

  go(where: PageStep): void {
    const last = this.lastPage();
    this.goTo(step(where, Math.min(this.pageNo(), last), last));
  }

  goTo(page: number | string): void {
    this.pageNo.set(Math.min(this.lastPage(), Math.max(1, Number(page) || 1)));
  }
}

/**
 * Paging done by the server (the procedures' PageNo / PageSize / TotalCount, as the old Completed, Rejected and Registered
 * MSME pages): a page change asks <paramref name="load"/> for that page.
 */
export class ServerPager implements Pager {
  readonly pageNo = signal(1);
  readonly pageSize: WritableSignal<number>;
  readonly total = signal(0);
  readonly lastPage = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  readonly pages = computed(() => pagesOf(this.lastPage()));

  constructor(
    defaultPageSize: number,
    private readonly load: () => void,
  ) {
    this.pageSize = signal(defaultPageSize);
  }

  setPageSize(value: number | string): void {
    this.pageSize.set(Number(value) || PAGE_SIZES[0]);
    this.pageNo.set(1);
    this.load();
  }

  go(where: PageStep): void {
    const last = this.lastPage();
    this.goTo(step(where, this.pageNo(), last));
  }

  goTo(page: number | string): void {
    const p = Math.min(this.lastPage(), Math.max(1, Number(page) || 1));
    if (p === this.pageNo()) return;
    this.pageNo.set(p);
    this.load();
  }

  /** Back to page 1 (new filter or search); the caller loads. */
  reset(): void {
    this.pageNo.set(1);
  }
}

/**
 * Pages a list the screen already has (its own filters, tabs and search stay as they are): back to page 1 whenever the
 * list changes (new filter, search or reload), as the old pages' setLastPage() did.
 */
export class PagedView<T> implements Pager {
  readonly pageSize: WritableSignal<number>;
  readonly pageNo: WritableSignal<number>;
  readonly total = computed(() => this.source().length);
  readonly lastPage = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  readonly pages = computed(() => pagesOf(this.lastPage()));
  /** The rows of the current page. */
  readonly page = computed(() => {
    const size = this.pageSize();
    const start = (Math.min(this.pageNo(), this.lastPage()) - 1) * size;
    return this.source().slice(start, start + size);
  });

  constructor(
    private readonly source: () => readonly T[],
    defaultPageSize = 10,
  ) {
    this.pageSize = signal(defaultPageSize);
    this.pageNo = linkedSignal({ source: this.source, computation: () => 1 });
  }

  /** S.No. of the row at <paramref name="index"/> of the current page. */
  serial(index: number): number {
    return (Math.min(this.pageNo(), this.lastPage()) - 1) * this.pageSize() + index + 1;
  }

  setPageSize(value: number | string): void {
    this.pageSize.set(Number(value) || PAGE_SIZES[0]);
    this.pageNo.set(1);
  }

  go(where: PageStep): void {
    const last = this.lastPage();
    this.goTo(step(where, Math.min(this.pageNo(), last), last));
  }

  goTo(page: number | string): void {
    this.pageNo.set(Math.min(this.lastPage(), Math.max(1, Number(page) || 1)));
  }
}

/** The page buttons: the first, the last, the current one and its neighbours; 0 marks a gap ("…"). All when 7 or fewer. */
export function pageWindow(current: number, last: number): number[] {
  if (last <= 7) return pagesOf(last);
  const near = [1, last, current - 1, current, current + 1].filter((n) => n >= 1 && n <= last);
  // Near the ends, show a few more so the row keeps its length (1 2 3 4 … 9 / 1 … 6 7 8 9).
  if (current <= 3) near.push(2, 3, 4);
  if (current >= last - 2) near.push(last - 1, last - 2, last - 3);
  const pages = [...new Set(near)].sort((a, b) => a - b);
  const out: number[] = [];
  for (const n of pages) {
    if (out.length && n - out[out.length - 1] > 1) out.push(n - out[out.length - 1] === 2 ? n - 1 : 0);
    out.push(n);
  }
  return out;
}

/**
 * The line under a list. 2026-11-17 (approved staff redesign): "Showing 1 to 10 of 34 · Rows per page [10] · Prev 1 2 … 4
 * Next" (before: "Show N Entries (N records)" and First / Prev / page / Next / Last). Same inputs; the pager does the paging.
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): the designs' sizes: 12.5px grey text, 30px boxes with 8px corners,
 * Prev and Next 70px wide, a disabled one on light grey.
 */
@Component({
  selector: 'zed-pager',
  host: { class: 'd-block' },
  template: `
    @let p = pager();
    <div class="zed-pager zp">
      <div class="zp-info">
        @if (showCount()) { <span class="zp-count" role="status">{{ range() }}</span> }
        <label class="zp-size">Rows per page
          <select aria-label="Rows per page" (change)="p.setPageSize($any($event.target).value)">
            @for (n of sizes(); track n) { <option [value]="n" [selected]="n === p.pageSize()">{{ n }}</option> }
          </select>
        </label>
      </div>
      <nav class="zp-pages" aria-label="Pages">
        <button type="button" class="zp-btn" [disabled]="current() <= 1" (click)="p.go('prev')">Prev</button>
        @for (n of window(); track $index) {
          @if (n === 0) {
            <span class="zp-gap" aria-hidden="true">…</span>
          } @else {
            <button type="button" class="zp-btn zp-num" [class.on]="n === current()" [attr.aria-current]="n === current() ? 'page' : null"
                    [attr.aria-label]="'Page ' + n" (click)="p.goTo(n)">{{ n }}</button>
          }
        }
        <button type="button" class="zp-btn" [disabled]="current() >= p.lastPage()" (click)="p.go('next')">Next</button>
      </nav>
    </div>
  `,
  styles: `
    .zp { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; margin: 8px 0; font-size: 12.5px; font-weight: 500; color: #6f8487; }
    .zp-info { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 24px; }
    .zp-size { display: inline-flex; align-items: center; gap: 10px; margin: 0; font-weight: 500; }
    .zp-size select { height: 30px; min-width: 58px; padding: 0 24px 0 12px; border: 1px solid #dde7e8; border-radius: 8px; background-color: #fff;
      color: #17373b; font-size: 12.5px; font-weight: 600; }
    .zp-pages { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .zp-btn { min-width: 70px; height: 30px; padding: 0 12px; border: 1px solid #dde7e8; border-radius: 8px; background: #fff;
      color: #17373b; font-size: 12.5px; font-weight: 600; line-height: 1; }
    .zp-btn:hover:not(:disabled):not(.on) { background: #e6f2f3; border-color: #c9dadb; }
    .zp-btn:focus-visible { outline: 2px solid var(--zt-mid2, #2a8a8c); outline-offset: 2px; }
    .zp-btn:disabled { background: #f3f6f6; border-color: #dde7e8; color: #9aadaf; cursor: default; }
    .zp-num { min-width: 32px; padding: 0 8px; }
    .zp-btn.on { background: var(--zt-dark, #24666b); border-color: var(--zt-dark, #24666b); color: #fff; font-weight: 700; }
    .zp-gap { padding: 0 2px; color: #8a9899; }
    @media (max-width: 575.98px) { .zp, .zp-info { gap: 8px; } }
  `,
})
export class PagerComponent {
  readonly pager = input.required<Pager>();
  readonly sizes = input<readonly number[]>(PAGE_SIZES);
  /** "Showing 1 to 10 of 34" (false: the rows-per-page choice and the page buttons only). */
  readonly showCount = input(true);

  /** The page shown (a list that shrank shows its last page). */
  protected readonly current = computed(() => Math.min(this.pager().pageNo(), this.pager().lastPage()));
  protected readonly window = computed(() => pageWindow(this.current(), this.pager().lastPage()));
  protected readonly range = computed(() => {
    const p = this.pager();
    const total = p.total();
    if (!total) return 'No records';
    const from = (this.current() - 1) * p.pageSize() + 1;
    return `Showing ${from} to ${Math.min(total, from + p.pageSize() - 1)} of ${total}`;
  });
}

/** All the text of a row: its values, nested objects and lists included. */
function rowText(value: unknown, depth = 0): string {
  if (value === null || value === undefined || depth > 4) return '';
  if (Array.isArray(value)) return value.map((v) => rowText(v, depth + 1)).join(' ');
  if (typeof value === 'object') return Object.values(value).map((v) => rowText(v, depth + 1)).join(' ');
  return String(value);
}

/** The rows that contain every word of the search box (any column, any case); all rows for an empty box. */
export function searchRows<T>(rows: readonly T[], query: string): readonly T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.length ? rows.filter((r) => {
    const text = rowText(r).toLowerCase();
    return words.every((w) => text.includes(w));
  }) : rows;
}

/**
 * The search box above a list (V4: on every staff list, as User Management): searches as you type, with the number of
 * rows found. The screen filters its rows with searchRows() before paging them.
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): the box starts at the left of its place (it was pushed to the
 * right of a wider place, which left a gap before it in the search cards) and is the designs' 340 x 38.
 */
@Component({
  selector: 'zed-list-search',
  host: { class: 'zed-list-search' },
  template: `
    <div class="list-search-box">
      <svg class="list-search-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
      </svg>
      <input type="search" class="form-control" maxlength="100" autocomplete="off" [id]="inputId()" [placeholder]="placeholder()"
             [attr.aria-label]="placeholder()" [value]="value()" (input)="value.set($any($event.target).value)" />
    </div>
    @if (value().trim() && found() !== null) {
      <span class="list-search-found" role="status">{{ found() }} found</span>
    }
  `,
  styles: `
    :host { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-start; gap: 10px; margin: 0 0 12px; }
    .list-search-box { position: relative; width: 340px; max-width: 100%; }
    .list-search-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #6f8487; pointer-events: none; }
    .list-search-box .form-control { max-width: none; width: 100%; height: 38px; min-height: 38px; padding: 0 12px 0 36px; border: 1.2px solid #b9cdcf;
      border-radius: 9px; font-size: 13px; background-image: none; }
    .list-search-box .form-control::placeholder { color: #9aadaf; }
    .list-search-found { font-size: 12.5px; color: #6f8487; }
    @media (max-width: 575.98px) { .list-search-box { width: 100%; } }
  `,
})
export class ListSearchComponent {
  readonly value = model('');
  readonly placeholder = input('Search');
  readonly inputId = input('list-search');
  /** Rows matching (shown next to the box while it has text); null hides it. */
  readonly found = input<number | null>(null);
}
