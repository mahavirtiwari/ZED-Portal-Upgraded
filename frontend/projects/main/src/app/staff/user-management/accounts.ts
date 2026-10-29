import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { PagedView, PagerComponent } from '../pager';

interface AccountType {
  roleId: number;
  label: string;
  needsState: boolean;
}

interface Account {
  userId: string;
  userName: string | null;
  roleId: number;
  email: string | null;
  mobileNo: string | null;
  stateCode: string | null;
  isActive: boolean | null;
}

interface AccountsResponse {
  types: AccountType[];
  states: { code: string; name: string }[];
  accounts: Account[];
}

interface AccountForm {
  userId: string;
  roleId: number | null;
  userName: string;
  email: string;
  mobileNo: string;
  stateCode: string;
}

const API = '/api/staff/accounts';

/** What each login type opens (the staff menu's roles), shown on its card in the pop-up. */
const typeHints: Readonly<Record<number, string>> = {
  7: 'Agencies, assessors and the assessment work.',
  8: 'The Ministry of MSME: dashboards and reports.',
  6: 'One state: its NEFT transactions and reports.',
  10: 'Dashboards, reports and failed transactions.',
  11: 'Dashboards, financial support and reports.',
  17: 'Dashboards: registered MSMEs and their history.',
};

/**
 * Admin → User Management (new in V4): the Master Admin, Ministry, MSME DFO and dashboard logins of this portal. The
 * password is generated and mailed to the user; Reset Password mails a new one. V4 layout: tiles with the active and
 * blocked logins (a click filters), pill tabs per login type with their counts and a search box, a user column with
 * initials, the login type with its state under it, contact with icons, a card per login on phones, a confirmation before
 * Block and Reset Password, and the pop-up with a choice card per login type.
 */
