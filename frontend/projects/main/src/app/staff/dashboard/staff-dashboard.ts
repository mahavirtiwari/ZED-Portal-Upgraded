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
import { TextPipe, t } from '../../content/page-text';

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
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): status names in sentence case ("Assessment pending",
 * "NC raised"), as staff-00 (also the export's).
 */
const MAIN_CARDS: Card[] = [
  {
    css: 'panel-bronze', title: 'BRONZE CERTIFICATION', lines: [
      { label: 'Total applications', field: 'BronzeTotal' }, { label: 'Assessment pending', field: 'BronzePending' },
      { label: 'NC raised', field: 'BronzeNcRaised' }, { label: 'Certified', field: 'BronzeCompleted' }, { label: 'Rejected', field: 'BronzeRejected' },
    ],
  },
  {
    css: 'panel-silver', title: 'SILVER CERTIFICATION', lines: [
      { label: 'Total applications', field: 'SilverTotal' }, { label: 'Assessment pending', field: 'SaSilverPending' },
      { label: 'NC raised', field: 'SilverNcRaised' }, { label: 'Certified', field: 'SaSilverCompleted' }, { label: 'Rejected', field: 'SilverRejected' },
    ],
  },
  {
    css: 'panel-gold', title: 'GOLD CERTIFICATION', lines: [
      { label: 'Total applications', field: 'GoldTotal' }, { label: 'Assessment pending', field: 'SaGoldPending' },
      { label: 'NC raised', field: 'GoldNcRaised' }, { label: 'Certified', field: 'SaGoldCompleted' }, { label: 'Rejected', field: 'GoldRejected' },
    ],
  },
  {
    // 2026-11-07: ZED-X was missing from the dashboard (its figures: migration 0019, Gold's rules).
    css: 'panel-zedx', title: 'ZED-X CERTIFICATION', lines: [
      { label: 'Total applications', field: 'ZedxTotal' }, { label: 'Assessment pending', field: 'SaZedxPending' },
      { label: 'NC raised', field: 'ZedxNcRaised' }, { label: 'Certified', field: 'SaZedxCompleted' }, { label: 'Rejected', field: 'ZedxRejected' },
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
      { label: 'Total applications', field: 'FaTotal' }, { label: 'Approved', field: 'FaCompleted' }, { label: 'Pending', field: 'FaPending' },
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
      { label: 'Total applications', field: 'BronzeTotal' }, { label: 'Surveillance pending', field: 'BronzePending' },
      { label: 'Surveillance completed', field: 'BronzeCompleted' }, { label: 'Rejected', field: 'BronzeRejected' },
    ],
  },
  {
    css: 'panel-silver', title: 'SILVER SURVEILLANCE', lines: [
      { label: 'Total applications', field: 'SilverTotal' }, { label: 'Surveillance pending', field: 'SilverPending' },
      { label: 'NC raised', field: 'SaSilverNcRaised' }, { label: 'Surveillance completed', field: 'SaSilverCompleted' },
      { label: 'Rejected', field: 'SilverRejected' },
    ],
  },
  {
    css: 'panel-gold', title: 'GOLD SURVEILLANCE', lines: [
      { label: 'Total applications', field: 'GoldTotal' }, { label: 'Surveillance pending', field: 'GoldPending' },
      { label: 'NC raised', field: 'SaGoldNcRaised' }, { label: 'Surveillance completed', field: 'SaGoldCompleted' },
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
 * 2026-11-19 ("All page wording"): the wording shown for a card's line, title or tile (Admin → Texts → Page wording). The
 * tables above keep the code values (the status colour and the level name are worked out from them).
 */
const CARD_TEXTS: Readonly<Record<string, () => string>> = {
  'Total applications': () => t('staff.dashboard.status.totalLabel', 'Total applications'),
  'Total Applications': () => t('staff.dashboard.status.milestoneTotalLabel', 'Total Applications'),
  'Assessment pending': () => t('staff.dashboard.status.assessmentPendingLabel', 'Assessment pending'),
  'NC raised': () => t('staff.dashboard.status.ncRaisedLabel', 'NC raised'),
  'Certified': () => t('staff.dashboard.status.certifiedLabel', 'Certified'),
  'Rejected': () => t('staff.dashboard.status.rejectedLabel', 'Rejected'),
  'Approved': () => t('staff.dashboard.status.approvedLabel', 'Approved'),
  'Pending': () => t('staff.dashboard.status.pendingLabel', 'Pending'),
  'Surveillance pending': () => t('staff.dashboard.status.surveillancePendingLabel', 'Surveillance pending'),
  'Surveillance completed': () => t('staff.dashboard.status.surveillanceCompletedLabel', 'Surveillance completed'),
  'Milestone 1 Payment Received': () => t('staff.dashboard.status.m1PaymentLabel', 'Milestone 1 Payment Received'),
  'Milestone 1 Completed': () => t('staff.dashboard.status.m1CompletedLabel', 'Milestone 1 Completed'),
  'Milestone 2 Payment Received': () => t('staff.dashboard.status.m2PaymentLabel', 'Milestone 2 Payment Received'),
  'Milestone 2 Completed': () => t('staff.dashboard.status.m2CompletedLabel', 'Milestone 2 Completed'),
  'Milestone 3 Payment Received': () => t('staff.dashboard.status.m3PaymentLabel', 'Milestone 3 Payment Received'),
  'Milestone 3 Completed': () => t('staff.dashboard.status.m3CompletedLabel', 'Milestone 3 Completed'),
  'Technology Intervention': () => t('staff.dashboard.card.technologyInterventionTitle', 'Technology Intervention'),
  'Empanelled Consultant Organisations': () => t('staff.dashboard.tile.organisationsTitle', 'Empanelled Consultant Organisations'),
  'Consultants': () => t('staff.dashboard.tile.consultantsTitle', 'Consultants'),
};

/** The wording shown for a card line's label, a card's title or a tile's title (the code value when not listed). */
export function cardText(label: string): string {
  return CARD_TEXTS[label]?.() ?? label;
}


/**
 * Staff home dashboard. Port of Views/Dashboard/Index.cshtml: the status cards (scoped to the user by the API). V4, all
 * three portals: instead of the old counts strip, the Power BI pages' "ZED Dashboard" and "ZED Certification" figures
 * (<zed-staff-analytics>, worded for the portal), with the cards inside following the same filters.
 * 2026-11-17 (approved staff redesign): the shared page head (the date basis, Refresh and Export as its buttons, the
 * Updated time under the title); "Needs your attention" above the cards; per level one stacked bar and its legend; Export
 * as a pop-up (sections and Excel / CSV / PDF).
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): sizes and colours of staff-00: a 344x36 date-basis switch,
 * 112x36 Refresh / Export with their icons, 176px level cards (50px band, 10px bar whose empty parts take no room, legend
 * on one line per status).
 */
@Component({
  selector: 'zed-staff-dashboard',
  providers: [dashboardSystemProvider(['dash-registered', 'dash-certified'])],
  imports: [StaffAnalytics, NgTemplateOutlet, DecimalPipe, DashboardPortalSwitchComponent, PageHead, AttentionRow, DashboardExportDialog, TextPipe],
  template: `
    <!-- One Dashboard Admin (2026-11-07): the portal of this screen. -->
    <zed-dashboard-portal-switch [screens]="['dash-registered', 'dash-certified']" />
    <div class="dash-export" #exportArea>
    <zed-page-head [crumbs]="crumbs()" [title]="'Dashboard' | t: 'staff.dashboard.title'" [subtitle]="updated()">
      @if (analytics(); as an) {
        @if (an.views.length > 1) {
          <div class="dash-basis" role="tablist" [attr.aria-label]="'Count by' | t: 'staff.dashboard.basis.aria'">
            @for (v of an.views; track v) {
              <button type="button" role="tab" class="an-basis-tab" [attr.data-view]="v" [class.active]="an.view() === v" [attr.aria-selected]="an.view() === v"
                      (click)="an.setView(v)">{{ an.basisLabel(v) }}</button>
            }
          </div>
        }
        <button type="button" class="btn btn-ph dash-refresh no-export" [disabled]="an.loading()" (click)="refresh()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23 4v6h-6M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg> {{ 'Refresh' | t: 'staff.dashboard.refreshButton' }}
        </button>
        <button type="button" class="btn btn-primary dash-export-btn no-export" [disabled]="!an.data() || exporting()" aria-haspopup="dialog" (click)="openExport()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg> {{ exporting() ? ('Exporting…' | t: 'staff.dashboard.exportingButton') : ('Export' | t: 'staff.dashboard.exportButton') }}
        </button>
      }
    </zed-page-head>
    @if (error()) {
      <div class="alert alert-danger" role="alert">
        {{ error() }} <button type="button" class="btn btn-link" (click)="load()">{{ 'Try Again' | t: 'staff.dashboard.tryAgainButton' }}</button>
      </div>
    }
    @if (showConsultantTiles()) {
      <div class="dash-grid" data-export="headline">
        @for (tile of consultantTiles; track tile.field) {
          <div class="dash-card dash-tile" [class]="tile.css">
            <h5>{{ cardText(tile.title) }}</h5>
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
                  <span class="app-total-label">{{ 'total applications' | t: 'staff.dashboard.card.totalLabel' }}</span>
                </span>
              </div>
              <div class="app-body">
                <div class="ms-head" aria-hidden="true"><span></span><span>{{ 'Payment received' | t: 'staff.dashboard.milestone.paymentColumn' }}</span><span>{{ 'Completed' | t: 'staff.dashboard.milestone.completedColumn' }}</span></div>
                <ol class="ms-list">
                  @for (m of milestones(card); track m.no) {
                    <li>
                      <span class="ms-no">{{ 'Milestone {no}' | t: 'staff.dashboard.milestone.label' : { no: m.no } }}</span>
                      @for (part of m.parts; track part.field) {
                        <span class="ms-cell" [class.is-done]="$last">
                          <span class="ms-figure"><span class="app-value" [attr.data-field]="part.field" [attr.title]="cardText(part.label)">{{ value(part.field) }}</span>
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
                <span class="app-total-label">{{ 'total applications' | t: 'staff.dashboard.card.totalLabel' }}</span>
              </span>
            </div>
            <div class="app-body">
              <div class="app-bar" role="img" [attr.aria-label]="barLabel(card)">
                @for (line of card.lines.slice(1); track line.field) {
                  <span [class]="'app-seg is-' + statusKind(line.label)" [style.width.%]="share(card, line.field)" [title]="'{status}: {count}' | t: 'staff.dashboard.card.segmentTooltip' : { status: cardText(line.label), count: value(line.field) }"></span>
                }
              </div>
              <ul class="app-stats">
                @for (line of card.lines.slice(1); track line.field) {
                  <li [class]="'is-' + statusKind(line.label)">
                    <span class="app-dot" aria-hidden="true"></span>
                    <span class="app-label" [title]="cardText(line.label)">{{ cardText(line.label) }}</span>
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
      <div class="loadingdiv" style="display: block" role="status" aria-live="polite"><div class="loadingimage"><div class="loader"></div><div class="text-center"><small>{{ 'Please wait ...' | t: 'staff.dashboard.loadingText' }}</small></div></div></div>
    }
  `,
  styles: `
    /* Head: the date basis as a two-way switch, then Refresh (grey) and Export (staff-00 sizes). */
    .dash-basis { display: inline-flex; padding: 3px; border-radius: 9px; background: #e3ecec; }
    .an-basis-tab { min-width: 168px; height: 30px; border: 0; background: none; border-radius: 7px; padding: 0 14px; font-size: 12.5px; font-weight: 500; color: #17373b;
      text-transform: capitalize; }
    .an-basis-tab.active { background: #24666b; color: #fff; font-weight: 700; }
    .btn.btn-ph.dash-refresh, .btn.btn-primary.dash-export-btn { justify-content: center; gap: 8px; min-width: 112px; height: 36px; padding: 0 16px; border-radius: 9px;
      font-size: 13.5px; font-weight: 700; text-transform: none; }
    .btn.btn-ph.dash-refresh { background: #e7eeee; color: #17373b; border: 0; }
    .btn.btn-primary.dash-export-btn { background: #24666b; border-color: #24666b; color: #fff; }
    svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    /* Level cards: the level's colour as the band; one bar of the statuses and a legend under it. Status colours: pending
       amber, NC raised orange, certified green, rejected grey (always named). */
    .app-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
    .app-card, .dash-card { background: #fff; border: 1px solid #dde7e8; border-radius: 14px; overflow: hidden; box-shadow: 0 3px 10px rgba(16, 61, 64, .06); }
    .app-band { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 50px; padding: 5px 18px; color: #fff;
      background: linear-gradient(120deg, var(--a1, var(--accent2, var(--accent))), var(--accent), var(--a3, var(--accent))); }
    .app-level { font-size: 14px; font-weight: 800; letter-spacing: .6px; text-transform: uppercase; }
    .app-total { flex: none; display: flex; flex-direction: column; align-items: flex-end; line-height: 1.1; }
    .app-total-value { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .app-total-label { font-size: 10.5px; font-weight: 500; white-space: nowrap; }
    .app-body { padding: 16px 18px 10px; }
    .app-bar { display: flex; height: 10px; border-radius: 2px; overflow: hidden; background: #eef3f3; margin-bottom: 18px; }
    .app-seg { height: 100%; min-width: 0; border-radius: 2px; }
    .app-stats { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; }
    .app-stats li { display: grid; grid-template-columns: 10px minmax(0, 1fr); gap: 2px 8px; align-items: center; align-content: start; }
    .app-dot { width: 10px; height: 10px; border-radius: 50%; }
    .app-label { font-size: 11px; font-weight: 500; line-height: 14px; color: #6f8487; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .app-figure { grid-column: 2; line-height: 18px; }
    .app-figure, .ms-figure { display: flex; align-items: baseline; flex-wrap: wrap; gap: 5px; }
    .app-value { font-size: 14.5px; font-weight: 800; color: #17373b; font-variant-numeric: tabular-nums; }
    .app-share { font-size: 11.5px; font-weight: 500; color: #6f8487; font-variant-numeric: tabular-nums; }
    .is-pending .app-dot, .app-seg.is-pending { background: #d98a12; }
    .is-nc .app-dot, .app-seg.is-nc { background: #e5654b; }
    .is-certified .app-dot, .app-seg.is-certified { background: #2f9e58; }
    .is-rejected .app-dot, .app-seg.is-rejected { background: #9aa7a9; }
    /* Consultancy's milestone cards: per milestone the payments received and the completions, each with its share. */
    .ms-head, .ms-list li { display: grid; grid-template-columns: 88px 1fr 1fr; gap: 10px; align-items: center; }
    .ms-head { font-size: 11.5px; font-weight: 600; color: #6f8487; padding-bottom: 6px; }
    .ms-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
    .ms-no { font-size: 12.5px; font-weight: 700; color: #17373b; }
    .ms-cell { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .ms-bar { display: block; height: 6px; border-radius: 3px; background: #e6eeee; overflow: hidden; }
    .ms-bar > span { display: block; height: 100%; background: #d98a12; }
    .ms-cell.is-done .ms-bar > span { background: #2f9e58; }
    .dash-export { padding: 4px 2px 10px; }
    /* Consultancy Master Admin's organisation and consultant counts, as the headline tiles. */
    .dash-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 16px; margin-bottom: 16px; }
    .dash-card { display: flex; flex-direction: column-reverse; gap: 2px; padding: 14px 16px; border-top: 3px solid var(--accent); }
    .dash-card h5 { font-size: 12.5px; font-weight: 500; color: #3d5559; margin: 0; }
    .dash-count { font-size: 24px; font-weight: 800; line-height: 1.15; color: var(--accent); }
    /* The bands: staff-00's level gradients (light, level colour, dark). */
    .panel-bronze { --a1: #e9a888; --accent: #c9714f; --a3: #9c4f2e; }
    .panel-silver { --a1: #dfe2e4; --accent: #a5abb0; --a3: #7b838a; }
    .panel-gold { --a1: #f0d98a; --accent: #c9a23f; --a3: #9c7a1d; }
    .panel-zedx { --a1: #7fcbd2; --accent: #3c8f99; --a3: #256b74; }
    .panel-finance { --accent: #5b8a2c; --accent2: #7fae49; }
    .panel-empanel { --accent: #2f8a46; --accent2: #4fae66; }
    .panel-consultant { --accent: #24666b; --accent2: #3fa3a8; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    @media (max-width: 575.98px) { .dash-basis { display: flex; width: 100%; } .an-basis-tab { flex: 1 1 0; min-width: 0; padding: 0 8px; } }`,
})
export class StaffDashboardPage {
  private readonly api = inject(DashboardApi);
  private readonly tables = inject(TableExport);

  protected readonly crumbs = computed(() => staffCrumbs({ label: t('staff.dashboard.crumb.dashboard', 'Dashboard') }));
  protected readonly cardText = cardText;
  protected readonly system = inject(STAFF_SYSTEM);
  private readonly fixedCards = DASHBOARD_CARDS[this.system];
  /** The fixed cards, then (main portal) one card per level the Admin added, as ZED-X's (2026-11-08). */
  protected readonly cardList = computed<Card[]>(() => [
    ...this.fixedCards,
    ...(this.system === 'main' ? (this.analytics()?.otherLevels() ?? []) : []).map((l): Card => ({
      css: 'panel-zedx', title: `${l.code} CERTIFICATION`, name: l.name || adminLevelName(l.code), lines: [
        { label: 'Total applications', field: `${l.code}Total` }, { label: 'Assessment pending', field: `Sa${l.code}Pending` },
        { label: 'NC raised', field: `${l.code}NcRaised` }, { label: 'Certified', field: `Sa${l.code}Completed` }, { label: 'Rejected', field: `${l.code}Rejected` },
      ],
    })),
  ]);
  /** The figures section, whose date basis, Updated time and Refresh sit in the page head. */
  protected readonly analytics = viewChild<StaffAnalytics>('figures');
  private readonly attention = viewChild(AttentionRow);
  private readonly exportArea = viewChild<ElementRef<HTMLElement>>('exportArea');
  protected readonly updated = computed(() => {
    const at = this.analytics()?.data()?.generatedAt;
    return at ? t('staff.dashboard.updatedSub', 'Updated {time}', { time: formatDate(at, 'dd-MM-yyyy HH:mm', 'en-US') }) : null;
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
      this.exportError.set(t('staff.dashboard.export.error', 'The dashboard could not be exported. Please try again.'));
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
      if (this.showConsultantTiles()) head.rows.push(...this.consultantTiles.map((tile) => [cardText(tile.title), this.num(tile.field, this.tiles()), null]));
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
      return card.lines.map((l, i) => [this.levelName(card), cardText(l.label), this.num(l.field), i ? sharePercent(this.num(l.field), total) : null]);
    });
    const columns = [
      t('staff.dashboard.export.column.level', 'Level'), t('staff.dashboard.export.column.status', 'Status'),
      t('staff.dashboard.export.column.count', 'Count'), t('staff.dashboard.export.column.share', 'Share of the level (%)'),
    ];
    return { name: 'Applications by level', keys: 2, columns, rows };
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
    const row = this.tiles();
    return row !== null && 'AssessmentAgencies' in row;
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
    if (!m) return cardText(card.title);
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
    // "NC" as a word: "surveillance completed" holds the letters "nc" too (2026-11-18: it was drawn as NC raised).
    return l.includes('pending') ? 'pending' : /\bnc\b/.test(l) ? 'nc' : l.includes('reject') ? 'rejected' : 'certified';
  }

  /** A line's share of the card's total applications, in percent. */
  protected share(card: Card, field: string): number {
    const total = this.num(card.lines[0].field);
    return total ? Math.min(100, (this.num(field) / total) * 100) : 0;
  }

  protected barLabel(card: Card): string {
    return card.lines.slice(1).map((l) => t('staff.dashboard.card.barItemAria', '{status} {count}', { status: cardText(l.label), count: this.value(l.field) })).join(', ');
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
