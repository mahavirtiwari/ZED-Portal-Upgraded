import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { CHART_COLORS, ChartItem, ColumnChart, DonutChart, LEVEL_COLORS, RankList, formatCount } from './charts';
import { Analytics, AnalyticsFilter, AnalyticsView, CountItem, DashboardApi } from './dashboard.api';
import { CERTIFICATIONS, SIZES, STATE_NAMES } from './dashboard-filters';

const GENDER_LABELS: Record<string, string> = { male: 'Male', female: 'Female', others: 'Others', na: 'Not given' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type FilterKey = Exclude<keyof AnalyticsFilter, 'view'>;

/**
 * Main portal dashboard: the ministry's Power BI "ZED Dashboard" (registered units) and "ZED Certification" (certified
 * units) pages, from api/staff/dashboard/analytics. Filters in one row; totals as tiles; the level and month columns;
 * MSME size, gender and social category; the ranking of states, districts and two-digit activities.
 */
@Component({
  selector: 'zed-staff-analytics',
  imports: [FormsModule, DatePipe, ColumnChart, DonutChart, RankList],
  template: `
    <section class="an" [class.is-busy]="loading()" aria-labelledby="an-title">
      <div class="an-head">
        <h4 id="an-title" class="visually-hidden">ZED figures</h4>
        <div class="nav nav-tabs an-tabs" role="tablist">
          @for (t of tabs; track t.view) {
            <button type="button" class="nav-link" role="tab" [class.active]="view() === t.view" [attr.aria-selected]="view() === t.view" (click)="setView(t.view)">{{ t.label }}</button>
          }
        </div>
        <div class="an-meta">
          @if (data(); as d) { <span class="muted">Updated {{ d.generatedAt | date: 'dd-MM-yyyy HH:mm' }}</span> }
          <button type="button" class="btn btn-outline-primary btn-sm" [disabled]="loading()" (click)="load()">Refresh</button>
        </div>
      </div>

      <div class="filter-bar an-filters">
        <div class="filter">
          <label class="form-label" for="an-state">State</label>
          <select id="an-state" class="form-select" [disabled]="!!data()?.boundState" [ngModel]="filter().state ?? ''" (ngModelChange)="set('state', $event)">
            <option value="">All</option>
            @for (s of states; track s) { <option [value]="s">{{ s }}</option> }
          </select>
        </div>
        <div class="filter">
          <label class="form-label" for="an-district">District</label>
          <select id="an-district" class="form-select" [disabled]="!filter().state" [ngModel]="filter().district ?? ''" (ngModelChange)="set('district', $event)">
            <option value="">{{ filter().state ? 'All' : 'Pick a state' }}</option>
            @for (d of data()?.districtOptions ?? []; track d) { <option [value]="d">{{ d }}</option> }
          </select>
        </div>
        @if (view() === 'certified') {
          <div class="filter">
            <label class="form-label" for="an-cert">Certification</label>
            <select id="an-cert" class="form-select" [ngModel]="filter().certification ?? ''" (ngModelChange)="set('certification', $event)">
              <option value="">All</option>
              @for (c of certifications; track c) { <option [value]="c">{{ c }}</option> }
            </select>
          </div>
        }
        <div class="filter">
          <label class="form-label" for="an-gender">Gender</label>
          <select id="an-gender" class="form-select" [ngModel]="filter().gender ?? ''" (ngModelChange)="set('gender', $event)">
            <option value="">All</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="OTHERS">Others</option>
            <option value="NA">Not given</option>
          </select>
        </div>
        <div class="filter">
          <label class="form-label" for="an-size">MSME Size</label>
          <select id="an-size" class="form-select" [ngModel]="filter().size ?? ''" (ngModelChange)="set('size', $event)">
            <option value="">All</option>
            @for (s of sizes; track s) { <option [value]="s">{{ s }}</option> }
          </select>
        </div>
        <div class="filter">
          <label class="form-label" for="an-social">Social Category</label>
          <select id="an-social" class="form-select" [ngModel]="filter().socialCategory ?? ''" (ngModelChange)="set('socialCategory', $event)">
            <option value="">All</option>
            @for (s of socialCategories; track s) { <option [value]="s">{{ s }}</option> }
          </select>
        </div>
        <div class="filter an-date">
          <label class="form-label" for="an-from">{{ view() === 'certified' ? 'Certified from' : 'Registered from' }}</label>
          <input id="an-from" type="date" class="form-control" [max]="filter().to || today" [ngModel]="filter().from ?? ''" (ngModelChange)="set('from', $event)" />
        </div>
        <div class="filter an-date">
          <label class="form-label" for="an-to">To</label>
          <input id="an-to" type="date" class="form-control" [min]="filter().from || ''" [max]="today" [ngModel]="filter().to ?? ''" (ngModelChange)="set('to', $event)" />
        </div>
        @if (filtered()) {
          <div class="an-reset"><button type="button" class="btn btn-link p-0" (click)="reset()">Clear filters</button></div>
        }
      </div>

      @if (error()) {
        <div class="alert alert-danger" role="alert">{{ error() }} <button type="button" class="btn btn-link p-0 ms-1" (click)="load()">Try again</button></div>
      }

      @if (data(); as d) {
        <div class="an-kpis">
          @for (k of kpis(); track k.label) {
            <div class="an-kpi" [style.--accent]="k.color">
              <span class="an-kpi-value">{{ k.value }}</span>
              <span class="an-kpi-label">{{ k.label }}</span>
              @if (k.note) { <span class="an-kpi-note">{{ k.note }}</span> }
            </div>
          }
        </div>

        <div class="an-grid an-grid-top" [class.has-levels]="view() === 'certified'">
          @if (view() === 'certified') {
            <div class="an-card">
              <h5>Certified units by level</h5>
              <zed-column-chart [items]="levels()" [compact]="true" ariaLabel="Certified units by level" />
            </div>
          }
          <div class="an-card">
            <h5>{{ view() === 'certified' ? 'Certifications by month' : 'Registered units by month' }} <small class="muted">last 12 months of the range</small></h5>
            @if (months().length) {
              <zed-column-chart [items]="months()" [compact]="true" [ariaLabel]="view() === 'certified' ? 'Certifications by month' : 'Registrations by month'" />
            } @else { <div class="no-data">No data in this range</div> }
          </div>
        </div>

        <div class="an-grid an-grid-3">
          <div class="an-card"><h5>MSME Size</h5><zed-donut-chart [items]="categorical(d.sizes)" ariaLabel="Units by MSME size" /></div>
          <div class="an-card"><h5>Gender</h5><zed-column-chart [items]="genders()" ariaLabel="Units by gender of the owner" [compact]="true" /></div>
          <div class="an-card"><h5>Social Category</h5><zed-donut-chart [items]="categorical(d.socialCategories)" ariaLabel="Units by social category" /></div>
        </div>

        <div class="an-grid an-grid-3">
          <div class="an-card"><zed-rank-list heading="State" [valueHeading]="unitWord()" [items]="ranked(d.states)" /></div>
          <div class="an-card"><zed-rank-list heading="District (top 50)" [valueHeading]="unitWord()" [items]="ranked(d.districts)" /></div>
          <div class="an-card"><zed-rank-list heading="Two-digit activity (top 50)" [valueHeading]="unitWord()" [items]="ranked(d.activities)" /></div>
        </div>
      } @else if (loading()) {
        <div class="an-loading" role="status">Loading the figures…</div>
      }
    </section>
  `,
  styles: `
    .an { position: relative; background: #fff; border: 1px solid #dfe9ea; border-radius: 14px; padding: 16px 18px 20px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(16,61,64,.05); }
    .an.is-busy .an-kpis, .an.is-busy .an-grid { opacity: .55; transition: opacity .15s; }
    .an-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; border-bottom: 1px solid #dfe9ea; margin-bottom: 14px; }
    .an-tabs { border-bottom: 0; margin-bottom: -1px; }
    .an-tabs .nav-link { font-size: 15px; }
    .an-meta { display: flex; align-items: center; gap: 12px; padding-bottom: 8px; font-size: 13px; }
    .an-filters { margin-bottom: 16px; }
    .an-filters .filter { flex: 1 1 150px; max-width: 220px; min-width: 140px; }
    .an-filters .an-date { flex-basis: 150px; }
    .an-reset { align-self: flex-end; padding-bottom: 10px; }
    .an-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .an-kpi { --accent: #00909a; display: flex; flex-direction: column; gap: 2px; padding: 14px 16px; border-radius: 12px; background: #f7fafa; border: 1px solid #e4ecec; border-left: 4px solid var(--accent); }
    .an-kpi-value { font-size: 28px; font-weight: 700; color: #23474a; line-height: 1.15; font-variant-numeric: tabular-nums; }
    .an-kpi-label { font-size: 13px; font-weight: 600; color: #3b4b4c; }
    .an-kpi-note { font-size: 12px; color: #6b7f80; }
    .an-grid { display: grid; gap: 14px; margin-bottom: 14px; }
    .an-grid-top { grid-template-columns: 1fr; }
    .an-grid-top.has-levels { grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); }
    .an-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .an-card { border: 1px solid #e4ecec; border-radius: 12px; padding: 14px 16px; min-width: 0; }
    .an-card h5 { font-size: 15px; font-weight: 700; color: #23474a; margin: 0 0 12px; }
    .an-card h5 small { font-weight: 500; font-size: 12px; margin-left: 6px; }
    .an-loading { padding: 40px; text-align: center; color: #6b7f80; }
    @media (max-width: 1199.98px) { .an-grid-3 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 991.98px) { .an-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .an-grid-top.has-levels { grid-template-columns: 1fr; } }
    @media (max-width: 767.98px) { .an-grid-3 { grid-template-columns: 1fr; } .an-filters .filter { max-width: none; } }`,
})
export class StaffAnalytics {
  private readonly api = inject(DashboardApi);

  protected readonly tabs: { view: AnalyticsView; label: string }[] = [
    { view: 'registered', label: 'ZED Dashboard' },
    { view: 'certified', label: 'ZED Certification' },
  ];
  protected readonly states = STATE_NAMES;
  protected readonly sizes = SIZES;
  protected readonly certifications = CERTIFICATIONS;
  protected readonly socialCategories = ['General', 'OBC', 'SC', 'ST'];
  protected readonly today = new Date().toISOString().slice(0, 10);

  protected readonly view = signal<AnalyticsView>('registered');
  protected readonly filter = signal<Omit<AnalyticsFilter, 'view'>>({});
  protected readonly data = signal<Analytics | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  private request = 0;

  protected readonly filtered = computed(() => Object.values(this.filter()).some((v) => !!v));
  protected readonly unitWord = computed(() => (this.view() === 'certified' ? 'Certified' : 'Registered'));

  protected readonly kpis = computed(() => {
    const d = this.data();
    if (!d) return [];
    const t = d.totals;
    const first = d.view === 'certified'
      ? { label: 'Certified units', value: formatCount(t.certified), color: '#00909a', note: 'all levels, in the range' }
      : { label: 'Registered units', value: formatCount(t.registered), color: '#00909a', note: 'in the range' };
    const word = d.view === 'certified' ? 'certified in the range' : 'of these units';
    return [
      first,
      { label: 'Bronze certified', value: formatCount(t.bronze), color: LEVEL_COLORS['Bronze'], note: word },
      { label: 'Silver certified', value: formatCount(t.silver), color: LEVEL_COLORS['Silver'], note: word },
      { label: 'Gold certified', value: formatCount(t.gold), color: LEVEL_COLORS['Gold'], note: word },
    ];
  });

  protected readonly levels = computed<ChartItem[]>(() => {
    const t = this.data()?.totals;
    return t ? (['Bronze', 'Silver', 'Gold'] as const).map((l) => ({ label: l, value: t[l.toLowerCase() as 'bronze'], color: LEVEL_COLORS[l] })) : [];
  });

  protected readonly months = computed<ChartItem[]>(() =>
    (this.data()?.months ?? []).map((m) => {
      const [y, mo] = m.label.split('-').map(Number);
      return { label: mo ? `${MONTHS[mo - 1]} ${String(y).slice(2)}` : m.label, value: m.total };
    }),
  );

  protected readonly genders = computed<ChartItem[]>(() =>
    (this.data()?.genders ?? []).map((g) => ({ label: GENDER_LABELS[g.label.toLowerCase()] ?? g.label, value: g.total })),
  );

  constructor() {
    void this.load();
  }

  /** Categories in fixed colour order by their place in the list (the API sorts by count); beyond four: grey. */
  protected categorical(items: CountItem[]): ChartItem[] {
    return items.map((it, i) => ({ label: it.label, value: it.total, color: CHART_COLORS[i] ?? '#9aa9ab' }));
  }

  protected ranked(items: CountItem[]): ChartItem[] {
    return items.map((it) => ({ label: it.label, value: it.total }));
  }

  protected setView(view: AnalyticsView): void {
    if (view === this.view()) return;
    this.view.set(view);
    if (view === 'registered') this.filter.update((f) => ({ ...f, certification: undefined }));
    void this.load();
  }

  protected set(key: FilterKey, value: string): void {
    this.filter.update((f) => {
      const next = { ...f, [key]: value || undefined };
      if (key === 'state') next.district = undefined;
      return next;
    });
    void this.load();
  }

  protected reset(): void {
    this.filter.set({});
    void this.load();
  }

  protected async load(): Promise<void> {
    const id = ++this.request;
    this.loading.set(true);
    this.error.set('');
    try {
      const d = await firstValueFrom(this.api.analytics({ view: this.view(), ...this.filter() }));
      if (id !== this.request) return;
      this.data.set(d);
      if (d.boundState && this.filter().state !== d.boundState) this.filter.update((f) => ({ ...f, state: d.boundState! }));
    } catch (err) {
      if (id === this.request) this.error.set(apiErrorMessage(err));
    } finally {
      if (id === this.request) this.loading.set(false);
    }
  }
}
