import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface ThemeColours {
  key: string;
  dark: string;
  mid: string;
  accent: string;
}

/** The logo spots of a portal's pages (Admin → Settings → Branding; Zed.Core Branding.WebSlots). */
export type LogoSlot = 'header-left' | 'header-right' | 'login-left' | 'login-right' | 'footer' | 'favicon';

/**
 * 2026-11-15 (the user, design approved): this portal's logos and colour theme, set by the Admin (Branding). Read at start
 * (/api/public/branding); a logo not set keeps today's file. A theme other than ZED Teal puts its colours on the page as
 * CSS variables with <html data-zed-theme> (styles/_themes.scss recolours the menu bar, buttons, table headings, pop-up
 * title bars and links).
 */
@Injectable({ providedIn: 'root' })
export class BrandingService {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  private readonly logos = signal<Partial<Record<LogoSlot, string>>>({});
  readonly theme = signal<ThemeColours | null>(null);

  /** The saved logo of the spot, else today's file. */
  logo(slot: LogoSlot, fallback: string): string {
    return this.logos()[slot] ?? fallback;
  }

  async load(): Promise<void> {
    try {
      const b = await firstValueFrom(this.http.get<{ theme: ThemeColours; logos: Partial<Record<LogoSlot, string>> }>('/api/public/branding'));
      this.logos.set(b.logos ?? {});
      this.apply(b.theme);
      if (b.logos?.favicon) this.favicon(b.logos.favicon);
    } catch {
      // Today's logos and colours.
    }
  }

  /** Puts a theme's colours on the page (also the Admin's preview); ZED Teal takes them off. */
  apply(theme: ThemeColours | null): void {
    this.theme.set(theme);
    const html = this.document.documentElement;
    if (!theme || theme.key === 'teal') {
      delete html.dataset['zedTheme'];
      for (const v of ['--zt-dark', '--zt-mid', '--zt-accent']) html.style.removeProperty(v);
      return;
    }
    html.dataset['zedTheme'] = theme.key;
    html.style.setProperty('--zt-dark', theme.dark);
    html.style.setProperty('--zt-mid', theme.mid);
    html.style.setProperty('--zt-accent', theme.accent);
  }

  private favicon(url: string): void {
    let link = this.document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) {
      link = this.document.createElement('link');
      link.rel = 'icon';
      this.document.head.appendChild(link);
    }
    link.href = url;
  }
}
