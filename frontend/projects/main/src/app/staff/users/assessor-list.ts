import { ContentService } from '../../content/content-text';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ReasonAsk, ReasonDialog } from './reason-dialog';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { LABELS } from '../../portal-labels';
import { STAFF_SYSTEM } from '../staff-menu';
import { AssessorRow, SECTOR_ACTIVITIES, SectorActivity, UsersApi } from './users.api';
import { ClientPager, PagerComponent } from '../pager';
import { ScopeItem } from './assessor-scope';
import { PageHead } from '../../msme/shared/page-head';
import { staffCrumbs } from '../staff-crumbs';
import { ListCount, ListCounts } from '../list-counts';
import { ChipFilter, FilterChip } from '../chip-filter';
import { RowMenu, RowMenuItem } from '../row-menu';
import { ConfirmAsk, ConfirmDialog } from '../confirm-dialog';
import { ToastService } from '../toast';
import { maskEmail, maskMobile, resetLinkAsk, sentTo } from './user-display';
import { HistoryItem, UserHistoryPanel, blockHistoryItems } from './history-panel';

/** Which assessors the list shows: the status tiles, the type chips and the sector type / agency drop-downs. */
type StatusFilter = 'all' | 'active' | 'blocked';
type SectorFilter = '' | SectorActivity | 'none';

/** Two letters for the round badge beside a name (first and last word). */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}

/** The stored assessor / user type as people read it (BronzeAssessor → Bronze Assessor). */
export function assessorTypeLabel(type: string | null | undefined): string {
  switch (type) {
    case 'BronzeAssessor': return 'Bronze Assessor';
    case 'TechnicalExpert': return 'Technical Expert';
    default: return type ?? '';
  }
}

/** The levels of an assessor as medals (Bronze, Silver, Gold, ZED-X) with the modes beneath ("Desktop · Onsite"). */
export interface LevelMedals {
  items: { code: string; title: string }[];
  modes: string;
  /** "Bronze: Desktop; Silver: Desktop, Onsite" for screen readers. */
  aria: string;
}

/** 2026-11-17 (approved staff-04): "levels show as medal icons with the modes beneath". */
export function levelMedals(v: unknown): LevelMedals {
  const list = (Array.isArray(v) ? (v as ScopeItem[]) : []).filter((x) => x.modes?.length);
  const order = ['Desktop', 'Remote', 'Onsite'];
  const modes = new Set(list.flatMap((x) => x.modes));
  const items = list.map((x) => {
    const name = x.level === 'ZEDX' ? 'ZED-X' : x.level;
    const code = x.level.toLowerCase().replace(/[^a-z]/g, '');
    return { code: ['bronze', 'silver', 'gold', 'zedx'].includes(code) ? code : 'other', title: `${name}: ${x.modes.join(', ')}` };
  });
  return {
    items,
    modes: [...order.filter((m) => modes.has(m)), ...[...modes].filter((m) => !order.includes(m))].join(' · '),
    aria: items.map((i) => i.title).join('; '),
  };
}

const BLOCK_NOTE_KEY = 'staff.users.assessorBlock.note';

/**
 * The block notice of the Admin's Texts (Admin → Texts, `staff.users.assessorBlock.note`) as plain text for the block
 * confirmation; the standard wording until the texts arrive, '' when the Admin hid it.
 */
export function assessorBlockNote(content: ContentService, consultancy: boolean): string {
  const t = content.text(BLOCK_NOTE_KEY);
  if (t && !t.enabled) return '';
  if (t?.html) {
    const plain = typeof DOMParser !== 'undefined'
      ? new DOMParser().parseFromString(t.html, 'text/html').body.textContent ?? ''
      : t.html.replace(/<[^>]*>/g, ' ');
    return plain.replace(/\s+/g, ' ').trim();
  }
  return `The login can't sign in on the web or the app, and can't be allotted or carry out any ${consultancy ? 'consultancy' : 'assessment'} until unblocked.`;
}

