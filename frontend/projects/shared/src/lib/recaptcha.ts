import { HttpClient } from '@angular/common/http';
import {
  afterNextRender,
  Component,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CaptchaMode, ClientConfigService } from './client-config';

interface GRecaptcha {
  ready(cb: () => void): void;
  render(el: HTMLElement, opts: { sitekey: string; callback: (t: string) => void; 'expired-callback': () => void }): number;
  reset(id?: number): void;
}

declare global {
  interface Window {
    grecaptcha?: GRecaptcha;
  }
}

let scriptLoading: Promise<GRecaptcha> | null = null;

function loadRecaptcha(): Promise<GRecaptcha> {
  scriptLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://www.google.com/recaptcha/api.js?render=explicit';
    script.async = true;
    script.onload = () => window.grecaptcha!.ready(() => resolve(window.grecaptcha!));
    script.onerror = () => reject(new Error('Could not load reCAPTCHA'));
    document.head.appendChild(script);
  });
  return scriptLoading;
}

interface TextChallenge {
  id: string;
  image: string;
}

/**
 * The forms' captcha, as the Admin chose it (Captcha Settings): the portal's own picture of 6 letters and digits
 * (token "id.answer" once 6 characters are typed), or the Google reCAPTCHA v2 checkbox (token when solved). Emits ''
 * while unsolved and 'disabled' when the captcha is off; then nothing is shown, the optional `label` heading included.
 */
@Component({
  selector: 'zed-recaptcha',
  template: `
    @if (mode() !== 'off') {
      @if (label()) {
        <label>{{ label() }}</label>
      }
      @if (mode() === 'text') {
        <div class="zed-text-captcha">
          <div class="d-flex align-items-center gap-2">
            @if (challenge(); as c) {
              <img [src]="c.image" width="180" height="56" alt="Captcha: type the 6 letters and numbers shown" class="zed-captcha-image" />
            }
            <button type="button" class="btn btn-link p-1 zed-captcha-refresh" title="New captcha" aria-label="Show a new captcha" (click)="refresh()">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
              </svg>
            </button>
          </div>
          <input type="text" class="form-control mt-2 zed-captcha-input" maxlength="6" autocomplete="off" autocapitalize="characters"
                 spellcheck="false" placeholder="Enter captcha" aria-label="Captcha" [value]="answer()" (input)="onAnswer($event)" />
        </div>
      } @else {
        <div #host class="d-flex justify-content-center"></div>
      }
    }
    @if (loadError()) {
      <p class="text-danger small mt-1">{{ loadError() }}</p>
    }
  `,
  styles: `
    .zed-captcha-image { border: 1px solid #ccc; border-radius: 4px; }
    .zed-captcha-refresh { color: #45a5ad; line-height: 1; }
    .zed-captcha-input { max-width: 220px; letter-spacing: 3px; text-transform: uppercase; }
    .zed-captcha-input::placeholder { letter-spacing: normal; text-transform: none; }
  `,
})
export class Recaptcha implements OnDestroy {
  private readonly config = inject(ClientConfigService);
  private readonly http = inject(HttpClient);
  private readonly host = viewChild<ElementRef<HTMLElement>>('host');
  private widgetId: number | null = null;
  private api: GRecaptcha | null = null;

  readonly token = output<string>();
  /** Heading above the captcha (e.g. "Verification"), shown only with it. */
  readonly label = input('');
  protected readonly mode = signal<CaptchaMode>('off');
  protected readonly challenge = signal<TextChallenge | null>(null);
  protected readonly answer = signal('');
  protected readonly loadError = signal('');

  constructor() {
    afterNextRender(async () => {
      try {
        const cfg = await this.config.get();
        const mode: CaptchaMode = cfg.captchaMode ?? (cfg.captchaEnabled ? 'google' : 'off');
        if (mode === 'off' || !cfg.captchaEnabled) {
          this.token.emit('disabled');
          return;
        }
        this.mode.set(mode);
        if (mode === 'text') {
          await this.refresh();
          return;
        }
        this.api = await loadRecaptcha();
        // Wait one tick for the @if block to render the host element.
        setTimeout(() => {
          const el = this.host()?.nativeElement;
          if (!el || !this.api) return;
          this.widgetId = this.api.render(el, {
            sitekey: cfg.captchaSiteKey,
            callback: (t) => this.token.emit(t),
            'expired-callback': () => this.token.emit(''),
          });
        });
      } catch {
        this.loadError.set('The verification widget could not be loaded. Please refresh the page.');
      }
    });
  }

  /** A new picture (each one is checked once only, so the forms call reset() after every failed submit). */
  async refresh(): Promise<void> {
    this.answer.set('');
    this.token.emit('');
    try {
      this.challenge.set(await firstValueFrom(this.http.get<TextChallenge>('/api/captcha')));
      this.loadError.set('');
    } catch {
      this.challenge.set(null);
      this.loadError.set('The captcha could not be loaded. Please click the refresh button or reload the page.');
    }
  }

  protected onAnswer(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    input.value = value;
    this.answer.set(value);
    const c = this.challenge();
    this.token.emit(c && value.length === 6 ? `${c.id}.${value}` : '');
  }

  reset(): void {
    if (this.mode() === 'text') {
      void this.refresh();
    } else if (this.api && this.widgetId !== null) {
      this.api.reset(this.widgetId);
      this.token.emit('');
    }
  }

  ngOnDestroy(): void {
    if (this.api && this.widgetId !== null) this.api.reset(this.widgetId);
  }
}
