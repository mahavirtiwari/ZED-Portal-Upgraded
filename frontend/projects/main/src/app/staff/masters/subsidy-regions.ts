import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
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
  source: string | null;
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

/**
 * Admin → Masters → Subsidy Regions (new in V4): the aspirational, LWE, Himalayan, island and North Eastern regions
 * whose MSMEs get the ZED scheme's additional subsidy, each entry enabled or disabled. Only enabled entries count: the
 * server flags their districts for the payment procedures after every change.
 */
@Component({
  selector: 'zed-staff-subsidy-regions',
  imports: [FormsModule, PagerComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Subsidy Regions</h3>
        <p class="page-sub">The regions whose MSMEs get the additional subsidy. Only enabled states and districts count.</p>
      </div>
      <span class="status-badge is-active">{{ subsidyDistricts() }} districts get the additional subsidy</span>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    <div class="sr-tabs" role="tablist" aria-label="Region categories">
      @for (c of categories(); track c.key) {
        <button type="button" role="tab" class="sr-tab" [class.is-on]="active() === c.key" [attr.aria-selected]="active() === c.key" (click)="pick(c.key)">
          {{ c.name }} <span class="sr-count">{{ enabledIn(c.key) }}/{{ countIn(c.key) }}</span>
        </button>
      }
    </div>

    @if (category(); as c) {
      <section class="zed-card" [attr.aria-label]="c.name">
        <p class="muted">{{ c.description }}</p>
        <div class="sr-add">
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
          <label class="sr-check"><input type="checkbox" class="form-check-input" [ngModel]="addEnabled()" (ngModelChange)="addEnabled.set($event)" /> Enabled</label>
          <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="add(c)">Add</button>
        </div>

        <div class="filter-bar mb-3">
          <div class="filter wide">
            <input type="search" class="form-control" placeholder="Search state or district" [attr.aria-label]="'Search ' + c.name.toLowerCase()"
                   [ngModel]="pager.search()" (ngModelChange)="pager.setSearch($event)" />
          </div>
        </div>
        <div class="table-responsive">
          <table class="table table-zed sr-table">
            <thead><tr><th>State / UT</th><th>District</th><th>Source</th><th class="text-center">Status</th><th class="text-center">Action</th></tr></thead>
            <tbody>
              @for (r of pager.page(); track r.stateCode + '-' + r.districtCode) {
                <tr [class.sr-off]="!r.enabled">
                  <td>{{ r.stateName || 'State ' + r.stateCode }}</td>
                  <td>{{ r.districtCode ? (r.districtName || 'District ' + r.districtCode) : 'Whole state' }}</td>
                  <td class="muted">{{ r.source }}</td>
                  <td class="text-center">
                    <label class="sr-switch form-switch">
                      <input type="checkbox" class="form-check-input" role="switch" [checked]="r.enabled" [disabled]="busy()" [attr.aria-label]="(r.enabled ? 'Disable ' : 'Enable ') + label(r)" (change)="set(r, $any($event.target))" />
                      <span>{{ r.enabled ? 'Enabled' : 'Disabled' }}</span>
                    </label>
                  </td>
                  <td class="text-center"><button type="button" class="btn btn-sm btn-outline-danger" [disabled]="busy()" [attr.aria-label]="'Remove ' + label(r)" (click)="remove(r)">Remove</button></td>
                </tr>
              } @empty {
                <tr><td colspan="5" style="padding: 0"><div class="no-data">
                  @if (pager.search()) { Nothing in {{ c.name }} matches the search. } @else { No {{ c.name.toLowerCase() }} yet. Add a {{ c.level === 'state' ? 'state or district' : 'district' }} above. }
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
    .page-head { align-items: center; }
    .sr-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .sr-tab { border: 1px solid #dfe9ea; background: #fff; border-radius: 20px; padding: 6px 14px; font-weight: 600; color: #23474a; }
    .sr-tab.is-on { background: #45a5ad; border-color: #45a5ad; color: #fff; }
    .sr-count { font-weight: 400; opacity: .8; margin-left: 4px; }
    .sr-add { display: grid; grid-template-columns: 1fr 1fr auto auto; gap: 12px; align-items: end; margin-bottom: 16px; }
    .sr-check, .sr-switch { display: inline-flex; align-items: center; gap: 8px; margin: 0; white-space: nowrap; }
    .sr-check .form-check-input, .sr-switch .form-check-input { float: none; margin: 0; }
    .sr-switch .form-check-input { width: 2.2em; height: 1.2em; }
    .sr-off td { opacity: .6; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    @media (max-width: 700px) { .sr-add { grid-template-columns: 1fr; } }
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
  /** The rows of the category, ten at a time: another category starts at page 1, a switch or removal keeps the page. */
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

  protected label(r: RegionRow): string {
    return r.districtCode ? (r.districtName ?? r.districtCode) : (r.stateName ?? r.stateCode);
  }

  protected pick(key: string): void {
    this.active.set(key);
    this.pager.search.set('');
    this.pager.set(this.rows());
    this.success.set('');
    this.error.set('');
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
      this.pager.refresh(this.rows());
      this.states.set(r.states);
      this.subsidyDistricts.set(r.subsidyDistricts);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      if (showBusy) this.busy.set(false);
    }
  }
}
