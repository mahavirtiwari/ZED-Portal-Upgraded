import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { PortalSwitchComponent } from '../admin-portal';
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
 * current protection on top, the forms it applies to, the options as cards with what each does and a small login form
 * showing where the captcha sits, the current one marked, Save only after a change (saying what changes).
 */
@Component({
  selector: 'zed-staff-captcha-settings',
  imports: [FormsModule, PortalSwitchComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Captcha Settings</h3>
        <p class="page-sub">The captcha of the login, registration, Contact ZED and "Forgot password?" pages of this portal.</p>
      </div>
    </div>
    <!-- One Admin (V4): the portal whose settings these are (each portal keeps its own). -->
    <zed-portal-switch />
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }
    @if (loaded()) {
      <div class="cap-status" [class.off]="saved() === 'off'" role="status">
        <span class="cap-shield" aria-hidden="true">{{ saved() === 'off' ? '!' : '✓' }}</span>
        <div>
          <strong>{{ saved() === 'off' ? 'No captcha on the forms' : 'Forms protected by ' + (saved() === 'google' ? 'Google reCAPTCHA' : "the portal's own captcha") }}</strong>
          <small class="d-block">{{ saved() === 'off' ? 'Anyone, or any program, can submit them without a check.' : 'A visitor proves they are a person before a form is sent.' }}</small>
        </div>
      </div>

      <form class="zed-card" (ngSubmit)="save()" novalidate>
        <h5 class="card-title">Captcha on this portal's forms</h5>
        <div class="where" aria-label="Where it applies">
          @for (f of forms; track f) { <span class="where-chip">{{ f }}</span> }
          <span class="where-chip not">Not the MSME mobile app</span>
        </div>
        <div class="captcha-options" role="radiogroup" aria-label="Captcha">
          @for (o of options; track o.mode) {
            @if (o.mode !== 'google' || googleAvailable() || saved() === 'google') {
              <label class="captcha-option" [class.is-on]="mode() === o.mode" [class.is-disabled]="o.mode === 'google' && !googleAvailable()" [for]="'captcha-' + o.mode">
                <span class="opt-head">
                  <input class="form-check-input" type="radio" name="mode" [id]="'captcha-' + o.mode" [value]="o.mode"
                         [disabled]="o.mode === 'google' && !googleAvailable()" [ngModel]="mode()" (ngModelChange)="mode.set($event)" />
                  <span class="captcha-title">
                    {{ o.title }}
                    @if (saved() === o.mode) { <span class="status-badge is-active">Current</span> }
                  </span>
                </span>
                <span class="captcha-help">{{ o.help }}</span>
                @if (o.mode === 'off') { <span class="captcha-help warn">Not recommended: the forms are open to automated sign-ups and spam.</span> }
                @if (o.mode === 'google' && !googleAvailable()) {
                  <span class="captcha-help text-danger">The reCAPTCHA keys are not set on the server.</span>
                }
                <span class="mock" aria-hidden="true">
                  <span class="mock-title">Login form</span>
                  <span class="mock-input"></span>
                  <span class="mock-input"></span>
                  @switch (o.mode) {
                    @case ('text') {
                      <span class="mock-captcha"><span class="captcha-sample">x7Kp2Q</span><span class="mock-input small-input"></span></span>
                    }
                    @case ('google') {
                      <span class="mock-recaptcha"><i></i> I'm not a robot <b>reCAPTCHA</b></span>
                    }
                  }
                  <span class="mock-button">LOGIN</span>
                </span>
              </label>
            }
          }
        </div>
        @if (!googleAvailable() && saved() !== 'google') {
          <small class="text-muted d-block mt-3">Google reCAPTCHA ("I'm not a robot") is offered here once its keys are set in the server's settings file.</small>
        }
        <small class="text-muted d-block mt-1">Applies to new page loads within half a minute. The MSME mobile app keeps its own captcha.</small>
        <div class="form-actions save-row" [class.is-dirty]="mode() !== saved()">
          @if (mode() !== saved()) { <span class="unsaved me-auto">Not saved yet. {{ titleOf(saved()) }} → {{ titleOf(mode()) }}</span> }
          <button type="submit" class="btn btn-primary" [disabled]="busy() || mode() === saved()">Save</button>
        </div>
      </form>
    }
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    .cap-status { display: flex; align-items: center; gap: 14px; padding: 14px 18px; margin-bottom: 16px; border-radius: 12px;
      background: #e6f6ec; border: 1px solid #bfe3cc; color: #1e5a33; }
    .cap-status.off { background: #fff8e6; border-color: #f0d79a; color: #6b4d00; }
    .cap-shield { flex: 0 0 40px; height: 40px; border-radius: 20px; display: grid; place-items: center; font-size: 20px; font-weight: 800; color: #fff; background: #2e9e5b; }
    .cap-status.off .cap-shield { background: #e0a43a; }
    .cap-status strong { font-size: 15px; }
    .where { display: flex; flex-wrap: wrap; gap: 6px; margin: 2px 0 14px; }
    .where-chip { font-size: 12px; font-weight: 600; background: #eef6f6; color: #23474a; border-radius: 12px; padding: 2px 10px; }
    .where-chip.not { background: #f2f4f4; color: #8a9899; font-weight: 400; font-style: italic; }

    .captcha-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
    .captcha-option { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 16px; border: 1px solid #dfe9ea; border-radius: 12px;
      background: #fff; cursor: pointer; transition: border-color .15s, background .15s; }
    .captcha-option:hover { border-color: #45a5ad; }
    .captcha-option.is-on { border-color: #45a5ad; background: #eef6f6; box-shadow: inset 0 0 0 1px #45a5ad; }
    .captcha-option.is-disabled { cursor: not-allowed; opacity: .7; }
    .opt-head { display: flex; align-items: center; gap: 10px; }
    .captcha-option .form-check-input { flex: 0 0 auto; margin: 0; border: 1px solid #8aa3a5; }
    .captcha-title { display: flex; align-items: center; gap: 8px; font-weight: 700; color: #23474a; font-size: 15px; }
    .captcha-help { font-size: 13px; color: #5f6f70; font-weight: 400; }
    .captcha-help.warn { color: #8a6100; }

    /* A small login form showing where the captcha sits. */
    .mock { display: flex; flex-direction: column; gap: 6px; margin-top: auto; padding: 12px; border: 1px dashed #cfdcdd; border-radius: 10px; background: #fbfdfd; }
    .captcha-option.is-on .mock { background: #fff; }
    .mock-title { font-size: 11px; font-weight: 700; color: #5f6f70; text-transform: uppercase; letter-spacing: .05em; }
    .mock-input { height: 22px; border: 1px solid #dfe5e6; border-radius: 5px; background: #fff; }
    .mock-captcha { display: flex; gap: 8px; align-items: center; }
    .small-input { flex: 1 1 auto; }
    .captcha-sample { flex: none; padding: 1px 10px; border-radius: 5px; background: repeating-linear-gradient(135deg, #e9eff0 0 6px, #f6f9f9 6px 12px);
      font: italic 700 15px/1.3 Georgia, serif; letter-spacing: 3px; color: #2f4c4f; }
    .mock-recaptcha { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid #d3d3d3; border-radius: 4px; background: #f9f9f9; font-size: 12px; color: #222; }
    .mock-recaptcha i { width: 16px; height: 16px; border: 2px solid #c1c1c1; border-radius: 2px; background: #fff; }
    .mock-recaptcha b { margin-left: auto; font-size: 9px; color: #555; font-weight: 600; }
    .mock-button { align-self: flex-start; font-size: 11px; font-weight: 700; color: #fff; background: #45a5ad; border-radius: 5px; padding: 3px 14px; }

    .save-row { align-items: center; margin-top: 14px; padding-top: 12px; border-top: 1px solid #eef3f3; }
    .save-row.is-dirty { border-top-color: #e9c46a; }
    .unsaved { color: #8a6100; font-size: 13px; font-weight: 600; }
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
  /** The forms the captcha is on (the chips). */
  protected readonly forms = ['Login', 'Registration', 'Contact ZED', 'Forgot password'];
  protected readonly googleAvailable = signal(false);
  protected readonly loaded = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');

  constructor() {
    void this.load();
  }

  protected titleOf(mode: CaptchaMode): string {
    return this.options.find((o) => o.mode === mode)?.title ?? mode;
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
