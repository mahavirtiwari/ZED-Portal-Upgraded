import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { text } from '../assessment/assessment-shared';
import { Row, SiteReviewApi } from './site-review.api';
import { PagedView, PagerComponent } from '../pager';

/**
 * "SA Verification": the site assessor's units in NC or quality check, each opening the site assessment
 * page. Port of Views/Assessment/SiteVerification.cshtml (GetList, allotment type SA). Its Accept/Reject
 * pop-ups had no button opening them and are not ported; the old menu entry was commented out.
 */
@Component({
  selector: 'zed-staff-site-verification',
  imports: [RouterLink, PagerComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">SA Verification</h3>
        <p class="page-sub">Your site assessments in non-conformance or quality check; open one to assess it.</p>
      </div>
      <div class="page-actions"><button type="button" class="btn btn-default" (click)="load()">Refresh Data</button></div>
    </div>
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
    <div class="table-responsive">
      <table class="table table-zed table-bordered">
        <thead>
          <tr>
            <th class="text-center" style="width: 60px">S.No.</th><th class="text-center" style="width: 110px"></th><th class="text-center">ZedId</th><th class="text-center">Certification Level</th>
            <th>Assessment Agency</th><th>Unit Name</th><th>Unit Address</th><th class="text-center">State</th><th>Reason For Rejection</th>
          </tr>
        </thead>
        <tbody>
          @for (s of view.page(); track $index) {
            <tr>
              <td class="text-center">{{ view.serial($index) }}</td>
              <td class="text-center"><div class="row-actions justify-content-center"><a class="btn btn-primary" [routerLink]="['/staff/assessment/sa-details', t(s, 'ZedId'), t(s, 'Certification')]">ASSESS</a></div></td>
              <td class="text-center"><strong class="dash-text-clr">{{ t(s, 'ZedId') }}</strong></td>
              <td class="text-center"><strong>{{ t(s, 'Certification') }}</strong></td>
              <td>{{ t(s, 'CertificationBodyUserId') }}<br />{{ t(s, 'AssessorName') }}</td>
              <td><strong>{{ t(s, 'EnterpriseName') }}</strong></td>
              <td>{{ t(s, 'UnitAddress') }}</td>
              <td class="text-center">{{ t(s, 'StateName') }}</td>
              <td>{{ t(s, 'DesktopReasonForRejection') }}</td>
            </tr>
          } @empty {
            @if (!loading()) { <tr><td colspan="9" style="padding: 0"><div class="no-data">No records found.</div></td></tr> }
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="view" />
  `,
})
export class SiteVerificationPage {
  private readonly api = inject(SiteReviewApi);
  protected readonly t = text;
  protected readonly rows = signal<Row[]>([]);
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly view = new PagedView(() => this.rows());
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
