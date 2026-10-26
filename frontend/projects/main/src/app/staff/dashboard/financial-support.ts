import { Component, inject, signal } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { DashboardApi, ListFilter, Row } from './dashboard.api';
import { ClientPager } from './dashboard-filters';
import { PagerComponent } from '../pager';
import { ListFiltersBar } from './list-controls';

/**
 * Financial support per unit (SuperAdmin, CitizenFeedback). Port of Views/Dashboard/FinancialSupport.cshtml.
 * The procedure returns no RowNumber (the old S.No. column was empty); the serial is numbered here.
 */
@Component({
  selector: 'zed-staff-financial-support',
  imports: [ListFiltersBar, PagerComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Financial Support</h3>
        <p class="page-sub">Certification fee, amount paid by the unit and the financial support given, per unit.</p>
      </div>
    </div>
    <div class="zed-card">
      <zed-list-filters [filter]="filter()" (filterChange)="onFilter($event)">
        <div class="filter wide">
          <label class="form-label" for="fs-search">Search</label>
          <input type="search" id="fs-search" class="form-control" maxlength="50" placeholder="Search" aria-label="Search"
                 [value]="pager.search()" (input)="pager.setSearch($any($event.target).value)" />
        </div>
      </zed-list-filters>
    </div>
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
    <div class="table-responsive">
      <table class="table table-zed table-bordered">
        <thead>
          <tr>
            <th class="text-center">S.No.</th>
            <th class="text-center">Certification Level</th>
            <th>Unit Name<br />ZedId<br />Enterprise Size</th>
            <th class="text-center">Status</th>
            <th>Unit Address</th>
            <th>State</th>
            <th class="text-center">Certification Fee<br />(Amount in Rs.)</th>
            <th class="text-center">Amount Paid by Unit<br />(Amount in Rs.)</th>
            <th class="text-center">Financial Support<br />(Amount in Rs.)</th>
          </tr>
        </thead>
        <tbody>
          @for (s of pager.page(); track $index) {
            <tr>
              <td class="text-center">{{ pager.serial($index) }}</td>
              <td class="text-center">{{ s['Certification'] }}</td>
              <td class="cell-lines"><strong>{{ s['PUnitName'] }}</strong><span>{{ s['ZedId'] }}</span><strong>{{ s['EnterpriseType'] }}</strong></td>
              <td class="text-center">@if (s['ZedIdStatus']) { <span class="status-badge is-info">{{ s['ZedIdStatus'] }}</span> }</td>
              <td>{{ s['UnitAddress'] }}</td>
              <td>{{ s['PStateName'] }}</td>
              <td class="text-center">{{ s['CertificationFee'] }}</td>
              <td class="text-center">{{ s['Amount'] }}</td>
              <td class="text-center">{{ s['FinancialSupport'] }}</td>
            </tr>
          } @empty {
            @if (!loading()) { <tr><td colspan="9" style="padding: 0"><div class="no-data">No Data</div></td></tr> }
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="pager" />
    @if (loading()) { <div class="loadingdiv" style="display: block" role="status" aria-live="polite"><div class="loadingimage"><div class="loader"></div><div class="text-center"><small>Please wait ...</small></div></div></div> }
  `,
  styles: `
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    /* Several values in one cell, one per line (the old pages separated them with <br /><br />). */
    .cell-lines > * { display: block; }
    .cell-lines > * + * { margin-top: 4px; }
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

  protected onFilter(f: ListFilter): void {
    this.filter.set(f);
    this.pager.setSearch('');
    void this.load();
  }
}
