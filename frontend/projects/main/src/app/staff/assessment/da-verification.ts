import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ASSESSMENT_SYSTEM, flag, num, text, useLegacyPortal } from './assessment-shared';
import { AssessmentApi, Row } from './assessment.api';
import { PagedView, PagerComponent } from '../pager';

/**
 * Desktop assessor: units allotted for desktop verification — accept/reject, then assess. Port of
 * Views/Assessment/DaVerification.cshtml (Assessment/GetList, AcceptUnitForDaVerification,
 * RejectUnitForDaVerification).
 * Surveillance ("Surveillance Assessments", Bronze): the agency's allotment is already accepted; units are listed from
 * status 1, while the assessor captures the unit in the Surveillance app, and are verified here after its final submit.
 */
@Component({
  selector: 'zed-staff-da-verification',
  imports: [FormsModule, RouterLink, PagerComponent],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="row">
        <div class="col-sm-12">
          <div class="zed-tabs">
            <div class="tab-content">
              <div class="d-flex align-items-center justify-content-between mb-1">
                <h3 class="registration-title">{{ surveillance ? 'Surveillance Assessments' : 'Desktop Verification' }}</h3>
                <button type="button" class="refresh-link btn btn-link" (click)="load()">
                  <img src="Images/svgicons/refresh.svg" alt="" /> <span>REFRESH</span>
                </button>
              </div>

              @if (notice(); as n) {
                <div class="alert alert-dismissible" [class.alert-success]="n.ok" [class.alert-danger]="!n.ok" role="status">
                  {{ n.text }}
                  <button type="button" class="btn-close" aria-label="Close" (click)="notice.set(null)"></button>
                </div>
              }

              <div class="table-responsive">
                <table class="table table-zed table-bordered">
                  <thead>
                    <tr>
                      <th>Action(s)</th>
                      <th>Certification Level</th>
                      <th>Unit Details</th>
                      <th>Unit SPOC Details</th>
                      <th>Agency Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (s of view.page(); track t(s, 'ZedId') + t(s, 'Certification')) {
                      <tr>
                        <td>
                          @if (legacy.profile(t(s, 'ZedId')); as href) {
                            <a [href]="href" class="btn btn-primary mb-2">View Profile</a>
                          }
                          @if (!f(s, 'DesktopAccepted') && !t(s, 'DesktopReasonForRejection')) {
                            <button type="button" class="btn btn-primary btn-xs me-1" (click)="acceptFor.set(s); modalError.set('')">ACCEPT</button>
                            <button type="button" class="btn btn-default btn-xs" (click)="openReject(s)">REJECT</button>
                          }
                          @if (f(s, 'DesktopAccepted')) {
                            <a [routerLink]="['/staff/assessment/da-details', t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-primary btn-xs">ASSESS</a>
                            @if (surveillance && nm(s, 'CertificationStatus') < 2) {
                              <br /><small class="text-danger">Pending in the Surveillance app</small>
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
                      </tr>
                    } @empty {
                      <tr><td colspan="5" style="padding: 0"><div class="no-data">No Data</div></td></tr>
                    }
                  </tbody>
                </table>
              </div>
              <zed-pager [pager]="view" />
            </div>
          </div>
        </div>
      </div>
    </div>

    @if (acceptFor(); as c) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="dvAcceptTitle">
        <div class="modal-dialog modal-popup">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title" id="dvAcceptTitle">Accept Assessment</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="acceptFor.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <div class="modal-body">
              <strong>Are you sure you want to accept Unit for Desktop Verification?</strong>
              <p class="mt-2">{{ t(c, 'ZedId') }} · {{ t(c, 'Certification') }}</p>
              @if (modalError()) { <div class="alert alert-danger" role="alert">{{ modalError() }}</div> }
            </div>
            <div class="modal-footer">
              <input type="button" class="btn btn-default" value="CANCEL" (click)="acceptFor.set(null)" />
              <input type="button" class="btn btn-primary" value="ACCEPT" [disabled]="busy()" (click)="accept()" />
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }

    @if (rejectFor()) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="dvRejectTitle">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <strong id="dvRejectTitle">Reject Assessment</strong>
                <button type="button" class="close btn btn-link" aria-label="Close" (click)="rejectFor.set(null)"><strong>x&nbsp;</strong></button>
              </div>
            </div>
            <div class="modal-body">
              <label for="dvRejectReason"><strong>Reason for Rejection<span style="color: red">*</span></strong></label>
              <textarea id="dvRejectReason" class="form-control" maxlength="2000" style="max-width: 100%" [(ngModel)]="reason"></textarea>
              @if (modalError()) { <div class="alert alert-danger mt-2" role="alert">{{ modalError() }}</div> }
            </div>
            <div class="modal-footer">
              <input type="button" class="btn btn-default" value="CANCEL" (click)="rejectFor.set(null)" />
              <input type="button" class="btn btn-primary" value="REJECT" [disabled]="busy()" (click)="reject()" />
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
export class DaVerificationPage {
  private readonly api = inject(AssessmentApi);
  protected readonly legacy = useLegacyPortal();
  protected readonly t = text;
  protected readonly f = flag;
  protected readonly nm = num;
  protected readonly surveillance = inject(ASSESSMENT_SYSTEM) === 'surveillance';

  protected readonly rows = signal<Row[]>([]);
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly view = new PagedView(() => this.rows());
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly notice = signal<{ ok: boolean; text: string } | null>(null);
  protected readonly acceptFor = signal<Row | null>(null);
  protected readonly rejectFor = signal<Row | null>(null);
  protected readonly modalError = signal('');
  protected reason = '';

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.rows.set((await firstValueFrom(this.api.daVerification())).rows);
    } catch (err) {
      this.notice.set({ ok: false, text: apiErrorMessage(err) });
    } finally {
      this.loading.set(false);
    }
  }

  protected openReject(s: Row): void {
    this.reason = '';
    this.modalError.set('');
    this.rejectFor.set(s);
  }

  protected async accept(): Promise<void> {
    const s = this.acceptFor();
    if (s) await this.run(() => this.api.assessorAccept(text(s, 'ZedId'), text(s, 'Certification')), () => this.acceptFor.set(null));
  }

  protected async reject(): Promise<void> {
    const s = this.rejectFor();
    if (!s) return;
    if (!this.reason.trim()) {
      this.modalError.set('Please enter reason for rejection.');
      return;
    }
    await this.run(() => this.api.assessorReject(text(s, 'ZedId'), text(s, 'Certification'), this.reason.trim()), () => this.rejectFor.set(null));
  }

  private async run(call: () => ReturnType<AssessmentApi['assessorAccept']>, close: () => void): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(call());
      close();
      this.notice.set({ ok: true, text: 'Success!' });
      await this.load();
    } catch (err) {
      this.modalError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
