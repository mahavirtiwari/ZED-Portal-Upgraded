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
 * are configured on the server. Takes effect within half a minute; the MSME mobile app is not affected.
 */
@Component({
  selector: 'zed-staff-captcha-settings',
  imports: [FormsModule],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="row justify-content-center mt-3">
        <div class="col-sm-8">
          <h3 class="registration-title">Captcha Settings</h3>
          @if (error()) {
            <div class="alert alert-danger" role="alert">{{ error() }}</div>
          }
          @if (success()) {
            <div class="alert alert-success" role="status">{{ success() }}</div>
          }
          @if (loaded()) {
            <form class="jumbotron form-horizontal" (ngSubmit)="save()" novalidate>
              <p>Captcha on the login, registration, Contact ZED and "Forgot password?" pages of this portal:</p>
              <div class="form-check mb-2">
                <input class="form-check-input" type="radio" name="mode" id="captcha-text" value="text" [ngModel]="mode()" (ngModelChange)="mode.set($event)" />
                <label class="form-check-label" for="captcha-text"><strong>Enable captcha</strong> (6 characters, letters and numbers)</label>
              </div>
              <div class="form-check mb-2">
                <input class="form-check-input" type="radio" name="mode" id="captcha-off" value="off" [ngModel]="mode()" (ngModelChange)="mode.set($event)" />
                <label class="form-check-label" for="captcha-off"><strong>Disable captcha</strong></label>
              </div>
              @if (googleAvailable() || mode() === 'google') {
                <div class="form-check mb-2">
                  <input class="form-check-input" type="radio" name="mode" id="captcha-google" value="google" [disabled]="!googleAvailable()"
                         [ngModel]="mode()" (ngModelChange)="mode.set($event)" />
                  <label class="form-check-label" for="captcha-google"><strong>Google reCAPTCHA</strong></label>
                </div>
              }
              <small class="text-muted d-block mb-3">The change applies to new page loads within half a minute. The MSME mobile app keeps its own captcha.</small>
              <div class="d-flex justify-content-end">
                <button type="submit" class="btn btn-primary" style="min-width: 200px" [disabled]="busy()">SAVE</button>
              </div>
            </form>
          }
        </div>
      </div>
    </div>
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    .form-check-input { border: 1px solid #888; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class CaptchaSettingsPage {
  private readonly http = inject(HttpClient);
  private static readonly url = '/api/staff/settings/captcha';

  protected readonly mode = signal<CaptchaMode>('off');
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
      this.googleAvailable.set(s.googleAvailable);
      this.loaded.set(true);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
