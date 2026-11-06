import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
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
  /** The links to pages outside the portal (Admin → Links): key → address, null when the Admin switched it off. */
  links?: Partial<Record<PortalLinkKey, string | null>>;
}

/** Until /api/config answers (and for a server without the setting). */
export const DEFAULT_CONTACT_URL = 'https://zed-staging.qci.org.in/contact-us';

/** The links to pages outside the portal (Admin → Links), with the addresses used until /api/config answers. */
export const PORTAL_LINK_DEFAULTS = {
  contact: DEFAULT_CONTACT_URL,
  ministry: 'https://msme.gov.in/',
  playStore: 'https://play.google.com/store/apps/details?id=com.qci.zed.msme',
  appStore: 'https://apps.apple.com/in/app/zed-msme/id1631537071',
  lgd: 'https://lgdirectory.gov.in/downloadDirectory.do',
} as const;

export type PortalLinkKey = keyof typeof PORTAL_LINK_DEFAULTS;

/** /api/config, loaded once (kept apart from the captcha component so the app shell does not load it). */
@Injectable({ providedIn: 'root' })
export class ClientConfigService {
  private readonly http = inject(HttpClient);
  private config: Promise<ClientConfig> | null = null;

  /** Loaded once; a failed load is tried again on the next call. */
  get(): Promise<ClientConfig> {
    this.config ??= firstValueFrom(this.http.get<ClientConfig>('/api/config')).catch((err: unknown) => {
      this.config = null;
      throw err;
    });
    return this.config;
  }
}

/**
 * The links to pages outside the portal as the Admin set them (Admin → Links): `url(key)` is the address, or null when
 * the Admin switched the link off (the page then leaves it out, or shows the logo / text without a link).
 */
@Injectable({ providedIn: 'root' })
export class PortalLinksService {
  private readonly links = signal<Partial<Record<PortalLinkKey, string | null>>>({});

  constructor() {
    inject(ClientConfigService)
      .get()
      .then((c) => this.links.set({ ...(c.links ?? (c.contactUrl ? { contact: c.contactUrl } : {})) }))
      .catch(() => undefined);
  }

  url(key: PortalLinkKey): string | null {
    const v = this.links()[key];
    return v === undefined ? PORTAL_LINK_DEFAULTS[key] : v;
  }
}
