import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService, MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';

/** ChangePwdViewModel's RegularExpression on the new and the confirm password. */
/** As PasswordPolicy on the server: 8 to 50 characters, upper and lower case, a digit and any other character. */
const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,50}$/;
const WEAK_PASSWORD = 'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one digit, and one special character.';

/** Change password while signed in (MSME and staff). Port of Frontend/User/ChangePassword.cshtml, in the live page's layout (eye toggles in the fields). */
@Component({
  selector: 'zed-msme-change-password',
  imports: [FormsModule],
  template: `
    <!-- Redesigned 2026-11-07: one card with the title and the signed-in ID, the rules of the new password ticked as typed
         with a strength bar, and CHANGE PASSWORD. -->
    <div class="container form-page" id="zed_user_form">
      <div class="row mt-4 justify-content-center">
        <div class="col-md-8 col-lg-6">
          <div class="cp-card">
            <div class="cp-head">
              <span class="cp-icon" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM9 8V6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9z"/></svg>
              </span>
              <div>
                <h2 class="cp-title">Change password</h2>
                <div class="cp-sub">@if (userId()) { {{ userId() }} · }you'll be signed out and log in again with the new password</div>
              </div>
            </div>
            @if (error()) {
              <div class="alert alert-danger" role="alert">{{ error() }}</div>
            }
            <form (ngSubmit)="submit()" novalidate>
              <label for="oldPassword">Current password</label>
              <div class="mb-3 pwd-field">
                <input id="oldPassword" name="oldPassword" class="form-control" autocomplete="current-password"
                       [type]="show().old ? 'text' : 'password'" [(ngModel)]="oldPassword" required maxlength="50" />
                <button type="button" class="field-icon toggle-password" [attr.aria-label]="show().old ? 'Hide password' : 'Show password'" (click)="toggle('old')">
                  <img [src]="show().old ? 'Images/svgicons/eye-off.svg' : 'Images/svgicons/eye.svg'" alt="" />
                </button>
                @if (problem(oldPassword, false); as p) { <span class="field-validation-error d-block">{{ p }}</span> }
              </div>
              <label for="newPassword">New password</label>
              <div class="mb-1 pwd-field">
                <input id="newPassword" name="newPassword" class="form-control" autocomplete="new-password"
                       [type]="show().new ? 'text' : 'password'" [(ngModel)]="newPassword" required maxlength="50" />
                <button type="button" class="field-icon toggle-password" [attr.aria-label]="show().new ? 'Hide password' : 'Show password'" (click)="toggle('new')">
                  <img [src]="show().new ? 'Images/svgicons/eye-off.svg' : 'Images/svgicons/eye.svg'" alt="" />
                </button>
              </div>
              <div class="cp-strength" aria-hidden="true"><span [style.width.%]="strength() * 20" [class.ok]="strength() === 5"></span></div>
              <ul class="cp-rules" aria-label="Rules for the new password">
                @for (r of rules(); track r.label) {
                  <li [class.met]="r.met"><span aria-hidden="true">{{ r.met ? '✓' : '○' }}</span> {{ r.label }}</li>
                }
              </ul>
              @if (problem(newPassword); as p) { <span class="field-validation-error d-block mb-2">{{ p }}</span> }
              <label for="confirmPassword">Confirm new password</label>
              <div class="mb-3 pwd-field">
                <input id="confirmPassword" name="confirmPassword" class="form-control" autocomplete="new-password"
                       [type]="show().confirm ? 'text' : 'password'" [(ngModel)]="confirmPassword" required maxlength="50" />
                <button type="button" class="field-icon toggle-password" [attr.aria-label]="show().confirm ? 'Hide password' : 'Show password'" (click)="toggle('confirm')">
                  <img [src]="show().confirm ? 'Images/svgicons/eye-off.svg' : 'Images/svgicons/eye.svg'" alt="" />
                </button>
                @if (problem(confirmPassword); as p) { <span class="field-validation-error d-block">{{ p }}</span> }
                @if (confirmPassword && newPassword && confirmPassword !== newPassword) { <span class="field-validation-error d-block">The passwords do not match yet.</span> }
              </div>
              <div class="d-grid">
                <button type="submit" class="btn btn-primary submit-btn" [disabled]="busy()">CHANGE PASSWORD</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: `
    .cp-card { background: #fff; border: 1px solid #e3e6e8; border-radius: 14px; padding: 24px 28px; box-shadow: 0 4px 18px rgba(0, 0, 0, 0.05); }
    .cp-head { display: flex; gap: 14px; align-items: center; margin-bottom: 18px; }
    .cp-icon { width: 44px; height: 44px; border-radius: 50%; background: rgba(69, 165, 173, 0.14); color: #2d6f75; display: flex; align-items: center; justify-content: center; }
    .cp-title { font-size: 1.3rem; font-weight: 700; margin: 0; }
    .cp-sub { color: #7a7d80; font-size: 0.9rem; }
    label { font-weight: 600; }
    .submit-btn { height: 48px; font-weight: 700; letter-spacing: 0.5px; }
    .cp-strength { height: 5px; border-radius: 3px; background: #e3e6e8; overflow: hidden; margin: 4px 0 8px; }
    .cp-strength span { display: block; height: 100%; background: #f0ad4e; transition: width 0.2s; }
    .cp-strength span.ok { background: #45a5ad; }
    .cp-rules { list-style: none; padding: 0; margin: 0 0 12px; display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 0.85rem; color: #8d8f90; }
    .cp-rules li.met { color: #2d6f75; font-weight: 600; }
    /* The eye icon inside the field on its right, with a 32px tap area. */
    .pwd-field { position: relative; }
    .pwd-field .form-control { padding-right: 44px; height: 44px; }
    .field-icon { position: absolute; top: 6px; right: 4px; float: none; margin: 0; border: 0; background: transparent; padding: 6px; line-height: 0; }
  `,
})
export class ChangePasswordPage {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  /** Where to sign in again afterwards (route data `loginUrl`; MSME login by default). */
  private readonly loginUrl: string = inject(ActivatedRoute).snapshot.data['loginUrl'] ?? '/msme/login';

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  /** Field messages show once SUBMIT was pressed (the old page validated the model on post). */
  protected readonly submitted = signal(false);
  protected readonly show = signal({ old: false, new: false, confirm: false });
  protected oldPassword = '';
  protected newPassword = '';
  protected confirmPassword = '';
  /** The signed-in ID in the heading. */
  protected readonly userId = computed(() => this.auth.currentUser()?.userId ?? '');

  /** The rules of the new password (PasswordPolicy), ticked as it is typed; 0-5 met for the bar. */
  protected rules(): { label: string; met: boolean }[] {
    const v = this.newPassword;
    return [
      { label: '8+ characters', met: v.length >= 8 && v.length <= 50 },
      { label: 'an upper-case letter', met: /[A-Z]/.test(v) },
      { label: 'a lower-case letter', met: /[a-z]/.test(v) },
      { label: 'a number', met: /\d/.test(v) },
      { label: 'a symbol', met: /[^A-Za-z0-9]/.test(v) },
    ];
  }

  protected strength(): number {
    return this.rules().filter((r) => r.met).length;
  }

  protected toggle(field: 'old' | 'new' | 'confirm'): void {
    this.show.update((v) => ({ ...v, [field]: !v[field] }));
  }

  /** The ChangePwdViewModel message under a field, or '' (`strong`: the new / confirm password rule). */
  protected problem(value: string, strong = true): string {
    if (!this.submitted()) return '';
    if (!value) return 'This is required';
    return strong && !STRONG_PASSWORD.test(value) ? WEAK_PASSWORD : '';
  }

  protected async submit(): Promise<void> {
    this.error.set('');
    this.submitted.set(true);
    if (this.problem(this.oldPassword, false) || this.problem(this.newPassword) || this.problem(this.confirmPassword)) return;
    if (this.newPassword !== this.confirmPassword) {
      this.error.set('The new password and its confirmation do not match.');
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.http.post<MessageResponse>('/api/account/change-password', {
          oldPassword: this.oldPassword,
          newPassword: this.newPassword,
          confirmPassword: this.confirmPassword,
        }),
      );
      // The API signs the user out, as the old page did; log in again with the new password.
      this.auth.setUser(null);
      await this.router.navigate([this.loginUrl], { state: { message: 'Password changed. Please login with your new password.' } });
    } catch (err) {
      this.error.set(apiErrorMessage(err));
      this.oldPassword = this.newPassword = this.confirmPassword = '';
      this.submitted.set(false);   // the old page came back with empty fields and only the error on top
    } finally {
      this.busy.set(false);
    }
  }
}
