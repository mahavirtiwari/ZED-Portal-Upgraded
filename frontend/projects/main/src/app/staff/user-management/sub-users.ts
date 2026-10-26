import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { PagedView, PagerComponent } from '../pager';

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

const API = '/api/staff/sub-users';

/**
 * MasterAdmin → Operation Admins, agency → Sub-Users (new in V4): logins for the owner's own staff. A sub-user signs in
 * with its own ID and works as the owner (same role and data) on the screens ticked here; the login ID is generated and
 * the password mailed to the sub-user. V4 layout: page head with Add, status badges, screens as chips.
 */
@Component({
  selector: 'zed-staff-sub-users',
  imports: [FormsModule, DatePipe, PagerComponent],
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
    <div class="table-responsive">
      <table class="table table-zed table-bordered">
        <thead>
          <tr>
            <th class="text-center" style="width: 100px">Status</th><th class="text-center">User ID</th><th>Name</th><th>Contact</th><th>Screens</th><th class="text-center">Last Login</th><th class="text-center" style="width: 200px">Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (u of view.page(); track u.userId) {
            <tr>
              <td class="text-center">
                <span class="status-badge" [class.is-active]="u.isActive && !u.locked" [class.is-pending]="u.isActive && u.locked" [class.is-rejected]="!u.isActive">
                  {{ u.isActive ? (u.locked ? 'Locked' : 'Active') : 'Blocked' }}
                </span>
              </td>
              <td class="text-center"><strong>{{ u.userId }}</strong></td>
              <td>{{ u.userName }}</td>
              <td>{{ u.mobileNo }}<small class="d-block text-muted">{{ u.email }}</small></td>
              <td>
                @for (p of u.permissions; track p) { <span class="zed-chip">{{ label(p) }}</span> }
              </td>
              <td class="text-center">{{ u.lastLoginAt ? (u.lastLoginAt + 'Z' | date: 'dd-MM-yyyy HH:mm') : '-' }}</td>
              <td class="text-center">
                <div class="row-actions justify-content-center">
                  <button type="button" class="btn btn-outline-primary" (click)="edit(u)">Edit</button>
                  <button type="button" class="btn btn-default" [disabled]="busy()" (click)="resetPassword(u)">Reset Password</button>
                </div>
              </td>
            </tr>
          } @empty {
            @if (!busy()) { <tr><td colspan="7" style="padding: 0"><div class="no-data">No Data</div></td></tr> }
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="view" />

    @if (form(); as f) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="sub-user-title">
        <div class="modal-dialog modal-popup modal-lg">
          <div class="modal-content">
            <div class="modal-header">
              <h3 class="registration-title m-0" id="sub-user-title">{{ editing() ? 'Edit ' + editing() : 'Add ' + accountType() }}</h3>
              <button type="button" class="btn-close" aria-label="Close" (click)="close()"></button>
            </div>
            <form (ngSubmit)="save()" novalidate>
              <div class="modal-body">
                <div class="form-grid">
                  <label for="sub-name">Name<span class="req">*</span></label>
                  <input class="form-control" id="sub-name" name="userName" maxlength="100" [ngModel]="f.userName" (ngModelChange)="patch('userName', $event)" />
                  <label for="sub-email">Email<span class="req">*</span></label>
                  <input class="form-control" id="sub-email" name="email" type="email" maxlength="100" [ngModel]="f.email" (ngModelChange)="patch('email', $event)" />
                  <label for="sub-mobile">Mobile Number</label>
                  <input class="form-control" id="sub-mobile" name="mobileNo" maxlength="10" inputmode="numeric" [ngModel]="f.mobileNo" (ngModelChange)="patch('mobileNo', $event)" />
                  <span class="label top" id="sub-screens">Screens<span class="req">*</span></span>
                  <div role="group" aria-labelledby="sub-screens">
                    @for (p of options(); track p.key) {
                      <div class="form-check">
                        <input class="form-check-input" type="checkbox" [id]="'perm-' + p.key" [name]="'perm-' + p.key"
                               [checked]="f.permissions.includes(p.key)" (change)="toggle(p.key)" />
                        <label class="form-check-label" [for]="'perm-' + p.key">{{ p.label }}</label>
                      </div>
                    }
                  </div>
                </div>
                @if (editing()) {
                  <div class="form-check mt-3 mb-2">
                    <input class="form-check-input" type="checkbox" id="sub-active" name="isActive" [checked]="f.isActive" (change)="patch('isActive', !f.isActive)" />
                    <label class="form-check-label" for="sub-active"><strong>Active</strong> (untick to block this login)</label>
                  </div>
                } @else {
                  <p class="text-muted mt-3 mb-0">The User ID is generated, and a password is e-mailed to the {{ accountType().toLowerCase() }}.</p>
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
    .form-grid > .top { align-self: start; }
    .form-check-input { border: 1px solid #888; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class SubUsersPage {
  private readonly http = inject(HttpClient);

  protected readonly accountType = signal('Sub-User');
  protected readonly options = signal<PermissionOption[]>([]);
  protected readonly users = signal<SubUser[]>([]);
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly view = new PagedView(() => this.users());
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
