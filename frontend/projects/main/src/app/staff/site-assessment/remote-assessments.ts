import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ClientConfigService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { Row, SITE_SYSTEM, SiteAssessmentApi, milestoneReviewLink } from './site-assessment.api';
import { ListSearchComponent, PagedView, PagerComponent, searchRows } from '../pager';
import { PageHead } from '../../msme/shared/page-head';
import { ListCount, ListCounts } from '../list-counts';

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
  imports: [RouterLink, PagerComponent, ListSearchComponent, PageHead, ListCounts],
  host: { class: 'list-v2 d-block' },
  template: `
    <!-- 2026-11-14 (approved frame A): the shared header, the counts, the list in one card. -->
    <zed-page-head [crumbs]="[{ label: 'Home', link: '/staff' }, { label: title }]" [title]="title">
      <button type="button" class="btn btn-outline-secondary btn-sm refresh-link" (click)="load()"><img src="Images/svgicons/refresh.svg" alt="" /> Refresh</button>
    </zed-page-head>
    <zed-list-counts [counts]="consultancy ? milestoneCounts() : counts()" />

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }

    <div class="list-card">
    <div class="list-card-head">
      <b>Units</b>
      <zed-list-search [(value)]="search" placeholder="Search units" inputId="remote-search" [found]="view.total()" />
    </div>
    @if (consultancy) {
      <div class="table-responsive">
        <table class="table table-zed">
          <thead>
            <tr>
              <th>Unit</th>
              <th>Desired level</th>
              <th>Unit SPOC</th>
              <th>Consultant organisation</th>
              <th>Site visit dates</th>
              <th>Status</th>
              <th style="width: 150px"><span class="visually-hidden">Action(s)</span></th>
            </tr>
          </thead>
          <tbody>
            @for (s of view.page(); track s['ZedId'] + '|' + s['Certification']) {
              <tr>
                <td class="unit unit-cell">
                  <b>{{ s['EnterpriseName'] }}</b>
                  <small><span class="dash-text-clr">{{ s['ZedId'] }}</span> · {{ s['UnitAddress'] }}</small>
                </td>
                <td><span [class]="'lv-tag lv-' + lc(s['Certification'])">{{ s['Certification'] }}</span></td>
                <td><b>{{ s['UnitSpocName'] }}</b><span class="sub">{{ s['UnitSpocMobileNo'] }}</span><span class="sub">{{ s['UnitSpocEmailId'] }}</span></td>
                <td>{{ s['AgencyName'] }}<span class="sub">{{ s['CertificationBodyUserId'] }}</span></td>
                @if (milestone === 1) {
                  <td>BDS: {{ s['BdsToDate'] }}<span class="sub">HAP: {{ s['HapToDate'] }}</span></td>
                } @else {
                  <td>{{ s['BdsToDate'] }}</td>
                }
                <td><span [class]="'chip ' + milestoneState(s).tone">{{ milestoneState(s).label }}</span></td>
                <td>
                  <div class="row-actions">
                    <a class="btn btn-outline-primary profile" [routerLink]="['/staff/msme-profile', s['ZedId']]">View Profile</a>
                    <a class="btn btn-outline-primary details" [routerLink]="reviewLink(s)">VIEW DETAILS</a>
                  </div>
                </td>
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
    } @else {
      <div class="table-responsive">
        <table class="table table-zed">
          <thead>
            <tr>
              <th>Unit</th>
              <th>Level</th>
              <th>Unit SPOC</th>
              <th>Agency</th>
              <th>Mode</th>
              <th>{{ surveillance ? 'Surveillance date' : 'Assessment date' }}</th>
              <th>Status</th>
              <th style="width: 150px"><span class="visually-hidden">Action(s)</span></th>
            </tr>
          </thead>
          <tbody>
            @for (s of view.page(); track s['ZedId'] + '|' + s['Certification']) {
              <tr>
                <td class="unit unit-cell">
                  <b>{{ surveillance ? s['PUnitName'] : s['EnterpriseName'] }}</b>
                  <small><span class="dash-text-clr">{{ s['ZedId'] }}</span> · {{ s['UnitAddress'] }}</small>
                </td>
                <td><span [class]="'lv-tag lv-' + lc(s['Certification'])">{{ s['Certification'] }}</span></td>
                <td><b>{{ s['UnitSpocName'] }}</b><span class="sub">{{ s['UnitSpocMobileNo'] }}</span><span class="sub">{{ s['UnitSpocEmailId'] }}</span></td>
                <td>{{ s['AgencyName'] }}<span class="sub">{{ s['CertificationBodyUserId'] }}</span></td>
                <td><span class="zed-chip">{{ mode(s) }}</span></td>
                <td>{{ s['AssessmentDate'] }}</td>
                <td><span [class]="'chip ' + stateOf(s).tone">{{ stateOf(s).label }}</span></td>
                <td>
                  <div class="row-actions">
                    @if (surveillance && s['OnsiteVisit']) {
                      <!-- 2026-11-14 (Onsite surveillance): assessed in the assessor app; reviewed here after its closing meeting. -->
                      @if (+(s['CertificationStatus'] ?? 0) === 13) {
                        <a class="btn btn-primary assess" [routerLink]="remoteLink(s)">REVIEW &amp; SUBMIT</a>
                      } @else if (+(s['CertificationStatus'] ?? 0) === 14) {
                        <a class="btn btn-primary assess review-nc" [routerLink]="remoteLink(s)">REVIEW NC</a>
                      }
                    } @else if (surveillance) {
                      <!-- That portal's list: ASSESS only on Onsite rows (held on the meeting link); no VIEW DETAILS. -->
                      @if (s['ModeOfAssessment'] === 'Onsite Assessment') {
                        <a class="btn btn-primary assess" [routerLink]="remoteLink(s)">ASSESS</a>
                      }
                    } @else if (s['ModeOfAssessment'] === 'Onsite Assessment') {
                      <a class="btn btn-outline-primary" [routerLink]="['/staff/assessment/sa-details', s['ZedId'], s['Certification']]">VIEW DETAILS</a>
                      <!-- V4: after the SA app's closing meeting the lead assessor reviews and final-submits here (old SaDetails page). -->
                      @if (+(s['CertificationStatus'] ?? 0) === 13) {
                        <a class="btn btn-primary assess" [routerLink]="remoteLink(s)">REVIEW &amp; SUBMIT</a>
                      } @else if (+(s['CertificationStatus'] ?? 0) === 14) {
                        <!-- An NC round: the MSME's answers are reviewed and final-submitted on the same page (NC tab). -->
                        <a class="btn btn-primary assess review-nc" [routerLink]="remoteLink(s)">REVIEW NC</a>
                      }
                    } @else if (s['ModeOfAssessment'] === 'Remote Assessment') {
                      <a class="btn btn-primary assess" [routerLink]="remoteLink(s)">ASSESS</a>
                    }
                  </div>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="8" style="padding: 0px"><div class="no-data">No Data</div></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <zed-pager [pager]="view" />
    }
    </div>

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
    .unit { min-width: 220px; }
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
  protected readonly title = this.consultancy ? `Milestone ${this.milestone}` : this.surveillance ? 'Surveillance assessments (site)' : 'Remote and onsite assessments';

  protected lc(v: unknown): string {
    return String(v ?? '').toLowerCase();
  }

  /** Where a site assessment stands for the assessor (the chip of its row). */
  protected stateOf(s: Row): { label: string; tone: string } {
    const st = +(s['CertificationStatus'] ?? 0);
    if (st === 13) return { label: 'Meetings done: review', tone: 'is-warn' };
    if (st === 14) return { label: 'NC answered: review', tone: 'is-bad' };
    return { label: this.mode(s) === 'Remote' ? 'To assess' : 'Scheduled', tone: 'is-info' };
  }

  /** Consultancy: where a milestone stands for the consultant (review after the meetings, the site visit to come, in progress). */
  protected milestoneState(s: Row): { label: string; tone: string } {
    const st = +(s['CertificationStatus'] ?? 0);
    if (st === 13 || st === 14) return { label: 'To review', tone: 'is-warn' };
    const visit = Date.parse(String(s['BdsToDate'] ?? ''));
    if (!isNaN(visit) && visit >= new Date().setHours(0, 0, 0, 0)) return { label: 'Site visit due', tone: 'is-info' };
    return { label: 'In progress', tone: '' };
  }

  protected readonly milestoneCounts = computed<ListCount[]>(() => {
    const rows = this.rows();
    const by = (label: string) => rows.filter((r) => this.milestoneState(r).label === label).length;
    return [
      { label: 'Allotted to me', value: rows.length },
      { label: 'Site visit due', value: by('Site visit due') },
      { label: 'To review', value: by('To review'), tone: 'warn' },
      { label: 'In progress', value: by('In progress') },
    ];
  });

  protected readonly counts = computed<ListCount[]>(() => {
    const rows = this.rows();
    const st = (r: Row) => +(r['CertificationStatus'] ?? 0);
    return [
      { label: 'Allotted to me', value: rows.length },
      { label: 'Remote', value: rows.filter((r) => this.mode(r) === 'Remote').length },
      { label: 'Onsite', value: rows.filter((r) => this.mode(r) === 'Onsite').length },
      { label: 'To review', value: rows.filter((r) => st(r) === 13 || st(r) === 14).length, tone: 'warn' },
    ];
  });
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
    if (this.surveillance) return s['OnsiteVisit'] ? 'Onsite' : s['ModeOfAssessment'] ? 'Remote' : 'Desktop';
    return s['ModeOfAssessment'] === 'Remote Assessment' ? 'Remote' : s['ModeOfAssessment'] === 'Onsite Assessment' ? 'Onsite' : 'Desktop';
  }

  protected remoteLink(s: Row): string[] {
    return ['/staff/remote', String(s['ZedId'] ?? ''), String(s['Certification'] ?? '')];
  }

  protected reviewLink(s: Row): string {
    return milestoneReviewLink(String(s['ZedId'] ?? ''), String(s['Certification'] ?? ''), this.milestone);
  }
}