/**
 * The "Block …?" confirmation of an assessor / consultant (popup-03): what blocking does, the open assessments it leaves
 * (`assessorOpenAssessments`; "not known" when the count could not be read) and a required reason (kept in the history and
 * e-mailed; the server always sends the mail).
 */
export function assessorBlockAsk(name: string, userId: string, open: number | null, note: string, consultancy: boolean, reAllots: string): ConfirmAsk {
  const word = consultancy ? 'consultant' : 'assessor';
  const work = consultancy ? 'case' : 'assessment';
  const openLine = open === null
    ? `Open ${work}s allotted to this ${word}: not known.`
    : open === 0
      ? `No ${work} allotted to this ${word} is open.`
      : `${open} ${work}${open === 1 ? '' : 's'} allotted to this ${word} ${open === 1 ? 'is' : 'are'} still open. ${reAllots.charAt(0).toUpperCase() + reAllots.slice(1)} will need to re-allot ${open === 1 ? 'it' : 'them'}.`;
  return {
    title: `Block ${name || userId}?`,
    message: `${name || userId} (${userId}). ${note ? note + ' ' : ''}${openLine} Nothing is deleted; the reason is kept in the history and e-mailed to the ${word}.`,
    confirmLabel: `Block ${word}`,
    danger: true,
    reason: {
      label: 'Reason for blocking', placeholder: 'Shown in the history and e-mailed', maxLength: 2000,
      requiredMessage: 'Please enter the reason for blocking.',
    },
  };
}

/**
 * MasterAdmin list of all assessors (optionally of one agency, `?agencyId=`, and verification type, `?type=DA|SA|FA`).
 * Port of Views/User/AssessorList.cshtml: search, page size and paging in the page. 2026-11-17 (approved staff-04): the
 * shared head and counts (all, active, blocked; a click filters), the search with the sector type and agency drop-downs
 * (and type chips when the list has more than one type), a row per assessor with its levels as medals, the sector, the
 * masked contact (no PAN), the agency and status, View plus a row menu (Send reset link, View history, Block / Unblock)
 * whose actions confirm first and end with a toast; the block history opens in the side panel. Cards on phones.
 */
