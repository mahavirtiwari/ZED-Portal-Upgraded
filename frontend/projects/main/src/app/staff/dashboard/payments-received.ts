import { Component, computed, inject, signal } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { DashboardApi, ListFilter, Row } from './dashboard.api';
import { ClientPager, flag, text } from './dashboard-filters';
import { PagerComponent } from '../pager';
import { STAFF_SYSTEM } from '../staff-menu';
import { ListFiltersBar } from './list-controls';
import { PageHead } from '../../msme/shared/page-head';
import { staffCrumbs } from '../staff-crumbs';
import { TableExport } from '../table-export';
import { ToastService } from '../toast';
import { levelName } from '../../msme/shared/levels';
import { LevelMedal } from '../assessment/level-medal';
import { DashIcon } from '../../msme/dashboard/dash-icon';
import { TextPipe, t } from '../../content/page-text';

/** MsmePaymentInfo.PaymentType as shown (ZeroAmount: nothing to pay after the subsidy or reward, 2026-11-17). */
const PAYMENT_TYPES: Readonly<Record<string, () => string>> = {
  PaymentGateway: () => t('staff.paymentsReceived.type.online', 'Online'),
  NEFT: () => t('staff.paymentsReceived.type.neft', 'NEFT'),
  ZeroAmount: () => t('staff.paymentsReceived.type.zeroAmount', 'Zero amount'),
  PaidAtMilestone1: () => t('staff.paymentsReceived.type.milestone1', 'Paid at milestone 1'),
};

