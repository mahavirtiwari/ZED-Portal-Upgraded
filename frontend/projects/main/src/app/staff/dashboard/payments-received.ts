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
    <div class="page-head">
      <div>
        <h3 class="registration-title">MSME Payment Received</h3>
        <p class="page-sub">Payments received from the units, with the TDS, subsidy and amount paid.</p>
      </div>
    </div>
    <div class="zed-card">
      <zed-list-filters [filter]="filter()" (filterChange)="onFilter($event)">
        <div class="filter wide">
          <label class="form-label" for="pr-search">Search</label>
          <input type="search" id="pr-search" class="form-control" maxlength="50" placeholder="Search" aria-label="Search"
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
            <th class="text-center">ZED ID<br />Certification</th>
            <th>Unit Name</th>
            <th class="text-center">Size/Gender</th>
            <th class="text-center">Social Category</th>
            <th class="text-center">{{ consultancy ? 'Milestone' : 'Joining Reward' }}</th>
            <th>StateName<br />District Name</th>
            <th class="text-center">TAN (%)</th>
            <th class="text-center">Subsidy (%)</th>
            <th class="text-center">GSTIN/ TAN Number</th>
            <th class="text-center">Amount Paid (Rs.)</th>
          </tr>
        </thead>
        <tbody>
          @for (t of pager.page(); track $index) {
            <tr>
              <td class="text-center">{{ t['RowNumber'] }}</td>
              <td class="cell-lines text-center">
                <strong>{{ t['ZedId'] }}</strong>
                <span>{{ t['Certification'] }}</span>
                @if (!consultancy && t['MileStoneNum']) { <span>Milestone {{ t['MileStoneNum'] }}</span> }
              </td>
              <td><strong>{{ t['PUnitName'] }}</strong></td>
              <td class="cell-lines text-center"><span>{{ t['EnterpriseTypee'] }}</span><span>{{ t['Gender'] }}</span></td>
              <td class="text-center">{{ t['SocialCategoryName'] }}</td>
              @if (consultancy) {
                <td class="text-center">{{ t['MileStoneNum'] }}</td>
              } @else {
                <td class="text-center"><span class="status-badge" [class.is-success]="flag(t, 'IsCouponUsed')" [class.is-inactive]="!flag(t, 'IsCouponUsed')">{{ flag(t, 'IsCouponUsed') ? 'Yes' : 'No' }}</span></td>
              }
              @if (consultancy) {
                <td class="cell-lines"><span>{{ t['PStateName'] }}</span><span>{{ t['PDistrictName'] }}</span></td>
              } @else {
                <td class="cell-lines"><strong>{{ t['PStateName'] }}</strong><span>{{ t['PDistrictName'] }}</span></td>
              }
              <td class="text-center">{{ t['Tds'] }}</td>
              <td class="text-center">{{ t['SubsidyPercentage'] }}</td>
              <td class="text-center">{{ t['GstinNumber'] }} {{ t['TanNumber'] }}</td>
              <td class="text-center"><strong>{{ t['FinalAmountPaid'] }}</strong></td>
            </tr>
          } @empty {
            @if (!loading()) { <tr><td colspan="11" style="padding: 0"><div class="no-data">No Data</div></td></tr> }
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
