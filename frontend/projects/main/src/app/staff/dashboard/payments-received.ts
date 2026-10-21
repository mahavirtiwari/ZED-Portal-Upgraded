import { Component, inject, signal } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { DashboardApi, ListFilter } from './dashboard.api';
import { ClientPager, flag } from './dashboard-filters';
import { ListFiltersBar, PagerBar } from './list-controls';

/**
 * MSME payments received (MasterAdmin). Port of Views/Dashboard/PaymentReceived.cshtml. The old page's
 * Approve/Reject handlers had no pop-up markup and could not be used; they are not ported.
 */
@Component({
  selector: 'zed-staff-payments-received',
  imports: [ListFiltersBar, PagerBar],
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
                <th>Joining Reward</th>
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
                  <td><strong>{{ t['ZedId'] }}</strong><br /><br />{{ t['Certification'] }}@if (t['MileStoneNum']) { <br />Milestone {{ t['MileStoneNum'] }} }</td>
                  <td><strong>{{ t['PUnitName'] }}</strong></td>
                  <td>{{ t['EnterpriseTypee'] }}<br /><br />{{ t['Gender'] }}</td>
                  <td>{{ t['SocialCategoryName'] }}</td>
                  <td>{{ flag(t, 'IsCouponUsed') ? 'Yes' : 'No' }}</td>
                  <td><strong>{{ t['PStateName'] }}</strong><br /><br />{{ t['PDistrictName'] }}</td>
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
        <zed-pager-bar [pager]="pager" />
      </div>
    </div>
    @if (loading()) { <div class="loadingdiv" role="status"><img src="Images/loading.gif" alt="Loading" /></div> }
  `,
  styles: `.loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }`,
})
export class PaymentsReceivedPage {
  private readonly api = inject(DashboardApi);

  protected readonly pager = new ClientPager();
  protected readonly filter = signal<ListFilter>({});
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly flag = flag;

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
