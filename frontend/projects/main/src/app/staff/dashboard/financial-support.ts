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
    <div class="container form-page" id="zed_user_form">
      <div class="row mt-3">
        <div class="col-sm-12"><h3 class="registration-title">Financial Support</h3></div>
        <div class="col-sm-12 mb-4"><zed-list-filters [filter]="filter()" (filterChange)="onFilter($event)" /></div>
        <div class="row justify-content-end mb-2">
          <div class="col-sm-3">
            <input type="search" class="form-control" maxlength="50" placeholder="Search" aria-label="Search"
                   [value]="pager.search()" (input)="pager.setSearch($any($event.target).value)" />
          </div>
        </div>
        @if (error()) { <div class="col-sm-12"><div class="alert alert-danger" role="alert">{{ error() }}</div></div> }
        <div class="col-sm-12">
          <div class="table-responsive">
            <table class="table table-zed table-bordered">
              <thead>
                <tr>
                  <th>S.No.</th>
                  <th>Certification Level</th>
                  <th>Unit Name<br />ZedId<br />Enterprise Size</th>
                  <th>Status</th>
                  <th>Unit Address</th>
                  <th>State</th>
                  <th>Certification Fee<br />(Amount in Rs.)</th>
                  <th>Amount Paid by Unit<br />(Amount in Rs.)</th>
                  <th>Financial Support<br />(Amount in Rs.)</th>
                </tr>
              </thead>
              <tbody>
                @for (s of pager.page(); track $index) {
                  <tr>
                    <td>{{ pager.serial($index) }}</td>
                    <td>{{ s['Certification'] }}</td>
                    <td><strong>{{ s['PUnitName'] }}</strong><br /><br />{{ s['ZedId'] }}<br /><br /><strong>{{ s['EnterpriseType'] }}</strong></td>
                    <td>{{ s['ZedIdStatus'] }}</td>
                    <td>{{ s['UnitAddress'] }}</td>
                    <td>{{ s['PStateName'] }}</td>
                    <td>{{ s['CertificationFee'] }}</td>
                    <td>{{ s['Amount'] }}</td>
                    <td>{{ s['FinancialSupport'] }}</td>
                  </tr>
                } @empty {
                  @if (!loading()) { <tr><td colspan="9" style="padding: 0"><div class="no-data">No Data</div></td></tr> }
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <zed-pager [pager]="pager" />
    </div>
    @if (loading()) { <div class="loadingdiv" role="status"><img src="Images/loading.gif" alt="Loading" /></div> }
  `,
  styles: `.loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }`,
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
