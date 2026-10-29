import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { ClientPager, PagerComponent } from '../pager';

export interface RegionCategory {
  key: string;
  name: string;
  description: string;
  /** "district": entries are districts; "state": whole states (a district may be added too). */
  level: 'district' | 'state';
}

export interface RegionRow {
  category: string;
  stateCode: string;
  districtCode: string;
  enabled: boolean;
  updatedBy: string | null;
  updatedOn: string | null;
  stateName: string | null;
  districtName: string | null;
}

export interface Option {
  code: string;
  name: string;
}

export interface RegionsResponse {
  categories: RegionCategory[];
  regions: RegionRow[];
  states: Option[];
  subsidyDistricts: number;
}

/** Which entries of the picked list the table shows (the buttons beside the search box). */
type RegionFilter = 'all' | 'enabled' | 'disabled';

/**
 * Admin → Masters → Subsidy Regions (new in V4): the aspirational, LWE, Himalayan, island and North Eastern regions
 * whose MSMEs get the ZED scheme's additional subsidy, each entry enabled or disabled. Only enabled entries count: the
 * server flags their districts for the payment procedures after every change. V4 layout: counts at the top, a card per
 * list (by district or by state, with its enabled count), the picked list's add panel, a chip per state in it (a click
 * searches for it), search with an enabled / disabled filter, and a card per entry on phones.
 */
