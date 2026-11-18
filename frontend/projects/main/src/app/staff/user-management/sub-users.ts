import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PageHead } from '../../msme/shared/page-head';
import { ConfirmAsk, ConfirmDialog } from '../confirm-dialog';
import { ListCount, ListCounts } from '../list-counts';
import { ListSearchComponent, PagedView, PagerComponent, searchRows } from '../pager';
import { RowMenu, RowMenuItem } from '../row-menu';
import { staffCrumbs } from '../staff-crumbs';
import { ToastService } from '../toast';
import { MultiSelect, MultiSelectOption } from '../users/multi-select';
import { plain } from '../users/user-display';

interface PermissionOption {
  key: string;
  label: string;
}

interface SubUser {
  userId: string;
  userName: string;
  email: string | null;
  mobileNo: string | null;
  permissions: string[];
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  locked: boolean;
  /** 2026-11-16: the state codes it may see; empty = every state. */
  states?: string[];
  /** 2026-11-16, operation admins: the assessment agencies it may see; empty = every agency. */
  agencies?: string[];
}

interface ScopeOption {
  code: string;
  name: string;
}

interface SubUsersResponse {
  accountType: string;
  permissions: PermissionOption[];
  users: SubUser[];
  states?: ScopeOption[];
  /** Master Admin only. */
  agencies?: ScopeOption[] | null;
}

interface SubUserForm {
  userName: string;
  email: string;
  mobileNo: string;
  permissions: string[];
  isActive: boolean;
  states: string[];
  agencies: string[];
}

type LoginStatus = 'active' | 'locked' | 'blocked';

/** A row menu action waiting for its confirmation. */
interface PendingAction {
  key: 'reset' | 'block' | 'unblock';
  user: SubUser;
  ask: ConfirmAsk;
}

const API = '/api/staff/sub-users';

/**
 * MasterAdmin → Operation Admins, agency → Sub-Users (new in V4): logins for the owner's own staff. A sub-user signs in
 * with its own ID and works as the owner (same role and data) on the screens ticked here; the login ID is generated and
 * the password mailed to the sub-user.
 * 2026-11-17 (approved staff-20 / popup-02): the page head with the Add button, the shared count tiles (all, active, locked,
 * blocked; a click filters), the search bar, the list with the contact (in full since 2026-11-18, the user: never masked), the screens as chips (four at most, then
 * "+N more"; one "All N screens" chip when it has every one), a locked login flagged in amber with a lock, and per row Edit
 * plus a row menu: a new password (on a locked login "Unlock", as the new password also lifts the lock), Block / Unblock,
 * each after a confirmation, and a toast once done. The pop-up has two columns: details and scope on the left, the screens
 * as switches on the right, and a fixed footer.
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): staff-20 / popup-02 values: 34px light avatars, 13.5 / 12.5px
 * text, an uppercase grey scope pill, ACTIONS on the right, a 62px toolbar card; the pop-up with a white head (icon tile, grey
 * square close), the states and agencies as drop-down multi-selects (so it fits a laptop screen without scrolling), 42px
 * screen tiles with 40 x 22 switches (teal outline when on) and 40px title-case buttons; the tab title names the page.
 */
