import { Component, computed, inject, signal } from '@angular/core';
import { LABELS } from '../../portal-labels';
import { STAFF_SYSTEM } from '../staff-menu';
import { FormsModule } from '@angular/forms';
import { ReasonAsk, ReasonDialog } from './reason-dialog';
import { RouterLink } from '@angular/router';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { assessorBlockAsk, assessorBlockNote, assessorTypeLabel, initialsOf, levelMedals } from './assessor-list';
import { OwnAssessorRow, UsersApi } from './users.api';
import { PagedView, PagerComponent } from '../pager';
import { PageHead } from '../../msme/shared/page-head';
import { staffCrumbs } from '../staff-crumbs';
import { ListCount, ListCounts } from '../list-counts';
import { RowMenu, RowMenuItem } from '../row-menu';
import { ConfirmAsk, ConfirmDialog } from '../confirm-dialog';
import { ToastService } from '../toast';
import { ContentService } from '../../content/content-text';
import { TextPipe, t } from '../../content/page-text';
import { plain, resetLinkAsk, sentTo } from './user-display';
import { HistoryItem, UserHistoryPanel, blockHistoryItems } from './history-panel';
import { LevelCount, LevelCounts, levelCountTiles } from './level-counts';

/** Which assessors the list shows (the status tiles). */
type StatusFilter = 'all' | 'active' | 'blocked';

/**
 * The signed-in agency's assessors. Port of Views/User/Assessors.cshtml: block (with reason), unblock (on main not offered
 * while the certificate is attached to another active Bronze Assessor; on consultancy always), edit (the mobile number
 * too, since 2026-11-13). 2026-11-17 (approved staff redesign, as staff-04): the shared head with Add, counts (all,
 * active, blocked; a click filters), a search, a row per assessor with the selfie or initials, its levels as medals, the
 * sector, the contact in full (2026-11-18, the user: never masked; no PAN or ID proof: they are on the record's page) and status, Edit plus a row menu (Send
 * reset link, View history, Block / Unblock) whose actions confirm first and end with a toast, the block history in the
 * side panel, a card per assessor on phones, and an empty state that leads to Add.
 */
