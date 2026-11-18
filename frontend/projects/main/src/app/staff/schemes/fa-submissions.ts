import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { StaffRole } from '../staff-menu';
import { FaApi, FaCounts, FaFilter, FaStatus, FaSubmission, UserOption } from './fa.api';
import { PagedView, PagerComponent, searchRows } from '../pager';
import { levelCodes, levelName } from '../../msme/shared/levels';
import { PageHead } from '../../msme/shared/page-head';
import { staffCrumbs } from '../staff-crumbs';
import { ChipFilter, FilterChip } from '../chip-filter';
import { RowMenu, RowMenuItem } from '../row-menu';
import { ToastService } from '../toast';

type RowAction = 'allot' | 'reallot' | 'accept' | 'reject' | 'open';

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
 * <p>2026-11-17 (approved redesign): the stage tabs as chips with their counts, search and filters in one row, the unit as
 * name over ZED ID, one "Certificate claimed" column (name; category · certifying body), and per row one button (Allot,
 * Re-allot, Accept or View details) with the other actions in the ⋮ menu; each action keeps its pop-up and reason. The
 * verification date shows only when the list has one. The design's days badge is not shown: the list has no date of
 * entering a stage (RegisteredDate is the unit's registration).</p>
 */
@Component({
  selector: 'zed-staff-fa-submissions',
  imports: [FormsModule, RouterLink, PagerComponent, PageHead, ChipFilter, RowMenu],
  host: { class: 'list-v2 d-block' },
  templateUrl: './fa-submissions.html',
  styles: `
    /* 2026-11-18 (the user: staff pages 'not aligned with SVG files'): staff-16 — the stage chips without the "Stage" label, one
       filter row of fixed widths (search 300, levels 170, agencies 240, date 220) with the rest of the row left empty. */
    .fa-tabs { display: block; margin-bottom: 14px; }
    .fa-tabs ::ng-deep .cf-label { display: none; }
    .zed-chip.is-auto { background: #e7f3f4; color: #2f6f75; margin: 0 0 0 4px; }
    .fa-filters { padding: 11px 15px; margin-bottom: 16px; }
    .fa-row { display: flex; flex-wrap: wrap; gap: 12px 16px; align-items: center; }
    .fa-q { position: relative; flex: 0 1 300px; margin: 0; }
    .fa-q svg { position: absolute; left: 12px; top: 50%; width: 16px; height: 16px; transform: translateY(-50%); fill: none; stroke: #6f8487;
      stroke-width: 2; stroke-linecap: round; pointer-events: none; }
    .fa-q .form-control { width: 100%; padding-left: 36px; padding-right: 12px; background-image: none; }
    .fa-row .form-select, .fa-q .form-control { height: 38px; border: 1.2px solid #b9cdcf; border-radius: 9px; font-size: 13px; }
    .fa-row .form-select { color: #17373b; font-weight: 500; }
    .fa-level { flex: 0 1 170px; }
    .fa-agency { flex: 0 1 240px; }
    .fa-when { flex: 0 1 220px; }
    .fa-dates { display: flex; gap: 6px; align-items: center; flex: 0 1 320px; }
    .fa-dates .form-control { min-width: 0; height: 38px; }
    .fa-dates .to { font-size: 13px; color: #5f6f70; }
    .fa-filter-foot { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; margin-top: 10px; font-size: 13px; color: #5f6f70; }
    .fa-addr { max-width: 260px; }
    .fa-cert { min-width: 180px; }
    .fa-reason { min-width: 160px; max-width: 300px; white-space: pre-wrap; }
    tr.fa-rej > td:first-child { box-shadow: inset 3px 0 0 #d64532; }
    .fa-act { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
    .fa-modal { border-radius: 12px; }
    .fa-x { font-size: 24px; line-height: 1; color: #5f6f70 !important; text-decoration: none; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class FaSubmissionsPage {
  private readonly api = inject(FaApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly user = inject(AuthService).currentUser;
  protected readonly crumbs = staffCrumbs({ label: 'Financial Assistance' });

  protected readonly isAdmin = computed(() => this.user()?.roleId === StaffRole.MasterAdmin);
  protected readonly isAgency = computed(() => this.user()?.roleId === StaffRole.Agency);
  protected readonly isAssessor = computed(() => this.user()?.roleId === StaffRole.DesktopAssessor);

  protected readonly tabs = [
    { status: FaStatus.New, label: 'FA allotment', count: 'New' },
    { status: FaStatus.InProgress, label: 'In-progress', count: 'InProgress' },
    { status: FaStatus.Qc, label: 'QC', count: 'Qc' },
    { status: FaStatus.Approved, label: 'Approved', count: 'Approved' },
    { status: FaStatus.Rejected, label: 'Rejected', count: 'Rejected' },
  ] as const;
  /** The stage tabs as chips, with the counts of the (filtered) lists. */
  protected readonly chips = computed<FilterChip[]>(() => this.tabs.map((t) => ({ key: String(t.status), label: t.label, count: this.counts()[t.count] ?? 0 })));

  protected readonly status = signal<number>(FaStatus.New);
  protected readonly rows = signal<FaSubmission[]>([]);
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  /** The search box above the list (any column). */
  protected readonly search = signal('');
  protected readonly view = new PagedView(() => searchRows(this.rows(), this.search()));
  protected readonly counts = signal<FaCounts>(NO_COUNTS);
  /** Filters (2026-11-08): level, agency (master admin) and registered-on dates; the tab counts follow them. */
  /** Every level of Administration → Certification Levels (the Admin's too, 2026-11-08). */
  protected readonly levels = computed(() => levelCodes());
  protected readonly levelName = levelName;
  protected readonly filter = signal<FaFilter>(NO_FILTER);
  protected readonly agencyOptions = signal<UserOption[]>([]);
  /** 2026-11-18 (the user: staff pages 'not aligned with SVG files'): one "Registered" dropdown (staff-16) in place of the two
   *  date boxes; a period sets "from" to that many days back, "Custom dates…" shows the two boxes. */
  protected readonly whenOptions = [
    { key: '', label: 'Registered: any date' },
    { key: '7', label: 'Registered: last 7 days' },
    { key: '30', label: 'Registered: last 30 days' },
    { key: '90', label: 'Registered: last 90 days' },
    { key: '365', label: 'Registered: last 12 months' },
    { key: 'custom', label: 'Registered: custom dates…' },
  ] as const;
  protected readonly when = signal<string>('');
  protected readonly filtering = computed(() => Object.values(this.filter()).some((v) => !!v));
  protected readonly filterSummary = computed(() => {
    const f = this.filter();
    const agency = this.agencyOptions().find((a) => a.userId === f.agency)?.userName ?? f.agency;
    return [levelName(f.level), agency, f.from || f.to ? `registered ${f.from || '…'} to ${f.to || '…'}` : ''].filter((x) => !!x).join(' · ');
  });
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly dialog = signal<Dialog | null>(null);
  protected readonly dialogError = signal('');
  protected readonly saving = signal(false);

  /** Status and reason columns are shown on the allotment list only, as before. */
  protected readonly showStatusColumn = computed(() => this.status() === FaStatus.New);
  /** 2026-11-18 (the user: staff pages 'not aligned with SVG files'): the reason column only on Rejected (staff-16); on FA allotment
   *  an agency's reason is the "Rejected" status chip's tooltip. */
  protected readonly showReasonColumn = computed(() => this.status() === FaStatus.Rejected);
  /** The verification date only on a list that has one. */
  protected readonly showVerificationColumn = computed(() => this.rows().some((r) => !!r.VerificationDate));

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

  /** The "Registered" dropdown: a period back from today, any date, or the custom date boxes. */
  protected setWhen(key: string): void {
    this.when.set(key ?? '');
    if (key === 'custom') return;
    const days = Number(key);
    let from = '';
    if (days > 0) {
      const d = new Date();
      d.setDate(d.getDate() - days);
      from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    this.filter.set({ ...this.filter(), from, to: '' });
    void this.load(this.status());
  }

  protected clearFilters(): void {
    this.when.set('');
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

  /** "Certificate claimed": its category and certifying body under the name. */
  protected certificateLine(r: FaSubmission): string {
    return [r.CategoryOfCertificate, r.CertificationAgency].filter((x) => !!x?.trim()).join(' · ');
  }

  /** The row's actions: the first is its button, the others are in the ⋮ menu. */
  protected actions(r: FaSubmission): (RowMenuItem & { key: RowAction })[] {
    const list: (RowMenuItem & { key: RowAction })[] = [];
    if (this.canAllot(r)) list.push({ key: 'allot', label: 'Allot', icon: 'people' });
    if (this.canReAllot(r)) list.push({ key: 'reallot', label: 'Re-allot', icon: 'refresh' });
    if (this.canRespond(r)) {
      list.push({ key: 'accept', label: 'Accept', icon: 'people' });
      list.push({ key: 'reject', label: 'Reject', icon: 'trash', danger: true });
    }
    if (this.canOpen(r)) list.push({ key: 'open', label: this.isAssessor() ? 'Assess' : 'View details', icon: 'eye' });
    return list;
  }

  protected act(r: FaSubmission, key: string): void {
    switch (key as RowAction) {
      case 'allot':
      case 'reallot': void this.openAllot(r); break;
      case 'accept': void this.openAccept(r); break;
      case 'reject': this.openReject(r); break;
      case 'open': void this.router.navigate(['/staff/financial-assistance', r.ZedId], { queryParams: { certification: r.CertificationType } }); break;
    }
  }

  // ----- dialogs -----

  protected async openAllot(row: FaSubmission): Promise<void> {
    await this.openWithOptions(row, 'allot', () => this.api.agencies(row.ZedId, row.CertificationType));
  }

  protected async openAccept(row: FaSubmission): Promise<void> {
    await this.openWithOptions(row, 'accept', () => this.api.assessors());
  }

  protected openReject(row: FaSubmission): void {
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
      this.toast.success(r.message);
      await this.load(this.status());
    } catch (err) {
      this.dialogError.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  private async openWithOptions(row: FaSubmission, kind: 'allot' | 'accept', fetch: () => ReturnType<FaApi['assessors']>): Promise<void> {
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
