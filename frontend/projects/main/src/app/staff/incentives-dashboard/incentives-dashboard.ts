import { DecimalPipe, formatDate } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PageHead } from '../../msme/shared/page-head';
import { TextPipe, t } from '../../content/page-text';
import { staffCrumbs } from '../staff-crumbs';
import { AttentionRow } from '../dashboard/attention-row';
import { GroupedColumnChart, TrendPoint, formatCount } from '../dashboard/charts';
import { TableExport, ExportSheet } from '../table-export';

/** api/staff/incentives-dashboard (IncentivesDashboardController). */
export interface IncentivesHeadline {
  applications: number;
  inVerification: number;
  approved: number;
  paid: number;
  rejected: number;
  onHold: number;
  claimAmount: number;
  approvedAmount: number;
  paidAmount: number;
  desktopAgencies: number;
  onsiteAgencies: number;
}

export interface IncentivesSchemeCard {
  code: string;
  name: string;
  total: number;
  desktop: number;
  onsite: number;
  qc: number;
  approved: number;
  paid: number;
  rejected: number;
  onHold: number;
  claimAmount: number;
  approvedAmount: number;
}

export interface IncentivesFaCard {
  total: number;
  toAllot: number;
  inVerification: number;
  approved: number;
  reimbursed: number;
  rejected: number;
}

export interface IncentivesDashboard {
  generatedAt: string;
  headline: IncentivesHeadline;
  schemes: IncentivesSchemeCard[];
  fa: IncentivesFaCard;
  months: { month: string; submitted: number; approved: number; rejected: number }[];
  states: { state: string; total: number; inVerification: number; approved: number; paid: number; rejected: number }[];
  schemeOptions: { code: string; name: string }[];
  stateOptions: string[];
  /** 2026-11-26: 'Desktop' / 'Onsite' for an incentive verification agency (its own applications); absent for a Master Admin. */
  agency?: 'Desktop' | 'Onsite' | null;
}

export const INCENTIVES_DASHBOARD_API = '/api/staff/incentives-dashboard';

interface Filter {
  scheme: string;
  state: string;
  from: string;
  to: string;
}

const NO_FILTER: Filter = { scheme: '', state: '', from: '', to: '' };

/** A card's stages: the field, its colour class and its wording (Admin → Texts). */
interface Stage {
  field: string;
  kind: string;
  label: () => string;
}

const SCHEME_STAGES: Stage[] = [
  { field: 'desktop', kind: 'desk', label: () => t('staff.incentivesDashboard.stage.desktop', 'Desktop verification') },
  { field: 'onsite', kind: 'site', label: () => t('staff.incentivesDashboard.stage.onsite', 'Onsite verification') },
  { field: 'qc', kind: 'qc', label: () => t('staff.incentivesDashboard.stage.qc', 'Final QC') },
  { field: 'approved', kind: 'ok', label: () => t('staff.incentivesDashboard.stage.approved', 'Approved') },
  { field: 'paid', kind: 'paid', label: () => t('staff.incentivesDashboard.stage.paid', 'Paid') },
  { field: 'rejected', kind: 'no', label: () => t('staff.incentivesDashboard.stage.rejected', 'Rejected') },
  { field: 'onHold', kind: 'hold', label: () => t('staff.incentivesDashboard.stage.onHold', 'On hold') },
];

const FA_STAGES: Stage[] = [
  { field: 'toAllot', kind: 'hold', label: () => t('staff.incentivesDashboard.fa.toAllot', 'Awaiting an agency') },
  { field: 'inVerification', kind: 'desk', label: () => t('staff.incentivesDashboard.fa.inVerification', 'In verification') },
  { field: 'approved', kind: 'ok', label: () => t('staff.incentivesDashboard.fa.approved', 'Approved') },
  { field: 'reimbursed', kind: 'paid', label: () => t('staff.incentivesDashboard.fa.reimbursed', 'Reimbursed') },
  { field: 'rejected', kind: 'no', label: () => t('staff.incentivesDashboard.fa.rejected', 'Rejected') },
];

/** The bands of the scheme cards, in turn (teal, violet, blue, green). */
const BANDS = ['band-a', 'band-b', 'band-c', 'band-d'];

