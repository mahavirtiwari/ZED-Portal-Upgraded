import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ContentTextComponent } from '../../content/content-text';
import { ASSESSMENT_SYSTEM, flag, num, text, useLegacyPortal } from './assessment-shared';
import { AssessmentApi, Row } from './assessment.api';
import { PagedView, PagerComponent, searchRows } from '../pager';
import { PageHead } from '../../msme/shared/page-head';
import { ListCount, ListCounts } from '../list-counts';
import { staffCrumbs } from '../staff-crumbs';
import { RowMenu, RowMenuItem } from '../row-menu';
import { ConfirmAsk, ConfirmDialog } from '../confirm-dialog';
import { ToastService } from '../toast';

/**
 * Desktop assessor: units allotted for desktop verification — accept/reject, then assess. Port of
 * Views/Assessment/DaVerification.cshtml (Assessment/GetList, AcceptUnitForDaVerification,
 * RejectUnitForDaVerification).
 * Surveillance ("Surveillance Assessments", Bronze): the agency's allotment is already accepted; units are listed from
 * status 1, while the assessor captures the unit in the Surveillance app, and are verified here after its final submit.
 * <p>2026-11-17 (approved staff redesign, "same look"): the page head, the counts as tiles that filter the list, one search
 * box, the SPOC's mobile and e-mail (in full since 2026-11-18, the user), Accept or Assess on the row and View profile and
 * Reject in its menu, the reason for a rejection in the confirmation pop-up, a toast when done. The accept pop-up keeps the
 * Admin's text (staff.desktopVerification.accept.confirm).</p>
 */
