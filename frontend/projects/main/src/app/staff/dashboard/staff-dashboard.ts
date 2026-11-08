import { DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { DashboardApi, Row } from './dashboard.api';
import { text } from './dashboard-filters';
import { PortalSystem } from '../../portal-system';
import { STAFF_SYSTEM } from '../staff-menu';
import { StaffAnalytics } from './analytics';
import { exportElement } from './export';
import { DashboardPortalSwitchComponent, dashboardSystemProvider } from '../dashboard-portal-switch';
import { levelName as adminLevelName } from '../../msme/shared/levels';

interface Card {
  css: string;
  title: string;
  /** The first line is the total; the others its statuses (milestone cards: payment received, completed, per milestone). */
  lines: { label: string; field: string }[];
  /** Consultancy's Silver and Gold handholding: drawn as three milestones. */
  milestones?: true;
  /** A level the Admin added: its name as the Admin wrote it (2026-11-08). */
  name?: string;
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
  {
    // 2026-11-07: ZED-X was missing from the dashboard (its figures: migration 0019, Gold's rules).
    css: 'panel-zedx', title: 'ZED-X CERTIFICATION', lines: [
      { label: 'Total Application', field: 'ZedxTotal' }, { label: 'Assessment Pending', field: 'SaZedxPending' },
      { label: 'NC Raised', field: 'ZedxNcRaised' }, { label: 'Certified', field: 'SaZedxCompleted' }, { label: 'Rejected', field: 'ZedxRejected' },
    ],
  },
];

/**
 * Consultancy (ZEDCS_CONSULTANCY Frontend/Dashboard/Index.cshtml): handholding by milestone and Technology
 * Intervention. MasterAdmin's two count tiles above them are CONSULTANT_TILES.
 */
const CONSULTANCY_CARDS: Card[] = [
  {
    css: 'panel-silver', title: 'Silver Level', milestones: true, lines: [
      { label: 'Total Applications', field: 'SilverTotal' },
      { label: 'Milestone 1 Payment Received', field: 'SilverM1PaymentDone' }, { label: 'Milestone 1 Completed', field: 'SilverCompleted' },
      { label: 'Milestone 2 Payment Received', field: 'SilverM2PaymentDone' }, { label: 'Milestone 2 Completed', field: 'SilverPending' },
      { label: 'Milestone 3 Payment Received', field: 'SilverM3PaymentDone' }, { label: 'Milestone 3 Completed', field: 'SaSilverCompleted' },
    ],
  },
  {
    css: 'panel-gold', title: 'Gold Level', milestones: true, lines: [
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

/**
 * Surveillance (ZEDCS_SURVEILLANCE Frontend/Dashboard/Index.cshtml): no Financial Assistance card. V4: in the order of
 * the main cards; Bronze has no NC Raised (the old card printed a fixed 0).
 */
const SURVEILLANCE_CARDS: Card[] = [
  {
    css: 'panel-bronze', title: 'BRONZE SURVEILLANCE', lines: [
      { label: 'Total Application', field: 'BronzeTotal' }, { label: 'Surveillance Pending', field: 'BronzePending' },
      { label: 'Surveillance Completed', field: 'BronzeCompleted' }, { label: 'Rejected', field: 'BronzeRejected' },
    ],
  },
  {
    css: 'panel-silver', title: 'SILVER SURVEILLANCE', lines: [
      { label: 'Total Application', field: 'SilverTotal' }, { label: 'Surveillance Pending', field: 'SilverPending' },
      { label: 'NC Raised', field: 'SaSilverNcRaised' }, { label: 'Surveillance Completed', field: 'SaSilverCompleted' },
      { label: 'Rejected', field: 'SilverRejected' },
    ],
  },
  {
    css: 'panel-gold', title: 'GOLD SURVEILLANCE', lines: [
      { label: 'Total Application', field: 'GoldTotal' }, { label: 'Surveillance Pending', field: 'GoldPending' },
      { label: 'NC Raised', field: 'SaGoldNcRaised' }, { label: 'Surveillance Completed', field: 'SaGoldCompleted' },
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

/**
 * Staff home dashboard. Port of Views/Dashboard/Index.cshtml: the status cards (scoped to the user by the API). V4, all
 * three portals: instead of the old counts strip, the Power BI pages' "ZED Dashboard" and "ZED Certification" figures
 * (<zed-staff-analytics>, worded for the portal), with the cards inside following the same filters.
 */
@Component({
  selector: 'zed-staff-dashboard',
  providers: [dashboardSystemProvider(['dash-registered', 'dash-certified'])],
  imports: [StaffAnalytics, NgTemplateOutlet, DatePipe, DecimalPipe, DashboardPortalSwitchComponent],
  template: `
    <!-- One Dashboard Admin (2026-11-07): the portal of this screen. -->
    <zed-dashboard-portal-switch [screens]="['dash-registered', 'dash-certified']" />
    <div class="dash-export" #exportArea>
    <div class="page-head">
      <div>
        <h3 class="registration-title">Dashboard</h3>
      </div>
      <div class="page-actions dash-meta">
        @if (analytics(); as an) {
          @if (an.filtered()) { <button type="button" class="btn btn-link p-0 dash-reset no-export" (click)="an.reset()">Clear filters</button> }
          @if (an.data(); as d) { <span class="muted">Updated {{ d.generatedAt | date: 'dd-MM-yyyy HH:mm' }}</span> }
          <button type="button" class="btn btn-outline-primary no-export" [disabled]="an.loading()" (click)="an.load(true)">Refresh</button>
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
            <div class="dash-count" [attr.data-field]="tile.field">{{ value(tile.field, tiles()) }}</div>
          </div>
        }
      </div>
    }
    <ng-template #statusCards>
      <!-- Per level the total in the band, the share of each status as a bar, then the statuses (Consultancy: milestones). -->
      <div class="app-grid">
        @for (card of cardList(); track card.title) {
          @if (card.milestones) {
            <div class="app-card" [class]="card.css + ' ms-card'">
              <div class="app-band">
                <span class="app-level">{{ levelName(card) }}</span>
                <span class="app-total">
                  <span class="app-total-value" [attr.data-field]="card.lines[0].field">{{ value(card.lines[0].field) }}</span>
                  <span class="app-total-label">{{ card.lines[0].label }}</span>
                </span>
              </div>
              <div class="app-body">
                <div class="ms-head" aria-hidden="true"><span></span><span>Payment received</span><span>Completed</span></div>
                <ol class="ms-list">
                  @for (m of milestones(card); track m.no) {
                    <li>
                      <span class="ms-no">Milestone {{ m.no }}</span>
                      @for (part of m.parts; track part.field) {
                        <span class="ms-cell" [class.is-done]="$last">
                          <span class="ms-figure"><span class="app-value" [attr.data-field]="part.field" [attr.title]="part.label">{{ value(part.field) }}</span>
                            <span class="app-share">({{ share(card, part.field) | number: '1.0-1' }}%)</span></span>
                          <span class="ms-bar" aria-hidden="true"><span [style.width.%]="share(card, part.field)"></span></span>
                        </span>
                      }
                    </li>
                  }
                </ol>
              </div>
            </div>
          } @else {
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
                    <span class="app-label" [title]="line.label">{{ line.label }}</span>
                    <span class="app-figure"><span class="app-value" [attr.data-field]="line.field">{{ value(line.field) }}</span>
                      <span class="app-share">({{ share(card, line.field) | number: '1.0-1' }}%)</span></span>
                  </li>
                }
              </ul>
            </div>
          </div>
          }
        }
      </div>
    </ng-template>

    <!-- The status cards sit inside the figures, below the totals, and follow the same filters. -->
    <zed-staff-analytics #figures (statusCards)="summary.set($event)"><ng-container [ngTemplateOutlet]="statusCards" /></zed-staff-analytics>
    </div>
    @if (loading()) {
      <div class="loadingdiv" style="display: block" role="status" aria-live="polite"><div class="loadingimage"><div class="loader"></div><div class="text-center"><small>Please wait ...</small></div></div></div>
    }
  `,
  styles: `
    /* Counter cards: one grid of white cards, the level's colour as the top accent (the old panel-heading colours). */
    /* Main application cards. Status colours: pending amber, NC raised orange, certified green, rejected red (always named). */
    .app-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
    .app-card { background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(16, 61, 64, 0.06); }
    .app-band { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 18px; color: #fff;
      background: linear-gradient(90deg, var(--accent), var(--accent2, var(--accent))); }
    .app-level { font-size: 15px; font-weight: 700; letter-spacing: 0.3px; text-transform: uppercase; }
    .app-total { flex: none; display: flex; flex-direction: column; align-items: flex-end; line-height: 1.1; }
    .app-total-value { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .app-total-label { font-size: 12px; opacity: .9; white-space: nowrap; }
    .app-body { padding: 14px 18px 16px; }
    .app-bar { display: flex; gap: 2px; height: 10px; border-radius: 5px; overflow: hidden; background: #eef3f3; margin-bottom: 14px; }
    .app-seg { height: 100%; min-width: 0; }
    .app-stats { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .app-stats li { display: grid; grid-template-columns: 10px minmax(0, 1fr); grid-template-rows: 30px auto; column-gap: 8px; row-gap: 2px; align-items: start; }
    .app-stats li, .ms-list li { padding: 10px 12px; border-radius: 10px; background: #f7fafa; border: 1px solid #edf2f2; }
    .app-dot { width: 10px; height: 10px; border-radius: 50%; grid-row: 1; margin-top: 2px; }
    .app-label { font-size: 12px; line-height: 15px; color: #5f6f70; grid-row: 1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .app-figure { grid-column: 2; }
    .app-figure, .ms-figure { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; }
    .app-value { font-size: 18px; font-weight: 700; color: #232527; font-variant-numeric: tabular-nums; }
    .app-share { font-size: 13px; color: #6b7f80; font-variant-numeric: tabular-nums; }
    .is-pending .app-dot, .app-seg.is-pending { background: #d99a0b; }
    .is-nc .app-dot, .app-seg.is-nc { background: #e0672a; }
    .is-certified .app-dot, .app-seg.is-certified { background: #1e8a4c; }
    .is-rejected .app-dot, .app-seg.is-rejected { background: #cf3b3b; }
    /* Consultancy's milestone cards: per milestone the payments received and the completions, each with its share. */
    .ms-head, .ms-list li { display: grid; grid-template-columns: 96px 1fr 1fr; gap: 10px; align-items: center; }
    .ms-head { font-size: 12px; font-weight: 600; color: #5f6f70; padding: 0 12px 6px; }
    .ms-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .ms-no { font-size: 13px; font-weight: 700; color: #23474a; }
    .ms-cell { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .ms-bar { display: block; height: 6px; border-radius: 3px; background: #e6eeee; overflow: hidden; }
    .ms-bar > span { display: block; height: 100%; background: #d99a0b; }
    .ms-cell.is-done .ms-bar > span { background: #1e8a4c; }
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
      background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; overflow: hidden;
      box-shadow: 0 2px 8px rgba(16, 61, 64, 0.06); padding: 0 16px 12px;
    }
    /* The level's colour as the title band (as the old panel headings), white text. */
    .dash-card h5 {
      font-size: 14px; font-weight: 700; color: #fff; letter-spacing: 0.3px; margin: 0 -16px 8px; padding: 11px 16px;
      background: linear-gradient(90deg, var(--accent), var(--accent2, var(--accent)));
    }
    .dash-count { font-size: 32px; font-weight: 700; line-height: 1.1; color: var(--accent); padding-bottom: 4px; }
    .panel-bronze { --accent: #a65f33; --accent2: #c98454; }
    .panel-silver { --accent: #6c7a80; --accent2: #929fa5; }
    .panel-gold { --accent: #9a7410; --accent2: #c39a2c; }
    .panel-zedx { --accent: #2f7c83; --accent2: #45a5ad; }
    .panel-finance { --accent: #5b8a2c; --accent2: #7fae49; }
    .panel-empanel { --accent: #2f8a46; --accent2: #4fae66; }
    .panel-consultant { --accent: #2f7c83; --accent2: #45a5ad; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class StaffDashboardPage {
  private readonly api = inject(DashboardApi);

  protected readonly system = inject(STAFF_SYSTEM);
  private readonly fixedCards = DASHBOARD_CARDS[this.system];
  /** The fixed cards, then (main portal) one card per level the Admin added, as ZED-X's (2026-11-08). */
  protected readonly cardList = computed<Card[]>(() => [
    ...this.fixedCards,
    ...(this.system === 'main' ? (this.analytics()?.otherLevels() ?? []) : []).map((l): Card => ({
      css: 'panel-zedx', title: `${l.code} CERTIFICATION`, name: l.name || adminLevelName(l.code), lines: [
        { label: 'Total Application', field: `${l.code}Total` }, { label: 'Assessment Pending', field: `Sa${l.code}Pending` },
        { label: 'NC Raised', field: `${l.code}NcRaised` }, { label: 'Certified', field: `Sa${l.code}Completed` }, { label: 'Rejected', field: `${l.code}Rejected` },
      ],
    })),
  ]);
  /** The figures section, whose Clear filters, Updated time and Refresh sit in the page head. */
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
    const t = this.tiles();
    return t !== null && 'AssessmentAgencies' in t;
  }

  /** The status cards' counts, with the figures' filters (from the analytics section). */
  protected readonly summary = signal<Row | null>(null);
  /** Consultancy: the unfiltered summary, for MasterAdmin's consultant tiles (not a filter of the figures). */
  protected readonly tiles = signal<Row | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');

  constructor() {
    if (this.system === 'consultancy') void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.tiles.set(await firstValueFrom(this.api.summary()));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** "BRONZE CERTIFICATION", "Silver Level" -> "Bronze", "Silver"; other titles as they are. */
  protected levelName(card: Card): string {
    if (card.name) return card.name;
    const m = /^([\w-]+) (certification|surveillance|level)$/i.exec(card.title);
    if (!m) return card.title;
    // "ZED-X" keeps its capitals.
    return m[1].includes('-') ? m[1].toUpperCase() : m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  }

  /** A milestone card's lines after the total: payment received and completed for milestones 1 to 3. */
  protected milestones(card: Card): { no: number; parts: Card['lines'] }[] {
    const lines = card.lines.slice(1);
    return [0, 1, 2].map((i) => ({ no: i + 1, parts: lines.slice(i * 2, i * 2 + 2) }));
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

  protected value(field: string, s = this.summary()): string {
    if (!s) return '';
    const v = text(s, field) || '0';
    // Indian digit grouping, as the figures below (5,12,340).
    return /^\d+$/.test(v) ? Number(v).toLocaleString('en-IN') : v;
  }
}