@Component({
  selector: 'zed-staff-assessor-list',
  imports: [
    FormsModule, RouterLink, PagerComponent, DatePipe, PageHead, ReasonDialog, ListCounts, ChipFilter, RowMenu, ConfirmDialog, UserHistoryPanel,
  ],
  template: `
    <zed-page-head [crumbs]="crumbs" [title]="noun + (agencyId ? ' of ' + agencyId : '')" />
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }

    <zed-list-counts [counts]="tiles()" [selected]="status()" [label]="noun + ' by status'" (pick)="setStatus($any($event.key))" />

    <div class="zed-card as-bar">
      <label class="as-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
        <input type="search" class="form-control" maxlength="50" placeholder="Search ID, name, mobile, e-mail or agency" aria-label="Search assessors"
               [ngModel]="search()" (ngModelChange)="pager.setSearch($event)" />
      </label>
      @if (!consultancy) {
        <select class="form-select as-select" aria-label="Sector type" [ngModel]="sector()" (ngModelChange)="setSector($event)">
          <option value="">All sector types</option>
          @for (s of sectorOptions(); track s.value) { <option [value]="s.value">{{ s.label }} ({{ s.count }})</option> }
        </select>
      }
      @if (agencies().length > 1) {
        <select class="form-select as-select as-agency" [attr.aria-label]="labels.agency" [ngModel]="agency()" (ngModelChange)="setAgency($event)">
          <option value="">All {{ labels.agencies.toLowerCase() }}</option>
          @for (a of agencies(); track a.id) { <option [value]="a.id">{{ a.name }} ({{ a.count }})</option> }
        </select>
      }
      <span class="as-showing">{{ pager.total() }} of {{ rows().length }} {{ noun.toLowerCase() }}</span>
      @if (!consultancy && types().length > 1) {
        <zed-chip-filter class="as-types" label="Type" [chips]="typeChips()" [value]="level()" (valueChange)="setLevel($event)" />
      }
    </div>

    <div class="zed-card as-list">
      <div class="table-responsive">
        <table class="table table-zed as-table">
          <thead>
            <tr>
              @if (consultancy) {
                <!-- ZEDCS_CONSULTANCY Frontend/User/AssessorList.cshtml -->
                <th class="text-center" style="width: 56px">S.No</th>
                <th>Consultant Details</th>
                <th>Consultant Organisation Details</th>
                <th class="text-center">No. Of Consulting Completed</th>
                <th class="text-center">Status</th>
                <th class="text-end">Action(s)</th>
              } @else {
                <th>Assessor</th>
                <th>Levels and modes</th>
                <th>Sector</th>
                <th>Contact</th>
                <th>Agency</th>
                <th class="text-center">Status</th>
                <th class="text-end">Actions</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (s of page(); track s.UserId) {
              <tr [class.is-blocked]="!s.IsActive">
                @if (consultancy) { <td class="text-center as-sno">{{ s.RowNumber }}</td> }
                <td class="as-person">
                  <div class="as-user">
                    <span class="as-avatar" aria-hidden="true">{{ initials(s.UserName) }}</span>
                    <span class="as-who"><span class="as-name">{{ s.UserName }}</span><span class="as-id">{{ s.UserId }}</span></span>
                  </div>
                  @if (consultancy) {
                    <div class="as-contact as-under">
                      <span [class.no-mobile]="!s.MobileNo">{{ s.MobileNo ? mobile(s.MobileNo) : 'Mobile not saved' }}</span>
                      @if (s.Email) { <span class="as-sub">{{ email(s.Email) }}</span> }
                    </div>
                  }
                </td>
                @if (!consultancy) {
                  <td class="as-levels" data-label="Levels and modes">
                    @let m = medals(s.Assessments);
                    @if (m.items.length) {
                      <span class="lv-row" role="img" [attr.aria-label]="m.aria">
                        @for (x of m.items; track $index) { <span [class]="'lv lv-' + x.code" [title]="x.title" aria-hidden="true">Z</span> }
                      </span>
                      <span class="as-sub">{{ m.modes }}</span>
                    } @else {
                      <span class="as-type">{{ typeLabel(s.AssessorType) }}</span>
                    }
                  </td>
                  <td data-label="Sector"><span class="as-pill" [class.is-none]="!s.SectorActivity">{{ s.SectorActivity || 'Not set' }}</span></td>
                  <td class="as-contact" data-label="Contact">
                    <span [class.no-mobile]="!s.MobileNo">{{ s.MobileNo ? mobile(s.MobileNo) : 'Mobile not saved' }}</span>
                    @if (s.Email) { <span class="as-sub">{{ email(s.Email) }}</span> }
                  </td>
                }
                <td class="as-agency" [attr.data-label]="consultancy ? 'Consultant Organisation' : labels.agency">
                  <span class="as-agency-name">{{ s.AgencyUserName }}</span>
                  <span class="as-id">{{ s.AgencyUserId }}</span>
                </td>
                @if (consultancy) {
                  <!-- The live page prints 0 for each milestone (no count is read). -->
                  <td class="text-center as-milestones" data-label="No. Of Consulting Completed">
                    <div>Milestone 1: <strong>0</strong></div><div>Milestone 2: <strong>0</strong></div><div>Milestone 3: <strong>0</strong></div>
                  </td>
                }
                <td class="text-center as-status" data-label="Status">
                  <span class="status-badge" [class.is-active]="s.IsActive" [class.is-rejected]="!s.IsActive">{{ s.IdStatus }}</span>
                  @if (!s.IsActive && (s.BlockReason || s.BlockedOn)) {
                    <small class="as-block-note" data-block-note>
                      @if (s.BlockReason) { “{{ s.BlockReason }}” }
                      @if (s.BlockedOn) { <span class="text-nowrap">· {{ s.BlockedOn | date: 'dd MMM yyyy' }}</span> }
                    </small>
                  }
                </td>
                <td class="as-actions">
                  <div class="as-btns">
                    <a [routerLink]="['/staff/users/assessors', s.UserId]" class="btn btn-outline-primary">View</a>
                    <zed-row-menu [items]="s.IsActive ? menuActive : menuBlocked" [label]="'More actions for ' + (s.UserName || s.UserId)" (picked)="pick($event, s)" />
                  </div>
                </td>
              </tr>
            } @empty {
              <tr class="empty-row">
                <td colspan="7" style="padding: 0">
                  @if (rows().length) {
                    <div class="no-data">
                      No {{ consultancy ? 'consultant' : labels.assessor.toLowerCase() }} matches the filters.
                      <button type="button" class="btn btn-link p-0 ms-1" (click)="clearFilters()">Show all</button>
                    </div>
                  } @else {
                    <div class="no-data">No Data Entered</div>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <zed-pager [pager]="pager" />
    </div>

    @if (resetFor(); as r) {
      <zed-confirm-dialog [ask]="r.ask" [busy]="busy()" [failed]="dialogError()" (confirmed)="sendReset(r.row)" (cancel)="closeDialogs()" />
    }
    @if (blockFor(); as b) {
      <zed-confirm-dialog [ask]="b.ask" [busy]="busy()" [failed]="dialogError()" inputId="as-block-reason" (confirmed)="block(b.row, $event)" (cancel)="closeDialogs()" />
    }
    @if (reasonAsk(); as r) {
      <zed-reason-dialog [ask]="r" [busy]="busy()" [failed]="dialogError()" (confirmed)="unblockWithReason(r, $event)" (cancel)="closeDialogs()" />
    }
    @if (historyFor(); as h) {
      <zed-user-history [subtitle]="(h.row.UserName || h.row.UserId) + ' · ' + h.row.UserId" [items]="h.items" [error]="h.error"
                        [fileName]="'history-' + h.row.UserId" (closed)="historyFor.set(null)" />
    }
    @if (loading()) {
      <div class="loadingdiv" role="status" aria-live="polite"><div class="spinner-border text-light"></div><span class="visually-hidden">Loading…</span></div>
    }
  `,
  styles: `
    .as-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px; padding: 12px 16px; margin-bottom: 16px; }
    .as-search { position: relative; flex: 1 1 280px; max-width: 400px; margin: 0; }
    .as-search svg { position: absolute; left: 12px; top: 50%; width: 16px; height: 16px; transform: translateY(-50%); fill: none; stroke: #6b7f80; stroke-width: 2; }
    .as-search input { padding-left: 36px; }
    .as-select { flex: 0 1 220px; width: auto; min-width: 0; }
    .as-agency { flex-basis: 260px; }
    .as-showing { margin-left: auto; font-size: 13px; color: #5f6f70; }
    .as-types { flex-basis: 100%; }

    .as-list { padding: 0; overflow: hidden; }
    .as-table { margin: 0; }
    .as-table th:first-child, .as-table td:first-child { padding-left: 14px; }
    .as-table td { vertical-align: middle; overflow-wrap: anywhere; font-size: 14px; }
    .as-table tbody tr:hover td { background: var(--zt-pale, #f7fbfb); }
    .as-sno { color: #5f6f70; }
    .as-user { display: flex; align-items: center; gap: 12px; min-width: 170px; }
    .as-who, .as-agency, .as-contact { min-width: 0; display: flex; flex-direction: column; }
    .as-avatar { flex: 0 0 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: var(--zt-soft, #d4ebe6);
      color: var(--zt-ink, #173f44); font-weight: 700; font-size: 12.5px; }
    tr.is-blocked .as-avatar { background: #f6e3e1; color: #a8303a; }
    .as-name, .as-agency-name { font-weight: 700; color: var(--zt-ink, #173f44); }
    .as-id, .as-sub { font-size: 12.5px; color: #5f6f70; }
    .as-contact { min-width: 150px; }
    .as-under { margin: 6px 0 0 46px; }
    .lv-row { display: flex; gap: 5px; margin-bottom: 3px; }
    .lv { width: 21px; height: 21px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-size: 10.5px; font-weight: 800;
      background: var(--zt-mid2, #2a8a8c); box-shadow: inset 0 0 0 2px rgba(255,255,255,.45), 0 0 0 1.5px rgba(0,0,0,.12); }
    .lv-bronze { background: #c46a3c; }
    .lv-silver { background: #9aa4aa; }
    .lv-gold { background: #d2a12a; }
    .as-type { font-size: 13px; color: #3d5254; }
    .as-pill { display: inline-block; padding: 3px 11px; border-radius: 12px; background: #eef2f2; color: #4d6062; font-size: 12px; font-weight: 600; white-space: nowrap; }
    .as-pill.is-none { background: #fff4d6; color: #8a6100; }
    .no-mobile { color: #8a6100; }
    .as-block-note { display: block; margin-top: 4px; font-size: 12px; color: #6b5a5a; }
    .as-btns { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
    .as-btns .btn { white-space: nowrap; }
    .no-data .btn-link { font-weight: 600; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }

    @media (max-width: 767.98px) {
      .as-search, .as-select { flex: 1 1 100%; max-width: none; }
      .as-showing { margin-left: 0; }
      .as-list { background: none; border: 0; box-shadow: none; }
      .as-table thead { display: none; }
      .as-table, .as-table tbody, .as-table tr, .as-table td { display: block; width: 100%; }
      .as-table tr { position: relative; background: #fff; border: 1px solid #e1eaea; border-radius: 12px; margin-bottom: 12px; padding: 8px 14px; }
      .as-table tr.empty-row { border: 0; padding: 0; }
      .as-table td, .as-table td:first-child { border: 0; padding: 5px 0; text-align: left !important; }
      .as-table tbody tr:hover td { background: transparent; }
      .as-table td[data-label]::before { content: attr(data-label); display: block; font-size: 11.5px; font-weight: 700; color: #5f6f70; text-transform: uppercase; }
      .as-sno { display: none !important; }
      .as-user { min-width: 0; padding-right: 44px; }
      .as-under { margin-left: 0; }
      .as-btns { justify-content: flex-start; }
      .as-btns zed-row-menu { position: absolute; top: 12px; right: 12px; }
    }
  `,
})
export class AssessorListPage {
  private readonly system = inject(STAFF_SYSTEM);
  protected readonly consultancy = this.system === 'consultancy';
  protected readonly labels = LABELS[this.system];
  protected readonly noun = this.consultancy ? 'Consultants' : this.labels.assessors;
  protected readonly crumbs = staffCrumbs({ label: this.noun });
  private readonly api = inject(UsersApi);
  private readonly toast = inject(ToastService);
  private readonly content = inject(ContentService);
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;