@Component({
  selector: 'zed-staff-my-assessors',
  imports: [FormsModule, RouterLink, PagerComponent, PageHead, ReasonDialog, ListCounts, RowMenu, ConfirmDialog, UserHistoryPanel, LevelCounts, TextPipe],
  template: `
    <zed-page-head [crumbs]="crumbs()" [title]="labels.assessors">
      <a routerLink="/staff/users/assessors/new" class="btn btn-primary">{{ '+ Add {assessor}' | t: 'staff.myAssessors.addButton' : { assessor: consultancy ? labels.assessor : labels.assessor.toLowerCase() } }}</a>
    </zed-page-head>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }

    @if (totalTiles().length) {
      <!-- 2026-11-18 (the user: "same logic in the assessment agency login"): the agency's own units per certification level. -->
      <h3 class="ma-cap">{{ 'Units Allocated to Your Agency' | t: 'staff.myAssessors.totals.title' }}</h3>
      <zed-list-counts class="ma-totals" [counts]="totalTiles()" [label]="'Units allocated to your agency per level' | t: 'staff.myAssessors.totals.aria'" />
    }

    @if (loaded() && !assessors().length) {
      <div class="zed-card ma-empty">
        <span class="ma-empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M19 8v6M16 11h6" />
          </svg>
        </span>
        <h4 class="ma-empty-title">{{ 'No {assessors} yet' | t: 'staff.myAssessors.empty.title' : { assessors: labels.assessors.toLowerCase() } }}</h4>
        <p class="muted ma-empty-text">
          @if (consultancy) {
            {{ 'Add a consultant/expert: search the certified professional by certificate number and registered e-mail, then fill in the address and ID proof.' | t: 'staff.myAssessors.empty.consultancyText' }}
          } @else {
            {{ 'Add your first assessor: search the certified professional by certificate number and registered e-mail, then fill in the address, ID proof, states, NIC sectors and sector type.' | t: 'staff.myAssessors.empty.text' }}
          }
        </p>
        <a routerLink="/staff/users/assessors/new" class="btn btn-primary">{{ '+ Add {assessor}' | t: 'staff.myAssessors.empty.addButton' : { assessor: labels.assessor } }}</a>
      </div>
    } @else {
      <zed-list-counts [counts]="tiles()" [selected]="status()" [label]="'{assessors} by status' | t: 'staff.myAssessors.countsLabel' : { assessors: labels.assessors }" (pick)="status.set($any($event.key))" />

      <div class="zed-card ma-bar">
        <label class="ma-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
          <input type="search" class="form-control" [placeholder]="'Search ID, name, type, mobile, e-mail or status' | t: 'staff.myAssessors.search.placeholder'" [attr.aria-label]="'Search assessors' | t: 'staff.myAssessors.search.aria'"
                 [ngModel]="search()" (ngModelChange)="search.set($event)" />
        </label>
        <span class="ma-showing">{{ '{shown} of {total} {assessors}' | t: 'staff.myAssessors.showing' : { shown: filtered().length, total: assessors().length, assessors: labels.assessors.toLowerCase() } }}</span>
      </div>

      <div class="zed-card ma-list">
        <div class="table-responsive">
          <table class="table table-zed ma-table">
            <thead>
              <tr>
                @if (consultancy) {
                  <!-- ZEDCS_CONSULTANCY Frontend/User/Assessors.cshtml (its empty No. Of Assignments and Reason for Block columns are left out). -->
                  <th>{{ '{assessor} Details' | t: 'staff.myAssessors.column.consultant' : { assessor: labels.assessor } }}</th>
                  <th>{{ 'User Type' | t: 'staff.myAssessors.column.userType' }}</th>
                  <th>{{ 'Contact Details' | t: 'staff.myAssessors.column.contactDetails' }}</th>
                  <th class="text-center">{{ 'Status' | t: 'staff.myAssessors.column.status' }}</th>
                  <th class="text-end">{{ 'Action(s)' | t: 'staff.myAssessors.column.consultancyActions' }}</th>
                } @else {
                  <th>{{ 'Assessor' | t: 'staff.myAssessors.column.assessor' }}</th>
                  <th>{{ 'Levels and modes' | t: 'staff.myAssessors.column.levels' }}</th>
                  <th>{{ 'Allocated' | t: 'staff.myAssessors.column.allocated' }}</th>
                  <th>{{ 'Sector' | t: 'staff.myAssessors.column.sector' }}</th>
                  <th>{{ 'Contact' | t: 'staff.myAssessors.column.contact' }}</th>
                  <th class="text-center">{{ 'Status' | t: 'staff.myAssessors.column.status' }}</th>
                  <th class="text-end">{{ 'Actions' | t: 'staff.myAssessors.column.actions' }}</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (u of view.page(); track u.UserId) {
                <tr [class.is-blocked]="!u.IsActive">
                  <td>
                    <div class="ma-user">
                      @if (!consultancy && u.PhotoPath) {
                        <a class="ma-photo" [href]="u.PhotoPath" target="_blank" rel="noopener"><img [alt]="'Selfie of {name}' | t: 'staff.myAssessors.row.selfieAlt' : { name: u.UserName }" [src]="u.PhotoPath" /></a>
                      } @else {
                        <span class="ma-avatar" aria-hidden="true">{{ initials(u.UserName) }}</span>
                      }
                      <span class="ma-who"><span class="ma-name">{{ u.UserName }}</span><span class="ma-id">{{ u.UserId }}</span></span>
                    </div>
                  </td>
                  @if (consultancy) {
                    <td [attr.data-label]="'User Type' | t: 'staff.myAssessors.column.userType'"><span class="ma-type">{{ typeLabel(u.UserType) }}</span></td>
                  } @else {
                    <td class="ma-levels" [attr.data-label]="'Levels and modes' | t: 'staff.myAssessors.column.levels'">
                      @let m = medals(u.Assessments);
                      @if (m.items.length) {
                        <span class="lv-row" role="img" [attr.aria-label]="m.aria">
                          @for (x of m.items; track $index) { <span [class]="'lv lv-' + x.code" [title]="x.title" aria-hidden="true">Z</span> }
                        </span>
                        <span class="ma-sub">{{ m.modes }}</span>
                      } @else {
                        <span class="ma-type">{{ typeLabel(u.AssessorType) }}</span>
                      }
                    </td>
                    <!-- 2026-11-18 (the user): assessments allocated per certification level (desktop, lead or co-assessor). -->
                    <td class="ma-alloc" [attr.data-label]="'Allocated' | t: 'staff.myAssessors.column.allocated'"><zed-level-counts [counts]="u.LevelCounts" [label]="'Assessments allocated to {name}' | t: 'staff.myAssessors.row.allocatedAria' : { name: u.UserName || u.UserId }" /></td>
                    <td [attr.data-label]="'Sector' | t: 'staff.myAssessors.column.sector'"><span class="ma-pill" [class.is-none]="!u.SectorActivity">{{ u.SectorActivity || ('Not set' | t: 'staff.myAssessors.row.sectorNotSet') }}</span></td>
                  }
                  <td class="ma-contact" [attr.data-label]="consultancy ? ('Contact Details' | t: 'staff.myAssessors.column.contactDetails') : ('Contact' | t: 'staff.myAssessors.column.contact')">
                    <span [class.no-mobile]="!u.MobileNo">{{ u.MobileNo ? mobile(u.MobileNo) : ('Mobile not saved' | t: 'staff.myAssessors.row.noMobile') }}</span>
                    @if (u.Email) { <span class="ma-sub" [title]="u.Email">{{ email(u.Email) }}</span> }
                  </td>
                  <td class="text-center ma-status" [attr.data-label]="'Status' | t: 'staff.myAssessors.column.status'">
                    <span class="status-badge" [class.is-active]="u.IsActive" [class.is-rejected]="!u.IsActive">{{ u.IdStatus }}</span>
                    @if (!u.IsActive && !canUnblock(u)) {
                      <small class="ma-note">{{ 'The certificate is attached to another active Bronze Assessor.' | t: 'staff.myAssessors.row.certAttachedNote' }}</small>
                    }
                  </td>
                  <td class="ma-actions">
                    <div class="ma-btns">
                      <a [routerLink]="['/staff/users/assessors', u.UserId]" class="btn btn-outline-primary">{{ 'Edit' | t: 'staff.myAssessors.row.editButton' }}</a>
                      <zed-row-menu [items]="u.IsActive ? menuActive() : canUnblock(u) ? menuBlocked() : menuHistory()"
                                    [label]="'More actions for {name}' | t: 'staff.myAssessors.row.menuAria' : { name: u.UserName || u.UserId }" (picked)="pick($event, u)" />
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr class="empty-row">
                  <td [attr.colspan]="consultancy ? 5 : 7" style="padding: 0">
                    <div class="no-data">
                      {{ 'No {assessor} matches the search.' | t: 'staff.myAssessors.noMatch' : { assessor: labels.assessor.toLowerCase() } }}
                      <button type="button" class="btn btn-link p-0 ms-1" (click)="clearFilters()">{{ 'Show all' | t: 'staff.myAssessors.showAllButton' }}</button>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <zed-pager [pager]="view" />
      </div>
    }

    @if (resetFor(); as r) {
      <zed-confirm-dialog [ask]="r.ask" [busy]="saving()" [failed]="dialogError()" (confirmed)="sendReset(r.row)" (cancel)="closeDialogs()" />
    }
    @if (blockFor(); as b) {
      <zed-confirm-dialog [ask]="b.ask" [busy]="saving()" [failed]="dialogError()" inputId="assessor-reason" (confirmed)="block(b.row, $event)" (cancel)="closeDialogs()" />
    }
    @if (reasonAsk(); as r) {
      <zed-reason-dialog [ask]="r" [busy]="saving()" [failed]="dialogError()" (confirmed)="unblockWithReason(r, $event)" (cancel)="closeDialogs()" />
    }
    @if (historyFor(); as h) {
      <zed-user-history [subtitle]="(h.row.UserName || h.row.UserId) + ' · ' + h.row.UserId" [items]="h.items" [error]="h.error"
                        [fileName]="'history-' + h.row.UserId" (closed)="historyFor.set(null)" />
    }
    @if (loading()) {
      <div class="loadingdiv" role="status" aria-live="polite"><div class="spinner-border text-light"></div><span class="visually-hidden">{{ 'Loading…' | t: 'staff.myAssessors.loading' }}</span></div>
    }
  `,
  styles: `
    .ma-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; padding: 12px 16px; margin-bottom: 16px; }
    .ma-search { position: relative; flex: 1 1 280px; max-width: 420px; margin: 0; }
    .ma-search svg { position: absolute; left: 12px; top: 50%; width: 16px; height: 16px; transform: translateY(-50%); fill: none; stroke: #6b7f80; stroke-width: 2; }
    .ma-search input { padding-left: 36px; }
    .ma-showing { font-size: 13px; color: #5f6f70; }
    .ma-cap { margin: 0 0 8px; font-size: 13.5px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .ma-alloc { min-width: 170px; }

    .ma-list { padding: 0; overflow: hidden; }
    .ma-table { margin: 0; }
    .ma-table th:first-child, .ma-table td:first-child { padding-left: 14px; }
    .ma-table td { vertical-align: middle; overflow-wrap: anywhere; font-size: 14px; }
    .ma-table tbody tr:hover td { background: var(--zt-pale, #f7fbfb); }
    .ma-user { display: flex; align-items: center; gap: 12px; min-width: 180px; }
    .ma-who, .ma-contact { min-width: 0; display: flex; flex-direction: column; }
    .ma-avatar, .ma-photo img { flex: 0 0 34px; width: 34px; height: 34px; border-radius: 50%; }
    .ma-avatar { display: grid; place-items: center; background: var(--zt-soft, #d4ebe6); color: var(--zt-ink, #173f44); font-weight: 700; font-size: 12.5px; }
    tr.is-blocked .ma-avatar { background: #f6e3e1; color: #a8303a; }
    .ma-photo { flex: 0 0 34px; }
    .ma-photo img { display: block; object-fit: cover; border: 1px solid #dfe9ea; }
    .ma-name { font-weight: 700; color: var(--zt-ink, #173f44); }
    .ma-id, .ma-sub { font-size: 12.5px; color: #5f6f70; }
    .ma-contact { min-width: 150px; }
    .ma-contact > * { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lv-row { display: flex; gap: 5px; margin-bottom: 3px; }
    .lv { width: 21px; height: 21px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-size: 10.5px; font-weight: 800;
      background: var(--zt-mid2, #2a8a8c); box-shadow: inset 0 0 0 2px rgba(255,255,255,.45), 0 0 0 1.5px rgba(0,0,0,.12); }
    .lv-bronze { background: #c46a3c; }
    .lv-silver { background: #9aa4aa; }
    .lv-gold { background: #d2a12a; }
    .ma-type { font-size: 13px; color: #3d5254; }
    .ma-pill { display: inline-block; padding: 3px 11px; border-radius: 12px; background: #eef2f2; color: #4d6062; font-size: 12px; font-weight: 600; white-space: nowrap; }
    .ma-pill.is-none { background: #fff4d6; color: #8a6100; }
    .no-mobile { color: #8a6100; }
    .ma-note { display: block; margin-top: 4px; font-size: 12px; color: #8a6100; line-height: 1.4; }
    .ma-btns { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
    .ma-btns .btn { white-space: nowrap; }
    .no-data .btn-link { font-weight: 600; }

    .ma-empty { text-align: center; padding: 40px 20px; }
    .ma-empty-icon { display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; border-radius: 50%; background: #eef6f6;
      color: var(--zt-mid2, #2a8a8c); margin-bottom: 12px; }
    .ma-empty-title { font-size: 18px; font-weight: 700; color: var(--zt-ink, #173f44); margin: 0 0 6px; }
    .ma-empty-text { max-width: 520px; margin: 0 auto 16px; font-size: 14px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }

    @media (max-width: 767.98px) {
      .ma-search { max-width: none; flex-basis: 100%; }
      .ma-list { background: none; border: 0; box-shadow: none; }
      .ma-table thead { display: none; }
      .ma-table, .ma-table tbody, .ma-table tr, .ma-table td { display: block; width: 100%; }
      .ma-table tr { position: relative; background: #fff; border: 1px solid #e1eaea; border-radius: 12px; margin-bottom: 12px; padding: 8px 14px; }
      .ma-table tr.empty-row { border: 0; padding: 0; }
      .ma-table td, .ma-table td:first-child { border: 0; padding: 5px 0; text-align: left !important; }
      .ma-table tbody tr:hover td { background: transparent; }
      .ma-table td[data-label]::before { content: attr(data-label); display: block; font-size: 11.5px; font-weight: 700; color: #5f6f70; text-transform: uppercase; }
      .ma-user { min-width: 0; padding-right: 44px; }
      .ma-btns { justify-content: flex-start; }
      .ma-btns zed-row-menu { position: absolute; top: 12px; right: 12px; }
    }
  `,
})
export class MyAssessorsPage {
  private readonly system = inject(STAFF_SYSTEM);
  protected readonly consultancy = this.system === 'consultancy';
  protected readonly labels = LABELS[this.system];
  protected readonly crumbs = computed(() => staffCrumbs({ label: this.labels.assessors }));
  private readonly api = inject(UsersApi);
  private readonly toast = inject(ToastService);
  private readonly content = inject(ContentService);

