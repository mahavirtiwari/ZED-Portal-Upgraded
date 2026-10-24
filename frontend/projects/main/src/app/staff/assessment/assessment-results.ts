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

/** Folders a stored pledge certificate is in (SP_MONITORING_GET_LIST_PAGINATION PledgePath). */
const CERT_FOLDERS = ['Certificates', 'Certifications'];

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
    <div class="container form-page" id="zed_user_form">
      <div class="row mt-3">
        <div class="col-sm-12">
          <h3 class="registration-title">{{ heading() }}</h3>
        </div>

        @if (error()) {
          <div class="col-sm-12"><div class="alert alert-danger" role="alert">{{ error() }}</div></div>
        }

        @if (surveillance && !completed()) {
          <!-- Rejected Surveillance (that portal's Rejected.cshtml): only the level, Bronze/Silver/Gold. -->
          <div class="col-sm-12 mb-3">
            <label for="resLevel"><strong>Certification Level</strong></label>
            <select class="form-select" style="width: 200px" id="resLevel" [(ngModel)]="level" (ngModelChange)="search()">
              @for (l of levels; track l) { <option [value]="l">{{ l }}</option> }
            </select>
          </div>
        } @else {
          <div class="col-sm-12 mb-4">
            <div class="d-flex flex-wrap gap-2">
              <div>
                <label for="resState"><strong>State</strong></label>
                <select class="form-select" style="width: 200px" id="resState" [(ngModel)]="state" (ngModelChange)="search()">
                  <option value="">Show All</option>
                  @for (s of states; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }
                </select>
              </div>
              <div>
                <label for="resLevel"><strong>{{ consultancy ? 'Desired Certification' : 'Certification Level' }}</strong></label>
                <select class="form-select" style="width: 200px" id="resLevel" [(ngModel)]="level" (ngModelChange)="search()">
                  <option value="">Show All</option>
                  @for (l of levels; track l) { <option [value]="l">{{ l }}</option> }
                </select>
              </div>
              <div>
                <label for="resSize"><strong>MSME Size</strong></label>
                <select class="form-select" style="width: 200px" id="resSize" [(ngModel)]="size" (ngModelChange)="search()">
                  <option value="">Show All</option>
                  <option value="Micro">Micro</option>
                  <option value="Small">Small</option>
                  <option value="Medium">Medium</option>
                </select>
              </div>
              @if (surveillance) {
                <!-- Completed Surveillance's Gender filter (the procedure's @Gender), with the old option values. -->
                <div>
                  <label for="resGender"><strong>Gender</strong></label>
                  <select class="form-select" style="width: 200px" id="resGender" [(ngModel)]="gender" (ngModelChange)="search()">
                    <option value="">Show All</option>
                    @for (g of genders; track g[0]) { <option [value]="g[0]">{{ g[1] }}</option> }
                  </select>
                </div>
              }
            </div>
          </div>

          @if (surveillance) {
            <!-- Completed Surveillance: one search box that filters as you type (the old SearchText). -->
            <div class="row mb-2">
              <div class="col-sm-6 ms-auto">
                <input type="text" id="resSearch" class="form-control" placeholder="Search" aria-label="Search" maxlength="50" [(ngModel)]="searchText" (ngModelChange)="search()" />
              </div>
            </div>
          } @else {
            <div class="row mb-2">
              <div class="col-sm-3">
                <label for="resSearchBy"><strong>Search By</strong></label>
                <select class="form-select" style="width: 200px" id="resSearchBy" [(ngModel)]="searchBy">
                  <option value="Zed Id">Zed Id</option>
                  <option value="Udyam Number">Udyam Number</option>
                  <option value="Unit Name">Unit Name</option>
                </select>
              </div>
              <div class="col-sm-3">
                <label for="resSearch">{{ searchBy }}</label>
                <input type="text" id="resSearch" class="form-control" maxlength="50" [(ngModel)]="searchText" (keyup.enter)="search()" />
              </div>
              <div class="col-sm-3" style="margin-top: 30px">
                <button type="button" class="btn btn-primary btn-sm" (click)="search()">Search</button>
              </div>
            </div>
          }
        }

        <div class="col-sm-12 mt-3">
          <div class="table-responsive">
            <table class="table table-bordered table-zed">
              <thead>
                @if (consultancy) {
                  <tr>
                    <th>S.No</th>
                    <th>Desired Certification</th>
                    <th>Unit Details</th>
                    <th>Milestone</th>
                    @if (!isAgency()) { <th>CO Details</th> }
                    @if (!isAssessor()) { <th>Consultant Details</th> }
                    <th>Date of Completion</th>
                    <th>Action(s)</th>
                  </tr>
                } @else if (completed()) {
                  <tr>
                    <th>S.No</th>
                    @if (surveillance) {
                      <th>Certification Level <br /><br />Surveillance No</th>
                    } @else {
                      <th>Certification Level</th>
                      <th>Certification Phase</th>
                    }
                    <th>Unit Details</th>
                    <th>Mode of Assessment</th>
                    @if (!isAgency()) { <th>Agency Details</th> }
                    @if (!isAssessor()) { <th>Assessors Details</th> }
                    @if (isAssessor()) {
                      <th>Assessment Allocated On</th>
                      <th>Assessment Completed On</th>
                    } @else {
                      <th>Assessment Dates <br />Completion Date</th>
                      @if (!surveillance) { <th>Surveillance Due Date</th> }
                    }
                    @if (!surveillance) { <th>Duplicates</th> }
                    @if (!isAssessor()) { <th>Action(s)</th> }
                  </tr>
                } @else {
                  <tr>
                    <th>S.No.</th>
                    <th>Certification Level</th>
                    <th>Unit Details</th>
                    @if (isMasterAdmin()) { <th>Agency Name</th> }
                    <th>Assessment Date <br /><br />Rejected Date</th>
                    <th>Action(s)</th>
                  </tr>
                }
              </thead>
              <tbody>
                @for (s of rows(); track $index) {
                  @if (consultancy) {
                    <!-- As the old Consultancy Completed list: a rejected milestone's row in the danger colour. -->
                    <tr [class.btn-danger]="!!t(s, 'ReasonForRejection')">
                      <td>{{ t(s, 'RowNumber') }}</td>
                      <td>{{ t(s, 'Certification') }}</td>
                      <td><strong>{{ t(s, 'ZedId') }}</strong><br /><strong>{{ t(s, 'PUnitName') }}</strong><br />{{ t(s, 'UnitAddress') }}</td>
                      <td>Milestone {{ t(s, 'NcCount') }}</td>
                      @if (!isAgency()) {
                        <td><strong>{{ t(s, 'AgencyName') }}</strong><br />{{ t(s, 'CertificationBodyUserId') }}</td>
                      }
                      @if (!isAssessor()) {
                        <td>
                          <strong>Lead Consultant<br />{{ t(s, 'SiteAssessorName') }}</strong><br />{{ t(s, 'SiteAssessorId') }}
                          @if (t(s, 'CoAssessorName') || t(s, 'CoAssessorId')) {
                            <br /><br /><strong>CO Consultant<br />{{ t(s, 'CoAssessorName') }}</strong><br />{{ t(s, 'CoAssessorId') }}
                          }
                        </td>
                      }
                      <td>{{ t(s, 'DocVerifiAllot') }}<br /><br />{{ t(s, 'CertificationStatusDate') }}</td>
                      <td>
                        @if (!isAssessor()) {
                          @if (legacy.profile(t(s, 'ZedId')); as href) {
                            <a style="width: 180px" [href]="href" class="btn btn-primary mb-2">View Profile</a>
                          }
                          <a style="width: 180px" [routerLink]="[milestoneDetailsRoute, t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-primary mb-2">View Details</a>
                          @for (m of milestones(s); track m.n) {
                            <a style="width: 180px" [href]="m.href" class="btn btn-primary mb-2" target="_blank" rel="noopener">{{ m.label }}</a>
                          }
                        }
                        @if (recTech(s); as label) {
                          <a style="width: 180px" [routerLink]="['/staff/consultancy/technology', t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-primary mb-2">{{ label }}</a>
                        }
                      </td>
                    </tr>
                  } @else if (completed()) {
                    <!-- As the old Completed list: a rejected unit's row in the danger colour. -->
                    <tr [class.btn-danger]="!!t(s, 'ReasonForRejection')">
                      <td>{{ t(s, 'RowNumber') }}</td>
                      @if (surveillance) {
                        <td>{{ t(s, 'Certification') }}<br /><br />{{ t(s, 'SurveillanceNo') }}</td>
                      } @else {
                        <td>{{ t(s, 'Certification') }}</td>
                        <td>{{ t(s, 'CertificationPhase') }}</td>
                      }
                      <td><strong>{{ t(s, 'ZedId') }}</strong><br /><strong>{{ t(s, 'PUnitName') }}</strong><br />{{ t(s, 'UnitAddress') }}</td>
                      <td>
                        @if (surveillance) {
                          {{ t(s, 'ModeOfAssessment') }}
                        } @else {
                          Desktop<br /><br />
                          @if (t(s, 'ModeOfAssessment') === 'Remote Assessment') { Remote }
                          @if (t(s, 'ModeOfAssessment') === 'Onsite Assessment') { Onsite }
                        }
                      </td>
                      @if (!isAgency()) {
                        <td><strong>{{ t(s, 'AgencyName') }}</strong><br />{{ t(s, 'CertificationBodyUserId') }}</td>
                      }
                      @if (!isAssessor()) {
                        <td>
                          <strong>{{ t(s, 'DesktopAssessorName') }}</strong><br />{{ t(s, 'DesktopAssessorId') }}<br /><br />
                          <strong>{{ t(s, 'SiteAssessorName') }}</strong><br />{{ t(s, 'SiteAssessorId') }}<br /><br />
                          <strong>{{ t(s, 'CoAssessorName') }}</strong><br />{{ t(s, 'CoAssessorId') }}
                        </td>
                      }
                      @if (isAssessor()) {
                        <td>
                          @if (t(s, 'DeskAssessment') === 'D') { {{ t(s, 'DocVerifiAllot') }} }<br /><br />
                          @if (t(s, 'SiteAssessment') === 'S') { {{ t(s, 'ScheduledOn') }} }
                        </td>
                        <td>
                          @if (t(s, 'DeskAssessment') === 'D') { {{ t(s, 'DesktopVerificationCompleted') }} }<br /><br />
                          @if (t(s, 'SiteAssessment') === 'S') { {{ t(s, 'CompletedOn') }} }
                        </td>
                      } @else {
                        <td>{{ t(s, 'DocVerifiAllot') }}<br /><br />{{ t(s, 'SaAssessmentDate') }}<br /><br />{{ t(s, 'CertificationStatusDate') }}</td>
                        @if (!surveillance) {
                          <td>
                            @if (t(s, 'Certification') !== 'Bronze') { Surveillance 1 date:<br /> }
                            {{ t(s, 'FirstSurveDueDate') }}
                          </td>
                        }
                      }
                      @if (!surveillance) {
                        <td [style.background-color]="n(s, 'SameUdyamAddress') > 0 ? 'yellow' : null">{{ t(s, 'SameUdyamAddress') }}</td>
                      }
                      @if (isMasterAdmin()) {
                        <td class="text-center">
                          <a style="width: 180px" [href]="legacy.profile(t(s, 'ZedId'))" class="btn btn-primary mb-2">View Profile</a>
                          @if (n(s, 'CertificationStatus') >= 9) {
                            <a style="width: 180px" [routerLink]="['/staff/assessment/sa-details', t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-primary mb-2">Assessment Details</a>
                          } @else {
                            <a style="width: 180px" [routerLink]="['/staff/assessment/da-details', t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-primary mb-2">Assessment Details</a>
                          }
                          @if (!surveillance && pledgeUrl(s); as href) {
                            <a style="width: 180px" [href]="href" class="btn btn-primary mb-2" target="_blank" rel="noopener">Download Pledge Certificate</a>
                          }
                          @if (certificateUrl(s); as href) {
                            <a style="width: 180px" [href]="href" class="btn btn-primary mb-2" target="_blank" rel="noopener">Download Certificate</a>
                          }
                          <a style="width: 180px" [href]="reportUrl(s)" class="btn btn-primary mb-2" target="_blank" rel="noopener">Download Report</a>
                        </td>
                      } @else if (isAgency()) {
                        <td>
                          <a style="width: 180px" [href]="legacy.profile(t(s, 'ZedId'))" class="btn btn-primary mb-2">View Profile</a>
                          @if (n(s, 'CertificationStatus') < 9) {
                            <a style="width: 180px" [routerLink]="['/staff/assessment/da-details', t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-primary mb-2">Assessment Details</a>
                          }
                          <!-- Surveillance (that portal's Completed.cshtml): SaDetails from status 9; main from 15. -->
                          @if (n(s, 'CertificationStatus') >= (surveillance ? 9 : 15)) {
                            <a style="width: 180px" [routerLink]="['/staff/assessment/sa-details', t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-primary mb-2">Assessment Details</a>
                          }
                        </td>
                      }
                    </tr>
                  } @else {
                    <!-- As the old Rejected list: an open NC (NcStatus 2, status 4 or 14) in the warning colour. -->
                    <tr [class.btn-warning]="n(s, 'NcStatus') === 2 && (n(s, 'CertificationStatus') === 4 || n(s, 'CertificationStatus') === 14)">
                      <td>{{ t(s, 'RowNumber') }}</td>
                      <td>{{ t(s, 'Certification') }}</td>
                      <td><strong>{{ t(s, 'ZedId') }}</strong><br /><strong>{{ t(s, 'PUnitName') }}</strong><br />{{ t(s, 'UnitAddress') }}</td>
                      @if (isMasterAdmin()) { <td>{{ t(s, 'CertificationBodyUserId') }} - {{ t(s, 'AgencyName') }}</td> }
                      <td>{{ t(s, 'SaAssessmentDate') }}<br /><br />{{ t(s, 'CertificationStatusDate') }}</td>
                      <td>
                        <a style="width: 180px" [href]="legacy.profile(t(s, 'ZedId'))" class="btn btn-primary mb-2">View Profile</a>
                        @if (isMasterAdmin()) {
                          @if (t(s, 'Certification') === 'Bronze') {
                            <a style="width: 180px" [routerLink]="['/staff/assessment/da-details', t(s, 'RejectedZedId') || t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-primary mb-2">Assessment Details</a>
                          } @else {
                            <a style="width: 180px" [routerLink]="['/staff/assessment/sa-details', t(s, 'RejectedZedId') || t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-primary mb-2">Assessment Details</a>
                          }
                        }
                      </td>
                    </tr>
                  }
                } @empty {
                  <tr><td colspan="12" style="padding: 0"><div class="no-data">No Data</div></td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>

        <zed-pager [pager]="pager" [sizes]="sizes" />
      </div>
    </div>

    @if (loading()) {
      <div class="loadingdiv" style="display: block" role="status" aria-live="polite">
        <div class="loadingimage"><div class="loader"></div><div class="text-center"><small>Please wait ...</small></div></div>
      </div>
    }
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
  protected readonly levels = this.consultancy ? ['Silver', 'Gold'] : ['Bronze', 'Silver', 'Gold'];
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

  /** Shown when the procedure names the folder of a stored pledge certificate, as before. */
  protected pledgeUrl(s: Row): string {
    return CERT_FOLDERS.includes(text(s, 'PledgePath')) ? `${DOCUMENTS_API}/${encodeURIComponent(text(s, 'ZedId'))}/pledge-certificate` : '';
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
