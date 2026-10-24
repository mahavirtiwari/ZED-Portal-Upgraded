import { Component, Signal, WritableSignal, computed, input, linkedSignal, signal } from '@angular/core';

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

/** "Show N Entries (N records)" and First / Prev / page / Next / Last of the old list pages. */
@Component({
  selector: 'zed-pager',
  host: { class: 'd-block' },
  template: `
    @let p = pager();
    <div class="row justify-content-between align-items-center g-2 my-2 zed-pager">
      <div class="col-sm-6">
        Show
        <select class="btn btn-primary" aria-label="Entries per page" (change)="p.setPageSize($any($event.target).value)">
          @for (n of sizes(); track n) { <option [value]="n" [selected]="n === p.pageSize()">{{ n }}</option> }
        </select>
        Entries
        @if (showCount()) { <span class="ms-2 text-muted">({{ p.total() }} records)</span> }
      </div>
      <nav class="col-sm-auto text-end" aria-label="Pages">
        <button type="button" class="btn btn-primary me-1" (click)="p.go('first')">First</button>
        <button type="button" class="btn btn-primary me-1" [disabled]="p.pageNo() <= 1" (click)="p.go('prev')">Prev</button>
        <select class="btn btn-primary me-1" aria-label="Page" (change)="p.goTo($any($event.target).value)">
          @for (i of p.pages(); track i) { <option [value]="i" [selected]="i === p.pageNo()">{{ i }}</option> }
        </select>
        <button type="button" class="btn btn-primary me-1" [disabled]="p.pageNo() >= p.lastPage()" (click)="p.go('next')">Next</button>
        <button type="button" class="btn btn-primary" (click)="p.go('last')">Last</button>
      </nav>
    </div>
  `,
  styles: `.zed-pager .btn:disabled { opacity: .6; }`,
})
export class PagerComponent {
  readonly pager = input.required<Pager>();
  readonly sizes = input<readonly number[]>(PAGE_SIZES);
  readonly showCount = input(true);
}
