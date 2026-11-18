import { formatDate } from '@angular/common';
import { Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage, AuthService } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ChartItem, GroupedColumnChart, LEVEL_COLORS, RankList, StackedBar, TrendPoint, formatCount } from './charts';
import { Analytics, AnalyticsFilter, AnalyticsView, CountItem, DashboardApi, Row } from './dashboard.api';
import { CERTIFICATIONS, SIZES, STATE_NAMES } from './dashboard-filters';
import { KeyedSheet, sharePercent } from './dashboard-export';
import { PortalSystem } from '../../portal-system';
import { levelCodes, levelName } from '../../msme/shared/levels';
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
    // 2026-11-08: ZED-X too (the figures count its certifications); the page lists every level (levelCodes()).
    certifications: [...CERTIFICATIONS, 'ZEDX'], certLabel: 'Certification', completedDate: 'Certification', completed: 'Certified', completedShort: 'Certified',
  },
  consultancy: {
    kpis: ['Registered units', 'Handholding completed', 'Applications', 'Silver applications', 'Gold applications', 'ZED-X applications'],
    certifications: ['Silver', 'Gold', 'ZEDX'], certLabel: 'Level', completedDate: 'Handholding completion', completed: 'Handholding completed',
    completedShort: 'Completed',
  },
  surveillance: {
    kpis: ['Registered units', 'Surveillance completed', 'Bronze completed', 'Silver completed', 'Gold completed'],
    certifications: CERTIFICATIONS, certLabel: 'Certification', completedDate: 'Surveillance completion', completed: 'Surveillance completed',
    completedShort: 'Completed',
  },
};

/** "Who is registering": the parts of each bar in a fixed order of shades (the API sorts by count); beyond four: grey. */
// 2026-11-18 (the user: staff pages 'not aligned with SVG files'): staff-00's shades for the splits and the trend.
const SPLIT_COLORS = ['#24666b', '#3ba3ad', '#a9d6da', '#d9eaeb'];
const GENDER_COLORS: Record<string, string> = { male: '#24666b', female: '#e39a78', others: '#c9d5d6' };
/** The trend's series: registrations (teal) and completions (green), as the approved design. */
const TREND_COLORS = ['#3ba3ad', '#2f9e58'];

/**
 * Staff dashboard figures (all three portals, worded by ANALYTICS_WORDS): the ministry's Power BI "ZED Dashboard" and "ZED
 * Certification" pages in one view, from api/staff/dashboard/analytics. The page shows the date basis, the Updated time,
 * Refresh and Export in its head through views, view(), setView(), data() and load().
 * 2026-11-17 (approved staff redesign): filters in one row in a card with Clear all; six headline tiles with this month's
 * figures when the range reaches this month; what the page projects with [anAttention] (Needs your attention), then the status
 * cards (the page's content); the monthly / yearly trend beside "Who is registering" (size, gender and social category as
 * stacked bars); the top states, districts and two-digit activities with View all.
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): as staff-00: the filters in one 38px row (State 210,
 * District 210, Certification 190, two 150 dates, More Filters 150, Clear All at the right, always shown); 80px headline
 * tiles in the design's colours with this month's figure (green, "+312 this month") right-aligned on the label line; the
 * monthly trend always over the last 12 months (empty months as 0) with the Monthly / Yearly switch small at the right;
 * "10 Food products" style sector names.
 */
