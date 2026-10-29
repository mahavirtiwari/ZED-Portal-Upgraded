import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { ListSearchComponent, PagedView, PagerComponent, searchRows } from '../pager';

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
}

interface SubUsersResponse {
  accountType: string;
  permissions: PermissionOption[];
  users: SubUser[];
}

interface SubUserForm {
  userName: string;
  email: string;
  mobileNo: string;
  permissions: string[];
  isActive: boolean;
}

type LoginStatus = 'active' | 'locked' | 'blocked';

const API = '/api/staff/sub-users';

/**
 * MasterAdmin → Operation Admins, agency → Sub-Users (new in V4): logins for the owner's own staff. A sub-user signs in
 * with its own ID and works as the owner (same role and data) on the screens ticked here; the login ID is generated and
 * the password mailed to the sub-user. V4 layout: tiles with all, active, locked and blocked logins (a click filters), the
 * list in a card with a search box, a user column with initials, the screens as chips (four at most, then "+N more"; one
 * "All N screens" chip when it has every one), the last login with the date added, a card per login on phones, and the
 * pop-up in sections with a switch card per screen (Select all / Clear) and one for Active.
 */
@Component({
  selector: 'zed-staff-sub-users',
  imports: [FormsModule, DatePipe, PagerComponent, ListSearchComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ accountType() }}s</h3>
        <p class="page-sub">
          {{ accountType() }}s sign in with their own User ID and password and work as your login on the screens you give them.
          Their work is recorded under your login.
        </p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-primary" [disabled]="!options().length" (click)="add()">+ Add {{ accountType() }}</button>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }
    <div class="su-stats" role="group" aria-label="Logins by status">
      @for (t of tiles(); track t.key) {
        <button type="button" class="su-stat" [class]="'tile-' + t.key" [class.is-on]="status() === t.key" [attr.aria-pressed]="status() === t.key" (click)="status.set(t.key)">
          <span class="su-stat-count">{{ t.count }}</span>
          <span class="su-stat-label">{{ t.label }}</span>
        </button>
      }
    </div>
    <div class="zed-card su-list">
      <div class="su-toolbar">
        <span class="muted su-showing">{{ view.total() }} of {{ users().length }} logins{{ status() === 'all' ? '' : ' · ' + status() + ' only' }}</span>
        <zed-list-search [(value)]="search" placeholder="Search users" inputId="sub-users-search" [found]="view.total()" />
      </div>
      <div class="table-responsive">
        <table class="table table-zed su-table">
          <thead>
            <tr>
              <th>User</th><th>Contact</th><th>Screens</th><th class="text-center">Last Login</th>
              <th class="text-center" style="width: 100px">Status</th><th class="text-center" style="width: 210px">Actions</th>
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
                    <span class="status-badge su-badge-phone" [class.is-active]="statusOf(u) === 'active'" [class.is-pending]="statusOf(u) === 'locked'" [class.is-rejected]="statusOf(u) === 'blocked'">{{ statusLabel(u) }}</span>
                  </div>
                </td>
                <td class="su-contact" data-label="Contact">
                  @if (u.mobileNo) { <span>{{ u.mobileNo }}</span> }
                  @if (u.email) { <span class="su-mail">{{ u.email }}</span> }
                  @if (!u.mobileNo && !u.email) { <span class="su-mail">No contact saved</span> }
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
                <td class="text-center su-login" data-label="Last Login">
                  @if (u.lastLoginAt) { {{ u.lastLoginAt + 'Z' | date: 'dd-MM-yyyy HH:mm' }} } @else { <span class="su-never">Never signed in</span> }
                  <small class="d-block muted">Added {{ u.createdAt | date: 'dd-MM-yyyy' }}</small>
                </td>
                <td class="text-center su-status-cell">
                  <span class="status-badge" [class.is-active]="statusOf(u) === 'active'" [class.is-pending]="statusOf(u) === 'locked'" [class.is-rejected]="statusOf(u) === 'blocked'">
                    {{ statusLabel(u) }}
                  </span>
                </td>
                <td class="text-center su-actions-cell">
                  <div class="row-actions justify-content-center">
                    <button type="button" class="btn btn-outline-primary" (click)="edit(u)">Edit</button>
                    <button type="button" class="btn btn-default" [disabled]="busy()" (click)="resetPassword(u)">Reset Password</button>
                  </div>
                </td>
              </tr>
            } @empty {
              @if (!busy()) {
                <tr class="empty-row">
                  <td colspan="6" style="padding: 0">
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

    @if (form(); as f) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="sub-user-title">
        <div class="modal-dialog modal-popup modal-lg su-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h3 class="registration-title m-0" id="sub-user-title">{{ editing() ? 'Edit ' + editing() : 'Add ' + accountType() }}</h3>
              <button type="button" class="btn-close" aria-label="Close" (click)="close()"></button>
            </div>
            <form (ngSubmit)="save()" novalidate>
              <div class="modal-body">
                <h4 class="su-section">Details</h4>
                <div class="form-grid">
                  <label for="sub-name">Name<span class="req">*</span></label>
                  <input class="form-control" id="sub-name" name="userName" maxlength="100" [ngModel]="f.userName" (ngModelChange)="patch('userName', $event)" />
                  <label for="sub-email">Email<span class="req">*</span></label>
                  <input class="form-control" id="sub-email" name="email" type="email" maxlength="100" [ngModel]="f.email" (ngModelChange)="patch('email', $event)" />
                  <label for="sub-mobile">Mobile Number</label>
                  <input class="form-control" id="sub-mobile" name="mobileNo" maxlength="10" inputmode="numeric" [ngModel]="f.mobileNo" (ngModelChange)="patch('mobileNo', $event)" />
                </div>
                <div class="su-section su-screens-head">
                  <h4 id="sub-screens">Screens<span class="req">*</span> <small class="su-given">{{ f.permissions.length }} of {{ options().length }} given</small></h4>
                  <span class="su-bulk">
                    <button type="button" class="btn btn-link p-0" (click)="patch('permissions', allKeys())">Select all</button>
                    <button type="button" class="btn btn-link p-0" (click)="patch('permissions', [])">Clear</button>
                  </span>
                </div>
                <div class="su-perms" role="group" aria-labelledby="sub-screens">
                  @for (p of options(); track p.key) {
                    <label class="toggle-card form-switch" [class.active]="f.permissions.includes(p.key)" [for]="'perm-' + p.key">
                      <input class="form-check-input" type="checkbox" role="switch" [id]="'perm-' + p.key" [name]="'perm-' + p.key"
                             [checked]="f.permissions.includes(p.key)" (change)="toggle(p.key)" />
                      <span>{{ p.label }}</span>
                    </label>
                  }
                </div>
                @if (editing()) {
                  <h4 class="su-section">Access</h4>
                  <label class="toggle-card form-switch su-active-card" [class.active]="f.isActive" for="sub-active">
                    <input class="form-check-input" type="checkbox" role="switch" id="sub-active" name="isActive" [checked]="f.isActive" (change)="patch('isActive', !f.isActive)" />
                    <span><strong>Active</strong><small class="muted d-block">Switch off to block this login; it can no longer sign in.</small></span>
                  </label>
                } @else {
                  <p class="su-mail-note mt-3 mb-0">The User ID is generated, and a password is e-mailed to the {{ accountType().toLowerCase() }}.</p>
                }
                @if (formError()) { <div class="alert alert-danger mt-2 mb-0" role="alert">{{ formError() }}</div> }
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" (click)="close()">CANCEL</button>
                <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ editing() ? 'UPDATE' : 'SAVE' }}</button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    .su-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .su-stat { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 14px 18px; text-align: left; min-width: 0;
      background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; box-shadow: 0 1px 2px rgba(35,71,74,.05); cursor: pointer; }
    .su-stat:hover { border-color: #45a5ad; }
    .su-stat.is-on { border-color: #45a5ad; box-shadow: inset 0 0 0 1px #45a5ad; background: #eef6f6; }
    .su-stat-count { font-size: 26px; font-weight: 700; color: #23474a; line-height: 1.1; }
    .su-stat.tile-active .su-stat-count { color: #1e7a3c; }
    .su-stat.tile-locked .su-stat-count { color: #8a6100; }
    .su-stat.tile-blocked .su-stat-count { color: #a8303a; }
    .su-stat-label { font-size: 13px; color: #5f6f70; font-weight: 600; }
    .su-list { padding: 16px; }
    .su-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; margin-bottom: 12px; }
    .su-toolbar zed-list-search { margin: 0; }
    .su-showing { font-size: 13px; }
    .su-table { margin-bottom: 8px; }
    .su-table td { vertical-align: middle; }
    .su-table tbody tr:hover td { background: #f7fbfb; }
    .su-table tr.is-blocked td { background: #fbf7f7; }
    .su-user { display: flex; align-items: center; gap: 12px; min-width: 180px; }
    .su-who { min-width: 0; }
    .su-avatar { flex: 0 0 38px; width: 38px; height: 38px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
      color: #fff; background: linear-gradient(135deg, #45a5ad, #23474a); font-weight: 700; font-size: 13px; letter-spacing: .03em; }
    tr.is-blocked .su-avatar { background: #f3e9e9; color: #9b4a4a; }
    .su-name { display: block; font-weight: 600; color: #232527; overflow-wrap: anywhere; }
    .su-id { display: block; font-size: 12px; color: #6b7f80; letter-spacing: .3px; }
    .su-badge-phone { display: none; }
    .su-contact { min-width: 170px; }
    .su-contact span { display: block; line-height: 1.6; overflow-wrap: anywhere; }
    .su-mail, .su-never { font-size: 13px; color: #5f6f70; }
    .su-screens { min-width: 200px; max-width: 320px; }
    .su-login { white-space: nowrap; font-size: 14px; }
    .su-chip-all { background: #e6f6ec; color: #1e7a3c; }
    .su-chip-more { background: #fff; border: 1px dashed #9cc7cb; cursor: help; }
    .su-actions-cell .btn { white-space: nowrap; }
    .su-empty .btn-link { font-weight: 600; }

    .modal > .modal-dialog.modal-lg.su-dialog { max-width: 820px; width: calc(100% - 32px); }
    .su-section { margin: 0 0 10px; font-size: 14px; font-weight: 700; color: #23474a; text-transform: none; }
    h4.su-section:not(:first-child) { margin-top: 18px; }
    .su-screens-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 12px; margin-top: 18px; }
    .su-screens-head h4 { margin: 0; font-size: 14px; font-weight: 700; color: #23474a; }
    .su-given { font-weight: 600; color: #5f6f70; font-size: 12px; margin-left: 6px; }
    .su-bulk { display: inline-flex; gap: 14px; }
    .su-bulk .btn-link { font-size: 13px; font-weight: 600; }
    .su-perms { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .toggle-card { display: flex; gap: 10px; align-items: flex-start; border: 1px solid #dfe9ea; border-radius: 10px; padding: 10px 12px; margin: 0; cursor: pointer; }
    .toggle-card:hover { border-color: #45a5ad; }
    .toggle-card.active { border-color: #45a5ad; background: #f4fafa; }
    /* The skin makes pop-up labels bold; on these cards only the names that are meant to be are. */
    .modal .modal-popup label.toggle-card { font-weight: 400; color: #232527; }
    .toggle-card.form-switch { padding-left: 12px; }
    .toggle-card.form-switch .form-check-input { flex: none; float: none; margin: 3px 0 0; width: 2em; border: 1px solid #888; }
    .toggle-card strong { color: #23474a; }
    .su-mail-note { padding: 8px 12px; border-radius: 8px; background: #eef6f6; color: #2f7c83; font-size: 13px; }

    @media (max-width: 767.98px) {
      .su-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .su-stat { padding: 10px 12px; }
      .su-stat-count { font-size: 22px; }
      .su-toolbar zed-list-search { flex: 1 1 100%; }
      .su-table { min-width: 0; }
      .su-table thead { display: none; }
      .su-table, .su-table tbody, .su-table tr, .su-table td { display: block; width: 100%; box-sizing: border-box; }
      .su-table tr { border: 1px solid #dfe9ea; border-radius: 12px; margin-bottom: 12px; padding: 4px 12px; overflow: hidden; }
      .su-table tr.empty-row { border: 0; padding: 0; }
      .su-table td { border: 0; padding: 6px 0; text-align: left !important; max-width: none; }
      .su-table tr.is-blocked { background: #fbf7f7; }
      .su-table tr.is-blocked td, .su-table tbody tr:hover td { background: transparent; }
      .su-table td[data-label]::before { content: attr(data-label); display: block; font-size: 12px; font-weight: 600; color: #5f6f70; margin-bottom: 2px; }
      .su-user { min-width: 0; }
      .su-who { flex: 1 1 auto; }
      .su-badge-phone { display: inline-block; }
      .su-status-cell { display: none !important; }
      .su-contact, .su-screens { min-width: 0; }
      .su-login { white-space: normal; }
      .su-actions-cell .row-actions { flex-wrap: wrap; justify-content: flex-start !important; }
      .su-perms { grid-template-columns: minmax(0, 1fr); }
      .modal .su-dialog .form-grid { grid-template-columns: minmax(0, 1fr); gap: 6px; }
    }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class SubUsersPage {
  private readonly http = inject(HttpClient);

  protected readonly accountType = signal('Sub-User');
  protected readonly options = signal<PermissionOption[]>([]);
  protected readonly users = signal<SubUser[]>([]);
  /** The tile chosen above the list. */
  protected readonly status = signal<'all' | LoginStatus>('all');
  /** The search box above the list (any column). */
  protected readonly search = signal('');
  /** The tiles: all, active, locked and blocked logins; a click filters by status. */
  protected readonly tiles = computed(() => {
    const count = (s: LoginStatus) => this.users().filter((u) => this.statusOf(u) === s).length;
    return [
      { key: 'all' as const, label: 'All logins', count: this.users().length },
      { key: 'active' as const, label: 'Active', count: count('active') },
      { key: 'locked' as const, label: 'Locked', count: count('locked') },
      { key: 'blocked' as const, label: 'Blocked', count: count('blocked') },
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
  protected readonly success = signal('');
  protected readonly formError = signal('');

  constructor() {
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

  /** Two letters of the name (or of the user ID) for the round badge. */
  protected initials(u: SubUser): string {
    const words = (u.userName ?? '').trim().split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
    const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? u.userId).slice(0, 2);
    return letters.toUpperCase();
  }

  protected clearFilters(): void {
    this.status.set('all');
    this.search.set('');
  }

  protected add(): void {
    this.editing.set(null);
    this.formError.set('');
    this.form.set({ userName: '', email: '', mobileNo: '', permissions: [], isActive: true });
  }

  protected edit(u: SubUser): void {
    this.editing.set(u.userId);
    this.formError.set('');
    this.form.set({ userName: u.userName, email: u.email ?? '', mobileNo: u.mobileNo ?? '', permissions: [...u.permissions], isActive: u.isActive });
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
    await this.run(() => (id ? this.http.put<MessageResponse>(`${API}/${encodeURIComponent(id)}`, f) : this.http.post<MessageResponse>(API, f)), true);
  }

  protected async resetPassword(u: SubUser): Promise<void> {
    await this.run(() => this.http.post<MessageResponse>(`${API}/${encodeURIComponent(u.userId)}/reset-password`, null), false);
  }

  private async run(call: () => Observable<MessageResponse>, fromForm: boolean): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    this.formError.set('');
    try {
      const r = await firstValueFrom(call());
      if (fromForm) this.close();
      this.success.set(r.message);
      await this.load();
    } catch (err) {
      (fromForm ? this.formError : this.error).set(apiErrorMessage(err));
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
      this.users.set(r.users);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
