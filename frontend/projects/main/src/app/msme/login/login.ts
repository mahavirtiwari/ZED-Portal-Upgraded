import { HttpClient } from '@angular/common/http';
import { Component, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService, CurrentUser, MessageResponse, Recaptcha, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ContentTextComponent } from '../../content/content-text';
import { LoginShell } from '../login-shell/login-shell';

/** MSME login and forgot-password. Port of Views/Msme/Login.cshtml. */
@Component({
  selector: 'zed-msme-login',
  imports: [FormsModule, RouterLink, Recaptcha, LoginShell, ContentTextComponent],
  templateUrl: './login.html',
})
export class LoginPage {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly captcha = viewChild(Recaptcha);

  protected readonly mode = signal<'login' | 'reset'>('login');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly showPassword = signal(false);

  protected userId = '';
  protected password = '';
  protected resetUserId = '';
  private captchaToken = '';

  constructor() {
    // e.g. "Password changed. Please login…" passed by the change-password page.
    const message = this.router.currentNavigation()?.extras.state?.['message'] ?? history.state?.message;
    if (typeof message === 'string') this.success.set(message);

    // Already signed in: go straight to the dashboard, as the old page did.
    this.auth.ensureLoaded().then(() => {
      if (this.auth.currentUser()?.roleId === 5) this.router.navigateByUrl('/msme/dashboard');
    });
  }

  protected onCaptcha(token: string): void {
    this.captchaToken = token;
  }

  protected switchMode(mode: 'login' | 'reset'): void {
    this.mode.set(mode);
    this.error.set('');
    this.success.set('');
  }

  protected async login(): Promise<void> {
    this.error.set('');
    this.success.set('');
    if (!this.userId.trim() || !this.password) {
      this.error.set('Please enter your ZED ID and password.');
      return;
    }
    if (!this.captchaToken) {
      this.error.set('Please complete the verification.');
      return;
    }
    this.busy.set(true);
    try {
      const user = await firstValueFrom(
        this.http.post<CurrentUser>('/api/msme/auth/login', {
          userId: this.userId.trim(),
          password: this.password,
          captchaToken: this.captchaToken,
        }),
      );
      this.auth.setUser(user);
      await this.router.navigateByUrl('/msme/dashboard');
    } catch (err) {
      this.error.set(apiErrorMessage(err));
      this.password = '';
      this.captcha()?.reset();
    } finally {
      this.busy.set(false);
    }
  }

  protected async forgotPassword(): Promise<void> {
    this.error.set('');
    this.success.set('');
    if (!this.resetUserId.trim()) {
      this.error.set('Please enter your ZED ID.');
      return;
    }
    this.busy.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<MessageResponse>('/api/msme/auth/forgot-password', { userId: this.resetUserId.trim() }),
      );
      this.success.set(res.message);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
