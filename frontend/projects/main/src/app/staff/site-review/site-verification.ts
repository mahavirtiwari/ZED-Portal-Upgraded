import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { text } from '../assessment/assessment-shared';
import { Row, SiteReviewApi } from './site-review.api';
import { ListSearchComponent, PagedView, PagerComponent, searchRows } from '../pager';
import { TextPipe } from '../../content/page-text';

/**
 * "SA Verification": the site assessor's units in NC or quality check, each opening the site assessment
 * page. Port of Views/Assessment/SiteVerification.cshtml (GetList, allotment type SA). Its Accept/Reject
 * pop-ups had no button opening them and are not ported; the old menu entry was commented out.
 */
@Component({
  selector: 'zed-staff-site-verification',
  imports: [RouterLink, PagerComponent, ListSearchComponent, TextPipe],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ 'SA Verification' | t: 'staff.siteVerification.title' }}</h3>
        <p class="page-sub">{{ 'Your site assessments in non-conformance or quality check; open one to assess it.' | t: 'staff.siteVerification.sub' }}</p>
      </div>
      <div class="page-actions"><button type="button" class="btn btn-default" (click)="load()">{{ 'Refresh Data' | t: 'staff.siteVerification.refreshButton' }}</button></div>
    </div>
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
    <zed-list-search [(value)]="search" [placeholder]="'Search units' | t: 'staff.siteVerification.search.placeholder'" inputId="sv-search" [found]="view.total()" />
    <div class="table-responsive">
      <table class="table table-zed table-bordered">
        <thead>
          <tr>
            <th class="text-center" style="width: 60px">{{ 'S.No.' | t: 'staff.siteVerification.column.serial' }}</th><th class="text-center" style="width: 110px"></th><th class="text-center">{{ 'ZedId' | t: 'staff.siteVerification.column.zedId' }}</th><th class="text-center">{{ 'Certification Level' | t: 'staff.siteVerification.column.level' }}</th>
            <th>{{ 'Assessment Agency' | t: 'staff.siteVerification.column.agency' }}</th><th>{{ 'Unit Name' | t: 'staff.siteVerification.column.unitName' }}</th><th>{{ 'Unit Address' | t: 'staff.siteVerification.column.address' }}</th><th class="text-center">{{ 'State' | t: 'staff.siteVerification.column.state' }}</th><th>{{ 'Reason For Rejection' | t: 'staff.siteVerification.column.reason' }}</th>
          </tr>
        </thead>
        <tbody>
          @for (s of view.page(); track $index) {
            <tr>
              <td class="text-center">{{ view.serial($index) }}</td>
              <td class="text-center"><div class="row-actions justify-content-center"><a class="btn btn-primary" [routerLink]="['/staff/assessment/sa-details', col(s, 'ZedId'), col(s, 'Certification')]">{{ 'Assess' | t: 'staff.siteVerification.assessButton' }}</a></div></td>
              <td class="text-center"><strong class="dash-text-clr">{{ col(s, 'ZedId') }}</strong></td>
              <td class="text-center"><strong>{{ col(s, 'Certification') }}</strong></td>
              <td>{{ col(s, 'CertificationBodyUserId') }}<br />{{ col(s, 'AssessorName') }}</td>
              <td><strong>{{ col(s, 'EnterpriseName') }}</strong></td>
              <td>{{ col(s, 'UnitAddress') }}</td>
              <td class="text-center">{{ col(s, 'StateName') }}</td>
              <td>{{ col(s, 'DesktopReasonForRejection') }}</td>
            </tr>
          } @empty {
            @if (!loading()) { <tr><td colspan="9" style="padding: 0"><div class="no-data">{{ 'No records found.' | t: 'staff.siteVerification.empty' }}</div></td></tr> }
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="view" />
  `,
})
export class SiteVerificationPage {
  private readonly api = inject(SiteReviewApi);
  protected readonly col = text;
  protected readonly rows = signal<Row[]>([]);
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  /** The search box above the list (any column). */
  protected readonly search = signal('');
  protected readonly view = new PagedView(() => searchRows(this.rows(), this.search()));
  protected readonly loading = signal(false);
  protected readonly error = signal('');

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.rows.set((await firstValueFrom(this.api.siteVerification())).rows ?? []);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
