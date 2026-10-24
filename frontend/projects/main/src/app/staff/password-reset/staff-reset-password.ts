import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PORTAL_SYSTEM } from '../../portal-system';
import { PORTAL_LABELS } from '../../portal-labels';
import { StaffLoginShell } from '../staff-login-shell';

/** The token of a link `…/reset-password#token=…` (the fragment never reaches the server). */
export function tokenFromFragment(fragment: string | null): string {
  return new URLSearchParams(fragment ?? '').get('token') ?? '';
}

/** Target of the staff reset link: checks the link, then sets the new password. */
@Component({
  selector: 'zed-staff-reset-password',
  imports: [FormsModule, RouterLink, StaffLoginShell],
  template: `
    <zed-staff-login-shell>
      <h1 class="text-center fw-bold" style="font-size: 28px">Set a New Password</h1>
      @if (systemName) {
        <p class="text-center text-muted mb-3">{{ systemName }}</p>
      }
      @switch (state()) {
        @case ('checking') {
          <p>Checking your link…</p>
        }
        @case ('invalid') {
          <div class="alert alert-danger" role="alert">{{ error() }}</div>
          <a routerLink="/forgot-password" class="btn btn-primary w-100">Request a New Link</a>
        }
        @case ('done') {
          <div class="alert alert-success" role="status">{{ done() }}</div>
          <a routerLink="/login" class="btn btn-primary w-100">Go to Login</a>
        }
        @default {
          <form class="login-form zed-user-form" (ngSubmit)="submit()" novalidate>
            <div class="mb-3">
              <label for="newPassword">New Password</label>
              <input id="newPassword" name="newPassword" type="password" class="form-control" autocomplete="new-password" [(ngModel)]="newPassword" required maxlength="50" />
              <small class="text-muted">8 to 50 characters, with an uppercase letter, a lowercase letter, a number and a special character.</small>
            </div>
            <div class="mb-3">
              <label for="confirmPassword">Confirm Password</label>
              <input id="confirmPassword" name="confirmPassword" type="password" class="form-control" autocomplete="new-password" [(ngModel)]="confirmPassword" required maxlength="50" />
            </div>
            <div class="d-grid col-12">
              <button type="submit" class="btn btn-primary" [disabled]="busy()">Change Password</button>
            </div>
            @if (error()) {
              <div class="alert alert-danger mt-3 mb-0" role="alert">{{ error() }}</div>
            }
          </form>
        }
      }
    </zed-staff-login-shell>
  `,
  styles: `
    .zed-user-form label { color: #1d1618; font-size: 14px; font-weight: 500; }
    .btn-primary, .btn-primary:hover { color: #fff; background-color: #45a5ad; border-color: #45a5ad; font-size: 14px; text-transform: uppercase; }
  `,
})
export class StaffResetPasswordPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);

  protected readonly systemName = PORTAL_SYSTEM === 'main' ? '' : PORTAL_LABELS.portalName;
  protected readonly state = signal<'checking' | 'ready' | 'invalid' | 'done'>('checking');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly done = signal('');
  protected newPassword = '';
  protected confirmPassword = '';
  private token = '';

  async ngOnInit(): Promise<void> {
    this.token = tokenFromFragment(this.route.snapshot.fragment);
    // Keep the token out of the browser history once read.
    if (this.token && typeof history !== 'undefined') history.replaceState(history.state, '', location.pathname + location.search);
    if (!this.token) {
      this.invalid('This reset link is invalid, has expired or has already been used. Please request a new one.');
      return;
    }
    try {
      await firstValueFrom(this.http.post<MessageResponse>('/api/staff/auth/password-reset/check', { token: this.token }));
      this.state.set('ready');
    } catch (err) {
      this.invalid(apiErrorMessage(err));
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
      const r = await firstValueFrom(
        this.http.post<MessageResponse>('/api/staff/auth/password-reset/reset', {
          token: this.token,
          newPassword: this.newPassword,
          confirmPassword: this.confirmPassword,
        }),
      );
      this.done.set(r.message);
      this.state.set('done');
    } catch (err) {
      this.error.set(apiErrorMessage(err));
      this.newPassword = '';
      this.confirmPassword = '';
    } finally {
      this.busy.set(false);
    }
  }

  private invalid(message: string): void {
    this.error.set(message);
    this.state.set('invalid');
  }
}
