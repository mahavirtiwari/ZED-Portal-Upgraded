import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { StaffRole } from '../../staff-menu';
import { TuApi, TuCounts, TuSubmission, TuTab, UserOption } from './tu.api';
import { PagedView, PagerComponent } from '../../pager';

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
 */
@Component({
  selector: 'zed-staff-tu-submissions',
  imports: [FormsModule, RouterLink, PagerComponent],
  templateUrl: './tu-submissions.html',
  styles: `
    table tbody tr td { font-size: 14px; }
    tr.rejected td { background-color: #f2dede; }
    .actions .btn { display: block; width: 150px; margin: 0 auto 6px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class TuSubmissionsPage {
  private readonly api = inject(TuApi);
  private readonly user = inject(AuthService).currentUser;

  protected readonly isAdmin = computed(() => this.user()?.roleId === StaffRole.MasterAdmin);
  protected readonly isAgency = computed(() => this.user()?.roleId === StaffRole.Agency);
  protected readonly isDfo = computed(() => this.user()?.roleId === StaffRole.DesktopAssessor);

  protected readonly tabs = [
    { status: TuTab.Allotment, label: 'TU ALLOTMENT', count: 'New' },
    { status: TuTab.InProgress, label: 'IN-PROGRESS', count: 'InProgress' },
    { status: TuTab.Qc, label: 'QC', count: 'Qc' },
    { status: TuTab.Approved, label: 'APPROVED', count: 'Approved' },
    { status: TuTab.Rejected, label: 'REJECTED', count: 'Rejected' },
  ] as const;

  protected readonly status = signal<number>(TuTab.Allotment);
  protected readonly rows = signal<TuSubmission[]>([]);
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly view = new PagedView(() => this.rows());
  protected readonly counts = signal<TuCounts>(NO_COUNTS);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly dialog = signal<Dialog | null>(null);
  protected readonly dialogError = signal('');
  protected readonly saving = signal(false);

  constructor() {
    void this.load(TuTab.Allotment);
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
    return this.isAdmin() && this.status() === TuTab.Allotment && !r.CertificationBodyUserId;
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

  protected dfoName(r: TuSubmission): string | null {
    return r.FaAssessorName ?? r.FinAssessorName;
  }

  protected reason(r: TuSubmission): string | null {
    return this.status() === TuTab.Rejected ? (r.ReasonForRejectionAgency ?? r.ReasonForRejection) : r.ReasonForRejection;
  }

  // ----- dialogs -----

  protected async openAllot(row: TuSubmission): Promise<void> {
    await this.openWithOptions(row, 'allot', () => this.api.agencies(row.ZedId));
  }

  protected async openAccept(row: TuSubmission): Promise<void> {
    await this.openWithOptions(row, 'accept', () => this.api.assessors());
  }

  protected openReject(row: TuSubmission): void {
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

  private async openWithOptions(row: TuSubmission, kind: 'allot' | 'accept', fetch: () => ReturnType<TuApi['assessors']>): Promise<void> {
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