@Component({
  selector: 'zed-staff-subsidy-regions',
  imports: [FormsModule, PagerComponent, DatePipe],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Subsidy Regions</h3>
        <p class="page-sub">The regions whose MSMEs get the additional subsidy. Only enabled states and districts count.</p>
      </div>
    </div>

    <div class="sr-stats">
      <div class="stat stat-main"><span class="stat-value">{{ subsidyDistricts() }}</span><span class="stat-label">Districts get the additional subsidy</span></div>
      <div class="stat"><span class="stat-value">{{ stats().enabled }}<small>/{{ stats().entries }}</small></span><span class="stat-label">Entries enabled</span></div>
      <div class="stat"><span class="stat-value">{{ stats().states }}</span><span class="stat-label">States / UTs with an enabled entry</span></div>
      <div class="stat"><span class="stat-value">{{ categories().length }}</span><span class="stat-label">Region lists</span></div>
    </div>

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    <div class="sr-cats" role="tablist" aria-label="Region categories">
      @for (c of categories(); track c.key) {
        <button type="button" role="tab" class="sr-cat" [class.is-on]="active() === c.key" [attr.aria-selected]="active() === c.key" (click)="pick(c.key)">
          <span class="sr-cat-name">{{ c.name }}</span>
          <span class="sr-level" [class.is-state]="c.level === 'state'">{{ c.level === 'state' ? 'By state' : 'By district' }}</span>
          <span class="sr-cat-count"><strong>{{ enabledIn(c.key) }}</strong>/{{ countIn(c.key) }} enabled</span>
        </button>
      }
    </div>

    @if (category(); as c) {
      <section class="zed-card sr-card" [attr.aria-label]="c.name">
        <div class="sr-head">
          <div>
            <h5 class="sr-title">{{ c.name }}</h5>
            <p class="muted sr-desc">{{ c.description }}</p>
          </div>
          <span class="sr-level" [class.is-state]="c.level === 'state'">{{ c.level === 'state' ? 'Whole states (a district may be added too)' : 'Districts' }}</span>
        </div>

        <div class="sr-add">
          <span class="sr-add-title">{{ c.level === 'state' ? 'Add a state or district' : 'Add a district' }}</span>
          <div class="sr-add-fields">
            <div>
              <label class="form-label" for="sr-state">State / UT</label>
              <select id="sr-state" class="form-select" [ngModel]="addState()" (ngModelChange)="pickState($event)">
                <option value="">Select state</option>
                @for (s of states(); track s.code) { <option [value]="s.code">{{ s.name }}</option> }
              </select>
            </div>
            <div>
              <label class="form-label" for="sr-district">District</label>
              <select id="sr-district" class="form-select" [disabled]="!addState()" [ngModel]="addDistrict()" (ngModelChange)="addDistrict.set($event)">
                <option value="">{{ c.level === 'state' ? 'Whole state' : 'Select district' }}</option>
                @for (d of districts(); track d.code) { <option [value]="d.code">{{ d.name }}</option> }
              </select>
            </div>
            <label class="sr-check form-switch"><input type="checkbox" class="form-check-input" role="switch" [ngModel]="addEnabled()" (ngModelChange)="addEnabled.set($event)" /> Enabled</label>
            <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="add(c)">Add</button>
          </div>
        </div>

        @if (stateChips().length) {
          <div class="sr-chips" role="group" aria-label="States in this list">
            <span class="sr-chips-label">States in this list</span>
            @for (s of stateChips(); track s.name) {
              <button type="button" class="sr-chip" [class.is-on]="pager.search() === s.name" [class.is-off]="!s.enabled" [attr.aria-pressed]="pager.search() === s.name"
                      [title]="s.enabled + ' of ' + s.total + ' enabled'" (click)="searchState(s.name)">
                {{ s.name }} <span class="sr-chip-count">{{ s.enabled }}/{{ s.total }}</span>
              </button>
            }
          </div>
        }

        <div class="sr-toolbar">
          <input type="search" class="form-control sr-search" placeholder="Search state or district" [attr.aria-label]="'Search ' + c.name.toLowerCase()"
                 [ngModel]="pager.search()" (ngModelChange)="pager.setSearch($event)" />
          <div class="seg" role="group" aria-label="Show">
            @for (f of filters; track f.key) {
              <button type="button" [class.active]="filter() === f.key" [attr.aria-pressed]="filter() === f.key" (click)="setFilter(f.key)">
                {{ f.label }} <span class="seg-count">{{ filterCount(f.key) }}</span>
              </button>
            }
          </div>
        </div>
        <div class="table-responsive">
          <table class="table table-zed sr-table">
            <thead><tr><th>State / UT</th><th>District</th><th>Last changed</th><th class="text-center">Status</th><th class="text-center">Action</th></tr></thead>
            <tbody>
              @for (r of pager.page(); track r.stateCode + '-' + r.districtCode) {
                <tr [class.sr-off]="!r.enabled">
                  <td data-label="State / UT"><span class="sr-place"><span class="sr-pin" aria-hidden="true">{{ initials(r.stateName || r.stateCode) }}</span>{{ r.stateName || 'State ' + r.stateCode }}</span></td>
                  <td data-label="District">@if (r.districtCode) { {{ r.districtName || 'District ' + r.districtCode }} } @else { <span class="zed-chip sr-whole">Whole state</span> }</td>
                  <td class="muted sr-when" data-label="Last changed">@if (r.updatedOn) { {{ r.updatedBy }} · {{ r.updatedOn + 'Z' | date: 'dd-MM-yyyy' }} } @else { {{ r.updatedBy || '—' }} }</td>
                  <td class="text-center" data-label="Status">
                    <label class="sr-switch form-switch">
                      <input type="checkbox" class="form-check-input" role="switch" [checked]="r.enabled" [disabled]="busy()" [attr.aria-label]="(r.enabled ? 'Disable ' : 'Enable ') + label(r)" (change)="set(r, $any($event.target))" />
                      <span class="status-badge" [class.is-active]="r.enabled" [class.is-inactive]="!r.enabled">{{ r.enabled ? 'Enabled' : 'Disabled' }}</span>
                    </label>
                  </td>
                  <td class="text-center" data-label="Action"><button type="button" class="btn btn-sm btn-outline-danger" [disabled]="busy()" [attr.aria-label]="'Remove ' + label(r)" (click)="remove(r)">Remove</button></td>
                </tr>
              } @empty {
                <tr class="empty-row"><td colspan="5" style="padding: 0"><div class="no-data">
                  @if (pager.search() || filter() !== 'all') { Nothing in {{ c.name }} matches the search. } @else { No {{ c.name.toLowerCase() }} yet. Add a {{ c.level === 'state' ? 'state or district' : 'district' }} above. }
                </div></td></tr>
              }
            </tbody>
          </table>
        </div>
        @if (rows().length) {
          <zed-pager [pager]="pager" />
        }
      </section>
    }
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    .sr-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .stat { background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; padding: 12px 16px; display: flex; flex-direction: column; min-width: 0; }
    .stat-main { border-color: #b9dfc8; background: #f3faf5; }
    .stat-main .stat-value { color: #1e7a3c; }
    .stat-value { font-size: 24px; font-weight: 700; color: #23474a; line-height: 1.2; }
    .stat-value small { font-size: 15px; color: #8a9899; font-weight: 600; }
    .stat-label { font-size: 13px; color: #5f6f70; overflow-wrap: anywhere; }

    /* A card per region list; the picked one is filled. */
    .sr-cats { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; margin-bottom: 16px; }
    .sr-cat { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; text-align: left; border: 1px solid #dfe9ea; border-top: 4px solid #cbd9da;
      background: #fff; border-radius: 12px; padding: 12px 14px; color: #23474a; cursor: pointer; min-width: 0; }
    .sr-cat:hover { border-color: #45a5ad; background: #f7fbfb; }
    .sr-cat.is-on { border-color: #45a5ad; border-top-color: #2f7c83; background: #eef6f6; box-shadow: 0 0 0 1px #45a5ad inset; }
    .sr-cat-name { font-weight: 700; font-size: 15px; overflow-wrap: anywhere; }
    .sr-cat-count { font-size: 13px; color: #5f6f70; }
    .sr-cat-count strong { color: #1e7a3c; font-size: 15px; }
    .sr-level { display: inline-block; font-size: 11.5px; font-weight: 700; border-radius: 10px; padding: 1px 8px; background: #eef6f6; color: #2f7c83; }
    .sr-cat.is-on .sr-level { background: #fff; }
    .sr-level.is-state { background: #f1f0fb; color: #3f3a7a; }

    .sr-card { padding: 18px 20px; }
    .sr-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px 16px; flex-wrap: wrap; margin-bottom: 12px; }
    .sr-title { font-weight: 700; color: #23474a; margin: 0 0 2px; }
    .sr-desc { margin: 0; font-size: 14px; }

    .sr-add { background: #f4f9f9; border: 1px solid #dfe9ea; border-radius: 12px; padding: 12px 14px; margin-bottom: 14px; }
    .sr-add-title { display: block; font-weight: 700; color: #2f7c83; font-size: 13px; margin-bottom: 6px; text-transform: uppercase; letter-spacing: .03em; }
    .sr-add-fields { display: grid; grid-template-columns: 1fr 1fr auto auto; gap: 12px; align-items: end; }
    .sr-add .form-label { font-size: 13px; margin-bottom: 4px; }
    .sr-check, .sr-switch { display: inline-flex; align-items: center; gap: 8px; margin: 0; white-space: nowrap; padding-left: 0; }
    .sr-check { min-height: 38px; }
    .sr-check .form-check-input, .sr-switch .form-check-input { float: none; margin: 0; width: 2.2em; height: 1.2em; }

    .sr-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 12px; }
    .sr-chips-label { font-size: 12px; font-weight: 600; color: #5f6f70; margin-right: 4px; }
    .sr-chip { border: 1px solid #cbd9da; background: #fff; color: #23474a; border-radius: 14px; padding: 2px 10px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .sr-chip:hover { border-color: #45a5ad; background: #eef6f6; }
    .sr-chip.is-off { color: #5f6f70; border-style: dashed; }
    .sr-chip.is-on { background: #45a5ad; border-color: #45a5ad; color: #fff; border-style: solid; }
    .sr-chip-count { font-weight: 400; opacity: .8; margin-left: 2px; }

    .sr-toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .sr-search { flex: 1 1 260px; max-width: 420px; }
    .seg { display: inline-flex; flex-wrap: wrap; border: 1px solid #cbd9da; border-radius: 8px; overflow: hidden; }
    .seg button { border: 0; background: #fff; color: #2f7c83; font-size: 13px; font-weight: 600; padding: 7px 14px; cursor: pointer; }
    .seg button + button { border-left: 1px solid #cbd9da; }
    .seg button:hover { background: #eef6f6; }
    .seg button.active { background: #45a5ad; color: #fff; }
    .seg-count { font-weight: 400; opacity: .85; margin-left: 2px; }

    .sr-table td { vertical-align: middle; overflow-wrap: anywhere; }
    .sr-table tbody tr:hover { background: #f7fbfb; }
    .sr-place { display: inline-flex; align-items: center; gap: 10px; font-weight: 600; color: #232527; }
    .sr-pin { flex: 0 0 30px; width: 30px; height: 30px; border-radius: 15px; display: inline-grid; place-items: center; font-size: 11px; font-weight: 800;
      color: #fff; background: linear-gradient(135deg, #45a5ad, #23474a); letter-spacing: .03em; }
    .sr-whole { margin: 0; }
    .sr-when { font-size: 13px; }
    .sr-off td { opacity: .6; }
    .sr-off td:nth-child(4) { opacity: 1; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }

    @media (max-width: 767.98px) {
      .sr-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .sr-cats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .sr-add-fields { grid-template-columns: minmax(0, 1fr); }
      .sr-search { max-width: none; }
      /* Phones: a card per entry. */
      .sr-table thead { display: none; }
      .sr-table, .sr-table tbody, .sr-table tr, .sr-table td { display: block; width: 100%; box-sizing: border-box; }
      .sr-table tr { border: 1px solid #dfe9ea; border-radius: 12px; margin-bottom: 10px; padding: 4px 12px; }
      .sr-table tr.empty-row { border: 0; padding: 0; }
      .sr-table td { border: 0; padding: 5px 0; text-align: left !important; }
      .sr-table td[data-label]::before { content: attr(data-label); display: block; font-size: 12px; font-weight: 600; color: #5f6f70; margin-bottom: 2px; }
      .sr-table td:first-child::before { display: none; }
    }
  `,
})
export class SubsidyRegionsPage {
  private readonly http = inject(HttpClient);
  private static readonly url = '/api/staff/masters/regions';

  protected readonly categories = signal<RegionCategory[]>([]);
  private readonly regions = signal<RegionRow[]>([]);
  protected readonly states = signal<Option[]>([]);
  protected readonly districts = signal<Option[]>([]);
  protected readonly subsidyDistricts = signal(0);
  protected readonly active = signal('ASPIRATIONAL');
  protected readonly category = computed(() => this.categories().find((c) => c.key === this.active()) ?? null);
  protected readonly rows = computed(() => this.regions().filter((r) => r.category === this.active()));
  protected readonly filters: readonly { key: RegionFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'enabled', label: 'Enabled' },
    { key: 'disabled', label: 'Disabled' },
  ];
  protected readonly filter = signal<RegionFilter>('all');
  protected readonly stats = computed(() => {
    const rows = this.regions();
    const on = rows.filter((r) => r.enabled);
    return { entries: rows.length, enabled: on.length, states: new Set(on.map((r) => r.stateCode)).size };
  });
  /** The states of the picked list, with how many of their entries are enabled. */
  protected readonly stateChips = computed(() => {
    const byState = new Map<string, { name: string; total: number; enabled: number }>();
    for (const r of this.rows()) {
      const name = r.stateName || `State ${r.stateCode}`;
      const s = byState.get(name) ?? { name, total: 0, enabled: 0 };
      s.total++;
      if (r.enabled) s.enabled++;
      byState.set(name, s);
    }
    return [...byState.values()].sort((a, b) => a.name.localeCompare(b.name));
  });
  /** The rows of the category the filter lets through, ten at a time: another category starts at page 1, a switch or removal keeps the page. */
  protected readonly pager = new ClientPager<RegionRow>(10);
  protected readonly addState = signal('');
  protected readonly addDistrict = signal('');
  protected readonly addEnabled = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');

  constructor() {
    void this.load();
  }

  protected countIn(key: string): number {
    return this.regions().filter((r) => r.category === key).length;
  }

  protected enabledIn(key: string): number {
    return this.regions().filter((r) => r.category === key && r.enabled).length;
  }

  protected filterCount(f: RegionFilter): number {
    return this.filtered(f).length;
  }

  protected label(r: RegionRow): string {
    return r.districtCode ? (r.districtName ?? r.districtCode) : (r.stateName ?? r.stateCode);
  }

  /** Two letters for the state's round badge (UTTAR PRADESH → UP). */
  protected initials(name: string): string {
    const words = name.split(/\s+/).filter((w) => w && !['AND', 'OF', 'THE'].includes(w.toUpperCase()));
    return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
  }

  protected pick(key: string): void {
    this.active.set(key);
    this.filter.set('all');
    this.pager.search.set('');
    this.pager.set(this.filtered());
    this.success.set('');
    this.error.set('');
  }

  protected setFilter(f: RegionFilter): void {
    this.filter.set(f);
    this.pager.set(this.filtered());
  }

  /** A state chip searches for that state; a second click clears the search. */
  protected searchState(name: string): void {
    this.pager.setSearch(this.pager.search() === name ? '' : name);
  }

  private filtered(f = this.filter()): RegionRow[] {
    const rows = this.rows();
    return f === 'all' ? rows : rows.filter((r) => r.enabled === (f === 'enabled'));
  }

  protected async pickState(code: string): Promise<void> {
    this.addState.set(code);
    this.addDistrict.set('');
    this.districts.set([]);
    if (!code) return;
    try {
      this.districts.set(await firstValueFrom(this.http.get<Option[]>(`${SubsidyRegionsPage.url}/districts`, { params: { state: code } })));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }

  protected async add(c: RegionCategory): Promise<void> {
    if (!this.addState() || (c.level === 'district' && !this.addDistrict())) {
      this.error.set(c.level === 'district' ? 'Please choose the state and the district.' : 'Please choose the state.');
      return;
    }
    const body = { category: c.key, stateCode: this.addState(), districtCode: this.addDistrict(), enabled: this.addEnabled() };
    if (await this.run(() => this.http.post<MessageResponse>(SubsidyRegionsPage.url, body))) {
      this.addState.set('');
      this.addDistrict.set('');
      this.districts.set([]);
    }
  }

  protected async set(r: RegionRow, input: HTMLInputElement): Promise<void> {
    const enabled = input.checked;
    const ok = await this.run(() => this.http.put<MessageResponse>(SubsidyRegionsPage.url, { category: r.category, stateCode: r.stateCode, districtCode: r.districtCode, enabled }));
    if (!ok) input.checked = !enabled;
  }

  protected async remove(r: RegionRow): Promise<void> {
    if (!confirm(`Remove ${this.label(r)} from this list?`)) return;
    await this.run(() => this.http.delete<MessageResponse>(SubsidyRegionsPage.url, { params: { category: r.category, stateCode: r.stateCode, districtCode: r.districtCode } }));
  }

  private async run(call: () => Observable<MessageResponse>): Promise<boolean> {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const r = await firstValueFrom(call());
      await this.load(false);
      this.success.set(r.message);
      return true;
    } catch (err) {
      this.error.set(apiErrorMessage(err));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private async load(showBusy = true): Promise<void> {
    if (showBusy) this.busy.set(true);
    try {
      const r = await firstValueFrom(this.http.get<RegionsResponse>(SubsidyRegionsPage.url));
      this.categories.set(r.categories);
      this.regions.set(r.regions);
      this.pager.refresh(this.filtered());
      this.states.set(r.states);
      this.subsidyDistricts.set(r.subsidyDistricts);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      if (showBusy) this.busy.set(false);
    }
  }
}
