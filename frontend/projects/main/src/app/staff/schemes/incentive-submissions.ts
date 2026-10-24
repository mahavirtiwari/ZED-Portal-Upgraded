import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { IncentiveFilter, IncentivesApi, Row, STATES } from './incentives.api';
import { PagedView, PagerComponent } from '../pager';

/**
 * "API Incentives Submitted" for the super admin. Port of Views/Incentive/Submissions.cshtml
 * (SP_GET_API_INCENTIVES, which also lists technology upgradation reimbursements from ZED_CONSULTANT).
 */
@Component({
  selector: 'zed-staff-incentive-submissions',
  imports: [FormsModule, PagerComponent],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="incentive-page">
        <div class="panel panel-default panel-grey mt-2">
          <div class="panel-body p-3">
            <form class="row g-3 align-items-end" (ngSubmit)="search()">
              <div class="col-sm-3">
                <label for="incState"><strong>State</strong></label>
                <select id="incState" name="state" class="form-select" [(ngModel)]="filter.state">
                  <option value="">Show All</option>
                  @for (s of states; track s.id) { <option [value]="s.id">{{ s.name }}</option> }
                </select>
              </div>
              <div class="col-sm-3">
                <label for="incCert"><strong>Certification Level</strong></label>
                <select id="incCert" name="certification" class="form-select" [(ngModel)]="filter.certification">
                  <option value="">Show All</option>
                  <option value="Bronze">Bronze</option><option value="Silver">Silver</option><option value="Gold">Gold</option>
                </select>
              </div>
              <div class="col-sm-3">
                <label for="incSize"><strong>MSME Size</strong></label>
                <select id="incSize" name="msmeSize" class="form-select" [(ngModel)]="filter.msmeSize">
                  <option value="">Show All</option>
                  <option value="Micro">Micro</option><option value="Small">Small</option><option value="Medium">Medium</option>
                </select>
              </div>
              <div class="col-sm-3">
                <label for="incGender"><strong>Gender</strong></label>
                <select id="incGender" name="gender" class="form-select" [(ngModel)]="filter.gender">
                  <option value="">Show All</option>
                  <option value="male">Male</option><option value="female">Female</option><option value="Others">Others</option>
                </select>
              </div>
              <div class="col-sm-3"><button type="submit" class="btn btn-primary">Search</button></div>
            </form>
          </div>
        </div>

        <h4 class="registration-title m-2">API Incentives Submitted</h4>
        @if (error()) {
          <div class="alert alert-danger" role="alert">{{ error() }}</div>
        }
        @if (rows().length) {
          <div class="table-responsive">
            <table class="table table-bordered table-zed" style="table-layout: fixed">
              <thead>
                <tr>
                  <th style="width: 4%">S.No</th>
                  <th>Unit Name<br />State Name</th>
                  <th>Udyam No.<br />Application Id</th>
                  <th style="width: 40%">Service Name<br />Incentive Name</th>
                  <th>Certification<br />Enterprise Type<br />Gender</th>
                  <th>Disbursed Date<br />Disbursed Amount</th>
                </tr>
              </thead>
              <tbody>
                @for (r of view.page(); track $index) {
                  <tr>
                    <td>{{ view.serial($index) }}</td>
                    <td>{{ r['PUnitName'] }}<br />{{ r['PStateName'] }}</td>
                    <td>{{ r['UdyamNo'] }}<br />{{ r['ApplicationId'] }}</td>
                    <td>{{ r['ServiceName'] }}<br />{{ r['IncentiveName'] }}</td>
                    <td>{{ r['Certification'] }}<br />{{ r['EnterpriseTypee'] }}<br />{{ r['Gender'] }}</td>
                    <td>{{ date(r['DisbursedDate'] ?? r['ApprovedDate']) }}<br />{{ r['DisbursedAmount'] }}</td>
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
      </div>
    </div>
    @if (loading()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    table tbody tr td { font-size: 14px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class IncentiveSubmissionsPage {
  private readonly api = inject(IncentivesApi);
  protected readonly states = STATES;
  protected readonly filter: IncentiveFilter = { state: '', certification: '', msmeSize: '', gender: '' };
  protected readonly rows = signal<Row[]>([]);
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly view = new PagedView(() => this.rows());
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
