import { Component, computed, inject, signal } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { DashboardApi, ListFilter, Row } from './dashboard.api';
import { ClientPager } from './dashboard-filters';
import { PagerComponent } from '../pager';
import { ListFiltersBar } from './list-controls';
import { DashboardPortalSwitchComponent } from '../dashboard-portal-switch';
import { TextPipe, t } from '../../content/page-text';
import { PageHead } from '../../msme/shared/page-head';
import { ListCounts } from '../list-counts';
import { staffCrumbs } from '../staff-crumbs';
import { formatCount } from './charts';

/**
 * Financial support per unit (SuperAdmin, CitizenFeedback). Port of Views/Dashboard/FinancialSupport.cshtml.
 * The procedure returns no RowNumber (the old S.No. column was empty); the serial is numbered here.
 */
@Component({
  selector: 'zed-staff-financial-support',
  imports: [ListFiltersBar, PagerComponent, DashboardPortalSwitchComponent, PageHead, ListCounts, TextPipe],
  host: { class: 'list-v2 d-block' },
  template: `
    <!-- One Dashboard Admin (2026-11-07): the portal of this screen. -->
    <zed-dashboard-portal-switch [screens]="['financial-support']" />
    <!-- 2026-11-26 (the user: "Please enhance UI and design"): the staff list design (page head, totals, filters card, list card). -->
    <zed-page-head [crumbs]="crumbs()" [title]="'Financial Support' | t: 'staff.financialSupport.title'"
                   [subtitle]="'Certification fee, amount paid by the unit and the financial support given, per unit.' | t: 'staff.financialSupport.sub'" />
    <zed-list-counts [counts]="counts()" class="fs-counts" />
    <div class="zed-card">
      <zed-list-filters [filter]="filter()" (filterChange)="onFilter($event)">
        <div class="filter wide">
          <label class="form-label" for="fs-search">{{ 'Search' | t: 'staff.financialSupport.search.label' }}</label>
          <input type="search" id="fs-search" class="form-control" maxlength="50" [placeholder]="'Search' | t: 'staff.financialSupport.search.placeholder'" [attr.aria-label]="'Search' | t: 'staff.financialSupport.search.label'"
                 [value]="pager.search()" (input)="pager.setSearch($any($event.target).value)" />
        </div>
      </zed-list-filters>
    </div>
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
    <div class="list-card">
    <div class="list-card-head"><b>{{ 'Units' | t: 'staff.financialSupport.list.title' }}</b></div>
    <div class="table-responsive">
      <table class="table table-zed">
        <thead>
          <tr>
            <th class="text-center">{{ 'S.No.' | t: 'staff.financialSupport.column.serial' }}</th>
            <th class="text-center">{{ 'Certification Level' | t: 'staff.financialSupport.column.level' }}</th>
            <th>{{ 'Unit Name' | t: 'staff.financialSupport.column.unitName' }}<br />{{ 'ZedId' | t: 'staff.financialSupport.column.zedId' }}<br />{{ 'Enterprise Size' | t: 'staff.financialSupport.column.size' }}</th>
            <th class="text-center">{{ 'Status' | t: 'staff.financialSupport.column.status' }}</th>
            <th>{{ 'Unit Address' | t: 'staff.financialSupport.column.address' }}</th>
            <th>{{ 'State' | t: 'staff.financialSupport.column.state' }}</th>
            <th class="text-center">{{ 'Certification Fee' | t: 'staff.financialSupport.column.fee' }}<br />{{ '(Amount in Rs.)' | t: 'staff.financialSupport.column.amountNote' }}</th>
            <th class="text-center">{{ 'Amount Paid by Unit' | t: 'staff.financialSupport.column.paid' }}<br />{{ '(Amount in Rs.)' | t: 'staff.financialSupport.column.amountNote' }}</th>
            <th class="text-center">{{ 'Financial Support' | t: 'staff.financialSupport.column.support' }}<br />{{ '(Amount in Rs.)' | t: 'staff.financialSupport.column.amountNote' }}</th>
          </tr>
        </thead>
        <tbody>
          @for (s of pager.page(); track $index) {
            <tr>
              <td class="text-center">{{ pager.serial($index) }}</td>
              <td class="text-center">@if (s['Certification']) { <span [class]="'lv-tag lv-' + levelClass(s['Certification'])">{{ s['Certification'] }}</span> }</td>
              <td class="cell-lines"><strong>{{ s['PUnitName'] }}</strong><span>{{ s['ZedId'] }}</span><strong>{{ s['EnterpriseType'] }}</strong></td>
              <td class="text-center">@if (s['ZedIdStatus']) { <span class="status-badge" [class.is-info]="s['ZedIdStatus'] !== 'Rejected'" [class.is-danger]="s['ZedIdStatus'] === 'Rejected'">{{ s['ZedIdStatus'] }}</span> }</td>
              <td>{{ s['UnitAddress'] }}</td>
              <td>{{ s['PStateName'] }}</td>
              <!-- 2026-11-26 (Dashboard Admin audit): amounts with Indian grouping (10,000), a dash where the procedure has none. -->
              <td class="text-end amount">{{ money(s['CertificationFee']) }}</td>
              <td class="text-end amount">{{ money(s['Amount']) }}</td>
              <td class="text-end amount"><strong>{{ money(s['FinancialSupport']) }}</strong></td>
            </tr>
          } @empty {
            @if (!loading()) { <tr><td colspan="9" style="padding: 0"><div class="no-data">{{ 'No Data' | t: 'staff.financialSupport.empty' }}</div></td></tr> }
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="pager" />
    </div>
    @if (loading()) { <div class="loadingdiv" style="display: block" role="status" aria-live="polite"><div class="loadingimage"><div class="loader"></div><div class="text-center"><small>{{ 'Please wait ...' | t: 'staff.financialSupport.loadingText' }}</small></div></div></div> }
  `,
  styles: `
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    /* Several values in one cell, one per line (the old pages separated them with <br /><br />). */
    .cell-lines > * { display: block; }
    .cell-lines > * + * { margin-top: 4px; }
    .amount { white-space: nowrap; font-variant-numeric: tabular-nums; }
    .fs-counts { display: block; margin-bottom: 14px; }
    .zed-card { margin-bottom: 14px; }
  `,
})
export class FinancialSupportPage {
  private readonly api = inject(DashboardApi);

