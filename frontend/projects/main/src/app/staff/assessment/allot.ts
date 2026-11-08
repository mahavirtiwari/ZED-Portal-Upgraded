import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ClientPager, PagerComponent } from '../pager';
import { ASSESSMENT_SYSTEM, Expanded, STATES, num, text, useLegacyPortal } from './assessment-shared';
import { AssessmentApi, ListFilter, Person, Row } from './assessment.api';
import { levelCodes, levelName } from '../../msme/shared/levels';

/**
 * Master admin: allot MSMEs to assessment agencies. Port of Views/Assessment/Allot.cshtml
 * (Assessment/GetList, GetCb, AllotCb). Profile and site-assessment pages still open on the current portal.
 * Consultancy ("Allot Consultancy"): paid milestones go to Consultant Organisations (Silver/Gold, Milestone column).
 * Surveillance ("Allot Surveillance"): Surveillance No and the auto-allotment date. Neither old page linked the
 * assessment details from here.
 */
@Component({
  selector: 'zed-staff-allot',
  imports: [FormsModule, RouterLink, PagerComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ title }}</h3>
        <p class="page-sub">{{ subtitle }}</p>
      </div>
    </div>

    @if (notice(); as n) {
      <div class="alert alert-dismissible" [class.alert-success]="n.ok" [class.alert-danger]="!n.ok" role="status">
        {{ n.text }}
        <button type="button" class="btn-close" aria-label="Close" (click)="notice.set(null)"></button>
      </div>
    }

    <div class="zed-card">
      <div class="filter-bar">
        <div class="filter">
          <label class="form-label" for="allotState">State</label>
          <select class="form-select" id="allotState" [(ngModel)]="filter.state" (ngModelChange)="load()">
            <option value="">Show All</option>
            @for (s of states; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }
          </select>
        </div>
        <div class="filter">
          <label class="form-label" for="allotLevel">{{ consultancy ? 'Desired Certification' : 'Certification Level' }}</label>
          <select class="form-select" id="allotLevel" [(ngModel)]="filter.certification" (ngModelChange)="load()">
            <option value="">Show All</option>
            @for (l of levels(); track l) { <option [value]="l">{{ levelName(l) }}</option> }
          </select>
        </div>
        <div class="filter">
          <label class="form-label" for="allotSize">MSME Size</label>
          <select class="form-select" id="allotSize" [(ngModel)]="filter.size" (ngModelChange)="load()">
            <option value="">Show All</option>
            <option value="Micro">Micro</option>
            <option value="Small">Small</option>
            <option value="Medium">Medium</option>
          </select>
        </div>
        <div class="filter">
          <label class="form-label" for="allotGender">Gender</label>
          <select class="form-select" id="allotGender" [(ngModel)]="filter.gender" (ngModelChange)="load()">
            <option value="">Show All</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="Others">Others</option>
          </select>
        </div>
        <div class="filter">
          <label class="form-label" for="allotType">ALLOT/RE-ALLOT</label>
          <select class="form-select" id="allotType" [(ngModel)]="filter.allotmentType" (ngModelChange)="load()">
            <option value="">Show All</option>
            <option value="ALLOT">ALLOT</option>
            <option value="REALLOT">RE-ALLOT</option>
          </select>
        </div>
        <div class="filter wide">
          <label class="form-label" for="allotSearch">Search</label>
          <input type="search" id="allotSearch" class="form-control" maxlength="50" [ngModel]="pager.search()" (ngModelChange)="pager.setSearch($event)" />
        </div>
      </div>
    </div>

    <div class="table-responsive">
      <table class="table table-zed table-bordered">
        <thead>
          <tr>
            <th class="text-center" style="width: 200px">Action(s)</th>
            <th class="text-center" style="width: 140px">Status</th>
            @if (consultancy) {
              <th class="text-center">Desired Certification</th>
              <th class="text-center">Milestone</th>
            } @else if (surveillance) {
              <th class="text-center">Certification Level<br />Surveillance No</th>
            } @else {
              <th class="text-center">Certification Level</th>
            }
            <th>Unit Details</th>
            <th>{{ consultancy ? 'Unit SPOC Details' : 'SPOC Details' }}</th>
            <th>{{ consultancy ? 'CO Details' : 'Agency Details' }}</th>
            <th>Reason For Rejection</th>
          </tr>
        </thead>
        <tbody>
          @for (s of pager.page(); track key(s)) {
            <!-- Row colours of the old pages: main table-danger; surveillance and consultancy btn-danger. -->
            <tr [class.table-danger]="main && !!t(s, 'ReasonForRejection')" [class.btn-danger]="!main && !!t(s, 'ReasonForRejection')">
              <td class="text-center" [class.table-danger]="main && !!t(s, 'TimeDuration')" [class.btn-danger]="!main && !!t(s, 'TimeDuration')">
                <div class="row-actions justify-content-center">
                  @if (legacy.profile(t(s, 'ZedId')); as href) {
                    <a [href]="href" class="btn btn-outline-primary">View Profile</a>
                  }
                  @if (main) {
                    @if (n(s, 'CertificationStatus') > 7) {
                      <a [routerLink]="['/staff/assessment/sa-details', t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-outline-primary">Assessment Details</a>
                    } @else {
                      <a [routerLink]="['/staff/assessment/da-details', t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-outline-primary">Assessment Details</a>
                    }
                  }
                  @if (!t(s, 'CertificationBodyUserId')) {
                    <button type="button" class="btn btn-primary" (click)="openAllot(s)">ALLOT</button>
                  }
                  @if (consultancy) {
                    <!-- That portal's Allot.cshtml: also once a consultant was allotted (DesktopAssessorId). -->
                    @if (t(s, 'ReasonForRejection') || t(s, 'TimeDuration') || t(s, 'CertificationBodyUserId') || t(s, 'DesktopAssessorId')) {
                      <button type="button" class="btn btn-outline-primary re-allot" (click)="openAllot(s)">RE-ALLOT</button>
                    }
                  } @else if (t(s, 'ReasonForRejection') || t(s, 'TimeDuration') || t(s, 'CertificationBodyUserId')) {
                    <button type="button" class="btn btn-outline-primary re-allot" (click)="openAllot(s)">RE-ALLOT</button>
                  }
                </div>
              </td>
              <td class="text-center">
                @if (!t(s, 'CertificationBodyUserId')) {
                  <span class="status-badge is-pending">Allotment Pending</span>
                } @else if (t(s, 'DesktopAssessorId')) {
                  <span class="status-badge is-success">{{ party }} Accepted</span>
                } @else if (t(s, 'ReasonForRejection')) {
                  <span class="status-badge is-rejected">{{ party }} Rejected</span>
                } @else {
                  <span class="status-badge is-info">Allocated to {{ party }}</span>
                }
              </td>
              @if (consultancy) {
                <td class="text-center"><strong>{{ t(s, 'Certification') }}</strong></td>
                <td class="text-center"><span class="zed-chip">Milestone {{ t(s, 'NcCount') }}</span></td>
              } @else if (surveillance) {
                <td class="text-center"><strong>{{ t(s, 'Certification') }}</strong><div class="muted">{{ t(s, 'SurveillanceNo') }}</div></td>
              } @else {
                <td class="text-center"><strong>{{ t(s, 'Certification') }}</strong></td>
              }
              <!-- Only main's old page marked a duplicate Udyam number. -->
              <td class="unit" [class.table-warning]="main && t(s, 'UdyamStatus') === 'Duplicate'">
                <strong class="dash-text-clr">{{ t(s, 'ZedId') }}</strong>
                <div><strong>{{ t(s, 'PUnitName') }}</strong></div>
                <div class="muted">{{ t(s, 'UnitAddress') }}</div>
              </td>
              <td><strong>{{ t(s, 'UnitSpocName') }}</strong><div>{{ t(s, 'UnitSpocMobileNo') }}</div><div class="muted">{{ t(s, 'UnitSpocEmailId') }}</div></td>
              <td>
                <strong>{{ t(s, 'AgencyName') }}</strong><div class="muted">{{ t(s, 'CertificationBodyUserId') }}</div>
                @if (surveillance && t(s, 'CertificationBodyUserId') && t(s, 'AutoAllocationDate')) {
                  <div class="mt-2"><small><strong>Auto Alloted on:</strong> {{ t(s, 'AutoAllocationDate') }}</small></div>
                }
              </td>
              <td class="reason">
                @if (t(s, 'ReasonForRejection'); as reason) {
                  <div [class.clamp-3]="!more.has(key(s))" [title]="reason">{{ reason }}</div>
                  @if (reason.length > 120) {
                    <button type="button" class="btn btn-link btn-sm p-0" (click)="more.toggle(key(s))">{{ more.has(key(s)) ? 'less' : 'more' }}</button>
                  }
                }
              </td>
            </tr>
          } @empty {
            <tr><td [attr.colspan]="consultancy ? 8 : 7" style="padding: 0"><div class="no-data">No Data</div></td></tr>
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="pager" />

    @if (current(); as c) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="allotTitle">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header justify-content-between">
              <div class="modal-title" id="allotTitle"><strong>{{ consultancy ? 'Consultant Organisation' : 'Certification Body' }}</strong></div>
              <button type="button" class="btn-close" aria-label="Close" (click)="current.set(null)"></button>
            </div>
            <div class="modal-body">
              <p class="muted mb-2">{{ t(c, 'ZedId') }} · {{ t(c, 'Certification') }}</p>
              <select class="form-select mb-2" [attr.aria-label]="consultancy ? 'Consultant organisation' : 'Certification body'" [(ngModel)]="agencyId">
                <option value="">{{ consultancy ? '--Select Consultant Organisation--' : '--Select Certification Body--' }}</option>
                @for (a of agencies(); track a.userId) { <option [value]="a.userId">{{ a.userName }}</option> }
              </select>
              @if (modalError()) { <div class="alert alert-danger mb-0" role="alert">{{ modalError() }}</div> }
            </div>
            <div class="modal-footer">
              <input type="button" class="btn btn-default" value="CANCEL" (click)="current.set(null)" />
              <input type="button" class="btn btn-primary" value="ALLOT" [disabled]="busy()" (click)="allot()" />
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }

    @if (loading()) {
      <div class="loadingdiv" style="display: block" role="status" aria-live="polite">
        <div class="loadingimage"><div class="loader"></div><div class="text-center"><small>Please wait ...</small></div></div>
      </div>
    }
  `,
  styles: `.unit { min-width: 200px; } .reason { min-width: 180px; white-space: pre-wrap; }`,
})
export class AllotPage {
  private readonly api = inject(AssessmentApi);
  protected readonly legacy = useLegacyPortal();
  protected readonly states = STATES;
  protected readonly t = text;
  protected readonly n = num;
  private readonly system = inject(ASSESSMENT_SYSTEM);
  protected readonly main = this.system === 'main';
  protected readonly consultancy = this.system === 'consultancy';
  protected readonly surveillance = this.system === 'surveillance';
  protected readonly title = this.consultancy ? 'Allot Consultancy' : this.surveillance ? 'Allot Surveillance' : 'Allot Assessment';
  protected readonly subtitle = this.consultancy
    ? 'Allot the paid milestones of the MSMEs to Consultant Organisations, or re-allot them.'
    : this.surveillance ? 'Allot the surveillance assessments to Certification Bodies, or re-allot the rejected and overdue ones.'
    : 'Allot the MSMEs to Certification Bodies, or re-allot the rejected and overdue ones.';
  /** Who the record is allotted to, in the status column. */
  protected readonly party = this.consultancy ? 'CO' : 'Agency';
  /** Handholding is for Silver and Gold only. */
  /** Consultancy: the handholding levels; else every level (Administration → Certification Levels, the Admin's too; 2026-11-08). */
  protected readonly levels = computed(() => (this.consultancy ? ['Silver', 'Gold'] : levelCodes()));
  protected readonly levelName = levelName;

  protected filter: Required<ListFilter> = { state: '', certification: '', size: '', gender: '', allotmentType: '' };
  protected readonly pager = new ClientPager();
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly notice = signal<{ ok: boolean; text: string } | null>(null);
  protected readonly current = signal<Row | null>(null);
  protected readonly agencies = signal<Person[]>([]);
  protected readonly modalError = signal('');
  protected agencyId = '';
  protected readonly more = new Expanded();
  protected readonly key = (s: Row) => text(s, 'ZedId') + text(s, 'Certification');
  private request = 0;

  constructor() {
    void this.load();
  }

  async load(keepPage = false): Promise<void> {
    const request = ++this.request;
    const page = this.pager.pageNo();
    this.loading.set(true);
    try {
      const res = await firstValueFrom(this.api.allotList(this.filter));
      if (request !== this.request) return;
      this.pager.set(res.rows);
      if (keepPage) this.pager.goTo(page);
    } catch (err) {
      if (request === this.request) this.notice.set({ ok: false, text: apiErrorMessage(err) });
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }

  protected async openAllot(s: Row): Promise<void> {
    this.loading.set(true);
    this.modalError.set('');
    try {
      this.agencies.set(await firstValueFrom(this.api.agencies(text(s, 'ZedId'), text(s, 'Certification'))));
      this.agencyId = '';
      this.current.set(s);
    } catch (err) {
      this.notice.set({ ok: false, text: apiErrorMessage(err) });
    } finally {
      this.loading.set(false);
    }
  }

  protected async allot(): Promise<void> {
    const s = this.current();
    if (!s) return;
    if (!this.agencyId) {
      this.modalError.set('Please select valid data.');
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.allotToAgency(text(s, 'ZedId'), text(s, 'Certification'), this.agencyId));
      this.current.set(null);
      this.notice.set({ ok: true, text: 'Success!' });
      await this.load(true);
    } catch (err) {
      this.modalError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
