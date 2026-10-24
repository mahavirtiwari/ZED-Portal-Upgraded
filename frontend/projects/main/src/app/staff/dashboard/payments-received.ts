import { Component, inject, signal } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { DashboardApi, ListFilter, Row } from './dashboard.api';
import { ClientPager, flag } from './dashboard-filters';
import { PagerComponent } from '../pager';
import { STAFF_SYSTEM } from '../staff-menu';
import { ListFiltersBar } from './list-controls';

/**
 * MSME payments received (MasterAdmin). Port of Views/Dashboard/PaymentReceived.cshtml. The old page's
 * Approve/Reject handlers had no pop-up markup and could not be used; they are not ported. Consultancy's page
 * (ZEDCS_CONSULTANCY Frontend/Dashboard/PaymentReceived.cshtml) has a Milestone column where the others have
 * Joining Reward.
 */
@Component({
  selector: 'zed-staff-payments-received',
  imports: [ListFiltersBar, PagerComponent],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="mt-4">
        <div class="row">
          <div class="col-sm-12"><h3 class="registration-title">MSME Payment Received</h3></div>
          <div class="col-sm-9 mb-4"><zed-list-filters [filter]="filter()" (filterChange)="onFilter($event)" /></div>
          <div class="col-sm-3" style="margin-top: 24px">
            <input type="search" class="form-control" maxlength="50" placeholder="Search" aria-label="Search"
                   [value]="pager.search()" (input)="pager.setSearch($any($event.target).value)" />
          </div>
        </div>
        @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
        <div class="table-responsive">
          <table class="table table-zed table-bordered">
            <thead>
              <tr>
                <th>S.No.</th>
                <th>ZED ID<br /><br />Certification</th>
                <th>Unit Name</th>
                <th>Size/Gender</th>
                <th>Social Category</th>
                <th>{{ consultancy ? 'Milestone' : 'Joining Reward' }}</th>
                <th>StateName<br /><br />District Name</th>
                <th>TAN (%)</th>
                <th>Subsidy (%)</th>
                <th>GSTIN/ TAN Number</th>
                <th>Amount Paid (Rs.)</th>
              </tr>
            </thead>
            <tbody>
              @for (t of pager.page(); track $index) {
                <tr>
                  <td>{{ t['RowNumber'] }}</td>
                  <td><strong>{{ t['ZedId'] }}</strong><br /><br />{{ t['Certification'] }}@if (!consultancy && t['MileStoneNum']) { <br />Milestone {{ t['MileStoneNum'] }} }</td>
                  <td><strong>{{ t['PUnitName'] }}</strong></td>
                  <td>{{ t['EnterpriseTypee'] }}<br /><br />{{ t['Gender'] }}</td>
                  <td>{{ t['SocialCategoryName'] }}</td>
                  @if (consultancy) {
                    <td>{{ t['MileStoneNum'] }}</td>
                  } @else {
                    <td>{{ flag(t, 'IsCouponUsed') ? 'Yes' : 'No' }}</td>
                  }
                  @if (consultancy) {
                    <td>{{ t['PStateName'] }}<br />{{ t['PDistrictName'] }}</td>
                  } @else {
                    <td><strong>{{ t['PStateName'] }}</strong><br /><br />{{ t['PDistrictName'] }}</td>
                  }
                  <td>{{ t['Tds'] }}</td>
                  <td>{{ t['SubsidyPercentage'] }}</td>
                  <td>{{ t['GstinNumber'] }} {{ t['TanNumber'] }}</td>
                  <td><strong>{{ t['FinalAmountPaid'] }}</strong></td>
                </tr>
              } @empty {
                @if (!loading()) { <tr><td colspan="11" style="padding: 0"><div class="no-data">No Data</div></td></tr> }
              }
            </tbody>
          </table>
        </div>
        <zed-pager [pager]="pager" />
      </div>
    </div>
    @if (loading()) { <div class="loadingdiv" style="display: block" role="status" aria-live="polite"><div class="loadingimage"><div class="loader"></div><div class="text-center"><small>Please wait ...</small></div></div></div> }
  `,
  styles: `.loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }`,
})
export class PaymentsReceivedPage {
  private readonly api = inject(DashboardApi);

  protected readonly pager = new ClientPager<Row>();
  protected readonly filter = signal<ListFilter>({});
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly flag = flag;
  protected readonly consultancy = inject(STAFF_SYSTEM) === 'consultancy';

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
}
