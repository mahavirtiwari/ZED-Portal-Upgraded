import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest, firstValueFrom } from 'rxjs';
import { CatalogueItem, INCENTIVE_GROUPS, IncentiveGroup, IncentivesApi, STATES } from './incentives.api';
import { PagedView, PagerComponent } from '../pager';

export const MAX_INCENTIVE_DOC_BYTES = 2 * 1024 * 1024;

type StatusFilter = 'all' | 'active' | 'inactive';

/**
 * Incentive catalogue for the Admin role (shown on the public incentive pages), one page per group of the Incentives
 * menu: Ministry of MSME, State Government (a state is chosen on the page), Financial Institution and Others (V4, as the
 * LEAN portal's incentive pages; the old Views/Incentive/Index.cshtml had one page per type). Create New Incentive and
 * Edit open the incentive's own page (incentive-form.ts); the two PDF documents can also be attached in the list.
 */
@Component({
  selector: 'zed-staff-incentive-master',
  imports: [FormsModule, PagerComponent, RouterLink],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ group().title }}</h3>
        <p class="page-sub">{{ group().subtitle }}</p>
      </div>
      @if (group().key !== 'state' || state()) {
        <a class="btn btn-primary" [routerLink]="['/staff/incentives', group().key, 'new']" [queryParams]="stateParams()">+ Create New Incentive</a>
      }
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    @if (group().key === 'state') {
      <div class="zed-card state-pick">
        <label class="form-label" for="inc-state">State / UT</label>
        <select class="form-select" id="inc-state" [ngModel]="state() ?? ''" (ngModelChange)="pickState($event)">
          <option value="">Select state</option>
          @for (s of states; track s.id) { <option [value]="s.name">{{ s.name }}</option> }
        </select>
      </div>
    }

    @if (group().key !== 'state' || state()) {
      <div class="inc-tiles">
        @for (t of tiles(); track t.label) {
          <div class="inc-tile"><span class="inc-tile-label">{{ t.label }}</span><strong>{{ t.value }}</strong></div>
        }
      </div>

      <section class="zed-card inc-list" [attr.aria-label]="listTitle()">
        <div class="inc-list-head">
          <h5 class="m-0">{{ listTitle() }} <span class="zed-chip">{{ items().length }} incentive{{ items().length === 1 ? '' : 's' }}</span></h5>
          <div class="btn-group" role="group" aria-label="Status">
            @for (f of filters; track f.value) {
              <button type="button" class="btn btn-sm" [class.btn-primary]="status() === f.value" [class.btn-outline-primary]="status() !== f.value"
                      [attr.aria-pressed]="status() === f.value" (click)="status.set(f.value)">{{ f.label }}</button>
            }
          </div>
        </div>
        <div class="table-responsive">
          <table class="table table-bordered table-zed">
            <thead>
              <tr>
                <th class="text-center" style="width: 60px">S.No</th><th>Incentive</th><th>Details</th><th>{{ group().department }}</th><th>Contact Person</th>
                <th class="text-center">Web Link</th><th class="text-center">Applicable for</th><th class="text-center">Status</th>
                <th class="text-center" style="width: 90px">Action</th><th class="text-center" style="width: 170px">Documents</th>
              </tr>
            </thead>
            <tbody>
              @for (item of view.page(); track item.incentive['Id']) {
                <tr>
                  <td class="text-center">{{ view.serial($index) }}</td>
                  <td><strong>{{ item.incentive['Incentive'] }}</strong></td>
                  <td class="description">
                    @if (details(item); as d) {
                      <div [class.clamp-3]="!expanded().has(id(item))" [title]="d">{{ d }}</div>
                      @if (d.length > 160) {
                        <button type="button" class="btn btn-link btn-sm p-0" (click)="toggle(id(item))">{{ expanded().has(id(item)) ? 'less' : 'more' }}</button>
                      }
                    }
                  </td>
                  <td>{{ item.incentive['MinistryOrDepartment'] }}</td>
                  <td>{{ item.incentive['ContactPerson'] }}</td>
                  <td class="text-center">
                    @if (httpLink(item.incentive['WebLink']); as link) {
                      <a [href]="link" target="_blank" rel="noopener noreferrer">Web Link</a>
                    } @else { {{ item.incentive['WebLink'] }} }
                  </td>
                  <td class="text-center">
                    @if (item.incentive['ApplicableForBronze']) { <span class="zed-chip">Bronze</span> }
                    @if (item.incentive['ApplicableForSilver']) { <span class="zed-chip">Silver</span> }
                    @if (item.incentive['ApplicableForGold']) { <span class="zed-chip">Gold</span> }
                  </td>
                  <td class="text-center">
                    <span class="status-badge" [class.is-active]="!!item.incentive['ActiveStatus']">{{ item.incentive['ActiveStatus'] ? 'Active' : 'Inactive' }}</span>
                  </td>
                  <td class="text-center">
                    <a class="btn btn-outline-primary btn-sm" [routerLink]="['/staff/incentives', group().key, id(item), 'edit']" [queryParams]="stateParams()">Edit</a>
                  </td>
                  <td class="text-center">
                    @for (n of [1, 2]; track n) {
                      <div class="doc-line">
                        <label class="btn btn-sm btn-outline-primary mb-0">
                          Doc {{ n }}
                          <input type="file" class="d-none" accept="application/pdf" (change)="uploadDoc(item, n === 1 ? 1 : 2, $event)" />
                        </label>
                        @if (n === 1 ? item.hasDocument1 : item.hasDocument2) {
                          <a [href]="docUrl(item, n)" target="_blank" rel="noopener" [attr.aria-label]="'Document ' + n"><img src="Images/svgicons/pdf-icon.svg" alt="" height="26" /></a>
                        }
                      </div>
                    }
                  </td>
                </tr>
              } @empty {
                @if (!busy()) {
                  <tr><td colspan="10" style="padding: 0"><div class="no-data">{{ items().length ? 'No incentive matches this filter.' : 'Nothing here yet. Create the first incentive.' }}</div></td></tr>
                }
              }
            </tbody>
          </table>
        </div>
        <zed-pager [pager]="view" />
      </section>
    } @else {
      <div class="no-data">Choose a state to see its incentives.</div>
    }
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    .page-head { align-items: center; }
    .state-pick { max-width: 420px; margin-bottom: 16px; }
    .inc-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .inc-tile { background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; }
    .inc-tile-label { font-size: 12px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; color: #5f6f70; }
    .inc-tile strong { font-size: 24px; color: #23474a; }
    .inc-list-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
    .description { white-space: pre-wrap; min-width: 220px; }
    .doc-line { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 6px; }
    .doc-line:last-child { margin-bottom: 0; }
  `,
})
export class IncentiveMasterPage {
  private readonly api = inject(IncentivesApi);
  private readonly router = inject(Router);

  protected readonly states = STATES;
  protected readonly filters: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' },
  ];

  protected readonly group = signal<IncentiveGroup>(INCENTIVE_GROUPS[0]);
  /** State Government: the state chosen (?state=). */
  protected readonly state = signal<string | null>(null);
  protected readonly status = signal<StatusFilter>('all');
  protected readonly items = signal<CatalogueItem[]>([]);
  private readonly shown = computed(() => {
    const s = this.status();
    return s === 'all' ? this.items() : this.items().filter((i) => !!i.incentive['ActiveStatus'] === (s === 'active'));
  });
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly view = new PagedView(() => this.shown());
  protected readonly tiles = computed(() => {
    const active = this.items().filter((i) => !!i.incentive['ActiveStatus']).length;
    return [
      { label: 'Incentives', value: this.items().length },
      { label: 'Active', value: active },
      { label: 'Inactive', value: this.items().length - active },
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

  private async load(): Promise<void> {
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