/** ₹ with Indian grouping; `short`: in lakh / crore. */
export function rupees(n: number, short = false): string {
  if (short && n >= 1e7) return `₹${+(n / 1e7).toFixed(2)} Cr`;
  if (short && n >= 1e5) return `₹${+(n / 1e5).toFixed(2)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

/**
 * 2026-11-24 (the product owner: "please create similar dashboard for the incentives"): the Incentives Master Admin's home, laid out
 * as the Master Admin's dashboard: the page head (Updated time, Refresh, Export), the filters, the headline figures, "Needs your
 * attention" (the bell's incentive work), one card per scheme (its applications by stage) and the Financial Assistance card, the
 * applications per month and per state. Within the login's scope (the API applies it).
 */
@Component({
  selector: 'zed-incentives-dashboard',
  imports: [PageHead, TextPipe, FormsModule, RouterLink, DecimalPipe, AttentionRow, GroupedColumnChart],
  templateUrl: './incentives-dashboard.html',
  styleUrls: ['./incentives-dashboard.scss', './incentives-dashboard-cards.scss'],
})
export class IncentivesDashboardPage {
  private readonly http = inject(HttpClient);
  private readonly tables = inject(TableExport);
  private readonly attention = viewChild(AttentionRow);

  protected readonly crumbs = computed(() => staffCrumbs({ label: t('staff.incentivesDashboard.crumb', 'Incentives Dashboard') }));
  protected readonly data = signal<IncentivesDashboard | null>(null);
  protected readonly filter = signal<Filter>({ ...NO_FILTER });
  protected readonly loading = signal(false);
  protected readonly exporting = signal(false);
  protected readonly error = signal('');
  protected readonly today = formatDate(new Date(), 'yyyy-MM-dd', 'en-US');
  protected readonly schemeStages = SCHEME_STAGES;
  protected readonly faStages = FA_STAGES;
  protected readonly rupees = rupees;
  protected readonly count = formatCount;

  protected readonly updated = computed(() => {
    const at = this.data()?.generatedAt;
    return at ? t('staff.incentivesDashboard.updatedSub', 'Updated {time}', { time: formatDate(at, 'dd-MM-yyyy HH:mm', 'en-US') }) : null;
  });
  protected readonly filtering = computed(() => Object.values(this.filter()).some((v) => !!v));
  protected readonly rangeInverted = computed(() => !!this.filter().from && !!this.filter().to && this.filter().from > this.filter().to);

  /** The headline figures (as the Master Admin's): applications, in verification, approved, rejected, amounts, agencies. */
  protected readonly kpis = computed(() => {
    const h = this.data()?.headline;
    if (!h) return [];
    return [
      { key: 'applications', value: formatCount(h.applications), label: t('staff.incentivesDashboard.kpi.applications', 'Scheme applications'), color: '#24666b', note: '' },
      { key: 'verification', value: formatCount(h.inVerification), label: t('staff.incentivesDashboard.kpi.inVerification', 'In verification'), color: '#b5740c',
        note: h.onHold ? t('staff.incentivesDashboard.kpi.onHoldNote', '{count} on hold', { count: formatCount(h.onHold) }) : '' },
      { key: 'approved', value: formatCount(h.approved + h.paid), label: t('staff.incentivesDashboard.kpi.approved', 'Approved'), color: '#2f8a46',
        note: t('staff.incentivesDashboard.kpi.paidNote', '{count} paid', { count: formatCount(h.paid) }) },
      { key: 'rejected', value: formatCount(h.rejected), label: t('staff.incentivesDashboard.kpi.rejected', 'Rejected'), color: '#6f8487', note: '' },
      { key: 'amount', value: rupees(h.approvedAmount, true), label: t('staff.incentivesDashboard.kpi.approvedAmount', 'Amount approved'), color: '#6250d6',
        note: t('staff.incentivesDashboard.kpi.claimedNote', '{amount} claimed', { amount: rupees(h.claimAmount, true) }) },
      // Not for an incentive agency (its own applications only).
      ...(this.data()?.agency ? [] : [{ key: 'agencies', value: formatCount(h.desktopAgencies + h.onsiteAgencies), label: t('staff.incentivesDashboard.kpi.agencies', 'Verification agencies'), color: '#00909a',
        note: t('staff.incentivesDashboard.kpi.agenciesNote', '{desktop} desktop · {onsite} onsite', { desktop: h.desktopAgencies, onsite: h.onsiteAgencies }) }]),
    ];
  });

  /** 2026-11-26: where a scheme card opens: the agency's own list, or the Master Admin's Scheme Applications. */
  protected readonly schemesLink = computed(() => {
    const a = this.data()?.agency;
    return a === 'Onsite' ? '/staff/scheme-onsite/allotment' : a === 'Desktop' ? '/staff/schemes-verify/allotment' : '/staff/schemes-verify/applications';
  });

  protected readonly series = computed(() => [
    t('staff.incentivesDashboard.trend.submitted', 'Submitted'), t('staff.incentivesDashboard.trend.approved', 'Approved'),
    t('staff.incentivesDashboard.trend.rejected', 'Rejected'),
  ]);
  protected readonly trendColors = ['#00909a', '#2f9e58', '#9aa7a9'];
  /** 2026-11-25 (UI): no application in the 12 months; the chart gives way to a line (it drew a row of flat dashes). */
  protected readonly trendEmpty = computed(() => this.trend().every((p) => p.values.every((v) => !v)));
  protected readonly trend = computed<TrendPoint[]>(() =>
    (this.data()?.months ?? []).map((m) => {
      const at = new Date(`${m.month}-01T00:00:00`);
      return { label: formatDate(at, 'MMM', 'en-US'), tip: formatDate(at, 'MMM yyyy', 'en-US'), values: [m.submitted, m.approved, m.rejected] };
    }),
  );

  constructor() {
    void this.load();
  }

  protected set(key: keyof Filter, value: string): void {
    this.filter.set({ ...this.filter(), [key]: value ?? '' });
    if (!this.rangeInverted()) void this.load();
  }

  protected clear(): void {
    this.filter.set({ ...NO_FILTER });
    void this.load();
  }

  protected refresh(): void {
    void this.load();
    this.attention()?.refresh();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    let params = new HttpParams();
    for (const [k, v] of Object.entries(this.filter())) if (v) params = params.set(k, v);
    try {
      this.data.set(await firstValueFrom(this.http.get<IncentivesDashboard>(INCENTIVES_DASHBOARD_API, { params })));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected band(i: number): string {
    return BANDS[i % BANDS.length];
  }

  protected value(card: object, field: string): number {
    return Number((card as Record<string, unknown>)[field]) || 0;
  }

  /** A stage's share of the card's total, in percent. */
  protected share(card: { total: number }, field: string): number {
    return card.total ? Math.min(100, (this.value(card, field) / card.total) * 100) : 0;
  }

  protected barLabel(card: { total: number }, stages: Stage[]): string {
    return stages.map((s) => t('staff.incentivesDashboard.card.barItemAria', '{stage} {count}', { stage: s.label(), count: formatCount(this.value(card, s.field)) })).join(', ');
  }

  /** Excel: the filters, the headline, the schemes, Financial Assistance, the months and the states. */
  protected async export(): Promise<void> {
    const d = this.data();
    if (!d || this.exporting()) return;
    this.exporting.set(true);
    try {
      const f = this.filter();
      const all = t('staff.incentivesDashboard.filter.all', 'All');
      const sheets: ExportSheet[] = [
        { name: t('staff.incentivesDashboard.export.filters', 'Filters'), columns: [t('staff.incentivesDashboard.export.filter', 'Filter'), t('staff.incentivesDashboard.export.value', 'Value')], rows: [
          [t('staff.incentivesDashboard.filter.scheme', 'Scheme'), d.schemeOptions.find((s) => s.code === f.scheme)?.name ?? all],
          [t('staff.incentivesDashboard.filter.state', 'State'), f.state || all],
          [t('staff.incentivesDashboard.filter.from', 'Submitted from'), f.from || ''], [t('staff.incentivesDashboard.filter.to', 'Submitted to'), f.to || ''],
        ] },
        { name: t('staff.incentivesDashboard.export.headline', 'Headline'), columns: [t('staff.incentivesDashboard.export.figure', 'Figure'), t('staff.incentivesDashboard.export.value', 'Value')],
          rows: this.kpis().map((k) => [k.label, k.value]).concat([[t('staff.incentivesDashboard.export.paidAmount', 'Amount paid'), rupees(d.headline.paidAmount)]]) },
        { name: t('staff.incentivesDashboard.export.schemes', 'Schemes'),
          columns: [t('staff.incentivesDashboard.export.scheme', 'Scheme'), t('staff.incentivesDashboard.card.total', 'Total applications'), ...SCHEME_STAGES.map((s) => s.label()),
            t('staff.incentivesDashboard.card.claimed', 'Claimed'), t('staff.incentivesDashboard.card.approvedAmount', 'Approved amount')],
          rows: d.schemes.map((c) => [c.name, c.total, ...SCHEME_STAGES.map((s) => this.value(c, s.field)), c.claimAmount, c.approvedAmount]) },
        { name: t('staff.incentivesDashboard.export.fa', 'Financial Assistance'), columns: [t('staff.incentivesDashboard.export.status', 'Status'), t('staff.incentivesDashboard.export.count', 'Count')],
          rows: [[t('staff.incentivesDashboard.card.total', 'Total applications'), d.fa.total], ...FA_STAGES.map((s) => [s.label(), this.value(d.fa, s.field)])] },
        { name: t('staff.incentivesDashboard.export.months', 'By month'), columns: [t('staff.incentivesDashboard.export.month', 'Month'), ...this.series()],
          rows: this.trend().map((p) => [p.tip ?? p.label, ...p.values]) },
        { name: t('staff.incentivesDashboard.export.states', 'By state'), columns: this.stateColumns(), rows: d.states.map((s) => [s.state, s.total, s.inVerification, s.approved, s.paid, s.rejected]) },
      ];
      await this.tables.xlsx(`Incentives-Dashboard-${formatDate(new Date(), 'yyyyMMdd-HHmm', 'en-US')}`, sheets);
    } catch {
      this.error.set(t('staff.incentivesDashboard.export.error', 'The dashboard could not be exported. Please try again.'));
    } finally {
      this.exporting.set(false);
    }
  }

  protected stateColumns(): string[] {
    return [
      t('staff.incentivesDashboard.states.state', 'State'), t('staff.incentivesDashboard.states.total', 'Applications'),
      t('staff.incentivesDashboard.states.inVerification', 'In verification'), t('staff.incentivesDashboard.states.approved', 'Approved'),
      t('staff.incentivesDashboard.states.paid', 'Paid'), t('staff.incentivesDashboard.states.rejected', 'Rejected'),
    ];
  }
}
