import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ClientPager, PagerComponent } from '../pager';
import { ExcelToolsComponent } from '../excel-tools';
import { MastersApi, Technology } from './masters.api';

/** Which technologies the list shows (the buttons beside the search box). */
type StatusFilter = 'all' | 'active' | 'inactive';

/**
 * Technologies (Admin). Port of Views/Technology/List.cshtml: list, edit link, activate / deactivate. V4: search, pages,
 * a status column, and long descriptions folded to three lines. V4 layout: counts at the top, an active / inactive filter
 * and a chip per category (a click shows only that category), the description under the technology's name, and a card
 * per technology on phones.
 */
@Component({
  selector: 'zed-staff-technologies',
  imports: [FormsModule, PagerComponent, RouterLink, ExcelToolsComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Technologies</h3>
        <p class="page-sub">Technologies the MSMEs can choose under Technology Upgradation, with their NIC sectors and categories.</p>
      </div>
      <div class="page-actions">
        <zed-excel-tools api="/api/staff/masters/technologies" title="Technologies" fileName="technologies" (applied)="load()" />
        <a routerLink="/staff/masters/technologies/new" class="btn btn-primary">+ Add New Technology</a>
      </div>
    </div>

    <div class="tech-stats">
      <div class="stat"><span class="stat-value">{{ stats().total }}</span><span class="stat-label">Technologies</span></div>
      <div class="stat stat-on"><span class="stat-value">{{ stats().active }}</span><span class="stat-label">Active (MSMEs can choose them)</span></div>
      <div class="stat"><span class="stat-value">{{ stats().inactive }}</span><span class="stat-label">Inactive</span></div>
      <div class="stat"><span class="stat-value">{{ categoryChips().length }}</span><span class="stat-label">Categories in use</span></div>
    </div>

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    <div class="zed-card list-card">
      <div class="list-toolbar">
        <input type="search" class="form-control search" placeholder="Search code, name, sector or category" aria-label="Search technologies"
               [ngModel]="pager.search()" (ngModelChange)="pager.setSearch($event)" />
        <div class="seg" role="group" aria-label="Status">
          @for (f of filters; track f.key) {
            <button type="button" [class.active]="status() === f.key" [attr.aria-pressed]="status() === f.key" (click)="setStatus(f.key)">{{ f.label }}</button>
          }
        </div>
      </div>
      @if (categoryChips().length) {
        <div class="cat-chips" role="group" aria-label="Category">
          <span class="cat-label">Category</span>
          <button type="button" class="cat-chip" [class.is-on]="!category()" [attr.aria-pressed]="!category()" (click)="setCategory('')">All</button>
          @for (c of categoryChips(); track c.name) {
            <button type="button" class="cat-chip" [class.is-on]="category() === c.name" [attr.aria-pressed]="category() === c.name" (click)="setCategory(c.name)">
              {{ c.name }} <span class="cat-count">{{ c.count }}</span>
            </button>
          }
        </div>
      }

      <div class="table-responsive">
        <table class="table table-zed tech-table">
          <colgroup>
            <col style="width: 120px" />
            <col />
            <col style="width: 22%" />
            <col style="width: 16%" />
            <col style="width: 96px" />
            <col style="width: 190px" />
          </colgroup>
          <thead>
            <tr>
              <th class="text-center">Code</th>
              <th>Technology</th>
              <th>NIC Sectors</th>
              <th>Categories</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (t of pager.page(); track t.id) {
              <tr [class.is-off]="!t.isActive">
                <td class="text-center code-cell" data-label="Code"><span class="code-badge">{{ t.technologyCode }}</span></td>
                <td class="description" data-label="Technology">
                  <div class="tech-name">{{ t.technologyName }}</div>
                  @if (t.description) {
                    <div class="tech-desc" [class.clamp-3]="!expanded().has(t.id)" [title]="t.description">{{ t.description }}</div>
                    @if (t.description.length > 160) {
                      <button type="button" class="btn btn-link btn-sm p-0 more" (click)="toggle(t.id)">{{ expanded().has(t.id) ? 'less' : 'more' }}</button>
                    }
                  } @else {
                    <div class="tech-desc muted">No description</div>
                  }
                </td>
                <td data-label="NIC Sectors">
                  @for (s of t.sectors; track $index) { <span class="zed-chip" [title]="s">{{ s }}</span> } @empty { <span class="muted">—</span> }
                </td>
                <td data-label="Categories">
                  @for (c of t.categories; track $index) { <span class="zed-chip cat" [title]="c">{{ c }}</span> } @empty { <span class="muted">—</span> }
                </td>
                <td data-label="Status"><span class="status-badge" [class.is-active]="t.isActive" [class.is-inactive]="!t.isActive">{{ t.isActive ? 'Active' : 'Inactive' }}</span></td>
                <td data-label="Actions">
                  <div class="row-actions">
                    <a class="btn btn-outline-primary" [routerLink]="['/staff/masters/technologies', t.id]">Edit</a>
                    @if (t.isActive) {
                      <button type="button" class="btn btn-outline-danger" [disabled]="saving()" (click)="setActive(t, false)">Deactivate</button>
                    } @else {
                      <button type="button" class="btn btn-primary" [disabled]="saving()" (click)="setActive(t, true)">Activate</button>
                    }
                  </div>
                </td>
              </tr>
            } @empty {
              <tr class="empty-row"><td colspan="6" style="padding: 0"><div class="no-data">
                @if (pager.search() || status() !== 'all' || category()) { No technology matches the search or filter. }
                @else { No technologies yet. Add one with + Add New Technology. }
              </div></td></tr>
            }
          </tbody>
        </table>
      </div>
      <zed-pager [pager]="pager" />
    </div>
  `,
  styles: `
    .tech-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .stat { background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; padding: 12px 16px; display: flex; flex-direction: column; min-width: 0; }
    .stat-value { font-size: 24px; font-weight: 700; color: #23474a; line-height: 1.2; }
    .stat-on .stat-value { color: #1e7a3c; }
    .stat-label { font-size: 13px; color: #5f6f70; overflow-wrap: anywhere; }

    .list-card { padding: 16px; }
    .list-toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .list-toolbar .search { flex: 1 1 260px; max-width: 420px; }
    .seg { display: inline-flex; flex-wrap: wrap; border: 1px solid #cbd9da; border-radius: 8px; overflow: hidden; }
    .seg button { border: 0; background: #fff; color: #2f7c83; font-size: 13px; font-weight: 600; padding: 7px 14px; cursor: pointer; }
    .seg button + button { border-left: 1px solid #cbd9da; }
    .seg button:hover { background: #eef6f6; }
    .seg button.active { background: #45a5ad; color: #fff; }

    .cat-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 12px; }
    .cat-label { font-size: 12px; font-weight: 600; color: #5f6f70; margin-right: 4px; }
    .cat-chip { border: 1px solid #cbd9da; background: #fff; color: #3f3a7a; border-radius: 14px; padding: 2px 10px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .cat-chip:hover { border-color: #3f3a7a; background: #f1f0fb; }
    .cat-chip.is-on { background: #3f3a7a; border-color: #3f3a7a; color: #fff; }
    .cat-count { font-weight: 400; opacity: .8; margin-left: 2px; }

    .tech-table { table-layout: fixed; width: 100%; min-width: 900px; margin-bottom: 8px; }
    .tech-table td { vertical-align: top; overflow-wrap: anywhere; padding-top: 14px; padding-bottom: 14px; }
    .tech-table tbody tr:hover { background: #f7fbfb; }
    .tech-table tr.is-off .tech-name, .tech-table tr.is-off .code-badge { opacity: .65; }
    .code-badge { display: inline-flex; align-items: center; justify-content: center; min-height: 30px; padding: 3px 10px; border-radius: 15px; background: #eef6f6;
      color: #23474a; font-weight: 700; font-size: 13px; overflow-wrap: anywhere; }
    .tech-name { font-weight: 700; color: #232527; font-size: 15px; margin-bottom: 4px; }
    .description .tech-desc { white-space: pre-wrap; color: #5f6f70; font-size: 13.5px; line-height: 1.5; }
    .more { font-size: 13px; }
    .zed-chip.cat { background: #f1f0fb; color: #3f3a7a; }

    /* Phones: a card per technology. */
    @media (max-width: 767.98px) {
      .tech-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .list-toolbar .search { max-width: none; }
      .tech-table { min-width: 0; table-layout: auto; }
      .tech-table colgroup, .tech-table thead { display: none; }
      .tech-table, .tech-table tbody, .tech-table tr, .tech-table td { display: block; width: 100%; box-sizing: border-box; }
      .tech-table tr { border: 1px solid #dfe9ea; border-radius: 12px; margin-bottom: 12px; padding: 4px 12px; }
      .tech-table tr.empty-row { border: 0; padding: 0; }
      .tech-table td { border: 0; padding: 6px 0; text-align: left !important; }
      .tech-table td[data-label]::before { content: attr(data-label); display: block; font-size: 12px; font-weight: 600; color: #5f6f70; margin-bottom: 2px; }
      .tech-table td.code-cell::before, .tech-table td.description::before { display: none; }
    }
  `,
})
export class TechnologiesPage {
  private readonly api = inject(MastersApi);

  /** Every technology; the pager holds those the status and category filters let through. */
  private readonly rows = signal<Technology[]>([]);
  protected readonly filters: readonly { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'inactive', label: 'Inactive' },
  ];
  protected readonly status = signal<StatusFilter>('all');
  /** The category chip picked ('' = all). */
  protected readonly category = signal('');
  protected readonly stats = computed(() => {
    const rows = this.rows();
    const active = rows.filter((t) => t.isActive).length;
    return { total: rows.length, active, inactive: rows.length - active };
  });
  /** The categories the technologies use, with how many use each. */
  protected readonly categoryChips = computed(() => {
    const counts = new Map<string, number>();
    for (const t of this.rows()) for (const c of t.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  });
  protected readonly pager = new ClientPager<Technology>(10);
  protected readonly expanded = signal<ReadonlySet<number>>(new Set());
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');

  constructor() {
    const message = (globalThis.history?.state as { message?: unknown } | null)?.message;
    if (typeof message === 'string') this.success.set(message);
    void this.load();
  }

  protected async load(): Promise<void> {
    try {
      this.rows.set(await firstValueFrom(this.api.technologies()));
      this.pager.refresh(this.filtered());
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }

  private filtered(): Technology[] {
    const status = this.status();
    const category = this.category();
    return this.rows().filter((t) => (status === 'all' || t.isActive === (status === 'active')) && (!category || t.categories.includes(category)));
  }

  protected setStatus(f: StatusFilter): void {
    this.status.set(f);
    this.pager.set(this.filtered());
  }

  protected setCategory(name: string): void {
    this.category.set(name);
    this.pager.set(this.filtered());
  }

  protected toggle(id: number): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  protected async setActive(t: Technology, active: boolean): Promise<void> {
    if (!active && !window.confirm('Are you sure that you want to de-activate this technology?')) return;
    this.saving.set(true);
    this.error.set('');
    this.success.set('');
    try {
      this.success.set((await firstValueFrom(this.api.setTechnologyActive(t.id, active))).message);
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
