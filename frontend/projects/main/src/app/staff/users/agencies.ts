import { ContentTextComponent } from '../../content/content-text';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { AgencyLevel, AgencyRow, RESET_CONFIRM, SECTOR_ACTIVITIES, SectorActivity, UsersApi, agencyLevels, rowValue } from './users.api';
import { LABELS } from '../../portal-labels';
import { PagedView, PagerComponent } from '../pager';
import { STAFF_SYSTEM } from '../staff-menu';

/** 'levels': Agency level allocation (2026-11-08; before, the Bronze Assessment Agencies page). */
type Mode = 'all' | 'levels';
/** Which agencies the list shows: active / in-active (levels page: every level on / any level off). */
type StatusFilter = 'all' | 'on' | 'off';
/** Main: the sector type filter ('none' = not set yet). */
type SectorFilter = 'all' | SectorActivity | 'none';

interface Dialog {
  kind: 'block' | 'disable-level' | 'mobile';
  agency: AgencyRow;
  text: string;
  level?: { code: AgencyLevel; name: string };
}

/**
 * MasterAdmin list of assessment agencies. Port of Views/User/AssessmentAgencies.cshtml (block /
 * unblock, edit) and BronzeAssessmentAgencies.cshtml (enable / disable Bronze assessments); the
 * route's `data.mode` ('all' | 'bronze') picks the page. Actions are POSTs (the old page used GET links). V4 layout: the
 * counts on top, search with a status filter (and on Main a sector type filter with its counts), each agency with its
 * initials, ID and address, categories and sector type as chips, the status as a badge; a card per agency on phones.
 */
@Component({
  selector: 'zed-staff-agencies',
  imports: [FormsModule, RouterLink, PagerComponent, ContentTextComponent],
  templateUrl: './agencies.html',
  styles: `
    .ag-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .stat { background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; padding: 12px 16px; display: flex; flex-direction: column; min-width: 0; }
    .stat-value { font-size: 24px; font-weight: 700; color: #23474a; line-height: 1.2; }
    .stat-value.is-on { color: #1e7a3c; }
    .stat-value.is-off { color: #a8303a; }
    .stat-label { font-size: 13px; color: #5f6f70; }

    .list-card { padding: 16px; }
    .list-toolbar { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; margin-bottom: 12px; }
    .list-toolbar .search { flex: 1 1 260px; max-width: 380px; }
    .seg-group { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
    .seg-label { font-size: 13px; font-weight: 600; color: #5f6f70; }
    .seg { display: inline-flex; flex-wrap: wrap; border: 1px solid #cbd9da; border-radius: 8px; overflow: hidden; }
    .seg button { border: 0; background: #fff; color: #2f7c83; font-size: 13px; font-weight: 600; padding: 7px 12px; cursor: pointer; white-space: nowrap; }
    .seg button + button { border-left: 1px solid #cbd9da; }
    .seg button:hover { background: #eef6f6; }
    .seg button.active { background: #45a5ad; color: #fff; }
    .seg .n { font-weight: 400; opacity: .85; }

    .ag-table { min-width: 940px; margin-bottom: 8px; }
    .ag-table td { vertical-align: middle; overflow-wrap: anywhere; }
    .ag-table tbody tr:hover { background: #f7fbfb; }
    .ag-table tr.is-off .ag-name { color: #5f6f70; }
    .col-cat { width: 220px; }
    .col-count { width: 96px; }
    .col-status { width: 112px; }
    .col-actions { width: 300px; }
    .ag { display: flex; gap: 12px; align-items: flex-start; }
    .initials { flex: 0 0 38px; height: 38px; border-radius: 10px; background: #eef6f6; color: #2f7c83; display: grid; place-items: center; font-size: 14px; font-weight: 700; }
    tr.is-off .initials { background: #eef1f2; color: #8a9899; }
    .ag-text { min-width: 0; }
    .ag-name { display: block; font-weight: 700; color: #232527; }
    .ag-id { display: inline-block; margin: 1px 0 2px; font: 600 12px/1.5 SFMono-Regular, Consolas, 'Liberation Mono', monospace; color: #2f7c83; }
    .ag-text small { display: block; font-size: 13px; }
    .contact { margin-top: 4px; }
    .contact strong { color: #23474a; font-weight: 600; white-space: nowrap; }
    .contact > * + * { margin-left: 4px; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .chips .zed-chip { margin: 0; }
    .zed-chip.is-bronze { background: #f6ece0; color: #7a4a14; }
    .lv-stat-sub { font-size: 12px; color: #a8303a; margin-left: 6px; font-weight: 600; }
    .lv-stat-sub.none { color: #8a9899; font-weight: 400; }
    .lv-row { display: flex; flex-wrap: wrap; gap: 8px; }
    .lv { display: inline-flex; align-items: center; gap: 6px; border-radius: 8px; padding: 6px 12px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid; background: #fff; }
    .lv.on { background: #e8f5ec; color: #1e7a3c; border-color: #9ccfac; }
    .lv.on:hover { background: #d8eedf; }
    .lv.off { background: #fbeaec; color: #a8303a; border-color: #e5a9b0; }
    .lv.off:hover { background: #f6dade; }
    .lv:disabled { opacity: .6; cursor: default; }
    .lv-reasons { margin-top: 6px; font-size: 12px; color: #5f6f70; }
    .lv-reasons span { display: block; overflow-wrap: anywhere; }
    .col-levels { width: 420px; }
    .zed-chip.is-sector { background: #f1f0fb; color: #3f3a7a; }
    .zed-chip.is-unset { background: #fff4d6; color: #8a6100; }
    .count { font-size: 18px; font-weight: 700; color: #23474a; }
    .status-stack { display: flex; flex-direction: column; align-items: center; gap: 4px; }
    .no-data .btn { margin-top: 8px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }

    @media (max-width: 991.98px) { .ag-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    /* Phones: a card per agency. */
    @media (max-width: 767.98px) {
      .list-card { padding: 12px; }
      .list-toolbar .search { max-width: none; }
      .seg-group { flex-wrap: wrap; }
      .ag-table { min-width: 0; }
      .ag-table thead { display: none; }
      .ag-table, .ag-table tbody, .ag-table tr, .ag-table td { display: block; width: 100%; box-sizing: border-box; }
      .ag-table tr { border: 1px solid #dfe9ea; border-radius: 12px; margin-bottom: 12px; padding: 6px 12px; }
      .ag-table tr.empty-row { border: 0; padding: 0; }
      .ag-table td { border: 0 !important; padding: 6px 0; text-align: left !important; }
      .ag-table td[data-label]::before { content: attr(data-label); display: block; font-size: 12px; font-weight: 600; color: #5f6f70; margin-bottom: 2px; }
      .ag-table td.half { display: inline-block; width: 50%; vertical-align: top; }
      .status-stack { flex-direction: row; flex-wrap: wrap; justify-content: flex-start; }
      .row-actions { justify-content: flex-start !important; }
    }
  `,
})
export class AgenciesPage {
  private readonly api = inject(UsersApi);

