import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { AuthService, ClientConfigService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { StaffRole } from '../staff-menu';
import { DashboardApi, ListFilter, Row } from './dashboard.api';
import { flag, text } from './dashboard-filters';
import { ListFiltersBar } from './list-controls';
import { PORTAL_SYSTEM } from '../../portal-system';
import { PORTAL_LABELS } from '../../portal-labels';
import { staffProfileLink } from '../msme-profile/msme-profile';
import { PagerComponent, ServerPager } from '../pager';

/**
 * Registered MSMEs. Port of Views/Dashboard/RegisteredMsme.cshtml (paged by the procedure). SuperAdmin also
 * sees the assessment agency / Udyam number and can re-send the registration details (now a reset link) or
 * deactivate a unit. Profile and assessment details still open on the current portal.
 */
@Component({
  selector: 'zed-staff-registered-msme',
  imports: [FormsModule, DatePipe, RouterLink, ListFiltersBar, PagerComponent],
  templateUrl: './registered-msme.html',
  styles: `
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    .action-btn { width: 180px; }
  `,
})
export class RegisteredMsmePage {
  private readonly api = inject(DashboardApi);
  private readonly user = inject(AuthService).currentUser;

  protected readonly isSuperAdmin = computed(() => this.user()?.roleId === StaffRole.SuperAdmin);
  /** Agency / Udyam column: SuperAdmin, and MasterAdmin on Consultancy and Surveillance (the API sends it to both). */
  protected readonly showsAgency = computed(() => this.isSuperAdmin() || (!this.main && this.user()?.roleId === StaffRole.MasterAdmin));
  protected readonly main = PORTAL_SYSTEM === 'main';
  protected readonly consultancy = PORTAL_SYSTEM === 'consultancy';
  protected readonly surveillance = PORTAL_SYSTEM === 'surveillance';
  protected readonly agencyLabel = PORTAL_LABELS.agency;
  protected readonly searchFields = ['Zed Id', 'Udyam Number', 'Unit Name'];
  /** As the old pages: main and surveillance up to 1000 per page, consultancy up to 100. */
  protected readonly pageSizes = PORTAL_SYSTEM === 'consultancy' ? [10, 20, 50, 100] : [10, 20, 50, 100, 200, 1000];

  protected readonly filter = signal<ListFilter>({});
  protected searchBy = 'Zed Id';
  protected search = '';
  /** Paged by the procedure (PageNo / PageSize / TotalCounts). */
  protected readonly pager = new ServerPager(10, () => void this.load());

  protected readonly rows = signal<Row[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly legacyUrl = signal('');

  /** ZED IDs deactivated on this page (the row then shows DISABLED, as before). */
  protected readonly disabled = signal<ReadonlySet<string>>(new Set());
  protected readonly disabling = signal<Row | null>(null);
  protected disableRemarks = '';
  protected readonly saving = signal(false);
  protected readonly modalError = signal('');

  protected readonly text = text;
  protected readonly flag = flag;

  constructor() {
    inject(ClientConfigService).get().then((c) => this.legacyUrl.set(c.legacyPortalUrl)).catch(() => undefined);
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const r = await firstValueFrom(this.api.registeredMsme({
        ...this.filter(), searchBy: this.searchBy, search: this.search.trim(), pageNo: this.pager.pageNo(), pageSize: this.pager.pageSize(),
      }));
      this.rows.set(r.rows ?? []);
      this.pager.total.set(r.totalCounts ?? 0);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected onFilter(f: ListFilter): void {
    this.filter.set(f);
    this.pager.reset();
    void this.load();
  }

  protected doSearch(): void {
    this.pager.reset();
    void this.load();
  }

  protected status(row: Row): number {
    return Number(row['CertificationStatus'] ?? 0) || 0;
  }

  protected legacy(path: string): string {
    return this.legacyUrl() + path;
  }

  /** The staff profile page of this portal (it replaced the old portal's Msme/Profile). */
  protected profileUrl(row: Row): string {
    return staffProfileLink(text(row, 'ZedId'));
  }

  /** Assessment Details page (DA for status 1-6, SA for 9-16), or null. */
  protected assessmentLink(row: Row): string[] | null {
    const s = this.status(row);
    const ids = [text(row, 'ZedId'), text(row, 'Certification')];
    if (s > 0 && s <= 6) return ['/staff/assessment/da-details', ...ids];
    if (s >= 9 && s <= 16) return ['/staff/assessment/sa-details', ...ids];
    return null;
  }

  protected isDisabled(row: Row): boolean {
    return this.disabled().has(text(row, 'ZedId'));
  }

  protected async resend(row: Row): Promise<void> {
    this.message.set('');
    this.error.set('');
    try {
      this.message.set((await firstValueFrom(this.api.resend(text(row, 'ZedId')))).message);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }

  protected openDisable(row: Row): void {
    this.disableRemarks = '';
    this.modalError.set('');
    this.disabling.set(row);
  }

  protected async submitDisable(): Promise<void> {
    const row = this.disabling();
    if (!row || !this.disableRemarks.trim()) return;
    this.saving.set(true);
    this.modalError.set('');
    try {
      await firstValueFrom(this.api.disable(text(row, 'ZedId'), this.disableRemarks.trim()));
      this.disabled.update((s) => new Set([...s, text(row, 'ZedId')]));
      this.disabling.set(null);
    } catch (err) {
      this.modalError.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
