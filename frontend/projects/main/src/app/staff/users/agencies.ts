import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { ContentService, fillText } from '../../content/content-text';
import { PageHead } from '../../msme/shared/page-head';
import { LABELS } from '../../portal-labels';
import { ChipFilter, FilterChip } from '../chip-filter';
import { ConfirmAsk, ConfirmDialog } from '../confirm-dialog';
import { ListCount, ListCounts } from '../list-counts';
import { PagedView, PagerComponent } from '../pager';
import { RowMenu, RowMenuItem } from '../row-menu';
import { staffCrumbs } from '../staff-crumbs';
import { STAFF_SYSTEM } from '../staff-menu';
import { ToastService } from '../toast';
import { HistoryItem, UserHistoryPanel, blockHistoryItems } from './history-panel';
import { ReasonAsk, ReasonDialog } from './reason-dialog';
import { initialsOf, maskEmail, maskMobile, resetLinkAsk, sentTo } from './user-display';
import { AgencyLevel, AgencyRow, SECTOR_ACTIVITIES, SectorActivity, UsersApi, agencyLevels, rowValue } from './users.api';

/** 'levels': Agency level allocation (2026-11-08; before, the Bronze Assessment Agencies page). */
type Mode = 'all' | 'levels';
/** Which agencies the list shows: active / in-active (levels page: every level on / any level off). */
type StatusFilter = 'all' | 'on' | 'off';
/** Main: the sector type filter ('none' = not set yet). */
type SectorFilter = 'all' | SectorActivity | 'none';

/** A confirmation of the page: block, send a reset link, or turn a level on / off. */
interface Pending {
  kind: 'block' | 'reset' | 'level';
  agency: AgencyRow;
  ask: ConfirmAsk;
  level?: { code: AgencyLevel; name: string; allow: boolean };
}

const DISABLE_NOTE_KEY = 'staff.users.agencyLevel.disableNote';

/**
 * MasterAdmin list of assessment agencies. Port of Views/User/AssessmentAgencies.cshtml (block / unblock, edit) and
 * BronzeAssessmentAgencies.cshtml (enable / disable the levels); the route's `data.mode` ('all' | 'levels') picks the page.
 * 2026-11-17 (approved staff redesign, staff-01 / staff-03, pop-ups 01, 03, 04, 08, 09): counts that filter, chip filters,
 * a light table where each row has Edit and Assessors plus a ⋮ menu (reset link, history, block / unblock, each confirmed),
 * the SPOC mobile and e-mail masked (full on the agency's page), toasts for completed actions; the levels page has one
 * switch per level in its own column: on asks to confirm, off asks for the reason (e-mailed to the agency).
 */
