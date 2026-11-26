import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { TextPipe, t } from '../../content/page-text';
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
 * <p>2026-11-19 ("All page wording"): every wording is the Admin's (Texts → Page wording, staff.incentiveSubmissions.*) or the standard one here.</p>
 */
@Component({
  selector: 'zed-staff-incentive-submissions',
  imports: [FormsModule, PagerComponent, DashboardPortalSwitchComponent, PageHead, ListCounts, TextPipe],
  host: { class: 'list-v2 d-block' },
  template: `
    <!-- One Dashboard Admin (2026-11-07): the portal of this screen. -->
    <zed-dashboard-portal-switch [screens]="['incentive-submissions']" />
    <zed-page-head [crumbs]="crumbs()" [title]="'API Incentives Submitted' | t: 'staff.incentiveSubmissions.title'" [subtitle]="subtitle()">
      <button type="button" class="btn btn-ph" (click)="search()">{{ 'Refresh' | t: 'staff.incentiveSubmissions.refreshButton' }}</button>
    </zed-page-head>
    <zed-list-counts [counts]="counts()" class="is-counts" />
    <form class="zed-card is-filters" (ngSubmit)="search()">
      <select id="incState" name="state" class="form-select" [attr.aria-label]="'State' | t: 'staff.incentiveSubmissions.filter.stateAria'" [(ngModel)]="filter.state">
        <option value="">{{ 'All states' | t: 'staff.incentiveSubmissions.filter.allStates' }}</option>
        @for (s of states; track s.id) { <option [value]="s.id">{{ s.name }}</option> }
      </select>
      <select id="incCert" name="certification" class="form-select" [attr.aria-label]="'Certification level' | t: 'staff.incentiveSubmissions.filter.levelAria'" [(ngModel)]="filter.certification">
        <option value="">{{ 'All levels' | t: 'staff.incentiveSubmissions.filter.allLevels' }}</option>
        <option value="Bronze">Bronze</option><option value="Silver">Silver</option><option value="Gold">Gold</option>
      </select>
      <select id="incSize" name="msmeSize" class="form-select" [attr.aria-label]="'MSME size' | t: 'staff.incentiveSubmissions.filter.sizeAria'" [(ngModel)]="filter.msmeSize">
        <option value="">{{ 'All sizes' | t: 'staff.incentiveSubmissions.filter.allSizes' }}</option>
        <option value="Micro">{{ 'Micro' | t: 'staff.incentiveSubmissions.size.micro' }}</option><option value="Small">{{ 'Small' | t: 'staff.incentiveSubmissions.size.small' }}</option><option value="Medium">{{ 'Medium' | t: 'staff.incentiveSubmissions.size.medium' }}</option>
      </select>
      <select id="incGender" name="gender" class="form-select" [attr.aria-label]="'Gender' | t: 'staff.incentiveSubmissions.filter.genderAria'" [(ngModel)]="filter.gender">
        <option value="">{{ 'All genders' | t: 'staff.incentiveSubmissions.filter.allGenders' }}</option>
        <option value="male">{{ 'Male' | t: 'staff.incentiveSubmissions.gender.male' }}</option><option value="female">{{ 'Female' | t: 'staff.incentiveSubmissions.gender.female' }}</option><option value="Others">{{ 'Others' | t: 'staff.incentiveSubmissions.gender.others' }}</option>
      </select>
      <button type="submit" class="btn btn-primary">{{ 'Search' | t: 'staff.incentiveSubmissions.searchButton' }}</button>
    </form>

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (rows().length) {
      <div class="list-card">
      <div class="list-card-head">
        <b>{{ 'Submissions' | t: 'staff.incentiveSubmissions.list.title' }}</b>
        <input type="search" id="inc-sub-search" class="form-control is-q" maxlength="50" [placeholder]="'Search submissions' | t: 'staff.incentiveSubmissions.search.placeholder'" [attr.aria-label]="'Search submissions' | t: 'staff.incentiveSubmissions.search.placeholder'"
               [ngModel]="searchText()" (ngModelChange)="searchText.set($event)" />
      </div>
      <div class="table-responsive">
        <table class="table table-zed">
          <thead>
            <tr>
              <th class="text-center" style="width: 60px">{{ 'S.No' | t: 'staff.incentiveSubmissions.column.serial' }}</th>
              <th>{{ 'Unit Name' | t: 'staff.incentiveSubmissions.column.unit' }}<br />{{ 'State Name' | t: 'staff.incentiveSubmissions.column.state' }}</th>
              <th class="text-center">{{ 'Udyam No.' | t: 'staff.incentiveSubmissions.column.udyam' }}<br />{{ 'Application Id' | t: 'staff.incentiveSubmissions.column.applicationId' }}</th>
              <th>{{ 'Service Name' | t: 'staff.incentiveSubmissions.column.service' }}<br />{{ 'Incentive Name' | t: 'staff.incentiveSubmissions.column.incentive' }}</th>
              <th class="text-center">{{ 'Certification' | t: 'staff.incentiveSubmissions.column.certification' }}<br />{{ 'Enterprise Type' | t: 'staff.incentiveSubmissions.column.enterpriseType' }}<br />{{ 'Gender' | t: 'staff.incentiveSubmissions.column.gender' }}</th>
              <th class="text-center">{{ 'Disbursed Date' | t: 'staff.incentiveSubmissions.column.disbursedDate' }}<br />{{ 'Disbursed Amount' | t: 'staff.incentiveSubmissions.column.disbursedAmount' }}</th>
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
          <p>{{ 'No incentive has been reported for the units yet.' | t: 'staff.incentiveSubmissions.emptyStaff' }}</p>
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
  protected readonly crumbs = computed(() => staffCrumbs({ label: t('staff.incentiveSubmissions.crumb', 'Incentive Submissions') }));
  protected readonly subtitle = computed(() =>
    t('staff.incentiveSubmissions.sub', 'Incentives disbursed to the units, as reported by the ministries\' APIs and technology upgradation reimbursements.'));
  protected readonly counts = computed(() => [{ label: t('staff.incentiveSubmissions.count.submissions', 'Submissions'), value: this.rows().length }]);
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
