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
  template: `@if (name()) {<span class="lm-dot" [class]="'lm-dot lm-' + code()" aria-hidden="true"></span><span class="lm-name">{{ name() }}</span>}`,
  styles: `
    :host { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
    .lm-dot { flex: none; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-size: 11px;
      font-weight: 800; font-style: italic; box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, .55); background: linear-gradient(135deg, #8ad6a4, #2f9aa3 50%, #1f6d73); }
    .lm-dot::before { content: 'Z'; }
    .lm-bronze { background: linear-gradient(135deg, #e9a888, #c9714f 50%, #9c4f2e); }
    .lm-silver { background: linear-gradient(135deg, #dfe2e4, #a5abb0 50%, #7b838a); }
    .lm-gold { background: linear-gradient(135deg, #f0d98a, #c9a23f 50%, #9c7a1d); }
    .lm-zedx { background: linear-gradient(135deg, #7fcbd2, #3c8f99 50%, #24666b); }
    .lm-name { font-size: 13.5px; font-weight: 700; color: #17373b; }
  `,
})
export class LevelMedal {
  /** The level code or name as the list sends it ("Bronze", "ZEDX", "Silver Surveillance"...). */
  readonly level = input<string | null | undefined>('');

  protected readonly code = computed(() => (canonicalLevelCode(this.level()) ?? String(this.level() ?? '')).toLowerCase().replace(/[^a-z]/g, ''));
  protected readonly name = computed(() => (this.level() ? levelName(String(this.level())) : ''));
}
