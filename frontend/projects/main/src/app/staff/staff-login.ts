import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService, CurrentUser, Recaptcha, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { STAFF_ROLE_IDS } from './staff-menu';
import { StaffLoginShell } from './staff-login-shell';
import { PORTAL_SYSTEM } from '../portal-system';
import { PORTAL_LABELS } from '../portal-labels';
import { EXPIRED_PARAM, RETURN_PARAM, SESSION_EXPIRED_MESSAGE, returnUrl } from '../session-expiry';

/**
 * Staff, agency and assessor login. Port of Views/User/Login.cshtml. The Consultancy and Surveillance builds open it
 * at their root (old /Consultancy/User/Login, /surveillance/User/Login) and name their portal under the title.
 */
@Component({
  selector: 'zed-staff-login',
  imports: [FormsModule, RouterLink, Recaptcha, StaffLoginShell],
  template: `
    <zed-staff-login-shell>
      <h1 class="login-title">Welcome back</h1>
      <p class="login-sub">Sign in with your ZED user ID{{ systemName ? ' · ' + systemName : '' }}</p>
      @if (expired) {
        <div class="alert alert-info session-expired" role="status">{{ expiredMessage }}</div>
      }
      <form class="login-form zed-user-form" (ngSubmit)="login()" novalidate>
        <div class="mb-3">
          <label for="userId">User ID</label>
          <div class="field">
            <span class="in-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2.2c-3.3 0-9 1.7-9 5V21h18v-1.8c0-3.3-5.7-5-9-5Z" /></svg></span>
            <input id="userId" name="userId" class="form-control" placeholder="Username" autocomplete="username" [(ngModel)]="userId" required maxlength="100" />
          </div>
        </div>
        <div class="mb-3">
          <label for="password">Password</label>
          <div class="field">
            <span class="in-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2Zm-7-2a2 2 0 1 1 4 0v2h-4V7Zm2 10.2a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4Z" /></svg></span>
            <input id="password" name="password" [type]="showPassword() ? 'text' : 'password'" class="form-control has-toggle" placeholder="Password" autocomplete="current-password" [(ngModel)]="password" required maxlength="50" />
            <button type="button" class="toggle" (click)="showPassword.set(!showPassword())" [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'" [attr.aria-pressed]="showPassword()">
              {{ showPassword() ? 'Hide' : 'Show' }}
            </button>
          </div>
        </div>
        <div class="mb-3"><zed-recaptcha (token)="captchaToken = $event" /></div>
        <div class="d-grid col-12">
          <button type="submit" class="btn btn-primary" [disabled]="busy()">Login</button>
        </div>
        <p class="login-links"><a routerLink="/forgot-password">Forgot password?</a></p>
        @if (error()) {
          <div class="alert alert-danger mt-3 mb-0" role="alert">{{ error() }}</div>
        }
        @if (adminMoved()) {
          <!-- One Admin (V4): the Admin of this portal signs in on the main portal and chooses this portal there. -->
          <div class="d-grid mt-2">
            <a class="btn btn-primary" href="/login" (click)="toMainAdmin()">Go to the Admin on the main portal</a>
          </div>
        }
      </form>
    </zed-staff-login-shell>
  `,
  styles: `
    .login-title { font-size: 28px; font-weight: 700; color: #1d2b2c; margin: 0; }
    .login-sub { color: #5f6b6c; font-size: 14px; margin: 4px 0 22px; }
    .zed-user-form label { color: #1d1618; font-size: 14px; font-weight: 500; margin-bottom: 4px; }
    .field { position: relative; }
    .in-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); width: 18px; height: 18px; pointer-events: none; }
    .in-icon svg { width: 18px; height: 18px; fill: #23656b; display: block; }
    .field .form-control { height: 46px; padding-left: 40px; border-radius: 10px; border-color: #cfd9da; }
    .field .form-control:focus { border-color: #2f8a92; box-shadow: 0 0 0 3px rgba(47, 138, 146, 0.2); }
    .field .form-control.has-toggle { padding-right: 64px; }
    .toggle {
      position: absolute; right: 6px; top: 50%; transform: translateY(-50%); border: 0; background: none; color: #23656b;
      font-size: 13px; font-weight: 600; padding: 6px 8px; border-radius: 6px;
    }
    .toggle:hover { background: #e6f2f3; }
    .btn-primary, .btn-primary:hover {
      color: #fff; background-color: #23656b; border-color: #23656b; font-size: 15px; font-weight: 600; letter-spacing: 0.6px;
      text-transform: uppercase; height: 48px; border-radius: 10px; display: flex; align-items: center; justify-content: center;
    }
    .btn-primary:hover, .btn-primary:focus-visible { background-color: #174a4e; border-color: #174a4e; filter: none; }
    .login-links { text-align: center; margin: 16px 0 0; }
    .login-links a { color: #23656b; font-weight: 600; }
  `,
})
export class StaffLoginPage {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly captcha = viewChild(Recaptcha);
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;

  protected readonly busy = signal(false);
  protected readonly showPassword = signal(false);
  protected readonly error = signal('');
  /** Opened because the session ended (sessionExpiryInterceptor): say so, and go back to that page after signing in. */
  protected readonly expired = this.query.has(EXPIRED_PARAM);
  protected readonly expiredMessage = SESSION_EXPIRED_MESSAGE;
  private readonly back = returnUrl(this.query.get(RETURN_PARAM), '/staff');
  /** The server said the Admin signs in on the main portal now (V4 one Admin). */
  protected readonly adminMoved = signal(false);
  protected readonly systemName = PORTAL_SYSTEM === 'main' ? '' : PORTAL_LABELS.portalName;
  protected userId = '';
  protected password = '';
  protected captchaToken = '';

  constructor() {
    this.auth.ensureLoaded().then(() => {
      const u = this.auth.currentUser();
      if (u && STAFF_ROLE_IDS.includes(u.roleId)) this.router.navigateByUrl('/staff');
    });
  }

  /** The main portal's Admin opens with this portal chosen in its switch (same site, so the same tab storage). */
  protected toMainAdmin(): void {
    try {
      sessionStorage.setItem('zed.adminPortal', PORTAL_SYSTEM);
    } catch {
      /* private window: the Admin chooses the portal there */
    }
  }

  protected async login(): Promise<void> {
    this.error.set('');
    this.adminMoved.set(false);
    if (!this.userId.trim() || !this.password) {
      this.error.set('Please enter your User ID and password.');
      return;
    }
    if (!this.captchaToken) {
      this.error.set('Please complete the verification.');
      return;
    }
    this.busy.set(true);
    try {
      const user = await firstValueFrom(
        this.http.post<CurrentUser>('/api/staff/auth/login', { userId: this.userId.trim(), password: this.password, captchaToken: this.captchaToken }),
      );
      this.auth.setUser(user);
      await this.router.navigateByUrl(this.back ?? '/staff');
    } catch (err) {
      this.error.set(apiErrorMessage(err));
      this.adminMoved.set(err instanceof HttpErrorResponse && (err.error as { adminOnMainPortal?: boolean } | null)?.adminOnMainPortal === true);
      this.password = '';
      this.captcha()?.reset();
    } finally {
      this.busy.set(false);
    }
  }
}