@Component({
  selector: 'zed-staff-agencies',
  imports: [FormsModule, RouterLink, PagerComponent, PageHead, ReasonDialog, ConfirmDialog, ListCounts, ChipFilter, RowMenu, UserHistoryPanel],
  templateUrl: './agencies.html',
  styles: `
    .ag-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; padding: 12px 16px; margin-bottom: 16px; }
    .ag-search { position: relative; flex: 1 1 260px; max-width: 340px; }
    .ag-search svg { position: absolute; left: 12px; top: 50%; width: 16px; height: 16px; transform: translateY(-50%); fill: none; stroke: #7b8b8c; stroke-width: 2; }
    .ag-search input { padding-left: 36px; height: 38px; border-radius: 8px; }
    .ag-card { padding: 0; overflow: hidden; }
    .ag-table { min-width: 960px; margin: 0; }
    .ag-table td { vertical-align: middle; overflow-wrap: anywhere; }
    .ag-table tr.is-off .ag-name { color: #5f6f70; }
    .ag { display: flex; gap: 12px; align-items: flex-start; }
    .initials { flex: 0 0 34px; height: 34px; border-radius: 50%; background: #e6f1ef; color: var(--zt-ink, #173f44); display: grid; place-items: center; font-size: 12.5px; font-weight: 700; }
    tr.is-off .initials { background: #eef1f2; color: #8a9899; }
    .ag-text { min-width: 0; display: flex; flex-direction: column; font-size: 12.5px; color: #5f6f70; }
    .ag-name { font-size: 14px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .spoc { display: flex; flex-direction: column; font-size: 12.5px; color: #5f6f70; }
    .spoc strong { font-size: 14px; color: var(--zt-ink, #173f44); }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .chips span { padding: 3px 10px; border-radius: 12px; background: #e6f1ef; color: var(--zt-ink, #173f44); font-size: 12px; font-weight: 600; }
    .chips .is-sector { background: #eef1f2; color: #4f6061; }
    .chips .is-unset { background: #fff4d6; color: #8a6100; }
    .count { font-size: 15px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .acts { display: flex; gap: 8px; align-items: center; justify-content: flex-end; }
    .acts .btn { height: 34px; padding: 0 14px; display: inline-flex; align-items: center; font-weight: 600; }
    .lv-cell { text-align: center; }
    .sw { position: relative; width: 40px; height: 22px; border: 0; border-radius: 11px; background: #d5dcdd; padding: 0; transition: background .15s; }
    .sw::after { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left .15s; }
    .sw.on { background: #2e9e57; }
    .sw.on::after { left: 21px; }
    .sw:focus-visible { outline: 2px solid var(--zt-mid2, #2a8a8c); outline-offset: 2px; }
    .sw:disabled { opacity: .6; }
    .lv-state { display: block; font-size: 12px; color: #5f6f70; margin-top: 2px; }
    .lv-why { display: block; max-width: 160px; margin: 2px auto 0; font-size: 11.5px; color: #8a6100; }
    .no-data .btn { margin-top: 8px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    @media (max-width: 767.98px) {
      .ag-search { max-width: none; }
      .ag-table { min-width: 0; }
      .ag-table thead { display: none; }
      .ag-table, .ag-table tbody, .ag-table tr, .ag-table td { display: block; width: 100%; box-sizing: border-box; }
      .ag-table tr { border-bottom: 1px solid #e1eaea; padding: 8px 14px; }
      .ag-table td { border: 0 !important; padding: 5px 0; text-align: left !important; }
      .ag-table td[data-label]::before { content: attr(data-label); display: block; font-size: 11.5px; font-weight: 700; color: #5f6f70; text-transform: uppercase; }
      .ag-table td.half { display: inline-block; width: 50%; vertical-align: top; }
      .acts { justify-content: flex-start; }
      .lv-why { margin: 2px 0 0; }
    }
  `,
})
export class AgenciesPage {
  private readonly api = inject(UsersApi);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly content = inject(ContentService);

  protected readonly mode: Mode = ['bronze', 'levels'].includes(inject(ActivatedRoute).snapshot.data['mode']) ? 'levels' : 'all';
  private readonly system = inject(STAFF_SYSTEM);
  protected readonly labels = LABELS[this.system];
  protected readonly title = this.mode === 'levels' ? 'Agency Level Allocation' : this.labels.agencies;
  protected readonly crumbs = staffCrumbs({ label: this.title });
  protected readonly subtitle = this.mode === 'levels' ? 'Choose which certification levels each agency can be allotted.' : null;
  /** Every level (Administration → Certification Levels, the Admin's too; 2026-11-08), and any the server's rows name. */
  protected readonly levels = computed(() => agencyLevels(this.agencies()));
  /** Consultancy's list has no Category column and calls the agency a Consultant Organisation. */
  protected readonly consultancy = this.system === 'consultancy';
  protected readonly word = this.consultancy ? 'organisation' : 'agency';

  protected readonly agencies = signal<AgencyRow[]>([]);
  protected readonly search = signal('');
  protected readonly status = signal<StatusFilter>('all');
  protected readonly sector = signal<SectorFilter>('all');
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly saving = signal(false);
  /** The open confirmation and the server's refusal shown in it. */
  protected readonly pending = signal<Pending | null>(null);
  protected readonly failed = signal('');
  /** 2026-11-16 (the user): an unblock asks for its reason (recorded and e-mailed to the user). */
  protected readonly reasonAsk = signal<ReasonAsk | null>(null);
  /** The history side panel (popup-08): the agency and its entries (null while loading). */
  protected readonly history = signal<{ agency: AgencyRow; items: HistoryItem[] | null; error: string } | null>(null);

