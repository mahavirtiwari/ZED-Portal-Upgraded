import type { KeyValueStore } from '../db/keyValueStore';

/** One text of `Content/Texts` (docs/mobile/APP-TEXTS.md). */
export type AppText = { key: string; enabled: boolean; html: string };

export type AppTextsResponse = { status?: string | null; errorMessage?: string | null; texts?: AppText[] | null };

/** A text ready to show: `null` when the Admin switched it off. */
export type ResolvedText = { html: string; fromServer: boolean } | null;

const CACHE_KEY = 'content.texts';

/** HTML-encodes a value put into a `{{Field}}` placeholder (`&`, `<`, `>`, `"`, `'`). */
export function htmlEncode(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Fills `{{Field}}` placeholders, HTML-encoded; an unknown field becomes empty. */
export function fillPlaceholders(html: string, fields?: Record<string, string | number | null | undefined>): string {
  return html.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, name: string) => {
    const v = fields?.[name];
    return v == null ? '' : htmlEncode(String(v));
  });
}

/**
 * New in V4: the apps' disclaimers, instructions, undertakings and confirmation texts as the Admin set them
 * (Admin → Texts). Loaded at start and after login, the last answer kept for offline use; the app's built-in wording
 * (the legacy text) is used when there is no answer yet, a key is missing, or the call failed.
 */
export class AppTexts {
  private server = new Map<string, AppText>();
  private listeners = new Set<() => void>();
  private revision = 0;

  /** @param builtIn the app's own wording by key (simple HTML or plain text). */
  constructor(
    private readonly store: KeyValueStore | null,
    private readonly builtIn: Readonly<Record<string, string>>,
  ) {}

  /** Reads the last answer kept on the phone. */
  async load(): Promise<void> {
    const cached = this.store ? await this.store.get<AppText[]>(CACHE_KEY) : null;
    if (cached) this.take(cached);
  }

  /** Asks the server; on success the answer replaces the kept one. Failures keep what is there (no message). */
  async refresh(fetchTexts: () => Promise<AppTextsResponse>): Promise<boolean> {
    try {
      const r = await fetchTexts();
      if (r.status !== '1' || !Array.isArray(r.texts)) return false;
      const texts = r.texts.filter(t => t && typeof t.key === 'string');
      this.take(texts);
      await this.store?.set(CACHE_KEY, texts);
      return true;
    } catch {
      return false;
    }
  }

  /** The text to show for a key, placeholders filled. */
  get(key: string, fields?: Record<string, string | number | null | undefined>): ResolvedText {
    const t = this.server.get(key);
    if (t) {
      if (t.enabled === false) return null;
      if (typeof t.html === 'string' && t.html.trim() !== '') return { html: fillPlaceholders(t.html, fields), fromServer: true };
    }
    const own = this.builtIn[key];
    return own == null ? { html: '', fromServer: false } : { html: fillPlaceholders(own, fields), fromServer: false };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getRevision(): number {
    return this.revision;
  }

  private take(texts: AppText[]) {
    this.server = new Map(texts.map(t => [t.key, t]));
    this.revision++;
    for (const l of this.listeners) l();
  }
}
