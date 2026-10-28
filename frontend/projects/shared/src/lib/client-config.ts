import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type CaptchaMode = 'off' | 'text' | 'google';

export interface ClientConfig {
  captchaEnabled: boolean;
  /** Chosen by the Admin (Captcha Settings): none, the portal's own 6-character picture, or Google reCAPTCHA. */
  captchaMode?: CaptchaMode;
  captchaSiteKey: string;
  /** Old MVC portal, for links to modules not migrated yet. */
  legacyPortalUrl: string;
  /** Where "Contact ZED" goes (Admin → Links; the ZED website's contact page by default). */
  contactUrl?: string;
}

/** Until /api/config answers (and for a server without the setting). */
export const DEFAULT_CONTACT_URL = 'https://zed-staging.qci.org.in/contact-us';

/** /api/config, loaded once (kept apart from the captcha component so the app shell does not load it). */
@Injectable({ providedIn: 'root' })
export class ClientConfigService {
  private readonly http = inject(HttpClient);
  private config: Promise<ClientConfig> | null = null;

  get(): Promise<ClientConfig> {
    this.config ??= firstValueFrom(this.http.get<ClientConfig>('/api/config'));
    return this.config;
  }
}
