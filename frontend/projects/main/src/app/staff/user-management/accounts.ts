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
 * password is generated and mailed to the user; Reset Password mails a new one.
 */
@Component({
  selector: 'zed-staff-accounts',
  imports: [FormsModule, PagerComponent],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="row mt-4">
        <div class="col-sm-12">
          <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-1">
            <h3 class="registration-title">User Management</h3>
            <div class="d-flex align-items-center gap-2 ms-auto">
              <select class="form-select w-auto" aria-label="Login type" [ngModel]="filter()" (ngModelChange)="filter.set(+$event)">
                <option [ngValue]="0">All login types</option>
                @for (t of types(); track t.roleId) { <option [ngValue]="t.roleId">{{ t.label }}</option> }
              </select>
              <button type="button" class="btn btn-primary" (click)="add()">+ Add Login</button>
            </div>
          </div>
          @if (error()) {
            <div class="alert alert-danger" role="alert">{{ error() }}</div>
          }
          @if (success()) {
            <div class="alert alert-success" role="status">{{ success() }}</div>
          }
          <div class="table-responsive">
            <table class="table table-zed table-bordered bg-white">
              <thead>
                <tr class="btn-default text-center">
                  <th>Status</th><th>User ID</th><th>Login Type</th><th>Name</th><th>Contact</th><th>State</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (a of view.page(); track a.userId + a.roleId) {
                  <tr>
                    <td><strong>{{ a.isActive ? 'Active' : 'Blocked' }}</strong></td>
                    <td><strong>{{ a.userId }}</strong></td>
                    <td>{{ typeLabel(a.roleId) }}</td>
                    <td>{{ a.userName }}</td>
                    <td>{{ a.mobileNo }}<br />{{ a.email }}</td>
                    <td>{{ stateName(a.stateCode) }}</td>
                    <td class="text-center">
                      <button type="button" class="btn btn-primary btn-sm" style="width: 120px" (click)="edit(a)">Edit</button><br />
                      @if (a.isActive) {
                        <button type="button" class="btn btn-default btn-sm mt-1" style="width: 120px" [disabled]="busy()" (click)="act(a, 'block')">Block</button><br />
                        <button type="button" class="btn btn-default btn-sm mt-1" style="width: 120px" [disabled]="busy()" (click)="act(a, 'reset-password')">Reset Password</button>
                      } @else {
                        <button type="button" class="btn btn-primary btn-sm mt-1" style="width: 120px" [disabled]="busy()" (click)="act(a, 'unblock')">UnBlock</button>
                      }
                    </td>
                  </tr>
                } @empty {
                  @if (!busy()) { <tr><td colspan="7" style="padding: 0"><div class="no-data">No Data</div></td></tr> }
                }
              </tbody>
            </table>
          </div>
          <zed-pager [pager]="view" />
        </div>
      </div>
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
                <div class="mb-2">
                  <label for="acc-type"><strong>Login Type<span style="color: red">*</span></strong></label>
                  <select class="form-select" id="acc-type" name="roleId" [disabled]="!!editing()" [ngModel]="f.roleId" (ngModelChange)="patch('roleId', +$event)">
                    <option [ngValue]="null">Select</option>
                    @for (t of types(); track t.roleId) { <option [ngValue]="t.roleId">{{ t.label }}</option> }
                  </select>
                </div>
                @if (!editing()) {
                  <div class="mb-2">
                    <label for="acc-id"><strong>User ID<span style="color: red">*</span></strong></label>
                    <input class="form-control" id="acc-id" name="userId" maxlength="50" autocomplete="off" [ngModel]="f.userId" (ngModelChange)="patch('userId', $event)" />
                    <small class="text-muted">4 to 50 letters and digits, e.g. MINISTRY01.</small>
                  </div>
                }
                <div class="mb-2">
                  <label for="acc-name"><strong>Name<span style="color: red">*</span></strong></label>
                  <input class="form-control" id="acc-name" name="userName" maxlength="100" [ngModel]="f.userName" (ngModelChange)="patch('userName', $event)" />
                </div>
                <div class="mb-2">
                  <label for="acc-email"><strong>Email<span style="color: red">*</span></strong></label>
                  <input class="form-control" id="acc-email" name="email" type="email" maxlength="100" [ngModel]="f.email" (ngModelChange)="patch('email', $event)" />
                </div>
                <div class="mb-2">
                  <label for="acc-mobile"><strong>Mobile Number<span style="color: red">*</span></strong></label>
                  <input class="form-control" id="acc-mobile" name="mobileNo" maxlength="10" inputmode="numeric" [ngModel]="f.mobileNo" (ngModelChange)="patch('mobileNo', $event)" />
                </div>
                @if (needsState()) {
                  <div class="mb-2">
                    <label for="acc-state"><strong>State<span style="color: red">*</span></strong></label>
                    <select class="form-select" id="acc-state" name="stateCode" [ngModel]="f.stateCode" (ngModelChange)="patch('stateCode', $event)">
                      <option value="">Select</option>
                      @for (s of states(); track s.code) { <option [value]="s.code">{{ s.name }}</option> }
                    </select>
                    <small class="text-muted">The MSME DFO sees the NEFT transactions of this state.</small>
                  </div>
                }
                @if (!editing()) {
                  <p class="text-muted mb-0">A password is generated and e-mailed to the user.</p>
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
    .modal .form-control, .modal .form-select { width: 100%; max-width: 100%; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class AccountsPage {
  private readonly http = inject(HttpClient);

  protected readonly types = signal<AccountType[]>([]);
  protected readonly states = signal<{ code: string; name: string }[]>([]);
  protected readonly accounts = signal<Account[]>([]);
  protected readonly filter = signal(0);
  protected readonly shown = computed(() => this.accounts().filter((a) => !this.filter() || a.roleId === this.filter()));
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
