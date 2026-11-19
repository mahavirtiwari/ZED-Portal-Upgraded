import { Pipe, PipeTransform, signal } from '@angular/core';

/**
 * Page wording the Admin can change (2026-11-19, the user: "All page wording" — Administration → Texts → Page wording).
 * Every heading, line, button, label, placeholder, empty-state and message of a page is written once, in the page, as its
 * standard wording with a key:
 *
 *   template:   {{ 'Assessment Agencies' | t: 'staff.agencies.title' }}
 *   attribute:  [placeholder]="'Search agencies' | t: 'staff.agencies.search.placeholder'"
 *   values:     {{ 'Showing {from} to {to}' | t: 'staff.agencies.showing' : { from: a, to: b } }}
 *   code:       t('staff.agencies.toast.blocked', '{name} blocked', { name })
 *
 * The keys and standard wording are collected by frontend/tools/extract-texts.mjs into the catalogue the Admin page lists
 * (backend/src/Zed.Core/Content/PageTexts.json); only the Admin's changed wording comes from the server, in the one
 * api/content answer ContentService loads at the start (no request per text). Until it has arrived, and for a key the
 * Admin did not change, the page's own wording shows. HTML texts (disclaimers, pledges) stay on <zed-text>.
 * Docs: docs/TEXTS-GUIDE.md.
 */

const NONE: ReadonlyMap<string, string> = new Map();

/** The Admin's wording by key (only the changed ones); set once api/content has answered. */
const changed = signal<ReadonlyMap<string, string>>(NONE);

/** ContentService: the Admin's wording from api/content (every text the Admin left switched on). */
export function setPageTexts(list: readonly { key: string; enabled: boolean; html: string }[] | null | undefined): void {
  const map = new Map<string, string>();
  for (const x of list ?? []) if (x?.enabled && typeof x.html === 'string' && x.html) map.set(x.key, x.html);
  changed.set(map.size ? map : NONE);
}

/** The {name} values of a wording; an unknown one stays as written, null / undefined become empty. */
export function fillWords(text: string, values?: Readonly<Record<string, unknown>> | null): string {
  if (!values || text.indexOf('{') < 0) return text;
  return text.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (all, name: string) => (name in values ? String(values[name] ?? '') : all));
}

/**
 * The wording of <paramref name="key"/>: the Admin's, or <paramref name="standard"/> (the page's own), with its {values}.
 * Reads a signal, so a computed() or template using it updates when the Admin's wording arrives. Key and standard
 * wording must be string literals (the extractor reads them); build a sentence with {values}, never by joining pieces.
 */
export function t(key: string, standard: string, values?: Readonly<Record<string, unknown>> | null): string {
  return fillWords(changed().get(key) ?? standard, values);
}

/**
 * {{ 'Standard wording' | t: 'portal.page.key' }} — see t(). Declared impure so that it updates when the Admin's wording
 * arrives after the page was drawn, but it is memoised: it works the wording out again only when the key, the standard
 * wording, the values object (Angular keeps a template object literal the same while its values are) or the Admin's
 * wording change; otherwise each check is one signal read and four comparisons.
 */
@Pipe({ name: 't', pure: false })
export class TextPipe implements PipeTransform {
  private map: ReadonlyMap<string, string> | null = null;
  private key = '';
  private standard = '';
  private values: unknown = undefined;
  private out = '';

  transform(standard: string, key: string, values?: Readonly<Record<string, unknown>> | null): string {
    const map = changed();
    if (map === this.map && key === this.key && standard === this.standard && values === this.values) return this.out;
    this.map = map;
    this.key = key;
    this.standard = standard;
    this.values = values;
    return (this.out = fillWords(map.get(key) ?? standard, values));
  }
}
