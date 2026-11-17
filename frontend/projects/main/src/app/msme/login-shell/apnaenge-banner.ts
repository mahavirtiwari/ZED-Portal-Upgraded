import { Component } from '@angular/core';
import { ContentTextComponent } from '../../content/content-text';

export const MOTTO_KEY = 'msme.login.hero.taglineText';
export const MOTTO_DEFAULT = 'Zero Defect, Zero Effect — better quality, less waste, more business.';

/**
 * The line under "Apnaenge ZED!" split for the banner: "Zero Defect, Zero Effect — better quality, …" gives the chips
 * "Zero Defect", "Zero Effect" and the text after the dash. A line without a dash (the Admin may write anything) is shown
 * whole, with no chips.
 */
export function mottoParts(html: string): { chips: string[]; rest: string } {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const m = /^(.{3,60}?)(?:\s*[—–:]\s+|\s+-\s+)(.+)$/.exec(text);
  if (!m) return { chips: [], rest: text };
  const chips = m[1].split(',').map((c) => c.trim()).filter((c) => c.length > 0);
  return chips.length >= 1 && chips.length <= 3 ? { chips, rest: m[2].trim() } : { chips: [], rest: text };
}

/**
 * 2026-11-17 (the user chose option B): the "Apnaenge ZED!" banner of the login pages.
 * 2026-11-18 (the user: "make it like" the earlier page): a dark teal band across the whole left column with a yellow
 * underline, and "Apnaenge ZED!" large and centred in the old banner's lettering (Segoe Print, Kalam where it is not
 * installed). The text stays the Admin's (Administration → Texts, "MSME: Registration"); the line under it
 * (msme.login.hero.taglineText) is no longer shown here.
 */
@Component({
  selector: 'zed-apnaenge-banner',
  imports: [ContentTextComponent],
  host: { class: 'ab', 'data-apnaenge': '' },
  template: `<p class="ab-tag"><zed-text key="msme.login.hero.tagline" [inline]="true">Apnaenge ZED!</zed-text></p>`,
  styles: `
    :host { display: block; margin: 0 -48px; padding: 16px 24px 14px; background: var(--zt-dark, #1f5c61); border-bottom: 6px solid #f2c230;
      color: #fff; text-align: center; }
    .ab-tag { margin: 0; font-family: 'Segoe Print', 'Kalam', cursive; font-size: 40px; font-weight: 700; line-height: 1.25; letter-spacing: 0.5px; }
    @media (min-width: 901px) and (max-height: 900px) {
      :host { padding: 10px 24px 8px; }
      .ab-tag { font-size: 34px; }
    }
    @media (max-width: 900px) {
      :host { margin: 10px -20px 0; padding: 8px 16px 6px; border-bottom-width: 4px; }
      .ab-tag { font-size: 26px; }
    }
  `,
})
export class ApnaengeBanner {}
