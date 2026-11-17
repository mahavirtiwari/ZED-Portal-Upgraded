import { Component, computed, inject } from '@angular/core';
import { ContentService, ContentTextComponent } from '../../content/content-text';

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
 * 2026-11-17 (the user chose option B): the "Apnaenge ZED!" banner of the login pages: a teal-to-green gradient (the old
 * login banner's colours) with a faint ZED gear, the tagline in the old banner's lettering (Segoe Print, Kalam where it is
 * not installed), and "Zero Defect" / "Zero Effect" as chips with the rest of the line. Both texts stay the Admin's
 * (Administration → Texts, "MSME: Registration").
 */
@Component({
  selector: 'zed-apnaenge-banner',
  imports: [ContentTextComponent],
  host: { class: 'ab', 'data-apnaenge': '' },
  template: `
    <svg class="ab-gear" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5L19.4 13Z" />
      <circle cx="13" cy="12" r="3.4" />
    </svg>
    <p class="ab-tag"><zed-text key="msme.login.hero.tagline" [inline]="true">Apnaenge ZED!</zed-text></p>
    @if (motto(); as m) {
      <p class="ab-line">
        @for (c of m.chips; track c) { <span class="ab-chip">{{ c }}</span> }
        <span class="ab-rest">{{ m.rest }}</span>
      </p>
    }
  `,
  styles: `
    :host { position: relative; display: block; overflow: hidden; border-radius: 14px; padding: 18px 24px 18px;
      background: linear-gradient(110deg, var(--zt-dark, #1f5c61) 0%, var(--zt-mid2, #2a8a8c) 55%, #7cc58f 100%); color: #fff; }
    .ab-gear { position: absolute; right: -10px; top: -30px; width: 160px; height: 160px; fill: none; stroke: #fff; stroke-width: 1.1;
      stroke-linejoin: round; opacity: 0.25; pointer-events: none; }
    p { margin: 0; position: relative; }
    .ab-tag { font-family: 'Segoe Print', 'Kalam', cursive; font-size: 30px; font-weight: 700; line-height: 1.25; letter-spacing: 0.3px; }
    .ab-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; font-size: 13.5px; color: #eef6f4; }
    .ab-chip { background: rgb(255 255 255 / 18%); color: #fff; font-weight: 600; font-size: 12.5px; padding: 4px 12px; border-radius: 20px; }
    @media (min-width: 901px) and (max-height: 900px) {
      :host { padding: 12px 22px; }
      .ab-tag { font-size: 25px; }
      .ab-line { margin-top: 4px; font-size: 13px; }
      .ab-gear { width: 120px; height: 120px; top: -18px; }
    }
    @media (max-width: 900px) {
      :host { padding: 10px 16px; border-radius: 10px; }
      .ab-tag { font-size: 22px; }
      .ab-line { font-size: 12.5px; }
      .ab-gear { width: 100px; height: 100px; }
    }
  `,
})
export class ApnaengeBanner {
  private readonly content = inject(ContentService);
  /** The Admin's line (the standard one until the texts arrive); null when the Admin hid it. */
  protected readonly motto = computed(() => {
    const t = this.content.text(MOTTO_KEY);
    if (t && !t.enabled) return null;
    return mottoParts(t?.html ?? MOTTO_DEFAULT);
  });
}
