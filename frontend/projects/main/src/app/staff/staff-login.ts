import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService, CurrentUser, Recaptcha, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { STAFF_ROLE_IDS } from './staff-menu';
import { StaffLoginShell } from './staff-login-shell';
import { PORTAL_SYSTEM } from '../portal-system';
import { PORTAL_LABELS } from '../portal-labels';
import { EXPIRED_PARAM, RETURN_PARAM, returnUrl, sessionExpiredMessage } from '../session-expiry';
import { TextPipe, t } from '../content/page-text';

/**
 * Staff, agency and assessor login. Port of Views/User/Login.cshtml. The Consultancy and Surveillance builds open it
 * at their root (old /Consultancy/User/Login, /surveillance/User/Login) and name their portal under the title.
 */
@Component({
  selector: 'zed-staff-login',
  imports: [FormsModule, RouterLink, Recaptcha, StaffLoginShell, TextPipe],
  template: `
    <zed-staff-login-shell>
      <!-- 2026-11-17 (approved): the MSME login's form (login.scss): flat, square, Login and Forgot password? side by side. -->
      <div class="login-login">
        <h1 class="ml-heading">{{ 'Sign in' | t: 'public.staffLogin.title' }}</h1>
        <p class="ml-lead">{{ systemName() ? ('Use your ZED user ID and password · {portal}.' | t: 'public.staffLogin.portalLead' : { portal: systemName() }) : ('Use your ZED user ID and password.' | t: 'public.staffLogin.lead') }}</p>
        @if (expired) {
          <div class="alert alert-info session-expired" role="status">{{ expiredMessage }}</div>
        }
        <form class="login-form zed-user-form" (ngSubmit)="login()" novalidate>
          <label for="userId">{{ 'User ID' | t: 'public.staffLogin.userId.label' }}</label>
          <div class="mb-3 in-field">
            <span class="in-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg></span>
            <input id="userId" name="userId" class="form-control" [placeholder]="'Username' | t: 'public.staffLogin.userId.placeholder'" autocomplete="username" [(ngModel)]="userId" required maxlength="100" />
          </div>
          <label for="password">{{ 'Password' | t: 'public.staffLogin.password.label' }}</label>
          <div class="mb-3 in-field">
            <span class="in-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg></span>
            <input id="password" name="password" [type]="showPassword() ? 'text' : 'password'" class="form-control has-toggle" [placeholder]="'Password' | t: 'public.staffLogin.password.placeholder'" autocomplete="current-password" [(ngModel)]="password" required maxlength="50" />
            <button type="button" class="in-toggle toggle" (click)="showPassword.set(!showPassword())" [attr.aria-label]="showPassword() ? ('Hide password' | t: 'public.staffLogin.password.hideAria') : ('Show password' | t: 'public.staffLogin.password.showAria')" [attr.aria-pressed]="showPassword()">{{ showPassword() ? ('Hide' | t: 'public.staffLogin.password.hideButton') : ('Show' | t: 'public.staffLogin.password.showButton') }}</button>
          </div>
          <div class="mb-3"><zed-recaptcha (token)="captchaToken = $event" /></div>
          <div class="ml-actions ml-two">
            <button type="submit" class="btn ml-btn-login" [disabled]="busy()">{{ 'Login' | t: 'public.staffLogin.loginButton' }}
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7" /></svg></button>
            <a class="btn ml-btn-forgot" routerLink="/forgot-password">{{ 'Forgot password?' | t: 'public.staffLogin.forgotLink' }}</a>
          </div>
          @if (error()) {
            <div class="alert alert-danger mt-3 mb-0" role="alert">{{ error() }}</div>
          }
          @if (adminMoved()) {
            <!-- One Admin (V4): the Admin of this portal signs in on the main portal and chooses this portal there. -->
            <div class="register-btn mt-3">
              <a class="btn btn-primary" href="/login" (click)="toMainAdmin()">{{ 'Go to the Admin on the main portal' | t: 'public.staffLogin.mainAdminLink' }}</a>
            </div>
          }
        </form>
      </div>
    </zed-staff-login-shell>
  `,
  styleUrl: '../msme/login/login.scss',
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
  protected get expiredMessage(): string {
    return sessionExpiredMessage();
  }
  private readonly back = returnUrl(this.query.get(RETURN_PARAM), '/staff');
  /** The server said the Admin signs in on the main portal now (V4 one Admin). */
  protected readonly adminMoved = signal(false);
  protected readonly systemName = computed(() => (PORTAL_SYSTEM === 'main' ? '' : PORTAL_LABELS.portalName));
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
      this.error.set(t('public.staffLogin.missingError', 'Please enter your User ID and password.'));
      return;
    }
    if (!this.captchaToken) {
      this.error.set(t('public.staffLogin.captchaError', 'Please complete the verification.'));
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
