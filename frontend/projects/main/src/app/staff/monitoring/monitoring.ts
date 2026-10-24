import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService, ClientConfigService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ASSESSMENT_SYSTEM } from '../assessment/assessment-shared';
import { MonitoringApi, MonitoringCounts, Row } from './monitoring.api';

type Action = { kind: 'extend'; unit: Row; days: number } | { kind: 'stepBack'; unit: Row } | { kind: 'sendBack'; unit: Row };

const NO_COUNTS: MonitoringCounts = { NotStarted: 0, InProgress: 0, Qc: 0, Nc: 0, Rj: 0 };

/**
 * "Assessment Monitoring" for MasterAdmin and agencies. Port of Views/Monitoring/Index.cshtml
 * (Monitoring/GetList; for MasterAdmin also ExtendNcClosureDate, StepBackToAssessor and
 * SendBackToAgencyForReAllot). Paging and the ZED ID search work on the loaded list, as before.
 * "Assessment Details" opens the new DA / SA review page (as before: SA once the status is above 7);
 * "View Profile" opens the staff MSME profile page.
 * <p>Consultancy ("Consultancy Monitoring"): Silver/Gold, tabs not started / in progress / quality check, milestone,
 * consultants and experts, BDS/HAP or progress-review dates; no NC closure filter and no master-admin actions (no NC
 * round; the step-back and send-back procedures are missing there). Surveillance ("Surveillance Monitoring"):
 * Surveillance No and surveillance dates; no duplicates column; "Extend NC Final Closure Date" also on the REJECTED tab,
 * as that portal's page offered it; no send back to the agency (procedure missing).</p>
 */
