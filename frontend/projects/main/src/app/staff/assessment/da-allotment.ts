import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ASSESSMENT_SYSTEM, Expanded, flag, num, text, useLegacyPortal } from './assessment-shared';
import { AssessmentApi, Person, Row, serves } from './assessment.api';
import { ListSearchComponent, PagedView, PagerComponent, searchRows } from '../pager';
import { mayAssess } from '../users/assessor-scope';

/**
 * Agency (desktop verification): allot its MSMEs to its desktop assessors, or reject them. Port of
 * Views/Assessment/DaAllotment.cshtml (Assessment/GetList 'DA', AcceptUnitForDa, RejectUnitForDa).
 * Surveillance ("Allot Surveillance Assessments", Bronze): one assessor list; allotting needs no acceptance by the
 * assessor, and the unit can be re-allotted until the assessor starts it in the Surveillance app (status 1).
 */
@Component({
  selector: 'zed-staff-da-allotment',
  imports: [FormsModule, PagerComponent, ListSearchComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ surveillance ? 'Allot Surveillance Assessments' : 'Allot DA Assessments' }}</h3>
        <p class="page-sub">{{ surveillance ? 'Allot the surveillance assessments to your assessors, or re-allot them until the assessor starts.' : 'Accept the MSMEs allotted to your agency and allot them to a desktop assessor, or reject them.' }}</p>
      </div>
      <div class="page-actions">
        <button type="button" class="refresh-link btn btn-default" (click)="load()">
          <img src="Images/svgicons/refresh.svg" alt="" /> <span>Refresh Data</span>
        </button>
      </div>
    </div>

    @if (surveillance) {
      <!-- That portal's DaAllotment.cshtml: an "Enter ZED ID" search box. -->
      <div class="filter-bar mb-3">
        <div class="filter wide">
          <div class="input-group">
            <input type="text" class="form-control" placeholder="Enter ZED ID" aria-label="Enter ZED ID" maxlength="50" [(ngModel)]="zedIdText" (keyup.enter)="searchZedId()" />
            <button type="button" class="btn btn-primary search-zed" aria-label="Search" (click)="searchZedId()"><i class="fa fa-search"></i></button>
          </div>
        </div>
      </div>
    }

    @if (notice(); as n) {
      <div class="alert alert-dismissible" [class.alert-success]="n.ok" [class.alert-danger]="!n.ok" role="status">
        {{ n.text }}
        <button type="button" class="btn-close" aria-label="Close" (click)="notice.set(null)"></button>
      </div>
    }

    <zed-list-search [(value)]="search" placeholder="Search units" inputId="da-allot-search" [found]="view.total()" />
    <div class="table-responsive">
      <table class="table table-bordered table-zed">
        <thead>
          <tr>
            <th class="text-center" style="width: 140px">Action(s)</th>
            <th class="text-center" style="width: 110px">Status</th>
            <th class="text-center">Certification Level</th>
            <th>Unit Details</th>
            <th>Unit SPOC Details</th>
            <th>Assessor Details</th>
            <th>Reason For Rejection</th>
          </tr>
        </thead>
        <tbody>
          @for (s of view.page(); track key(s)) {
            <tr>
              <td class="text-center">
                <div class="row-actions justify-content-center">
                  @if (legacy.profile(t(s, 'ZedId')); as href) {
                    <a [href]="href" class="btn btn-outline-primary">View Profile</a>
                  }
                  @if (!t(s, 'DesktopAssessorId') && !t(s, 'ReasonForRejection')) {
                    <button type="button" class="btn btn-primary" (click)="openAllot(s)">ACCEPT</button>
                  }
                  @if (!t(s, 'DesktopAssessorId') || t(s, 'DesktopReasonForRejection')) {
                    <button type="button" class="btn btn-outline-danger" (click)="openReject(s)">REJECT</button>
                  }
                  @if (canReallot(s)) {
                    <button type="button" class="btn btn-outline-primary" (click)="openAllot(s)">RE-ALLOT</button>
                  }
                </div>
              </td>
              <td class="text-center">
                @if (t(s, 'DesktopReasonForRejection')) { <span class="status-badge is-rejected">ASSESSOR REJECTED</span> }
                @if (!t(s, 'DesktopReasonForRejection') && t(s, 'DesktopAssessorId') && (surveillance || !f(s, 'DesktopAccepted'))) {
                  <span class="status-badge is-info">ALLOTED TO ASSESSOR</span>
                }
                @if (!t(s, 'DesktopAssessorId')) { <span class="status-badge is-pending">Allotment Pending</span> }
              </td>
              <td class="text-center"><strong>{{ t(s, 'Certification') }}</strong></td>
              <td class="unit">
                <strong class="dash-text-clr">{{ t(s, 'ZedId') }}</strong>
                <div><strong>{{ t(s, 'PUnitName') }}</strong></div>
                <div class="muted">{{ t(s, 'UnitAddress') }}</div>
              </td>
              <td><strong>{{ t(s, 'UnitSpocName') }}</strong><div>{{ t(s, 'UnitSpocMobileNo') }}</div><div class="muted">{{ t(s, 'UnitSpocEmailId') }}</div></td>
              <td><strong>{{ t(s, 'DaAssessorName') }}</strong><div class="muted">{{ t(s, 'DesktopAssessorId') }}</div></td>
              <td class="reason">
                @if (t(s, 'DesktopReasonForRejection'); as reason) {
                  <div [class.clamp-3]="!more.has(key(s))" [title]="reason">{{ reason }}</div>
                  @if (reason.length > 120) {
                    <button type="button" class="btn btn-link btn-sm p-0" (click)="more.toggle(key(s))">{{ more.has(key(s)) ? 'less' : 'more' }}</button>
                  }
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="7" style="padding: 0"><div class="no-data">No Data</div></td></tr>
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="view" />

    @if (allotFor(); as c) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="daAllotTitle">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header justify-content-between">
              <div class="modal-title" id="daAllotTitle"><strong>Accept Assessment</strong></div>
              <button type="button" class="btn-close" aria-label="Close" (click)="allotFor.set(null)"></button>
            </div>
            <div class="modal-body">
              <p class="muted mb-2">{{ t(c, 'ZedId') }} · {{ t(c, 'Certification') }}</p>
              <label class="form-label" for="daAssessor">Assessor<span class="req">*</span></label>
              <select id="daAssessor" class="form-select" [(ngModel)]="assessorId">
                <option value="">--Select--</option>
                @for (a of assessorsFor(c); track a.userId) { <option [value]="a.userId">{{ a.userName }}</option> }
              </select>
              @if (modalError()) { <div class="alert alert-danger mt-2 mb-0" role="alert">{{ modalError() }}</div> }
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

    @if (rejectFor()) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="daRejectTitle">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header justify-content-between">
              <div class="modal-title" id="daRejectTitle"><strong>Reject Assessment</strong></div>
              <button type="button" class="btn-close" aria-label="Close" (click)="rejectFor.set(null)"></button>
            </div>
            <div class="modal-body">
              <label class="form-label" for="daRejectReason">Reason for Rejection<span class="req">*</span></label>
              <textarea id="daRejectReason" class="form-control" maxlength="2000" rows="4" [(ngModel)]="reason"></textarea>
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
  styles: `.unit { min-width: 200px; } .reason { min-width: 180px; white-space: pre-wrap; }`,
})
export class DaAllotmentPage {
  private readonly api = inject(AssessmentApi);
  protected readonly legacy = useLegacyPortal();
  protected readonly t = text;
  protected readonly f = flag;
  protected readonly surveillance = inject(ASSESSMENT_SYSTEM) === 'surveillance';

  protected readonly rows = signal<Row[]>([]);
  /** Surveillance: the ZED ID searched for (applied on Search / Enter, as the old page reloaded the list then). */
  private readonly zedIdFilter = signal('');
  protected zedIdText = '';
  protected readonly filtered = computed(() => {
    const q = this.zedIdFilter().toLowerCase();
    return q ? this.rows().filter((s) => text(s, 'ZedId').toLowerCase().includes(q)) : this.rows();
  });
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  /** The search box above the list (any column). */
  protected readonly search = signal('');
  protected readonly view = new PagedView(() => searchRows(this.filtered(), this.search()));
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
  protected readonly more = new Expanded();
  protected readonly key = (s: Row) => text(s, 'ZedId') + text(s, 'Certification');

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

  /**
   * 2026-11-14: the agency's assessors ticked for the unit's level at the desktop (one kind of assessor; main sends one
   * list with the ticks). Surveillance keeps its own list. V4: only those who assess the unit's kind (Manufacturing / Services).
   */
  protected assessorsFor(s: Row): Person[] {
    const level = text(s, 'Certification');
    const list = level === 'Bronze' ? this.bronzeAssessors() : this.assessors();
    return list.filter((a) => serves(a, s['SectorCategory']) && mayAssess(a, level, 'Desktop'));
  }

  /**
   * Main: after the assessor rejected, or while it has not accepted. Surveillance: any allotted unit the assessor has
   * not started in the app (the list holds only those, status 1).
   */
  protected canReallot(s: Row): boolean {
    if (!text(s, 'DesktopAssessorId')) return false;
    return this.surveillance ? num(s, 'CertificationStatus') < 2 : !!text(s, 'DesktopReasonForRejection') || !flag(s, 'DesktopAccepted');
  }

  protected searchZedId(): void {
    this.zedIdFilter.set(this.zedIdText.trim());
  }

  /** As the old pop-up (a copy of the row): RE-ALLOT opens with the current assessor selected. */
  protected openAllot(s: Row): void {
    this.assessorId = text(s, 'DesktopAssessorId');
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
