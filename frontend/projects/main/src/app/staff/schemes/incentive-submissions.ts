import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { IncentiveFilter, IncentivesApi, Row, STATES } from './incentives.api';
import { PagedView, PagerComponent, searchRows } from '../pager';
import { DashboardPortalSwitchComponent } from '../dashboard-portal-switch';
import { PageHead } from '../../msme/shared/page-head';
import { ListCounts } from '../list-counts';
import { staffCrumbs } from '../staff-crumbs';

/**
 * "API Incentives Submitted" for the super admin. Port of Views/Incentive/Submissions.cshtml
 * (SP_GET_API_INCENTIVES, which also lists technology upgradation reimbursements from ZED_CONSULTANT).
 * <p>2026-11-17 (approved staff redesign, "same look"): the page head, the count, the filters in one bar, the list in one card
 * with the light header.</p>
 */
@Component({
  selector: 'zed-staff-incentive-submissions',
  imports: [FormsModule, PagerComponent, DashboardPortalSwitchComponent, PageHead, ListCounts],
  host: { class: 'list-v2 d-block' },
  template: `
    <!-- One Dashboard Admin (2026-11-07): the portal of this screen. -->
    <zed-dashboard-portal-switch [screens]="['incentive-submissions']" />
    <zed-page-head [crumbs]="crumbs" title="API Incentives Submitted"
                   subtitle="Incentives disbursed to the units, as reported by the ministries' APIs and technology upgradation reimbursements.">
      <button type="button" class="btn btn-ph" (click)="search()">Refresh</button>
    </zed-page-head>
    <zed-list-counts [counts]="[{ label: 'Submissions', value: rows().length }]" class="is-counts" />
    <form class="zed-card is-filters" (ngSubmit)="search()">
      <select id="incState" name="state" class="form-select" aria-label="State" [(ngModel)]="filter.state">
        <option value="">All states</option>
        @for (s of states; track s.id) { <option [value]="s.id">{{ s.name }}</option> }
      </select>
      <select id="incCert" name="certification" class="form-select" aria-label="Certification level" [(ngModel)]="filter.certification">
        <option value="">All levels</option>
        <option value="Bronze">Bronze</option><option value="Silver">Silver</option><option value="Gold">Gold</option>
      </select>
      <select id="incSize" name="msmeSize" class="form-select" aria-label="MSME size" [(ngModel)]="filter.msmeSize">
        <option value="">All sizes</option>
        <option value="Micro">Micro</option><option value="Small">Small</option><option value="Medium">Medium</option>
      </select>
      <select id="incGender" name="gender" class="form-select" aria-label="Gender" [(ngModel)]="filter.gender">
        <option value="">All genders</option>
        <option value="male">Male</option><option value="female">Female</option><option value="Others">Others</option>
      </select>
      <button type="submit" class="btn btn-primary">Search</button>
    </form>

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (rows().length) {
      <div class="list-card">
      <div class="list-card-head">
        <b>Submissions</b>
        <input type="search" id="inc-sub-search" class="form-control is-q" maxlength="50" placeholder="Search submissions" aria-label="Search submissions"
               [ngModel]="searchText()" (ngModelChange)="searchText.set($event)" />
      </div>
      <div class="table-responsive">
        <table class="table table-zed">
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
      </div>
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
    .is-counts { max-width: 240px; }
    .is-filters { display: grid; grid-template-columns: repeat(4, minmax(130px, 1fr)) auto; gap: 10px; padding: 12px 14px; margin-bottom: 14px; }
    .is-q { max-width: 320px; }
    @media (max-width: 767.98px) { .is-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    /* Several values in one cell, one per line. */
    .cell-lines > * { display: block; }
    .cell-lines > * + * { margin-top: 4px; }
    .service { min-width: 260px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class IncentiveSubmissionsPage {
  private readonly api = inject(IncentivesApi);
  protected readonly crumbs = staffCrumbs({ label: 'Incentive Submissions' });
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
