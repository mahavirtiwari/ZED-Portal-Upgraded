import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ClientPager, STATES, num, text, useLegacyPortal } from './assessment-shared';
import { AssessmentApi, ListFilter, Person, Row } from './assessment.api';
import { ListPager } from './list-pager';

/**
 * Master admin: allot MSMEs to assessment agencies. Port of Views/Assessment/Allot.cshtml
 * (Assessment/GetList, GetCb, AllotCb). Profile and site-assessment pages still open on the current portal.
 */
@Component({
  selector: 'zed-staff-allot',
  imports: [FormsModule, RouterLink, ListPager],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="row mt-4">
        <div class="col-sm-12"><h3 class="registration-title">Allot Assessment</h3></div>

        @if (notice(); as n) {
          <div class="col-sm-12">
            <div class="alert alert-dismissible" [class.alert-success]="n.ok" [class.alert-danger]="!n.ok" role="status">
              {{ n.text }}
              <button type="button" class="btn-close" aria-label="Close" (click)="notice.set(null)"></button>
            </div>
          </div>
        }

        <div class="col-sm-12 mb-4">
          <div class="d-flex flex-wrap gap-2">
            <div>
              <label for="allotState"><strong>State</strong></label>
              <select class="form-control" style="width: 200px" id="allotState" [(ngModel)]="filter.state" (ngModelChange)="load()">
                <option value="">Show All</option>
                @for (s of states; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }
              </select>
            </div>
            <div>
              <label for="allotLevel"><strong>Certification Level</strong></label>
              <select class="form-control" style="width: 200px" id="allotLevel" [(ngModel)]="filter.certification" (ngModelChange)="load()">
                <option value="">Show All</option>
                <option value="Bronze">Bronze</option>
                <option value="Silver">Silver</option>
                <option value="Gold">Gold</option>
              </select>
            </div>
            <div>
              <label for="allotSize"><strong>MSME Size</strong></label>
              <select class="form-control" style="width: 200px" id="allotSize" [(ngModel)]="filter.size" (ngModelChange)="load()">
                <option value="">Show All</option>
                <option value="Micro">Micro</option>
                <option value="Small">Small</option>
                <option value="Medium">Medium</option>
              </select>
            </div>
            <div>
              <label for="allotGender"><strong>Gender</strong></label>
              <select class="form-control" style="width: 200px" id="allotGender" [(ngModel)]="filter.gender" (ngModelChange)="load()">
                <option value="">Show All</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="Others">Others</option>
              </select>
            </div>
            <div>
              <label for="allotType"><strong>ALLOT/RE-ALLOT</strong></label>
              <select class="form-control" style="width: 200px" id="allotType" [(ngModel)]="filter.allotmentType" (ngModelChange)="load()">
                <option value="">Show All</option>
                <option value="ALLOT">ALLOT</option>
                <option value="REALLOT">RE-ALLOT</option>
              </select>
            </div>
          </div>
        </div>

        <div class="row justify-content-end mb-2">
          <div class="col-sm-3">
            <div class="search-input pull-right">
              <input type="text" class="form-control" maxlength="50" aria-label="Search" [ngModel]="pager.search()" (ngModelChange)="pager.setSearch($event)" />
            </div>
          </div>
        </div>

        <div class="col-sm-12">
          <div class="table-responsive">
            <table class="table table-zed table-bordered">
              <thead>
                <tr>
                  <th>Action(s)</th>
                  <th>Status</th>
                  <th>Certification Level</th>
                  <th>Unit Details</th>
                  <th>SPOC Details</th>
                  <th>Agency Details</th>
                  <th>Reason For Rejection</th>
                </tr>
              </thead>
              <tbody>
                @for (s of pager.page(); track t(s, 'ZedId') + t(s, 'Certification')) {
                  <tr [class.table-danger]="t(s, 'ReasonForRejection')">
                    <td [class.table-danger]="t(s, 'TimeDuration')">
                      @if (legacy.profile(t(s, 'ZedId')); as href) {
                        <a style="width: 180px" [href]="href" class="btn btn-primary mb-2">View Profile</a>
                      }
                      @if (n(s, 'CertificationStatus') > 7) {
                        <a style="width: 180px" [routerLink]="['/staff/assessment/sa-details', t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-primary btn-xs mb-2">Assessment<br />Details</a>
                      } @else {
                        <a style="width: 180px" [routerLink]="['/staff/assessment/da-details', t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-primary btn-xs mb-2">Assessment<br />Details</a>
                      }
                      @if (!t(s, 'CertificationBodyUserId')) {
                        <button type="button" style="width: 180px" class="btn btn-primary btn-xs mb-2" (click)="openAllot(s)">ALLOT</button>
                      }
                      @if (t(s, 'ReasonForRejection') || t(s, 'TimeDuration') || t(s, 'CertificationBodyUserId')) {
                        <button type="button" class="btn btn-default btn-xs re-allot" (click)="openAllot(s)">RE-ALLOT</button>
                      }
                    </td>
                    <td>
                      <strong>
                        @if (!t(s, 'CertificationBodyUserId')) {
                          <small>Allotment Pending</small>
                        } @else if (t(s, 'DesktopAssessorId')) {
                          <small class="text-success">Agency Accepted</small>
                        } @else if (t(s, 'ReasonForRejection')) {
                          <small>Agency Rejected</small>
                        } @else {
                          <small class="text-success">Allocated to Agency</small>
                        }
                      </strong>
                    </td>
                    <td><strong>{{ t(s, 'Certification') }}</strong></td>
                    <td [class.table-warning]="t(s, 'UdyamStatus') === 'Duplicate'">
                      <strong class="dash-text-clr">{{ t(s, 'ZedId') }}</strong><br />
                      <strong>{{ t(s, 'PUnitName') }}</strong><br />
                      {{ t(s, 'UnitAddress') }}
                    </td>
                    <td><strong>{{ t(s, 'UnitSpocName') }}</strong><br />{{ t(s, 'UnitSpocMobileNo') }}<br />{{ t(s, 'UnitSpocEmailId') }}</td>
                    <td><strong>{{ t(s, 'AgencyName') }}</strong><br />{{ t(s, 'CertificationBodyUserId') }}</td>
                    <td>{{ t(s, 'ReasonForRejection') }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="7" style="padding: 0"><div class="no-data">No Data</div></td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>
        <zed-list-pager [pager]="pager" />
      </div>
    </div>

    @if (current(); as c) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="allotTitle">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header justify-content-between">
              <div class="modal-title" id="allotTitle"><strong>Certification Body</strong></div>
              <button type="button" class="close btn btn-link" aria-label="Close" (click)="current.set(null)"><strong>x&nbsp;</strong></button>
            </div>
            <div class="modal-body">
              <p class="mb-2">{{ t(c, 'ZedId') }} · {{ t(c, 'Certification') }}</p>
              <div class="text-center" style="margin-bottom: 9px">
                <select class="form-control" aria-label="Certification body" [(ngModel)]="agencyId">
                  <option value="">--Select Certification Body--</option>
                  @for (a of agencies(); track a.userId) { <option [value]="a.userId">{{ a.userName }}</option> }
                </select>
              </div>
              @if (modalError()) { <div class="alert alert-danger" role="alert">{{ modalError() }}</div> }
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
})
export class AllotPage {
  private readonly api = inject(AssessmentApi);
  protected readonly legacy = useLegacyPortal();
  protected readonly states = STATES;
  protected readonly t = text;
  protected readonly n = num;

  protected filter: Required<ListFilter> = { state: '', certification: '', size: '', gender: '', allotmentType: '' };
  protected readonly pager = new ClientPager();
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly notice = signal<{ ok: boolean; text: string } | null>(null);
  protected readonly current = signal<Row | null>(null);
  protected readonly agencies = signal<Person[]>([]);
  protected readonly modalError = signal('');
  protected agencyId = '';
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
      if (keepPage) this.pager.go(page);
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