  protected readonly assessors = signal<OwnAssessorRow[]>([]);
  /** Main (2026-11-18): the agency's own units allocated per level (none shown until read, or when they cannot be). */
  protected readonly levelTotals = signal<LevelCount[] | null>(null);
  protected readonly totalTiles = computed(() => levelCountTiles(this.levelTotals()));
  protected readonly search = signal('');
  protected readonly status = signal<StatusFilter>('all');
  protected readonly loading = signal(false);
  /** The first load answered (the empty state is not shown before). */
  protected readonly loaded = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  /** The server's refusal, shown in the open confirmation. */
  protected readonly dialogError = signal('');
  protected readonly resetFor = signal<{ row: OwnAssessorRow; ask: ConfirmAsk } | null>(null);
  protected readonly blockFor = signal<{ row: OwnAssessorRow; ask: ConfirmAsk } | null>(null);
  /** 2026-11-16 (the user): an unblock asks for its reason (recorded and e-mailed to the user). */
  protected readonly reasonAsk = signal<ReasonAsk | null>(null);
  protected readonly historyFor = signal<{ row: OwnAssessorRow; items: HistoryItem[] | null; error: string } | null>(null);
  protected readonly initials = initialsOf;
  protected readonly typeLabel = assessorTypeLabel;
  protected readonly medals = levelMedals;
  protected readonly mobile = plain;
  protected readonly email = plain;