@Component({
  selector: 'zed-staff-analytics',
  imports: [FormsModule, GroupedColumnChart, RankList, StackedBar],
  template: `
    <section class="an" [class.is-busy]="loading()" aria-label="ZED figures">
      <div class="an-box">
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
              @for (c of certifications(); track c) { <option [value]="c">{{ levelName(c) }}</option> }
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
          <div class="an-more-btn no-export">
            <button type="button" class="btn an-more-toggle" [attr.aria-expanded]="moreOpen()" aria-controls="an-more" (click)="moreOpen.set(!moreOpen())">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
              More Filters{{ moreCount() ? ' (' + moreCount() + ')' : '' }}
            </button>
          </div>
          <div class="an-clear no-export">
            <button type="button" class="btn btn-link dash-reset" [disabled]="!filtered()" (click)="reset()">Clear All</button>
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
            <label class="form-label" for="an-size">MSME size</label>
            <select id="an-size" class="form-select" [ngModel]="filter().size ?? ''" (ngModelChange)="set('size', $event)">
              <option value="">All</option>
              @for (s of sizes; track s) { <option [value]="s">{{ s }}</option> }
            </select>
          </div>
          <div class="filter">
            <label class="form-label" for="an-social">Social category</label>
            <select id="an-social" class="form-select" [ngModel]="filter().socialCategory ?? ''" (ngModelChange)="set('socialCategory', $event)">
              <option value="">All</option>
              @for (s of socialCategories; track s) { <option [value]="s">{{ s }}</option> }
            </select>
          </div>
          <!-- 2026-11-16 (approved): Manufacturing / Services; fixed for a login limited to one sector. -->
          <div class="filter">
            <label class="form-label" for="an-sector">Sector</label>
            <select id="an-sector" class="form-select" [disabled]="!!data()?.boundSector" [ngModel]="filter().sector ?? ''" (ngModelChange)="set('sector', $event)">
              <option value="">All</option>
              <option value="Manufacturing">Manufacturing</option>
              <option value="Services">Services</option>
            </select>
          </div>
        </div>
        @if (chips().length) {
          <div class="an-chips" aria-label="Filters set">
            @for (c of chips(); track c.key) {
              <span class="an-chip">{{ c.label }}
                @if ((c.key !== 'state' || !data()?.boundState) && (c.key !== 'sector' || !data()?.boundSector)) {
                  <button type="button" class="no-export" [attr.aria-label]="'Remove ' + c.label" (click)="set(c.key, '')">×</button>
                }
              </span>
            }
          </div>
        }
      </div>

      @if (error()) {
        <div class="alert alert-danger" role="alert">{{ error() }} <button type="button" class="btn btn-link p-0 ms-1" (click)="load()">Try Again</button></div>
      }

      @if (data()) {
        <div class="an-kpis" data-export="headline" [style.--n]="kpis().length">
          @for (k of kpis(); track k.label) {
            <div class="an-kpi" [style.--accent]="k.color">
              <span class="an-kpi-value">{{ k.value }}</span>
              <span class="an-kpi-line"><span class="an-kpi-label" [title]="k.label">{{ k.label }}</span>
                @if (k.note) { <span class="an-kpi-note" [attr.title]="k.tip">{{ k.note }}</span> }</span>
            </div>
          }
        </div>
      }

      <ng-content select="[anAttention]" />

      <!-- The page's status cards: the user's applications, with the filters. -->
      <div class="an-status" data-export="levels" [class.is-hidden]="!data()">
        <h5 class="an-h">Applications under your charge</h5>
        <ng-content />
      </div>

      @if (data(); as d) {
        <div class="an-mid">
          <div class="an-card an-trend" data-export="trend">
            <div class="an-card-head">
              <span class="an-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8M15 7h6v6" /></svg></span>
              <h5>{{ yearly() ? 'Year-wise trend' : 'Monthly trend · last 12 months' }}</h5>
              <ul class="an-legend">
                @for (s of trendSeries; track s; let i = $index) { <li><span [style.background]="trendColors[i]"></span>{{ s }}</li> }
              </ul>
              <!-- The approved Monthly / Yearly switch (not in staff-00): small, after the legend. -->
              <div class="an-period no-export" role="group" aria-label="Trend by">
                <button type="button" [class.on]="!yearly()" [attr.aria-pressed]="!yearly()" (click)="yearly.set(false)">Monthly</button>
                <button type="button" [class.on]="yearly()" [attr.aria-pressed]="yearly()" (click)="yearly.set(true)">Yearly</button>
              </div>
            </div>
            @if (trend().length) {
              <zed-grouped-column-chart [items]="trend()" [series]="trendSeries" [colors]="trendColors" [legend]="false"
                [ariaLabel]="'Registrations and ' + words.completed.toLowerCase() + ' by ' + (yearly() ? 'year' : 'month')" />
            } @else { <div class="no-data">No data in this range</div> }
          </div>
          <div class="an-card an-who" data-export="who">
            <div class="an-card-head">
              <span class="an-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 19v-1a4 4 0 0 0-3-3.9" /></svg></span>
              <h5>Who is registering</h5>
            </div>
            <div class="an-splits">
              <zed-stacked-bar heading="MSME size" [items]="categorical(d.sizes)" />
              <zed-stacked-bar heading="Gender" [items]="genders()" />
              <zed-stacked-bar heading="Social category" [items]="categorical(d.socialCategories)" />
            </div>
          </div>
        </div>

        <div class="an-ranks" data-export="tables">
          <zed-rank-list heading="Top states" [valueHeading]="unitWord()" [items]="ranked(d.states)" />
          <zed-rank-list heading="Top districts" [valueHeading]="unitWord()" [items]="ranked(d.districts)" />
          <zed-rank-list heading="Top sectors (two-digit activity)" [valueHeading]="unitWord()" [items]="ranked(d.activities, true)" />
        </div>
      } @else if (loading()) {
        <div class="an-loading" role="status">Loading the figures…</div>
      }
    </section>
  `,
  styles: `
    .an.is-busy .an-kpis, .an.is-busy .an-mid, .an.is-busy .an-ranks { opacity: .55; transition: opacity .15s; }
    .an-status.is-hidden { display: none; }
    .an-box, .an-kpi, .an-card { background: #fff; border: 1px solid #dde7e8; border-radius: 14px; box-shadow: 0 3px 10px rgba(16, 61, 64, .06); }
    .an-box { padding: 10px 16px 9px; margin-bottom: 16px; }
    .an-filters { display: flex; flex-wrap: wrap; gap: 10px 12px; align-items: flex-end; }
    .an-filters > .filter { flex: 0 1 210px; min-width: 150px; max-width: none; }
    .an-filters > .filter:nth-child(3) { flex-basis: 190px; }
    .an-filters > .an-range { flex: 0 1 336px; }
    .an .form-label { display: block; margin-bottom: 5px; font-size: 11.5px; font-weight: 600; line-height: 14px; color: #6f8487; }
    .an .form-select, .an .form-control { min-height: 38px; height: 38px; padding: 0 28px 0 12px; font-size: 13px; font-weight: 500; color: #17373b; border-color: #b9cdcf; }
    .an .form-select:disabled { background-color: #f3f6f6; border-color: #dde7e8; color: #6f8487; }
    .an-more { margin-top: 12px; padding: 12px; background: #f7fafa; border-radius: 10px; }
    .an-more[hidden] { display: none; }
    .an-range-inputs { display: flex; align-items: center; gap: 12px; }
    .an-range-inputs .form-control { flex: 1 1 150px; min-width: 0; padding-right: 8px; }
    .an-range-to { font-size: 12.5px; font-weight: 500; color: #6f8487; }
    .an-more-toggle { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-width: 150px; height: 38px; padding: 0 14px; white-space: nowrap;
      background: #e7eeee; color: #17373b; font-size: 13.5px; font-weight: 700; border: 0; border-radius: 9px; text-transform: none; }
    .an-more-toggle:hover { background: #dbe7e8; }
    svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .an-clear { margin-left: auto; align-self: center; padding-top: 19px; }
    .dash-reset { font-size: 12.5px; font-weight: 700; color: #6f8487; white-space: nowrap; padding: 4px; text-decoration: none; text-transform: none; }
    .dash-reset:disabled { color: #6f8487; opacity: .6; }
    .an-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .an-chip { display: inline-flex; align-items: center; gap: 4px; background: #eef6f6; color: #23474a; border: 1px solid #d3e6e7; border-radius: 999px;
      padding: 2px 4px 2px 10px; font-size: 12px; font-weight: 600; }
    .an-chip button { border: 0; background: none; color: var(--zt-mid2, #2a8a8c); font-size: 15px; line-height: 1; padding: 0 4px; }
    .an-kpis { display: grid; grid-template-columns: repeat(var(--n, 6), minmax(0, 1fr)); gap: 16px; margin-bottom: 18px; }
    .an-kpi { --accent: #24666b; display: flex; flex-direction: column; justify-content: center; gap: 3px; min-height: 80px; padding: 8px 16px 8px 18px; min-width: 0; }
    .an-kpi-value { font-size: 24px; font-weight: 800; color: var(--accent); line-height: 28px; font-variant-numeric: tabular-nums; }
    .an-kpi-line { display: flex; align-items: baseline; gap: 6px; min-width: 0; line-height: 17px; }
    .an-kpi-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; font-weight: 500; color: #3d5559; }
    .an-kpi-note { margin-left: auto; flex: none; font-size: 11px; font-weight: 600; color: #2f9e58; white-space: nowrap; }
    .an-h { font-size: 11px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #6f8487; margin: 0 0 10px; }
    .an-card h5 { flex: 1; min-width: 160px; font-size: 16px; font-weight: 700; color: #17373b; margin: 0; }
    .an-status { margin-bottom: 20px; }
    .an-mid { display: grid; grid-template-columns: minmax(0, 2.04fr) minmax(0, 1fr); gap: 20px; margin-bottom: 20px; }
    .an-card { min-width: 0; padding: 0 24px 18px 20px; --h: 170px; }
    .an-card-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-height: 56px; margin: 0 -24px 16px -20px; padding: 8px 24px 8px 20px; border-bottom: 1px solid #dde7e8; }
    .an-ic { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; background: #e6f2f3; color: #24666b; }
    .an-period { display: inline-flex; padding: 2px; border-radius: 7px; background: #f1f5f5; }
    .an-period button { border: 0; background: none; border-radius: 5px; padding: 2px 8px; font-size: 11px; font-weight: 600; color: #6f8487; }
    .an-period button.on { background: #fff; color: #17373b; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
    .an-legend { display: flex; gap: 22px; list-style: none; margin: 0 4px 0 0; padding: 0; font-size: 12px; font-weight: 600; color: #3d5559; }
    .an-legend li { display: flex; align-items: center; gap: 7px; }
    .an-legend span { width: 10px; height: 10px; border-radius: 50%; }
    .an-splits { display: grid; gap: 18px; padding-left: 4px; }
    .an-ranks { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; margin-bottom: 18px; }
    .no-data, .an-loading { padding: 40px; text-align: center; color: #6b7f80; }
    @media (max-width: 1199.98px) { .an-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @media (max-width: 991.98px) { .an-mid, .an-ranks { grid-template-columns: 1fr; } }
    @media (max-width: 767.98px) { .an-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 479.98px) { .an-filters > .filter, .an-filters > .an-range { flex: 1 1 100%; } .an-clear { padding-top: 0; } }`,
})
export class StaffAnalytics {
  private readonly api = inject(DashboardApi);
  private readonly system = inject(STAFF_SYSTEM);
  readonly words = ANALYTICS_WORDS[this.system];
  /**
   * The views (date bases, in the page's head) of the user: a Dashboard Admin those the Admin ticked on this portal
   * (2026-11-07; the server checks them too), everybody else both.
   */
  readonly views: AnalyticsView[] = (() => {
    const user = inject(AuthService).currentUser();
    const all: AnalyticsView[] = ['registered', 'certified'];
    if (user?.roleId !== 10 || !user.screens) return all;
    const mine = all.filter((v) => user.screens!.includes(`${this.system}:dash-${v}`));
    return mine.length ? mine : all;
  })();

