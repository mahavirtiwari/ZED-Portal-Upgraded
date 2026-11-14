import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ClientPager, PagerComponent } from '../pager';
import { STATES, flag, num, text, useLegacyPortal } from './assessment-shared';
import { AssessmentApi, ListFilter, Row } from './assessment.api';
import { levelOptions } from '../../msme/shared/levels';

/**
 * Desktop assessor: records with an open non-conformance round (DA status 4, site assessment status 14).
 * Port of Views/Assessment/NonConfirmances.cshtml (Assessment/GetList 'NC'). Bronze records open the
 * desktop assessment page; Silver/Gold the site assessment page of the current portal. The old page also
 * showed Accept/Reject buttons here, but records in this list are always accepted already, so they are omitted.
 */
@Component({
  selector: 'zed-staff-non-conformances',
  imports: [FormsModule, RouterLink, PagerComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Non-Conformances</h3>
        <p class="page-sub">Assessments with an open non-conformance round, waiting for the MSME's closure or your review.</p>
      </div>
    </div>

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }

    <div class="zed-card">
      <div class="filter-bar">
        <div class="filter">
          <label class="form-label" for="ncState">State</label>
          <select class="form-select" id="ncState" [(ngModel)]="filter.state" (ngModelChange)="load()">
            <option value="">Show All</option>
            @for (s of states; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }
          </select>
        </div>
        <div class="filter">
          <label class="form-label" for="ncLevel">Certification Level</label>
          <select class="form-select" id="ncLevel" [(ngModel)]="filter.certification" (ngModelChange)="load()">
            <option value="">Show All</option>
            @for (l of levels(); track l.value) { <option [value]="l.value">{{ l.label }}</option> }
          </select>
        </div>
        <div class="filter">
          <label class="form-label" for="ncSize">MSME Size</label>
          <select class="form-select" id="ncSize" [(ngModel)]="filter.size" (ngModelChange)="load()">
            <option value="">Show All</option>
            <option value="Micro">Micro</option>
            <option value="Small">Small</option>
            <option value="Medium">Medium</option>
          </select>
        </div>
        <div class="filter">
          <label class="form-label" for="ncGender">Gender</label>
          <select class="form-select" id="ncGender" [(ngModel)]="filter.gender" (ngModelChange)="load()">
            <option value="">Show All</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="Others">Others</option>
          </select>
        </div>
        <div class="filter wide">
          <label class="form-label" for="ncSearch">Search</label>
          <input type="search" id="ncSearch" class="form-control" maxlength="50" [ngModel]="pager.search()" (ngModelChange)="pager.setSearch($event)" />
        </div>
      </div>
    </div>

    <div class="table-responsive">
      <table class="table table-zed table-bordered">
        <thead>
          <tr>
            <th class="text-center" style="width: 60px">S.No.</th>
            <th class="text-center" style="width: 140px">Action(s)</th>
            <th class="text-center">Certification Level</th>
            <th>Unit Details</th>
            <th>Unit SPOC Details</th>
            <th>Agency Details</th>
            <th class="text-center">Mode of Assessment</th>
          </tr>
        </thead>
        <tbody>
          @for (s of pager.page(); track t(s, 'ZedId') + t(s, 'Certification')) {
            <tr [class.table-danger]="n(s, 'NcStatus') === 2 && (n(s, 'CertificationStatus') === 4 || n(s, 'CertificationStatus') === 14)">
              <td class="text-center">{{ t(s, 'RowNumber') }}</td>
              <td class="text-center">
                <div class="row-actions justify-content-center">
                  @if (legacy.profile(t(s, 'ZedId')); as href) {
                    <a [href]="href" class="btn btn-outline-primary">View Profile</a>
                  }
                  @if (f(s, 'DesktopAccepted')) {
                    @if (t(s, 'Certification') === 'Bronze') {
                      <a [routerLink]="['/staff/assessment/da-details', t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-primary">ASSESS</a>
                    } @else {
                      <a [routerLink]="['/staff/assessment/sa-details', t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-primary">ASSESS</a>
                    }
                  }
                </div>
              </td>
              <td class="text-center"><strong>{{ t(s, 'Certification') }}</strong></td>
              <td class="unit">
                <strong class="dash-text-clr">{{ t(s, 'ZedId') }}</strong>
                <div><strong>{{ t(s, 'PUnitName') }}</strong></div>
                <div class="muted">{{ t(s, 'UnitAddress') }}</div>
              </td>
              <td><strong>{{ t(s, 'UnitSpocName') }}</strong><div>{{ t(s, 'UnitSpocMobileNo') }}</div><div class="muted">{{ t(s, 'UnitSpocEmailId') }}</div></td>
              <td><strong>{{ t(s, 'AgencyName') }}</strong><div class="muted">{{ t(s, 'CertificationBodyUserId') }}</div></td>
              <td class="text-center">
                @switch (t(s, 'ModeOfAssessment')) {
                  @case ('Remote Assessment') { <span class="zed-chip">Remote</span> }
                  @case ('Onsite Assessment') { <span class="zed-chip">Onsite</span> }
                  @case ('') { <span class="zed-chip">Desktop</span> }
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="7" style="padding: 0"><div class="no-data">No Data</div></td></tr>
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="pager" />

    @if (loading()) {
      <div class="loadingdiv" style="display: block" role="status" aria-live="polite">
        <div class="loadingimage"><div class="loader"></div><div class="text-center"><small>Please wait ...</small></div></div>
      </div>
    }
  `,
  styles: `.unit { min-width: 200px; }`,
})
export class NonConformancesPage {
  private readonly api = inject(AssessmentApi);
  protected readonly legacy = useLegacyPortal();
  protected readonly states = STATES;
  /** Every level, the Admin's too (Administration → Certification Levels, 2026-11-08). */
  protected readonly levels = computed(() => levelOptions());
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
