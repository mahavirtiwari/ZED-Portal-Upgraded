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
 * loaded once per visit from api/content. Until they arrive, or when they cannot, pages show their own copy. A failed
 * load is not repeated by itself (no request per page render): retry() asks again ("Try again" of a required text).
 */
@Injectable({ providedIn: 'root' })
export class ContentService {
  private readonly http = inject(HttpClient);
  private readonly texts = signal<ReadonlyMap<string, ContentText> | null>(null);
  private readonly loadFailed = signal(false);
  private loading: Promise<void> | null = null;

  /** True once the texts have arrived. */
  readonly loaded = computed(() => this.texts() !== null);
  /** True when the texts could not be loaded (until retry() is pressed). */
  readonly failed = this.loadFailed.asReadonly();

  /** The text for <paramref name="key"/>; null while loading, on failure, and for a key the server does not know. */
  text(key: string): ContentText | null {
    void this.load();
    return this.texts()?.get(key) ?? null;
  }

  /** Loads the texts again after a failure. */
  retry(): void {
    if (!this.loadFailed()) return;
    this.loadFailed.set(false);
    this.loading = null;
    void this.load();
  }

  private load(): Promise<void> {
    this.loading ??= firstValueFrom(this.http.get<ContentText[]>('/api/content'))
      .then((list) => this.texts.set(new Map(list.map((t) => [t.key, t]))))
      .catch(() => this.loadFailed.set(true));
    return this.loading;
  }
}

/**
 * One editable text: <c>&lt;zed-text key="msme.payment.disclaimer" [values]="{ Fee: fee() }" /&gt;</c>. Shows the
 * Admin's version or the standard one (ContentCatalogue, with the fields filled in), nothing when the Admin hid it, and
 * the projected content (if any) until the texts are loaded or when they cannot be. A required text (one the user must
 * read before going on: a disclaimer, the payment instructions) shows "This text could not be loaded. Try again" when
 * the texts cannot be loaded. The HTML goes through Angular's sanitizer. The key is rendered as data-key (for the specs).
 */
@Component({
  selector: 'zed-text',
  host: { '[attr.data-key]': 'key()' },
  template: `
    @if (text(); as t) {
      @if (t.enabled) {
        @if (inline()) { <span [innerHTML]="html()"></span> } @else { <div [class]="box() ? 'zed-text ' + box() : 'zed-text'" [innerHTML]="html()"></div> }
      }
    } @else if (required() && failed()) {
      <div class="alert alert-warning zed-text-failed" role="alert">
        This text could not be loaded. <button type="button" class="btn btn-link zed-text-retry" (click)="retry()">Try again</button>
      </div>
    } @else {
      <ng-content />
    }
  `,
  styles: `:host { display: contents; } .zed-text > :last-child { margin-bottom: 0; }
    .zed-text-retry { padding: 0; vertical-align: baseline; border: 0; }`,
})
export class ContentTextComponent {
  private readonly content = inject(ContentService);

  readonly key = input.required<string>();
  readonly values = input<Record<string, unknown>>({});
  /** Inside a label or a sentence. */
  readonly inline = input(false);
  /** Classes of the box the text is shown in (e.g. "alert alert-warning"): no empty box when the text is hidden. */
  readonly box = input('');
  /** The user must read it before going on: a message with "Try again" when it cannot be loaded. */
  readonly required = input(false);

  protected readonly text = computed(() => this.content.text(this.key()));
  protected readonly failed = this.content.failed;
  protected retry(): void {
    this.content.retry();
  }
  protected readonly html = computed(() => fillText(this.text()?.html ?? '', this.values()));
}