@Component({
  selector: 'zed-staff-monitoring',
  imports: [FormsModule, RouterLink],
  templateUrl: './monitoring.html',
  styles: `
    table tbody tr td { font-size: 14px; }
    .yellow-background { background-color: yellow; }
    .action-btn { width: 180px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class MonitoringPage {
  private readonly api = inject(MonitoringApi);
  private readonly legacyUrl = signal('');
  private readonly system = inject(ASSESSMENT_SYSTEM);
  protected readonly main = this.system === 'main';
  protected readonly consultancy = this.system === 'consultancy';
  protected readonly surveillance = this.system === 'surveillance';
  protected readonly title = this.consultancy ? 'Consultancy Monitoring' : this.surveillance ? 'Surveillance Monitoring' : 'Assessment Monitoring';

  protected readonly levels = this.consultancy ? ['Silver', 'Gold'] : ['Bronze', 'Silver', 'Gold'];
  protected readonly tabs: readonly { status: number; label: string; count: keyof MonitoringCounts }[] = this.consultancy
    ? [
        { status: 2, label: 'SCHEDULED BUT NOT STARTED', count: 'NotStarted' },
        { status: 3, label: 'CONSULTANCY IN-PROGRESS', count: 'InProgress' },
        { status: 5, label: 'QUALITY CHECK', count: 'Qc' },
      ]
    : [
        { status: 2, label: 'SCHEDULED BUT NOT STARTED', count: 'NotStarted' },
        { status: 3, label: this.surveillance ? 'IN-PROGRESS' : 'ASSESSMENT IN-PROGRESS', count: 'InProgress' },
        { status: 5, label: 'QUALITY CHECK', count: 'Qc' },
        { status: 4, label: 'NON-CONFORMANCE', count: 'Nc' },
        { status: 7, label: 'REJECTED', count: 'Rj' },
      ];
  protected readonly pageSizes = [10, 20, 50, 100];
  protected readonly extendDays = Array.from({ length: 30 }, (_, i) => i + 1);

  protected readonly certification = signal('');
  protected readonly status = signal<number | null>(null);
  protected readonly ncClosingDate = signal('');
  protected readonly search = signal('');
  protected readonly all = signal<Row[]>([]);
  protected readonly counts = signal<MonitoringCounts>(NO_COUNTS);
  // The server says so with each list; until the first list (no certification level chosen yet), the role decides,
  // as the old page's header did (MasterAdmin: "Assessment Dates / NC Closure Date").
  protected readonly canManage = signal(inject(AuthService).currentUser()?.roleId === 7);
  protected readonly pageSize = signal(10);
  protected readonly pageNo = signal(1);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly action = signal<Action | null>(null);
  protected readonly actionError = signal('');

  /** The old page matched the search text anywhere in the row (JSON.stringify(row).indexOf(text)). */
  protected readonly filtered = computed(() => {
    const text = this.search().trim();
    return text ? this.all().filter((r) => JSON.stringify(r).includes(text)) : this.all();
  });
  protected readonly lastPage = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize())));
  protected readonly pages = computed(() => Array.from({ length: this.lastPage() }, (_, i) => i + 1));
  protected readonly page = computed(() => {
    const start = (this.pageNo() - 1) * this.pageSize();
    return this.filtered().slice(start, start + this.pageSize());
  });

  constructor() {
    inject(ClientConfigService).get().then((c) => this.legacyUrl.set(c.legacyPortalUrl)).catch(() => undefined);
  }

  protected setCertification(value: string): void {
    this.certification.set(value);
    void this.load();
  }

  protected setStatus(value: number): void {
    this.status.set(value);
    this.ncClosingDate.set('');
    void this.load();
  }

  protected setSearch(value: string): void {
    this.search.set(value);
    this.pageNo.set(1);
  }

  protected setPageSize(value: number | string): void {
    this.pageSize.set(Number(value));
    this.pageNo.set(1);
  }

  protected goTo(p: number | string): void {
    this.pageNo.set(Math.min(Math.max(1, Number(p)), this.lastPage()));
  }

  protected async load(): Promise<void> {
    if (!this.certification()) return;
    this.loading.set(true);
    this.error.set('');
    this.search.set('');
    try {
      const data = await firstValueFrom(
        this.api.list({
          certification: this.certification(),
          status: this.status(),
          ncClosingDate: !this.consultancy && this.status() === 4 ? this.ncClosingDate() || null : null,
        }),
      );
      this.all.set(data.units ?? []);
      this.counts.set(data.counts ?? NO_COUNTS);
      this.canManage.set(!!data.canManage);
      this.pageNo.set(1);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  // ----- row helpers -----

  protected num(r: Row, field: string): number {
    return Number(r[field] ?? 0) || 0;
  }

  protected countOf(key: keyof MonitoringCounts): number {
    return this.counts()[key] ?? 0;
  }

  protected highlighted(r: Row): boolean {
    const cs = this.num(r, 'CertificationStatus');
    return this.num(r, 'NcStatus') === 2 && (cs === 4 || cs === 14);
  }

  /** Main only: the re-allocation procedure is missing in the consultancy and surveillance databases. */
  protected canSendBack(r: Row): boolean {
    if (!this.main) return false;
    const cs = this.num(r, 'CertificationStatus');
    return ((this.status() === 2 && cs === 8) || (this.status() === 3 && cs === 9)) && this.certification() !== 'Bronze';
  }

  protected profileLink(r: Row): string {
    return `staff/msme-profile/${encodeURIComponent(String(r['ZedId'] ?? ''))}`;
  }

  /** The review page of the unit: the site assessment page once the site stage started (status above 7). */
  protected detailsLink(r: Row): string[] {
    // Consultancy: the milestone review page of the unit's current milestone.
    if (this.system === 'consultancy') return ['/staff/consultancy/milestones', String(r['ZedId'] ?? ''), String(r['Certification'] ?? '')];
    const page = this.num(r, 'CertificationStatus') > 7 ? 'sa-details' : 'da-details';
    return ['/staff/assessment', page, String(r['ZedId'] ?? ''), String(r['Certification'] ?? '')];
  }

  // ----- master admin actions -----

  protected open(a: Action): void {
    this.success.set('');
    this.actionError.set('');
    this.action.set(a);
  }

  protected close(): void {
    this.action.set(null);
  }

  protected async submit(a: Action): Promise<void> {
    const zedId = String(a.unit['ZedId']);
    const certification = String(a.unit['Certification']);
    this.loading.set(true);
    this.actionError.set('');
    try {
      const res = await firstValueFrom(
        a.kind === 'extend'
          ? this.api.extendNcClosure(zedId, certification, Number(a.days))
          : a.kind === 'stepBack'
            ? this.api.stepBackNc(zedId, certification)
            : this.api.sendBackToAgency(zedId, certification),
      );
      this.action.set(null);
      this.success.set(`${zedId}: ${res.message}`);
    } catch (err) {
      this.actionError.set(apiErrorMessage(err));
      return;
    } finally {
      this.loading.set(false);
    }
    await this.load();
  }
}
