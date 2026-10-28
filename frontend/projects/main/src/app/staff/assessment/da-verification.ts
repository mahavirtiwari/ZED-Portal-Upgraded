import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ContentTextComponent } from '../../content/content-text';
import { ASSESSMENT_SYSTEM, flag, num, text, useLegacyPortal } from './assessment-shared';
import { AssessmentApi, Row } from './assessment.api';
import { ListSearchComponent, PagedView, PagerComponent, searchRows } from '../pager';

/**
 * Desktop assessor: units allotted for desktop verification — accept/reject, then assess. Port of
 * Views/Assessment/DaVerification.cshtml (Assessment/GetList, AcceptUnitForDaVerification,
 * RejectUnitForDaVerification).
 * Surveillance ("Surveillance Assessments", Bronze): the agency's allotment is already accepted; units are listed from
 * status 1, while the assessor captures the unit in the Surveillance app, and are verified here after its final submit.
 */
@Component({
  selector: 'zed-staff-da-verification',
  imports: [FormsModule, RouterLink, PagerComponent, ListSearchComponent, ContentTextComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ surveillance ? 'Surveillance Assessments' : 'Desktop Verification' }}</h3>
        <p class="page-sub">{{ surveillance ? 'Surveillance assessments allotted to you; verify them here after the final submit in the Surveillance app.' : 'Units allotted to you for desktop verification: accept or reject them, then assess.' }}</p>
      </div>
      <div class="page-actions">
        <button type="button" class="refresh-link btn btn-default" (click)="load()">
          <img src="Images/svgicons/refresh.svg" alt="" /> <span>REFRESH</span>
        </button>
      </div>
    </div>

    @if (notice(); as n) {
      <div class="alert alert-dismissible" [class.alert-success]="n.ok" [class.alert-danger]="!n.ok" role="status">
        {{ n.text }}
        <button type="button" class="btn-close" aria-label="Close" (click)="notice.set(null)"></button>
      </div>
    }

    <zed-list-search [(value)]="search" placeholder="Search units" inputId="da-ver-search" [found]="view.total()" />
    <div class="table-responsive">
      <table class="table table-zed table-bordered">
        <thead>
          <tr>
            <th class="text-center" style="width: 200px">Action(s)</th>
            <th class="text-center">Certification Level</th>
            <th>Unit Details</th>
            <th>Unit SPOC Details</th>
            <th>Agency Details</th>
          </tr>
        </thead>
        <tbody>
          @for (s of view.page(); track t(s, 'ZedId') + t(s, 'Certification')) {
            <tr>
              <td class="text-center">
                <div class="row-actions justify-content-center">
                  @if (legacy.profile(t(s, 'ZedId')); as href) {
                    <a [href]="href" class="btn btn-outline-primary">View Profile</a>
                  }
                  @if (!f(s, 'DesktopAccepted') && !t(s, 'DesktopReasonForRejection')) {
                    <button type="button" class="btn btn-primary" (click)="acceptFor.set(s); modalError.set('')">ACCEPT</button>
                    <button type="button" class="btn btn-outline-danger" (click)="openReject(s)">REJECT</button>
                  }
                  @if (f(s, 'DesktopAccepted')) {
                    <a [routerLink]="['/staff/assessment/da-details', t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-primary">ASSESS</a>
                  }
                </div>
                @if (f(s, 'DesktopAccepted') && surveillance && nm(s, 'CertificationStatus') < 2) {
                  <span class="status-badge is-pending mt-2">Pending in the Surveillance app</span>
                }
              </td>
              <td class="text-center"><strong>{{ t(s, 'Certification') }}</strong></td>
              <td class="unit">
                <strong class="dash-text-clr">{{ t(s, 'ZedId') }}</strong>
                <div><strong>{{ t(s, 'PUnitName') }}</strong></div>
                <div class="muted">{{ t(s, 'UnitAddress') }}</div>
              </td>
              <td><strong>{{ t(s, 'UnitSpocName') }}</strong><div>{{ t(s, 'UnitSpocMobileNo') }}</div><div class="muted">{{ t(s, 'UnitSpocEmailId') }}</div></td>
              <td><strong>{{ t(s, 'AgencyName') }}</strong><div class="muted">{{ t(s, 'CertificationBodyUserId') }}</div></td>
            </tr>
          } @empty {
            <tr><td colspan="5" style="padding: 0"><div class="no-data">No Data</div></td></tr>
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="view" />

    @if (acceptFor(); as c) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="dvAcceptTitle">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header justify-content-between">
              <div class="modal-title" id="dvAcceptTitle"><strong>Accept Assessment</strong></div>
              <button type="button" class="btn-close" aria-label="Close" (click)="acceptFor.set(null)"></button>
            </div>
            <div class="modal-body">
              <zed-text key="staff.desktopVerification.accept.confirm" [inline]="true" />
              <p class="muted mt-2 mb-0">{{ t(c, 'ZedId') }} · {{ t(c, 'Certification') }}</p>
              @if (modalError()) { <div class="alert alert-danger mt-2 mb-0" role="alert">{{ modalError() }}</div> }
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
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header justify-content-between">
              <div class="modal-title" id="dvRejectTitle"><strong>Reject Assessment</strong></div>
              <button type="button" class="btn-close" aria-label="Close" (click)="rejectFor.set(null)"></button>
            </div>
            <div class="modal-body">
              <label class="form-label" for="dvRejectReason">Reason for Rejection<span class="req">*</span></label>
              <textarea id="dvRejectReason" class="form-control" maxlength="2000" rows="4" [(ngModel)]="reason"></textarea>
              @if (modalError()) { <div class="alert alert-danger mt-2 mb-0" role="alert">{{ modalError() }}</div> }
            </div>
            <div class="modal-footer">
              <input type="button" class="btn btn-default" value="CANCEL" (click)="rejectFor.set(null)" />
              <input type="button" class="btn btn-danger" value="REJECT" [disabled]="busy()" (click)="reject()" />
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
  styles: `.unit { min-width: 200px; }`,
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
  /** The search box above the list (any column). */
  protected readonly search = signal('');
  protected readonly view = new PagedView(() => searchRows(this.rows(), this.search()));
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