  protected readonly agencyId = this.query.get('agencyId') ?? '';
  protected readonly type = this.query.get('type') ?? '';
  /** Every assessor the server sent; the filters below pick the rows the pager gets. */
  protected readonly rows = signal<AssessorRow[]>([]);
  protected readonly status = signal<StatusFilter>('all');
  protected readonly level = signal('');
  protected readonly sector = signal<SectorFilter>('');
  protected readonly agency = signal('');
  /** Paged (20 per page) and searched (any value of the row) in the browser, as before. */
  protected readonly pager = new ClientPager<AssessorRow>(20);
  protected readonly search = this.pager.search;
  protected readonly page = this.pager.page;
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  /** The server's refusal, shown in the open confirmation. */
  protected readonly dialogError = signal('');
  protected readonly resetFor = signal<{ row: AssessorRow; ask: ConfirmAsk } | null>(null);
  protected readonly blockFor = signal<{ row: AssessorRow; ask: ConfirmAsk } | null>(null);
  /** 2026-11-16 (the user): an unblock asks for its reason (recorded and e-mailed to the user). */
  protected readonly reasonAsk = signal<ReasonAsk | null>(null);
  protected readonly historyFor = signal<{ row: AssessorRow; items: HistoryItem[] | null; error: string } | null>(null);
  protected readonly initials = initialsOf;
  protected readonly typeLabel = assessorTypeLabel;
  protected readonly medals = levelMedals;
  protected readonly mobile = maskMobile;
  protected readonly email = maskEmail;

