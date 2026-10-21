import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { LoginShell } from '../login-shell/login-shell';

/** Target of the "Reset Password" e-mail link. Port of Views/Msme/ChangePassword.cshtml. */
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

  /** ?code= query parameter (bound by the router). */
  readonly code = input<string>('');

  protected readonly state = signal<'checking' | 'ready' | 'invalid' | 'done'>('checking');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected newPassword = '';
  protected confirmPassword = '';

  async ngOnInit(): Promise<void> {
    if (!this.code()) {
      this.error.set('This reset link is invalid or has already been used.');
      this.state.set('invalid');
      return;
    }
    try {
      await firstValueFrom(this.http.get<MessageResponse>(`/api/msme/auth/reset-password/${encodeURIComponent(this.code())}`));
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
          code: this.code(),
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
