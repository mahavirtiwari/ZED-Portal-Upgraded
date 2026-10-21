import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ClientPager, STATES, flag, num, text, useLegacyPortal } from './assessment-shared';
import { AssessmentApi, ListFilter, Row } from './assessment.api';
import { ListPager } from './list-pager';

/**
 * Desktop assessor: records with an open non-conformance round (DA status 4, site assessment status 14).
 * Port of Views/Assessment/NonConfirmances.cshtml (Assessment/GetList 'NC'). Bronze records open the
 * desktop assessment page; Silver/Gold the site assessment page of the current portal. The old page also
 * showed Accept/Reject buttons here, but records in this list are always accepted already, so they are omitted.
 */
@Component({
  selector: 'zed-staff-non-conformances',
  imports: [FormsModule, RouterLink, ListPager],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="row mt-4">
        <div class="col-sm-12"><h3 class="registration-title">Non-Conformances</h3></div>

        @if (error()) {
          <div class="col-sm-12"><div class="alert alert-danger" role="alert">{{ error() }}</div></div>
        }

        <div class="col-sm-12 mb-4">
          <div class="d-flex flex-wrap gap-2">
            <div>
              <label for="ncState"><strong>State</strong></label>
              <select class="form-select" style="width: 200px" id="ncState" [(ngModel)]="filter.state" (ngModelChange)="load()">
                <option value="">Show All</option>
                @for (s of states; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }
              </select>
            </div>
            <div>
              <label for="ncLevel"><strong>Certification Level</strong></label>
              <select class="form-select" style="width: 200px" id="ncLevel" [(ngModel)]="filter.certification" (ngModelChange)="load()">
                <option value="">Show All</option>
                <option value="Bronze">Bronze</option>
                <option value="Silver">Silver</option>
                <option value="Gold">Gold</option>
              </select>
            </div>
            <div>
              <label for="ncSize"><strong>MSME Size</strong></label>
              <select class="form-select" style="width: 200px" id="ncSize" [(ngModel)]="filter.size" (ngModelChange)="load()">
                <option value="">Show All</option>
                <option value="Micro">Micro</option>
                <option value="Small">Small</option>
                <option value="Medium">Medium</option>
              </select>
            </div>
            <div>
              <label for="ncGender"><strong>Gender</strong></label>
              <select class="form-select" style="width: 200px" id="ncGender" [(ngModel)]="filter.gender" (ngModelChange)="load()">
                <option value="">Show All</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="Others">Others</option>
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
                  <th>S.No.</th>
                  <th>Action(s)</th>
                  <th>Certification Level</th>
                  <th>Unit Details</th>
                  <th>Unit SPOC Details</th>
                  <th>Agency Details</th>
                  <th>Mode of Assessment</th>
                </tr>
              </thead>
              <tbody>
                @for (s of pager.page(); track t(s, 'ZedId') + t(s, 'Certification')) {
                  <tr [class.table-danger]="n(s, 'NcStatus') === 2 && (n(s, 'CertificationStatus') === 4 || n(s, 'CertificationStatus') === 14)">
                    <td>{{ t(s, 'RowNumber') }}</td>
                    <td>
                      @if (legacy.profile(t(s, 'ZedId')); as href) {
                        <a style="width: 120px" [href]="href" class="btn btn-primary mb-2">View Profile</a>
                      }
                      @if (f(s, 'DesktopAccepted')) {
                        @if (t(s, 'Certification') === 'Bronze') {
                          <a [routerLink]="['/staff/assessment/da-details', t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-primary btn-xs">ASSESS</a>
                        } @else {
                          <a [routerLink]="['/staff/assessment/sa-details', t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-primary btn-xs">ASSESS</a>
                        }
                      }
                    </td>
                    <td>{{ t(s, 'Certification') }}</td>
                    <td>
                      <strong class="dash-text-clr">{{ t(s, 'ZedId') }}</strong><br />
                      <strong>{{ t(s, 'PUnitName') }}</strong><br />
                      {{ t(s, 'UnitAddress') }}
                    </td>
                    <td><strong>{{ t(s, 'UnitSpocName') }}</strong><br />{{ t(s, 'UnitSpocMobileNo') }}<br />{{ t(s, 'UnitSpocEmailId') }}</td>
                    <td><strong>{{ t(s, 'AgencyName') }}</strong><br />{{ t(s, 'CertificationBodyUserId') }}</td>
                    <td>
                      @switch (t(s, 'ModeOfAssessment')) {
                        @case ('Remote Assessment') { Remote }
                        @case ('Onsite Assessment') { Onsite }
                        @case ('') { Desktop }
                      }
                    </td>
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

    @if (loading()) {
      <div class="loadingdiv" style="display: block" role="status" aria-live="polite">
        <div class="loadingimage"><div class="loader"></div><div class="text-center"><small>Please wait ...</small></div></div>
      </div>
    }
  `,
})
export class NonConformancesPage {
  private readonly api = inject(AssessmentApi);
  protected readonly legacy = useLegacyPortal();
  protected readonly states = STATES;
  protected readonly t = text;
  protected readonly f = flag;
  protected readonly n = num;

  protected filter: Required<Omit<ListFilter, 'allotmentType'>> = { state: '', certification: '', size: '', gender: '' };
  protected readonly pager = new ClientPager();
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  private request = 0;

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    const request = ++this.request;
    this.loading.set(true);
    this.error.set('');
    try {
      const res = await firstValueFrom(this.api.nonConformances(this.filter));
      if (request === this.request) this.pager.set(res.rows);
    } catch (err) {
      if (request === this.request) this.error.set(apiErrorMessage(err));
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }
}
