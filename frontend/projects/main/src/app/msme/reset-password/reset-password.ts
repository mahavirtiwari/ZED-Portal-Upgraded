import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { tokenFromFragment } from '../../staff/password-reset/staff-reset-password';
import { LoginShell } from '../login-shell/login-shell';

/**
 * Target of the "Reset Password" e-mail link `/msme/reset-password#token=…`. Port of Views/Msme/ChangePassword.cshtml.
 * The token is in the fragment (never sent to the server or logged) and goes to the API in the request body; old
 * `?code=` links of the legacy reset no longer work (SECURITY-FINDINGS #128).
 */
@Component({
  selector: 'zed-msme-reset-password',
  imports: [FormsModule, RouterLink, LoginShell],
  template: `
    <zed-login-shell>
      <div class="login-login">
        <form class="login-form mt-3" (ngSubmit)="submit()" novalidate>
          <h2>Change Password</h2>
          @if (state() === 'checking') {
            <p>Checking your reset link…</p>
          } @else if (state() === 'invalid') {
            <div class="alert alert-danger">{{ error() }}</div>
            <p>Use "Forgot Password" on the login page to get a new link.</p>
            <a routerLink="/msme/login" class="btn btn-primary">GO TO LOGIN</a>
          } @else if (state() === 'done') {
            <div class="alert alert-success">Password reset successful. You can now log in with your new password.</div>
            <a routerLink="/msme/login" class="btn btn-primary">GO TO LOGIN</a>
          } @else {
            <label for="newPassword">New Password</label>
            <div class="mb-3">
              <input id="newPassword" name="newPassword" type="password" class="form-control" autocomplete="new-password"
                     [(ngModel)]="newPassword" required maxlength="50" />
              <small class="text-muted">At least 8 characters, with an uppercase letter, a lowercase letter, a number and a special character.</small>
            </div>
            <label for="confirmPassword">Confirm Password</label>
            <div class="mb-3">
              <input id="confirmPassword" name="confirmPassword" type="password" class="form-control" autocomplete="new-password"
                     [(ngModel)]="confirmPassword" required maxlength="50" />
            </div>
            <div class="register-btn">
              <button type="submit" class="btn btn-primary" [disabled]="busy()">CHANGE PASSWORD</button>
              <a routerLink="/msme/login" class="btn btn-dark">LOGIN</a>
            </div>
            @if (error()) {
              <div class="alert alert-danger mt-3 mb-0" role="alert">{{ error() }}</div>
            }
          }
        </form>
      </div>
    </zed-login-shell>
  `,
})
export class ResetPasswordPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private token = '';

  protected readonly state = signal<'checking' | 'ready' | 'invalid' | 'done'>('checking');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected newPassword = '';
  protected confirmPassword = '';

  async ngOnInit(): Promise<void> {
    this.token = tokenFromFragment(this.route.snapshot.fragment);
    // Keep the token out of the browser history once read.
    if (this.token && typeof history !== 'undefined') history.replaceState(history.state, '', location.pathname + location.search);
    if (!this.token) {
      this.error.set('This reset link is invalid, has expired or has already been used. Please request a new one.');
      this.state.set('invalid');
      return;
    }
    try {
      await firstValueFrom(this.http.post<MessageResponse>('/api/msme/auth/reset-password/check', { token: this.token }));
      this.state.set('ready');
    } catch (err) {
      this.error.set(apiErrorMessage(err));
      this.state.set('invalid');
    }
  }

  protected async submit(): Promise<void> {
    this.error.set('');
    if (this.newPassword !== this.confirmPassword) {
      this.error.set('NewPassword and ConfirmPassword should be same.');
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.http.post<MessageResponse>('/api/msme/auth/reset-password', {
          token: this.token,
          newPassword: this.newPassword,
          confirmPassword: this.confirmPassword,
        }),
      );
      this.state.set('done');
    } catch (err) {
      this.error.set(apiErrorMessage(err));
      this.newPassword = '';
      this.confirmPassword = '';
    } finally {
      this.busy.set(false);
    }
  }
}
