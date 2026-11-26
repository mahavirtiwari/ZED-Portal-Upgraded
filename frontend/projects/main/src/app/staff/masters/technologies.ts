import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ClientPager, PagerComponent } from '../pager';
import { ExcelToolsComponent } from '../excel-tools';
import { MastersApi, Technology } from './masters.api';
import { ConfirmService } from '../confirm-dialog';
import { TextPipe, t } from '../../content/page-text';

/** Which technologies the list shows (the buttons beside the search box). */
type StatusFilter = 'all' | 'active' | 'inactive';

/**
 * Technologies (Admin). Port of Views/Technology/List.cshtml: list, edit link, activate / deactivate. V4: search, pages,
 * a status column, and long descriptions folded to three lines. V4 layout: counts at the top, an active / inactive filter
 * and a category filter (shows only that category), the description under the technology's name, and a card
 * per technology on phones.
 */
@Component({
  selector: 'zed-staff-technologies',
  imports: [FormsModule, PagerComponent, RouterLink, ExcelToolsComponent, TextPipe],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ 'Technologies' | t: 'staff.technologies.title' }}</h3>
        <p class="page-sub">{{ 'Technologies the MSMEs can choose under Technology Upgradation, with their NIC sectors and categories.' | t: 'staff.technologies.sub' }}</p>
      </div>
      <div class="page-actions">
        <zed-excel-tools api="/api/staff/masters/technologies" [title]="'Technologies' | t: 'staff.technologies.excel.title'" fileName="technologies" (applied)="load()" />
        <a routerLink="/staff/masters/technologies/new" class="btn btn-primary">{{ '+ Add New Technology' | t: 'staff.technologies.add.button' }}</a>
      </div>
    </div>

    <div class="tech-stats">
      <div class="stat"><span class="stat-value">{{ stats().total }}</span><span class="stat-label">{{ 'Technologies' | t: 'staff.technologies.count.total' }}</span></div>
      <div class="stat stat-on"><span class="stat-value">{{ stats().active }}</span><span class="stat-label">{{ 'Active (MSMEs can choose them)' | t: 'staff.technologies.count.active' }}</span></div>
      <div class="stat"><span class="stat-value">{{ stats().inactive }}</span><span class="stat-label">{{ 'Inactive' | t: 'staff.technologies.count.inactive' }}</span></div>
      <div class="stat"><span class="stat-value">{{ categoryChips().length }}</span><span class="stat-label">{{ 'Categories in use' | t: 'staff.technologies.count.categories' }}</span></div>
    </div>

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    <div class="zed-card list-card">
      <div class="list-toolbar">
        <input type="search" class="form-control search" [placeholder]="'Search code, name, sector or category' | t: 'staff.technologies.search.placeholder'"
               [attr.aria-label]="'Search technologies' | t: 'staff.technologies.search.aria'"
               [ngModel]="pager.search()" (ngModelChange)="pager.setSearch($event)" />
        @if (categoryChips().length) {
          <label class="cat-filter">
            <span class="cat-label">{{ 'Category' | t: 'staff.technologies.category.label' }}</span>
            <select class="form-select" [attr.aria-label]="'Category' | t: 'staff.technologies.category.label'" [ngModel]="category()" (ngModelChange)="setCategory($event)">
              <option value="">{{ 'All categories' | t: 'staff.technologies.category.all.option' }}</option>
              @for (c of categoryChips(); track c.name) {
                <option [value]="c.name">{{ c.name }} ({{ c.count }})</option>
              }
            </select>
          </label>
        }
        <div class="seg" role="group" [attr.aria-label]="'Status' | t: 'staff.technologies.filter.aria'">
          @for (f of filters(); track f.key) {
            <button type="button" [class.active]="status() === f.key" [attr.aria-pressed]="status() === f.key" (click)="setStatus(f.key)">{{ f.label }}</button>
          }
        </div>
      </div>

      <div class="table-responsive">
        <table class="table table-zed tech-table">
          <colgroup>
            <col style="width: 92px" />
            <col />
            <col style="width: 17%" />
            <col style="width: 13%" />
            <col style="width: 104px" />
            <col style="width: 200px" />
          </colgroup>
          <thead>
            <tr>
              <th class="text-center">{{ 'Code' | t: 'staff.technologies.column.code' }}</th>
              <th>{{ 'Technology' | t: 'staff.technologies.column.technology' }}</th>
              <th>{{ 'NIC Sectors' | t: 'staff.technologies.column.sectors' }}</th>
              <th>{{ 'Categories' | t: 'staff.technologies.column.categories' }}</th>
              <th>{{ 'Status' | t: 'staff.technologies.column.status' }}</th>
              <th>{{ 'Actions' | t: 'staff.technologies.column.actions' }}</th>
            </tr>
          </thead>
          <tbody>
            @for (tech of pager.page(); track tech.id) {
              <tr [class.is-off]="!tech.isActive">
                <td class="text-center code-cell" [attr.data-label]="'Code' | t: 'staff.technologies.column.code'"><span class="code-badge">{{ tech.technologyCode }}</span></td>
                <td class="description" [attr.data-label]="'Technology' | t: 'staff.technologies.column.technology'">
                  <div class="tech-name">{{ tech.technologyName }}</div>
                  @if (tech.description) {
                    <div class="tech-desc" [class.clamp-3]="!expanded().has(tech.id)" [title]="tech.description">{{ tech.description }}</div>
                    @if (tech.description.length > 160) {
                      <button type="button" class="btn btn-link btn-sm p-0 more" (click)="toggle(tech.id)">{{ expanded().has(tech.id) ? ('less' | t: 'staff.technologies.row.less.button') : ('more' | t: 'staff.technologies.row.more.button') }}</button>
                    }
                  } @else {
                    <div class="tech-desc muted">{{ 'No description' | t: 'staff.technologies.row.noDescription.text' }}</div>
                  }
                </td>
                <td [attr.data-label]="'NIC Sectors' | t: 'staff.technologies.column.sectors'">
                  @for (s of tech.sectors; track $index) { <span class="zed-chip" [title]="s">{{ s }}</span> } @empty { <span class="muted">—</span> }
                </td>
                <td [attr.data-label]="'Categories' | t: 'staff.technologies.column.categories'">
                  @for (c of tech.categories; track $index) { <span class="zed-chip cat" [title]="c">{{ c }}</span> } @empty { <span class="muted">—</span> }
                </td>
                <td class="status-cell" [attr.data-label]="'Status' | t: 'staff.technologies.column.status'"><span class="status-badge" [class.is-active]="tech.isActive" [class.is-inactive]="!tech.isActive">{{ tech.isActive ? ('Active' | t: 'staff.technologies.row.active.status') : ('Inactive' | t: 'staff.technologies.row.inactive.status') }}</span></td>
                <td class="actions-cell" [attr.data-label]="'Actions' | t: 'staff.technologies.column.actions'">
                  <div class="row-actions">
                    <a class="btn btn-outline-primary" [routerLink]="['/staff/masters/technologies', tech.id]">{{ 'Edit' | t: 'staff.technologies.row.edit.link' }}</a>
                    @if (tech.isActive) {
                      <button type="button" class="btn btn-outline-danger" [disabled]="saving()" (click)="setActive(tech, false)">{{ 'Deactivate' | t: 'staff.technologies.row.deactivate.button' }}</button>
                    } @else {
                      <button type="button" class="btn btn-primary" [disabled]="saving()" (click)="setActive(tech, true)">{{ 'Activate' | t: 'staff.technologies.row.activate.button' }}</button>
                    }
                  </div>
                </td>
              </tr>
            } @empty {
              <tr class="empty-row"><td colspan="6" style="padding: 0"><div class="no-data">
                @if (pager.search() || status() !== 'all' || category()) { {{ 'No technology matches the search or filter.' | t: 'staff.technologies.noMatch.empty' }} }
                @else { {{ 'No technologies yet. Add one with + Add New Technology.' | t: 'staff.technologies.empty' }} }
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
    .stat-label { font-size: 13px; color: #5f6f70; overflow-wrap: break-word; }

    .list-card { padding: 16px; }
    .list-toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .list-toolbar .search { flex: 1 1 260px; max-width: 420px; }
    .list-toolbar .seg { margin-left: auto; }

    /* 2026-11-15 (the user): the category is a filter beside the search, not a row of chips. */
    .cat-filter { display: flex; align-items: center; gap: 8px; margin: 0; flex: 0 1 300px; }
    .cat-label { font-size: 13px; font-weight: 600; color: #5f6f70; white-space: nowrap; }
    .cat-filter .form-select { min-width: 0; }
    .cat-count { font-weight: 400; opacity: .8; margin-left: 2px; }

    .tech-table { table-layout: fixed; width: 100%; min-width: 900px; margin-bottom: 8px; }
    .tech-table td { vertical-align: top; overflow-wrap: break-word; padding-top: 14px; padding-bottom: 14px; }
    .tech-table .status-cell .status-badge { white-space: nowrap; overflow-wrap: normal; }
    .tech-table .actions-cell .row-actions { flex-direction: row; flex-wrap: nowrap; align-items: center; gap: 6px; }
    .tech-table .zed-chip { max-width: 100%; vertical-align: middle; white-space: normal; overflow-wrap: break-word; }
    .tech-table tbody tr:hover { background: var(--zt-pale, #f7fbfb); }
    .tech-table tr.is-off .tech-name, .tech-table tr.is-off .code-badge { opacity: .65; }
    .code-badge { display: inline-flex; align-items: center; justify-content: center; min-height: 30px; padding: 3px 10px; border-radius: 15px; background: #eef6f6;
      color: #23474a; font-weight: 700; font-size: 13px; overflow-wrap: break-word; max-width: 100%; }
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
      .tech-table .actions-cell .row-actions { justify-content: flex-start; flex-wrap: wrap; }
      .list-toolbar .seg { margin-left: 0; }
    }
  `,
})
export class TechnologiesPage {
  private readonly api = inject(MastersApi);
  private readonly confirms = inject(ConfirmService);

  /** Every technology; the pager holds those the status and category filters let through. */
  private readonly rows = signal<Technology[]>([]);
  protected readonly filters = computed((): readonly { key: StatusFilter; label: string }[] => [
    { key: 'all', label: t('staff.technologies.filter.all', 'All') },
    { key: 'active', label: t('staff.technologies.filter.active', 'Active') },
    { key: 'inactive', label: t('staff.technologies.filter.inactive', 'Inactive') },
  ]);
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
      // The codes in number order (1, 2, … 10), not as text.
      this.rows.set([...(await firstValueFrom(this.api.technologies()))].sort((a, b) => a.technologyCode.localeCompare(b.technologyCode, undefined, { numeric: true })));
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

  protected async setActive(tech: Technology, active: boolean): Promise<void> {
    if (!active && !(await this.confirms.ask({
      title: t('staff.technologies.deactivate.title', 'Deactivate the Technology?'),
      message: tech.technologyName ? t('staff.technologies.deactivate.message', '{name} is no longer offered to MSMEs.', { name: tech.technologyName })
        : t('staff.technologies.deactivate.unnamed.message', 'This technology is no longer offered to MSMEs.'),
      confirmLabel: t('staff.technologies.deactivate.button', 'Deactivate'), danger: true,
    }))) return;
    this.saving.set(true);
    this.error.set('');
    this.success.set('');
    try {
      this.success.set((await firstValueFrom(this.api.setTechnologyActive(tech.id, active))).message);
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
