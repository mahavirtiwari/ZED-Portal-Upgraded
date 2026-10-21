import { HttpClient } from '@angular/common/http';
import { Component, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService, CurrentUser, Recaptcha, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { STAFF_ROLE_IDS } from './staff-menu';
import { PORTAL_SYSTEM } from '../portal-system';
import { PORTAL_LABELS } from '../portal-labels';

/**
 * Staff, agency and assessor login. Port of Views/User/Login.cshtml. The Consultancy and Surveillance builds open it
 * at their root (old /Consultancy/User/Login, /surveillance/User/Login) and name their portal under the title.
 */
@Component({
  selector: 'zed-staff-login',
  imports: [FormsModule, Recaptcha],
  host: { class: 'zed-login d-block' },
  template: `
    <main class="staff-login">
      <header class="d-flex justify-content-between align-items-center px-4 py-3">
        <a href="https://msme.gov.in/" target="_blank" rel="noopener"><img src="Images/header/ministry.png" alt="Ministry of MSME" width="200" /></a>
      </header>
      <section class="login-section-inner mx-auto">
        <div class="logo-zed-brand text-center"><img src="Images/header/zed-logo.png" alt="ZED" width="110" /></div>
        <div class="login-inner-block">
          <div class="text-center"><img src="Images/header/user.png" width="100" alt="" /></div>
          <h1 class="text-center fw-bold" style="font-size: 32px">User Login</h1>
          @if (systemName) {
            <p class="text-center text-muted mb-3">{{ systemName }}</p>
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
            @if (error()) {
              <div class="alert alert-danger mt-3 mb-0" role="alert">{{ error() }}</div>
            }
          </form>
        </div>
      </section>
      <footer>
        <div class="footer"><div><small>ZED © {{ year }} All Rights Reserved</small></div><div><img src="Images/footer/footer-icon.png" alt="QCI" /></div></div>
      </footer>
    </main>
  `,
  styles: `
    .staff-login { min-height: 100vh; display: flex; flex-direction: column; }
    .login-section-inner { max-width: 420px; width: 100%; padding: 24px 16px; flex: 1; }
    .login-inner-block { background: #fff; border-radius: 16px; box-shadow: 0 10px 24px rgba(0,0,0,.12); padding: 24px; }
    .zed-user-form label { color: #8d8f90; font-weight: 600; }
  `,
})
export class StaffLoginPage {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly captcha = viewChild(Recaptcha);

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly year = new Date().getFullYear();
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

  protected async login(): Promise<void> {
    this.error.set('');
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
      await this.router.navigateByUrl('/staff');
    } catch (err) {
      this.error.set(apiErrorMessage(err));
      this.password = '';
      this.captcha()?.reset();
    } finally {
      this.busy.set(false);
    }
  }
}
