import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { StaffRole } from '../staff-menu';
import { ASSESSMENT_SYSTEM, STATES, milestoneReportUrl, num, text, useLegacyPortal } from './assessment-shared';
import { PagerComponent, ServerPager } from '../pager';
import { AssessmentApi, ResultsFilter, Row } from './assessment.api';
import { withApiBase } from '../../api-base';
import { levelCodes, levelName } from '../../msme/shared/levels';

/** Certificates and reports for staff (authorised downloads, same visibility as the DA review page). */
const DOCUMENTS_API = withApiBase('/api/staff/certification-documents');

/**
 * Completed and rejected certifications of the master admin, the agency or the assessor. Port of
 * Views/Assessment/Completed.cshtml and Rejected.cshtml (Assessment/GetCompletedList, paged on the
 * server). Certificates and reports download from this portal; profiles and site-assessment pages
 * open on the current portal.
 * <p>Consultancy ("Consultancy Completed"; no rejected list): one row per completed milestone, with the milestone
 * reports and "Recommended Technologies" after milestone 3. Surveillance ("Completed / Rejected Surveillance"):
 * Surveillance No; no phase, due-date, duplicates or pledge columns; Completed has a Gender filter and one search box that
 * searches any column as you type (on the server), Rejected only the Certification Level filter; the agency's "Assessment
 * Details" opens SaDetails from status 9.</p>
 */
