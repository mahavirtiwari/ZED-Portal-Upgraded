import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ClientPager, PagerComponent } from '../pager';
import { STATES, flag, num, text, useLegacyPortal } from './assessment-shared';
import { AssessmentApi, ListFilter, Row } from './assessment.api';
import { levelOptions } from '../../msme/shared/levels';
import { PageHead } from '../../msme/shared/page-head';
import { ListCount, ListCounts } from '../list-counts';

/**
 * Desktop assessor: records with an open non-conformance round (DA status 4, site assessment status 14).
 * Port of Views/Assessment/NonConfirmances.cshtml (Assessment/GetList 'NC'). Bronze records open the
 * desktop assessment page; Silver/Gold the site assessment page of the current portal. The old page also
 * showed Accept/Reject buttons here, but records in this list are always accepted already, so they are omitted.
 */
@Component({
  selector: 'zed-staff-non-conformances',
  imports: [FormsModule, RouterLink, PagerComponent, PageHead, ListCounts],
  host: { class: 'list-v2 d-block' },
  template: `
    <!-- 2026-11-14 (approved frame A): the shared header, the counts, the filters and the list in one card. -->
    <zed-page-head [crumbs]="[{ label: 'Home', link: '/staff' }, { label: 'Non-conformances' }]" title="Non-conformances">
      <button type="button" class="btn btn-outline-secondary btn-sm" (click)="load()"><img src="Images/svgicons/refresh.svg" alt="" /> Refresh</button>
    </zed-page-head>
    <zed-list-counts [counts]="counts()" />

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }

    <div class="list-card">
    <div class="list-card-head">
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
      <table class="table table-zed">
        <thead>
          <tr>
            <th style="width: 56px">S.No.</th>
            <th>Unit</th>
            <th>Level</th>
            <th>Unit SPOC</th>
            <th>Agency</th>
            <th>Mode</th>
            <th>Status</th>
            <th style="width: 140px"><span class="visually-hidden">Action(s)</span></th>
          </tr>
        </thead>
        <tbody>
          @for (s of pager.page(); track t(s, 'ZedId') + t(s, 'Certification')) {
            <tr [class.table-danger]="answered(s)" [class.is-answered]="answered(s)">
              <td>{{ t(s, 'RowNumber') }}</td>
              <td class="unit unit-cell">
                <b>{{ t(s, 'PUnitName') }}</b>
                <small><span class="dash-text-clr">{{ t(s, 'ZedId') }}</span> · {{ t(s, 'UnitAddress') }}</small>
              </td>
              <td><span [class]="'lv-tag lv-' + t(s, 'Certification').toLowerCase()">{{ t(s, 'Certification') }}</span></td>
              <td><b>{{ t(s, 'UnitSpocName') }}</b><span class="sub">{{ t(s, 'UnitSpocMobileNo') }}</span><span class="sub">{{ t(s, 'UnitSpocEmailId') }}</span></td>
              <td>{{ t(s, 'AgencyName') }}<span class="sub">{{ t(s, 'CertificationBodyUserId') }}</span></td>
              <td>
                @switch (t(s, 'ModeOfAssessment')) {
                  @case ('Remote Assessment') { <span class="zed-chip">Remote</span> }
                  @case ('Onsite Assessment') { <span class="zed-chip">Onsite</span> }
                  @case ('') { <span class="zed-chip">Desktop</span> }
                }
              </td>
              <td>
                @if (answered(s)) { <span class="chip is-warn">Answered: to review</span> } @else { <span class="chip">Waiting for the MSME</span> }
              </td>
              <td>
                <div class="row-actions">
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
            </tr>
          } @empty {
            <tr><td colspan="8" style="padding: 0"><div class="no-data">No Data</div></td></tr>
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="pager" />
    </div>

    @if (loading()) {
      <div class="loadingdiv" style="display: block" role="status" aria-live="polite">
        <div class="loadingimage"><div class="loader"></div><div class="text-center"><small>Please wait ...</small></div></div>
      </div>
    }
  `,
  styles: `
    .unit { min-width: 220px; }
    .list-card-head .filter-bar { width: 100%; margin: 0; }
    /* The MSME answered the round: a light tint in place of Bootstrap's red row. */
    tr.is-answered > td { background: #fffaf0 !important; }
  `,
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

  /** The MSME has answered the open round (NcStatus 2 at DA status 4 / site status 14): waiting for the assessor's review. */
  protected answered(s: Row): boolean {
    return num(s, 'NcStatus') === 2 && (num(s, 'CertificationStatus') === 4 || num(s, 'CertificationStatus') === 14);
  }

  protected readonly counts = computed<ListCount[]>(() => {
    const rows = this.pager.all();
    const answered = rows.filter((r) => this.answered(r)).length;
    return [
      { label: 'Open NC rounds', value: rows.length },
      { label: 'Answered: to review', value: answered, tone: 'warn' },
      { label: 'Waiting for the MSME', value: rows.length - answered },
    ];
  });

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
