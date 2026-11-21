import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { StaffRole } from '../../staff-menu';
import { TU_LANDING, TuApi, TuCounts, TuSubmission, TuTab, UserOption } from './tu.api';
import { PagedView, PagerComponent, searchRows } from '../../pager';
import { PageHead } from '../../../msme/shared/page-head';
import { ListCount, ListCounts } from '../../list-counts';
import { staffCrumbs } from '../../staff-crumbs';
import { RowMenu, RowMenuItem } from '../../row-menu';
import { ConfirmAsk, ConfirmDialog } from '../../confirm-dialog';
import { ToastService } from '../../toast';
import { TextPipe, t } from '../../../content/page-text';

type Dialog =
  | { kind: 'allot'; row: TuSubmission; options: UserOption[]; choice: string }
  | { kind: 'accept'; row: TuSubmission; options: UserOption[]; choice: string }
  | { kind: 'reject'; row: TuSubmission; reason: string };

const NO_COUNTS: TuCounts = { New: 0, InProgress: 0, Qc: 0, Approved: 0, Rejected: 0 };

/**
 * Technology Upgradation applications on the consultancy portal for the master admin, Consultant Organisations (CO)
 * and MSME-DFO officers. Port of Frontend/FinancialAssistance/Submissions.cshtml: the master admin allots (or
 * re-allots) to a CO, the CO accepts with one of its DFOs (or re-allots the DFO before the opening meeting) or
 * rejects, and everyone opens the verification page. The API checks every action again.
 * The master admin and the CO land on status 99 (the counts, no rows, as the old page) with the tab bar; the DFO lands on
 * TU ALLOTMENT and has no tabs. The Status and Reason columns follow the old page's per-tab conditions.
 * <p>2026-11-17 (approved staff redesign, "same look"): the page head, the status tabs as clickable tiles with their counts,
 * one search box, the unit first, Allot / Re-allot / Accept and View details on the row and View profile and Reject in its
 * menu, the reason for a rejection in the confirmation pop-up, the server's message in a toast.</p>
 * <p>2026-11-19 ("All page wording"): every wording is the Admin's (Texts → Page wording, staff.tuSubmissions.*) or the standard
 * one here and in tu-submissions.html.</p>
 */
