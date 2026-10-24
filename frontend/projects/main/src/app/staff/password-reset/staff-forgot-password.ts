import { HttpClient } from '@angular/common/http';
import { Component, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MessageResponse, Recaptcha, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PORTAL_SYSTEM } from '../../portal-system';
import { PORTAL_LABELS } from '../../portal-labels';
import { StaffLoginShell } from '../staff-login-shell';

/**
 * Staff "Forgot password?" (new in V4; the old sites had no staff reset). The answer is the same for every User ID:
 * the link goes only to the account's registered e-mail address.
 */
@Component({
  selector: 'zed-staff-forgot-password',
  imports: [FormsModule, RouterLink, Recaptcha, StaffLoginShell],
  template: `
    <zed-staff-login-shell>
      <h1 class="text-center fw-bold" style="font-size: 28px">Forgot Password</h1>
      @if (systemName) {
        <p class="text-center text-muted mb-3">{{ systemName }}</p>
      }
      @if (sent()) {
        <div class="alert alert-success" role="status">{{ sent() }}</div>
        <a routerLink="/login" class="btn btn-primary w-100">Back to Login</a>
      } @else {
        <form class="login-form zed-user-form" (ngSubmit)="submit()" novalidate>
          <p class="text-muted small">Enter your User ID. A link to set a new password will be sent to the e-mail address registered for it.</p>
          <div class="mb-3">
            <label for="userId">User ID</label>
            <input id="userId" name="userId" class="form-control" autocomplete="username" [(ngModel)]="userId" required maxlength="50" />
          </div>
          <div class="mb-3"><zed-recaptcha (token)="captchaToken = $event" /></div>
          <div class="d-grid col-12">
            <button type="submit" class="btn btn-primary" [disabled]="busy()">Send Reset Link</button>
          </div>
          <p class="text-center mt-3 mb-0"><a routerLink="/login">Back to Login</a></p>
          @if (error()) {
            <div class="alert alert-danger mt-3 mb-0" role="alert">{{ error() }}</div>
          }
        </form>
      }
    </zed-staff-login-shell>
  `,
  styles: `
    .zed-user-form label { color: #1d1618; font-size: 14px; font-weight: 500; }
    .btn-primary, .btn-primary:hover { color: #fff; background-color: #45a5ad; border-color: #45a5ad; font-size: 14px; text-transform: uppercase; }
  `,
})
export class StaffForgotPasswordPage {
  private readonly http = inject(HttpClient);
  private readonly captcha = viewChild(Recaptcha);

  protected readonly systemName = PORTAL_SYSTEM === 'main' ? '' : PORTAL_LABELS.portalName;
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly sent = signal('');
  protected userId = '';
  protected captchaToken = '';

  protected async submit(): Promise<void> {
    this.error.set('');
    if (!this.userId.trim()) {
      this.error.set('Please enter your User ID.');
      return;
    }
    if (!this.captchaToken) {
      this.error.set('Please complete the verification.');
      return;
    }
    this.busy.set(true);
    try {
      const r = await firstValueFrom(
        this.http.post<MessageResponse>('/api/staff/auth/password-reset/request', { userId: this.userId.trim(), captchaToken: this.captchaToken }),
      );
      this.sent.set(r.message);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
      this.captcha()?.reset();
    } finally {
      this.busy.set(false);
    }
  }
}
