import { DecimalPipe, NgTemplateOutlet, formatDate } from '@angular/common';
import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { DashboardApi, Row } from './dashboard.api';
import { text } from './dashboard-filters';
import { PortalSystem } from '../../portal-system';
import { STAFF_SYSTEM } from '../staff-menu';
import { StaffAnalytics } from './analytics';
import { NO_EXPORT, exportElement } from './export';
import { DashboardPortalSwitchComponent, dashboardSystemProvider } from '../dashboard-portal-switch';
import { levelName as adminLevelName } from '../../msme/shared/levels';
import { PageHead } from '../../msme/shared/page-head';
import { staffCrumbs } from '../staff-crumbs';
import { TableExport } from '../table-export';
import { AttentionRow } from './attention-row';
import { DashboardExportDialog } from './export-dialog';
import { ExportChoice, ExportSection, KeyedSheet, exportName, flattenSheets, sharePercent } from './dashboard-export';

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
  // 2026-11-16 (approved): handholding towards ZED-X for Gold-certified units (migration 0089).
  {
    css: 'panel-zedx', title: 'ZED-X Level', milestones: true, lines: [
      { label: 'Total Applications', field: 'ZEDXTotal' },
      { label: 'Milestone 1 Payment Received', field: 'ZEDXM1PaymentDone' }, { label: 'Milestone 1 Completed', field: 'ZEDXCompleted' },
      { label: 'Milestone 2 Payment Received', field: 'ZEDXM2PaymentDone' }, { label: 'Milestone 2 Completed', field: 'ZEDXPending' },
      { label: 'Milestone 3 Payment Received', field: 'ZEDXM3PaymentDone' }, { label: 'Milestone 3 Completed', field: 'SaZEDXCompleted' },
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
 * 2026-11-17 (approved staff redesign): the shared page head (the date basis, Refresh and Export as its buttons, the
 * Updated time under the title); "Needs your attention" above the cards; per level one stacked bar and its legend; Export
 * as a pop-up (sections and Excel / CSV / PDF).
 */
@Component({
  selector: 'zed-staff-dashboard',
  providers: [dashboardSystemProvider(['dash-registered', 'dash-certified'])],
  imports: [StaffAnalytics, NgTemplateOutlet, DecimalPipe, DashboardPortalSwitchComponent, PageHead, AttentionRow, DashboardExportDialog],
  template: `
    <!-- One Dashboard Admin (2026-11-07): the portal of this screen. -->
    <zed-dashboard-portal-switch [screens]="['dash-registered', 'dash-certified']" />
    <div class="dash-export" #exportArea>
    <zed-page-head [crumbs]="crumbs" title="Dashboard" [subtitle]="updated()">
      @if (analytics(); as an) {
        @if (an.views.length > 1) {
          <div class="dash-basis" role="tablist" aria-label="Count by">
            @for (v of an.views; track v) {
              <button type="button" role="tab" class="an-basis-tab" [attr.data-view]="v" [class.active]="an.view() === v" [attr.aria-selected]="an.view() === v"
                      (click)="an.setView(v)">{{ an.basisLabel(v) }}</button>
            }
          </div>
        }
        <button type="button" class="btn btn-ph dash-refresh no-export" [disabled]="an.loading()" (click)="refresh()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg> Refresh
        </button>
        <button type="button" class="btn btn-primary dash-export-btn no-export" [disabled]="!an.data() || exporting()" aria-haspopup="dialog" (click)="openExport()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" /></svg> {{ exporting() ? 'Exporting…' : 'Export' }}
        </button>
      }
    </zed-page-head>
    @if (error()) {
      <div class="alert alert-danger" role="alert">
        {{ error() }} <button type="button" class="btn btn-link" (click)="load()">Try again</button>
      </div>
    }
    @if (showConsultantTiles()) {
      <div class="dash-grid" data-export="headline">
        @for (tile of consultantTiles; track tile.field) {
          <div class="dash-card dash-tile" [class]="tile.css">
            <h5>{{ tile.title }}</h5>
            <div class="dash-count" [attr.data-field]="tile.field">{{ value(tile.field, tiles()) }}</div>
          </div>
        }
      </div>
    }
    <ng-template #statusCards>
      <!-- Per level the total in the band, the share of each status as one bar and its legend (Consultancy: milestones). -->
      <div class="app-grid">
        @for (card of cardList(); track card.title) {
          @if (card.milestones) {
            <div class="app-card" [class]="card.css + ' ms-card'">
              <div class="app-band">
                <span class="app-level">{{ levelName(card) }}</span>
                <span class="app-total">
                  <span class="app-total-value" [attr.data-field]="card.lines[0].field">{{ value(card.lines[0].field) }}</span>
                  <span class="app-total-label">total applications</span>
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
                <span class="app-total-label">total applications</span>
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

    <!-- The attention row and the status cards sit inside the figures, below the totals; the cards follow the same filters. -->
    <zed-staff-analytics #figures (statusCards)="summary.set($event)">
      <zed-attention-row anAttention />
      <ng-container [ngTemplateOutlet]="statusCards" />
    </zed-staff-analytics>
    </div>
    @if (exportOpen()) {
      <zed-dashboard-export [filters]="exportFilters()" [busy]="exporting()" [error]="exportError()" (export)="runExport($event)" (close)="closeExport()" />
    }
    @if (loading()) {
      <div class="loadingdiv" style="display: block" role="status" aria-live="polite"><div class="loadingimage"><div class="loader"></div><div class="text-center"><small>Please wait ...</small></div></div></div>
    }
  `,
  styles: `
    /* Head: the date basis as a two-way switch, then Refresh (grey) and Export. */
    .dash-basis { display: inline-flex; padding: 3px; border-radius: 9px; background: #e8eff0; }
    .an-basis-tab { border: 0; background: none; border-radius: 7px; padding: 6px 16px; font-size: 13.5px; font-weight: 600; color: var(--zt-ink, #173f44); }
    .an-basis-tab.active { background: var(--zt-dark, #1f5c61); color: #fff; }
    .dash-export-btn { background: var(--zt-dark, #1f5c61); border-color: var(--zt-dark, #1f5c61); border-radius: 8px; padding: 8px 18px; text-transform: none; }
    svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    /* Level cards: the level's colour as the band; one bar of the statuses and a legend under it. Status colours: pending
       amber, NC raised orange, certified green, rejected grey (always named). */
    .app-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
    .app-card, .dash-card { background: #fff; border: 1px solid #e1eaea; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(16, 61, 64, .05); }
    .app-band { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 18px; color: #fff;
      background: linear-gradient(90deg, var(--accent), var(--accent2, var(--accent))); }
    .app-level { font-size: 14px; font-weight: 800; letter-spacing: .6px; text-transform: uppercase; }
    .app-total { flex: none; display: flex; flex-direction: column; align-items: flex-end; line-height: 1.1; }
    .app-total-value { font-size: 21px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .app-total-label { font-size: 11.5px; opacity: .92; white-space: nowrap; }
    .app-body { padding: 16px 18px 14px; }
    .app-bar { display: flex; gap: 2px; height: 8px; border-radius: 4px; overflow: hidden; background: #eef3f3; margin-bottom: 14px; }
    .app-seg { height: 100%; min-width: 0; }
    .app-stats { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; }
    .app-stats li { display: grid; grid-template-columns: 8px minmax(0, 1fr); column-gap: 7px; align-items: center; align-content: start; }
    .app-dot { width: 8px; height: 8px; border-radius: 50%; }
    .app-label { font-size: 12px; line-height: 1.3; color: #5f6f70; overflow-wrap: anywhere; }
    .app-figure { grid-column: 2; }
    .app-figure, .ms-figure { display: flex; align-items: baseline; flex-wrap: wrap; gap: 5px; }
    .app-value { font-size: 15px; font-weight: 800; color: var(--zt-ink, #173f44); font-variant-numeric: tabular-nums; }
    .app-share { font-size: 12px; color: #6b7f80; font-variant-numeric: tabular-nums; }
    .is-pending .app-dot, .app-seg.is-pending { background: #e08a1e; }
    .is-nc .app-dot, .app-seg.is-nc { background: #e5603e; }
    .is-certified .app-dot, .app-seg.is-certified { background: #2e9a5a; }
    .is-rejected .app-dot, .app-seg.is-rejected { background: #a3adb0; }
    /* Consultancy's milestone cards: per milestone the payments received and the completions, each with its share. */
    .ms-head, .ms-list li { display: grid; grid-template-columns: 88px 1fr 1fr; gap: 10px; align-items: center; }
    .ms-head { font-size: 11.5px; font-weight: 600; color: #5f6f70; padding-bottom: 6px; }
    .ms-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
    .ms-no { font-size: 12.5px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .ms-cell { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .ms-bar { display: block; height: 6px; border-radius: 3px; background: #e6eeee; overflow: hidden; }
    .ms-bar > span { display: block; height: 100%; background: #e08a1e; }
    .ms-cell.is-done .ms-bar > span { background: #2e9a5a; }
    .dash-export { padding: 4px 2px 10px; }
    /* Consultancy Master Admin's organisation and consultant counts, as the headline tiles. */
    .dash-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 14px; margin-bottom: 16px; }
    .dash-card { display: flex; flex-direction: column-reverse; gap: 2px; padding: 14px 16px; border-top: 3px solid var(--accent); }
    .dash-card h5 { font-size: 13px; font-weight: 600; color: #3b4b4c; margin: 0; }
    .dash-count { font-size: 24px; font-weight: 800; line-height: 1.15; color: var(--accent); }
    .panel-bronze { --accent: #b85a35; --accent2: #d98a62; }
    .panel-silver { --accent: #7d8b92; --accent2: #a7b2b7; }
    .panel-gold { --accent: #b8890f; --accent2: #d8b443; }
    .panel-zedx { --accent: #237a80; --accent2: #3fa3a8; }
    .panel-finance { --accent: #5b8a2c; --accent2: #7fae49; }
    .panel-empanel { --accent: #2f8a46; --accent2: #4fae66; }
    .panel-consultant { --accent: #237a80; --accent2: #3fa3a8; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    @media (max-width: 575.98px) { .dash-basis { display: flex; width: 100%; } .an-basis-tab { flex: 1 1 0; padding: 6px 8px; } }
  `,
})
export class StaffDashboardPage {
  private readonly api = inject(DashboardApi);
  private readonly tables = inject(TableExport);

  protected readonly crumbs = staffCrumbs({ label: 'Dashboard' });
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
  /** The figures section, whose date basis, Updated time and Refresh sit in the page head. */
  protected readonly analytics = viewChild<StaffAnalytics>('figures');
  private readonly attention = viewChild(AttentionRow);
  private readonly exportArea = viewChild<ElementRef<HTMLElement>>('exportArea');
  protected readonly updated = computed(() => {
    const at = this.analytics()?.data()?.generatedAt;
    return at ? `Updated ${formatDate(at, 'dd-MM-yyyy HH:mm', 'en-US')}` : null;
  });
  protected readonly exportOpen = signal(false);
  protected readonly exporting = signal(false);
  protected readonly exportError = signal('');
  protected readonly exportFilters = computed(() => this.analytics()?.exportFilters() ?? []);

  protected refresh(): void {
    void this.analytics()?.load(true);
    this.attention()?.refresh();
  }

  protected openExport(): void {
    this.exportError.set('');
    this.exportOpen.set(true);
  }

  protected closeExport(): void {
    if (!this.exporting()) this.exportOpen.set(false);
  }

  /** Excel / CSV: the chosen sections of the loaded figures (TableExport); PDF: the page as on screen with those sections only. */
  protected async runExport(choice: ExportChoice): Promise<void> {
    const an = this.analytics();
    if (!an || this.exporting()) return;
    this.exporting.set(true);
    this.exportError.set('');
    const name = exportName();
    try {
      if (choice.format === 'pdf') {
        await this.exportPdf(choice.sections, name);
      } else {
        const sheets = this.sheets(an, choice.sections);
        if (choice.format === 'xlsx') await this.tables.xlsx(name, sheets);
        else this.tables.csv(name, flattenSheets('ZED Dashboard', sheets));
      }
      this.exportOpen.set(false);
    } catch {
      this.exportError.set('The dashboard could not be exported. Please try again.');
    } finally {
      this.exporting.set(false);
    }
  }

  /** The filters, then the chosen sections in the page's order. */
  private sheets(an: StaffAnalytics, sections: ExportSection[]): KeyedSheet[] {
    const has = (s: ExportSection) => sections.includes(s);
    const out: KeyedSheet[] = [an.filterSheet()];
    if (has('headline')) {
      const head = an.headlineSheet();
      if (this.showConsultantTiles()) head.rows.push(...this.consultantTiles.map((t) => [t.title, this.num(t.field, this.tiles()), null]));
      out.push(head);
    }
    if (has('levels')) out.push(this.levelSheet());
    if (has('trend')) out.push(...an.trendSheets());
    if (has('who')) out.push(an.whoSheet());
    if (has('tables')) out.push(...an.tableSheets());
    return out;
  }

  /** Every status card's lines: the total, then each status with its share of the level. */
  private levelSheet(): KeyedSheet {
    const rows = this.cardList().flatMap((card) => {
      const total = this.num(card.lines[0].field);
      return card.lines.map((l, i) => [this.levelName(card), l.label, this.num(l.field), i ? sharePercent(this.num(l.field), total) : null]);
    });
    return { name: 'Applications by level', keys: 2, columns: ['Level', 'Status', 'Count', 'Share of the level (%)'], rows };
  }

  /** The page as a one-page PDF (today's capture) without the sections left out. */
  private async exportPdf(sections: ExportSection[], name: string): Promise<void> {
    const el = this.exportArea()?.nativeElement;
    if (!el) throw new Error('No dashboard');
    const left = [...el.querySelectorAll<HTMLElement>('[data-export]')].filter((e) => !sections.includes(e.dataset['export'] as ExportSection));
    left.forEach((e) => e.classList.add(NO_EXPORT));
    try {
      await exportElement(el, 'pdf', name);
    } finally {
      left.forEach((e) => e.classList.remove(NO_EXPORT));
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

  private num(field: string, s = this.summary()): number {
    return s ? Number(text(s, field)) || 0 : 0;
  }

  protected value(field: string, s = this.summary()): string {
    if (!s) return '';
    const v = text(s, field) || '0';
    // Indian digit grouping, as the figures below (5,12,340).
    return /^\d+$/.test(v) ? Number(v).toLocaleString('en-IN') : v;
  }
}
