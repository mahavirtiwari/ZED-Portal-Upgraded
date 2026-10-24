import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService, MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';

/** ChangePwdViewModel's RegularExpression on the new and the confirm password. */
const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@#$%^&+=!]).{8,}$/;
const WEAK_PASSWORD = 'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one digit, and one special character.';

/** Change password while signed in (MSME and staff). Port of Frontend/User/ChangePassword.cshtml (the live design: eye toggles, full-width SUBMIT). */
@Component({
  selector: 'zed-msme-change-password',
  imports: [FormsModule],
  template: `
    <div class="container form-page">
      <div class="row mt-3 justify-content-center">
        <div class="col-sm-9">
          @if (error()) {
            <div class="alert alert-danger" role="alert">{{ error() }}</div>
          }
          <div class="panel panel-default panel-design reset-pwd">
            <div class="panel-body">
              <form class="row mt-3 justify-content-center" (ngSubmit)="submit()" novalidate>
                <div class="col-sm-6">
                  <label for="oldPassword">Old Password</label>
                  <div class="mb-3">
                    <input id="oldPassword" name="oldPassword" class="form-control" autocomplete="current-password"
                           [type]="show().old ? 'text' : 'password'" [(ngModel)]="oldPassword" required maxlength="50" />
                    <button type="button" class="field-icon toggle-password" [attr.aria-label]="show().old ? 'Hide password' : 'Show password'" (click)="toggle('old')">
                      <img [src]="show().old ? 'Images/svgicons/eye-off.svg' : 'Images/svgicons/eye.svg'" alt="" />
                    </button>
                    @if (problem(oldPassword, false); as p) { <span class="field-validation-error d-block">{{ p }}</span> }
                  </div>
                  <label for="newPassword">New Password</label>
                  <div class="mb-3">
                    <input id="newPassword" name="newPassword" class="form-control" autocomplete="new-password"
                           [type]="show().new ? 'text' : 'password'" [(ngModel)]="newPassword" required maxlength="50" />
                    <button type="button" class="field-icon toggle-password" [attr.aria-label]="show().new ? 'Hide password' : 'Show password'" (click)="toggle('new')">
                      <img [src]="show().new ? 'Images/svgicons/eye-off.svg' : 'Images/svgicons/eye.svg'" alt="" />
                    </button>
                    @if (problem(newPassword); as p) { <span class="field-validation-error d-block">{{ p }}</span> }
                  </div>
                  <label for="confirmPassword">Confirm Password</label>
                  <div class="mb-3">
                    <input id="confirmPassword" name="confirmPassword" class="form-control" autocomplete="new-password"
                           [type]="show().confirm ? 'text' : 'password'" [(ngModel)]="confirmPassword" required maxlength="50" />
                    <button type="button" class="field-icon toggle-password" [attr.aria-label]="show().confirm ? 'Hide password' : 'Show password'" (click)="toggle('confirm')">
                      <img [src]="show().confirm ? 'Images/svgicons/eye-off.svg' : 'Images/svgicons/eye.svg'" alt="" />
                    </button>
                    @if (problem(confirmPassword); as p) { <span class="field-validation-error d-block">{{ p }}</span> }
                  </div>
                  <div class="d-grid gap-2 col-12 mx-auto mb-3">
                    <button type="submit" class="btn btn-primary" style="height: 48px" [disabled]="busy()">SUBMIT</button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: `
    /* A 32px tap area around the eye icon; the margins keep the icon where the old page had it. */
    .field-icon { border: 0; background: transparent; padding: 6px; margin-top: -36px; margin-right: 4px; line-height: 0; }
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
      this.error.set('NewPassword and ConfirmPassword should be same.');
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
