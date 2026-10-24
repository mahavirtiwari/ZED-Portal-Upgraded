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
    <div class="container form-page" id="zed_user_form">
      <div class="text-center mt-4"><h3 style="font-weight: 600">SA Verification</h3></div>
      <div class="text-end mb-2"><button type="button" class="btn btn-default" (click)="load()">Refresh Data</button></div>
      @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
      <div class="table-responsive">
        <table class="table table-striped">
          <thead>
            <tr><th>S.No.</th><th></th><th>ZedId</th><th>Certification Level</th><th>Assessment Agency</th><th>Unit Name</th><th>Unit Address</th><th>State</th><th>Reason For Rejection</th></tr>
          </thead>
          <tbody>
            @for (s of view.page(); track $index) {
              <tr>
                <td>{{ view.serial($index) }}</td>
                <td><a class="btn btn-primary btn-xs" [routerLink]="['/staff/assessment/sa-details', t(s, 'ZedId'), t(s, 'Certification')]">ASSESS</a></td>
                <td>{{ t(s, 'ZedId') }}</td>
                <td>{{ t(s, 'Certification') }}</td>
                <td>{{ t(s, 'CertificationBodyUserId') }}</td>
                <td>{{ t(s, 'EnterpriseName') }}</td>
                <td>{{ t(s, 'UnitAddress') }}</td>
                <td>{{ t(s, 'StateName') }}</td>
                <td>{{ t(s, 'DesktopReasonForRejection') }}</td>
              </tr>
            } @empty {
              @if (!loading()) { <tr><td colspan="9" class="text-center">No records found.</td></tr> }
            }
          </tbody>
        </table>
      </div>
      <zed-pager [pager]="view" />
    </div>
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
