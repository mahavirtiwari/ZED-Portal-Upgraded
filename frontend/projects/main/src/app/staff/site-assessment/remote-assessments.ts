import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ClientConfigService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { Row, SITE_SYSTEM, SiteAssessmentApi, milestoneReviewLink } from './site-assessment.api';
import { ListSearchComponent, PagedView, PagerComponent, searchRows } from '../pager';

/**
 * "Remote/Onsite Assessment" list of an assessor with the site verification sub-role. Port of
 * Views/Assessment/RemoteAssessments.cshtml (Assessment/GetList allotmentType RA). Its Accept/Reject
 * pop-ups had no button opening them and are not ported. VIEW DETAILS opens the SA details page
 * (staff/assessment/sa-details/...); ASSESS opens the remote assessment screen (staff/remote/...).
 * <p>
 * Surveillance build: units allotted as "Onsite Assessment" are held on the agency's meeting link, so their ASSESS
 * opens the remote screen (mode shown as Remote, "Surveillance Date"), as on the old surveillance list.
 * Consultancy build: "Milestone n" lists (route parameter `milestone`, 1-3; old RemoteAssessments/{n}) of the
 * consultant's units with the BDS/HAP dates; View Profile opens the unit's profile and VIEW DETAILS the milestone review page.
 * </p>
 */
