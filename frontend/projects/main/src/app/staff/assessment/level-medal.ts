import { Component, computed, input } from '@angular/core';
import { canonicalLevelCode, levelName } from '../../msme/shared/levels';

/**
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): a level as the designs show it in the lists (staff-08, staff-11,
 * staff-12): a 22px medal (Bronze copper, Silver grey, Gold, ZED-X teal; other levels teal-green) and the level name at 13.5/700,
 * in place of the tinted text tag.
 */
@Component({
  selector: 'zed-level-medal',
  host: { class: 'lm' },
  // 2026-11-21 (Assessment Agency UI audit, item 10): the medal's "Z" is drawn by the style sheet, so neither the page's text nor
  // the accessibility tree reads "Z Silver"; the medal itself is aria-hidden.
  // 2026-11-22 (the product owner: "remove the highlighted icon from all the pages in all module"): the level name only, no medal.
  template: `@if (name()) {<span class="lm-name" [attr.data-level]="code()">{{ name() }}</span>}`,
  styles: `
    :host { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
    .lm-name { font-size: 13.5px; font-weight: 700; color: #17373b; }
  `,
})
export class LevelMedal {
  /** The level code or name as the list sends it ("Bronze", "ZEDX", "Silver Surveillance"...). */
  readonly level = input<string | null | undefined>('');

  protected readonly code = computed(() => (canonicalLevelCode(this.level()) ?? String(this.level() ?? '')).toLowerCase().replace(/[^a-z]/g, ''));
  protected readonly name = computed(() => (this.level() ? levelName(String(this.level())) : ''));
}
