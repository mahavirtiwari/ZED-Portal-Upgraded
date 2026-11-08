import { Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage, AuthService } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { CHART_COLORS, ChartItem, DonutChart, GroupedColumnChart, LEVEL_COLORS, RankList, TrendPoint, formatCount } from './charts';
import { Analytics, AnalyticsFilter, AnalyticsView, CountItem, DashboardApi, Row } from './dashboard.api';
import { CERTIFICATIONS, SIZES, STATE_NAMES } from './dashboard-filters';
import { PortalSystem } from '../../portal-system';
import { levelName } from '../../msme/shared/levels';
import { STAFF_SYSTEM } from '../staff-menu';

const GENDER_LABELS: Record<string, string> = { male: 'Male', female: 'Female', others: 'Others' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type FilterKey = Exclude<keyof AnalyticsFilter, 'view'>;

/**
 * What each portal's figures count (the procedure of its database: migrations 0019, 0020, 0021). "Completed" is a
 * certification on the main portal, a handholding finished at milestone 3 on Consultancy and a surveillance on
 * Surveillance; Consultancy's level figures are applications (there is no Bronze handholding).
 */
interface AnalyticsWords {
  /** Registered, completed, Bronze, Silver, Gold and (main only) ZED-X. */
  kpis: string[];
  certifications: readonly string[];
  /** The certification filter's caption and the "Date of" choice for the completion date. */
  certLabel: string;
  completedDate: string;
  /** The trend's second series, and the ranking's value heading when the dates are completion dates. */
  completed: string;
  completedShort: string;
}

export const ANALYTICS_WORDS: Record<PortalSystem, AnalyticsWords> = {
  main: {
    kpis: ['Registered units', 'Certified units', 'Bronze certified', 'Silver certified', 'Gold certified', 'ZED-X certified'],
    // 2026-11-08: ZED-X too (the figures count its certifications).
    certifications: [...CERTIFICATIONS, 'ZEDX'], certLabel: 'Certification', completedDate: 'Certification', completed: 'Certified', completedShort: 'Certified',
  },
  consultancy: {
    kpis: ['Registered units', 'Handholding completed', 'Applications', 'Silver applications', 'Gold applications'],
    certifications: ['Silver', 'Gold'], certLabel: 'Level', completedDate: 'Handholding completion', completed: 'Handholding completed',
    completedShort: 'Completed',
  },
  surveillance: {
    kpis: ['Registered units', 'Surveillance completed', 'Bronze completed', 'Silver completed', 'Gold completed'],
    certifications: CERTIFICATIONS, certLabel: 'Certification', completedDate: 'Surveillance completion', completed: 'Surveillance completed',
    completedShort: 'Completed',
  },
};

/**
 * Staff dashboard figures (all three portals, worded by ANALYTICS_WORDS): the ministry's Power BI "ZED Dashboard" and "ZED Certification" pages in one view (the page
 * shows Clear filters, the Updated time and Refresh in its head through data(), filtered(), reset() and load()), from
 * api/staff/dashboard/analytics. Filters in one row, the date range on the registration or the certification date;
 * totals as tiles; the status cards of the user's applications (what the page puts inside), with the filters; the level
 * and month columns; MSME size, gender and social category; the ranking of states, districts and two-digit activities.
 */
@Component({
  selector: 'zed-staff-analytics',
  imports: [FormsModule, DonutChart, GroupedColumnChart, RankList],
  template: `
    <section class="an" [class.is-busy]="loading()" aria-label="ZED figures">

      <!-- V4 2026-11-08: the date basis as tabs; four filters in one row, the others under More filters; chips for what is set. -->
      @if (views.length > 1) {
        <div class="an-basis" role="tablist" aria-label="Count by">
          @for (v of views; track v) {
            <button type="button" role="tab" class="an-basis-tab" [attr.data-view]="v" [class.active]="view() === v" [attr.aria-selected]="view() === v"
                    (click)="setView(v)">{{ v === 'registered' ? 'By registration date' : 'By ' + words.completedDate.toLowerCase() + ' date' }}</button>
          }
        </div>
      }
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
        <div class="filter">
          <label class="form-label" for="an-cert">{{ words.certLabel }}</label>
          <select id="an-cert" class="form-select" [ngModel]="filter().certification ?? ''" (ngModelChange)="set('certification', $event)">
            <option value="">All</option>
            @for (c of certifications; track c) { <option [value]="c">{{ levelName(c) }}</option> }
          </select>
        </div>
        <div class="filter an-range">
          <span class="form-label" id="an-range-label">{{ view() === 'registered' ? 'Registered' : words.completedShort }} between</span>
          <div class="an-range-inputs" role="group" aria-labelledby="an-range-label">
            <input id="an-from" type="date" class="form-control" aria-label="From" [max]="filter().to || today" [ngModel]="filter().from ?? ''" (ngModelChange)="set('from', $event)" />
            <span class="an-range-to">to</span>
            <input id="an-to" type="date" class="form-control" aria-label="To" [min]="filter().from || ''" [max]="today" [ngModel]="filter().to ?? ''" (ngModelChange)="set('to', $event)" />
          </div>
        </div>
        <div class="filter an-more-btn">
          <button type="button" class="btn btn-outline-primary" [attr.aria-expanded]="moreOpen()" aria-controls="an-more" (click)="moreOpen.set(!moreOpen())">
            More filters{{ moreCount() ? ' (' + moreCount() + ')' : '' }} <span aria-hidden="true">{{ moreOpen() ? '▴' : '▾' }}</span>
          </button>
        </div>
      </div>
      <div class="filter-bar an-filters an-more" id="an-more" [hidden]="!moreOpen()">
        <div class="filter">
          <label class="form-label" for="an-gender">Gender</label>
          <select id="an-gender" class="form-select" [ngModel]="filter().gender ?? ''" (ngModelChange)="set('gender', $event)">
            <option value="">All</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="OTHERS">Others</option>
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
      </div>
      @if (chips().length) {
        <div class="an-chips" aria-label="Filters set">
          @for (c of chips(); track c.key) {
            <span class="an-chip">{{ c.label }}
              @if (c.key !== 'state' || !data()?.boundState) {
                <button type="button" [attr.aria-label]="'Remove ' + c.label" (click)="set(c.key, '')">×</button>
              }
            </span>
          }
        </div>
      }

      @if (error()) {
        <div class="alert alert-danger" role="alert">{{ error() }} <button type="button" class="btn btn-link p-0 ms-1" (click)="load()">Try again</button></div>
      }

      @if (data(); as d) {
        <div class="an-kpis" [style.--n]="kpis().length">
          @for (k of kpis(); track k.label) {
            <div class="an-kpi" [style.--accent]="k.color">
              <span class="an-kpi-value">{{ k.value }}</span>
              <span class="an-kpi-label">{{ k.label }}</span>
            </div>
          }
        </div>
      }

      <!-- The page's status cards (Bronze, Silver, Gold): the user's applications, with the filters. -->
      <div class="an-status" [class.is-hidden]="!data()">
        <h5>Applications under your charge</h5>
        <ng-content />
      </div>

      @if (data(); as d) {
        <div class="an-grid an-grid-3 an-splits">
          <div class="an-card"><h5>MSME Size</h5><zed-donut-chart [items]="categorical(d.sizes)" ariaLabel="Units by MSME size" /></div>
          <div class="an-card"><h5>Gender</h5><zed-donut-chart [items]="genders()" ariaLabel="Units by gender of the owner" /></div>
          <div class="an-card"><h5>Social Category</h5><zed-donut-chart [items]="categorical(d.socialCategories)" ariaLabel="Units by social category" /></div>
        </div>

        <div class="an-grid an-grid-top an-trend">
          <div class="an-card">
            <h5>Monthly trend <small class="muted">last 12 months of the range</small></h5>
            @if (months().length) {
              <zed-grouped-column-chart [items]="months()" [series]="trendSeries" [colors]="trendColors" [ariaLabel]="'Registrations and ' + words.completed.toLowerCase() + ' by month'" />
            } @else { <div class="no-data">No data in this range</div> }
          </div>
          <div class="an-card">
            <h5>Year-wise trend</h5>
            @if (years().length) {
              <zed-grouped-column-chart [items]="years()" [series]="trendSeries" [colors]="trendColors" [ariaLabel]="'Registrations and ' + words.completed.toLowerCase() + ' by year'" />
            } @else { <div class="no-data">No data in this range</div> }
          </div>
        </div>

        <div class="an-grid an-grid-3">
          <div class="an-rank"><zed-rank-list heading="State" [valueHeading]="unitWord()" [items]="ranked(d.states)" /></div>
          <div class="an-rank"><zed-rank-list heading="District" [valueHeading]="unitWord()" [items]="ranked(d.districts)" /></div>
          <div class="an-rank"><zed-rank-list heading="Sector (two-digit activity)" [valueHeading]="unitWord()" [items]="ranked(d.activities)" /></div>
        </div>
      } @else if (loading()) {
        <div class="an-loading" role="status">Loading the figures…</div>
      }
    </section>
  `,
  styles: `
    .an { position: relative; background: #fff; border: 1px solid #dfe9ea; border-radius: 14px; padding: 16px 18px 20px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(16,61,64,.05); }
    .an.is-busy .an-kpis, .an.is-busy .an-grid { opacity: .55; transition: opacity .15s; }
    .an-status.is-hidden { display: none; }
    /* The date basis as tabs; State, District, Certification, the date range and More filters in one row. */
    .an-basis { display: inline-flex; border: 1px solid #cbd9da; border-radius: 8px; overflow: hidden; margin-bottom: 14px; }
    .an-basis-tab { border: 0; background: #fff; color: #2f7c83; font-size: 13px; font-weight: 600; padding: 7px 14px; }
    .an-basis-tab + .an-basis-tab { border-left: 1px solid #cbd9da; }
    .an-basis-tab.active { background: #45a5ad; color: #fff; }
    .an-filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 1.7fr) auto; gap: 12px 16px; margin-bottom: 12px; align-items: end; }
    .an-more { grid-template-columns: repeat(3, minmax(0, 1fr)); padding: 12px; background: #f7fafa; border: 1px solid #e4ecec; border-radius: 10px; }
    .an-more[hidden] { display: none; }
    .an-range-inputs { display: flex; align-items: center; gap: 6px; }
    .an-range-inputs .form-control { min-width: 0; padding-right: 8px; }
    .an-range-to { font-size: 13px; color: #5f6f70; }
    .an-more-btn .btn { white-space: nowrap; }
    .an-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: -2px 0 14px; }
    .an-chip { display: inline-flex; align-items: center; gap: 4px; background: #eef6f6; color: #23474a; border: 1px solid #d3e6e7; border-radius: 999px;
      padding: 2px 4px 2px 10px; font-size: 12px; font-weight: 600; }
    .an-chip button { border: 0; background: none; color: #2f7c83; font-size: 15px; line-height: 1; padding: 0 4px; cursor: pointer; }
    .an-status { margin-bottom: 18px; }
    .an-status h5 { font-size: 15px; font-weight: 700; color: #23474a; margin: 0 0 12px; }
    .an-status h5 small { font-weight: 500; font-size: 12px; margin-left: 6px; }
    .an-filters .filter { max-width: none; min-width: 0; }
    .an-filters .form-select, .an-filters .form-control { padding-left: 10px; padding-right: 28px; }
    .an-filters .an-date .form-control { padding-right: 8px; }
    .an-kpis { display: grid; grid-template-columns: repeat(var(--n, 5), minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
    .an-kpi { --accent: #00909a; display: flex; flex-direction: column; gap: 2px; padding: 14px 16px; border-radius: 12px; background: #f7fafa; border: 1px solid #e4ecec; }
    .an-kpi-value { font-size: 28px; font-weight: 700; color: var(--accent); line-height: 1.15; font-variant-numeric: tabular-nums; }
    .an-kpi-label { font-size: 13px; font-weight: 600; color: #3b4b4c; }
    .an-grid { display: grid; gap: 14px; margin-bottom: 14px; }
    .an-grid-top { grid-template-columns: 1fr; }
    .an-trend { grid-template-columns: minmax(0, 2.2fr) minmax(0, 1fr); }
    .an-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .an-card { border: 1px solid #e4ecec; border-radius: 12px; padding: 14px 16px; min-width: 0; }
    .an-card h5 { font-size: 15px; font-weight: 700; color: #23474a; margin: 0 0 12px; }
    /* The split charts fill their card and sit in its middle. */
    .an-grid-3 .an-card { display: flex; flex-direction: column; }
    .an-grid-3 .an-card > zed-donut-chart, .an-grid-3 .an-card > zed-column-chart { flex: 1 1 auto; }
    .an-grid-3 .an-card > zed-column-chart { display: flex; flex-direction: column; justify-content: flex-end; }
    .an-rank { min-width: 0; }
    .an-card h5 small { font-weight: 500; font-size: 12px; margin-left: 6px; }
    .an-loading { padding: 40px; text-align: center; color: #6b7f80; }
    @media (max-width: 1199.98px) { .an-grid-3 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 1199.98px) { .an-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @media (max-width: 991.98px) { .an-trend { grid-template-columns: 1fr; } .an-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 1199.98px) { .an-filters { grid-template-columns: repeat(3, minmax(0, 1fr)); } .an-range { grid-column: span 2; } }
    @media (max-width: 767.98px) { .an-grid-3 { grid-template-columns: 1fr; } .an-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 479.98px) { .an-filters { grid-template-columns: 1fr; } .an-range { grid-column: auto; } .an-basis { display: flex; } .an-basis-tab { flex: 1 1 0; } }`,
})
export class StaffAnalytics {
  private readonly api = inject(DashboardApi);
  private readonly system = inject(STAFF_SYSTEM);
  protected readonly words = ANALYTICS_WORDS[this.system];
  /**
   * The views (dashboard tabs) of the user: a Dashboard Admin those the Admin ticked on this portal (2026-11-07; the server
   * checks them too), everybody else both.
   */
  protected readonly views: AnalyticsView[] = (() => {
    const user = inject(AuthService).currentUser();
    const all: AnalyticsView[] = ['registered', 'certified'];
    if (user?.roleId !== 10 || !user.screens) return all;
    const mine = all.filter((v) => user.screens!.includes(`${this.system}:dash-${v}`));
    return mine.length ? mine : all;
  })();

  protected readonly states = STATE_NAMES;
  protected readonly sizes = SIZES;
  protected readonly certifications = this.words.certifications;
  protected readonly levelName = levelName;
  protected readonly socialCategories = ['General', 'OBC', 'SC', 'ST'];
  protected readonly today = new Date().toISOString().slice(0, 10);

  protected readonly view = signal<AnalyticsView>(this.views[0]);
  /** More filters (gender, size, social category) open. */
  protected readonly moreOpen = signal(false);
  protected readonly moreCount = computed(() => (['gender', 'size', 'socialCategory'] as const).filter((k) => !!this.filter()[k]).length);
  /** The filters that are set, as removable chips. */
  protected readonly chips = computed(() => {
    const f = this.filter();
    const names: [FilterKey, string][] = [['state', 'State'], ['district', 'District'], ['certification', this.words.certLabel], ['gender', 'Gender'],
      ['size', 'Size'], ['socialCategory', 'Social category'], ['from', 'From'], ['to', 'To']];
    return names.filter(([k]) => !!f[k]).map(([key, name]) => {
      const v = f[key]!;
      return { key, label: `${name}: ${key === 'gender' ? (GENDER_LABELS[v.toLowerCase()] ?? v) : v}` };
    });
  });
  protected readonly filter = signal<Omit<AnalyticsFilter, 'view'>>({});
  /** Read by the page (Updated time in its head). */
  readonly data = signal<Analytics | null>(null);
  /** The status cards' counts with the filters (the page draws the cards inside the ZED Certification tab). */
  readonly statusCards = output<Row>();
  readonly loading = signal(false);
  protected readonly error = signal('');
  private request = 0;

  readonly filtered = computed(() => this.view() !== 'registered' || Object.values(this.filter()).some((v) => !!v));
  protected readonly unitWord = computed(() => (this.view() === 'certified' ? this.words.completedShort : 'Registered'));

  /** Registered and completed units, then each level (Consultancy: all applications, then Silver and Gold). */
  protected readonly kpis = computed(() => {
    const t = this.data()?.totals;
    if (!t) return [];
    const k = this.words.kpis;
    return [
      { label: k[0], value: formatCount(t.registered), color: '#2f7c83' },
      { label: k[1], value: formatCount(t.certified), color: '#00909a' },
      { label: k[2], value: formatCount(t.bronze), color: this.words.certifications.includes('Bronze') ? LEVEL_COLORS['Bronze'] : '#6250d6' },
      { label: k[3], value: formatCount(t.silver), color: LEVEL_COLORS['Silver'] },
      { label: k[4], value: formatCount(t.gold), color: LEVEL_COLORS['Gold'] },
      ...(k[5] ? [{ label: k[5], value: formatCount(t.zedx ?? 0), color: '#2f7c83' }] : []),
    ];
  });

  /** The trend's two series: registrations (teal) and completions (orange), each counted by its own date. */
  protected readonly trendSeries = ['Registered', this.words.completed];
  protected readonly trendColors = [CHART_COLORS[0], CHART_COLORS[1]];

  protected readonly months = computed<TrendPoint[]>(() =>
    (this.data()?.months ?? []).map((m) => {
      const [y, mo] = m.period.split('-').map(Number);
      return { label: mo ? `${MONTHS[mo - 1]} ${String(y).slice(2)}` : m.period, values: [m.registered, m.certified] };
    }),
  );

  protected readonly years = computed<TrendPoint[]>(() =>
    (this.data()?.years ?? []).map((y) => ({ label: y.period, values: [y.registered, y.certified] })),
  );

  protected readonly genders = computed<ChartItem[]>(() =>
    (this.data()?.genders ?? []).map((g, i) => ({ label: GENDER_LABELS[g.label.toLowerCase()] ?? g.label, value: g.total, color: CHART_COLORS[i] ?? '#9aa9ab' })),
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

  /** What the date range applies to: the registration or the certification date. */
  protected setView(view: AnalyticsView): void {
    if (view === this.view()) return;
    this.view.set(view);
    void this.load();
  }

  protected set(key: FilterKey, value: string): void {
    this.filter.update((f) => {
      const next = { ...f, [key]: value || undefined };
      if (key === 'state') next.district = undefined;
      return next;
    });
    // The District choices are the chosen state's own: drop the old state's until the answer brings the new ones.
    if (key === 'state') this.data.update((d) => (d ? { ...d, districtOptions: [] } : d));
    void this.load();
  }

  reset(): void {
    this.filter.set({});
    this.view.set(this.views[0]);
    void this.load();
  }

  /** fresh (Refresh): the server reads the figures again instead of the ones it keeps for ten minutes. */
  async load(fresh = false): Promise<void> {
    const id = ++this.request;
    this.loading.set(true);
    this.error.set('');
    try {
      const d = await firstValueFrom(this.api.analytics({ view: this.view(), ...this.filter() }, fresh));
      if (id !== this.request) return;
      this.data.set(d);
      this.statusCards.emit(d.statusCards ?? {});
      if (d.boundState && this.filter().state !== d.boundState) this.filter.update((f) => ({ ...f, state: d.boundState! }));
    } catch (err) {
      if (id === this.request) this.error.set(apiErrorMessage(err));
    } finally {
      if (id === this.request) this.loading.set(false);
    }
  }
}