@Component({
  selector: 'zed-staff-tu-submissions',
  imports: [FormsModule, RouterLink, PagerComponent, PageHead, ListCounts, RowMenu, ConfirmDialog, TextPipe],
  host: { class: 'list-v2 d-block' },
  templateUrl: './tu-submissions.html',
  styles: `
    .tu-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 12px 14px; margin-bottom: 14px; }
    .tu-q { flex: 1 1 260px; max-width: 420px; }
    .tu-hint { font-size: 13px; color: #5f6f70; }
    .unit-cell { min-width: 200px; }
    .tu-id { display: block; font-size: 12.5px; font-weight: 700; }
    .tu-addr { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: 260px; }
    /* The old page's red rows (a reason for rejection) as a light tint and a mark; the action cell of an overdue answer (TimeDuration). */
    tr.rejected > td { background: #fff6f5 !important; }
    tr.rejected > td:first-child { box-shadow: inset 3px 0 0 #d64532; }
    td.late { background-color: #fdeef0 !important; }
    .badges { display: flex; flex-wrap: wrap; gap: 4px; }
    .reason { white-space: pre-wrap; min-width: 200px; max-width: 340px; }
    .tu-act { min-width: 76px; margin-right: 6px; font-weight: 600; }
    .tu-act.re-allot { background: #fff1d6; border-color: #fff1d6; color: #7a4700; }
    .tu-act.re-allot:hover { background: #ffe6b5; }
    .tu-pop { border: 0; border-radius: 12px; }
    .tu-pop-title { margin: 0; font-size: 18px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .tu-pop-sub { margin: 2px 0 0; font-size: 13px; color: #5f6f70; }
  `,
})
export class TuSubmissionsPage {
  private readonly api = inject(TuApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly user = inject(AuthService).currentUser;
  protected readonly crumbs = computed(() => staffCrumbs({ label: t('staff.tuSubmissions.crumb', 'Technology Upgradation') }));
  protected readonly landing = TU_LANDING;

  protected readonly isAdmin = computed(() => this.user()?.roleId === StaffRole.MasterAdmin);
  protected readonly isAgency = computed(() => this.user()?.roleId === StaffRole.Agency);
  protected readonly isDfo = computed(() => this.user()?.roleId === StaffRole.DesktopAssessor);

  /** The status lists (their wording is read in tiles()). */
  protected readonly tabs = [
    { status: TuTab.Allotment, count: 'New', tone: 'warn' },
    { status: TuTab.InProgress, count: 'InProgress', tone: 'info' },
    { status: TuTab.Qc, count: 'Qc', tone: undefined },
    { status: TuTab.Approved, count: 'Approved', tone: 'good' },
    { status: TuTab.Rejected, count: 'Rejected', tone: 'bad' },
  ] as const;
  /** The status lists as tiles with their counts (a click opens the list). */
  protected readonly tiles = computed<ListCount[]>(() =>
    this.tabs.map((tab) => ({ key: String(tab.status), label: this.tabLabel(tab.status), value: this.counts()[tab.count] ?? 0, tone: tab.tone })));
  protected readonly subtitle = computed(() =>
    this.isAdmin() ? t('staff.tuSubmissions.adminSub', 'Allot the technology upgradation applications to Consultant Organisations and follow them up to approval.')
    : this.isAgency() ? t('staff.tuSubmissions.coSub', 'Accept the applications allotted to your organisation with one of your consultants, or reject them.')
    : t('staff.tuSubmissions.consultantSub', 'The technology upgradation applications allotted to you.'));

  protected readonly status = signal<number>(this.isDfo() ? TuTab.Allotment : TU_LANDING);
  protected readonly rows = signal<TuSubmission[]>([]);
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  /** The search box above the list (any column). */
  protected readonly search = signal('');
  protected readonly view = new PagedView(() => searchRows(this.rows(), this.search()));
  protected readonly counts = signal<TuCounts>(NO_COUNTS);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly dialog = signal<Dialog | null>(null);
  protected readonly dialogError = signal('');
  protected readonly saving = signal(false);
  /** Rows whose reason for rejection is unfolded (long reasons show three lines). */
  protected readonly expanded = signal<ReadonlySet<number>>(new Set());

  constructor() {
    void this.load(this.status());
  }

  protected toggle(id: number): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  private tabLabel(status: number): string {
    switch (status) {
      case TuTab.Allotment: return t('staff.tuSubmissions.tab.allotment', 'TU allotment');
      case TuTab.InProgress: return t('staff.tuSubmissions.tab.inProgress', 'In progress');
      case TuTab.Qc: return t('staff.tuSubmissions.tab.qc', 'QC');
      case TuTab.Approved: return t('staff.tuSubmissions.tab.approved', 'Approved');
      default: return t('staff.tuSubmissions.tab.rejected', 'Rejected');
    }
  }

  protected count(key: keyof TuCounts): number {
    return this.counts()[key] ?? 0;
  }

  protected async load(status: number): Promise<void> {
    this.status.set(status);
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await firstValueFrom(this.api.submissions(status));
      this.rows.set(data.rows ?? []);
      this.counts.set(data.counts ?? NO_COUNTS);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  // ----- what each role may do with a row (mirrors the old page; the API decides) -----

  protected canAllot(r: TuSubmission): boolean {
    return this.isAdmin() && !r.CertificationBodyUserId;
  }

  protected canReAllot(r: TuSubmission): boolean {
    return this.isAdmin() && this.status() === TuTab.Allotment && !!r.CertificationBodyUserId && (!r.FinancialAssessorId || !!r.ReasonForRejection);
  }

  protected canRespond(r: TuSubmission): boolean {
    return this.isAgency() && !r.FinancialAssessorId && !r.ReasonForRejection;
  }

  /** The CO may change the DFO until the opening meeting (TechUpgradeStatus 4 or 5). */
  protected canReAllotDfo(r: TuSubmission): boolean {
    return this.isAgency() && !!r.FinancialAssessorId && (r.TechUpgradeStatus === 4 || r.TechUpgradeStatus === 5);
  }

  protected canOpen(r: TuSubmission): boolean {
    if (this.isAgency()) return !!r.CertificationBodyUserId;
    return true;
  }

  /** "View Profile" of the unit, for the master admin and the CO. */
  protected canViewProfile(): boolean {
    return this.isAdmin() || this.isAgency();
  }

  /** The old page hid the Status column on the tabs 2–5 (shown on QC, APPROVED, REJECTED and the landing view). */
  protected showStatus(): boolean {
    const s = this.status();
    return !(s > 1 && s <= 5);
  }

  /** The Reason For Rejection column: not for the DFO, and hidden for the statuses 3–4 (no tab uses them). */
  protected showReason(): boolean {
    const s = this.status();
    return !this.isDfo() && !(s > 2 && s < 5);
  }

  protected dfoName(r: TuSubmission): string | null {
    return r.FaAssessorName ?? r.FinAssessorName;
  }

  protected reason(r: TuSubmission): string | null {
    return this.status() === TuTab.Rejected ? (r.ReasonForRejectionAgency ?? r.ReasonForRejection) : r.ReasonForRejection;
  }

  /** The row menu: the unit's profile (master admin, CO) and Reject (the CO, before it answers). */
  protected menu(r: TuSubmission): RowMenuItem[] {
    const items: RowMenuItem[] = [];
    if (this.canViewProfile()) items.push({ key: 'profile', label: t('staff.tuSubmissions.menu.profile', 'View MSME profile'), icon: 'people' });
    if (this.canRespond(r)) items.push({ key: 'reject', label: t('staff.tuSubmissions.menu.reject', 'Reject'), danger: true });
    return items;
  }

  protected act(r: TuSubmission, key: string): void {
    if (key === 'profile') void this.router.navigate(['/staff/msme-profile', r.ZedId]);
    else if (key === 'reject') this.openReject(r);
  }

  protected rejectAsk(r: TuSubmission): ConfirmAsk {
    return {
      title: t('staff.tuSubmissions.reject.title', 'Reject unit?'),
      message: t('staff.tuSubmissions.reject.message', '{zedId} · {unit} · {level}: the application goes back to the ZED team with your reason.',
        { zedId: r.ZedId, unit: r.PUnitName ?? '', level: r.CertificationType }),
      confirmLabel: t('staff.tuSubmissions.reject.confirmButton', 'Reject'),
      danger: true,
      reason: { label: t('staff.tuSubmissions.reject.reasonLabel', 'Reason for rejection'), maxLength: 2000,
        requiredMessage: t('staff.tuSubmissions.reject.reasonError', 'Please enter the reason for rejection.') },
    };
  }

  // ----- dialogs -----

  protected async openAllot(row: TuSubmission): Promise<void> {
    await this.openWithOptions(row, 'allot', () => this.api.agencies(row.ZedId));
  }

  protected async openAccept(row: TuSubmission): Promise<void> {
    await this.openWithOptions(row, 'accept', () => this.api.assessors());
  }

  protected openReject(row: TuSubmission): void {
    this.dialogError.set('');
    this.dialog.set({ kind: 'reject', row, reason: '' });
  }

  protected setChoice(choice: string): void {
    const d = this.dialog();
    if (d && d.kind !== 'reject') this.dialog.set({ ...d, choice });
  }

  protected setReason(reason: string): void {
    const d = this.dialog();
    if (d?.kind === 'reject') this.dialog.set({ ...d, reason });
  }

  protected close(): void {
    if (!this.saving()) this.dialog.set(null);
  }

  protected async confirm(): Promise<void> {
    const d = this.dialog();
    if (!d) return;
    if (d.kind !== 'reject' && !d.choice) {
      this.dialogError.set(d.kind === 'allot' ? t('staff.tuSubmissions.dialog.coError', 'Please select assessment agency.') : t('staff.tuSubmissions.dialog.consultantError', 'Please select valid data.'));
      return;
    }
    if (d.kind === 'reject' && !d.reason.trim()) {
      this.dialogError.set(t('staff.tuSubmissions.reject.reasonError', 'Please enter the reason for rejection.'));
      return;
    }
    this.saving.set(true);
    this.dialogError.set('');
    try {
      const { ZedId, CertificationType } = d.row;
      const r = await firstValueFrom(
        d.kind === 'allot'
          ? this.api.allot(ZedId, CertificationType, d.choice)
          : d.kind === 'accept'
            ? this.api.accept(ZedId, CertificationType, d.choice)
            : this.api.reject(ZedId, CertificationType, d.reason.trim()),
      );
      this.dialog.set(null);
      this.toast.success(r.message);
      await this.load(this.status());
    } catch (err) {
      this.dialogError.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  private async openWithOptions(row: TuSubmission, kind: 'allot' | 'accept', fetch: () => ReturnType<TuApi['assessors']>): Promise<void> {
    this.error.set('');
    this.dialogError.set('');
    this.loading.set(true);
    try {
      const options = await firstValueFrom(fetch());
      const current = kind === 'allot' ? (row.CertificationBodyUserId ?? '') : '';
      this.dialog.set({ kind, row, options, choice: options.some((o) => o.userId === current) ? current : '' });
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
