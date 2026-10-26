import { Component, inject, signal } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { Counts, CountsFilter, DashboardApi, Row } from './dashboard.api';
import { SIZES, STATE_NAMES, text } from './dashboard-filters';
import { PortalSystem } from '../../portal-system';
import { STAFF_SYSTEM } from '../staff-menu';
import { StaffAnalytics } from './analytics';

interface Card {
  css: string;
  title: string;
  /** `fixed`: a number the template printed as it is (Surveillance's Bronze "NC Raised: 0"). */
  lines: { label: string; field: string; fixed?: string }[];
}

/** The four cards of Views/Dashboard/Index.cshtml (column names of SP_DASHBOARD_GET_DETAILS). */
const MAIN_CARDS: Card[] = [
  {
    css: 'panel-bronze', title: 'BRONZE CERTIFICATION', lines: [
      { label: 'Total Application', field: 'BronzeTotal' }, { label: 'DA Pending', field: 'BronzePending' },
      { label: 'NC Raised', field: 'BronzeNcRaised' }, { label: 'Certified', field: 'BronzeCompleted' }, { label: 'Rejected', field: 'BronzeRejected' },
    ],
  },
  {
    css: 'panel-silver', title: 'SILVER CERTIFICATION', lines: [
      { label: 'Total Application', field: 'SilverTotal' }, { label: 'SA Pending', field: 'SaSilverPending' },
      { label: 'NC Raised', field: 'SilverNcRaised' }, { label: 'Certified', field: 'SaSilverCompleted' }, { label: 'Rejected', field: 'SilverRejected' },
    ],
  },
  {
    css: 'panel-gold', title: 'GOLD CERTIFICATION', lines: [
      { label: 'Total Application', field: 'GoldTotal' }, { label: 'SA Pending', field: 'SaGoldPending' },
      { label: 'NC Raised', field: 'GoldNcRaised' }, { label: 'Certified', field: 'SaGoldCompleted' }, { label: 'Rejected', field: 'GoldRejected' },
    ],
  },
  {
    css: 'panel-finance', title: 'Financial Assistance', lines: [
      { label: 'Total Application', field: 'FaTotal' }, { label: 'Approved', field: 'FaCompleted' },
      { label: 'Pending', field: 'FaPending' }, { label: 'Rejected', field: 'FaRejected' },
    ],
  },
];

/**
 * Consultancy (ZEDCS_CONSULTANCY Frontend/Dashboard/Index.cshtml): handholding by milestone and Technology
 * Intervention. MasterAdmin's two count tiles above them are CONSULTANT_TILES.
 */
const CONSULTANCY_CARDS: Card[] = [
  {
    css: 'panel-silver', title: 'Silver Level', lines: [
      { label: 'Total Applications', field: 'SilverTotal' },
      { label: 'Milestone 1 Payment Received', field: 'SilverM1PaymentDone' }, { label: 'Milestone 1 Completed', field: 'SilverCompleted' },
      { label: 'Milestone 2 Payment Received', field: 'SilverM2PaymentDone' }, { label: 'Milestone 2 Completed', field: 'SilverPending' },
      { label: 'Milestone 3 Payment Received', field: 'SilverM3PaymentDone' }, { label: 'Milestone 3 Completed', field: 'SaSilverCompleted' },
    ],
  },
  {
    css: 'panel-gold', title: 'Gold Level', lines: [
      { label: 'Total Applications', field: 'GoldTotal' },
      { label: 'Milestone 1 Payment Received', field: 'GoldM1PaymentDone' }, { label: 'Milestone 1 Completed', field: 'GoldCompleted' },
      { label: 'Milestone 2 Payment Received', field: 'GoldM2PaymentDone' }, { label: 'Milestone 2 Completed', field: 'GoldPending' },
      { label: 'Milestone 3 Payment Received', field: 'GoldM3PaymentDone' }, { label: 'Milestone 3 Completed', field: 'SaGoldCompleted' },
    ],
  },
  {
    css: 'panel-finance', title: 'Technology Intervention', lines: [
      { label: 'Total Application', field: 'FaTotal' }, { label: 'Approved', field: 'FaCompleted' }, { label: 'Pending', field: 'FaPending' },
    ],
  },
];

