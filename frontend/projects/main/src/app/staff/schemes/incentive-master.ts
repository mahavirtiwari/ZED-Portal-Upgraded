import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest, firstValueFrom } from 'rxjs';
import { CatalogueItem, INCENTIVE_GROUPS, IncentiveGroup, IncentivesApi, STATES } from './incentives.api';
import { PagedView, PagerComponent } from '../pager';
import { ExcelToolsComponent } from '../excel-tools';

export const MAX_INCENTIVE_DOC_BYTES = 2 * 1024 * 1024;

type StatusFilter = 'all' | 'active' | 'inactive';
type LevelFilter = 'all' | 'bronze' | 'silver' | 'gold';

const LEVEL_FIELD: Record<Exclude<LevelFilter, 'all'>, string> = {
  bronze: 'ApplicableForBronze', silver: 'ApplicableForSilver', gold: 'ApplicableForGold',
};

/** The dashboard card that lists a group's incentives. */
export const GROUP_CARD: Record<IncentiveGroup['key'], string> = {
  ministry: 'Ministry of MSME', state: 'States/UTs', financial: 'Financial Institutions', others: 'Other Incentives',
};

/**
 * Incentive catalogue for the Admin role (shown on the public incentive pages), one page per group of the Incentives
 * menu: Ministry of MSME, State Government (a state is chosen on the page), Financial Institution and Others (V4, as the
 * LEAN portal's incentive pages; the old Views/Incentive/Index.cshtml had one page per type). Create New Incentive and
 * Edit open the incentive's own page (incentive-form.ts); the two PDF documents can also be attached in the list. V4
 * layout: a pill tab per group, the counts (all, active, inactive, on the main dashboard), search with a level and a
 * status filter, and each incentive as a card with its highlight, department, levels, where it appears and documents.
 */
