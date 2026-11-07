import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService, CurrentUser, MessageResponse, Recaptcha, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ContentTextComponent } from '../../content/content-text';
import { LoginShell } from '../login-shell/login-shell';
import { EXPIRED_PARAM, RETURN_PARAM, SESSION_EXPIRED_MESSAGE, returnUrl } from '../../session-expiry';

/** MSME login and forgot-password. Port of Views/Msme/Login.cshtml. */
@Component({
  selector: 'zed-msme-login',
  imports: [FormsModule, RouterLink, Recaptcha, LoginShell, ContentTextComponent],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class LoginPage {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly captcha = viewChild(Recaptcha);
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;
  /** Opened because the session ended (sessionExpiryInterceptor): go back to that page after signing in. */
  private readonly back = returnUrl(this.query.get(RETURN_PARAM), '/msme/');

  protected readonly mode = signal<'login' | 'reset'>('login');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly showPassword = signal(false);
  protected readonly expired = signal(this.query.has(EXPIRED_PARAM));
  protected readonly expiredMessage = SESSION_EXPIRED_MESSAGE;

  protected userId = '';
  protected password = '';
  private captchaToken = '';

  // Forgot password (2026-11-07): by ZED ID, PAN or e-mail; the units found; the e-mail the link went to (partly hidden).
  protected readonly findModes = FIND_MODES;
  protected readonly findBy = signal<FindBy>('zedid');
  protected readonly findMode = computed(() => FIND_MODES.find((m) => m.key === this.findBy())!);
  protected findValue = '';
  protected readonly units = signal<FoundUnit[] | null>(null);
  protected readonly chosenRef = signal<string | null>(null);
  protected readonly sentTo = signal<string | null>(null);

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
    this.units.set(null);
    this.chosenRef.set(null);
    this.sentTo.set(null);
    this.findValue = '';
    this.captchaToken = '';
  }

  protected chooseFindBy(by: FindBy): void {
    this.findBy.set(by);
    this.findValue = '';
    this.error.set('');
  }

  protected placeOf(u: FoundUnit): string {
    return [u.district, u.state].filter((x) => !!x).join(', ');
  }

  protected async login(): Promise<void> {
    this.error.set('');
    this.success.set('');
    this.expired.set(false);
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
      await this.router.navigateByUrl(this.back ?? '/msme/dashboard');
    } catch (err) {
      this.error.set(apiErrorMessage(err));
      this.password = '';
      this.captcha()?.reset();
    } finally {
      this.busy.set(false);
    }
  }

  protected async findAccounts(): Promise<void> {
    this.error.set('');
    this.success.set('');
    if (!this.findValue.trim()) {
      this.error.set(`Please enter ${this.findMode().label.toLowerCase()}.`);
      return;
    }
    if (!this.captchaToken) {
      this.error.set('Please complete the verification.');
      return;
    }
    this.busy.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<{ units: FoundUnit[] }>('/api/msme/auth/forgot-password/find', {
          by: this.findBy(),
          value: this.findValue.trim(),
          captchaToken: this.captchaToken,
        }),
      );
      this.units.set(res.units);
      this.chosenRef.set(res.units.length === 1 ? res.units[0].ref : null);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.captchaToken = '';
      this.captcha()?.reset();
      this.busy.set(false);
    }
  }

  protected async sendResetLink(): Promise<void> {
    const ref = this.chosenRef();
    if (!ref) return;
    this.error.set('');
    this.busy.set(true);
    try {
      const res = await firstValueFrom(this.http.post<{ message: string; maskedEmail: string }>('/api/msme/auth/forgot-password/send', { ref }));
      this.sentTo.set(res.maskedEmail);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}

type FindBy = 'zedid' | 'pan' | 'email';

/** A unit found by ZED ID, PAN or e-mail: the ZED ID partly hidden (ZEDM•••123), no e-mail address. */
interface FoundUnit {
  ref: string;
  unitName: string;
  district: string;
  state: string;
  zedId: string;
}

const FIND_MODES: ReadonlyArray<{ key: FindBy; title: string; label: string; placeholder: string; hint: string }> = [
  { key: 'zedid', title: 'ZED ID', label: 'Your ZED ID', placeholder: 'ZEDM000123', hint: 'The unit with this ZED ID is shown next.' },
  { key: 'pan', title: 'PAN', label: 'PAN of the enterprise', placeholder: 'ABCDE1234F', hint: 'The units registered with this PAN are listed next.' },
  { key: 'email', title: 'E-mail', label: 'Registered e-mail address', placeholder: 'name@example.com', hint: 'The units registered with this e-mail are listed next.' },
];