/** Surveillance (ZEDCS_SURVEILLANCE Frontend/Dashboard/Index.cshtml): no Financial Assistance card. */
const SURVEILLANCE_CARDS: Card[] = [
  {
    css: 'panel-bronze', title: 'BRONZE SURVEILLANCE', lines: [
      { label: 'Total Application', field: 'BronzeTotal' }, { label: 'Surveillance Pending', field: 'BronzePending' },
      { label: 'Surveillance Completed', field: 'BronzeCompleted' }, { label: 'NC Raised', field: '', fixed: '0' },
      { label: 'Rejected', field: 'BronzeRejected' },
    ],
  },
  {
    css: 'panel-silver', title: 'SILVER SURVEILLANCE', lines: [
      { label: 'Total Application', field: 'SilverTotal' }, { label: 'Surveillance Pending', field: 'SilverPending' },
      { label: 'Surveillance Completed', field: 'SaSilverCompleted' }, { label: 'NC Raised', field: 'SaSilverNcRaised' },
      { label: 'Rejected', field: 'SilverRejected' },
    ],
  },
  {
    css: 'panel-gold', title: 'GOLD SURVEILLANCE', lines: [
      { label: 'Total Application', field: 'GoldTotal' }, { label: 'Surveillance Pending', field: 'GoldPending' },
      { label: 'Surveillance Completed', field: 'SaGoldCompleted' }, { label: 'NC Raised', field: 'SaGoldNcRaised' },
      { label: 'Rejected', field: 'GoldRejected' },
    ],
  },
];

export const DASHBOARD_CARDS: Record<PortalSystem, Card[]> = { main: MAIN_CARDS, consultancy: CONSULTANCY_CARDS, surveillance: SURVEILLANCE_CARDS };

/** Consultancy MasterAdmin's tiles ("dashboard-consultant-block"): count only, the number under the title. */
export const CONSULTANT_TILES = [
  { css: 'panel-empanel', title: 'Empanelled Consultant Organisations', field: 'AssessmentAgencies' },
  { css: 'panel-consultant', title: 'Consultants', field: 'SiteAssessors' },
];

/** Captions of the counts strip; Consultancy's show the TI count where the others show Bronze. */
const STRIP_LABELS: Record<PortalSystem, { total: string; bronze: string }> = {
  main: { total: 'Registered', bronze: 'Bronze' },
  consultancy: { total: 'Application', bronze: 'TI' },
  surveillance: { total: 'Registered', bronze: 'Bronze' },
};

/**
 * Staff home dashboard. Port of Views/Dashboard/Index.cshtml: certification cards (scoped to the user by the
 * API) and registered/certified counts with filters. The counts strip showed placeholder numbers until the
 * request returned; here it shows "-" instead. Main portal (V4): instead of the counts strip, the Power BI pages'
 * "ZED Dashboard" and "ZED Certification" figures (<zed-staff-analytics>).
 */
