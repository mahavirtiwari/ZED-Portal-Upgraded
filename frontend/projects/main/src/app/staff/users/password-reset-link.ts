import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { RESET_CONFIRM } from './users.api';

/**
 * MasterAdmin: e-mails any staff account of this portal a link to set a new password, including MasterAdmin and
 * SuperAdmin accounts, which cannot use "Forgot password?". The administrator never sees or sets the password.
 */
@Component({
  selector: 'zed-staff-password-reset-link',
  imports: [FormsModule],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="mt-4" style="max-width: 560px">
        <h1 class="registration-title">Password Reset Link</h1>
        <p class="text-muted">The link is sent to the e-mail address registered for the account and works once, for a short time.
          Agencies and assessors can also be sent a link from their lists.</p>
        <form (ngSubmit)="send()" novalidate>
          <div class="mb-3">
            <label for="resetUserId">User ID</label>
            <input id="resetUserId" name="userId" class="form-control" [(ngModel)]="userId" required maxlength="50" />
          </div>
          <button type="submit" class="btn btn-primary" [disabled]="busy()">Send Reset Link</button>
        </form>
        @if (error()) {
          <div class="alert alert-danger mt-3" role="alert">{{ error() }}</div>
        }
        @if (success()) {
          <div class="alert alert-success mt-3" role="status">{{ success() }}</div>
        }
      </div>
    </div>
  `,
})
export class PasswordResetLinkPage {
  private readonly http = inject(HttpClient);

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected userId = '';

  protected async send(): Promise<void> {
    this.error.set('');
    this.success.set('');
    const id = this.userId.trim();
    if (!id) {
      this.error.set('Please enter the User ID.');
      return;
    }
    if (!window.confirm(RESET_CONFIRM)) return;
    this.busy.set(true);
    try {
      this.success.set((await firstValueFrom(this.http.post<MessageResponse>(`/api/staff/password-reset/${encodeURIComponent(id)}`, null))).message);
      this.userId = '';
    } catch (err) {
      this.error.set(err instanceof HttpErrorResponse && err.status === 404 ? 'User not found.' : apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
