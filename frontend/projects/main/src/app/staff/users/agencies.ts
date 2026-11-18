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
import { PoCard } from '../expenditure/po-card';
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
  imports: [FormsModule, RouterLink, PagerComponent, PageHead, ReasonDialog, ConfirmDialog, ListCounts, ChipFilter, RowMenu, UserHistoryPanel, PoCard],
  templateUrl: './agencies.html',
  styles: `
    /* 2026-11-18 (the user: staff pages 'not aligned with SVG files'): staff-01 / staff-03 column widths (fixed layout, the
       agency column takes the rest), 320px search, the skin's buttons, avatars and pills (no page overrides). */
    .ag-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px; min-height: 62px; padding: 12px 16px; margin-bottom: 16px; }
    .ag-search { position: relative; flex: 0 1 320px; }
    .ag-search svg { position: absolute; left: 12px; top: 50%; width: 16px; height: 16px; transform: translateY(-50%); fill: none; stroke: #6f8487; stroke-width: 2; }
    .ag-search input { padding-left: 36px; height: 38px; border-radius: 9px; background-image: none; }
    .ag-card { padding: 0; overflow: hidden; }
    .ag-table { min-width: 1060px; margin: 0; table-layout: fixed; }
    .ag-table th.c-spoc { width: 240px; }
    .ag-table th.c-cat { width: 270px; }
    .ag-table th.c-n { width: 90px; }
    .ag-table th.c-st { width: 110px; }
    .ag-table th.c-act { width: 220px; }
    .ag-table.is-levels th.c-cat { width: 280px; }
    .ag-table th.c-lv { width: 150px; }
    .ag-table td { vertical-align: middle; }
    .ag-table tr.is-off .ag-name { color: #6f8487; }
    .ag { display: flex; gap: 10px; align-items: flex-start; min-width: 0; }
    .initials { flex: 0 0 34px; height: 34px; border-radius: 50%; background: #e6f2f3; color: #24666b; display: grid; place-items: center; font-size: 11.5px; font-weight: 800; }
    tr.is-off .initials { background: #eef1f2; color: #8a9899; }
    .ag-text, .spoc { min-width: 0; display: flex; flex-direction: column; font-size: 11.5px; font-weight: 500; line-height: 16px; color: #6f8487; }
    .ag-text > *, .spoc > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ag-name, .spoc strong { font-size: 13.5px; font-weight: 700; line-height: 18px; color: #17373b; }
    .ag-id { font-weight: 600; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px 6px; }
    .chips span { padding: 4px 11px; border-radius: 11px; background: #e6f2f3; color: #24666b; font-size: 10.5px; font-weight: 700; letter-spacing: 0.4px; line-height: 14px; white-space: nowrap; }
    .chips .is-sector { background: #ecf0f0; color: #6f8487; }
    .chips .is-unset { background: #fdf2dc; color: #9a5f06; }
    .count { font-size: 16px; font-weight: 800; color: #17373b; }
    .acts { display: flex; flex-wrap: nowrap; gap: 8px; align-items: center; justify-content: flex-end; }
    .acts .btn { white-space: nowrap; }
    .lv-cell { text-align: center; }
    .sw { position: relative; width: 40px; height: 22px; border: 0; border-radius: 11px; background: #d5dcdd; padding: 0; transition: background .15s; }
    .sw::after { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left .15s; }
    .sw.on { background: #2f9e58; }
    .sw.on::after { left: 21px; }
    .sw:focus-visible { outline: 2px solid var(--zt-mid2, #2a8a8c); outline-offset: 2px; }
    .sw:disabled { opacity: .6; }
    .lv-state { display: block; font-size: 11.5px; font-weight: 500; color: #6f8487; margin-top: 2px; }
    .lv-why { display: block; max-width: 140px; margin: 2px auto 0; font-size: 11.5px; color: #9a5f06; overflow-wrap: anywhere; }
    .no-data .btn { margin-top: 8px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    @media (max-width: 767.98px) {
      .ag-search { flex-basis: 100%; }
      .ag-table { min-width: 0; table-layout: auto; }
      .ag-table thead { display: none; }
      .ag-table, .ag-table tbody, .ag-table tr, .ag-table td { display: block; width: 100%; box-sizing: border-box; }
      .ag-table tr { border-bottom: 1px solid #e1eaea; padding: 8px 14px; }
      .ag-table td { border: 0 !important; padding: 5px 0; text-align: left !important; }
      .ag-table td[data-label]::before { content: attr(data-label); display: block; font-size: 11.5px; font-weight: 700; color: #5f6f70; text-transform: uppercase; }
      .ag-table td.half { display: inline-block; width: 50%; vertical-align: top; }
      .ag-text > *, .spoc > * { white-space: normal; }
      .acts { justify-content: flex-start; flex-wrap: wrap; }
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
  /** 2026-11-18 (expenditure monitoring): the agency (organisation) whose purchase orders card is open. */
  protected readonly poFor = signal<AgencyRow | null>(null);

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
    // 2026-11-18 (the user: staff pages 'not aligned with SVG files'): the design has All / Manufacturing / Services / Both;
    // "Not set" only while some agency has no sector type (or it is the chosen filter).
    const none = counts.none || this.sector() === 'none' ? [{ key: 'none', label: 'Not set' }] : [];
    return [{ key: 'all', label: 'All' }, ...SECTOR_ACTIVITIES.map((a) => ({ key: a.value, label: a.label })), ...none]
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
    items.push({ key: 'po', label: 'Purchase orders', icon: 'file' });
    items.push(a.IsActive ? { key: 'block', label: `Block ${this.word}`, icon: 'lock', danger: true } : { key: 'unblock', label: `Unblock ${this.word}`, icon: 'unlock' });
    return items;
  }

  protected picked(a: AgencyRow, key: string): void {
    switch (key) {
      case 'edit': void this.router.navigate(['/staff/users/agencies', a.UserId]); break;
      case 'assessors': void this.router.navigate(['/staff/users/assessors'], { queryParams: { agencyId: a.UserId } }); break;
      case 'reset': this.ask({ kind: 'reset', agency: a, ask: resetLinkAsk(a.UserName, a.UserId, a.Email, this.consultancy ? 'Consultant organisation' : 'Assessment agency') }); break;
      case 'history': void this.openHistory(a); break;
      case 'po': this.poFor.set(a); break;
      case 'block': this.ask({ kind: 'block', agency: a, ask: this.blockAsk(a) }); break;
      case 'unblock': this.reasonAsk.set({ action: 'unblock', userId: a.UserId, userName: a.UserName ?? null }); break;
    }
  }

  /**
   * popup-03: what blocking does, in plain words, and a required reason.
   * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): a lock tile, "ZEDAA0080 · 1 assessor" under the title,
   * the effects as red bullets. The design's "Tell the agency SPOC by e-mail" tick box is left out: the block API always
   * e-mails the agency (no choice to pass), so the pop-up says so instead.
   */
  private blockAsk(a: AgencyRow): ConfirmAsk {
    const name = a.UserName || a.UserId;
    const n = a.NoOfUsers ?? 0;
    const people = this.consultancy ? (n === 1 ? 'consultant' : 'consultants') : n === 1 ? this.labels.assessor.toLowerCase() : this.labels.assessors.toLowerCase();
    return {
      title: `Block ${name}?`,
      subtitle: `${a.UserId} · ${n} ${people}`,
      icon: 'lock',
      points: [
        `${name} cannot sign in until it is unblocked.`,
        `Nothing is deleted. You can unblock the ${this.word} at any time.`,
        `The reason is kept in its history and e-mailed to the ${this.word} SPOC.`,
      ],
      confirmLabel: `Block ${this.word}`,
      danger: true,
      reason: { label: 'Reason for blocking', placeholder: `Shown in the ${this.word}'s history`, maxLength: 2000 },
    };
  }

  /** A level switch (popup-09): turning it on confirms; turning it off asks for the reason, which is e-mailed to the agency. */
  protected toggleLevel(a: AgencyRow, level: { code: AgencyLevel; name: string }): void {
    const allow = !this.allowed(a, level.code);
    const n = level.name;
    // 2026-11-18 (the user: staff pages 'not aligned with SVG files'): popup-09: a warning tile, "Agency · ID" under the title,
    // amber bullets; the reason stays when a level is turned off (the user: "keep the reason when turning a level off"). The
    // level API always e-mails the agency, so the design's tick box is a line instead.
    const ask: ConfirmAsk = allow
      ? {
          title: `Turn on ${n} for this agency?`,
          subtitle: `${a.UserName} · ${a.UserId}`,
          icon: 'check',
          points: [`${a.UserName} can be allotted new ${n} assessments again.`, `The agency SPOC is told by e-mail.`],
          confirmLabel: `Turn on ${n}`,
          cancelLabel: `Keep ${n} off`,
        }
      : {
          title: `Turn off ${n} for this agency?`,
          subtitle: `${a.UserName} · ${a.UserId}`,
          icon: 'warn',
          tone: 'warn',
          points: [this.disableNote(a, n), `You can turn ${n} back on at any time.`].filter(Boolean),
          note: 'The reason is e-mailed to the agency SPOC.',
          confirmLabel: `Turn off ${n}`,
          cancelLabel: `Keep ${n} on`,
          reason: { label: 'Reason for turning it off', placeholder: `Why ${n} assessments are turned off`, maxLength: 2000 },
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