  private readonly word = this.consultancy ? 'consultant' : 'assessor';
  protected readonly menuActive: RowMenuItem[] = [
    { key: 'reset', label: 'Send reset link', icon: 'mail' },
    { key: 'history', label: 'View history', icon: 'history' },
    { key: 'block', label: 'Block ' + this.word, icon: 'lock', danger: true },
  ];
  protected readonly menuBlocked: RowMenuItem[] = [
    { key: 'history', label: 'View history', icon: 'history' },
    { key: 'unblock', label: 'Unblock ' + this.word, icon: 'unlock' },
  ];

  protected readonly tiles = computed<ListCount[]>(() => {
    const rows = this.rows();
    const active = rows.filter((r) => r.IsActive).length;
    return [
      { key: 'all', label: 'All ' + this.noun.toLowerCase(), value: rows.length },
      { key: 'active', label: 'Active', value: active, tone: 'good' },
      { key: 'blocked', label: 'Blocked', value: rows.length - active, tone: 'bad' },
    ];
  });

  /** The assessor types in the list (Bronze Assessor first), with their counts. */
  protected readonly types = computed(() => {
    const counts = new Map<string, number>();
    for (const r of this.rows()) if (r.AssessorType) counts.set(r.AssessorType, (counts.get(r.AssessorType) ?? 0) + 1);
    return [...counts.entries()]
      .sort(([a], [b]) => (a === 'BronzeAssessor' ? -1 : b === 'BronzeAssessor' ? 1 : a.localeCompare(b)))
      .map(([value, count]) => ({ value, label: assessorTypeLabel(value), count }));
  });
  protected readonly typeChips = computed<FilterChip[]>(() => [
    { key: '', label: 'All types', count: this.rows().length },
    ...this.types().map((t) => ({ key: t.value, label: t.label, count: t.count })),
  ]);

