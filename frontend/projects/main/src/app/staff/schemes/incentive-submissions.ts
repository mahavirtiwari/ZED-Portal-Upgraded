import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { IncentiveFilter, IncentivesApi, Row, STATES } from './incentives.api';
import { ListSearchComponent, PagedView, PagerComponent, searchRows } from '../pager';

/**
 * "API Incentives Submitted" for the super admin. Port of Views/Incentive/Submissions.cshtml
 * (SP_GET_API_INCENTIVES, which also lists technology upgradation reimbursements from ZED_CONSULTANT).
 */
@Component({
  selector: 'zed-staff-incentive-submissions',
  imports: [FormsModule, PagerComponent, ListSearchComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">API Incentives Submitted</h3>
        <p class="page-sub">Incentives disbursed to the units, as reported by the ministries' APIs and technology upgradation reimbursements.</p>
      </div>
    </div>
    <form class="zed-card" (ngSubmit)="search()">
      <div class="filter-bar">
        <div class="filter">
          <label class="form-label" for="incState">State</label>
          <select id="incState" name="state" class="form-select" [(ngModel)]="filter.state">
            <option value="">Show All</option>
            @for (s of states; track s.id) { <option [value]="s.id">{{ s.name }}</option> }
          </select>
        </div>
        <div class="filter">
          <label class="form-label" for="incCert">Certification Level</label>
          <select id="incCert" name="certification" class="form-select" [(ngModel)]="filter.certification">
            <option value="">Show All</option>
            <option value="Bronze">Bronze</option><option value="Silver">Silver</option><option value="Gold">Gold</option>
          </select>
        </div>
        <div class="filter">
          <label class="form-label" for="incSize">MSME Size</label>
          <select id="incSize" name="msmeSize" class="form-select" [(ngModel)]="filter.msmeSize">
            <option value="">Show All</option>
            <option value="Micro">Micro</option><option value="Small">Small</option><option value="Medium">Medium</option>
          </select>
        </div>
        <div class="filter">
          <label class="form-label" for="incGender">Gender</label>
          <select id="incGender" name="gender" class="form-select" [(ngModel)]="filter.gender">
            <option value="">Show All</option>
            <option value="male">Male</option><option value="female">Female</option><option value="Others">Others</option>
          </select>
        </div>
        <div class="filter"><button type="submit" class="btn btn-primary">Search</button></div>
      </div>
    </form>

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (rows().length) {
      <zed-list-search [(value)]="searchText" placeholder="Search submissions" inputId="inc-sub-search" [found]="view.total()" />
      <div class="table-responsive">
        <table class="table table-bordered table-zed">
          <thead>
            <tr>
              <th class="text-center" style="width: 60px">S.No</th>
              <th>Unit Name<br />State Name</th>
              <th class="text-center">Udyam No.<br />Application Id</th>
              <th>Service Name<br />Incentive Name</th>
              <th class="text-center">Certification<br />Enterprise Type<br />Gender</th>
              <th class="text-center">Disbursed Date<br />Disbursed Amount</th>
            </tr>
          </thead>
          <tbody>
            @for (r of view.page(); track $index) {
              <tr>
                <td class="text-center">{{ view.serial($index) }}</td>
                <td class="cell-lines"><strong>{{ r['PUnitName'] }}</strong><span>{{ r['PStateName'] }}</span></td>
                <td class="cell-lines text-center"><span>{{ r['UdyamNo'] }}</span><span class="muted">{{ r['ApplicationId'] }}</span></td>
                <td class="cell-lines service"><span>{{ r['ServiceName'] }}</span><span class="muted">{{ r['IncentiveName'] }}</span></td>
                <td class="cell-lines text-center"><span>{{ r['Certification'] }}</span><span>{{ r['EnterpriseTypee'] }}</span><span>{{ r['Gender'] }}</span></td>
                <td class="cell-lines text-center"><span>{{ date(r['DisbursedDate'] ?? r['ApprovedDate']) }}</span><strong>{{ r['DisbursedAmount'] }}</strong></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <zed-pager [pager]="view" />
    } @else if (!loading()) {
      <div class="label-highlight4">
        <div class="no-incentive-block">
          <img src="Images/svgicons/no-incentive.svg" alt="" />
          <p>No Ministry of MSME Incentives available currently, please check again as Government may introduce incentives soon.</p>
        </div>
      </div>
    }
    @if (loading()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    table tbody tr td { font-size: 14px; }
    /* Several values in one cell, one per line. */
    .cell-lines > * { display: block; }
    .cell-lines > * + * { margin-top: 4px; }
    .service { min-width: 260px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class IncentiveSubmissionsPage {
  private readonly api = inject(IncentivesApi);
  protected readonly states = STATES;
  protected readonly filter: IncentiveFilter = { state: '', certification: '', msmeSize: '', gender: '' };
  protected readonly rows = signal<Row[]>([]);
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  /** The search box above the list (any column). */
  protected readonly searchText = signal('');
  protected readonly view = new PagedView(() => searchRows(this.rows(), this.searchText()));
  protected readonly loading = signal(false);
  protected readonly error = signal('');

  constructor() {
    void this.search();
  }

  protected async search(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.rows.set(await firstValueFrom(this.api.submissions({ ...this.filter })));
    } catch (err) {
      this.rows.set([]);
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** Dates come as ISO date-times; show dd-mm-yyyy. */
  protected date(value: unknown): string {
    const s = value === null || value === undefined ? '' : String(value);
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
  }
}