@Component({
  selector: 'zed-staff-incentive-master',
  imports: [FormsModule, PagerComponent, RouterLink, ExcelToolsComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ group().title }}</h3>
        <p class="page-sub">{{ group().subtitle }}</p>
      </div>
      <div class="page-actions">
        <!-- Every group in one sheet (Type column). -->
        <zed-excel-tools api="/api/staff/schemes/incentive-master" title="Incentives" fileName="incentives" (applied)="load()" />
        @if (group().key !== 'state' || state()) {
          <a class="btn btn-primary" [routerLink]="['/staff/incentives', group().key, 'new']" [queryParams]="stateParams()">+ Create New Incentive</a>
        }
      </div>
    </div>

    <nav class="inc-groups" aria-label="Incentive groups">
      @for (g of groups; track g.key) {
        <a class="inc-group-tab" [class.active]="g.key === group().key" [attr.aria-current]="g.key === group().key ? 'page' : null"
           [routerLink]="['/staff/incentives', g.key]">{{ g.label }}</a>
      }
      <a class="inc-group-tab inc-group-cards" routerLink="/staff/incentives/dashboard-cards">Main Dashboard Cards</a>
    </nav>

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    @if (group().key === 'state') {
      <div class="zed-card state-pick">
        <label class="form-label m-0" for="inc-state">State / UT</label>
        <select class="form-select" id="inc-state" [ngModel]="state() ?? ''" (ngModelChange)="pickState($event)">
          <option value="">Select state</option>
          @for (s of states; track s.id) { <option [value]="s.name">{{ s.name }}</option> }
        </select>
      </div>
    }

    @if (group().key !== 'state' || state()) {
      <div class="inc-tiles">
        @for (t of tiles(); track t.label) {
          <div class="inc-tile" [class]="'tone-' + t.tone"><strong>{{ t.value }}</strong><span class="inc-tile-label">{{ t.label }}</span></div>
        }
      </div>

      <section class="zed-card inc-list" [attr.aria-label]="listTitle()">
        <div class="inc-list-head">
          <h5 class="m-0">{{ listTitle() }} <span class="zed-chip">{{ items().length }} incentive{{ items().length === 1 ? '' : 's' }}</span></h5>
          <input type="search" id="inc-search" class="form-control" maxlength="50" placeholder="Search name, department, contact or link"
                 aria-label="Search incentives" [ngModel]="search()" (ngModelChange)="search.set($event)" />
        </div>
        <div class="inc-list-tools">
          <div class="seg" role="group" aria-label="Level">
            @for (l of levelFilters; track l.value) {
              <button type="button" [attr.data-level]="l.value" [class.active]="level() === l.value" [attr.aria-pressed]="level() === l.value"
                      (click)="level.set(l.value)">
                @if (l.value !== 'all') { <i class="lv-dot" [class]="'lv-' + l.value"></i> }{{ l.label }} <span class="seg-count">{{ levelCount(l.value) }}</span>
              </button>
            }
          </div>
          <div class="seg" role="group" aria-label="Status">
            @for (f of filters; track f.value) {
              <button type="button" [attr.data-status]="f.value" [class.active]="status() === f.value" [attr.aria-pressed]="status() === f.value"
                      (click)="status.set(f.value)">{{ f.label }} <span class="seg-count">{{ statusCount(f.value) }}</span></button>
            }
          </div>
        </div>

        <div class="inc-grid">
          @for (item of view.page(); track item.incentive['Id']) {
            <article class="inc-card" [class.is-off]="!item.incentive['ActiveStatus']" [attr.aria-label]="item.incentive['Incentive']">
              <div class="inc-card-top">
                <span class="inc-avatar" aria-hidden="true">{{ initials(item) }}</span>
                <div class="inc-card-name">
                  <h6 class="inc-name">{{ item.incentive['Incentive'] }}</h6>
                  @if (item.incentive['MinistryOrDepartment']) {
                    <small class="muted d-block">{{ group().department }}: {{ item.incentive['MinistryOrDepartment'] }}</small>
                  }
                </div>
                <span class="status-badge" [class.is-active]="!!item.incentive['ActiveStatus']" [class.is-inactive]="!item.incentive['ActiveStatus']">
                  {{ item.incentive['ActiveStatus'] ? 'Active' : 'Inactive' }}
                </span>
              </div>

              @if (item.incentive['CardHighlight']) {
                <div class="inc-highlight">{{ item.incentive['CardHighlight'] }}</div>
              }
              @if (details(item); as d) {
                <div class="inc-details">
                  <div [class.clamp-3]="!expanded().has(id(item))" [title]="d">{{ d }}</div>
                  @if (d.length > 160) {
                    <button type="button" class="btn btn-link btn-sm p-0" (click)="toggle(id(item))">{{ expanded().has(id(item)) ? 'less' : 'more' }}</button>
                  }
                </div>
              }

              <div class="inc-tags">
                @for (l of levelsOf(item); track l) { <span class="lv-chip" [class]="'lv-' + l.toLowerCase()">{{ l }}</span> }
                @if (!levelsOf(item).length) { <span class="muted">No level</span> }
                <span class="inc-where" [class.on-dashboard]="item.incentive['DisplayOn'] === 'Dashboard'">
                  {{ item.incentive['DisplayOn'] === 'Dashboard' ? 'Main dashboard' : 'In the ' + groupCard() + ' card' }}
                </span>
              </div>

              <dl class="inc-facts">
                <div><dt>Contact</dt><dd>{{ item.incentive['ContactPerson'] || '—' }}
                  @if (item.incentive['MobileNo'] || item.incentive['Email']) {
                    <small class="muted d-block">{{ contactLine(item) }}</small>
                  }
                </dd></div>
                <div><dt>Links</dt><dd>
                  @if (httpLink(item.incentive['WebLink']); as link) {
                    <a [href]="link" target="_blank" rel="noopener noreferrer">Web link</a>
                  } @else { {{ item.incentive['WebLink'] || '—' }} }
                  @if (httpLink(item.incentive['VideoLink']); as video) {
                    · <a [href]="video" target="_blank" rel="noopener noreferrer">Video</a>
                  }
                </dd></div>
              </dl>

              <div class="inc-card-foot">
                <div class="inc-docs">
                  @for (n of [1, 2]; track n) {
                    <div class="doc-slot">
                      @if (n === 1 ? item.hasDocument1 : item.hasDocument2) {
                        <a class="doc-view" [href]="docUrl(item, n)" target="_blank" rel="noopener" [attr.aria-label]="'Document ' + n"><img src="Images/svgicons/pdf-icon.svg" alt="" height="22" /> Doc {{ n }}</a>
                      } @else {
                        <span class="doc-none">Doc {{ n }}</span>
                      }
                      <label class="doc-upload">
                        {{ (n === 1 ? item.hasDocument1 : item.hasDocument2) ? 'Replace' : 'Upload' }}
                        <input type="file" class="d-none" accept="application/pdf" (change)="uploadDoc(item, n === 1 ? 1 : 2, $event)" />
                      </label>
                    </div>
                  }
                </div>
                <a class="btn btn-outline-primary btn-sm inc-edit" [routerLink]="['/staff/incentives', group().key, id(item), 'edit']" [queryParams]="stateParams()">Edit</a>
              </div>
            </article>
          } @empty {
            @if (!busy()) {
              <div class="no-data">{{ items().length ? (search().trim() ? 'No incentive matches "' + search().trim() + '".' : 'No incentive matches this filter.') : 'Nothing here yet. Create the first incentive.' }}</div>
            }
          }
        </div>
        <zed-pager [pager]="view" />
      </section>
    } @else {
      <div class="zed-card no-data">Choose a state to see its incentives.</div>
    }
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    .page-head { align-items: center; }

    .inc-groups { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    .inc-group-tab { display: inline-flex; align-items: center; padding: 7px 18px; border-radius: 20px; border: 1px solid #d9eef0; background: #d9eef0;
      color: #174a4e; font-weight: 600; font-size: 14px; text-decoration: none; }
    .inc-group-tab:hover { background: #c5e5e8; border-color: #45a5ad; color: #2f7c83; }
    .inc-group-tab.active { background: #23656b; border-color: #23656b; color: #fff; }
    .inc-group-cards { margin-left: auto; border-style: dashed; }

    .state-pick { display: flex; align-items: center; gap: 12px; max-width: 520px; margin-bottom: 16px; }
    .state-pick .form-label { white-space: nowrap; }
    .state-pick .form-select { flex: 1 1 auto; min-width: 0; }

    .inc-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .inc-tile { background: #fff; border: 1px solid #dfe9ea; border-left: 4px solid #45a5ad; border-radius: 12px; padding: 12px 16px; display: flex; flex-direction: column; min-width: 0; }
    .inc-tile.tone-green { border-left-color: #2e9e5b; }
    .inc-tile.tone-grey { border-left-color: #b7c3c4; }
    .inc-tile.tone-violet { border-left-color: #3f3a7a; }
    .inc-tile strong { font-size: 24px; font-weight: 700; color: #23474a; line-height: 1.2; }
    .inc-tile-label { font-size: 13px; color: #5f6f70; overflow-wrap: anywhere; }

    .inc-list-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
    .inc-list-head .form-control { flex: 0 1 340px; min-width: 0; }
    .inc-list-tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; }
    .seg { display: inline-flex; flex-wrap: wrap; border: 1px solid #cbd9da; border-radius: 8px; overflow: hidden; }
    .seg button { display: inline-flex; align-items: center; gap: 6px; border: 0; background: #d9eef0; color: #174a4e; font-size: 13px; font-weight: 600; padding: 7px 14px; cursor: pointer; }
    .seg button + button { border-left: 1px solid #cbd9da; }
    .seg button:hover { background: #c5e5e8; }
    .seg button.active { background: #23656b; color: #fff; }
    .seg-count { font-size: 12px; border-radius: 10px; padding: 0 7px; background: #eef6f6; color: #23474a; }
    .seg button.active .seg-count { background: rgba(255,255,255,.25); color: #fff; }
    .lv-dot { display: inline-block; width: 9px; height: 9px; border-radius: 5px; }
    .lv-dot.lv-bronze { background: #d07b5c; }
    .lv-dot.lv-silver { background: #9aa5ab; }
    .lv-dot.lv-gold { background: #c9a227; }

    .inc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 14px; margin-bottom: 8px; }
    .inc-grid > .no-data { grid-column: 1 / -1; }
    .inc-card { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; background: #fff; border: 1px solid #dfe9ea; border-top: 4px solid #45a5ad;
      border-radius: 12px; min-width: 0; transition: box-shadow .15s; }
    .inc-card:hover { box-shadow: 0 6px 18px rgba(16, 61, 64, 0.1); }
    .inc-card.is-off { background: #f8fafa; border-top-color: #cbd5d6; }
    .inc-card.is-off .inc-name, .inc-card.is-off .inc-highlight, .inc-card.is-off .inc-details { opacity: .65; }
    .inc-card-top { display: flex; align-items: flex-start; gap: 12px; }
    .inc-avatar { flex: 0 0 38px; width: 38px; height: 38px; border-radius: 10px; display: inline-grid; place-items: center; font-weight: 800; font-size: 13px;
      color: #fff; background: linear-gradient(135deg, #45a5ad, #23474a); }
    .inc-card.is-off .inc-avatar { background: #b7c3c4; }
    .inc-card-name { flex: 1 1 auto; min-width: 0; }
    .inc-name { margin: 0 0 2px; font-size: 15px; font-weight: 700; color: #232527; overflow-wrap: anywhere; }
    .inc-card-name small { font-size: 12.5px; overflow-wrap: anywhere; }
    .inc-highlight { align-self: flex-start; font-weight: 700; font-size: 14px; color: #2f7c83; background: #eef6f6; border-radius: 8px; padding: 3px 10px; overflow-wrap: anywhere; }
    .inc-details { font-size: 13.5px; color: #3b4b4c; white-space: pre-wrap; overflow-wrap: anywhere; }
    .inc-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; }
    .lv-chip { display: inline-block; font-size: 12px; font-weight: 700; border-radius: 12px; padding: 2px 10px; }
    .lv-chip.lv-bronze { background: #fbeee8; color: #8a4a33; }
    .lv-chip.lv-silver { background: #eef1f2; color: #4f5b60; }
    .lv-chip.lv-gold { background: #fbf3d9; color: #7a6110; }
    .inc-where { margin-left: auto; font-size: 12px; font-weight: 600; border-radius: 12px; padding: 2px 10px; background: #f4f8f8; color: #5f6f70; }
    .inc-where.on-dashboard { background: #f1f0fb; color: #3f3a7a; }
    .inc-facts { margin: 0; font-size: 13px; border-top: 1px solid #eef3f3; }
    .inc-facts > div { display: grid; grid-template-columns: 70px minmax(0, 1fr); gap: 10px; padding: 6px 0; border-bottom: 1px solid #eef3f3; }
    .inc-facts dt { font-weight: 600; color: #5f6f70; }
    .inc-facts dd { margin: 0; color: #232527; overflow-wrap: anywhere; }
    .inc-card-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: auto; flex-wrap: wrap; }
    .inc-docs { display: flex; flex-wrap: wrap; gap: 8px; }
    .doc-slot { display: inline-flex; align-items: center; gap: 8px; border: 1px solid #dfe9ea; border-radius: 8px; padding: 3px 10px; font-size: 12.5px; }
    .doc-view { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: #23474a; text-decoration: none; }
    .doc-none { color: #8a9899; }
    .doc-upload { margin: 0; color: #2f7c83; font-weight: 600; cursor: pointer; }
    .doc-upload:hover { text-decoration: underline; }

    @media (max-width: 767.98px) {
      .inc-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .inc-grid { grid-template-columns: minmax(0, 1fr); }
      .inc-list-head .form-control { flex-basis: 100%; }
      .inc-group-cards { margin-left: 0; }
    }
  `,
})
export class IncentiveMasterPage {
  private readonly api = inject(IncentivesApi);
  private readonly router = inject(Router);

  protected readonly groups = INCENTIVE_GROUPS;
  protected readonly states = STATES;
  protected readonly filters: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' },
  ];
  protected readonly levelFilters: { value: LevelFilter; label: string }[] = [
    { value: 'all', label: 'All levels' }, { value: 'bronze', label: 'Bronze' }, { value: 'silver', label: 'Silver' }, { value: 'gold', label: 'Gold' },
  ];

  protected readonly group = signal<IncentiveGroup>(INCENTIVE_GROUPS[0]);
  /** State Government: the state chosen (?state=). */
  protected readonly state = signal<string | null>(null);
  protected readonly status = signal<StatusFilter>('all');
  /** Only the incentives that apply to this level. */
  protected readonly level = signal<LevelFilter>('all');
  /** Searches the name, details, department, contact person and web link (as you type). */
  protected readonly search = signal('');
  protected readonly items = signal<CatalogueItem[]>([]);
  private readonly shown = computed(() => {
    const s = this.status();
    const l = this.level();
    const words = this.search().trim().toLowerCase().split(/\s+/).filter(Boolean);
    return this.items().filter((i) => {
      if (s !== 'all' && !!i.incentive['ActiveStatus'] !== (s === 'active')) return false;
      if (l !== 'all' && !i.incentive[LEVEL_FIELD[l]]) return false;
      if (!words.length) return true;
      const text = ['Incentive', 'Details', 'MinistryOrDepartment', 'ContactPerson', 'WebLink']
        .map((k) => String(i.incentive[k] ?? '')).join(' ').toLowerCase();
      return words.every((w) => text.includes(w));
    });
  });
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly view = new PagedView(() => this.shown());
  protected readonly tiles = computed(() => {
    const all = this.items();
    const active = all.filter((i) => !!i.incentive['ActiveStatus']).length;
    return [
      { label: 'Incentives', value: all.length, tone: 'teal' },
      { label: 'Active', value: active, tone: 'green' },
      { label: 'Inactive', value: all.length - active, tone: 'grey' },
      { label: 'On the main dashboard', value: all.filter((i) => i.incentive['DisplayOn'] === 'Dashboard').length, tone: 'violet' },
    ];
  });
  protected readonly listTitle = computed(() => `${this.group().key === 'state' ? this.titleCase(this.state() ?? '') : this.group().label} Incentive Schemes`);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  /** Incentives whose details are unfolded (long details show three lines). */
  protected readonly expanded = signal<ReadonlySet<number>>(new Set());

  constructor() {
    // A message of the incentive's page (saved) shows here after it returned.
    const message = (history.state as { message?: unknown } | null)?.message;
    if (typeof message === 'string') this.success.set(message);
    const route = inject(ActivatedRoute);
    combineLatest([route.paramMap, route.queryParamMap]).pipe(takeUntilDestroyed()).subscribe(([p, q]) => {
      const group = INCENTIVE_GROUPS.find((g) => g.key === p.get('group'));
      if (!group) {
        void this.router.navigate(['/staff/incentives', INCENTIVE_GROUPS[0].key], { replaceUrl: true });
        return;
      }
      const state = group.key === 'state' ? (STATES.find((s) => s.name === q.get('state'))?.name ?? null) : null;
      if (group === this.group() && state === this.state() && this.items().length) return;
      this.group.set(group);
      this.state.set(state);
      this.status.set('all');
      this.level.set('all');
      this.search.set('');
      this.items.set([]);
      if (this.type()) void this.load();
    });
  }

  /** IncentiveType of the list shown: the group's, or the chosen state's. */
  private type(): string | null {
    return this.group().type ?? this.state();
  }

  protected stateParams(): Record<string, string> | null {
    return this.group().key === 'state' && this.state() ? { state: this.state()! } : null;
  }

  protected pickState(state: string): void {
    this.success.set('');
    void this.router.navigate([], { queryParams: { state: state || null }, replaceUrl: true });
  }

  protected id(item: CatalogueItem): number {
    return Number(item.incentive['Id']);
  }

  protected details(item: CatalogueItem): string {
    const d = item.incentive['Details'];
    return d === null || d === undefined ? '' : String(d);
  }

  protected statusCount(f: StatusFilter): number {
    const all = this.items();
    return f === 'all' ? all.length : all.filter((i) => !!i.incentive['ActiveStatus'] === (f === 'active')).length;
  }

  protected levelCount(l: LevelFilter): number {
    return l === 'all' ? this.items().length : this.items().filter((i) => !!i.incentive[LEVEL_FIELD[l]]).length;
  }

  protected levelsOf(item: CatalogueItem): string[] {
    return (['Bronze', 'Silver', 'Gold'] as const).filter((l) => !!item.incentive[`ApplicableFor${l}`]);
  }

  protected groupCard(): string {
    return GROUP_CARD[this.group().key];
  }

  protected contactLine(item: CatalogueItem): string {
    return [item.incentive['MobileNo'], item.incentive['Email']].filter(Boolean).join(' · ');
  }

  /** Two letters of the department (or of the incentive) for the card's badge. */
  protected initials(item: CatalogueItem): string {
    const name = String(item.incentive['MinistryOrDepartment'] || item.incentive['Incentive'] || '?');
    const words = name.replace(/[()]/g, ' ').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(of|and|the|for|&)$/i.test(w));
    return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
  }

  protected toggle(id: number): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  protected async uploadDoc(item: CatalogueItem, n: 1 | 2, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const type = this.type();
    if (!file || !type) return;
    if (file.size > MAX_INCENTIVE_DOC_BYTES || !/\.pdf$/i.test(file.name)) {
      this.error.set('Please upload a valid PDF document (less than 2 MB).');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const r = await firstValueFrom(this.api.uploadDocument(this.id(item), n, type, file));
      this.success.set(r.message);
      this.items.set(await firstValueFrom(this.api.catalogue(type)));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected docUrl(item: CatalogueItem, n: number): string {
    return `/api/staff/schemes/incentive-master/${encodeURIComponent(String(item.incentive['Id']))}/documents/${n}`;
  }

  /** Only http(s) links are rendered as links. */
  protected httpLink(value: unknown): string | null {
    const s = typeof value === 'string' ? value.trim() : '';
    return /^https?:\/\/[^\s]+$/i.test(s) ? s : null;
  }

  private titleCase(value: string): string {
    return value.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }

  protected async load(): Promise<void> {
    const type = this.type();
    if (!type) return;
    this.busy.set(true);
    this.error.set('');
    try {
      this.items.set(await firstValueFrom(this.api.catalogue(type)));
    } catch (err) {
      this.items.set([]);
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