@Component({
  selector: 'zed-staff-dashboard',
  imports: [StaffAnalytics],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Dashboard</h3>
        <p class="page-sub">{{ system === 'main' ? 'Applications under your charge, then the registered and certified units with their splits.' : 'Applications under your charge, and the registered and certified units across the portal.' }}</p>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">
        {{ error() }} <button type="button" class="btn btn-link" (click)="load()">Try again</button>
      </div>
    }
    @if (showConsultantTiles()) {
      <div class="dash-grid">
        @for (tile of consultantTiles; track tile.field) {
          <div class="dash-card dash-tile" [class]="tile.css">
            <h5>{{ tile.title }}</h5>
            <div class="dash-count" [attr.data-field]="tile.field">{{ value(tile.field) }}</div>
          </div>
        }
      </div>
    }
    <div class="dash-grid">
      @for (card of cards; track card.title) {
        <div class="dash-card" [class]="card.css">
          <h5>{{ card.title }}</h5>
          <ul class="dash-lines">
            @for (line of card.lines; track line.label) {
              <li><span class="dash-label">{{ line.label }}</span><span class="dash-value" [attr.data-field]="line.field || null">{{ line.fixed ?? value(line.field) }}</span></li>
            }
          </ul>
        </div>
      }
    </div>

    @if (system === 'main') {
      <zed-staff-analytics />
    } @else {
    <div class="zed-card">
      <div class="filter-bar mb-3">
        <div class="filter">
          <label class="form-label" for="d-state">Filter by State</label>
          <select class="form-select" id="d-state" (change)="setFilter('state', $event)">
            <option value="">Show All</option>
            @for (s of stateNames; track s) { <option [value]="s">{{ s }}</option> }
          </select>
        </div>
        <div class="filter">
          <label class="form-label" for="d-size">MSME Size</label>
          <select class="form-select" id="d-size" (change)="setFilter('size', $event)">
            <option value="">Show All</option>
            @for (s of sizes; track s) { <option [value]="s">{{ s }}</option> }
          </select>
        </div>
        <div class="filter">
          <label class="form-label" for="d-social">Social Category</label>
          <select class="form-select" id="d-social" (change)="setFilter('socialCategory', $event)">
            <option value="">Show All</option>
            @for (s of socialCategories; track s) { <option [value]="s">{{ s }}</option> }
          </select>
        </div>
        <div class="filter">
          <label class="form-label" for="d-gender">Gender</label>
          <select class="form-select" id="d-gender" (change)="setFilter('gender', $event)">
            <option value="">Show All</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="OTHERS">Others</option>
          </select>
        </div>
      </div>
      <div class="cert-section certDetail-block unitDetail-sec1">
        <div class="registered"><p>{{ stripLabels.total }}</p><h1 id="registered">{{ count('total') }}</h1></div>
        <div class="bronzeVerified"><p>{{ stripLabels.bronze }}</p><h1 id="bronze">{{ count('bronze') }}</h1></div>
        <div class="goldVerified"><p>Gold</p><h1 id="gold">{{ count('gold') }}</h1></div>
        <div class="silverVerified"><p>Silver</p><h1 id="silver">{{ count('silver') }}</h1></div>
      </div>
    </div>
    }
    @if (loading()) {
      <div class="loadingdiv" style="display: block" role="status" aria-live="polite"><div class="loadingimage"><div class="loader"></div><div class="text-center"><small>Please wait ...</small></div></div></div>
    }
  `,
  styles: `
    /* Counter cards: one grid of white cards, the level's colour as the top accent (the old panel-heading colours). */
    .dash-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 16px; margin-bottom: 18px; }
    .dash-card {
      --accent: #45a5ad;
      background: #fff; border: 1px solid #dfe9ea; border-top: 4px solid var(--accent); border-radius: 12px;
      box-shadow: 0 2px 8px rgba(16, 61, 64, 0.06); padding: 14px 16px;
    }
    .dash-card h5 { font-size: 14px; font-weight: 700; color: #23474a; letter-spacing: 0.2px; margin: 0 0 10px; }
    .dash-lines { list-style: none; margin: 0; padding: 0; }
    .dash-lines li { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 5px 0; border-bottom: 1px dashed #e4ecec; font-size: 14px; }
    .dash-lines li:last-child { border-bottom: 0; }
    .dash-label { color: #5f6f70; }
    .dash-value { font-weight: 700; color: #232527; font-variant-numeric: tabular-nums; }
    .dash-count { font-size: 32px; font-weight: 700; line-height: 1.1; color: var(--accent); }
    .panel-bronze { --accent: #d87b62; }
    .panel-silver { --accent: #cdcfd1; }
    .panel-gold { --accent: #ccb160; }
    .panel-finance { --accent: #b3e079; }
    .panel-empanel { --accent: #73d085; }
    .panel-consultant { --accent: #45a5ad; }
    /* The counts strip keeps its graph background; the card gives it the frame. */
    .zed-card .cert-section { border: 0; padding: 0; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class StaffDashboardPage {
  private readonly api = inject(DashboardApi);

  protected readonly system = inject(STAFF_SYSTEM);
  protected readonly cards = DASHBOARD_CARDS[this.system];
  protected readonly stripLabels = STRIP_LABELS[this.system];
  protected readonly consultantTiles = CONSULTANT_TILES;

  /** Consultancy MasterAdmin's tiles, shown when the API sent their columns (it does for MasterAdmin only). */
  protected showConsultantTiles(): boolean {
    const s = this.summary();
    return this.system === 'consultancy' && s !== null && 'AssessmentAgencies' in s;
  }
  protected readonly stateNames = STATE_NAMES;
  protected readonly sizes = SIZES;
  protected readonly socialCategories = ['General', 'SC', 'ST', 'OBC'];

  protected readonly summary = signal<Row | null>(null);
  protected readonly counts = signal<Counts | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  private filter: CountsFilter = {};

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      // Main: the analytics section loads its own figures; the other portals keep the counts strip.
      const [summary] = await Promise.all([firstValueFrom(this.api.summary()), this.system === 'main' ? Promise.resolve() : this.loadCounts()]);
      this.summary.set(summary);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected value(field: string): string {
    const s = this.summary();
    if (!s) return '';
    const v = text(s, field) || '0';
    // Indian digit grouping, as the figures below (5,12,340).
    return /^\d+$/.test(v) ? Number(v).toLocaleString('en-IN') : v;
  }

  protected count(key: keyof Counts): string {
    const c = this.counts();
    return c ? Number(c[key] ?? 0).toLocaleString('en-IN') : '-';
  }

  protected async setFilter(key: keyof CountsFilter, event: Event): Promise<void> {
    this.filter = { ...this.filter, [key]: (event.target as HTMLSelectElement).value };
    this.error.set('');
    try {
      await this.loadCounts();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }

  private async loadCounts(): Promise<void> {
    this.counts.set(await firstValueFrom(this.api.counts(this.filter)));
  }
}
