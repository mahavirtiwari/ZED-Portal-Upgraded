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

/** MsmePaymentInfo.PaymentType as shown (ZeroAmount: nothing to pay after the subsidy or reward, 2026-11-17). */
const PAYMENT_TYPES: Record<string, string> = {
  PaymentGateway: 'Online',
  NEFT: 'NEFT',
  ZeroAmount: 'Zero amount',
  PaidAtMilestone1: 'Paid at milestone 1',
};

/** A number of the list (amounts and percentages come as numbers or text). */
function num(row: Row, field: string): number {
  const n = Number(String(row[field] ?? '').replace(/[,%\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function rupees(n: number): string {
  return '₹ ' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/** GSTIN / TAN partly masked in the list: "27AAB•••1Z5" (the export keeps the full number). */
export function masked(value: string): string {
  const v = value.trim();
  if (v.length <= 6) return v ? v.slice(0, 1) + '•••' : '';
  const keep = v.length > 10 ? [5, 3] : [4, 2];
  return v.slice(0, keep[0]) + '•••' + v.slice(-keep[1]);
}

/**
 * MSME payments received (MasterAdmin). Port of Views/Dashboard/PaymentReceived.cshtml. The old page's
 * Approve/Reject handlers had no pop-up markup and could not be used; they are not ported. Consultancy's page
 * (ZEDCS_CONSULTANCY Frontend/Dashboard/PaymentReceived.cshtml) has a Milestone column where the others have
 * Joining Reward.
 * <p>2026-11-17 (approved redesign): four totals of the rows shown (worked out here from the loaded list), Export of those
 * rows, search and filters in one row, the unit as name over ZED ID, GSTIN / TAN partly masked, amounts right-aligned and
 * the payment type under the amount ("Zero amount" for a 100% subsidy). The design's "Paid on" column and "Paid between"
 * filter are not shown: SP_DASHBOARD_PAYMENT_TRANSACTIONS returns no payment date.</p>
 */
@Component({
  selector: 'zed-staff-payments-received',
  imports: [ListFiltersBar, PagerComponent, PageHead],
  host: { class: 'list-v2 d-block' },
  template: `
    <zed-page-head [crumbs]="crumbs" title="MSME Payment Received" subtitle="Payments received from the units, with the TDS, subsidy and amount paid.">
      <button type="button" class="btn btn-outline-primary" [disabled]="exporting() || !pager.total()" (click)="exportRows()">
        {{ exporting() ? 'Exporting…' : 'Export' }}</button>
    </zed-page-head>
    <div class="pr-tiles" role="list" aria-label="Totals of the payments shown">
      @for (t of tiles(); track t.label) {
        <div class="pr-tile" role="listitem"><b [class]="t.tone">{{ t.value }}</b>&ngsp;<span>{{ t.label }}</span></div>
      }
    </div>
    <div class="zed-card pr-filters">
      <zed-list-filters [filter]="filter()" (filterChange)="onFilter($event)">
        <div class="filter wide pr-search">
          <label class="form-label" for="pr-search">Search</label>
          <input type="search" id="pr-search" class="form-control" maxlength="50" placeholder="Search ZED ID, unit, GSTIN or TAN"
                 [value]="pager.search()" (input)="pager.setSearch($any($event.target).value)" />
        </div>
      </zed-list-filters>
    </div>
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
    <div class="list-card">
      <div class="table-responsive">
        <table class="table table-zed">
          <thead>
            <tr>
              <th>Unit</th>
              <th>Level</th>
              <th>Size / Gender</th>
              <th>Social category</th>
              <th>{{ consultancy ? 'Milestone' : 'Joining reward' }}</th>
              <th>State / District</th>
              <th class="num">TDS</th>
              <th class="num">Subsidy</th>
              <th>GSTIN / TAN</th>
              <th class="num">Amount paid</th>
            </tr>
          </thead>
          <tbody>
            @for (t of pager.page(); track $index) {
              <tr>
                <td class="unit-cell">
                  <b>{{ t['PUnitName'] }}</b><small>{{ t['ZedId'] }}</small>
                  @if (!consultancy && t['MileStoneNum']) { <small>Milestone {{ t['MileStoneNum'] }}</small> }
                </td>
                <td>@if (t['Certification']) { <span class="lv-tag" [class]="'lv-' + lower(t, 'Certification')">{{ level(t) }}</span> }</td>
                <td><span>{{ t['EnterpriseTypee'] }}</span><small class="sub">{{ t['Gender'] }}</small></td>
                <td>{{ t['SocialCategoryName'] }}</td>
                @if (consultancy) {
                  <td>{{ t['MileStoneNum'] }}</td>
                } @else {
                  <td><span class="chip" [class.is-good]="flag(t, 'IsCouponUsed')">{{ flag(t, 'IsCouponUsed') ? 'Yes' : 'No' }}</span></td>
                }
                <td><span>{{ t['PStateName'] }}</span><small class="sub">{{ t['PDistrictName'] }}</small></td>
                <td class="num">{{ percent(t, 'Tds') }}</td>
                <td class="num">{{ percent(t, 'SubsidyPercentage') }}</td>
                <td class="pr-tax">
                  @let ids = taxIds(t);
                  @for (id of ids; track $index) { <span>{{ id }}</span> } @empty { <span class="sub">Not given</span> }
                </td>
                <td class="num">
                  <b>{{ amount(t) }}</b>
                  @if (paymentType(t); as p) { <small class="sub" [class.pr-zero]="t['PaymentType'] === 'ZeroAmount'">{{ p }}</small> }
                </td>
              </tr>
            } @empty {
              @if (!loading()) { <tr><td colspan="10" style="padding: 0"><div class="no-data">No Data</div></td></tr> }
            }
          </tbody>
        </table>
      </div>
      <zed-pager [pager]="pager" />
    </div>
    @if (loading()) { <div class="loadingdiv" style="display: block" role="status" aria-live="polite"><div class="loadingimage"><div class="loader"></div><div class="text-center"><small>Please wait ...</small></div></div></div> }
  `,
  styles: `
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    .pr-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 16px; }
    .pr-tile { background: #fff; border: 1px solid #e1eaea; border-radius: 12px; padding: 14px 16px; box-shadow: 0 2px 8px rgba(16, 61, 64, .05); min-width: 0; }
    .pr-tile b { display: block; font-size: 24px; font-weight: 800; color: var(--zt-ink, #173f44); line-height: 1.2; overflow-wrap: anywhere; }
    .pr-tile b.warn { color: #a86a12; }
    .pr-tile b.good { color: #1e8a4c; }
    .pr-tile span { font-size: 13px; color: #5f6f70; font-weight: 600; }
    .pr-filters { padding: 12px 14px; margin-bottom: 14px; }
    .pr-search { order: -1; }
    .list-card th.num, .list-card td.num { text-align: right !important; white-space: nowrap; }
    td small.sub, td .sub { display: block; }
    .pr-tax span { display: block; font-size: 12.5px; letter-spacing: .3px; white-space: nowrap; }
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

  protected readonly crumbs = staffCrumbs({ label: 'Payment Received' });
  protected readonly pager = new ClientPager<Row>();
  protected readonly filter = signal<ListFilter>({});
  protected readonly loading = signal(false);
  protected readonly exporting = signal(false);
  protected readonly error = signal('');
  protected readonly flag = flag;
  protected readonly consultancy = inject(STAFF_SYSTEM) === 'consultancy';

  /** The four totals of the rows shown (the filters and the search apply). */
  protected readonly tiles = computed(() => {
    const rows = this.pager.filtered();
    const sum = rows.reduce((s, r) => s + num(r, 'FinalAmountPaid'), 0);
    const tds = rows.filter((r) => num(r, 'Tds') > 0).length;
    const last = this.consultancy
      ? { label: 'Zero amount', value: rows.filter((r) => text(r, 'PaymentType') === 'ZeroAmount').length.toLocaleString('en-IN'), tone: '' }
      : { label: 'Used Joining Reward', value: rows.filter((r) => flag(r, 'IsCouponUsed')).length.toLocaleString('en-IN'), tone: 'good' };
    return [
      { label: 'Amount received', value: rupees(sum), tone: '' },
      { label: 'Payments', value: rows.length.toLocaleString('en-IN'), tone: '' },
      { label: 'With TDS deducted', value: tds.toLocaleString('en-IN'), tone: 'warn' },
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
      this.pager.set(await firstValueFrom(this.api.paymentsReceived(this.filter())));
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

  protected lower(row: Row, field: string): string {
    return text(row, field).toLowerCase();
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
    const t = text(row, 'PaymentType').trim();
    return PAYMENT_TYPES[t] ?? t;
  }

  protected taxIds(row: Row): string[] {
    return [text(row, 'GstinNumber'), text(row, 'TanNumber')].filter((v) => v.trim()).map(masked);
  }

  /** Export (approved): the rows shown (filters and search), with the full GSTIN and TAN. */
  protected async exportRows(): Promise<void> {
    const rows = this.pager.filtered();
    const t = (r: Row, c: string) => text(r, c);
    this.exporting.set(true);
    try {
      await this.exporter.xlsx('payments-received', [{
        name: 'Payments received',
        columns: ['S.No.', 'ZED ID', 'Unit', 'Level', 'Size', 'Gender', 'Social category', this.consultancy ? 'Milestone' : 'Joining reward',
          'State', 'District', 'TDS (%)', 'Subsidy (%)', 'GSTIN', 'TAN', 'Payment type', 'Amount paid (Rs.)'],
        rows: rows.map((r, i) => [i + 1, t(r, 'ZedId'), t(r, 'PUnitName'), this.level(r), t(r, 'EnterpriseTypee'), t(r, 'Gender'), t(r, 'SocialCategoryName'),
          this.consultancy ? t(r, 'MileStoneNum') : flag(r, 'IsCouponUsed') ? 'Yes' : 'No', t(r, 'PStateName'), t(r, 'PDistrictName'),
          t(r, 'Tds'), t(r, 'SubsidyPercentage'), t(r, 'GstinNumber'), t(r, 'TanNumber'), this.paymentType(r), num(r, 'FinalAmountPaid')]),
      }]);
      this.toast.success('Export ready', `${rows.length} payment${rows.length === 1 ? '' : 's'}.`);
    } catch (err) {
      this.toast.error('The export failed', apiErrorMessage(err));
    } finally {
      this.exporting.set(false);
    }
  }
}