  private readonly word = computed(() => (this.consultancy ? t('staff.myAssessors.word.consultant', 'consultant') : t('staff.myAssessors.word.assessor', 'assessor')));
  protected readonly menuActive = computed<RowMenuItem[]>(() => [
    { key: 'reset', label: t('staff.myAssessors.menu.reset', 'Send reset link'), icon: 'mail' },
    { key: 'history', label: t('staff.myAssessors.menu.history', 'View history'), icon: 'history' },
    { key: 'block', label: t('staff.myAssessors.menu.block', 'Block {word}', { word: this.word() }), icon: 'lock', danger: true },
  ]);
  protected readonly menuBlocked = computed<RowMenuItem[]>(() => [
    { key: 'history', label: t('staff.myAssessors.menu.history', 'View history'), icon: 'history' },
    { key: 'unblock', label: t('staff.myAssessors.menu.unblock', 'Unblock {word}', { word: this.word() }), icon: 'unlock' },
  ]);
  /** Blocked while the certificate is attached to another active Bronze Assessor: no Unblock. */
  protected readonly menuHistory = computed<RowMenuItem[]>(() => [{ key: 'history', label: t('staff.myAssessors.menu.history', 'View history'), icon: 'history' }]);

  protected readonly tiles = computed<ListCount[]>(() => {
    const rows = this.assessors();
    const active = rows.filter((r) => r.IsActive).length;
    return [
      { key: 'all', label: t('staff.myAssessors.count.all', 'All {assessors}', { assessors: this.labels.assessors.toLowerCase() }), value: rows.length },
      { key: 'active', label: t('staff.myAssessors.count.active', 'Active'), value: active, tone: 'good' },
      { key: 'blocked', label: t('staff.myAssessors.count.blocked', 'Blocked'), value: rows.length - active, tone: 'bad' },
    ];
  });

