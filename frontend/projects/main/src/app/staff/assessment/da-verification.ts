import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ContentTextComponent } from '../../content/content-text';
import { ASSESSMENT_SYSTEM, flag, num, text, useLegacyPortal } from './assessment-shared';
import { AssessmentApi, Row } from './assessment.api';
import { ListSearchComponent, PagedView, PagerComponent, searchRows } from '../pager';
import { PageHead } from '../../msme/shared/page-head';
import { ListCount, ListCounts } from '../list-counts';

/**
 * Desktop assessor: units allotted for desktop verification — accept/reject, then assess. Port of
 * Views/Assessment/DaVerification.cshtml (Assessment/GetList, AcceptUnitForDaVerification,
 * RejectUnitForDaVerification).
 * Surveillance ("Surveillance Assessments", Bronze): the agency's allotment is already accepted; units are listed from
 * status 1, while the assessor captures the unit in the Surveillance app, and are verified here after its final submit.
 */
@Component({
  selector: 'zed-staff-da-verification',
  imports: [FormsModule, RouterLink, PagerComponent, ListSearchComponent, ContentTextComponent, PageHead, ListCounts],
  host: { class: 'list-v2 d-block' },
  template: `
    <!-- 2026-11-14 (approved frame A): the shared header, the counts, the list in one card with a status chip per unit. -->
    <zed-page-head [crumbs]="[{ label: 'Home', link: '/staff' }, { label: title }]" [title]="title">
      <button type="button" class="btn btn-outline-secondary btn-sm refresh-link" (click)="load()"><img src="Images/svgicons/refresh.svg" alt="" /> Refresh</button>
    </zed-page-head>
    <zed-list-counts [counts]="counts()" />

    @if (notice(); as n) {
      <div class="alert alert-dismissible" [class.alert-success]="n.ok" [class.alert-danger]="!n.ok" role="status">
        {{ n.text }}
        <button type="button" class="btn-close" aria-label="Close" (click)="notice.set(null)"></button>
      </div>
    }

    <div class="list-card">
    <div class="list-card-head">
      <b>Units</b>
      <zed-list-search [(value)]="search" placeholder="Search units" inputId="da-ver-search" [found]="view.total()" />
    </div>
    <div class="table-responsive">
      <table class="table table-zed">
        <thead>
          <tr>
            <th>Unit</th>
            <th>Level</th>
            <th>Unit SPOC</th>
            <th>Agency</th>
            <th>Status</th>
            <th style="width: 140px"><span class="visually-hidden">Action(s)</span></th>
          </tr>
        </thead>
        <tbody>
          @for (s of view.page(); track t(s, 'ZedId') + t(s, 'Certification')) {
            <tr>
              <td class="unit unit-cell">
                <b>{{ t(s, 'PUnitName') }}</b>
                <small><span class="dash-text-clr">{{ t(s, 'ZedId') }}</span> · {{ t(s, 'UnitAddress') }}</small>
              </td>
              <td><span class="lv-tag" [class]="'lv-tag lv-' + t(s, 'Certification').toLowerCase()">{{ t(s, 'Certification') }}</span></td>
              <td><b>{{ t(s, 'UnitSpocName') }}</b><span class="sub">{{ t(s, 'UnitSpocMobileNo') }}</span><span class="sub">{{ t(s, 'UnitSpocEmailId') }}</span></td>
              <td>{{ t(s, 'AgencyName') }}<span class="sub">{{ t(s, 'CertificationBodyUserId') }}</span></td>
              <td><span class="chip" [class]="'chip ' + stateOf(s).tone">{{ stateOf(s).label }}</span></td>
              <td>
                <div class="row-actions">
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
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6" style="padding: 0"><div class="no-data">No Data</div></td></tr>
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="view" />
    </div>

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
  styles: `.unit { min-width: 220px; }`,
})
export class DaVerificationPage {
  private readonly api = inject(AssessmentApi);
  protected readonly legacy = useLegacyPortal();
  protected readonly t = text;
  protected readonly f = flag;
  protected readonly nm = num;
  protected readonly surveillance = inject(ASSESSMENT_SYSTEM) === 'surveillance';

  protected readonly rows = signal<Row[]>([]);
  protected readonly title = this.surveillance ? 'Surveillance assessments' : 'Desktop verification';

  /** Where a unit stands for the assessor (the chip of its row). */
  protected stateOf(s: Row): { label: string; tone: string } {
    if (text(s, 'DesktopReasonForRejection')) return { label: 'Rejected by you', tone: 'is-bad' };
    if (!flag(s, 'DesktopAccepted')) return { label: 'To accept', tone: 'is-warn' };
    if (this.surveillance && num(s, 'CertificationStatus') < 2) return { label: 'Pending in the Surveillance app', tone: 'is-info' };
    return { label: 'To assess', tone: 'is-warn' };
  }

  /** Allotted, to accept, to assess and rejected (the counts above the list). */
  protected readonly counts = computed<ListCount[]>(() => {
    const rows = this.rows();
    const by = (label: string) => rows.filter((r) => this.stateOf(r).label === label).length;
    return [
      { label: 'Allotted to me', value: rows.length },
      { label: 'To accept', value: by('To accept'), tone: 'warn' },
      { label: 'To assess', value: by('To assess') + by('Pending in the Surveillance app'), tone: 'warn' },
      { label: 'Rejected by me', value: by('Rejected by you'), tone: 'bad' },
    ];
  });
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