@Component({
  selector: 'zed-staff-sub-users',
  imports: [FormsModule, DatePipe, NgTemplateOutlet, PagerComponent, ListSearchComponent, MultiSelect, PageHead, ListCounts, RowMenu, ConfirmDialog],
  template: `
    <zed-page-head [crumbs]="crumbs()" [title]="accountType() + 's'"
                   subtitle="They sign in with their own User ID and work as your login on the screens you give them. Their work is recorded under your login.">
      <button type="button" class="btn btn-primary" [disabled]="!options().length" (click)="add()">+ Add {{ accountType() }}</button>
    </zed-page-head>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    <zed-list-counts [counts]="tiles()" [selected]="status()" label="Logins by status" (pick)="pickStatus($event.key)" />
    <div class="zed-card su-toolbar">
      <zed-list-search [(value)]="search" placeholder="Search users" inputId="sub-users-search" [found]="view.total()" />
      <span class="muted su-showing">{{ view.total() }} of {{ users().length }} logins{{ status() === 'all' ? '' : ' · ' + status() + ' only' }}</span>
    </div>
    <div class="zed-card su-list">
      <div class="table-responsive">
        <table class="table table-zed su-table">
          <thead>
            <tr>
              <th>User</th><th>Contact</th><th>Screens</th><th>Scope</th><th>Last login</th>
              <th class="text-center" style="width: 110px">Status</th><th class="text-end" style="width: 120px">Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (u of view.page(); track u.userId) {
              <tr [class.is-blocked]="!u.isActive">
                <td>
                  <div class="su-user">
                    <span class="su-avatar" aria-hidden="true">{{ initials(u) }}</span>
                    <span class="su-who">
                      <span class="su-name">{{ u.userName }}</span>
                      <span class="su-id">{{ u.userId }}</span>
                    </span>
                    <ng-container *ngTemplateOutlet="badge; context: { $implicit: u, phone: true }" />
                  </div>
                </td>
                <!-- 2026-11-18 (the user): the mobile and e-mail in full (never masked); a long e-mail is cut with "…" and its tooltip. -->
                <td class="su-contact" data-label="Contact">
                  @if (u.mobileNo) { <span>{{ mobileOf(u) }}</span> } @else { <span class="no-mobile">Mobile not saved</span> }
                  @if (u.email) { <span class="su-mail" [title]="u.email">{{ mailOf(u) }}</span> }
                </td>
                <td class="su-screens" data-label="Screens">
                  @if (hasAll(u)) {
                    <span class="zed-chip su-chip-all">All {{ options().length }} screens</span>
                  } @else {
                    @for (p of u.permissions.slice(0, 4); track p) { <span class="zed-chip">{{ label(p) }}</span> }
                    @if (u.permissions.length > 4) {
                      <span class="zed-chip su-chip-more" [title]="moreLabels(u)">+{{ u.permissions.length - 4 }} more</span>
                    }
                  }
                  @if (!u.permissions.length) { <span class="su-mail">No screens</span> }
                </td>
                <td class="su-scope" data-label="Scope"><span class="su-scope-pill" data-scope>{{ scopeText(u) }}</span></td>
                <td class="su-login" data-label="Last Login">
                  @if (u.lastLoginAt) { {{ u.lastLoginAt + 'Z' | date: 'dd-MM-yyyy HH:mm' }} } @else { <span class="su-never">Never signed in</span> }
                  <small class="d-block muted">Added {{ u.createdAt | date: 'dd-MM-yyyy' }}</small>
                </td>
                <td class="text-center su-status-cell"><ng-container *ngTemplateOutlet="badge; context: { $implicit: u }" /></td>
                <td class="text-end su-actions-cell">
                  <div class="su-actions">
                    <button type="button" class="btn btn-outline-primary" (click)="edit(u)">Edit</button>
                    <zed-row-menu [items]="menuOf(u)" [label]="'More actions for ' + u.userName" (picked)="picked(u, $event)" />
                  </div>
                </td>
              </tr>
            } @empty {
              @if (!busy()) {
                <tr class="empty-row">
                  <td colspan="7" style="padding: 0">
                    <div class="no-data su-empty">
                      @if (users().length) {
                        No login matches the filters.
                        <button type="button" class="btn btn-link p-0 ms-1" (click)="clearFilters()">Show all logins</button>
                      } @else {
                        No {{ accountType().toLowerCase() }}s yet.
                        @if (options().length) {
                          <button type="button" class="btn btn-link p-0 ms-1" (click)="add()">Add the first {{ accountType().toLowerCase() }}</button>
                        }
                      }
                    </div>
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
      <zed-pager [pager]="view" />
    </div>
    <ng-template #badge let-u let-phone="phone">
      <span class="status-badge" [class.su-badge-phone]="phone" [class.is-active]="statusOf(u) === 'active'" [class.is-pending]="statusOf(u) === 'locked'"
            [class.is-rejected]="statusOf(u) === 'blocked'">
        @if (statusOf(u) === 'locked') { <svg class="su-lock" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4" /></svg> }
        {{ statusLabel(u) }}
      </span>
    </ng-template>

    @if (form(); as f) {
      <!-- 2026-11-17 (approved popup-02): two columns (details and scope | screens), sized to a laptop screen, the footer always in view. -->
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="sub-user-title">
        <div class="modal-dialog modal-popup su-dialog">
          <div class="modal-content su-content">
            <div class="su-head">
              <span class="su-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" /></svg></span>
              <div>
                <h3 class="m-0" id="sub-user-title">{{ editing() ? 'Edit ' + editing() : 'Add ' + accountType() }}</h3>
                <small class="su-sub">{{ editing() ? f.userName : 'The User ID is generated and the login details are e-mailed to the user.' }}</small>
              </div>
              <button type="button" class="su-x" aria-label="Close" (click)="close()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18 M6 6l12 12" /></svg></button>
            </div>
            <form class="su-form" (ngSubmit)="save()" novalidate>
              <div class="modal-body su-body">
                <div class="su-col">
                  <div class="su-field">
                    <label for="sub-name">Name<span class="req">*</span></label>
                    <input class="form-control" id="sub-name" name="userName" maxlength="100" placeholder="Full name" [ngModel]="f.userName" (ngModelChange)="patch('userName', $event)" />
                  </div>
                  <div class="su-field">
                    <label for="sub-email">E-mail<span class="req">*</span></label>
                    <input class="form-control" id="sub-email" name="email" type="email" maxlength="100" placeholder="name@organisation.in" [ngModel]="f.email" (ngModelChange)="patch('email', $event)" />
                  </div>
                  <div class="su-field">
                    <label for="sub-mobile">Mobile number</label>
                    <input class="form-control" id="sub-mobile" name="mobileNo" maxlength="10" inputmode="numeric" placeholder="10 digits (optional)" [ngModel]="f.mobileNo" (ngModelChange)="patch('mobileNo', $event)" />
                  </div>
                  <!-- 2026-11-16 (approved): the states (and, for an operation admin, the assessment agencies) it may see. -->
                  <h4 class="su-section">Scope</h4>
                  <div class="su-field" data-scope-states>
                    <label class="su-label" for="sub-states">States <small>· none selected = every state</small></label>
                    <zed-multi-select variant="dropdown" label="States" inputId="sub-states" allText="every state" [options]="stateOptions()" [value]="f.states"
                                      (valueChange)="patch('states', $event)" />
                  </div>
                  @if (agencyOptions(); as ag) {
                    <div class="su-field" data-scope-agencies>
                      <label class="su-label" for="sub-agencies">Assessment agencies <small>· none selected = every agency</small></label>
                      <zed-multi-select variant="dropdown" label="Assessment agencies" inputId="sub-agencies" allText="every agency" [options]="ag" [value]="f.agencies"
                                        (valueChange)="patch('agencies', $event)" />
                    </div>
                  }
                  <p class="su-hint">{{ scopeNote() }}</p>
                  @if (editing()) {
                    <h4 class="su-section">Access</h4>
                    <label class="toggle-card form-switch" [class.active]="f.isActive" for="sub-active">
                      <input class="form-check-input" type="checkbox" role="switch" id="sub-active" name="isActive" [checked]="f.isActive" (change)="patch('isActive', !f.isActive)" />
                      <span><strong>Active</strong><small class="muted d-block">Switch off to block this login; it can no longer sign in.</small></span>
                    </label>
                  }
                </div>
                <div class="su-col">
                  <div class="su-screens-head">
                    <h4 id="sub-screens">Screens<span class="req">*</span> <small class="su-given">{{ f.permissions.length }} of {{ options().length }} given</small></h4>
                    <span class="su-bulk">
                      <button type="button" class="btn btn-link p-0" (click)="patch('permissions', allKeys())">Select all</button> ·
                      <button type="button" class="btn btn-link p-0" (click)="patch('permissions', [])">Clear</button>
                    </span>
                  </div>
                  <div class="su-perms" role="group" aria-labelledby="sub-screens">
                    @for (p of options(); track p.key) {
                      <label class="toggle-card form-switch" [class.active]="f.permissions.includes(p.key)" [for]="'perm-' + p.key">
                        <input class="form-check-input" type="checkbox" role="switch" [id]="'perm-' + p.key" [name]="'perm-' + p.key"
                               [checked]="f.permissions.includes(p.key)" (change)="toggle(p.key)" />
                        <span class="su-perm-name" [title]="p.label">{{ p.label }}</span>
                      </label>
                    }
                  </div>
                  <p class="su-note"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01" /></svg><span>Work done by {{ whoWord() }} is recorded under your login. You can change the screens or block the login at any time.</span></p>
                  @if (formError()) { <div class="alert alert-danger mt-3 mb-0" role="alert">{{ formError() }}</div> }
                </div>
              </div>
              <div class="modal-footer su-foot">
                <span class="su-foot-note">Fields marked <span class="req">*</span> are required.</span>
                <span class="su-foot-actions">
                  <button type="button" class="btn btn-default" (click)="close()">Cancel</button>
                  <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ editing() ? 'Save changes' : 'Add ' + accountType().toLowerCase() }}</button>
                </span>
              </div>
            </form>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
    @if (pending(); as p) {
      <zed-confirm-dialog [ask]="p.ask" [busy]="busy()" [failed]="pendingError()" (confirmed)="confirmed(p)" (cancel)="pending.set(null)" />
    }
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styleUrl: './sub-users-dialog.css',
  styles: `
    .su-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; min-height: 62px; padding: 12px 16px; margin-bottom: 16px; }
    .su-toolbar zed-list-search { margin: 0; flex: 0 1 340px; }
    .su-showing { font-size: 12.5px; font-weight: 500; color: #6f8487; }
    .su-list { padding: 0; overflow: hidden; }
    .su-table { margin-bottom: 0; }
    .su-table td { vertical-align: middle; }
    .su-table tbody tr:hover td { background: #f4fafa; }
    .su-table tr.is-blocked td { background: #fdf6f5; }
    .su-user { display: flex; align-items: center; gap: 10px; min-width: 180px; }
    .su-who { min-width: 0; }
    .su-avatar { flex: 0 0 34px; width: 34px; height: 34px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
      color: #24666b; background: #e6f2f3; font-weight: 800; font-size: 11.5px; }
    tr.is-blocked .su-avatar { background: #fbe9e7; color: #c8473c; }
    .su-name { display: block; font-size: 13.5px; font-weight: 700; color: #17373b; overflow-wrap: anywhere; }
    .su-id { display: block; font-size: 11.5px; font-weight: 600; color: #6f8487; }
    .su-badge-phone { display: none; }
    .su-lock { width: 11px; height: 11px; margin-right: 2px; vertical-align: -1px; fill: none; stroke: currentColor; stroke-width: 2.4; }
    .su-contact { min-width: 150px; font-size: 12.5px; font-weight: 500; color: #3d5559; }
    .su-contact span { display: block; line-height: 17px; overflow-wrap: anywhere; }
    .su-contact .su-mail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; overflow-wrap: normal; }
    .su-mail, .su-never { font-size: 11.5px; font-weight: 500; color: #6f8487; }
    .no-mobile { color: #9a5f06; }
    .su-screens { min-width: 200px; max-width: 330px; }
    .su-screens .zed-chip { display: inline-block; margin: 2px 4px 2px 0; }
    .su-scope-pill { display: inline-block; padding: 4px 11px; border-radius: 11px; background: #ecf0f0; color: #6f8487; font-size: 10.5px; font-weight: 700;
      letter-spacing: .4px; line-height: 14px; text-transform: uppercase; white-space: nowrap; }
    .su-login { white-space: nowrap; font-size: 12.5px; font-weight: 500; color: #3d5559; }
    .su-login small { font-size: 11.5px; color: #6f8487; }
    .su-chip-all { background: #e5f5ea !important; color: #2f9e58 !important; }
    .su-chip-more { background: #fff !important; border: 1px dashed #9cc7cb; cursor: help; }
    .su-actions { display: inline-flex; align-items: center; gap: 8px; }
    .su-actions .btn { min-height: 30px; padding: 3px 12px; font-size: 12.5px; white-space: nowrap; }
    .su-empty .btn-link { font-weight: 600; }

    @media (max-width: 767.98px) {
      .su-toolbar zed-list-search { flex: 1 1 100%; }
      .su-list { padding: 0; background: none; border: 0; box-shadow: none; }
      .su-table { min-width: 0; }
      .su-table thead { display: none; }
      .su-table, .su-table tbody, .su-table tr, .su-table td { display: block; width: 100%; box-sizing: border-box; }
      .su-table tr { border: 1px solid #dde7e8; border-radius: 12px; margin-bottom: 12px; padding: 4px 12px; overflow: hidden; background: #fff; }
      .su-table tr.empty-row { border: 0; padding: 0; }
      .su-table td { border: 0; padding: 6px 0; text-align: left !important; max-width: none; }
      .su-table tr.is-blocked { background: #fdf6f5; }
      .su-table tr.is-blocked td, .su-table tbody tr:hover td { background: transparent; }
      .su-table td[data-label]::before { content: attr(data-label); display: block; font-size: 11.5px; font-weight: 700; color: #6f8487; margin-bottom: 2px; }
      .su-user { min-width: 0; }
      .su-who { flex: 1 1 auto; }
      .su-badge-phone { display: inline-block; }
      .su-status-cell { display: none !important; }
      .su-contact, .su-screens { min-width: 0; }
      .su-login { white-space: normal; }
    }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class SubUsersPage {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);

  protected readonly accountType = signal('Sub-User');
  protected readonly crumbs = computed(() => staffCrumbs({ label: this.accountType() + 's' }));
  /** "an operation admin", "a sub-user" (the pop-up's note). */
  protected readonly whoWord = computed(() => (/^[aeiou]/i.test(this.accountType()) ? 'an ' : 'a ') + this.accountType().toLowerCase());
  protected readonly options = signal<PermissionOption[]>([]);
  protected readonly stateOptions = signal<MultiSelectOption[]>([]);
  /** Master Admin only: null for an agency's sub-users. */
  protected readonly agencyOptions = signal<MultiSelectOption[] | null>(null);
  protected readonly scopeNote = computed(() =>
    this.agencyOptions()
      ? 'The operation admin sees only the units whose plant is in these states and the applications these agencies assess, on every screen given.'
      : "The sub-user sees only your units whose plant is in these states, on every screen given.");
  protected readonly users = signal<SubUser[]>([]);
  /** The tile chosen above the list. */
  protected readonly status = signal<'all' | LoginStatus>('all');
  /** The search box above the list (any column). */
  protected readonly search = signal('');
  /** The tiles: all, active, locked and blocked logins; a click filters by status. */
  protected readonly tiles = computed<ListCount[]>(() => {
    const count = (s: LoginStatus) => this.users().filter((u) => this.statusOf(u) === s).length;
    return [
      { key: 'all', label: 'All logins', value: this.users().length },
      { key: 'active', label: 'Active', value: count('active'), tone: 'good' },
      { key: 'locked', label: 'Locked', value: count('locked'), tone: 'warn' },
      { key: 'blocked', label: 'Blocked', value: count('blocked'), tone: 'bad' },
    ];
  });
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly view = new PagedView(() =>
    searchRows(this.users().filter((u) => this.status() === 'all' || this.statusOf(u) === this.status()), this.search()),
  );
  protected readonly form = signal<SubUserForm | null>(null);
  protected readonly editing = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly formError = signal('');
  /** The row menu action waiting for its confirmation, and the server's refusal shown in it. */
  protected readonly pending = signal<PendingAction | null>(null);
  protected readonly pendingError = signal('');

  constructor() {
    // 2026-11-18 (the user: staff pages 'not aligned with SVG files'): the tab names the page ("ZED | Operation Admins").
    const title = inject(Title);
    effect(() => title.setTitle(`ZED | ${this.accountType()}s`));
    void this.load();
  }

  protected label(key: string): string {
    return this.options().find((p) => p.key === key)?.label ?? key;
  }

  /** Every screen there is to give (shown as one chip). */
  protected hasAll(u: SubUser): boolean {
    return this.options().length > 1 && this.options().every((p) => u.permissions.includes(p.key));
  }

  /** The screens behind "+N more" (its tooltip). */
  protected moreLabels(u: SubUser): string {
    return u.permissions.slice(4).map((p) => this.label(p)).join(', ');
  }

  protected allKeys(): string[] {
    return this.options().map((p) => p.key);
  }

  protected statusOf(u: SubUser): LoginStatus {
    return !u.isActive ? 'blocked' : u.locked ? 'locked' : 'active';
  }

  protected statusLabel(u: SubUser): string {
    return u.isActive ? (u.locked ? 'Locked' : 'Active') : 'Blocked';
  }

  protected mobileOf(u: SubUser): string {
    return plain(u.mobileNo);
  }

  protected mailOf(u: SubUser): string {
    return plain(u.email);
  }

  /** Two letters of the name (or of the user ID) for the round badge. */
  protected initials(u: SubUser): string {
    const words = (u.userName ?? '').trim().split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
    const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? u.userId).slice(0, 2);
    return letters.toUpperCase();
  }

  protected pickStatus(key: string | undefined): void {
    this.status.set(key === 'active' || key === 'locked' || key === 'blocked' ? key : 'all');
  }

  protected clearFilters(): void {
    this.status.set('all');
    this.search.set('');
  }

  /**
   * The row menu: a new password (on a locked login "Unlock": there is no separate unlock, the new password lifts the lock),
   * then Block (red) or Unblock.
   */
  protected menuOf(u: SubUser): RowMenuItem[] {
    return [
      this.statusOf(u) === 'locked'
        ? { key: 'reset', label: 'Unlock (send new password)', icon: 'unlock' }
        : { key: 'reset', label: 'Send new password', icon: 'mail' },
      u.isActive ? { key: 'block', label: 'Block login', icon: 'lock', danger: true } : { key: 'unblock', label: 'Unblock login', icon: 'refresh' },
    ];
  }

  protected picked(u: SubUser, key: string): void {
    const name = `${u.userName} (${u.userId})`;
    const to = plain(u.email) || 'the registered e-mail address';
    let ask: ConfirmAsk;
    if (key === 'reset' && this.statusOf(u) === 'locked') {
      ask = {
        title: `Unlock ${u.userName}?`,
        message: `The lock is lifted at once and ${name} gets a new password by e-mail at ${to}. The current password stops working.`,
        confirmLabel: 'Unlock and send password',
      };
    } else if (key === 'reset') {
      ask = {
        title: 'Send a new password?',
        message: `${name} gets a new password by e-mail at ${to}. The current password stops working at once.`,
        confirmLabel: 'Send new password',
      };
    } else if (key === 'block') {
      ask = {
        title: `Block ${u.userName}?`,
        message: `${name} cannot sign in until you unblock the login. Its screens and scope are kept; nothing is deleted.`,
        confirmLabel: 'Block login',
        danger: true,
      };
    } else if (key === 'unblock') {
      ask = {
        title: `Unblock ${u.userName}?`,
        message: `${name} can sign in again with the current password, on the same screens.`,
        confirmLabel: 'Unblock login',
      };
    } else {
      return;
    }
    this.pendingError.set('');
    this.pending.set({ key, user: u, ask });
  }

  /** The confirmed row action: a new password (reset-password), or Block / Unblock (the same update as Edit's Active switch). */
  protected async confirmed(p: PendingAction): Promise<void> {
    const u = p.user;
    const id = encodeURIComponent(u.userId);
    this.busy.set(true);
    this.error.set('');
    try {
      if (p.key === 'reset') {
        await firstValueFrom(this.http.post<MessageResponse>(`${API}/${id}/reset-password`, null));
        this.toast.success(this.statusOf(u) === 'locked' ? 'Login unlocked' : 'New password sent', 'New password e-mailed to ' + (plain(u.email) || 'the registered e-mail address'));
      } else {
        const body: SubUserForm = {
          userName: u.userName, email: u.email ?? '', mobileNo: u.mobileNo ?? '', permissions: [...u.permissions], isActive: p.key === 'unblock',
          states: [...(u.states ?? [])], agencies: [...(u.agencies ?? [])],
        };
        await firstValueFrom(this.http.put<MessageResponse>(`${API}/${id}`, body));
        this.toast.success(p.key === 'block' ? 'Login blocked' : 'Login unblocked',
          `${u.userName} (${u.userId}) ${p.key === 'block' ? 'can no longer sign in' : 'can sign in again'}.`);
      }
      this.pending.set(null);
      await this.load();
    } catch (err) {
      this.pendingError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected add(): void {
    this.editing.set(null);
    this.formError.set('');
    this.form.set({ userName: '', email: '', mobileNo: '', permissions: [], isActive: true, states: [], agencies: [] });
  }

  protected edit(u: SubUser): void {
    this.editing.set(u.userId);
    this.formError.set('');
    this.form.set({
      userName: u.userName, email: u.email ?? '', mobileNo: u.mobileNo ?? '', permissions: [...u.permissions], isActive: u.isActive,
      states: [...(u.states ?? [])], agencies: [...(u.agencies ?? [])],
    });
  }

  /** The list's Scope chip: "2 states · 1 agency", "All states". */
  protected scopeText(u: SubUser): string {
    const s = u.states?.length ?? 0;
    const a = u.agencies?.length ?? 0;
    const states = s === 0 ? 'All states' : s === 1 ? this.stateName(u.states![0]) : `${s} states`;
    if (!this.agencyOptions()) return states;
    return `${states} · ${a === 0 ? 'all agencies' : a === 1 ? '1 agency' : a + ' agencies'}`;
  }

  private stateName(code: string): string {
    return this.stateOptions().find((o) => o.value === code)?.label ?? code;
  }

  protected close(): void {
    this.form.set(null);
    this.editing.set(null);
  }

  protected patch<K extends keyof SubUserForm>(key: K, value: SubUserForm[K]): void {
    this.form.update((f) => (f ? { ...f, [key]: value } : f));
  }

  protected toggle(key: string): void {
    this.form.update((f) =>
      f ? { ...f, permissions: f.permissions.includes(key) ? f.permissions.filter((p) => p !== key) : [...f.permissions, key] } : f,
    );
  }

  protected async save(): Promise<void> {
    const f = this.form();
    if (!f) return;
    const id = this.editing();
    this.busy.set(true);
    this.error.set('');
    this.formError.set('');
    try {
      const r = await firstValueFrom(id ? this.http.put<MessageResponse>(`${API}/${encodeURIComponent(id)}`, f) : this.http.post<MessageResponse>(API, f));
      this.close();
      this.toast.success(`${this.accountType()} ${id ? 'updated' : 'added'}`, r.message);
      await this.load();
    } catch (err) {
      this.formError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    this.busy.set(true);
    try {
      const r = await firstValueFrom(this.http.get<SubUsersResponse>(API));
      this.accountType.set(r.accountType);
      this.options.set(r.permissions);
      this.stateOptions.set((r.states ?? []).map((o) => ({ value: o.code, label: o.name })));
      this.agencyOptions.set(r.agencies ? r.agencies.map((o) => ({ value: o.code, label: o.name })) : null);
      this.users.set(r.users);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