  protected readonly filtered = computed(() => {
    const s = this.search().trim().toLowerCase();
    const status = this.status();
    const rows = status === 'all' ? this.assessors() : this.assessors().filter((a) => (status === 'active') === a.IsActive);
    if (!s) return rows;
    return rows.filter((a) =>
      [a.UserId, a.UserName, a.AssessorType, a.MobileNo, a.Email, a.Address, a.IdStatus].some((v) => (v ?? '').toLowerCase().includes(s)),
    );
  });
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly view = new PagedView(() => this.filtered());

  constructor() {
    // The Add form's answer (e.g. "Assessor added …") arrives in the navigation state.
    const message = (globalThis.history?.state as { message?: unknown } | null)?.message;
    if (typeof message === 'string' && message) this.toast.success(t('staff.myAssessors.toast.added', '{assessor} added', { assessor: this.labels.assessor }), message);
    void this.load();
    if (!this.consultancy) void this.loadTotals();
  }

  /** The agency's totals per level; a failure leaves the tiles out (the list works without them). */
  private async loadTotals(): Promise<void> {
    try {
      this.levelTotals.set(await firstValueFrom(this.api.myLevelCounts()));
    } catch {
      this.levelTotals.set(null);
    }
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.assessors.set(await firstValueFrom(this.api.myAssessors()));
      this.loaded.set(true);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** Main: UnBlock is not offered while the certificate is attached to another active Bronze Assessor; consultancy: always. */
  protected canUnblock(u: OwnAssessorRow): boolean {
    return this.consultancy || u.IsCertAttached === 0;
  }

  protected clearFilters(): void {
    this.search.set('');
    this.status.set('all');
  }

  /** A row menu choice: each one confirms first (reset link, block, unblock) or opens the history panel. */
  protected pick(key: string, u: OwnAssessorRow): void {
    if (this.saving()) return;
    this.dialogError.set('');
    switch (key) {
      case 'reset': this.resetFor.set({ row: u, ask: resetLinkAsk(u.UserName, u.UserId, u.Email, this.labels.assessor) }); break;
      case 'block': void this.openBlock(u); break;
      case 'unblock': if (this.canUnblock(u)) this.reasonAsk.set({ action: 'unblock', userId: u.UserId, userName: u.UserName ?? null }); break;
      case 'history': void this.openHistory(u); break;
    }
  }

  protected closeDialogs(): void {
    if (this.saving()) return;
    this.resetFor.set(null);
    this.blockFor.set(null);
    this.reasonAsk.set(null);
    this.dialogError.set('');
  }

  /** The block confirmation, with the open assessments it leaves (read first; "not known" when it cannot be). */
  private async openBlock(u: OwnAssessorRow): Promise<void> {
    this.saving.set(true);
    assessorBlockNote(this.content, this.consultancy); // starts loading the Admin's texts while the count is read
    let open: number | null = null;
    try {
      open = (await firstValueFrom(this.api.assessorOpenAssessments(u.UserId))).count ?? null;
    } catch {
      /* shown as "not known" */
    } finally {
      this.saving.set(false);
    }
    this.blockFor.set({ row: u, ask: assessorBlockAsk(u.UserName, u.UserId, open, assessorBlockNote(this.content, this.consultancy), this.consultancy, null) });
  }

  protected async block(u: OwnAssessorRow, reason: string): Promise<void> {
    await this.run(this.api.block('assessors', u.UserId, reason), (m) => {
      this.toast.success(t('staff.myAssessors.toast.blocked', '{assessor} blocked', { assessor: this.labels.assessor }), m);
      return true;
    });
  }

  /** E-mails the assessor a link to set a new password. */
  protected async sendReset(u: OwnAssessorRow): Promise<void> {
    await this.run(this.api.passwordReset('assessors', u.UserId), (m) => {
      this.toast.success(t('staff.myAssessors.toast.resetSent', 'Reset link sent'), t('staff.myAssessors.toast.resetTo', 'E-mailed to {to}', { to: sentTo(m, u.Email) }));
      return false;
    });
  }

  protected async unblockWithReason(r: ReasonAsk, reason: string): Promise<void> {
    await this.run(this.api.unblock('assessors', r.userId, reason), (m) => {
      this.toast.success(t('staff.myAssessors.toast.unblocked', '{assessor} unblocked', { assessor: this.labels.assessor }), m);
      return true;
    });
  }

  private async openHistory(u: OwnAssessorRow): Promise<void> {
    this.historyFor.set({ row: u, items: null, error: '' });
    try {
      const entries = await firstValueFrom(this.api.assessorHistory(u.UserId));
      if (this.historyFor()?.row === u) this.historyFor.set({ row: u, items: blockHistoryItems(entries, this.consultancy ? t('staff.myAssessors.history.organisationWord', 'organisation') : t('staff.myAssessors.history.agencyWord', 'agency')), error: '' });
    } catch (err) {
      if (this.historyFor()?.row === u) this.historyFor.set({ row: u, items: [], error: apiErrorMessage(err) });
    }
  }

  /** Runs a confirmed action: done → the toast (and a reload when `done` says so), the pop-up closes; refused → in the pop-up. */
  private async run(call: Observable<MessageResponse>, done: (message: string) => boolean): Promise<void> {
    this.saving.set(true);
    this.dialogError.set('');
    try {
      const reload = done((await firstValueFrom(call)).message);
      this.saving.set(false);
      this.closeDialogs();
      if (reload) await this.load();
    } catch (err) {
      this.dialogError.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
