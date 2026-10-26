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

/**
 * Admin → User Management (new in V4): the Master Admin, Ministry, MSME DFO and dashboard logins of this portal. The
 * password is generated and mailed to the user; Reset Password mails a new one. V4: tiles with the active and blocked
 * logins (a click filters), filters for type and status and a search box, a user column with initials, contact with
 * icons, the State column only where a login type has one, and a confirmation before Block and Reset Password.
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
        <button type="button" class="acc-stat" [class.is-on]="status() === t.key" [attr.aria-pressed]="status() === t.key" (click)="status.set(t.key)">
          <span class="acc-stat-count">{{ t.count }}</span>
          <span class="acc-stat-label">{{ t.label }}</span>
        </button>
      }
    </div>
    <div class="zed-card acc-list">
      <div class="filter-bar mb-3">
        <div class="filter">
          <label class="form-label" for="acc-filter-type">Login type</label>
          <select id="acc-filter-type" class="form-select" [ngModel]="filter()" (ngModelChange)="filter.set(+$event)">
            <option [ngValue]="0">All login types</option>
            @for (t of types(); track t.roleId) { <option [ngValue]="t.roleId">{{ t.label }} ({{ countOf(t.roleId) }})</option> }
          </select>
        </div>
        <div class="filter">
          <label class="form-label" for="acc-filter-status">Status</label>
          <select id="acc-filter-status" class="form-select" [ngModel]="status()" (ngModelChange)="status.set($event)">
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="blocked">Blocked</option>
          </select>
        </div>
        <div class="filter wide">
          <label class="form-label" for="acc-search">Search</label>
          <input id="acc-search" type="search" class="form-control" placeholder="User ID, name, e-mail or mobile"
                 [ngModel]="search()" (ngModelChange)="search.set($event)" />
        </div>
      </div>
      <div class="table-responsive">
        <table class="table table-zed acc-table">
          <thead>
            <tr>
              <th>User</th><th class="text-center">Login Type</th><th>Contact</th>
              @if (showState()) { <th>State</th> }
              <th class="text-center" style="width: 110px">Status</th><th class="text-center" style="width: 300px">Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (a of view.page(); track a.userId + a.roleId) {
              <tr [class.is-blocked]="!a.isActive">
                <td>
                  <div class="acc-user">
                    <span class="acc-avatar" aria-hidden="true">{{ initials(a) }}</span>
                    <span>
                      <span class="acc-name">{{ a.userName || '—' }}</span>
                      <span class="acc-id">{{ a.userId }}</span>
                    </span>
                  </div>
                </td>
                <td class="text-center"><span class="zed-chip">{{ typeLabel(a.roleId) }}</span></td>
                <td class="acc-contact">
                  @if (a.mobileNo) {
                    <span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 1.5h2l1 3-1.5 1a8 8 0 0 0 4.5 4.5l1-1.5 3 1v2a1.5 1.5 0 0 1-1.5 1.5A11.5 11.5 0 0 1 3 3a1.5 1.5 0 0 1 1.5-1.5z"/></svg>{{ a.mobileNo }}</span>
                  }
                  @if (a.email) {
                    <span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.5h12v9H2z M2 4l6 4.5L14 4"/></svg>{{ a.email }}</span>
                  }
                </td>
                @if (showState()) { <td>{{ stateName(a.stateCode) || '—' }}</td> }
                <td class="text-center"><span class="status-badge" [class.is-active]="a.isActive" [class.is-rejected]="!a.isActive">{{ a.isActive ? 'Active' : 'Blocked' }}</span></td>
                <td class="text-center">
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
                <tr>
                  <td [attr.colspan]="showState() ? 6 : 5" style="padding: 0">
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
        <div class="modal-dialog modal-popup modal-lg">
          <div class="modal-content">
            <div class="modal-header">
              <h3 class="registration-title m-0" id="account-title">{{ editing() ? 'Edit Login ' + editing() : 'Add Login' }}</h3>
              <button type="button" class="btn-close" aria-label="Close" (click)="close()"></button>
            </div>
            <form (ngSubmit)="save()" novalidate>
              <div class="modal-body">
                <div class="form-grid">
                  <label for="acc-type">Login Type<span class="req">*</span></label>
                  <select class="form-select" id="acc-type" name="roleId" [disabled]="!!editing()" [ngModel]="f.roleId" (ngModelChange)="patch('roleId', +$event)">
                    <option [ngValue]="null">Select</option>
                    @for (t of types(); track t.roleId) { <option [ngValue]="t.roleId">{{ t.label }}</option> }
                  </select>
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
                  <p class="text-muted mt-3 mb-0">A password is generated and e-mailed to the user.</p>
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
    .acc-stat { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 14px 18px; text-align: left;
      background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; box-shadow: 0 1px 2px rgba(35,71,74,.05); cursor: pointer; }
    .acc-stat:hover { border-color: #45a5ad; }
    .acc-stat.is-on { border-color: #45a5ad; box-shadow: inset 0 0 0 1px #45a5ad; background: #eef6f6; }
    .acc-stat-count { font-size: 26px; font-weight: 700; color: #23474a; line-height: 1.1; }
    .acc-stat-label { font-size: 13px; color: #5f6f70; font-weight: 600; }
    .acc-table td { vertical-align: middle; }
    .acc-table tr.is-blocked td { background: #fbf7f7; }
    .acc-user { display: flex; align-items: center; gap: 12px; }
    .acc-avatar { flex: 0 0 38px; width: 38px; height: 38px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
      background: #eef6f6; color: #2f7c83; font-weight: 700; font-size: 14px; }
    tr.is-blocked .acc-avatar { background: #f3e9e9; color: #9b4a4a; }
    .acc-name { display: block; font-weight: 600; color: #232527; }
    .acc-id { display: block; font-size: 12px; color: #6b7f80; letter-spacing: .3px; }
    .acc-contact span { display: flex; align-items: center; gap: 6px; line-height: 1.6; word-break: break-all; }
    .acc-contact svg { flex: 0 0 13px; width: 13px; height: 13px; fill: none; stroke: #2f7c83; stroke-width: 1.4; stroke-linejoin: round; }
    .acc-empty .btn-link { font-weight: 600; }
    @media (max-width: 575.98px) { .acc-stats { grid-template-columns: 1fr; } }
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
  /** The State column only where a login type has a state (MSME DFO) or a login has one. */
  protected readonly showState = computed(() => this.types().some((t) => t.needsState) || this.accounts().some((a) => !!a.stateCode));
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