@Component({
  selector: 'zed-staff-remote-assessments',
  imports: [RouterLink, PagerComponent, ListSearchComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ consultancy ? 'Milestone ' + milestone : 'Remote/Onsite Assessment' }}</h3>
        <p class="page-sub">{{ subtitle }}</p>
      </div>
      <div class="page-actions">
        <button type="button" class="refresh-link btn btn-default" (click)="load()">
          <img src="Images/svgicons/refresh.svg" alt="" />
          <span>REFRESH</span>
        </button>
      </div>
    </div>

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }

    <zed-list-search [(value)]="search" placeholder="Search units" inputId="remote-search" [found]="view.total()" />
    @if (consultancy) {
      <div class="table-responsive">
        <table class="table table-zed table-bordered">
          <thead>
            <tr>
              <th class="text-center">Desired Certification</th>
              <th>Unit Details</th>
              <th>Unit SPOC Details</th>
              <th>Consultant Organisation</th>
              <th class="text-center">Site Visit dates</th>
              <th class="text-center" style="width: 220px">Action(s)</th>
            </tr>
          </thead>
          <tbody>
            @for (s of view.page(); track s['ZedId'] + '|' + s['Certification']) {
              <tr>
                <td class="text-center"><strong>{{ s['Certification'] }}</strong></td>
                <td class="unit">
                  <strong class="dash-text-clr">{{ s['ZedId'] }}</strong>
                  <div><strong>{{ s['EnterpriseName'] }}</strong></div>
                  <div class="muted">{{ s['UnitAddress'] }}</div>
                </td>
                <td><strong>{{ s['UnitSpocName'] }}</strong><div>{{ s['UnitSpocMobileNo'] }}</div><div class="muted">{{ s['UnitSpocEmailId'] }}</div></td>
                <td><strong>{{ s['AgencyName'] }}</strong><div class="muted">{{ s['CertificationBodyUserId'] }}</div></td>
                @if (milestone === 1) {
                  <td class="text-center"><div>BDS: {{ s['BdsToDate'] }}</div><div>HAP: {{ s['HapToDate'] }}</div></td>
                } @else {
                  <td class="text-center">{{ s['BdsToDate'] }}</td>
                }
                <td class="text-center">
                  <div class="row-actions justify-content-center">
                    <a class="btn btn-outline-primary profile" [routerLink]="['/staff/msme-profile', s['ZedId']]">View Profile</a>
                    <a class="btn btn-outline-primary details" [routerLink]="reviewLink(s)">VIEW DETAILS</a>
                  </div>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" style="padding: 0px"><div class="no-data">No Data</div></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <zed-pager [pager]="view" />
    } @else {
      <div class="table-responsive">
        <table class="table table-zed table-bordered">
          <thead>
            <tr>
              <th class="text-center" style="width: 150px">Action(s)</th>
              <th class="text-center">Certification Level</th>
              <th>Unit Details</th>
              <th>Unit SPOC Details</th>
              <th>Agency Details</th>
              <th class="text-center">Mode of Assessment</th>
              <th class="text-center">{{ surveillance ? 'Surveillance Date' : 'Assessment Date' }}</th>
            </tr>
          </thead>
          <tbody>
            @for (s of view.page(); track s['ZedId'] + '|' + s['Certification']) {
              <tr>
                <td class="text-center">
                  <div class="row-actions justify-content-center">
                    @if (surveillance) {
                      <!-- That portal's list: ASSESS only on Onsite rows (held on the meeting link); no VIEW DETAILS. -->
                      @if (s['ModeOfAssessment'] === 'Onsite Assessment') {
                        <a class="btn btn-primary assess" [routerLink]="remoteLink(s)">ASSESS</a>
                      }
                    } @else if (s['ModeOfAssessment'] === 'Onsite Assessment') {
                      <a class="btn btn-outline-primary" [routerLink]="['/staff/assessment/sa-details', s['ZedId'], s['Certification']]">VIEW DETAILS</a>
                      <!-- V4: after the SA app's closing meeting the lead assessor reviews and final-submits here (old SaDetails page). -->
                      @if (+(s['CertificationStatus'] ?? 0) === 13) {
                        <a class="btn btn-primary assess" [routerLink]="remoteLink(s)">REVIEW &amp; SUBMIT</a>
                      }
                    } @else if (s['ModeOfAssessment'] === 'Remote Assessment') {
                      <a class="btn btn-primary assess" [routerLink]="remoteLink(s)">ASSESS</a>
                    }
                  </div>
                </td>
                <td class="text-center"><strong>{{ s['Certification'] }}</strong></td>
                <td class="unit">
                  <strong class="dash-text-clr">{{ s['ZedId'] }}</strong>
                  <div><strong>{{ surveillance ? s['PUnitName'] : s['EnterpriseName'] }}</strong></div>
                  <div class="muted">{{ s['UnitAddress'] }}</div>
                </td>
                <td><strong>{{ s['UnitSpocName'] }}</strong><div>{{ s['UnitSpocMobileNo'] }}</div><div class="muted">{{ s['UnitSpocEmailId'] }}</div></td>
                <td><strong>{{ s['AgencyName'] }}</strong><div class="muted">{{ s['CertificationBodyUserId'] }}</div></td>
                <td class="text-center"><span class="zed-chip">{{ mode(s) }}</span></td>
                <td class="text-center">{{ s['AssessmentDate'] }}</td>
              </tr>
            } @empty {
              <tr>
                <td colspan="7" style="padding: 0px"><div class="no-data">No Data</div></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <zed-pager [pager]="view" />
    }

    @if (loading()) {
      <div class="loadingdiv" role="status" aria-live="polite">
        <div class="text-center text-white">
          <div class="spinner-border text-light"></div>
          <div><small>Please wait ...</small></div>
        </div>
      </div>
    }
  `,
  styles: `
    .unit { min-width: 200px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class RemoteAssessmentsPage {
  private readonly api = inject(SiteAssessmentApi);
  private readonly legacyUrl = signal('');
  private readonly system = inject(SITE_SYSTEM);

  protected readonly consultancy = this.system === 'consultancy';
  protected readonly surveillance = this.system === 'surveillance';
  /** Consultancy: milestone of the list (1-3, route parameter; 1 when missing or invalid). */
  protected readonly milestone = RemoteAssessmentsPage.milestoneOf(inject(ActivatedRoute).snapshot.paramMap.get('milestone'));
  protected readonly subtitle = this.consultancy
    ? `Units allotted to you for milestone ${this.milestone}, with the site visit dates.`
    : this.surveillance ? 'Surveillance assessments allotted to you; assess them on the meeting link.'
    : 'Site assessments allotted to you: assess the remote ones here, open the onsite ones for their details.';

  protected readonly rows = signal<Row[]>([]);
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  /** The search box above the list (any column). */
  protected readonly search = signal('');
  protected readonly view = new PagedView(() => searchRows(this.rows(), this.search()));
  protected readonly loading = signal(false);
  protected readonly error = signal('');

  constructor() {
    inject(ClientConfigService).get().then((c) => this.legacyUrl.set(c.legacyPortalUrl)).catch(() => undefined);
    void this.load();
  }

  static milestoneOf(value: string | null): number {
    const n = Number(value);
    return n === 2 || n === 3 ? n : 1;
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const call = this.consultancy ? this.api.milestone(this.milestone) : this.api.remoteAssessments();
      this.rows.set((await firstValueFrom(call)) ?? []);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected mode(s: Row): string {
    if (this.surveillance) return s['ModeOfAssessment'] ? 'Remote' : 'Desktop';
    return s['ModeOfAssessment'] === 'Remote Assessment' ? 'Remote' : s['ModeOfAssessment'] === 'Onsite Assessment' ? 'Onsite' : 'Desktop';
  }

  protected remoteLink(s: Row): string[] {
    return ['/staff/remote', String(s['ZedId'] ?? ''), String(s['Certification'] ?? '')];
  }

  protected reviewLink(s: Row): string {
    return milestoneReviewLink(String(s['ZedId'] ?? ''), String(s['Certification'] ?? ''), this.milestone);
  }
}
