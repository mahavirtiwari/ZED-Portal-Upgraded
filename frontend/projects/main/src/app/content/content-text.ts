import { HttpClient } from '@angular/common/http';
import { Component, Injectable, computed, inject, input, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface ContentText {
  key: string;
  enabled: boolean;
  html: string;
}

/** Replaces the {{Field}} placeholders of a text with HTML-encoded values; unknown ones become empty. */
export function fillText(html: string, values: Record<string, unknown>): string {
  const encode = (v: unknown) =>
    String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const lower = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
  return html.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (_, name: string) => encode(lower.get(name.toLowerCase())));
}

/**
 * The inner HTML of each <tag> element of a text (e.g. the <p> lines of the pledge, the <li> items of a list) for a
 * page that lays them out itself (not nested); the whole text as one part when it has none.
 */
export function textParts(html: string, tag: 'p' | 'li'): string[] {
  const element = tag === 'p' ? /<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi : /<li(?:\s[^>]*)?>([\s\S]*?)<\/li>/gi;
  const parts = [...html.matchAll(element)].map((m) => m[1].trim()).filter((p) => p);
  return parts.length ? parts : html.trim() ? [html.trim()] : [];
}

/**
 * The Admin's Texts (Admin → Texts, new in V4): the disclaimers, instructions, undertakings and pledges of this portal,
 * loaded once per visit from api/content. Until they arrive, or when they cannot, pages show their own copy.
 */
@Injectable({ providedIn: 'root' })
export class ContentService {
  private readonly http = inject(HttpClient);
  private readonly texts = signal<ReadonlyMap<string, ContentText> | null>(null);
  private loading: Promise<void> | null = null;

  /** The text for <paramref name="key"/>; null while loading, on failure, and for a key the server does not know. */
  text(key: string): ContentText | null {
    void this.load();
    return this.texts()?.get(key) ?? null;
  }

  private load(): Promise<void> {
    this.loading ??= firstValueFrom(this.http.get<ContentText[]>('/api/content'))
      .then((list) => this.texts.set(new Map(list.map((t) => [t.key, t]))))
      .catch(() => this.texts.set(new Map()));
    return this.loading;
  }
}

/**
 * One editable text: <c>&lt;zed-text key="msme.payment.disclaimer" [values]="{ Fee: fee() }" /&gt;</c>. Shows the
 * Admin's version or the standard one (ContentCatalogue, with the fields filled in), nothing when the Admin hid it, and
 * the projected content (if any) until the texts are loaded or when they cannot be. The HTML goes through Angular's
 * sanitizer. The key is rendered as data-key (for the specs).
 */
@Component({
  selector: 'zed-text',
  host: { '[attr.data-key]': 'key()' },
  template: `
    @if (text(); as t) {
      @if (t.enabled) {
        @if (inline()) { <span [innerHTML]="html()"></span> } @else { <div [class]="box() ? 'zed-text ' + box() : 'zed-text'" [innerHTML]="html()"></div> }
      }
    } @else {
      <ng-content />
    }
  `,
  styles: `:host { display: contents; } .zed-text > :last-child { margin-bottom: 0; }`,
})
export class ContentTextComponent {
  private readonly content = inject(ContentService);

  readonly key = input.required<string>();
  readonly values = input<Record<string, unknown>>({});
  /** Inside a label or a sentence. */
  readonly inline = input(false);
  /** Classes of the box the text is shown in (e.g. "alert alert-warning"): no empty box when the text is hidden. */
  readonly box = input('');

  protected readonly text = computed(() => this.content.text(this.key()));
  protected readonly html = computed(() => fillText(this.text()?.html ?? '', this.values()));
}
