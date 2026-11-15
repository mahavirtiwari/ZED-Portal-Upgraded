import type { HttpClient } from '../api/http';
import type { KeyValueStore } from '../db/keyValueStore';

/**
 * New (2026-11-15): the logo and colour theme the portal's Admin sets per app (Admin → Settings → Branding), read from
 * the main portal's public endpoint `api/public/branding/app/{app}` (no sign-in). Loaded at start; the last good
 * answer is kept on the phone so an offline start still shows the Admin's look. Without any answer, or with the theme
 * `teal`, every app keeps the look it has today (its bundled logo and its own colours).
 */

/** The app names the endpoint knows: `msme` is the ZED MSME app (apps/zedmsme). */
export type BrandingAppName = 'msme' | 'assessor' | 'consultant';

/** A theme as the server sends it: `dark` (headers' deep end), `mid` (headers, primary buttons), `accent`. */
export type BrandTheme = { key: string; dark: string; mid: string; accent: string };

/** The endpoint's answer; `logoUrl` is null when the Admin saved no logo. */
export type AppBrandingResponse = { theme?: Partial<BrandTheme> | null; logoUrl?: string | null };

/** What the apps draw: `theme` null = today's colours, `logoUrl` null = the bundled logo. */
export type BrandingState = { theme: BrandTheme | null; logoUrl: string | null };

export const NO_BRANDING: BrandingState = Object.freeze({ theme: null, logoUrl: null }) as BrandingState;

/** The theme key that means "today's colours" (#23656b, #45a5ad, #c9e8a0): no app changes its look for it. */
export const DEFAULT_THEME_KEY = 'teal';

/** Short on purpose: the start never waits on it, and a slow answer only delays the new look to the next start. */
export const BRANDING_TIMEOUT_MS = 5_000;

const CACHE_KEY = 'branding.app';
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const ABSOLUTE = /^https?:\/\//i;

/** `{base}/api/public/branding/app/{app}` on the main portal (base: scheme and host, as Environment.baseUrl). */
export function brandingUrl(baseUrl: string, app: BrandingAppName): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/public/branding/app/${app}`;
}

/**
 * Asks the main portal for an app's branding, with {@link BRANDING_TIMEOUT_MS}. A relative `logoUrl` (an older or
 * differently configured server) is made absolute on the same portal.
 */
export async function fetchAppBranding(http: HttpClient, baseUrl: string, app: BrandingAppName): Promise<AppBrandingResponse> {
  const r = await http.getJson<AppBrandingResponse>(brandingUrl(baseUrl, app), { timeoutMs: BRANDING_TIMEOUT_MS });
  if (r && typeof r === 'object' && typeof r.logoUrl === 'string' && r.logoUrl.trim() !== '' && !ABSOLUTE.test(r.logoUrl.trim())) {
    return { ...r, logoUrl: `${baseUrl.replace(/\/+$/, '')}/${r.logoUrl.trim().replace(/^\/+/, '')}` };
  }
  return r;
}

/**
 * The answer as the apps use it, or null when it is not a branding answer (the maintenance or failure body
 * `{status:"0", errorMessage}`, an HTML page, anything else): the kept answer then stays. A theme with a colour that
 * is not #RGB / #RRGGBB, or the `teal` theme, means today's colours; a logo that is not an http(s) address means the
 * bundled logo.
 */
export function normalizeBranding(value: unknown): BrandingState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if ('status' in v && String(v.status) !== '1') return null;
  if (!('theme' in v) && !('logoUrl' in v)) return null;
  return { theme: themeOf(v.theme), logoUrl: logoOf(v.logoUrl) };
}

function themeOf(value: unknown): BrandTheme | null {
  if (!value || typeof value !== 'object') return null;
  const t = value as Partial<Record<keyof BrandTheme, unknown>>;
  const key = typeof t.key === 'string' ? t.key.trim().toLowerCase() : '';
  if (key === '' || key === DEFAULT_THEME_KEY) return null;
  const dark = colourOf(t.dark);
  const mid = colourOf(t.mid);
  const accent = colourOf(t.accent);
  return dark && mid && accent ? { key, dark, mid, accent } : null;
}

function colourOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const c = value.trim();
  if (!HEX.test(c)) return null;
  // #RGB as #RRGGBB: the apps add alpha suffixes to some colours.
  return (c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c).toUpperCase();
}

function logoOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  return ABSOLUTE.test(url) ? url : null;
}

/**
 * One app's branding: the kept answer at start ({@link load}), then the server's ({@link refresh}). Components follow
 * it through {@link subscribe} (see AppBrandingProvider / useAppBranding).
 */
export class AppBranding {
  private state: BrandingState = NO_BRANDING;
  private listeners = new Set<() => void>();
  private revision = 0;

  constructor(
    private readonly store: KeyValueStore | null,
    readonly app: BrandingAppName,
  ) {}

  /** Reads the last good answer kept on the phone (nothing kept, or unreadable: today's look). */
  async load(): Promise<void> {
    try {
      const kept = normalizeBranding(this.store ? await this.store.get<BrandingState>(CACHE_KEY) : null);
      if (kept) this.take(kept);
    } catch {
      // a damaged row: today's look until the server answers
    }
  }

  /** Asks the server; a good answer replaces the kept one. Any failure keeps what is there, without a message. */
  async refresh(fetchBranding: () => Promise<unknown>): Promise<boolean> {
    try {
      const next = normalizeBranding(await fetchBranding());
      if (!next) return false;
      this.take(next);
      await this.store?.set(CACHE_KEY, next);
      return true;
    } catch {
      return false;
    }
  }

  get current(): BrandingState {
    return this.state;
  }

  get theme(): BrandTheme | null {
    return this.state.theme;
  }

  get logoUrl(): string | null {
    return this.state.logoUrl;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getRevision(): number {
    return this.revision;
  }

  private take(next: BrandingState) {
    // The same answer again (every start) draws nothing again.
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    this.revision++;
    for (const l of this.listeners) l();
  }
}
