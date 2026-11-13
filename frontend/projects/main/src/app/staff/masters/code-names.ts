import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ClientPager, PagerComponent } from '../pager';
import { ExcelToolsComponent } from '../excel-tools';
import { AdminPortal, AdminPortalService } from '../admin-portal';
import { CodeName, CodeNameKind, MastersApi, SECTOR_ACTIVITIES, SectorActivity } from './masters.api';

const LABELS: Record<CodeNameKind, { title: string; one: string; sub: string }> = {
  sectors: { title: 'Sectors', one: 'Sector', sub: 'NIC sectors used to classify the MSMEs and the technologies.' },
  categories: { title: 'Categories', one: 'Category', sub: 'Categories the technologies are grouped under.' },
};

/** The one-line explanation of each sector type on its choice card. */
const ACTIVITY_NOTES: Record<SectorActivity, string> = {
  Manufacturing: 'Makes or processes goods',
  Services: 'Provides services',
};

/** Which sectors the list shows (the buttons beside the search box). */
type SectorFilter = 'all' | SectorActivity | 'unset';

/** V4 one Admin: the portals whose sector list the main Admin keeps the same as main's. */
type OtherPortal = Exclude<AdminPortal, 'main'>;
const OTHER_PORTALS: readonly { key: OtherPortal; name: string }[] = [
  { key: 'consultancy', name: 'Consultancy' },
  { key: 'surveillance', name: 'Surveillance' },
];

/** A sector on another portal: the same as main's, different (name or type), missing, or not known (portal not reached). */
type PortalState = 'same' | 'differs' | 'missing' | 'unknown';

interface OtherList {
  rows: CodeName[] | null;
  error: string;
}

/**
 * NIC sectors and categories (Admin). Port of Views/Sector/List.cshtml and Views/Category/List.cshtml
 * (same page; the route's `data.kind` picks the list): add a code and name, rename in a pop-up. Sectors also say whether
 * they are Manufacturing or Services (V4, required). V4 layout: for sectors the counts (all, Manufacturing, Services,
 * type not set) and a filter by type beside the search; the code as a badge; add and edit in pop-ups, the sector type
 * as choice cards; a card per row on phones.
 * <p>One Admin (V4, main portal): the sector list is kept the same on the three portals. The list says, per sector,
 * whether the Consultancy and Surveillance portals have it (and with the same name and type); an add or edit here is
 * saved on them too, through their own APIs; "Make all portals the same" adds or corrects what differs. Nothing is
 * deleted on another portal; sectors only another portal has are named above the list.</p>
 */
