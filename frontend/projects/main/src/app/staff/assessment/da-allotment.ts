import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ASSESSMENT_SYSTEM, flag, num, text, useLegacyPortal } from './assessment-shared';
import { AssessmentApi, Person, Row } from './assessment.api';
import { PagedView, PagerComponent } from '../pager';

/**
 * Agency (desktop verification): allot its MSMEs to its desktop assessors, or reject them. Port of
 * Views/Assessment/DaAllotment.cshtml (Assessment/GetList 'DA', AcceptUnitForDa, RejectUnitForDa).
 * Surveillance ("Allot Surveillance Assessments", Bronze): one assessor list; allotting needs no acceptance by the
 * assessor, and the unit can be re-allotted until the assessor starts it in the Surveillance app (status 1).
 */
@Component({
  selector: 'zed-staff-da-allotment',
  imports: [FormsModule, PagerComponent],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="Dashboard-msme">
        <div class="row">
          <div class="col-sm-10"><h3 class="registration-title">{{ surveillance ? 'Allot Surveillance Assessments' : 'Allot DA Assessments' }}</h3></div>
          <div class="col-sm-2">
            <button type="button" class="refresh-link btn btn-link" (click)="load()">
              <img src="Images/svgicons/refresh.svg" alt="" /> <span>Refresh Data</span>
            </button>
          </div>
        </div>

        @if (notice(); as n) {
          <div class="alert alert-dismissible" [class.alert-success]="n.ok" [class.alert-danger]="!n.ok" role="status">
            {{ n.text }}
            <button type="button" class="btn-close" aria-label="Close" (click)="notice.set(null)"></button>
          </div>
        }

        <div class="row">
          <div class="col-sm-12">
            <div class="table-responsive">
              <table class="table table-bordered table-zed">
                <thead>
                  <tr>
                    <th>Action(s)</th>
                    <th>Status</th>
                    <th>Certification Level</th>
                    <th>Unit Details</th>
                    <th>SPOC Details</th>
                    <th>Assessor Details</th>
                    <th>Reason For Rejection</th>
                  </tr>
                </thead>
                <tbody>
                  @for (s of view.page(); track t(s, 'ZedId') + t(s, 'Certification')) {
                    <tr>
                      <td>
                        @if (legacy.profile(t(s, 'ZedId')); as href) {
                          <a style="width: 180px" [href]="href" class="btn btn-primary mb-2">View Profile</a>
                        }
                        @if (!t(s, 'DesktopAssessorId') && !t(s, 'ReasonForRejection')) {
                          <button type="button" class="btn btn-primary btn-xs me-1" (click)="openAllot(s)">ACCEPT</button>
                        }
                        @if (!t(s, 'DesktopAssessorId') || t(s, 'DesktopReasonForRejection')) {
                          <button type="button" class="btn btn-default btn-xs me-1" (click)="openReject(s)">REJECT</button>
                        }
                        @if (canReallot(s)) {
                          <button type="button" class="btn btn-primary btn-xs" (click)="openAllot(s)">RE-ALLOT</button>
                        }
                      </td>
                      <td>
                        @if (t(s, 'DesktopReasonForRejection')) { <small class="text-danger">ASSESSOR REJECTED</small> }
                        @if (!t(s, 'DesktopReasonForRejection') && t(s, 'DesktopAssessorId') && (surveillance || !f(s, 'DesktopAccepted'))) {
                          <small class="text-danger">ALLOTED TO ASSESSOR</small>
                        }
                        @if (!t(s, 'DesktopAssessorId')) { <small>Allotment Pending</small> }
                      </td>
                      <td><strong>{{ t(s, 'Certification') }}</strong></td>
                      <td>
                        <strong class="dash-text-clr">{{ t(s, 'ZedId') }}</strong><br />
                        <strong>{{ t(s, 'PUnitName') }}</strong><br />
                        {{ t(s, 'UnitAddress') }}
                      </td>
                      <td><strong>{{ t(s, 'UnitSpocName') }}</strong><br />{{ t(s, 'UnitSpocMobileNo') }}<br />{{ t(s, 'UnitSpocEmailId') }}</td>
                      <td>
                        <strong>{{ t(s, 'DaAssessorName') }}</strong><br />{{ t(s, 'DesktopAssessorId') }}
                        @if (surveillance && (t(s, 'LeadInCertification') || t(s, 'CoInCertification'))) {
                          <br /><br /><small>Original certification: {{ t(s, 'LeadInCertification') }}@if (t(s, 'CoInCertification')) { / {{ t(s, 'CoInCertification') }} }</small>
                        }
                      </td>
                      <td>{{ t(s, 'DesktopReasonForRejection') }}</td>
                    </tr>
                  } @empty {
                    <tr><td colspan="7" style="padding: 0"><div class="no-data">No Data</div></td></tr>
                  }
                </tbody>
              </table>
            </div>
            <zed-pager [pager]="view" />
          </div>
        </div>
      </div>
    </div>

    @if (allotFor(); as c) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="daAllotTitle">
        <div class="modal-dialog modal-popup">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title" id="daAllotTitle">Accept Assessment</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="allotFor.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <div class="modal-body">
              <p>{{ t(c, 'ZedId') }} · {{ t(c, 'Certification') }}</p>
              <label for="daAssessor"><strong>Assessor<span style="color: red">*</span></strong></label>
              <select id="daAssessor" class="form-control" [(ngModel)]="assessorId">
                <option value="">--Select--</option>
                @for (a of assessorsFor(c); track a.userId) { <option [value]="a.userId">{{ a.userName }}</option> }
              </select>
              @if (modalError()) { <div class="alert alert-danger mt-2" role="alert">{{ modalError() }}</div> }
            </div>
            <div class="modal-footer">
              <input type="button" class="btn btn-default" value="CANCEL" (click)="allotFor.set(null)" />
              <input type="button" class="btn btn-primary" value="ACCEPT" [disabled]="busy()" (click)="allot()" />
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }

    @if (rejectFor(); as c) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="daRejectTitle">
        <div class="modal-dialog modal-popup">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title" id="daRejectTitle">Reject Assessment</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="rejectFor.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <div class="modal-body">
              <label for="daRejectReason"><strong>Reason for Rejection<span style="color: red">*</span></strong></label>
              <textarea id="daRejectReason" class="form-control" maxlength="2000" style="max-width: 100%; height: 100px" [(ngModel)]="reason"></textarea>
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
export class DaAllotmentPage {
  private readonly api = inject(AssessmentApi);
  protected readonly legacy = useLegacyPortal();
  protected readonly t = text;
  protected readonly f = flag;
  protected readonly surveillance = inject(ASSESSMENT_SYSTEM) === 'surveillance';

  protected readonly rows = signal<Row[]>([]);
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly view = new PagedView(() => this.rows());
  private readonly assessors = signal<Person[]>([]);
  private readonly bronzeAssessors = signal<Person[]>([]);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly notice = signal<{ ok: boolean; text: string } | null>(null);
  protected readonly allotFor = signal<Row | null>(null);
  protected readonly rejectFor = signal<Row | null>(null);
  protected readonly modalError = signal('');
  protected assessorId = '';
  protected reason = '';

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(this.api.daAllotment());
      this.rows.set(res.rows);
      this.assessors.set(res.assessors);
      this.bronzeAssessors.set(res.bronzeAssessors);
    } catch (err) {
      this.notice.set({ ok: false, text: apiErrorMessage(err) });
    } finally {
      this.loading.set(false);
    }
  }

  /** Bronze goes to the agency's Bronze assessors, other levels to its other desktop assessors. */
  protected assessorsFor(s: Row): Person[] {
    return text(s, 'Certification') === 'Bronze' ? this.bronzeAssessors() : this.assessors();
  }

  /**
   * Main: after the assessor rejected, or while it has not accepted. Surveillance: any allotted unit the assessor has
   * not started in the app (the list holds only those, status 1).
   */
  protected canReallot(s: Row): boolean {
    if (!text(s, 'DesktopAssessorId')) return false;
    return this.surveillance ? num(s, 'CertificationStatus') < 2 : !!text(s, 'DesktopReasonForRejection') || !flag(s, 'DesktopAccepted');
  }

  protected openAllot(s: Row): void {
    this.assessorId = '';
    this.modalError.set('');
    this.allotFor.set(s);
  }

  protected openReject(s: Row): void {
    this.reason = '';
    this.modalError.set('');
    this.rejectFor.set(s);
  }

  protected async allot(): Promise<void> {
    const s = this.allotFor();
    if (!s) return;
    if (!this.assessorId) {
      this.modalError.set('Please select valid data.');
      return;
    }
    await this.run(() => this.api.allotToAssessor(text(s, 'ZedId'), text(s, 'Certification'), this.assessorId), () => this.allotFor.set(null));
  }

  protected async reject(): Promise<void> {
    const s = this.rejectFor();
    if (!s) return;
    if (!this.reason.trim()) {
      this.modalError.set('Please enter reason for rejection.');
      return;
    }
    await this.run(() => this.api.agencyReject(text(s, 'ZedId'), text(s, 'Certification'), this.reason.trim()), () => this.rejectFor.set(null));
  }

  private async run(call: () => ReturnType<AssessmentApi['agencyReject']>, close: () => void): Promise<void> {
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