  protected readonly states = STATE_NAMES;
  protected readonly sizes = SIZES;
  /** Main: every level (Administration → Certification Levels, the Admin's too; 2026-11-08); elsewhere the portal's own. */
  protected readonly certifications = computed(() => (this.system === 'main' ? levelCodes() : this.words.certifications));
  protected readonly levelName = levelName;
  protected readonly socialCategories = ['General', 'OBC', 'SC', 'ST'];
  protected readonly today = new Date().toISOString().slice(0, 10);

  readonly view = signal<AnalyticsView>(this.views[0]);
  /** More filters (gender, size, social category, sector) open. */
  protected readonly moreOpen = signal(false);
  protected readonly moreCount = computed(() => (['gender', 'size', 'socialCategory', 'sector'] as const).filter((k) => !!this.filter()[k]).length);
  /** The filters that are set, as removable chips. */
  readonly chips = computed(() => {
    const f = this.filter();
    const names: [FilterKey, string][] = [['state', 'State'], ['district', 'District'], ['certification', this.words.certLabel], ['gender', 'Gender'],
      ['size', 'Size'], ['socialCategory', 'Social category'], ['sector', 'Sector'], ['from', 'From'], ['to', 'To']];
    return names.filter(([k]) => !!f[k]).map(([key, name]) => ({ key, label: `${name}: ${this.shown(key, f[key]!)}` }));
  });
  protected readonly filter = signal<Omit<AnalyticsFilter, 'view'>>({});
  /** Read by the page (Updated time in its head). */
  readonly data = signal<Analytics | null>(null);
  /** The status cards' counts with the filters (the page draws the cards). */
  readonly statusCards = output<Row>();
  /** The added levels of the last answer (their status cards, 2026-11-08). */
  readonly otherLevels = signal<NonNullable<Analytics['otherLevels']>>([]);
  readonly loading = signal(false);
  protected readonly error = signal('');
  /** The trend by year instead of by month. */
  protected readonly yearly = signal(false);
  private request = 0;