@Component({
  selector: 'zed-staff-code-names',
  imports: [FormsModule, PagerComponent, ExcelToolsComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ labels.title }}</h3>
        <p class="page-sub">{{ labels.sub }}</p>
      </div>
      <div class="page-actions">
        <zed-excel-tools [api]="'/api/staff/masters/' + kind" [title]="labels.title" [fileName]="kind" (applied)="load(true)" />
        <button type="button" class="btn btn-primary" (click)="openAdd()">+ ADD {{ labels.one.toUpperCase() }}</button>
      </div>
    </div>

    @if (isSectors) {
      <div class="cn-stats">
        <div class="stat"><span class="stat-value">{{ stats().total }}</span><span class="stat-label">Sectors</span></div>
        <div class="stat"><span class="stat-value">{{ stats().manufacturing }}</span><span class="stat-label">Manufacturing</span></div>
        <div class="stat"><span class="stat-value">{{ stats().services }}</span><span class="stat-label">Services</span></div>
        <div class="stat" [class.stat-warn]="stats().unset > 0"><span class="stat-value">{{ stats().unset }}</span><span class="stat-label">Type not set</span></div>
      </div>
    }

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (syncing()) {
      @for (o of otherPortals; track o.key) {
        @if (others()[o.key].error; as e) { <div class="alert alert-warning" role="status">{{ o.name }} portal: {{ e }}</div> }
      }
      @if (outOfStep() > 0) {
        <div class="alert alert-info sync-bar" role="status">
          <span><strong>{{ outOfStep() }}</strong> {{ outOfStep() === 1 ? 'sector is' : 'sectors are' }} missing or different on the other portals.</span>
          <button type="button" class="btn btn-primary btn-sm" [disabled]="saving()" (click)="syncAll()">MAKE ALL PORTALS THE SAME</button>
        </div>
      }
      @for (o of otherPortals; track o.key) {
        @if (onlyOn(o.key); as only) {
          @if (only.length) { <p class="only-on">Only on the {{ o.name }} portal (kept there): {{ only.join(', ') }}</p> }
        }
      }
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    <div class="zed-card list-card">
      <div class="list-toolbar">
        <input type="search" class="form-control search" placeholder="Search code or name" [attr.aria-label]="'Search ' + labels.title.toLowerCase()"
               [ngModel]="pager.search()" (ngModelChange)="pager.setSearch($event)" />
        @if (isSectors) {
          <div class="seg" role="group" aria-label="Sector type">
            @for (f of filters(); track f.key) {
              <button type="button" [class.active]="filter() === f.key" [attr.aria-pressed]="filter() === f.key" (click)="setFilter(f.key)">{{ f.label }}</button>
            }
          </div>
        } @else {
          <span class="zed-chip">{{ rows().length }} {{ rows().length === 1 ? labels.one.toLowerCase() : labels.title.toLowerCase() }}</span>
        }
      </div>
      <div class="table-responsive">
        <table class="table table-zed cn-table">
          <thead>
            <tr>
              <th class="text-center" style="width: 140px">{{ labels.one }} Code</th>
              <th>{{ labels.one }} Name</th>
              @if (isSectors) { <th style="width: 170px">Sector Type</th> }
              @if (syncing()) { <th style="width: 210px">Other portals</th> }
              <th class="text-center" style="width: 110px">Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (s of pager.page(); track s.id) {
              <tr>
                <td class="text-center code-cell"><span class="code-badge">{{ s.code }}</span></td>
                <td class="name-cell"><strong>{{ s.name }}</strong></td>
                @if (isSectors) {
                  <td class="type-cell">
                    @if (s.activity) { <span class="activity-badge" [class.services]="s.activity === 'Services'">{{ s.activity }}</span> }
                    @else { <span class="activity-badge unset">Not set</span> }
                  </td>
                }
                @if (syncing()) {
                  <td class="portals-cell">
                    @for (o of otherPortals; track o.key) {
                      @switch (stateOf(s, o.key)) {
                        @case ('same') { <span class="pchip ok">{{ o.name }} ✓</span> }
                        @case ('differs') { <span class="pchip warn" title="Different name or type there">{{ o.name }}: differs</span> }
                        @case ('missing') { <span class="pchip miss">{{ o.name }}: missing</span> }
                        @default { <span class="pchip">{{ o.name }}: ?</span> }
                      }
                    }
                  </td>
                }
                <td class="actions-cell">
                  <div class="row-actions justify-content-center">
                    <button type="button" class="btn btn-outline-primary" [attr.aria-label]="'Edit ' + s.code" (click)="edit(s)">Edit</button>
                  </div>
                </td>
              </tr>
            } @empty {
              <tr class="empty-row"><td [attr.colspan]="(isSectors ? 4 : 3) + (syncing() ? 1 : 0)" style="padding: 0"><div class="no-data">{{ emptyText() }}</div></td></tr>
            }
          </tbody>
        </table>
      </div>
      <zed-pager [pager]="pager" />
    </div>

    @if (adding()) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="add-title">
        <div class="modal-dialog modal-popup">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="add-title">Add {{ labels.one }}</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="adding.set(false)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <form class="add-form" (ngSubmit)="add()" novalidate>
              <div class="modal-body">
                <div class="form-grid">
                  <label for="code">{{ labels.one }} Code<span class="req">*</span></label>
                  <div>
                    <input id="code" name="code" class="form-control code-input" maxlength="50" [(ngModel)]="code" />
                    @if (submitted() && !code.trim()) { <span class="help-block">{{ labels.one }} Code required.</span> }
                    @else { <small class="muted d-block mt-1">The code cannot be changed later.</small> }
                  </div>
                  <label for="name">{{ labels.one }} Name<span class="req">*</span></label>
                  <div>
                    <input id="name" name="name" class="form-control" maxlength="200" [(ngModel)]="name" />
                    @if (submitted() && !name.trim()) { <span class="help-block">{{ labels.one }} Name required.</span> }
                  </div>
                  @if (isSectors) {
                    <span class="label-like top" id="activity-label">Sector Type<span class="req">*</span></span>
                    <div>
                      <div class="activity-choice" role="radiogroup" aria-labelledby="activity-label">
                        @for (a of activities; track a) {
                          <label class="choice-card" [class.active]="activity === a"><input type="radio" class="form-check-input" name="activity" [value]="a" [(ngModel)]="activity" />
                            <span><strong>{{ a }}</strong> <small class="muted d-block">{{ notes[a] }}</small></span></label>
                        }
                      </div>
                      @if (submitted() && !activity) { <span class="help-block">Please select Manufacturing or Services.</span> }
                    </div>
                  }
                </div>
                @if (addError()) { <span class="help-block d-block mt-2" role="alert">{{ addError() }}</span> }
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" (click)="adding.set(false)">CANCEL</button>
                <button type="submit" class="btn btn-primary" [disabled]="saving()">SAVE</button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <div class="modal-dialog modal-popup">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="edit-title">Edit {{ labels.one }}</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="editing.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <form (ngSubmit)="update()" novalidate>
              <div class="modal-body">
                <div class="form-grid">
                  <span class="label-like">{{ labels.one }} Code</span>
                  <span><span class="code-badge">{{ e.code }}</span> <small class="muted ms-1">Cannot be changed</small></span>
                  <label for="edit-name">{{ labels.one }} Name<span class="req">*</span></label>
                  <input id="edit-name" name="editName" class="form-control" maxlength="200" [(ngModel)]="e.name" />
                  @if (isSectors) {
                    <span class="label-like top" id="edit-activity-label">Sector Type<span class="req">*</span></span>
                    <div class="activity-choice" role="radiogroup" aria-labelledby="edit-activity-label">
                      @for (a of activities; track a) {
                        <label class="choice-card" [class.active]="e.activity === a"><input type="radio" class="form-check-input" name="editActivity" [value]="a" [(ngModel)]="e.activity" />
                          <span><strong>{{ a }}</strong> <small class="muted d-block">{{ notes[a] }}</small></span></label>
                      }
                    </div>
                  }
                </div>
                @if (editError()) { <span class="help-block d-block mt-2" role="alert">{{ editError() }}</span> }
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" (click)="editing.set(null)">CANCEL</button>
                <button type="submit" class="btn btn-primary" [disabled]="saving()">UPDATE</button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
  `,
  styles: `
    .page-head { align-items: flex-end; }
    .help-block { color: #a94442; font-size: 13px; }
    .label-like { font-weight: 600; color: #3b4b4c; font-size: 14px; align-self: center; }
    .label-like.top { align-self: start; padding-top: 10px; }

    /* The counts (sectors). */
    .cn-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .stat { background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; padding: 12px 16px; display: flex; flex-direction: column; min-width: 0; }
    .stat-value { font-size: 24px; font-weight: 700; color: #23474a; line-height: 1.2; }
    .stat-label { font-size: 13px; color: #5f6f70; }
    .stat.stat-warn { background: #fff4d6; border-color: #f3e1a6; }
    .sync-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
    .only-on { font-size: 13px; color: #5f6f70; margin: -4px 0 12px; }
    .portals-cell { white-space: normal; }
    .pchip { display: inline-block; font-size: 11.5px; font-weight: 700; border-radius: 10px; padding: 1px 8px; margin: 2px 4px 2px 0; background: #f2f4f4; color: #5f6f70; }
    .pchip.ok { background: #e6f6ec; color: #1e7a3c; } .pchip.warn { background: #fff4d6; color: #8a6100; } .pchip.miss { background: #fdeef0; color: #a8303a; }
    .stat.stat-warn .stat-value, .stat.stat-warn .stat-label { color: #8a6100; }

    .list-card { padding: 16px; }
    .list-toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .list-toolbar .search { flex: 1 1 260px; max-width: 420px; }
    .seg { display: inline-flex; flex-wrap: wrap; border: 1px solid #cbd9da; border-radius: 8px; overflow: hidden; }
    .seg button { border: 0; background: #d9eef0; color: #174a4e; font-size: 13px; font-weight: 600; padding: 7px 14px; cursor: pointer; }
    .seg button + button { border-left: 1px solid #cbd9da; }
    .seg button:hover { background: #c5e5e8; }
    .seg button.active { background: #23656b; color: #fff; }

    .cn-table { width: 100%; margin-bottom: 8px; }
    .cn-table td { vertical-align: middle; overflow-wrap: anywhere; }
    .cn-table tbody tr:hover { background: #f7fbfb; }
    .name-cell strong { color: #232527; font-weight: 600; }
    .code-badge {
      display: inline-flex; align-items: center; justify-content: center; min-width: 36px; height: 30px; padding: 0 10px; border-radius: 15px;
      background: #eef6f6; color: #23474a; font-weight: 700; font-size: 14px;
    }
    .activity-badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 13px; font-weight: 600; background: #e3f1f2; color: #23474a; }
    .activity-badge.services { background: #f1f0fb; color: #3f3a7a; }
    .activity-badge.unset { background: #fff4d6; color: #8a6100; }

    .activity-choice { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .choice-card { display: flex; gap: 10px; align-items: flex-start; border: 1px solid #dfe9ea; border-radius: 10px; padding: 10px 12px; margin: 0; cursor: pointer; }
    .choice-card.active { border-color: #45a5ad; background: #f4fafa; }
    /* The skin makes pop-up labels bold; on these cards only the option's name is. */
    .modal .modal-popup label.choice-card { font-weight: 400; color: #232527; }
    .choice-card .form-check-input { flex: none; margin: 3px 0 0; float: none; }
    .choice-card strong { color: #23474a; }

    /* Phones: a card per row. */
    @media (max-width: 767.98px) {
      .cn-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .list-toolbar .search { max-width: none; flex-basis: 100%; }
      .cn-table thead { display: none; }
      .cn-table, .cn-table tbody { display: block; width: 100%; }
      .cn-table tr { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 4px 10px; align-items: center;
        border: 1px solid #dfe9ea; border-radius: 12px; margin-bottom: 10px; padding: 10px 12px; }
      .cn-table tr.empty-row { display: block; border: 0; padding: 0; }
      .cn-table td { display: block; border: 0; padding: 0; text-align: left !important; }
      .cn-table tr:has(.type-cell) .code-cell { grid-row: span 2; }
      .cn-table .code-badge { min-width: 48px; }
      .cn-table .type-cell { grid-column: 2; }
      .cn-table .actions-cell { grid-column: 3; grid-row: 1 / span 2; }
      .activity-choice { grid-template-columns: minmax(0, 1fr); }
    }
  `,
})
export class CodeNamesPage {
  private readonly api = inject(MastersApi);
  private readonly portals = inject(AdminPortalService);

  protected readonly kind: CodeNameKind = inject(ActivatedRoute).snapshot.data['kind'] === 'categories' ? 'categories' : 'sectors';
  protected readonly labels = LABELS[this.kind];
  protected readonly isSectors = this.kind === 'sectors';
  protected readonly activities = SECTOR_ACTIVITIES;
  protected readonly notes = ACTIVITY_NOTES;
  /** Every row; the pager holds those the sector type filter lets through. */
  protected readonly rows = signal<CodeName[]>([]);
  protected readonly filter = signal<SectorFilter>('all');
  protected readonly stats = computed(() => {
    const rows = this.rows();
    return {
      total: rows.length,
      manufacturing: rows.filter((r) => r.activity === 'Manufacturing').length,
      services: rows.filter((r) => r.activity === 'Services').length,
      unset: rows.filter((r) => !r.activity).length,
    };
  });
  /** "Not set" is offered only while some sector has no type. */
  protected readonly filters = computed(() => {
    const list: { key: SectorFilter; label: string }[] = [{ key: 'all', label: 'All' }, ...SECTOR_ACTIVITIES.map((a) => ({ key: a, label: a }))];
    if (this.stats().unset || this.filter() === 'unset') list.push({ key: 'unset', label: 'Not set' });
    return list;
  });
  protected readonly pager = new ClientPager<CodeName>(10);
  protected readonly adding = signal(false);
  protected readonly editing = signal<CodeName | null>(null);
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly addError = signal('');
  protected readonly editError = signal('');
  protected readonly success = signal('');
  protected code = '';
  protected name = '';
  protected activity: SectorActivity | null = null;

  /** One Admin: the sectors are kept the same on the other portals (main portal's sectors page only). */
  protected readonly syncing = signal(this.isSectors && this.portals.enabled);
  protected readonly otherPortals = OTHER_PORTALS;
  protected readonly others = signal<Record<OtherPortal, OtherList>>({ consultancy: { rows: null, error: '' }, surveillance: { rows: null, error: '' } });
  /** Main's sectors that some other portal lacks or has differently. */
  protected readonly outOfStep = computed(() =>
    this.rows().filter((r) => OTHER_PORTALS.some((o) => ['differs', 'missing'].includes(this.stateOf(r, o.key)))).length);

  constructor() {
    void this.load(true);
  }

  protected emptyText(): string {
    if (this.pager.search() || this.filter() !== 'all') return 'No ' + this.labels.one.toLowerCase() + ' matches the search';
    return this.rows().length ? 'No Data' : 'No ' + this.labels.title.toLowerCase() + ' yet. Use + Add ' + this.labels.one + ' to add the first one.';
  }

  protected setFilter(f: SectorFilter): void {
    this.filter.set(f);
    this.pager.set(this.filtered());
  }

  private filtered(): CodeName[] {
    const f = this.filter();
    const rows = this.rows();
    if (f === 'all') return rows;
    return rows.filter((r) => (f === 'unset' ? !r.activity : r.activity === f));
  }

  /** <paramref name="fresh"/>: page 1; otherwise (after a save) the same page. */
  protected async load(fresh = false): Promise<void> {
    const others = this.loadOthers();
    try {
      this.rows.set(await firstValueFrom(this.api.list(this.kind)));
      if (fresh) this.pager.set(this.filtered());
      else this.pager.refresh(this.filtered());
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
    await others;
  }

  /** The other portals' sector lists (a portal that cannot be reached is named, the rest still works). */
  private async loadOthers(): Promise<void> {
    if (!this.syncing()) return;
    const loaded = await Promise.all(OTHER_PORTALS.map(async (o): Promise<[OtherPortal, OtherList]> => {
      try {
        return [o.key, { rows: await firstValueFrom(this.api.list('sectors', o.key)), error: '' }];
      } catch (err) {
        return [o.key, { rows: null, error: apiErrorMessage(err) }];
      }
    }));
    this.others.set(Object.fromEntries(loaded) as Record<OtherPortal, OtherList>);
  }

  private find(portal: OtherPortal, code: string): CodeName | undefined {
    return this.others()[portal].rows?.find((r) => r.code.trim().toLowerCase() === code.trim().toLowerCase());
  }

  protected stateOf(row: CodeName, portal: OtherPortal): PortalState {
    if (!this.others()[portal].rows) return 'unknown';
    const there = this.find(portal, row.code);
    if (!there) return 'missing';
    return there.name.trim() === row.name.trim() && (there.activity ?? null) === (row.activity ?? null) ? 'same' : 'differs';
  }

  /** Codes another portal has that main does not. */
  protected onlyOn(portal: OtherPortal): string[] {
    const mine = new Set(this.rows().map((r) => r.code.trim().toLowerCase()));
    return (this.others()[portal].rows ?? []).filter((r) => !mine.has(r.code.trim().toLowerCase())).map((r) => r.code.trim());
  }

  /** Saves main's sector on the other portals that lack it or differ; returns what failed ("Consultancy: ..."). */
  private async pushToOthers(code: string, name: string, activity: SectorActivity | null): Promise<string[]> {
    if (!this.syncing() || !activity) return [];
    const failed: string[] = [];
    for (const o of OTHER_PORTALS) {
      if (!this.others()[o.key].rows) {
        failed.push(`${o.name}: not reached`);
        continue;
      }
      const there = this.find(o.key, code);
      if (there && there.name.trim() === name && there.activity === activity) continue;
      try {
        await firstValueFrom(there ? this.api.rename('sectors', there.id, name, activity, o.key) : this.api.add('sectors', code, name, activity, o.key));
      } catch (err) {
        failed.push(`${o.name}: ${apiErrorMessage(err)}`);
      }
    }
    return failed;
  }

  private withOthers(message: string, failed: string[]): string {
    if (!this.syncing()) return message;
    return failed.length ? `${message} Not saved on every portal: ${failed.join('; ')}` : `${message} Saved on all three portals.`;
  }

  /** Adds or corrects, on the other portals, every sector of main's list that is missing or different there. */
  protected async syncAll(): Promise<void> {
    this.error.set('');
    this.success.set('');
    this.saving.set(true);
    const failed: string[] = [];
    let done = 0;
    try {
      for (const row of this.rows()) {
        if (!OTHER_PORTALS.some((o) => ['differs', 'missing'].includes(this.stateOf(row, o.key)))) continue;
        if (!row.activity) {
          failed.push(`${row.code}: set its type here first`);
          continue;
        }
        const f = await this.pushToOthers(row.code, row.name.trim(), row.activity);
        if (f.length) failed.push(...f.map((x) => `${row.code} ${x}`));
        else done++;
      }
      await this.loadOthers();
      if (failed.length) this.error.set(`${done} sector(s) made the same; not done: ${failed.join('; ')}`);
      else this.success.set(`${done} sector(s) made the same on all three portals.`);
    } finally {
      this.saving.set(false);
    }
  }

  protected openAdd(): void {
    this.code = this.name = '';
    this.activity = null;
    this.submitted.set(false);
    this.addError.set('');
    this.success.set('');
    this.adding.set(true);
  }

  protected async add(): Promise<void> {
    this.submitted.set(true);
    this.addError.set('');
    this.success.set('');
    if (!this.code.trim() || !this.name.trim() || (this.isSectors && !this.activity)) {
      this.addError.set('Please enter valid data.');
      return;
    }
    this.saving.set(true);
    try {
      const message = (await firstValueFrom(this.api.add(this.kind, this.code.trim(), this.name.trim(), this.activity))).message;
      this.success.set(this.withOthers(message, await this.pushToOthers(this.code.trim(), this.name.trim(), this.activity)));
      this.code = this.name = '';
      this.activity = null;
      this.submitted.set(false);
      this.adding.set(false);
      await this.load();
    } catch (err) {
      this.addError.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  protected edit(row: CodeName): void {
    this.editError.set('');
    this.success.set('');
    this.editing.set({ ...row });
  }

  protected async update(): Promise<void> {
    const e = this.editing();
    if (!e) return;
    if (!e.name.trim()) {
      this.editError.set('Enter the valid data.');
      return;
    }
    if (this.isSectors && !e.activity) {
      this.editError.set('Please select Manufacturing or Services.');
      return;
    }
    this.saving.set(true);
    try {
      const message = (await firstValueFrom(this.api.rename(this.kind, e.id, e.name.trim(), e.activity))).message;
      this.success.set(this.withOthers(message, await this.pushToOthers(e.code, e.name.trim(), e.activity ?? null)));
      this.editing.set(null);
      await this.load();
    } catch (err) {
      this.editError.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