/** A number of the list (amounts and percentages come as numbers or text). */
function num(row: Row, field: string): number {
  const n = Number(String(row[field] ?? '').replace(/[,%\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): the design's "Paid between" drop-down ("Any date" first). The
 * range goes to the API as paidFrom / paidTo (yyyy-MM-dd), which filters on the payment's recorded date (PaidOn).
 */
export const PAID_RANGES: readonly { readonly value: string; readonly label: string }[] = [
  { value: '', get label() { return t('staff.paymentsReceived.paid.any', 'Any date'); } },
  { value: '7', get label() { return t('staff.paymentsReceived.paid.last7', 'Last 7 days'); } },
  { value: '30', get label() { return t('staff.paymentsReceived.paid.last30', 'Last 30 days'); } },
  { value: '90', get label() { return t('staff.paymentsReceived.paid.last90', 'Last 90 days'); } },
  { value: 'fy', get label() { return t('staff.paymentsReceived.paid.thisYear', 'This financial year'); } },
];

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** paidFrom of a "Paid between" choice (today is the end), or '' for any date. */
export function paidFrom(range: string, today = new Date()): string {
  if (!range) return '';
  if (range === 'fy') return isoDay(new Date(today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1, 3, 1));
  const d = new Date(today);
  d.setDate(d.getDate() - (Number(range) - 1));
  return isoDay(d);
}

/** "13 Nov" (the year added when it is not this year), "—" when unknown. */
export function shortDay(value: unknown, now = new Date()): string {
  const d = value ? new Date(String(value)) : null;
  if (!d || Number.isNaN(d.getTime())) return '—';
  const day = `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })}`;
  return d.getFullYear() === now.getFullYear() ? day : `${day} ${d.getFullYear()}`;
}

export function rupees(n: number): string {
  return '₹ ' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/**
 * MSME payments received (MasterAdmin). Port of Views/Dashboard/PaymentReceived.cshtml. The old page's
 * Approve/Reject handlers had no pop-up markup and could not be used; they are not ported. Consultancy's page
 * (ZEDCS_CONSULTANCY Frontend/Dashboard/PaymentReceived.cshtml) has a Milestone column where the others have
 * Joining Reward.
 * <p>2026-11-17 (approved redesign): four totals of the rows shown (worked out here from the loaded list), Export of those
 * rows, search and filters in one row, the unit as name over ZED ID, GSTIN / TAN (in full since 2026-11-18, the user: a GSTIN holds the PAN, never masked), amounts right-aligned and
 * the payment type under the amount ("Zero amount" for a 100% subsidy).</p>
 * <p>2026-11-18 (the user: staff pages 'not aligned with SVG files'): staff-08's "Paid on" column (the API now adds PaidOn, the
 * payment row's recorded date) and "Paid between" filter; the search without a label, first in the row, with its icon on the left;
 * the level as a medal; an empty TDS shows "—"; the cells in the designs' type (13.5px, grey sub-lines), not the browser's 16px
 * black.</p>
 */
@Component({
  selector: 'zed-staff-payments-received',
  imports: [ListFiltersBar, PagerComponent, PageHead, LevelMedal, DashIcon, TextPipe],
  host: { class: 'list-v2 d-block' },
  template: `
    <zed-page-head [crumbs]="crumbs()" [title]="'MSME Payment Received' | t: 'staff.paymentsReceived.title'"
      [subtitle]="'Payments received from the units, with the TDS, subsidy and amount paid.' | t: 'staff.paymentsReceived.sub'">
      <button type="button" class="btn btn-outline-primary pr-btn" [disabled]="exporting() || !pager.total()" (click)="exportRows()">
        <zed-dash-icon name="download" [size]="16" />{{ exporting() ? ('Exporting…' | t: 'staff.paymentsReceived.exportingButton') : ('Export' | t: 'staff.paymentsReceived.exportButton') }}</button>
    </zed-page-head>
    <div class="pr-tiles" role="list" [attr.aria-label]="'Totals of the payments shown' | t: 'staff.paymentsReceived.tilesAria'">
      @for (t of tiles(); track t.label) {
        <div class="pr-tile" role="listitem"><b [class]="t.tone">{{ t.value }}</b>&ngsp;<span>{{ t.label }}</span></div>
      }
    </div>
    <div class="zed-card pr-filters">
      <zed-list-filters [filter]="filter()" (filterChange)="onFilter($event)">
        <div class="filter wide pr-search">
          <svg class="pr-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input type="search" id="pr-search" class="form-control" maxlength="50" [placeholder]="'Search ZED ID, unit, GSTIN or TAN' | t: 'staff.paymentsReceived.search.placeholder'"
                 [attr.aria-label]="'Search ZED ID, unit, GSTIN or TAN' | t: 'staff.paymentsReceived.search.placeholder'" [value]="pager.search()" (input)="pager.setSearch($any($event.target).value)" />
        </div>
        <div class="filter pr-paid">
          <label class="form-label" for="pr-paid">{{ 'Paid between' | t: 'staff.paymentsReceived.paid.label' }}</label>
          <select class="form-select" id="pr-paid" (change)="onPaid($any($event.target).value)">
            @for (r of paidRanges; track r.value) { <option [value]="r.value" [selected]="paid() === r.value">{{ r.label }}</option> }
          </select>
        </div>
      </zed-list-filters>
    </div>
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
    <div class="list-card">
      <div class="table-responsive">
        <table class="table table-zed pr-table">
          <thead>
            <tr>
              <th>{{ 'Unit' | t: 'staff.paymentsReceived.column.unit' }}</th>
              <th>{{ 'Level' | t: 'staff.paymentsReceived.column.level' }}</th>
              <th>{{ 'Size / Gender' | t: 'staff.paymentsReceived.column.sizeGender' }}</th>
              <th>{{ 'Social category' | t: 'staff.paymentsReceived.column.social' }}</th>
              <th>{{ consultancy ? ('Milestone' | t: 'staff.paymentsReceived.column.milestone') : ('Joining reward' | t: 'staff.paymentsReceived.column.reward') }}</th>
              <th>{{ 'State / District' | t: 'staff.paymentsReceived.column.stateDistrict' }}</th>
              <th class="num">{{ 'TDS' | t: 'staff.paymentsReceived.column.tds' }}</th>
              <th class="num">{{ 'Subsidy' | t: 'staff.paymentsReceived.column.subsidy' }}</th>
              <th>{{ 'GSTIN / TAN' | t: 'staff.paymentsReceived.column.tax' }}</th>
              <th>{{ 'Paid on' | t: 'staff.paymentsReceived.column.paidOn' }}</th>
              <th class="num">{{ 'Amount paid' | t: 'staff.paymentsReceived.column.amount' }}</th>
            </tr>
          </thead>
          <tbody>
            @for (t of pager.page(); track $index) {
              <tr>
                <td class="unit-cell">
                  <b>{{ t['PUnitName'] }}</b><small>{{ t['ZedId'] }}</small>
                  @if (!consultancy && t['MileStoneNum']) { <small>{{ 'Milestone {no}' | t: 'staff.paymentsReceived.milestoneText' : { no: t['MileStoneNum'] } }}</small> }
                </td>
                <td><zed-level-medal [level]="$any(t['Certification'])" /></td>
                <td><span>{{ t['EnterpriseTypee'] }}</span><small class="sub">{{ t['Gender'] }}</small></td>
                <td>{{ t['SocialCategoryName'] }}</td>
                @if (consultancy) {
                  <td>{{ t['MileStoneNum'] }}</td>
                } @else {
                  <td><span class="chip" [class.is-good]="flag(t, 'IsCouponUsed')">{{ flag(t, 'IsCouponUsed') ? ('Yes' | t: 'staff.paymentsReceived.reward.yes') : ('No' | t: 'staff.paymentsReceived.reward.no') }}</span></td>
                }
                <td><span>{{ t['PStateName'] }}</span><small class="sub">{{ t['PDistrictName'] }}</small></td>
                <td class="num">{{ percent(t, 'Tds') || '—' }}</td>
                <td class="num">{{ percent(t, 'SubsidyPercentage') || '—' }}</td>
                <td class="pr-tax">
                  @let ids = taxIds(t);
                  @for (id of ids; track $index) { <span>{{ id }}</span> } @empty { <span class="sub">{{ 'Not given' | t: 'staff.paymentsReceived.tax.empty' }}</span> }
                </td>
                <td class="sub pr-paid-on">{{ day(t['PaidOn']) }}</td>
                <td class="num">
                  <b>{{ amount(t) }}</b>
                  @if (paymentType(t); as p) { <small class="sub" [class.pr-zero]="t['PaymentType'] === 'ZeroAmount'">{{ p }}</small> }
                </td>
              </tr>
            } @empty {
              @if (!loading()) { <tr><td colspan="11" style="padding: 0"><div class="no-data">{{ 'No payment matches these filters.' | t: 'staff.paymentsReceived.empty' }}</div></td></tr> }
            }
          </tbody>
        </table>
      </div>
      <zed-pager [pager]="pager" />
    </div>
    @if (loading()) { <div class="loadingdiv" style="display: block" role="status" aria-live="polite"><div class="loadingimage"><div class="loader"></div><div class="text-center"><small>{{ 'Please wait ...' | t: 'staff.paymentsReceived.loadingText' }}</small></div></div></div> }
  `,
  styles: `
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    .pr-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 16px; }
    .pr-tile { background: #fff; border: 1px solid #e1eaea; border-radius: 12px; padding: 14px 16px; box-shadow: 0 2px 8px rgba(16, 61, 64, .05); min-width: 0; }
    .pr-tile { border-color: #dde7e8; border-radius: 14px; padding: 16px 18px; }
    .pr-tile b { display: block; font-size: 24px; font-weight: 800; color: #24666b; line-height: 1.2; overflow-wrap: anywhere; }
    .pr-tile b.warn { color: #9a5f06; }
    .pr-tile b.good { color: #2f9e58; }
    .pr-tile span { font-size: 12.5px; color: #3d5559; font-weight: 500; }
    .pr-btn { display: inline-flex; align-items: center; gap: 8px; }
    .pr-filters { padding: 12px 14px; margin-bottom: 14px; }
    .pr-filters .form-label { font-size: 11.5px; font-weight: 600; color: #6f8487; }
    .pr-filters .filter { flex: 0 1 170px; }
    .pr-filters .filter.pr-search { order: -1; flex: 0 1 280px; position: relative; }
    .pr-filters .filter.pr-paid { flex-basis: 200px; }
    .pr-search .pr-ico { position: absolute; left: 12px; bottom: 12px; color: #6f8487; }
    .pr-search input { padding-left: 36px; background-image: none !important; }
    .pr-table > tbody > tr > td { font-size: 13.5px; font-weight: 500; color: #3d5559; vertical-align: middle; }
    .pr-table td.num b { font-size: 13.5px; font-weight: 700; color: #17373b; }
    .unit-cell small { display: block; font-size: 11.5px; font-weight: 700; color: #24666b; letter-spacing: .3px; }
    .list-card th.num, .list-card td.num { text-align: right !important; white-space: nowrap; }
    td small.sub, td .sub { display: block; font-size: 11.5px; font-weight: 500; color: #6f8487; }
    .pr-table > tbody > tr > td.pr-paid-on { white-space: nowrap; font-size: 11.5px; color: #6f8487; }
    .pr-tax span { display: block; font-size: 11.5px; color: #6f8487; letter-spacing: .3px; white-space: nowrap; }
    .pr-zero { color: var(--zt-mid2, #2a8a8c) !important; font-weight: 700; }
    @media (max-width: 767.98px) {
      .pr-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .pr-tile b { font-size: 19px; }
    }
  `,
})
export class PaymentsReceivedPage {
  private readonly api = inject(DashboardApi);
  private readonly exporter = inject(TableExport);
  private readonly toast = inject(ToastService);

  protected readonly crumbs = computed(() => staffCrumbs({ label: t('staff.paymentsReceived.crumb', 'Payment Received') }));
  protected readonly pager = new ClientPager<Row>();
  protected readonly filter = signal<ListFilter>({});
  protected readonly loading = signal(false);
  protected readonly exporting = signal(false);
  protected readonly error = signal('');
  protected readonly flag = flag;
  protected readonly consultancy = inject(STAFF_SYSTEM) === 'consultancy';
  protected readonly paidRanges = PAID_RANGES;
  /** The "Paid between" choice ('' any date). */
  protected readonly paid = signal('');
  protected readonly day = (v: unknown) => shortDay(v);

  /** The four totals of the rows shown (the filters and the search apply). */
  protected readonly tiles = computed(() => {
    const rows = this.pager.filtered();
    const sum = rows.reduce((s, r) => s + num(r, 'FinalAmountPaid'), 0);
    const tds = rows.filter((r) => num(r, 'Tds') > 0).length;
    const last = this.consultancy
      ? { label: t('staff.paymentsReceived.tile.zeroAmount', 'Zero amount'), value: rows.filter((r) => text(r, 'PaymentType') === 'ZeroAmount').length.toLocaleString('en-IN'), tone: '' }
      : { label: t('staff.paymentsReceived.tile.reward', 'Used Joining Reward'), value: rows.filter((r) => flag(r, 'IsCouponUsed')).length.toLocaleString('en-IN'), tone: 'good' };
    return [
      { label: t('staff.paymentsReceived.tile.amount', 'Amount received'), value: rupees(sum), tone: '' },
      { label: t('staff.paymentsReceived.tile.payments', 'Payments'), value: rows.length.toLocaleString('en-IN'), tone: '' },
      { label: t('staff.paymentsReceived.tile.tds', 'With TDS deducted'), value: tds.toLocaleString('en-IN'), tone: 'warn' },
      last,
    ];
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const from = paidFrom(this.paid());
      const query = from ? { ...this.filter(), paidFrom: from, paidTo: paidFrom('1') } : this.filter();
      this.pager.set(await firstValueFrom(this.api.paymentsReceived(query)));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected onFilter(f: ListFilter): void {
    this.filter.set(f);
    this.pager.setSearch('');
    void this.load();
  }

  protected onPaid(range: string): void {
    this.paid.set(range);
    this.pager.setSearch('');
    void this.load();
  }

  protected level(row: Row): string {
    return levelName(text(row, 'Certification'));
  }

  protected percent(row: Row, field: string): string {
    const v = text(row, field).trim();
    return !v || v.endsWith('%') ? v : v + '%';
  }

  protected amount(row: Row): string {
    return rupees(num(row, 'FinalAmountPaid'));
  }

  protected paymentType(row: Row): string {
    const type = text(row, 'PaymentType').trim();
    return PAYMENT_TYPES[type]?.() ?? type;
  }

  protected taxIds(row: Row): string[] {
    return [text(row, 'GstinNumber'), text(row, 'TanNumber')].map((v) => v.trim()).filter(Boolean);
  }

  /** Export (approved): the rows shown (filters and search), with the full GSTIN and TAN. */
  protected async exportRows(): Promise<void> {
    const rows = this.pager.filtered();
    const v = (r: Row, c: string) => text(r, c);
    const columns = [
      t('staff.paymentsReceived.export.column.serial', 'S.No.'), t('staff.paymentsReceived.export.column.zedId', 'ZED ID'),
      t('staff.paymentsReceived.export.column.unit', 'Unit'), t('staff.paymentsReceived.export.column.level', 'Level'),
      t('staff.paymentsReceived.export.column.size', 'Size'), t('staff.paymentsReceived.export.column.gender', 'Gender'),
      t('staff.paymentsReceived.export.column.social', 'Social category'),
      this.consultancy ? t('staff.paymentsReceived.export.column.milestone', 'Milestone') : t('staff.paymentsReceived.export.column.reward', 'Joining reward'),
      t('staff.paymentsReceived.export.column.state', 'State'), t('staff.paymentsReceived.export.column.district', 'District'),
      t('staff.paymentsReceived.export.column.tds', 'TDS (%)'), t('staff.paymentsReceived.export.column.subsidy', 'Subsidy (%)'),
      t('staff.paymentsReceived.export.column.gstin', 'GSTIN'), t('staff.paymentsReceived.export.column.tan', 'TAN'),
      t('staff.paymentsReceived.export.column.paidOn', 'Paid on'), t('staff.paymentsReceived.export.column.type', 'Payment type'),
      t('staff.paymentsReceived.export.column.amount', 'Amount paid (Rs.)'),
    ];
    const yes = t('staff.paymentsReceived.reward.yes', 'Yes');
    const no = t('staff.paymentsReceived.reward.no', 'No');
    this.exporting.set(true);
    try {
      await this.exporter.xlsx('payments-received', [{
        name: 'Payments received',
        columns,
        rows: rows.map((r, i) => [i + 1, v(r, 'ZedId'), v(r, 'PUnitName'), this.level(r), v(r, 'EnterpriseTypee'), v(r, 'Gender'), v(r, 'SocialCategoryName'),
          this.consultancy ? v(r, 'MileStoneNum') : flag(r, 'IsCouponUsed') ? yes : no, v(r, 'PStateName'), v(r, 'PDistrictName'),
          v(r, 'Tds'), v(r, 'SubsidyPercentage'), v(r, 'GstinNumber'), v(r, 'TanNumber'), v(r, 'PaidOn').slice(0, 10), this.paymentType(r),
          num(r, 'FinalAmountPaid')]),
      }]);
      const count = rows.length;
      this.toast.success(t('staff.paymentsReceived.toast.exported', 'Export ready'),
        count === 1 ? t('staff.paymentsReceived.toast.exportedOne', '{count} payment.', { count }) : t('staff.paymentsReceived.toast.exportedMany', '{count} payments.', { count }));
    } catch (err) {
      this.toast.error(t('staff.paymentsReceived.toast.exportFailed', 'The export failed'), apiErrorMessage(err));
    } finally {
      this.exporting.set(false);
    }
  }
}