  protected readonly sectorOptions = computed(() => {
    const rows = this.rows();
    const options: { value: SectorFilter; label: string; count: number }[] = SECTOR_ACTIVITIES.map((a) => ({
      value: a.value, label: a.label, count: rows.filter((r) => r.SectorActivity === a.value).length,
    }));
    const none = rows.filter((r) => !r.SectorActivity).length;
    if (none) options.push({ value: 'none', label: 'Not set', count: none });
    return options;
  });

  /** The agencies of the listed assessors, by name. */
  protected readonly agencies = computed(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const r of this.rows()) {
      if (!r.AgencyUserId) continue;
      const a = map.get(r.AgencyUserId) ?? { id: r.AgencyUserId, name: r.AgencyUserName || r.AgencyUserId, count: 0 };
      a.count++;
      map.set(r.AgencyUserId, a);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  private readonly filtered = computed(() => {
    const status = this.status();
    const level = this.level();
    const sector = this.sector();
    const agency = this.agency();
    return this.rows().filter((r) =>
      (status === 'all' || (status === 'active') === r.IsActive)
      && (!level || r.AssessorType === level)
      && (!sector || (sector === 'none' ? !r.SectorActivity : r.SectorActivity === sector))
      && (!agency || r.AgencyUserId === agency),
    );
  });

  constructor() {
    void this.load();
  }

  protected setStatus(value: StatusFilter): void {
    this.status.set(value);
    this.pager.set(this.filtered());
  }

  protected setLevel(value: string): void {
    this.level.set(value);
    this.pager.set(this.filtered());
  }

  protected setSector(value: SectorFilter): void {
    this.sector.set(value);
    this.pager.set(this.filtered());
  }

  protected setAgency(value: string): void {
    this.agency.set(value);
    this.pager.set(this.filtered());
  }

  protected clearFilters(): void {
    this.status.set('all');
    this.level.set('');
    this.sector.set('');
    this.agency.set('');
    this.pager.setSearch('');
    this.pager.set(this.filtered());
  }

  /** A row menu choice: each one confirms first (reset link, block, unblock) or opens the history panel. */
  protected pick(key: string, s: AssessorRow): void {
    if (this.busy()) return;
    this.dialogError.set('');
    switch (key) {
      case 'reset': this.resetFor.set({ row: s, ask: resetLinkAsk(s.UserName, s.UserId, s.Email) }); break;
      case 'block': void this.openBlock(s); break;
      case 'unblock': this.reasonAsk.set({ action: 'unblock', userId: s.UserId, userName: s.UserName ?? null }); break;
      case 'history': void this.openHistory(s); break;
    }
  }

  protected closeDialogs(): void {
    if (this.busy()) return;
    this.resetFor.set(null);
    this.blockFor.set(null);
    this.reasonAsk.set(null);
    this.dialogError.set('');
  }

  /** E-mails the assessor a link to set a new password. */
  protected async sendReset(s: AssessorRow): Promise<void> {
    await this.act(this.api.passwordReset('assessors', s.UserId), (m) => {
      this.toast.success('Reset link sent', 'E-mailed to ' + sentTo(m, s.Email));
      return false;
    });
  }

  /** The block confirmation, with the open assessments it leaves (read first; "not known" when it cannot be). */
  private async openBlock(s: AssessorRow): Promise<void> {
    this.busy.set(true);
    assessorBlockNote(this.content, this.consultancy); // starts loading the Admin's texts while the count is read
    let open: number | null = null;
    try {
      open = (await firstValueFrom(this.api.assessorOpenAssessments(s.UserId))).count ?? null;
    } catch {
      /* shown as "not known" */
    } finally {
      this.busy.set(false);
    }
    const reAllots = 'the ' + (this.consultancy ? 'organisation' : this.labels.agency.toLowerCase());
    this.blockFor.set({ row: s, ask: assessorBlockAsk(s.UserName, s.UserId, open, assessorBlockNote(this.content, this.consultancy), this.consultancy, reAllots) });
  }

  protected async block(s: AssessorRow, reason: string): Promise<void> {
    await this.act(this.api.block('assessors', s.UserId, reason), (m) => {
      this.toast.success(`${this.consultancy ? 'Consultant' : this.labels.assessor} blocked`, m);
      return true;
    });
  }

  protected async unblockWithReason(r: ReasonAsk, reason: string): Promise<void> {
    await this.act(this.api.unblock('assessors', r.userId, reason), (m) => {
      this.toast.success(`${this.consultancy ? 'Consultant' : this.labels.assessor} unblocked`, m);
      return true;
    });
  }

  private async openHistory(s: AssessorRow): Promise<void> {
    this.historyFor.set({ row: s, items: null, error: '' });
    try {
      const entries = await firstValueFrom(this.api.assessorHistory(s.UserId));
      if (this.historyFor()?.row === s) this.historyFor.set({ row: s, items: blockHistoryItems(entries, this.consultancy ? 'organisation' : 'agency'), error: '' });
    } catch (err) {
      if (this.historyFor()?.row === s) this.historyFor.set({ row: s, items: [], error: apiErrorMessage(err) });
    }
  }

  /** Runs a confirmed action: done → the toast (and a reload when `done` says so), the pop-up closes; refused → in the pop-up. */
  private async act(call: ReturnType<UsersApi['unblock']>, done: (message: string) => boolean): Promise<void> {
    this.busy.set(true);
    this.dialogError.set('');
    try {
      const reload = done((await firstValueFrom(call)).message);
      this.busy.set(false);
      this.closeDialogs();
      if (reload) await this.load();
    } catch (err) {
      this.dialogError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.rows.set(await firstValueFrom(this.api.allAssessors(this.agencyId, this.type)));
      this.pager.set(this.filtered());
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
