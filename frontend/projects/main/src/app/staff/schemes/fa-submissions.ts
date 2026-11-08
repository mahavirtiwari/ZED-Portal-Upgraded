import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { StaffRole } from '../staff-menu';
import { FaApi, FaCounts, FaFilter, FaStatus, FaSubmission, UserOption } from './fa.api';
import { ListSearchComponent, PagedView, PagerComponent, searchRows } from '../pager';

type Dialog =
  | { kind: 'allot'; row: FaSubmission; options: UserOption[]; choice: string }
  | { kind: 'accept'; row: FaSubmission; options: UserOption[]; choice: string }
  | { kind: 'reject'; row: FaSubmission; reason: string };

const NO_COUNTS: FaCounts = { New: 0, InProgress: 0, Qc: 0, Approved: 0, Rejected: 0 };
const NO_FILTER: FaFilter = { level: '', agency: '', from: '', to: '' };

/**
 * Financial assistance applications for the master admin, agencies and financial assessors. Port of
 * Views/FinancialAssistance/Submissions.cshtml: the master admin allots (or re-allots) an application to
 * an agency, the agency accepts it with one of its assessors or rejects the allotment, and everyone
 * opens the application they are assigned to. The API checks every action again.
 */
@Component({
  selector: 'zed-staff-fa-submissions',
  imports: [FormsModule, RouterLink, PagerComponent, ListSearchComponent],
  templateUrl: './fa-submissions.html',
  styles: `
    /* Status lists as a row of tabs with their counts. */
    .status-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    .status-tabs .tab-count { display: inline-block; min-width: 22px; margin-left: 6px; padding: 0 7px; border-radius: 10px; background: rgba(69, 165, 173, 0.15); font-size: 12px; font-weight: 700; }
    .status-tabs .btn-primary .tab-count { background: rgba(255, 255, 255, 0.25); }
    /* Several values in one cell, one per line. */
    .cell-lines > * { display: block; }
    .cell-lines > * + * { margin-top: 4px; }
    .zed-chip.is-auto { background: #e7f3f4; color: #2f6f75; margin: 0; }
    /* Filters above the tabs (2026-11-08, as on Assessment Monitoring). */
    .fa-filters { padding: 14px 16px; margin-bottom: 14px; }
    .fa-filter-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1.7fr); gap: 12px; align-items: end; }
    .fa-filter-grid .form-label { font-size: 13px; font-weight: 600; color: #5f6f70; margin-bottom: 4px; }
    .fa-dates { display: flex; gap: 6px; align-items: center; }
    .fa-dates .form-control { min-width: 0; }
    .fa-dates .to { font-size: 13px; color: #5f6f70; }
    .fa-filter-foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 10px; font-size: 13px; color: #5f6f70; }
    @media (max-width: 767.98px) { .fa-filter-grid { grid-template-columns: minmax(0, 1fr); } }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class FaSubmissionsPage {
  private readonly api = inject(FaApi);
  private readonly user = inject(AuthService).currentUser;

  protected readonly isAdmin = computed(() => this.user()?.roleId === StaffRole.MasterAdmin);
  protected readonly isAgency = computed(() => this.user()?.roleId === StaffRole.Agency);
  protected readonly isAssessor = computed(() => this.user()?.roleId === StaffRole.DesktopAssessor);

  protected readonly tabs = [
    { status: FaStatus.New, label: 'FA ALLOTMENT', count: 'New' },
    { status: FaStatus.InProgress, label: 'IN-PROGRESS', count: 'InProgress' },
    { status: FaStatus.Qc, label: 'QC', count: 'Qc' },
    { status: FaStatus.Approved, label: 'APPROVED', count: 'Approved' },
    { status: FaStatus.Rejected, label: 'REJECTED', count: 'Rejected' },
  ] as const;

  protected readonly status = signal<number>(FaStatus.New);
  protected readonly rows = signal<FaSubmission[]>([]);
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  /** The search box above the list (any column). */
  protected readonly search = signal('');
  protected readonly view = new PagedView(() => searchRows(this.rows(), this.search()));
  protected readonly counts = signal<FaCounts>(NO_COUNTS);
  /** Filters (2026-11-08): level, agency (master admin) and registered-on dates; the tab counts follow them. */
  protected readonly levels = ['Bronze', 'Silver', 'Gold'];
  protected readonly filter = signal<FaFilter>(NO_FILTER);
  protected readonly agencyOptions = signal<UserOption[]>([]);
  protected readonly filtering = computed(() => Object.values(this.filter()).some((v) => !!v));
  protected readonly filterSummary = computed(() => {
    const f = this.filter();
    const agency = this.agencyOptions().find((a) => a.userId === f.agency)?.userName ?? f.agency;
    return [f.level, agency, f.from || f.to ? `registered ${f.from || '…'} to ${f.to || '…'}` : ''].filter((x) => !!x).join(' · ');
  });
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly dialog = signal<Dialog | null>(null);
  protected readonly dialogError = signal('');
  protected readonly saving = signal(false);

  /** Status and reason columns are shown on the allotment list only, as before. */
  protected readonly showStatusColumn = computed(() => this.status() === FaStatus.New);
  /** Legacy ng-hide="status>1 && status<5": the reason shows on FA ALLOTMENT and on REJECTED. */
  protected readonly showReasonColumn = computed(() => this.status() === FaStatus.New || this.status() === FaStatus.Rejected);

  constructor() {
    // Assessors only have their in-progress list (the old page had no tabs for them).
    void this.load(this.isAssessor() ? FaStatus.InProgress : FaStatus.New);
  }

  protected count(key: keyof FaCounts): number {
    return this.counts()[key] ?? 0;
  }

  protected async load(status: number): Promise<void> {
    this.status.set(status);
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await firstValueFrom(this.api.submissions(status, this.filter()));
      this.rows.set(data.rows ?? []);
      this.counts.set(data.counts ?? NO_COUNTS);
      if (data.agencies) this.agencyOptions.set(data.agencies);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected setFilter(key: keyof FaFilter, value: string): void {
    const f = { ...this.filter(), [key]: value ?? '' };
    if (f.from && f.to && f.from > f.to) {
      this.error.set("The 'from' date is after the 'to' date.");
      return;
    }
    this.filter.set(f);
    void this.load(this.status());
  }

  protected clearFilters(): void {
    this.filter.set(NO_FILTER);
    void this.load(this.status());
  }

  // ----- what each role may do with a row (mirrors the old page; the API decides) -----

  protected canAllot(r: FaSubmission): boolean {
    return this.isAdmin() && this.status() === FaStatus.New && !r.CertificationBodyUserId;
  }

  protected canReAllot(r: FaSubmission): boolean {
    return this.isAdmin() && this.status() === FaStatus.New && !!r.CertificationBodyUserId && (!r.FinancialAssessorId || !!r.ReasonForRejection);
  }

  protected canRespond(r: FaSubmission): boolean {
    return this.isAgency() && this.status() === FaStatus.New && !r.FinancialAssessorId && !r.ReasonForRejection;
  }

  protected canOpen(r: FaSubmission): boolean {
    if (this.isAssessor()) return true;
    if (this.isAgency()) return !!r.FinancialAssessorId && !r.ReasonForRejection;
    return !!r.FinancialAssessorId && this.status() !== FaStatus.Rejected;
  }

  protected assessorName(r: FaSubmission): string | null {
    return r.FaAssessorName ?? r.FinAssessorName;
  }

  // ----- dialogs -----

  protected async openAllot(row: FaSubmission): Promise<void> {
    await this.openWithOptions(row, 'allot', () => this.api.agencies(row.ZedId, row.CertificationType));
  }

  protected async openAccept(row: FaSubmission): Promise<void> {
    await this.openWithOptions(row, 'accept', () => this.api.assessors());
  }

  protected openReject(row: FaSubmission): void {
    this.success.set('');
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
      this.dialogError.set(d.kind === 'allot' ? 'Please select assessment agency.' : 'Please select valid data.');
      return;
    }
    if (d.kind === 'reject' && !d.reason.trim()) {
      this.dialogError.set('Please enter the reason for rejection.');
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
      this.success.set(r.message);
      await this.load(this.status());
    } catch (err) {
      this.dialogError.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  private async openWithOptions(row: FaSubmission, kind: 'allot' | 'accept', fetch: () => ReturnType<FaApi['assessors']>): Promise<void> {
    this.success.set('');
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
