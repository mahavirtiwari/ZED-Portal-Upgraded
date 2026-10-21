import { HttpClient } from '@angular/common/http';
import {
  Component,
  ElementRef,
  Injectable,
  OnDestroy,
  afterNextRender,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface ClientConfig {
  captchaEnabled: boolean;
  captchaSiteKey: string;
  /** Old MVC portal, for links to modules not migrated yet. */
  legacyPortalUrl: string;
}

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

@Injectable({ providedIn: 'root' })
export class ClientConfigService {
  private readonly http = inject(HttpClient);
  private config: Promise<ClientConfig> | null = null;

  get(): Promise<ClientConfig> {
    this.config ??= firstValueFrom(this.http.get<ClientConfig>('/api/config'));
    return this.config;
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

/**
 * Google reCAPTCHA v2 checkbox. Emits the token when solved and '' when it expires.
 * Renders nothing when the API reports the captcha as disabled (development).
 */
@Component({
  selector: 'zed-recaptcha',
  template: `
    @if (enabled()) {
      <div #host class="d-flex justify-content-center"></div>
    }
    @if (loadError()) {
      <p class="text-danger small mt-1">{{ loadError() }}</p>
    }
  `,
})
export class Recaptcha implements OnDestroy {
  private readonly config = inject(ClientConfigService);
  private readonly host = viewChild<ElementRef<HTMLElement>>('host');
  private widgetId: number | null = null;
  private api: GRecaptcha | null = null;

  readonly token = output<string>();
  protected readonly enabled = signal(false);
  protected readonly loadError = signal('');

  constructor() {
    afterNextRender(async () => {
      try {
        const cfg = await this.config.get();
        if (!cfg.captchaEnabled) {
          this.token.emit('disabled');
          return;
        }
        this.enabled.set(true);
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

  reset(): void {
    if (this.api && this.widgetId !== null) {
      this.api.reset(this.widgetId);
      this.token.emit('');
    }
  }

  ngOnDestroy(): void {
    this.reset();
  }
}