  protected readonly mode: Mode = ['bronze', 'levels'].includes(inject(ActivatedRoute).snapshot.data['mode']) ? 'levels' : 'all';
  private readonly system = inject(STAFF_SYSTEM);
  protected readonly labels = LABELS[this.system];
  protected readonly title = this.mode === 'levels' ? 'Agency Level Allocation' : this.labels.agencies;
  protected readonly subtitle =
    this.mode === 'levels'
      ? 'Choose which certification levels each agency can be allotted. Disabling asks for a reason, and the agency gets an e-mail.'
      : `The ${this.labels.agencies.toLowerCase()} of the portal, with their SPOC and ${this.labels.assessors.toLowerCase()}.`;
  /** Every level (Administration → Certification Levels, the Admin's too; 2026-11-08), and any the server's rows name. */
  protected readonly levels = computed(() => agencyLevels(this.agencies()));
  /** Consultancy's list has no Category column and calls the agency a Consultant Organisation. */
  protected readonly consultancy = this.system === 'consultancy';

  protected readonly agencies = signal<AgencyRow[]>([]);
  protected readonly search = signal('');
  protected readonly status = signal<StatusFilter>('all');
  protected readonly sector = signal<SectorFilter>('all');
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly dialog = signal<Dialog | null>(null);
  protected readonly dialogError = signal('');
  protected readonly saving = signal(false);

  /** Of the whole list (not the filtered one). */
  protected readonly stats = computed(() => {
    const list = this.agencies();
    const on = list.filter((a) => this.active(a)).length;
    const assessors = list.reduce((n, a) => n + (a.NoOfUsers ?? 0), 0);
    return { total: list.length, on, off: list.length - on, assessors };
  });
  /** Levels page: per level, the agencies that may and may not be allotted it. */
  protected readonly levelStats = computed(() =>
    this.levels().map((l) => {
      const on = this.agencies().filter((a) => this.allowed(a, l.code)).length;
      return { ...l, on, off: this.agencies().length - on };
    }),
  );
  protected readonly statusFilters: { key: StatusFilter; label: string }[] =
    this.mode === 'levels'
      ? [{ key: 'all', label: 'All' }, { key: 'off', label: 'Any level off' }, { key: 'on', label: 'All levels on' }]
      : [{ key: 'all', label: 'All' }, { key: 'on', label: 'Active' }, { key: 'off', label: 'In-Active' }];
  protected readonly sectorFilters: { key: SectorFilter; label: string }[] = [
    { key: 'all', label: 'All' }, ...SECTOR_ACTIVITIES.map((a) => ({ key: a.value, label: a.label })), { key: 'none', label: 'Not set' },
  ];
  protected readonly sectorCounts = computed(() => {
    const counts: Record<SectorFilter, number> = { all: 0, Manufacturing: 0, Services: 0, Both: 0, none: 0 };
    for (const a of this.agencies()) {
      counts.all++;
      counts[a.SectorActivity ?? 'none']++;
    }
    return counts;
  });
  protected readonly filtering = computed(() => !!this.search().trim() || this.status() !== 'all' || this.sector() !== 'all');

