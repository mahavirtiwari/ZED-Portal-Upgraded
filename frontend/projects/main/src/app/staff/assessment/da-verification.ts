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
import { TextPipe, t } from '../../content/page-text';

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
  imports: [FormsModule, RouterLink, PagerComponent, ContentTextComponent, PageHead, ListCounts, RowMenu, ConfirmDialog, TextPipe],
  host: { class: 'list-v2 d-block' },
  template: `
    <zed-page-head [crumbs]="crumbs()" [title]="title()" [subtitle]="subtitle()">
      <button type="button" class="btn btn-ph" (click)="load()">{{ 'Refresh' | t: 'staff.daVerification.refreshButton' }}</button>
    </zed-page-head>
    <zed-list-counts [counts]="counts()" [selected]="stage() ?? 'all'" [label]="'Units by status' | t: 'staff.daVerification.countsLabel'" (pick)="pickStage($event.key)" />

    <div class="zed-card dv-filters">
      <input type="search" id="da-ver-search" class="form-control dv-q" maxlength="50" [placeholder]="'Search ZED ID, unit, SPOC or agency' | t: 'staff.daVerification.search.placeholder'"
             [attr.aria-label]="'Search ZED ID, unit, SPOC or agency' | t: 'staff.daVerification.search.placeholder'" [ngModel]="search()" (ngModelChange)="search.set($event)" />
    </div>

    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }

    <div class="list-card">
    <div class="table-responsive">
      <table class="table table-zed">
        <thead>
          <tr>
            <th>{{ 'Unit' | t: 'staff.daVerification.column.unit' }}</th>
            <th>{{ 'Level' | t: 'staff.daVerification.column.level' }}</th>
            <th>{{ 'Unit SPOC' | t: 'staff.daVerification.column.spoc' }}</th>
            <th>{{ 'Agency' | t: 'staff.daVerification.column.agency' }}</th>
            <th>{{ 'Status' | t: 'staff.daVerification.column.status' }}</th>
            <th class="text-end">{{ 'Actions' | t: 'staff.daVerification.column.actions' }}</th>
          </tr>
        </thead>
        <tbody>
          @for (s of view.page(); track col(s, 'ZedId') + col(s, 'Certification')) {
            <tr>
              <td class="unit unit-cell">
                <b>{{ col(s, 'PUnitName') }}</b>
                <span class="dash-text-clr dv-id">{{ col(s, 'ZedId') }}</span>
                <small class="dv-addr" [title]="col(s, 'UnitAddress')">{{ col(s, 'UnitAddress') }}</small>
              </td>
              <td><span class="lv-tag" [class]="'lv-tag lv-' + col(s, 'Certification').toLowerCase()">{{ col(s, 'Certification') }}</span></td>
              <!-- 2026-11-18 (the user): the SPOC's mobile and e-mail in full (never masked). -->
              <td><b>{{ col(s, 'UnitSpocName') }}</b><span class="sub">{{ col(s, 'UnitSpocMobileNo') }}</span><span class="sub mail-cut" [title]="col(s, 'UnitSpocEmailId')">{{ col(s, 'UnitSpocEmailId') }}</span></td>
              <td>{{ col(s, 'AgencyName') }}<span class="sub">{{ col(s, 'CertificationBodyUserId') }}</span></td>
              <td><span class="chip" [class]="'chip ' + stateOf(s).tone">{{ stateOf(s).label }}</span></td>
              <td class="text-end text-nowrap">
                @if (!f(s, 'DesktopAccepted') && !col(s, 'DesktopReasonForRejection')) {
                  <button type="button" class="btn btn-primary dv-act" (click)="acceptFor.set(s); modalError.set('')">{{ 'Accept' | t: 'staff.daVerification.row.acceptButton' }}</button>
                }
                @if (f(s, 'DesktopAccepted')) {
                  <a [routerLink]="['/staff/assessment/da-details', col(s, 'ZedId'), col(s, 'Certification')]" class="btn btn-primary dv-act">{{ 'Assess' | t: 'staff.daVerification.row.assessButton' }}</a>
                }
                <zed-row-menu [items]="menu(s)" [label]="'More actions for {zedId}' | t: 'staff.daVerification.row.menuAria' : { zedId: col(s, 'ZedId') }" (picked)="act(s, $event)" />
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6" style="padding: 0"><div class="no-data">{{ loading() ? ('Loading…' | t: 'staff.daVerification.loading.text') : ('No unit to show. Units allotted to you for desktop verification are listed here.' | t: 'staff.daVerification.empty') }}</div></td></tr>
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
                <h3 class="dv-pop-title" id="dvAcceptTitle">{{ 'Accept assessment?' | t: 'staff.daVerification.accept.title' }}</h3>
                <p class="dv-pop-sub">{{ col(c, 'ZedId') }} · {{ col(c, 'Certification') }}@if (col(c, 'PUnitName')) { · {{ col(c, 'PUnitName') }} }</p>
              </div>
              <button type="button" class="btn-close" [attr.aria-label]="'Close' | t: 'staff.daVerification.accept.closeAria'" (click)="acceptFor.set(null)"></button>
            </div>
            <div class="modal-body">
              <zed-text key="staff.desktopVerification.accept.confirm" [inline]="true" />
              @if (modalError()) { <div class="alert alert-danger mt-2 mb-0" role="alert">{{ modalError() }}</div> }
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-light" (click)="acceptFor.set(null)">{{ 'Cancel' | t: 'staff.daVerification.accept.cancelButton' }}</button>
              <button type="button" class="btn btn-primary dv-ok" [disabled]="busy()" (click)="accept()">{{ 'Accept' | t: 'staff.daVerification.accept.confirmButton' }}</button>
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
  protected readonly col = text;
  protected readonly f = flag;
  protected readonly nm = num;
  protected readonly surveillance = inject(ASSESSMENT_SYSTEM) === 'surveillance';

  protected readonly rows = signal<Row[]>([]);
  protected readonly title = computed(() => this.surveillance ? t('staff.daVerification.surveillanceTitle', 'Surveillance assessments')
    : t('staff.daVerification.title', 'Desktop verification'));
  protected readonly crumbs = computed(() => staffCrumbs({ label: this.title() }));
  protected readonly subtitle = computed(() => this.surveillance
    ? t('staff.daVerification.surveillance.sub', 'The surveillance assessments allotted to you: verify each one after its final submit in the Surveillance app.')
    : t('staff.daVerification.sub', 'The units allotted to you for desktop verification: accept or reject each one, then assess it.'));

  /** Where a unit stands for the assessor (the chip of its row); `stage` is its tile. */
  protected stateOf(s: Row): { label: string; tone: string; stage: string } {
    if (text(s, 'DesktopReasonForRejection')) return { label: t('staff.daVerification.state.rejectedLabel', 'Rejected by you'), tone: 'is-bad', stage: 'rejected' };
    if (!flag(s, 'DesktopAccepted')) return { label: t('staff.daVerification.state.acceptLabel', 'To accept'), tone: 'is-warn', stage: 'accept' };
    if (this.surveillance && num(s, 'CertificationStatus') < 2) {
      return { label: t('staff.daVerification.state.pendingAppLabel', 'Pending in the Surveillance app'), tone: 'is-info', stage: 'assess' };
    }
    return { label: t('staff.daVerification.state.assessLabel', 'To assess'), tone: 'is-warn', stage: 'assess' };
  }

  /** The tile of a unit (to accept, to assess, rejected). */
  private stageOf(s: Row): string {
    return this.stateOf(s).stage;
  }

  /** The tile chosen (null: every unit). */
  protected readonly stage = signal<string | null>(null);

  /** Allotted, to accept, to assess and rejected (the tiles above the list; a click filters it). */
  protected readonly counts = computed<ListCount[]>(() => {
    const rows = this.rows();
    const by = (key: string) => rows.filter((r) => this.stageOf(r) === key).length;
    return [
      { key: 'all', label: t('staff.daVerification.count.allLabel', 'Allotted to me'), value: rows.length },
      { key: 'accept', label: t('staff.daVerification.count.acceptLabel', 'To accept'), value: by('accept'), tone: 'warn' },
      { key: 'assess', label: t('staff.daVerification.count.assessLabel', 'To assess'), value: by('assess'), tone: 'warn' },
      { key: 'rejected', label: t('staff.daVerification.count.rejectedLabel', 'Rejected by me'), value: by('rejected'), tone: 'bad' },
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
    const items: RowMenuItem[] = [{ key: 'profile', label: t('staff.daVerification.menu.profileLabel', 'View MSME profile'), icon: 'people' }];
    if (!flag(s, 'DesktopAccepted') && !text(s, 'DesktopReasonForRejection')) items.push({ key: 'reject', label: t('staff.daVerification.menu.rejectLabel', 'Reject'), danger: true });
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
      title: t('staff.daVerification.reject.title', 'Reject assessment?'),
      message: t('staff.daVerification.reject.message', '{zedId} ({level}) goes back to the agency with your reason.',
        { zedId: text(s, 'ZedId'), level: text(s, 'Certification') }),
      confirmLabel: t('staff.daVerification.reject.confirmButton', 'Reject'),
      danger: true,
      reason: { label: t('staff.daVerification.reject.reasonLabel', 'Reason for rejection'), maxLength: 2000,
        requiredMessage: t('staff.daVerification.reject.reasonRequired.message', 'Please enter reason for rejection.') },
    };
  }

  protected async accept(): Promise<void> {
    const s = this.acceptFor();
    if (s) await this.run(() => this.api.assessorAccept(text(s, 'ZedId'), text(s, 'Certification')), () => this.acceptFor.set(null),
      t('staff.daVerification.toast.accepted', '{zedId} accepted', { zedId: text(s, 'ZedId') }));
  }

  protected async reject(reason: string): Promise<void> {
    const s = this.rejectFor();
    if (!s || !reason) return;
    await this.run(() => this.api.assessorReject(text(s, 'ZedId'), text(s, 'Certification'), reason), () => this.rejectFor.set(null),
      t('staff.daVerification.toast.rejected', '{zedId} rejected', { zedId: text(s, 'ZedId') }));
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
