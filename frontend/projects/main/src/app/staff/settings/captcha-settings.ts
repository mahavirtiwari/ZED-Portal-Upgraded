import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CaptchaMode, MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';

interface CaptchaSettings {
  mode: CaptchaMode;
  googleAvailable: boolean;
}

/**
 * Admin → Captcha Settings (new in V4): the captcha of the login, registration, Contact ZED and "Forgot password?"
 * forms of this portal. Off, the portal's own 6-character captcha (letters and digits), or Google reCAPTCHA when its keys
 * are configured on the server. Takes effect within half a minute; the MSME mobile app is not affected. V4 layout: the
 * options as cards with what each does, the current one marked, Save only after a change.
 */
@Component({
  selector: 'zed-staff-captcha-settings',
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Captcha Settings</h3>
        <p class="page-sub">The captcha of the login, registration, Contact ZED and "Forgot password?" pages of this portal.</p>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }
    @if (loaded()) {
      <form class="zed-card" (ngSubmit)="save()" novalidate>
        <h5 class="card-title">Captcha on this portal's forms</h5>
        <p class="text-muted mb-3">Login, registration, Contact ZED and "Forgot password?" pages.</p>
        <div class="captcha-options" role="radiogroup" aria-label="Captcha">
          @for (o of options; track o.mode) {
            @if (o.mode !== 'google' || googleAvailable() || saved() === 'google') {
              <label class="captcha-option" [class.is-on]="mode() === o.mode" [class.is-disabled]="o.mode === 'google' && !googleAvailable()" [for]="'captcha-' + o.mode">
                <input class="form-check-input" type="radio" name="mode" [id]="'captcha-' + o.mode" [value]="o.mode"
                       [disabled]="o.mode === 'google' && !googleAvailable()" [ngModel]="mode()" (ngModelChange)="mode.set($event)" />
                <span class="captcha-body">
                  <span class="captcha-title">
                    {{ o.title }}
                    @if (saved() === o.mode) { <span class="status-badge is-active">Current</span> }
                  </span>
                  <span class="captcha-help">{{ o.help }}</span>
                  @if (o.mode === 'text') {
                    <span class="captcha-sample" aria-hidden="true">x7Kp2Q</span>
                  }
                  @if (o.mode === 'google' && !googleAvailable()) {
                    <span class="captcha-help text-danger">The reCAPTCHA keys are not set on the server.</span>
                  }
                </span>
              </label>
            }
          }
        </div>
        <small class="text-muted d-block mt-3">Applies to new page loads within half a minute. The MSME mobile app keeps its own captcha.</small>
        <div class="form-actions">
          @if (mode() !== saved()) { <span class="muted me-auto">Not saved yet.</span> }
          <button type="submit" class="btn btn-primary" [disabled]="busy() || mode() === saved()">Save</button>
        </div>
      </form>
    }
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    .captcha-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .captcha-option { display: flex; gap: 12px; align-items: flex-start; margin: 0; padding: 16px; border: 1px solid #dfe9ea; border-radius: 12px;
      background: #fff; cursor: pointer; transition: border-color .15s, background .15s; }
    .captcha-option:hover { border-color: #45a5ad; }
    .captcha-option.is-on { border-color: #45a5ad; background: #eef6f6; box-shadow: inset 0 0 0 1px #45a5ad; }
    .captcha-option.is-disabled { cursor: not-allowed; opacity: .7; }
    .captcha-option .form-check-input { flex: 0 0 auto; margin: 3px 0 0; border: 1px solid #8aa3a5; }
    .captcha-body { display: flex; flex-direction: column; gap: 4px; }
    .captcha-title { display: flex; align-items: center; gap: 8px; font-weight: 700; color: #23474a; }
    .captcha-help { font-size: 13px; color: #5f6f70; }
    .captcha-sample { align-self: flex-start; margin-top: 4px; padding: 4px 12px; border-radius: 6px; background: repeating-linear-gradient(135deg, #e9eff0 0 6px, #f6f9f9 6px 12px);
      font: italic 700 18px/1.2 Georgia, serif; letter-spacing: 4px; color: #2f4c4f; }
    .form-actions { align-items: center; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class CaptchaSettingsPage {
  private readonly http = inject(HttpClient);
  private static readonly url = '/api/staff/settings/captcha';

  protected readonly mode = signal<CaptchaMode>('off');
  /** The mode on the server (the "Current" badge; Save only after a change). */
  protected readonly saved = signal<CaptchaMode>('off');
  protected readonly options: { mode: CaptchaMode; title: string; help: string }[] = [
    { mode: 'text', title: 'Captcha on', help: 'The portal\'s own captcha: 6 letters and digits to type in.' },
    { mode: 'off', title: 'Captcha off', help: 'No captcha on these forms.' },
    { mode: 'google', title: 'Google reCAPTCHA', help: 'The "I\'m not a robot" box of Google, with the keys set on the server.' },
  ];
  protected readonly googleAvailable = signal(false);
  protected readonly loaded = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');

  constructor() {
    void this.load();
  }

  protected async save(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const r = await firstValueFrom(this.http.put<MessageResponse>(CaptchaSettingsPage.url, { mode: this.mode() }));
      this.saved.set(this.mode());
      this.success.set(r.message);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    this.busy.set(true);
    try {
      const s = await firstValueFrom(this.http.get<CaptchaSettings>(CaptchaSettingsPage.url));
      this.mode.set(s.mode);
      this.saved.set(s.mode);
      this.googleAvailable.set(s.googleAvailable);
      this.loaded.set(true);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