  protected readonly filtered = computed(() => {
    const s = this.search().trim().toLowerCase();
    const status = this.status();
    const sector = this.sector();
    return this.agencies().filter(
      (a) =>
        (status === 'all' || this.active(a) === (status === 'on')) &&
        (sector === 'all' || (a.SectorActivity ?? 'none') === sector) &&
        (!s || [a.UserId, a.UserName, a.SpocName, a.MobileNo, a.Email, a.Address, a.IdStatus].some((v) => (v ?? '').toLowerCase().includes(s))),
    );
  });
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly view = new PagedView(() => this.filtered());

  constructor() {
    // Message of the form page after creating an agency.
    const message = (globalThis.history?.state as { message?: unknown } | null)?.message;
    if (typeof message === 'string') this.success.set(message);
    void this.load();
  }

  protected active(a: AgencyRow): boolean {
    return this.mode === 'levels' ? this.levels().every((l) => this.allowed(a, l.code)) : a.IsActive;
  }

  /** May this agency be allotted the level (not set = yes)? */
  protected allowed(a: AgencyRow, level: AgencyLevel): boolean {
    const field = this.levels().find((l) => l.code === level)?.field;
    return !field || rowValue(a, field) !== false;
  }

  protected reason(a: AgencyRow, level: AgencyLevel): string | null {
    const reasons = a.LevelReasons ?? {};
    return (rowValue(reasons, level) as string | null | undefined) || null;
  }

  /** A level switch: disabling asks for a reason; enabling asks to confirm. */
  protected async toggleLevel(a: AgencyRow, level: { code: AgencyLevel; name: string }): Promise<void> {
    if (this.allowed(a, level.code)) {
      this.success.set('');
      this.dialogError.set('');
      this.dialog.set({ kind: 'disable-level', agency: a, text: '', level: { code: level.code, name: level.name } });
      return;
    }
    if (!window.confirm(`Are you sure that you want to enable ${level.name} assessments for ${a.UserName}?`)) return;
    await this.run(this.api.levelAssessments(a.UserId, level.code, true, ''), false);
  }

  /** Up to two letters of the name for the row's badge (without Pvt, Ltd and the like). */
  protected initials(name: string): string {
    const words = (name ?? '').replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !/^(pvt|ltd|llp|co|of|the|and)$/i.test(w));
    return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '?';
  }

  protected categories(a: AgencyRow): string[] {
    return [a.DesktopVerfi, a.SiteVerifi, a.FinanceVerfi].filter((c): c is string => !!c);
  }

  protected clearFilters(): void {
    this.search.set('');
    this.status.set('all');
    this.sector.set('all');
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.agencies.set(await firstValueFrom(this.api.agencies()));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected open(kind: Dialog['kind'], agency: AgencyRow): void {
    this.success.set('');
    this.dialogError.set('');
    this.dialog.set({ kind, agency, text: kind === 'mobile' ? (agency.MobileNo ?? '') : '' });
  }

  protected close(): void {
    this.dialog.set(null);
  }

  protected async submitDialog(): Promise<void> {
    const d = this.dialog();
    if (!d) return;
    const text = d.text.trim();
    if (d.kind === 'mobile' ? !/^\d{10}$/.test(text) : !text) {
      this.dialogError.set(d.kind === 'mobile' ? 'Please enter a valid 10 digit mobile number.' : 'This is required.');
      return;
    }
    const id = d.agency.UserId;
    const call =
      d.kind === 'block'
        ? this.api.block('agencies', id, text)
        : d.kind === 'disable-level'
          ? this.api.levelAssessments(id, d.level!.code, false, text)
          : this.api.resetMobile('agencies', id, text);
    if (await this.run(call, true)) this.dialog.set(null);
  }

  protected async unblock(a: AgencyRow): Promise<void> {
    if (!window.confirm('Are you sure that you want to unblock?')) return;
    await this.run(this.api.unblock('agencies', a.UserId), false);
  }

  /** E-mails the agency a link to set a new password. */
  protected async sendReset(a: AgencyRow): Promise<void> {
    if (!window.confirm(RESET_CONFIRM)) return;
    await this.run(this.api.passwordReset('agencies', a.UserId), false);
  }

  private async run(call: Observable<MessageResponse>, inDialog: boolean): Promise<boolean> {
    this.saving.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const r = await firstValueFrom(call);
      this.success.set(r.message);
      await this.load();
      return true;
    } catch (err) {
      (inDialog ? this.dialogError : this.error).set(apiErrorMessage(err));
      return false;
    } finally {
      this.saving.set(false);
    }
  }
}
