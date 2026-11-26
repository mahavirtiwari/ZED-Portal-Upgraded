import { Component, inject, signal } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { DashboardApi, ListFilter, Row } from './dashboard.api';
import { ClientPager } from './dashboard-filters';
import { PagerComponent } from '../pager';
import { ListFiltersBar } from './list-controls';
import { DashboardPortalSwitchComponent } from '../dashboard-portal-switch';
import { TextPipe } from '../../content/page-text';
import { formatCount } from './charts';

/**
 * Financial support per unit (SuperAdmin, CitizenFeedback). Port of Views/Dashboard/FinancialSupport.cshtml.
 * The procedure returns no RowNumber (the old S.No. column was empty); the serial is numbered here.
 */
@Component({
  selector: 'zed-staff-financial-support',
  imports: [ListFiltersBar, PagerComponent, DashboardPortalSwitchComponent, TextPipe],
  template: `
    <!-- One Dashboard Admin (2026-11-07): the portal of this screen. -->
    <zed-dashboard-portal-switch [screens]="['financial-support']" />
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ 'Financial Support' | t: 'staff.financialSupport.title' }}</h3>
        <p class="page-sub">{{ 'Certification fee, amount paid by the unit and the financial support given, per unit.' | t: 'staff.financialSupport.sub' }}</p>
      </div>
    </div>
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
    <div class="table-responsive">
      <table class="table table-zed table-bordered">
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
              <td class="text-center">{{ s['Certification'] }}</td>
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
    @if (loading()) { <div class="loadingdiv" style="display: block" role="status" aria-live="polite"><div class="loadingimage"><div class="loader"></div><div class="text-center"><small>{{ 'Please wait ...' | t: 'staff.financialSupport.loadingText' }}</small></div></div></div> }
  `,
  styles: `
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    /* Several values in one cell, one per line (the old pages separated them with <br /><br />). */
    .cell-lines > * { display: block; }
    .cell-lines > * + * { margin-top: 4px; }
    .amount { white-space: nowrap; font-variant-numeric: tabular-nums; }
  `,
})
export class FinancialSupportPage {
  private readonly api = inject(DashboardApi);

  protected readonly pager = new ClientPager<Row>();
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
