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
      <div class="text-center"><img src="Images/header/user.png" width="100" alt="" /></div>
      <h1 class="text-center fw-bold" style="font-size: 32px">User Login</h1>
      @if (systemName) {
        <p class="text-center text-muted mb-3">{{ systemName }}</p>
      }
      @if (expired) {
        <div class="alert alert-info session-expired" role="status">{{ expiredMessage }}</div>
      }
      <form class="login-form zed-user-form" (ngSubmit)="login()" novalidate>
        <div class="mb-3">
          <label for="userId">User ID</label>
          <input id="userId" name="userId" class="form-control" placeholder="Username" autocomplete="username" [(ngModel)]="userId" required maxlength="100" />
        </div>
        <div class="mb-3">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" class="form-control" placeholder="Password" autocomplete="current-password" [(ngModel)]="password" required maxlength="50" />
        </div>
        <div class="mb-3"><zed-recaptcha (token)="captchaToken = $event" /></div>
        <div class="d-grid col-12">
          <button type="submit" class="btn btn-primary" [disabled]="busy()">Login</button>
        </div>
        <p class="text-center mt-3 mb-0"><a routerLink="/forgot-password">Forgot password?</a></p>
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
    .zed-user-form label { color: #1d1618; font-size: 14px; font-weight: 500; }
    .btn-primary, .btn-primary:hover { color: #fff; background-color: #45a5ad; border-color: #45a5ad; font-size: 14px; text-transform: uppercase; }
  `,
})
export class StaffLoginPage {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly captcha = viewChild(Recaptcha);
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;

  protected readonly busy = signal(false);
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