  /** Of the whole list (not the filtered one). */
  protected readonly stats = computed(() => {
    const list = this.agencies();
    const on = list.filter((a) => this.active(a)).length;
    const assessors = list.reduce((n, a) => n + (a.NoOfUsers ?? 0), 0);
    return { total: list.length, on, off: list.length - on, assessors };
  });
  protected readonly counts = computed<ListCount[]>(() => {
    if (this.mode === 'levels') {
      return this.levels().map((l) => {
        const on = this.agencies().filter((a) => this.allowed(a, l.code)).length;
        return { key: 'level-' + l.code, label: `${l.name} enabled`, value: on, sub: `${this.agencies().length - on} off` };
      });
    }
    const s = this.stats();
    return [
      { key: 'all', label: this.consultancy ? 'Organisations' : 'Agencies', value: s.total },
      { key: 'on', label: 'Active', value: s.on, tone: 'good' },
      { key: 'off', label: 'In-active', value: s.off, tone: 'bad' },
      { key: 'assessors', label: this.labels.assessors, value: s.assessors },
    ];
  });
  protected readonly statusChips: FilterChip[] =
    this.mode === 'levels'
      ? [{ key: 'all', label: 'All' }, { key: 'off', label: 'Any level off' }, { key: 'on', label: 'All levels on' }]
      : [{ key: 'all', label: 'All' }, { key: 'on', label: 'Active' }, { key: 'off', label: 'In-active' }];
  protected readonly sectorChips = computed<FilterChip[]>(() => {
    const counts: Record<SectorFilter, number> = { all: 0, Manufacturing: 0, Services: 0, Both: 0, none: 0 };
    for (const a of this.agencies()) {
      counts.all++;
      counts[a.SectorActivity ?? 'none']++;
    }
    return [{ key: 'all', label: 'All' }, ...SECTOR_ACTIVITIES.map((a) => ({ key: a.value, label: a.label })), { key: 'none', label: 'Not set' }]
      .map((c) => ({ ...c, count: counts[c.key as SectorFilter] }));
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
  protected readonly maskEmail = maskEmail;
  protected readonly maskMobile = maskMobile;
  protected readonly initials = initialsOf;

  constructor() {
    // Message of the form page after creating an agency.
    const message = (globalThis.history?.state as { message?: unknown } | null)?.message;
    if (typeof message === 'string') this.toast.success(message);
    if (this.mode === 'levels') this.disableNote({ UserName: '' } as AgencyRow, ''); // starts loading the Admin's texts
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

  protected categories(a: AgencyRow): string[] {
    return [a.DesktopVerfi, a.SiteVerifi, a.FinanceVerfi].filter((c): c is string => !!c);
  }

  protected setStatus(key: string): void {
    this.status.set(key as StatusFilter);
  }

  protected setSector(key: string): void {
    this.sector.set(key as SectorFilter);
  }

  /** A tile: the status tiles filter; Assessors opens their list. */
  protected pickCount(c: ListCount): void {
    if (c.key === 'assessors') void this.router.navigateByUrl('/staff/users/assessors');
    else this.status.set((c.key ?? 'all') as StatusFilter);
  }

  protected clearFilters(): void {
    this.search.set('');
    this.status.set('all');
    this.sector.set('all');
  }

  protected menu(a: AgencyRow): RowMenuItem[] {
    const assessors = this.consultancy ? 'View consultants' : `View ${this.labels.assessors.toLowerCase()}`;
    const items: RowMenuItem[] = [
      { key: 'edit', label: `Edit ${this.word}`, icon: 'edit' },
      { key: 'assessors', label: assessors, icon: 'people' },
    ];
    if (a.IsActive) items.push({ key: 'reset', label: 'Send reset link', icon: 'mail' });
    items.push({ key: 'history', label: 'View history', icon: 'history' });
    items.push(a.IsActive ? { key: 'block', label: `Block ${this.word}`, icon: 'lock', danger: true } : { key: 'unblock', label: `Unblock ${this.word}`, icon: 'unlock' });
    return items;
  }

  protected picked(a: AgencyRow, key: string): void {
    switch (key) {
      case 'edit': void this.router.navigate(['/staff/users/agencies', a.UserId]); break;
      case 'assessors': void this.router.navigate(['/staff/users/assessors'], { queryParams: { agencyId: a.UserId } }); break;
      case 'reset': this.ask({ kind: 'reset', agency: a, ask: resetLinkAsk(a.UserName, a.UserId, a.Email) }); break;
      case 'history': void this.openHistory(a); break;
      case 'block': this.ask({ kind: 'block', agency: a, ask: this.blockAsk(a) }); break;
      case 'unblock': this.reasonAsk.set({ action: 'unblock', userId: a.UserId, userName: a.UserName ?? null }); break;
    }
  }

  /** popup-03: what blocking does, in plain words, and a required reason. */
  private blockAsk(a: AgencyRow): ConfirmAsk {
    return {
      title: `Block ${a.UserName || a.UserId}?`,
      message: `${a.UserName || a.UserId} (${a.UserId}) cannot sign in until it is unblocked. Nothing is deleted; you can unblock the ${this.word} at any time. ` +
        `The reason is kept in its history and e-mailed to the ${this.word}.`,
      confirmLabel: `Block ${this.word}`,
      danger: true,
      reason: { label: 'Reason for blocking', placeholder: `Shown in the ${this.word}'s history`, maxLength: 2000 },
    };
  }

  /** A level switch (popup-09): turning it on confirms; turning it off asks for the reason, which is e-mailed to the agency. */
  protected toggleLevel(a: AgencyRow, level: { code: AgencyLevel; name: string }): void {
    const allow = !this.allowed(a, level.code);
    const n = level.name;
    const ask: ConfirmAsk = allow
      ? {
          title: `Turn on ${n} for this agency?`,
          message: `${a.UserName} (${a.UserId}) can be allotted new ${n} assessments again.`,
          confirmLabel: `Turn on ${n}`,
          cancelLabel: `Keep ${n} off`,
        }
      : {
          title: `Turn off ${n} for this agency?`,
          message: [this.disableNote(a, n), `You can turn ${n} back on at any time. The reason is e-mailed to the agency.`].filter(Boolean).join(' '),
          confirmLabel: `Turn off ${n}`,
          cancelLabel: `Keep ${n} on`,
          reason: { label: 'Reason', placeholder: `Why ${n} assessments are turned off`, maxLength: 2000 },
        };
    this.ask({ kind: 'level', agency: a, ask, level: { code: level.code, name: n, allow } });
  }

  /** The Admin's text (Admin → Texts, staff.users.agencyLevel.disableNote) as plain text; '' when the Admin hid it. */
  private disableNote(a: AgencyRow, level: string): string {
    const t = this.content.text(DISABLE_NOTE_KEY);
    if (t && !t.enabled) return '';
    if (t?.html) {
      const html = fillText(t.html, { Agency: a.UserName, Level: level });
      const plain = typeof DOMParser !== 'undefined' ? new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '' : html.replace(/<[^>]*>/g, ' ');
      return plain.replace(/\s+/g, ' ').trim();
    }
    return `${a.UserName} won't be allotted new ${level} assessments. Work already allotted continues.`;
  }

  private ask(p: Pending): void {
    this.failed.set('');
    this.pending.set(p);
  }

  /** The confirmation's answer: the call, then a toast; a refusal stays in the pop-up. */
  protected async confirmed(reason: string): Promise<void> {
    const p = this.pending();
    if (!p) return;
    const id = p.agency.UserId;
    const call =
      p.kind === 'block' ? this.api.block('agencies', id, reason)
      : p.kind === 'reset' ? this.api.passwordReset('agencies', id)
      : this.api.levelAssessments(id, p.level!.code, p.level!.allow, p.level!.allow ? '' : reason);
    const message = await this.run(call, this.failed);
    if (message === null) return;
    this.pending.set(null);
    if (p.kind === 'reset') this.toast.success('Reset link sent', 'E-mailed to ' + sentTo(message, p.agency.Email));
    else if (p.kind === 'block') this.toast.success(`${p.agency.UserName} blocked`, message);
    else this.toast.success(`${p.level!.name} turned ${p.level!.allow ? 'on' : 'off'}`, message);
  }

  protected async unblockWithReason(r: ReasonAsk, reason: string): Promise<void> {
    const message = await this.run(this.api.unblock('agencies', r.userId, reason), this.failed);
    if (message === null) return;
    this.reasonAsk.set(null);
    this.toast.success(`${r.userName || r.userId} unblocked`, message);
  }

  protected closeAsk(): void {
    if (this.saving()) return;
    this.pending.set(null);
    this.reasonAsk.set(null);
    this.failed.set('');
  }

  protected async openHistory(a: AgencyRow): Promise<void> {
    this.history.set({ agency: a, items: null, error: '' });
    try {
      const items = blockHistoryItems(await firstValueFrom(this.api.agencyHistory(a.UserId)), this.word);
      if (this.history()?.agency === a) this.history.set({ agency: a, items, error: '' });
    } catch (err) {
      if (this.history()?.agency === a) this.history.set({ agency: a, items: [], error: apiErrorMessage(err) });
    }
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

  /** The answer's message, or null after showing the refusal in `failed`. */
  private async run(call: Observable<MessageResponse>, failed: typeof this.failed): Promise<string | null> {
    this.saving.set(true);
    failed.set('');
    try {
      const r = await firstValueFrom(call);
      void this.load();
      return r.message;
    } catch (err) {
      failed.set(apiErrorMessage(err));
      return null;
    } finally {
      this.saving.set(false);
    }
  }
}
