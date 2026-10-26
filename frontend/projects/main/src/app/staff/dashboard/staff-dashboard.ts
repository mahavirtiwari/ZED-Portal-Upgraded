import { DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { Counts, CountsFilter, DashboardApi, Row } from './dashboard.api';
import { SIZES, STATE_NAMES, text } from './dashboard-filters';
import { PortalSystem } from '../../portal-system';
import { STAFF_SYSTEM } from '../staff-menu';
import { StaffAnalytics } from './analytics';
import { exportElement } from './export';

interface Card {
  css: string;
  title: string;
  /** `fixed`: a number the template printed as it is (Surveillance's Bronze "NC Raised: 0"). */
  lines: { label: string; field: string; fixed?: string }[];
}

/**
 * The certification cards of Views/Dashboard/Index.cshtml (column names of SP_DASHBOARD_GET_DETAILS). V4: without the
 * Financial Assistance card (removed from the dashboard on request, 2026-10-27; Financial Support has its own page).
 */
const MAIN_CARDS: Card[] = [
  {
    css: 'panel-bronze', title: 'BRONZE CERTIFICATION', lines: [
      { label: 'Total Application', field: 'BronzeTotal' }, { label: 'Assessment Pending', field: 'BronzePending' },
      { label: 'NC Raised', field: 'BronzeNcRaised' }, { label: 'Certified', field: 'BronzeCompleted' }, { label: 'Rejected', field: 'BronzeRejected' },
    ],
  },
  {
    css: 'panel-silver', title: 'SILVER CERTIFICATION', lines: [
      { label: 'Total Application', field: 'SilverTotal' }, { label: 'Assessment Pending', field: 'SaSilverPending' },
      { label: 'NC Raised', field: 'SilverNcRaised' }, { label: 'Certified', field: 'SaSilverCompleted' }, { label: 'Rejected', field: 'SilverRejected' },
    ],
  },
  {
    css: 'panel-gold', title: 'GOLD CERTIFICATION', lines: [
      { label: 'Total Application', field: 'GoldTotal' }, { label: 'Assessment Pending', field: 'SaGoldPending' },
      { label: 'NC Raised', field: 'GoldNcRaised' }, { label: 'Certified', field: 'SaGoldCompleted' }, { label: 'Rejected', field: 'GoldRejected' },
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
  imports: [StaffAnalytics, NgTemplateOutlet, DatePipe, DecimalPipe],
  template: `
    <div class="dash-export" #exportArea>
    <div class="page-head">
      <div>
        <h3 class="registration-title">Dashboard</h3>
        @if (system !== 'main') { <p class="page-sub">Applications under your charge, and the registered and certified units across the portal.</p> }
      </div>
      <div class="page-actions dash-meta">
        @if (analytics(); as an) {
          @if (an.filtered()) { <button type="button" class="btn btn-link p-0 dash-reset no-export" (click)="an.reset()">Clear filters</button> }
          @if (an.data(); as d) { <span class="muted">Updated {{ d.generatedAt | date: 'dd-MM-yyyy HH:mm' }}</span> }
          <button type="button" class="btn btn-outline-primary no-export" [disabled]="an.loading()" (click)="an.load()">Refresh</button>
        }
        <div class="dash-export-menu no-export">
          <button type="button" class="btn btn-primary" [disabled]="exporting()" [attr.aria-expanded]="exportOpen()" aria-haspopup="menu"
                  (click)="exportOpen.set(!exportOpen())">{{ exporting() ? 'Exporting…' : 'Export' }} <span aria-hidden="true">▾</span></button>
          @if (exportOpen()) {
            <ul class="dash-export-list" role="menu">
              <li><button type="button" role="menuitem" (click)="export('jpeg')">Image (JPEG)</button></li>
              <li><button type="button" role="menuitem" (click)="export('pdf')">PDF</button></li>
            </ul>
          }
        </div>
      </div>
    </div>
    @if (exportError()) { <div class="alert alert-danger no-export" role="alert">{{ exportError() }}</div> }
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
    <ng-template #statusCards>
    @if (system === 'main') {
      <!-- Main: per level the total in the band, the share of each status as a bar, then the four statuses. -->
      <div class="app-grid">
        @for (card of cards; track card.title) {
          <div class="app-card" [class]="card.css">
            <div class="app-band">
              <span class="app-level">{{ levelName(card) }}</span>
              <span class="app-total">
                <span class="app-total-value" [attr.data-field]="card.lines[0].field">{{ value(card.lines[0].field) }}</span>
                <span class="app-total-label">{{ card.lines[0].label }}</span>
              </span>
            </div>
            <div class="app-body">
              <div class="app-bar" role="img" [attr.aria-label]="barLabel(card)">
                @for (line of card.lines.slice(1); track line.field) {
                  <span [class]="'app-seg is-' + statusKind(line.label)" [style.width.%]="share(card, line.field)" [title]="line.label + ': ' + value(line.field)"></span>
                }
              </div>
              <ul class="app-stats">
                @for (line of card.lines.slice(1); track line.field) {
                  <li [class]="'is-' + statusKind(line.label)">
                    <span class="app-dot" aria-hidden="true"></span>
                    <span class="app-label">{{ line.label }}</span>
                    <span class="app-figure"><span class="app-value" [attr.data-field]="line.field">{{ value(line.field) }}</span>
                      <span class="app-share">({{ share(card, line.field) | number: '1.0-1' }}%)</span></span>
                  </li>
                }
              </ul>
            </div>
          </div>
        }
      </div>
    } @else {
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
    }
    </ng-template>

    @if (system === 'main') {
      <!-- Main: the status cards sit inside the figures, below the totals, and follow the same filters. -->
      <zed-staff-analytics #figures (statusCards)="summary.set($event)"><ng-container [ngTemplateOutlet]="statusCards" /></zed-staff-analytics>
    } @else {
      <ng-container [ngTemplateOutlet]="statusCards" />
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
    </div>
    @if (loading()) {
      <div class="loadingdiv" style="display: block" role="status" aria-live="polite"><div class="loadingimage"><div class="loader"></div><div class="text-center"><small>Please wait ...</small></div></div></div>
    }
  `,
  styles: `
    /* Counter cards: one grid of white cards, the level's colour as the top accent (the old panel-heading colours). */
    /* Main application cards. Status colours: pending amber, NC raised orange, certified green, rejected red (always named). */
    .app-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
    .app-card { --accent: #45a5ad; background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(16, 61, 64, 0.06); }
    .app-band { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 18px; color: #fff;
      background: linear-gradient(90deg, var(--accent), var(--accent2, var(--accent))); }
    .app-level { font-size: 15px; font-weight: 700; letter-spacing: 0.3px; text-transform: uppercase; }
    .app-total { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.1; }
    .app-total-value { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .app-total-label { font-size: 12px; opacity: .9; }
    .app-body { padding: 14px 18px 16px; }
    .app-bar { display: flex; gap: 2px; height: 10px; border-radius: 5px; overflow: hidden; background: #eef3f3; margin-bottom: 14px; }
    .app-seg { height: 100%; min-width: 0; }
    .app-stats { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .app-stats li { display: grid; grid-template-columns: 10px 1fr; grid-template-rows: auto auto; column-gap: 8px; align-items: center;
      padding: 10px 12px; border-radius: 10px; background: #f7fafa; border: 1px solid #edf2f2; }
    .app-dot { width: 10px; height: 10px; border-radius: 50%; grid-row: 1; }
    .app-label { font-size: 12px; color: #5f6f70; grid-row: 1; }
    .app-figure { grid-column: 2; display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; }
    .app-value { font-size: 18px; font-weight: 700; color: #232527; font-variant-numeric: tabular-nums; }
    .app-share { font-size: 13px; color: #6b7f80; font-variant-numeric: tabular-nums; }
    .is-pending .app-dot, .app-seg.is-pending { background: #d99a0b; }
    .is-nc .app-dot, .app-seg.is-nc { background: #e0672a; }
    .is-certified .app-dot, .app-seg.is-certified { background: #1e8a4c; }
    .is-rejected .app-dot, .app-seg.is-rejected { background: #cf3b3b; }
    .dash-export { padding: 4px 2px 10px; }
    .dash-export-menu { position: relative; }
    .dash-export-list { position: absolute; right: 0; top: calc(100% + 4px); z-index: 20; min-width: 160px; list-style: none; margin: 0; padding: 6px;
      background: #fff; border: 1px solid #dfe9ea; border-radius: 10px; box-shadow: 0 8px 24px rgba(16, 61, 64, .15); }
    .dash-export-list button { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 8px 10px; border-radius: 6px;
      font-size: 14px; color: #23474a; }
    .dash-export-list button:hover, .dash-export-list button:focus-visible { background: #eef6f6; }
    .dash-meta { display: flex; align-items: center; gap: 14px; font-size: 13px; }
    .dash-reset { font-weight: 600; }
    .dash-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 16px; margin-bottom: 18px; }
    .dash-card {
      --accent: #45a5ad;
      background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; overflow: hidden;
      box-shadow: 0 2px 8px rgba(16, 61, 64, 0.06); padding: 0 16px 12px;
    }
    /* The level's colour as the title band (as the old panel headings), white text. */
    .dash-card h5 {
      font-size: 14px; font-weight: 700; color: #fff; letter-spacing: 0.3px; margin: 0 -16px 8px; padding: 11px 16px;
      background: linear-gradient(90deg, var(--accent), var(--accent2, var(--accent)));
    }
    .dash-lines { list-style: none; margin: 0; padding: 0; }
    .dash-lines li { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 5px 0; border-bottom: 1px dashed #e4ecec; font-size: 14px; }
    .dash-lines li:last-child { border-bottom: 0; }
    .dash-label { color: #5f6f70; }
    .dash-value { font-weight: 700; color: #232527; font-variant-numeric: tabular-nums; }
    .dash-count { font-size: 32px; font-weight: 700; line-height: 1.1; color: var(--accent); padding-bottom: 4px; }
    .panel-bronze { --accent: #a65f33; --accent2: #c98454; }
    .panel-silver { --accent: #6c7a80; --accent2: #929fa5; }
    .panel-gold { --accent: #9a7410; --accent2: #c39a2c; }
    .panel-finance { --accent: #5b8a2c; --accent2: #7fae49; }
    .panel-empanel { --accent: #2f8a46; --accent2: #4fae66; }
    .panel-consultant { --accent: #2f7c83; --accent2: #45a5ad; }
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
  /** Main: the figures section, whose Clear filters, Updated time and Refresh sit in the page head. */
  protected readonly analytics = viewChild<StaffAnalytics>('figures');
  private readonly exportArea = viewChild<ElementRef<HTMLElement>>('exportArea');
  protected readonly exportOpen = signal(false);
  protected readonly exporting = signal(false);
  protected readonly exportError = signal('');

  /** The whole dashboard as it is on screen (filters, cards, charts) as a JPEG or a one-page PDF. */
  protected async export(format: 'jpeg' | 'pdf'): Promise<void> {
    const el = this.exportArea()?.nativeElement;
    this.exportOpen.set(false);
    if (!el || this.exporting()) return;
    this.exporting.set(true);
    this.exportError.set('');
    try {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      await exportElement(el, format, `ZED-Dashboard-${stamp}`);
    } catch {
      this.exportError.set('The dashboard could not be exported. Please try again.');
    } finally {
      this.exporting.set(false);
    }
  }
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
      // Main: the analytics section brings the cards' counts with its filters; the other portals keep the counts strip.
      if (this.system === 'main') return;
      const [summary] = await Promise.all([firstValueFrom(this.api.summary()), this.loadCounts()]);
      this.summary.set(summary);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** "BRONZE CERTIFICATION" -> "Bronze". */
  protected levelName(card: Card): string {
    const word = card.title.split(' ')[0];
    return word.charAt(0) + word.slice(1).toLowerCase();
  }

  /** The status a card line counts (its colour). */
  protected statusKind(label: string): 'pending' | 'nc' | 'certified' | 'rejected' {
    const l = label.toLowerCase();
    return l.includes('pending') ? 'pending' : l.includes('nc') ? 'nc' : l.includes('reject') ? 'rejected' : 'certified';
  }

  /** A line's share of the card's total applications, in percent. */
  protected share(card: Card, field: string): number {
    const total = this.num(card.lines[0].field);
    return total ? Math.min(100, (this.num(field) / total) * 100) : 0;
  }

  protected barLabel(card: Card): string {
    return card.lines.slice(1).map((l) => `${l.label} ${this.value(l.field)}`).join(', ');
  }

  private num(field: string): number {
    const s = this.summary();
    return s ? Number(text(s, field)) || 0 : 0;
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