  readonly filtered = computed(() => this.view() !== 'registered' || Object.values(this.filter()).some((v) => !!v));
  protected readonly unitWord = computed(() => (this.view() === 'certified' ? this.words.completedShort : 'Registered'));

  /** The last month of the trend when it is this month (the range reaches today): this month's registrations and completions. */
  private readonly thisMonth = computed(() => {
    const months = this.data()?.months ?? [];
    const last = months[months.length - 1];
    const now = new Date();
    return last?.period === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` ? last : null;
  });

  /** Registered and completed units (with this month's), then each level (Consultancy: all applications, then the levels). */
  readonly kpis = computed(() => {
    const t = this.data()?.totals;
    if (!t) return [];
    const k = this.words.kpis;
    const m = this.thisMonth();
    // This month's figure, right on the label line: "+312 this month" (registered), "+1,042" (completed).
    const tile = (label: string, n: number, color: string, month?: number) => {
      const plus = month === undefined ? null : `+${formatCount(month)}`;
      return {
        label, n, value: formatCount(n), color, month: month ?? null, tip: plus ? `${plus} this month` : null,
        note: plus && label === k[0] ? `${plus} this month` : plus && label === k[1] ? plus : null,
      };
    };
    return [
      tile(k[0], t.registered, '#24666b', m?.registered),
      tile(k[1], t.certified, '#2f9e58', m?.certified),
      tile(k[2], t.bronze, this.words.certifications.includes('Bronze') ? LEVEL_COLORS['Bronze'] : '#6250d6'),
      tile(k[3], t.silver, LEVEL_COLORS['Silver']),
      tile(k[4], t.gold, LEVEL_COLORS['Gold']),
      ...(k[5] ? [tile(k[5], t.zedx ?? 0, '#3c8f99')] : []),
    ];
  });

  /** The trend's two series: registrations and completions, each counted by its own date. */
  protected readonly trendSeries = ['Registered', this.words.completed];
  protected readonly trendColors = TREND_COLORS;

  /**
   * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): always the 12 months up to the To date's month (else
   * this month), named "Nov" under the axis ("Nov 2026" in the tooltip); a month without figures is drawn as 0.
   */
  protected readonly months = computed<TrendPoint[]>(() => {
    const byPeriod = new Map((this.data()?.months ?? []).map((m) => [m.period, m]));
    const to = this.filter().to;
    const end = to ? new Date(+to.slice(0, 4), +to.slice(5, 7) - 1, 1) : new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(end.getFullYear(), end.getMonth() - 11 + i, 1);
      const m = byPeriod.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      return { label: MONTHS[d.getMonth()], tip: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, values: [m?.registered ?? 0, m?.certified ?? 0] };
    });
  });
  protected readonly years = computed<TrendPoint[]>(() =>
    (this.data()?.years ?? []).map((y) => ({ label: y.period, values: [y.registered, y.certified] })),
  );
  protected readonly trend = computed(() => (this.yearly() ? this.years() : this.months()));

  protected readonly genders = computed<ChartItem[]>(() =>
    (this.data()?.genders ?? []).map((g) => ({ label: genderLabel(g.label), value: g.total, color: GENDER_COLORS[g.label.toLowerCase()] ?? '#9aa9ab' })),
  );

  constructor() {
    void this.load();
  }

  /** Categories in a fixed order of shades by their place in the list (the API sorts by count); beyond four: grey. */
  protected categorical(items: CountItem[]): ChartItem[] {
    return items.map((it, i) => ({ label: it.label, value: it.total, color: SPLIT_COLORS[i] ?? '#9aa9ab' }));
  }

  /** activity: "10-Manufacture of food products" shown as "10 Food products" (the export keeps the full name). */
  protected ranked(items: CountItem[], activity = false): ChartItem[] {
    return items.map((it) => ({ label: activity ? activityLabel(it.label) : it.label, value: it.total }));
  }

  /** The date basis as the head's switch says it. */
  basisLabel(view: AnalyticsView = this.view()): string {
    return view === 'registered' ? 'By registration date' : `By ${this.words.completedDate.toLowerCase()} date`;
  }

  /** What the date range applies to: the registration or the certification date. */
  setView(view: AnalyticsView): void {
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
      // Added levels' counts under the same kind of names as ZED-X's (PLATINUMTotal, SaPLATINUMPending, ...).
      const extra: Row = {};
      for (const l of d.otherLevels ?? []) {
        Object.assign(extra, {
          [`${l.code}Total`]: l.total, [`Sa${l.code}Pending`]: l.pending, [`${l.code}NcRaised`]: l.ncRaised,
          [`Sa${l.code}Completed`]: l.certified, [`${l.code}Rejected`]: l.rejected,
        });
      }
      this.statusCards.emit({ ...(d.statusCards ?? {}), ...extra });
      this.otherLevels.set(d.otherLevels ?? []);
      if (d.boundState && this.filter().state !== d.boundState) this.filter.update((f) => ({ ...f, state: d.boundState! }));
      if (d.boundSector && this.filter().sector !== d.boundSector) this.filter.update((f) => ({ ...f, sector: d.boundSector! }));
    } catch (err) {
      if (id === this.request) this.error.set(apiErrorMessage(err));
    } finally {
      if (id === this.request) this.loading.set(false);
    }
  }

  // ---- Export (2026-11-17): the figures on screen as sheets, and the filters as the pop-up's chips. ----

  /** The pop-up's "Filters applied": the date basis, State and the level (All when not set), then every other filter set. */
  exportFilters(): string[] {
    const f = this.filter();
    return [
      this.basisLabel(), `State: ${f.state || 'All'}`, `${this.words.certLabel}: ${f.certification ? levelName(f.certification) : 'All'}`,
      ...this.chips().filter((c) => c.key !== 'state' && c.key !== 'certification').map((c) => c.label),
    ];
  }

  /** Every filter with its value, and when the figures were read. */
  filterSheet(): KeyedSheet {
    const f = this.filter();
    const at = this.data()?.generatedAt;
    const keys: [FilterKey, string][] = [['state', 'State'], ['district', 'District'], ['certification', this.words.certLabel], ['gender', 'Gender'],
      ['size', 'MSME size'], ['socialCategory', 'Social category'], ['sector', 'Sector'], ['from', 'From'], ['to', 'To']];
    return {
      name: 'Filters', keys: 1, columns: ['Filter', 'Value'], rows: [
        ['Count by', this.basisLabel()],
        ...keys.map(([k, name]) => [name, f[k] ? this.shown(k, f[k]!) : k === 'from' || k === 'to' ? '' : 'All']),
        ['Updated', at ? formatDate(at, 'dd-MM-yyyy HH:mm', 'en-US') : ''],
      ],
    };
  }

  /** The headline tiles: the count, and this month's when the trend gives it. */
  headlineSheet(): KeyedSheet {
    return { name: 'Headline numbers', keys: 1, columns: ['Figure', 'Count', 'This month'], rows: this.kpis().map((k) => [k.label, k.n, k.month]) };
  }

  /** The monthly and the yearly trend. */
  trendSheets(): KeyedSheet[] {
    const d = this.data();
    const columns = (first: string) => [first, 'Registered', this.words.completed];
    return [
      { name: 'Monthly trend', keys: 1, columns: columns('Month'), rows: (d?.months ?? []).map((m) => [monthLabel(m.period, true), m.registered, m.certified]) },
      { name: 'Yearly trend', keys: 1, columns: columns('Year'), rows: (d?.years ?? []).map((y) => [y.period, y.registered, y.certified]) },
    ];
  }

  /** MSME size, gender and social category with their shares, in one sheet. */
  whoSheet(): KeyedSheet {
    const d = this.data();
    const part = (name: string, items: CountItem[], label: (s: string) => string = (s) => s) => {
      const total = items.reduce((a, i) => a + i.total, 0);
      return items.map((i) => [name, label(i.label), i.total, sharePercent(i.total, total)]);
    };
    return {
      name: 'Who is registering', keys: 2, columns: ['Category', 'Group', 'Units', 'Share (%)'],
      rows: [...part('MSME size', d?.sizes ?? []), ...part('Gender', d?.genders ?? [], genderLabel), ...part('Social category', d?.socialCategories ?? [])],
    };
  }

  /** Every state, district and two-digit activity, ranked by count. */
  tableSheets(): KeyedSheet[] {
    const d = this.data();
    const units = `${this.unitWord()} units`;
    const table = (name: string, heading: string, items: CountItem[]): KeyedSheet => ({
      name, keys: 2, columns: ['Rank', heading, units],
      rows: [...items].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label)).map((i, n) => [n + 1, i.label, i.total]),
    });
    return [table('States', 'State', d?.states ?? []), table('Districts', 'District', d?.districts ?? []),
      table('Sectors', 'Sector (two-digit activity)', d?.activities ?? [])];
  }

  /** A filter's value as people read it (Gender: "Male", a level: its name). */
  private shown(key: FilterKey, v: string): string {
    return key === 'gender' ? genderLabel(v) : v;
  }
}

/** "10-Manufacture of food products" -> "10 Food products"; other names as they are. */
export function activityLabel(v: string): string {
  const m = /^(\d{2})\s*-\s*(?:manufacture of\s+)?(.+)$/i.exec(v.trim());
  return m ? `${m[1]} ${m[2].charAt(0).toUpperCase()}${m[2].slice(1)}` : v;
}

function genderLabel(v: string): string {
  return GENDER_LABELS[v.toLowerCase()] ?? v;
}

/** "2025-12" -> "Dec 25" (chart) or "Dec 2025" (export). */
function monthLabel(period: string, fullYear: boolean): string {
  const [y, mo] = period.split('-').map(Number);
  return mo ? `${MONTHS[mo - 1]} ${fullYear ? y : String(y).slice(2)}` : period;
}