@Component({
  selector: 'zed-staff-da-verification',
  imports: [FormsModule, RouterLink, PagerComponent, ContentTextComponent, PageHead, ListCounts, RowMenu, ConfirmDialog],
  host: { class: 'list-v2 d-block' },
  template: `
    <zed-page-head [crumbs]="crumbs" [title]="title" [subtitle]="subtitle">
      <button type="button" class="btn btn-ph" (click)="load()">Refresh</button>
    </zed-page-head>
    <zed-list-counts [counts]="counts()" [selected]="stage() ?? 'all'" label="Units by status" (pick)="pickStage($event.key)" />

    <div class="zed-card dv-filters">
      <input type="search" id="da-ver-search" class="form-control dv-q" maxlength="50" placeholder="Search ZED ID, unit, SPOC or agency"
             aria-label="Search ZED ID, unit, SPOC or agency" [ngModel]="search()" (ngModelChange)="search.set($event)" />
    </div>

    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }

    <div class="list-card">
    <div class="table-responsive">
      <table class="table table-zed">
        <thead>
          <tr>
            <th>Unit</th>
            <th>Level</th>
            <th>Unit SPOC</th>
            <th>Agency</th>
            <th>Status</th>
            <th class="text-end">Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (s of view.page(); track t(s, 'ZedId') + t(s, 'Certification')) {
            <tr>
              <td class="unit unit-cell">
                <b>{{ t(s, 'PUnitName') }}</b>
                <span class="dash-text-clr dv-id">{{ t(s, 'ZedId') }}</span>
                <small class="dv-addr" [title]="t(s, 'UnitAddress')">{{ t(s, 'UnitAddress') }}</small>
              </td>
              <td><span class="lv-tag" [class]="'lv-tag lv-' + t(s, 'Certification').toLowerCase()">{{ t(s, 'Certification') }}</span></td>
              <!-- 2026-11-18 (the user): the SPOC's mobile and e-mail in full (never masked). -->
              <td><b>{{ t(s, 'UnitSpocName') }}</b><span class="sub">{{ t(s, 'UnitSpocMobileNo') }}</span><span class="sub mail-cut" [title]="t(s, 'UnitSpocEmailId')">{{ t(s, 'UnitSpocEmailId') }}</span></td>
              <td>{{ t(s, 'AgencyName') }}<span class="sub">{{ t(s, 'CertificationBodyUserId') }}</span></td>
              <td><span class="chip" [class]="'chip ' + stateOf(s).tone">{{ stateOf(s).label }}</span></td>
              <td class="text-end text-nowrap">
                @if (!f(s, 'DesktopAccepted') && !t(s, 'DesktopReasonForRejection')) {
                  <button type="button" class="btn btn-primary dv-act" (click)="acceptFor.set(s); modalError.set('')">Accept</button>
                }
                @if (f(s, 'DesktopAccepted')) {
                  <a [routerLink]="['/staff/assessment/da-details', t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-primary dv-act">Assess</a>
                }
                <zed-row-menu [items]="menu(s)" [label]="'More actions for ' + t(s, 'ZedId')" (picked)="act(s, $event)" />
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6" style="padding: 0"><div class="no-data">{{ loading() ? 'Loading…' : 'No Data' }}</div></td></tr>
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="view" />
    </div>

    @if (acceptFor(); as c) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="dvAcceptTitle" (click)="acceptFor.set(null)">
        <div class="modal-dialog modal-dialog-centered" (click)="$event.stopPropagation()">
          <div class="modal-content dv-pop">
            <div class="modal-header justify-content-between">
              <div>
                <h3 class="dv-pop-title" id="dvAcceptTitle">Accept assessment?</h3>
                <p class="dv-pop-sub">{{ t(c, 'ZedId') }} · {{ t(c, 'Certification') }}@if (t(c, 'PUnitName')) { · {{ t(c, 'PUnitName') }} }</p>
              </div>
              <button type="button" class="btn-close" aria-label="Close" (click)="acceptFor.set(null)"></button>
            </div>
            <div class="modal-body">
              <zed-text key="staff.desktopVerification.accept.confirm" [inline]="true" />
              @if (modalError()) { <div class="alert alert-danger mt-2 mb-0" role="alert">{{ modalError() }}</div> }
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-light" (click)="acceptFor.set(null)">Cancel</button>
              <button type="button" class="btn btn-primary dv-ok" [disabled]="busy()" (click)="accept()">Accept</button>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }

    @if (rejectFor(); as r) {
      <zed-confirm-dialog [ask]="rejectAsk(r)" [busy]="busy()" [failed]="modalError()" inputId="dvRejectReason"
                          (confirmed)="reject($event)" (cancel)="rejectFor.set(null)" />
    }
  `,
  styles: `
    .dv-filters { display: flex; flex-wrap: wrap; gap: 10px; padding: 12px 14px; margin-bottom: 14px; }
    .dv-q { flex: 1 1 260px; max-width: 460px; }
    .unit { min-width: 220px; }
    .dv-id { display: block; font-size: 12.5px; font-weight: 700; }
    .dv-addr { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: 260px; }
    .dv-act { min-width: 82px; margin-right: 6px; font-weight: 600; }
    .dv-pop { border: 0; border-radius: 12px; }
    .dv-pop-title { margin: 0; font-size: 18px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .dv-pop-sub { margin: 2px 0 0; font-size: 13px; color: #5f6f70; }
  `,
})
export class DaVerificationPage {
  private readonly api = inject(AssessmentApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly legacy = useLegacyPortal();
  protected readonly t = text;
  protected readonly f = flag;
  protected readonly nm = num;
  protected readonly surveillance = inject(ASSESSMENT_SYSTEM) === 'surveillance';

  protected readonly rows = signal<Row[]>([]);
  protected readonly title = this.surveillance ? 'Surveillance assessments' : 'Desktop verification';
  protected readonly crumbs = staffCrumbs({ label: this.title });
  protected readonly subtitle = this.surveillance
    ? 'The surveillance assessments allotted to you: verify each one after its final submit in the Surveillance app.'
    : 'The units allotted to you for desktop verification: accept or reject each one, then assess it.';

  /** Where a unit stands for the assessor (the chip of its row). */
  protected stateOf(s: Row): { label: string; tone: string } {
    if (text(s, 'DesktopReasonForRejection')) return { label: 'Rejected by you', tone: 'is-bad' };
    if (!flag(s, 'DesktopAccepted')) return { label: 'To accept', tone: 'is-warn' };
    if (this.surveillance && num(s, 'CertificationStatus') < 2) return { label: 'Pending in the Surveillance app', tone: 'is-info' };
    return { label: 'To assess', tone: 'is-warn' };
  }

  /** The tile of a unit (to accept, to assess, rejected). */
  private stageOf(s: Row): string {
    const label = this.stateOf(s).label;
    return label === 'To accept' ? 'accept' : label === 'Rejected by you' ? 'rejected' : 'assess';
  }

  /** The tile chosen (null: every unit). */
  protected readonly stage = signal<string | null>(null);

  /** Allotted, to accept, to assess and rejected (the tiles above the list; a click filters it). */
  protected readonly counts = computed<ListCount[]>(() => {
    const rows = this.rows();
    const by = (key: string) => rows.filter((r) => this.stageOf(r) === key).length;
    return [
      { key: 'all', label: 'Allotted to me', value: rows.length },
      { key: 'accept', label: 'To accept', value: by('accept'), tone: 'warn' },
      { key: 'assess', label: 'To assess', value: by('assess'), tone: 'warn' },
      { key: 'rejected', label: 'Rejected by me', value: by('rejected'), tone: 'bad' },
    ];
  });
  /** The search box above the list (any column). Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly search = signal('');
  private readonly shown = computed(() => {
    const stage = this.stage();
    return stage ? this.rows().filter((r) => this.stageOf(r) === stage) : this.rows();
  });
  protected readonly view = new PagedView(() => searchRows(this.shown(), this.search()));
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly acceptFor = signal<Row | null>(null);
  protected readonly rejectFor = signal<Row | null>(null);
  protected readonly modalError = signal('');

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.rows.set((await firstValueFrom(this.api.daVerification())).rows);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** A tile filters the list; "Allotted to me" (or the chosen tile again) shows every unit. */
  protected pickStage(key: string | undefined): void {
    const k = !key || key === 'all' || key === this.stage() ? null : key;
    this.stage.set(k);
  }

  /** The row menu: the profile, and Reject while the unit is not accepted (the old REJECT button). */
  protected menu(s: Row): RowMenuItem[] {
    const items: RowMenuItem[] = [{ key: 'profile', label: 'View MSME profile', icon: 'people' }];
    if (!flag(s, 'DesktopAccepted') && !text(s, 'DesktopReasonForRejection')) items.push({ key: 'reject', label: 'Reject', danger: true });
    return items;
  }

  protected act(s: Row, key: string): void {
    if (key === 'profile') void this.router.navigateByUrl('/' + this.legacy.profile(text(s, 'ZedId')));
    else if (key === 'reject') this.openReject(s);
  }

  protected openReject(s: Row): void {
    this.modalError.set('');
    this.rejectFor.set(s);
  }

  protected rejectAsk(s: Row): ConfirmAsk {
    return {
      title: 'Reject assessment?',
      message: `${text(s, 'ZedId')} (${text(s, 'Certification')}) goes back to the agency with your reason.`,
      confirmLabel: 'Reject',
      danger: true,
      reason: { label: 'Reason for rejection', maxLength: 2000, requiredMessage: 'Please enter reason for rejection.' },
    };
  }

  protected async accept(): Promise<void> {
    const s = this.acceptFor();
    if (s) await this.run(() => this.api.assessorAccept(text(s, 'ZedId'), text(s, 'Certification')), () => this.acceptFor.set(null), `${text(s, 'ZedId')} accepted`);
  }

  protected async reject(reason: string): Promise<void> {
    const s = this.rejectFor();
    if (!s || !reason) return;
    await this.run(() => this.api.assessorReject(text(s, 'ZedId'), text(s, 'Certification'), reason), () => this.rejectFor.set(null), `${text(s, 'ZedId')} rejected`);
  }

  private async run(call: () => ReturnType<AssessmentApi['assessorAccept']>, close: () => void, done: string): Promise<void> {
    this.busy.set(true);
    this.modalError.set('');
    try {
      await firstValueFrom(call());
      close();
      this.toast.success(done);
      await this.load();
    } catch (err) {
      this.modalError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