@Component({
  selector: 'zed-staff-assessment-results',
  imports: [FormsModule, RouterLink, PagerComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ heading() }}</h3>
        <p class="page-sub">{{ subtitle() }}</p>
      </div>
    </div>

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }

    <div class="zed-card">
      <div class="filter-bar">
        @if (surveillance && !completed()) {
          <!-- Rejected Surveillance (that portal's Rejected.cshtml): only the level, Bronze/Silver/Gold. -->
          <div class="filter">
            <label class="form-label" for="resLevel">Certification Level</label>
            <select class="form-select" id="resLevel" [(ngModel)]="level" (ngModelChange)="search()">
              @for (l of levels(); track l) { <option [value]="l">{{ levelName(l) }}</option> }
            </select>
          </div>
        } @else {
          <div class="filter">
            <label class="form-label" for="resState">State</label>
            <select class="form-select" id="resState" [(ngModel)]="state" (ngModelChange)="search()">
              <option value="">Show All</option>
              @for (s of states; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }
            </select>
          </div>
          <div class="filter">
            <label class="form-label" for="resLevel">{{ consultancy ? 'Desired Certification' : 'Certification Level' }}</label>
            <select class="form-select" id="resLevel" [(ngModel)]="level" (ngModelChange)="search()">
              <option value="">Show All</option>
              @for (l of levels(); track l) { <option [value]="l">{{ levelName(l) }}</option> }
            </select>
          </div>
          <div class="filter">
            <label class="form-label" for="resSize">MSME Size</label>
            <select class="form-select" id="resSize" [(ngModel)]="size" (ngModelChange)="search()">
              <option value="">Show All</option>
              <option value="Micro">Micro</option>
              <option value="Small">Small</option>
              <option value="Medium">Medium</option>
            </select>
          </div>
          @if (surveillance) {
            <!-- Completed Surveillance's Gender filter (the procedure's @Gender), with the old option values. -->
            <div class="filter">
              <label class="form-label" for="resGender">Gender</label>
              <select class="form-select" id="resGender" [(ngModel)]="gender" (ngModelChange)="search()">
                <option value="">Show All</option>
                @for (g of genders; track g[0]) { <option [value]="g[0]">{{ g[1] }}</option> }
              </select>
            </div>
            <!-- Completed Surveillance: one search box that filters as you type (the old SearchText). -->
            <div class="filter wide">
              <label class="form-label" for="resSearch">Search</label>
              <input type="text" id="resSearch" class="form-control" placeholder="Search" maxlength="50" [(ngModel)]="searchText" (ngModelChange)="search()" />
            </div>
          } @else {
            <div class="filter">
              <label class="form-label" for="resSearchBy">Search By</label>
              <select class="form-select" id="resSearchBy" [(ngModel)]="searchBy">
                <option value="Zed Id">Zed Id</option>
                <option value="Udyam Number">Udyam Number</option>
                <option value="Unit Name">Unit Name</option>
              </select>
            </div>
            <div class="filter wide">
              <label class="form-label" for="resSearch">{{ searchBy }}</label>
              <div class="input-group">
                <input type="text" id="resSearch" class="form-control" maxlength="50" [(ngModel)]="searchText" (keyup.enter)="search()" />
                <button type="button" class="btn btn-primary" (click)="search()">Search</button>
              </div>
            </div>
          }
        }
      </div>
    </div>

    <div class="table-responsive">
      <table class="table table-bordered table-zed">
        <thead>
          @if (consultancy) {
            <tr>
              <th class="text-center" style="width: 60px">S.No</th>
              <th class="text-center">Desired Certification</th>
              <th>Unit Details</th>
              <th class="text-center">Milestone</th>
              @if (!isAgency()) { <th>CO Details</th> }
              @if (!isAssessor()) { <th>Consultant Details</th> }
              <th class="text-center">Date of Completion</th>
              <th class="text-center" style="width: 220px">Action(s)</th>
            </tr>
          } @else if (completed()) {
            <tr>
              <th class="text-center" style="width: 60px">S.No</th>
              @if (surveillance) {
                <th class="text-center">Certification Level<br />Surveillance No</th>
              } @else {
                <th class="text-center">Certification Level</th>
                <th class="text-center">Certification Phase</th>
              }
              <th>Unit Details</th>
              <th class="text-center">Mode of Assessment</th>
              @if (!isAgency()) { <th>Agency Details</th> }
              @if (!isAssessor()) { <th>Assessors Details</th> }
              @if (isAssessor()) {
                <th class="text-center">Assessment Allocated On</th>
                <th class="text-center">Assessment Completed On</th>
              } @else {
                <th class="text-center">Assessment Dates<br />Completion Date</th>
                @if (!surveillance) { <th class="text-center">Surveillance Due Date</th> }
              }
              @if (!surveillance) { <th class="text-center">Duplicates</th> }
              @if (!isAssessor()) { <th class="text-center" style="width: 220px">Action(s)</th> }
            </tr>
          } @else {
            <tr>
              <th class="text-center" style="width: 60px">S.No.</th>
              <th class="text-center">Certification Level</th>
              <th>Unit Details</th>
              @if (isMasterAdmin()) { <th>Agency Name</th> }
              <th class="text-center">Assessment Date<br />Rejected Date</th>
              <th class="text-center" style="width: 220px">Action(s)</th>
            </tr>
          }
        </thead>
        <tbody>
          @for (s of rows(); track $index) {
            @if (consultancy) {
              <!-- As the old Consultancy Completed list: a rejected milestone's row in the danger colour. -->
              <tr [class.btn-danger]="!!t(s, 'ReasonForRejection')">
                <td class="text-center">{{ t(s, 'RowNumber') }}</td>
                <td class="text-center"><strong>{{ t(s, 'Certification') }}</strong></td>
                <td class="unit"><strong class="dash-text-clr">{{ t(s, 'ZedId') }}</strong><div><strong>{{ t(s, 'PUnitName') }}</strong></div><div class="muted">{{ t(s, 'UnitAddress') }}</div></td>
                <td class="text-center"><span class="zed-chip">Milestone {{ t(s, 'NcCount') }}</span></td>
                @if (!isAgency()) {
                  <td><strong>{{ t(s, 'AgencyName') }}</strong><div class="muted">{{ t(s, 'CertificationBodyUserId') }}</div></td>
                }
                @if (!isAssessor()) {
                  <td class="stack">
                    <div><span class="muted">Lead Consultant</span><div><strong>{{ t(s, 'SiteAssessorName') }}</strong></div><div class="muted">{{ t(s, 'SiteAssessorId') }}</div></div>
                    @if (t(s, 'CoAssessorName') || t(s, 'CoAssessorId')) {
                      <div><span class="muted">CO Consultant</span><div><strong>{{ t(s, 'CoAssessorName') }}</strong></div><div class="muted">{{ t(s, 'CoAssessorId') }}</div></div>
                    }
                  </td>
                }
                <td class="stack text-center"><div>{{ t(s, 'DocVerifiAllot') }}</div><div>{{ t(s, 'CertificationStatusDate') }}</div></td>
                <td class="text-center">
                  <div class="row-actions justify-content-center">
                    @if (!isAssessor()) {
                      @if (legacy.profile(t(s, 'ZedId')); as href) {
                        <a [href]="href" class="btn btn-outline-primary">View Profile</a>
                      }
                      <a [routerLink]="[milestoneDetailsRoute, t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-outline-primary">View Details</a>
                      @for (m of milestones(s); track m.n) {
                        <a [href]="m.href" class="btn btn-outline-primary" target="_blank" rel="noopener">{{ m.label }}</a>
                      }
                    }
                    @if (recTech(s); as label) {
                      <a [routerLink]="['/staff/consultancy/technology', t(s, 'ZedId'), t(s, 'Certification')]" class="btn"
                         [class.btn-primary]="label === 'Recommend Technologies'" [class.btn-outline-primary]="label !== 'Recommend Technologies'">{{ label }}</a>
                    }
                  </div>
                </td>
              </tr>
            } @else if (completed()) {
              <!-- As the old Completed list: a rejected unit's row in the danger colour. -->
              <tr [class.btn-danger]="!!t(s, 'ReasonForRejection')">
                <td class="text-center">{{ t(s, 'RowNumber') }}</td>
                @if (surveillance) {
                  <td class="text-center"><strong>{{ t(s, 'Certification') }}</strong><div class="muted">{{ t(s, 'SurveillanceNo') }}</div></td>
                } @else {
                  <td class="text-center"><strong>{{ t(s, 'Certification') }}</strong></td>
                  <td class="text-center">{{ t(s, 'CertificationPhase') }}</td>
                }
                <td class="unit"><strong class="dash-text-clr">{{ t(s, 'ZedId') }}</strong><div><strong>{{ t(s, 'PUnitName') }}</strong></div><div class="muted">{{ t(s, 'UnitAddress') }}</div></td>
                <td class="text-center">
                  @if (surveillance) {
                    {{ t(s, 'ModeOfAssessment') }}
                  } @else {
                    <span class="zed-chip">Desktop</span>
                    @if (t(s, 'ModeOfAssessment') === 'Remote Assessment') { <span class="zed-chip">Remote</span> }
                    @if (t(s, 'ModeOfAssessment') === 'Onsite Assessment') { <span class="zed-chip">Onsite</span> }
                  }
                </td>
                @if (!isAgency()) {
                  <td><strong>{{ t(s, 'AgencyName') }}</strong><div class="muted">{{ t(s, 'CertificationBodyUserId') }}</div></td>
                }
                @if (!isAssessor()) {
                  <td class="stack">
                    <div><strong>{{ t(s, 'DesktopAssessorName') }}</strong><div class="muted">{{ t(s, 'DesktopAssessorId') }}</div></div>
                    <div><strong>{{ t(s, 'SiteAssessorName') }}</strong><div class="muted">{{ t(s, 'SiteAssessorId') }}</div></div>
                    <div><strong>{{ t(s, 'CoAssessorName') }}</strong><div class="muted">{{ t(s, 'CoAssessorId') }}</div></div>
                  </td>
                }
                @if (isAssessor()) {
                  <td class="stack text-center">
                    <div>@if (t(s, 'DeskAssessment') === 'D') { {{ t(s, 'DocVerifiAllot') }} }</div>
                    <div>@if (t(s, 'SiteAssessment') === 'S') { {{ t(s, 'ScheduledOn') }} }</div>
                  </td>
                  <td class="stack text-center">
                    <div>@if (t(s, 'DeskAssessment') === 'D') { {{ t(s, 'DesktopVerificationCompleted') }} }</div>
                    <div>@if (t(s, 'SiteAssessment') === 'S') { {{ t(s, 'CompletedOn') }} }</div>
                  </td>
                } @else {
                  <td class="stack text-center"><div>{{ t(s, 'DocVerifiAllot') }}</div><div>{{ t(s, 'SaAssessmentDate') }}</div><div>{{ t(s, 'CertificationStatusDate') }}</div></td>
                  @if (!surveillance) {
                    <td class="text-center">
                      @if (t(s, 'Certification') !== 'Bronze') { <span class="muted">Surveillance 1 date:</span><br /> }
                      {{ t(s, 'FirstSurveDueDate') }}
                    </td>
                  }
                }
                @if (!surveillance) {
                  <td class="text-center" [class.table-warning]="n(s, 'SameUdyamAddress') > 0">{{ t(s, 'SameUdyamAddress') }}</td>
                }
                @if (isMasterAdmin()) {
                  <td class="text-center">
                    <div class="row-actions justify-content-center">
                      <a [href]="legacy.profile(t(s, 'ZedId'))" class="btn btn-outline-primary">View Profile</a>
                      @if (n(s, 'CertificationStatus') >= 9) {
                        <a [routerLink]="['/staff/assessment/sa-details', t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-outline-primary">Assessment Details</a>
                      } @else {
                        <a [routerLink]="['/staff/assessment/da-details', t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-outline-primary">Assessment Details</a>
                      }
                      @if (!surveillance && pledgeUrl(s); as href) {
                        <a [href]="href" class="btn btn-outline-primary" target="_blank" rel="noopener">Pledge Certificate</a>
                      }
                      @if (certificateUrl(s); as href) {
                        <a [href]="href" class="btn btn-outline-primary" target="_blank" rel="noopener">Download Certificate</a>
                      }
                      <a [href]="reportUrl(s)" class="btn btn-outline-primary" target="_blank" rel="noopener">Download Report</a>
                    </div>
                  </td>
                } @else if (isAgency()) {
                  <td class="text-center">
                    <div class="row-actions justify-content-center">
                      <a [href]="legacy.profile(t(s, 'ZedId'))" class="btn btn-outline-primary">View Profile</a>
                      @if (n(s, 'CertificationStatus') < 9) {
                        <a [routerLink]="['/staff/assessment/da-details', t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-outline-primary">Assessment Details</a>
                      }
                      <!-- Surveillance (that portal's Completed.cshtml): SaDetails from status 9; main from 15. -->
                      @if (n(s, 'CertificationStatus') >= (surveillance ? 9 : 15)) {
                        <a [routerLink]="['/staff/assessment/sa-details', t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-outline-primary">Assessment Details</a>
                      }
                    </div>
                  </td>
                }
              </tr>
            } @else {
              <!-- As the old Rejected list: an open NC (NcStatus 2, status 4 or 14) in the warning colour. -->
              <tr [class.btn-warning]="n(s, 'NcStatus') === 2 && (n(s, 'CertificationStatus') === 4 || n(s, 'CertificationStatus') === 14)">
                <td class="text-center">{{ t(s, 'RowNumber') }}</td>
                <td class="text-center"><strong>{{ t(s, 'Certification') }}</strong></td>
                <td class="unit"><strong class="dash-text-clr">{{ t(s, 'ZedId') }}</strong><div><strong>{{ t(s, 'PUnitName') }}</strong></div><div class="muted">{{ t(s, 'UnitAddress') }}</div></td>
                @if (isMasterAdmin()) { <td>{{ t(s, 'CertificationBodyUserId') }} - {{ t(s, 'AgencyName') }}</td> }
                <td class="stack text-center"><div>{{ t(s, 'SaAssessmentDate') }}</div><div>{{ t(s, 'CertificationStatusDate') }}</div></td>
                <td class="text-center">
                  <div class="row-actions justify-content-center">
                    <a [href]="legacy.profile(t(s, 'ZedId'))" class="btn btn-outline-primary">View Profile</a>
                    @if (isMasterAdmin()) {
                      @if (t(s, 'Certification') === 'Bronze') {
                        <a [routerLink]="['/staff/assessment/da-details', t(s, 'RejectedZedId') || t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-outline-primary">Assessment Details</a>
                      } @else {
                        <a [routerLink]="['/staff/assessment/sa-details', t(s, 'RejectedZedId') || t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-outline-primary">Assessment Details</a>
                      }
                    }
                  </div>
                </td>
              </tr>
            }
          } @empty {
            <tr><td colspan="12" style="padding: 0"><div class="no-data">No Data</div></td></tr>
          }
        </tbody>
      </table>
    </div>

    <zed-pager [pager]="pager" [sizes]="sizes" />

    @if (loading()) {
      <div class="loadingdiv" style="display: block" role="status" aria-live="polite">
        <div class="loadingimage"><div class="loader"></div><div class="text-center"><small>Please wait ...</small></div></div>
      </div>
    }
  `,
  styles: `
    .unit { min-width: 200px; }
    .stack > div + div { margin-top: 6px; }
  `,
})
export class AssessmentResultsPage {
  /** Route data: which list. */
  readonly kind = input<'completed' | 'rejected'>('completed');

  private readonly api = inject(AssessmentApi);
  private readonly user = inject(AuthService).currentUser;
  protected readonly legacy = useLegacyPortal();
  protected readonly states = STATES;
  protected readonly t = text;
  protected readonly n = num;
  private readonly system = inject(ASSESSMENT_SYSTEM);
  protected readonly consultancy = this.system === 'consultancy';
  protected readonly surveillance = this.system === 'surveillance';
  /** Consultancy: the handholding levels; else every level (Administration → Certification Levels, the Admin's too; 2026-11-08). */
  protected readonly levels = computed(() => (this.consultancy ? ['Silver', 'Gold'] : levelCodes()));
  protected readonly levelName = levelName;
  /**
   * Consultancy "View Details": the milestone review page (the old SaDetails). The route of the consultancy milestone
   * page replaces this when it is wired (coordinator).
   */
  /** Consultancy rows open the milestone review page; the others the site assessment details page. */
  protected readonly milestoneDetailsRoute = this.system === 'consultancy' ? '/staff/consultancy/milestones' : '/staff/assessment/sa-details';

  protected state = '';
  protected level = '';
  protected size = '';
  /** Surveillance Completed only: value and label of the old Gender options, in their order. */
  protected readonly genders = [['male', 'Male'], ['female', 'Female'], ['Others', 'Others']] as const;
  protected gender = '';
  protected searchBy = 'Zed Id';
  protected searchText = '';

  protected readonly rows = signal<Row[]>([]);
  /**
   * Paged by the procedure, as the old pages: main 20 per page (up to 200), consultancy and surveillance 10 (up to 100).
   */
  protected readonly sizes = this.system === 'main' ? [10, 20, 50, 100, 200] : [10, 20, 50, 100];
  protected readonly pager = new ServerPager(this.system === 'main' ? 20 : 10, () => void this.load());
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  private request = 0;

  protected readonly completed = computed(() => this.kind() !== 'rejected');
  protected readonly heading = computed(() =>
    this.consultancy ? 'Consultancy Completed'
    : this.surveillance ? (this.completed() ? 'Completed Surveillance' : 'Rejected Surveillance')
    : this.completed() ? 'Completed Assessment' : 'Rejected Certification');
  protected readonly subtitle = computed(() =>
    this.consultancy ? 'Milestones the consultants completed, with their reports and recommended technologies.'
    : this.completed() ? 'Certifications whose assessment is complete, with their certificates and reports.'
    : 'Certifications rejected after the assessment.');
  protected readonly isMasterAdmin = computed(() => this.user()?.roleId === StaffRole.MasterAdmin);
  protected readonly isAgency = computed(() => this.user()?.roleId === StaffRole.Agency);
  protected readonly isAssessor = computed(() => this.user()?.roleId === StaffRole.DesktopAssessor);

  constructor() {
    effect(() => {
      this.kind();
      untracked(() => this.search());
    });
  }

  protected search(): void {
    this.pager.reset();
    void this.load();
  }

  /** Consultancy: the report of each milestone up to the row's (Milestone 1 Report, Progress Review 1, Progress Review 2). */
  protected milestones(s: Row): { n: number; label: string; href: string }[] {
    const labels = ['MileStone 1 Report', 'Progress Review 1', 'Progress Review 2'];
    const upTo = Math.min(Math.max(num(s, 'NcCount'), 1), 3);
    return labels.slice(0, upTo).map((label, i) => ({ n: i + 1, label, href: milestoneReportUrl(text(s, 'ZedId'), text(s, 'Certification'), i + 1) }));
  }

  /**
   * Consultancy, after milestone 3 (as the old Completed page): master admin and CO view the recommended technologies
   * once recommended (TuStatus 1); the lead consultant recommends them (TuStatus 0) or views them, once the MSME accepted
   * the milestone (status 100) and before the TU application closed them (TuStatus 98+).
   */
  protected recTech(s: Row): string {
    if (num(s, 'DisplayRecTech') !== 1 || num(s, 'NcCount') !== 3) return '';
    const tu = num(s, 'TuStatus');
    if (this.isAssessor()) return num(s, 'CertificationStatus') === 100 && tu < 98 ? (tu === 0 ? 'Recommend Technologies' : 'View Recommended Technologies') : '';
    return tu === 1 ? 'View Recommended Technologies' : '';
  }

  /** V4: every MSME has its pledge certificate (drawn when opened): the page of the unit's ZED ID (not a rejected copy's). */
  protected pledgeUrl(s: Row): string {
    const zedId = text(s, 'ZedId').split('_')[0];
    return zedId ? `/staff/pledge-certificate/${encodeURIComponent(zedId)}` : '';
  }

  /** The server serves the stored certificate, or draws it when a certified record has none. */
  protected certificateUrl(s: Row): string {
    return `${DOCUMENTS_API}/${encodeURIComponent(text(s, 'ZedId'))}/${encodeURIComponent(text(s, 'Certification'))}/certificate`;
  }

  protected reportUrl(s: Row): string {
    return `${DOCUMENTS_API}/${encodeURIComponent(text(s, 'ZedId'))}/${encodeURIComponent(text(s, 'Certification'))}/report`;
  }

  private async load(): Promise<void> {
    const request = ++this.request;
    this.loading.set(true);
    this.error.set('');
    try {
      const filter: ResultsFilter & { gender?: string } = {
        state: this.state,
        certification: this.level,
        size: this.size,
        searchBy: this.searchText.trim() ? this.searchBy : '',
        search: this.searchText.trim(),
        pageNo: this.pager.pageNo(),
        pageSize: this.pager.pageSize(),
      };
      // Sent as a query parameter like the others (empty values are left out).
      if (this.surveillance && this.completed()) filter.gender = this.gender;
      const res = await firstValueFrom(this.api.results(this.completed() ? 'completed' : 'rejected', filter));
      if (request !== this.request) return;
      this.rows.set(res.rows);
      this.pager.total.set(res.totalCount);
    } catch (err) {
      if (request === this.request) this.error.set(apiErrorMessage(err));
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }
}