  protected readonly pager = new ClientPager<Row>();
  protected readonly crumbs = computed(() => staffCrumbs({ label: t('staff.financialSupport.crumb', 'Financial Support') }));
  /** The rows listed and the totals of the amounts (of the rows matching the search). */
  protected readonly counts = computed(() => {
    const rows = this.pager.filtered();
    const sum = (k: string) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    return [
      { label: t('staff.financialSupport.count.rows', 'Rows'), value: rows.length },
      { label: t('staff.financialSupport.count.fee', 'Certification fee (Rs.)'), value: formatCount(sum('CertificationFee')) },
      { label: t('staff.financialSupport.count.paid', 'Paid by units (Rs.)'), value: formatCount(sum('Amount')) },
      { label: t('staff.financialSupport.count.support', 'Financial support (Rs.)'), value: formatCount(sum('FinancialSupport')) },
    ];
  });

  protected levelClass(level: unknown): string {
    return String(level ?? '').toLowerCase().replace(/[^a-z]/g, '');
  }
  protected readonly filter = signal<ListFilter>({});
  protected readonly loading = signal(false);
  protected readonly error = signal('');

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.pager.set(await firstValueFrom(this.api.financialSupport(this.filter())));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** An amount as 10,000 (Indian grouping); '—' when empty (Financial Assistance rows have no fee or payment). */
  protected money(value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    const n = Number(value);
    return Number.isFinite(n) ? formatCount(n) : String(value);
  }

  protected onFilter(f: ListFilter): void {
    this.filter.set(f);
    this.pager.setSearch('');
    void this.load();
  }
}