@Component({
  selector: 'zed-staff-accounts',
  imports: [FormsModule, PagerComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">User Management</h3>
        <p class="page-sub">Master Admin, Ministry, MSME DFO and dashboard logins; the password is generated and e-mailed to the user.</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-primary" (click)="add()">+ Add Login</button>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }
    <div class="acc-stats" role="group" aria-label="Logins by status">
      @for (t of tiles(); track t.key) {
        <button type="button" class="acc-stat" [class]="'tile-' + t.key" [class.is-on]="status() === t.key" [attr.aria-pressed]="status() === t.key" (click)="status.set(t.key)">
          <span class="acc-stat-count">{{ t.count }}</span>
          <span class="acc-stat-label">{{ t.label }}</span>
        </button>
      }
    </div>
    <div class="zed-card acc-list">
      <div class="acc-tabs" role="tablist" aria-label="Login types">
        <button type="button" role="tab" class="acc-tab" [class.active]="!filter()" [attr.aria-selected]="!filter()" (click)="filter.set(0)">
          All login types <span class="tab-count">{{ accounts().length }}</span>
        </button>
        @for (t of types(); track t.roleId) {
          <button type="button" role="tab" class="acc-tab" [class.active]="filter() === t.roleId" [attr.aria-selected]="filter() === t.roleId" (click)="filter.set(t.roleId)">
            {{ t.label }} <span class="tab-count">{{ countOf(t.roleId) }}</span>
          </button>
        }
      </div>
      <div class="acc-toolbar">
        <input id="acc-search" type="search" class="form-control acc-search" placeholder="Search user ID, name, e-mail or mobile" aria-label="Search logins"
               [ngModel]="search()" (ngModelChange)="search.set($event)" />
        <span class="muted acc-showing">{{ shown().length }} of {{ accounts().length }} logins{{ status() === 'all' ? '' : ' · ' + (status() === 'active' ? 'active' : 'blocked') + ' only' }}</span>
      </div>
      <div class="table-responsive">
        <table class="table table-zed acc-table">
          <thead>
            <tr>
              <th>User</th><th class="text-center">Login Type</th><th>Contact</th>
              <th class="text-center" style="width: 110px">Status</th><th class="text-center" style="width: 300px">Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (a of view.page(); track a.userId + a.roleId) {
              <tr [class.is-blocked]="!a.isActive">
                <td>
                  <div class="acc-user">
                    <span class="acc-avatar" aria-hidden="true">{{ initials(a) }}</span>
                    <span class="acc-who">
                      <span class="acc-name">{{ a.userName || '—' }}</span>
                      <span class="acc-id">{{ a.userId }}</span>
                    </span>
                    <span class="status-badge acc-badge-phone" [class.is-active]="a.isActive" [class.is-rejected]="!a.isActive">{{ a.isActive ? 'Active' : 'Blocked' }}</span>
                  </div>
                </td>
                <td class="text-center acc-type-cell" data-label="Login Type">
                  <span class="zed-chip">{{ typeLabel(a.roleId) }}</span>
                  @if (stateName(a.stateCode); as s) { <span class="acc-state">{{ s }}</span> }
                </td>
                <td class="acc-contact" data-label="Contact">
                  @if (a.mobileNo) {
                    <span class="acc-mobile"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 1.5h2l1 3-1.5 1a8 8 0 0 0 4.5 4.5l1-1.5 3 1v2a1.5 1.5 0 0 1-1.5 1.5A11.5 11.5 0 0 1 3 3a1.5 1.5 0 0 1 1.5-1.5z"/></svg>{{ a.mobileNo }}</span>
                  }
                  @if (a.email) {
                    <span class="acc-mail"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.5h12v9H2z M2 4l6 4.5L14 4"/></svg>{{ a.email }}</span>
                  }
                  @if (!a.mobileNo && !a.email) { <span class="acc-mail">No contact saved</span> }
                </td>
                <td class="text-center acc-status-cell"><span class="status-badge" [class.is-active]="a.isActive" [class.is-rejected]="!a.isActive">{{ a.isActive ? 'Active' : 'Blocked' }}</span></td>
                <td class="text-center acc-actions-cell">
                  <div class="row-actions justify-content-center">
                    <button type="button" class="btn btn-outline-primary" (click)="edit(a)">Edit</button>
                    @if (a.isActive) {
                      <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="act(a, 'reset-password')">Reset Password</button>
                      <button type="button" class="btn btn-outline-danger" [disabled]="busy()" (click)="act(a, 'block')">Block</button>
                    } @else {
                      <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="act(a, 'unblock')">UnBlock</button>
                    }
                  </div>
                </td>
              </tr>
            } @empty {
              @if (!busy()) {
                <tr class="empty-row">
                  <td colspan="5" style="padding: 0">
                    <div class="no-data acc-empty">
                      @if (search() || filter() || status() !== 'all') {
                        No login matches the filters.
                        <button type="button" class="btn btn-link p-0 ms-1" (click)="clearFilters()">Show all logins</button>
                      } @else {
                        No logins yet.
                        <button type="button" class="btn btn-link p-0 ms-1" (click)="add()">Add the first login</button>
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
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="account-title">
        <div class="modal-dialog modal-popup modal-lg acc-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h3 class="registration-title m-0" id="account-title">{{ editing() ? 'Edit Login ' + editing() : 'Add Login' }}</h3>
              <button type="button" class="btn-close" aria-label="Close" (click)="close()"></button>
            </div>
            <form (ngSubmit)="save()" novalidate>
              <div class="modal-body">
                <h4 class="acc-section" id="acc-type-head">Login type@if (!editing()) {<span class="req">*</span>}</h4>
                @if (editing()) {
                  <div class="acc-type-fixed">
                    <span class="zed-chip">{{ typeLabel(f.roleId ?? 0) }}</span>
                    <small class="muted">The login type of a saved login cannot be changed.</small>
                  </div>
                } @else {
                  <div class="acc-types" role="radiogroup" aria-labelledby="acc-type-head">
                    @for (t of types(); track t.roleId) {
                      <label class="choice-card" [class.active]="f.roleId === t.roleId" [for]="'acc-type-' + t.roleId">
                        <input type="radio" class="form-check-input" name="roleId" [id]="'acc-type-' + t.roleId" [value]="t.roleId"
                               [checked]="f.roleId === t.roleId" (change)="patch('roleId', t.roleId)" />
                        <span><strong>{{ t.label }}</strong>
                          @if (typeHint(t); as h) { <small class="muted d-block">{{ h }}</small> }
                        </span>
                      </label>
                    }
                  </div>
                }
                <h4 class="acc-section">Details</h4>
                <div class="form-grid">
                  @if (!editing()) {
                    <label for="acc-id">User ID<span class="req">*</span></label>
                    <div>
                      <input class="form-control" id="acc-id" name="userId" maxlength="50" autocomplete="off" [ngModel]="f.userId" (ngModelChange)="patch('userId', $event)" />
                      <small class="text-muted">4 to 50 letters and digits, e.g. MINISTRY01.</small>
                    </div>
                  }
                  <label for="acc-name">Name<span class="req">*</span></label>
                  <input class="form-control" id="acc-name" name="userName" maxlength="100" [ngModel]="f.userName" (ngModelChange)="patch('userName', $event)" />
                  <label for="acc-email">Email<span class="req">*</span></label>
                  <input class="form-control" id="acc-email" name="email" type="email" maxlength="100" [ngModel]="f.email" (ngModelChange)="patch('email', $event)" />
                  <label for="acc-mobile">Mobile Number<span class="req">*</span></label>
                  <input class="form-control" id="acc-mobile" name="mobileNo" maxlength="10" inputmode="numeric" [ngModel]="f.mobileNo" (ngModelChange)="patch('mobileNo', $event)" />
                  @if (needsState()) {
                    <label for="acc-state">State<span class="req">*</span></label>
                    <div>
                      <select class="form-select" id="acc-state" name="stateCode" [ngModel]="f.stateCode" (ngModelChange)="patch('stateCode', $event)">
                        <option value="">Select</option>
                        @for (s of states(); track s.code) { <option [value]="s.code">{{ s.name }}</option> }
                      </select>
                      <small class="text-muted">The MSME DFO sees the NEFT transactions of this state.</small>
                    </div>
                  }
                </div>
                @if (!editing()) {
                  <p class="acc-mail-note mt-3 mb-0">A password is generated and e-mailed to the user.</p>
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
    .acc-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .acc-stat { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 14px 18px; text-align: left; min-width: 0;
      background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; box-shadow: 0 1px 2px rgba(35,71,74,.05); cursor: pointer; }
    .acc-stat:hover { border-color: #45a5ad; }
    .acc-stat.is-on { border-color: #45a5ad; box-shadow: inset 0 0 0 1px #45a5ad; background: #eef6f6; }
    .acc-stat-count { font-size: 26px; font-weight: 700; color: #23474a; line-height: 1.1; }
    .acc-stat.tile-active .acc-stat-count { color: #1e7a3c; }
    .acc-stat.tile-blocked .acc-stat-count { color: #a8303a; }
    .acc-stat-label { font-size: 13px; color: #5f6f70; font-weight: 600; }
    .acc-list { padding: 16px; }
    .acc-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
    .acc-tab { display: inline-flex; align-items: center; gap: 8px; padding: 6px 16px; border-radius: 20px; border: 1px solid #cbd9da; background: #fff;
      color: #2f7c83; font-weight: 600; font-size: 14px; cursor: pointer; white-space: nowrap; }
    .acc-tab:hover { background: #eef6f6; border-color: #45a5ad; }
    .acc-tab.active { background: #45a5ad; border-color: #45a5ad; color: #fff; }
    .tab-count { font-size: 12px; background: rgba(255,255,255,.25); border-radius: 10px; padding: 0 8px; }
    .acc-tab:not(.active) .tab-count { background: #eef6f6; color: #23474a; }
    .acc-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; margin-bottom: 12px; }
    .acc-search { flex: 1 1 260px; max-width: 420px; }
    .acc-showing { font-size: 13px; }
    .acc-table { margin-bottom: 8px; }
    .acc-table td { vertical-align: middle; }
    .acc-table tbody tr:hover td { background: #f7fbfb; }
    .acc-table tr.is-blocked td { background: #fbf7f7; }
    .acc-user { display: flex; align-items: center; gap: 12px; min-width: 200px; }
    .acc-who { min-width: 0; }
    .acc-avatar { flex: 0 0 38px; width: 38px; height: 38px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
      color: #fff; background: linear-gradient(135deg, #45a5ad, #23474a); font-weight: 700; font-size: 13px; letter-spacing: .03em; }
    tr.is-blocked .acc-avatar { background: #f3e9e9; color: #9b4a4a; }
    .acc-name { display: block; font-weight: 600; color: #232527; overflow-wrap: anywhere; }
    .acc-id { display: block; font-size: 12px; color: #6b7f80; letter-spacing: .3px; }
    .acc-badge-phone { display: none; }
    .acc-type-cell .zed-chip { margin: 0; }
    .acc-state { display: block; margin-top: 4px; font-size: 12px; color: #5f6f70; }
    .acc-contact { min-width: 220px; }
    .acc-contact span { display: flex; align-items: center; gap: 6px; line-height: 1.6; overflow-wrap: anywhere; }
    .acc-contact .acc-mail { font-size: 13px; color: #5f6f70; }
    .acc-contact svg { flex: 0 0 13px; width: 13px; height: 13px; fill: none; stroke: #2f7c83; stroke-width: 1.4; stroke-linejoin: round; }
    .acc-actions-cell .row-actions { flex-wrap: nowrap; }
    .acc-empty .btn-link { font-weight: 600; }

    .acc-section { margin: 0 0 10px; font-size: 14px; font-weight: 700; color: #23474a; text-transform: none; }
    .acc-section + .form-grid { margin-top: 0; }
    .acc-types { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 18px; }
    .choice-card { display: flex; gap: 10px; align-items: flex-start; border: 1px solid #dfe9ea; border-radius: 10px; padding: 10px 12px; margin: 0; cursor: pointer; }
    .choice-card:hover { border-color: #45a5ad; }
    .choice-card.active { border-color: #45a5ad; background: #f4fafa; box-shadow: inset 0 0 0 1px #45a5ad; }
    /* The skin makes pop-up labels bold; on these cards only the type's name is. */
    .modal .modal-popup label.choice-card { font-weight: 400; color: #232527; }
    .choice-card .form-check-input { flex: none; margin: 3px 0 0; float: none; }
    .choice-card strong { color: #23474a; }
    .acc-type-fixed { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 18px; }
    .acc-type-fixed .zed-chip { margin: 0; }
    .acc-mail-note { padding: 8px 12px; border-radius: 8px; background: #eef6f6; color: #2f7c83; font-size: 13px; }

    @media (max-width: 767.98px) {
      .acc-stats { gap: 8px; }
      .acc-stat { padding: 10px 12px; }
      .acc-stat-count { font-size: 22px; }
      .acc-tabs { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 4px; scrollbar-width: thin; }
      .acc-search { max-width: none; }
      .acc-table { min-width: 0; }
      .acc-table thead { display: none; }
      .acc-table, .acc-table tbody, .acc-table tr, .acc-table td { display: block; width: 100%; box-sizing: border-box; }
      .acc-table tr { border: 1px solid #dfe9ea; border-radius: 12px; margin-bottom: 12px; padding: 4px 12px; overflow: hidden; }
      .acc-table tr.empty-row { border: 0; padding: 0; }
      .acc-table td { border: 0; padding: 6px 0; text-align: left !important; }
      .acc-table tr.is-blocked { background: #fbf7f7; }
      .acc-table tr.is-blocked td, .acc-table tbody tr:hover td { background: transparent; }
      .acc-table td[data-label]::before { content: attr(data-label); display: block; font-size: 12px; font-weight: 600; color: #5f6f70; margin-bottom: 2px; }
      .acc-user { min-width: 0; }
      .acc-who { flex: 1 1 auto; }
      .acc-badge-phone { display: inline-block; }
      .acc-status-cell { display: none !important; }
      .acc-contact { min-width: 0; }
      .acc-actions-cell .row-actions { flex-wrap: wrap; justify-content: flex-start !important; }
      .acc-types { grid-template-columns: minmax(0, 1fr); }
    }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class AccountsPage {
  private readonly http = inject(HttpClient);

  protected readonly types = signal<AccountType[]>([]);
  protected readonly states = signal<{ code: string; name: string }[]>([]);
  protected readonly accounts = signal<Account[]>([]);
  protected readonly filter = signal(0);
  protected readonly search = signal('');
  protected readonly status = signal<'all' | 'active' | 'blocked'>('all');
  protected readonly shown = computed(() => {
    const q = this.search().trim().toLowerCase();
    const status = this.status();
    return this.accounts().filter(
      (a) => (!this.filter() || a.roleId === this.filter())
        && (status === 'all' || (status === 'active') === !!a.isActive)
        && (!q || [a.userId, a.userName, a.email, a.mobileNo].some((v) => v?.toLowerCase().includes(q))),
    );
  });
  /** The tiles above the list: all, active and blocked logins of the chosen login type; a click filters by status. */
  protected readonly tiles = computed(() => {
    const ofType = this.accounts().filter((a) => !this.filter() || a.roleId === this.filter());
    const active = ofType.filter((a) => a.isActive).length;
    return [
      { key: 'all' as const, label: 'All logins', count: ofType.length },
      { key: 'active' as const, label: 'Active', count: active },
      { key: 'blocked' as const, label: 'Blocked', count: ofType.length - active },
    ];
  });
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly view = new PagedView(() => this.shown());
  protected readonly form = signal<AccountForm | null>(null);
  protected readonly editing = signal<string | null>(null);
  protected readonly needsState = computed(() => this.types().find((t) => t.roleId === this.form()?.roleId)?.needsState ?? false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly formError = signal('');

  constructor() {
    void this.load();
  }

  protected typeLabel(roleId: number): string {
    return this.types().find((t) => t.roleId === roleId)?.label ?? String(roleId);
  }

  /** The line under a login type in the pop-up: what the login opens. */
  protected typeHint(t: AccountType): string {
    return typeHints[t.roleId] ?? (t.needsState ? 'Linked to one state.' : '');
  }

  protected countOf(roleId: number): number {
    return this.accounts().filter((a) => a.roleId === roleId).length;
  }

  /** Two letters of the name (or of the user ID) for the round badge. */
  protected initials(a: Account): string {
    const words = (a.userName ?? '').trim().split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
    const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? a.userId).slice(0, 2);
    return letters.toUpperCase();
  }

  protected clearFilters(): void {
    this.filter.set(0);
    this.status.set('all');
    this.search.set('');
  }

  protected stateName(code: string | null): string {
    return code ? (this.states().find((s) => s.code === code)?.name ?? code) : '';
  }

  protected add(): void {
    this.editing.set(null);
    this.formError.set('');
    this.form.set({ userId: '', roleId: this.filter() || null, userName: '', email: '', mobileNo: '', stateCode: '' });
  }

  protected edit(a: Account): void {
    this.editing.set(a.userId);
    this.formError.set('');
    this.form.set({ userId: a.userId, roleId: a.roleId, userName: a.userName ?? '', email: a.email ?? '', mobileNo: a.mobileNo ?? '', stateCode: a.stateCode ?? '' });
  }

  protected close(): void {
    this.form.set(null);
    this.editing.set(null);
  }

  protected patch<K extends keyof AccountForm>(key: K, value: AccountForm[K]): void {
    this.form.update((f) => (f ? { ...f, [key]: value } : f));
  }

  protected async save(): Promise<void> {
    const f = this.form();
    if (!f) return;
    const id = this.editing();
    const body = { ...f, stateCode: this.needsState() ? f.stateCode : null };
    await this.run(
      () => (id ? this.http.put<MessageResponse>(`${API}/${encodeURIComponent(id)}`, body) : this.http.post<MessageResponse>(API, body)),
      true,
    );
  }

  protected async act(a: Account, action: 'block' | 'unblock' | 'reset-password'): Promise<void> {
    const who = `${a.userId}${a.userName ? ' (' + a.userName + ')' : ''}`;
    const question = action === 'block' ? `Block the login ${who}? The user can no longer sign in.`
      : action === 'reset-password' ? `Reset the password of ${who}? A new password is e-mailed to the user.` : null;
    if (question && !window.confirm(question)) return;
    await this.run(() => this.http.post<MessageResponse>(`${API}/${encodeURIComponent(a.userId)}/${action}`, null), false);
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
      const r = await firstValueFrom(this.http.get<AccountsResponse>(API));
      this.types.set(r.types);
      this.states.set(r.states);
      this.accounts.set(r.accounts);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
