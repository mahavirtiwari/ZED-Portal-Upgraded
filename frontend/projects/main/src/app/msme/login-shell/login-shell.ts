import { Component, computed, inject } from '@angular/core';
import { PortalLinksService } from '@zed/shared';
import { BrandingService } from '../../branding';
import { PublicLevels } from '../shared/levels';
import { ContentTextComponent } from '../../content/content-text';

/** The live portal's banner (Banner_20220428033601.png, resized); no longer shown on the login pages since 2026-11-14. */
/** 2026-11-17 (the design): the bar colour of each level by code. */
const LEVEL_COLOURS: Readonly<Record<string, string>> = { BRONZE: '#b0683a', SILVER: '#9aa3a8', GOLD: '#d4a12a', ZEDX: '#3d8fa6' };

export const DEFAULT_BANNER = '/Images/HomePage/default-banner.webp';

/**
 * Frame of the MSME login pages (login, forgot password, reset password).
 * 2026-11-17 (the user's design "ZED Login 3a", approved): flat and square. On the left a light hero — the ministry and ZED
 * logos over a rule, who it is for, the title, "Apnaenge ZED!" in a dark band, the benefits of ZED in a 2 × 2 grid and the
 * enabled levels (coloured bars: Bronze, Silver, Gold numbered; ZED-X, Export, apart). On the right "Need help?" over a
 * rule, the page's form, and the page's [mlBottom] content (New to ZED?) in a light band at the foot. A dark footer band
 * across the page. Every text of the hero is the Admin's (Administration → Texts, "MSME: Registration"). On a phone the
 * hero becomes a short band above the form.
 */
@Component({
  selector: 'zed-login-shell',
  imports: [ContentTextComponent],
  host: { class: 'zed-login d-block' },
  template: `
    <div class="ml-page">
      <div class="ml-cols">
        <aside class="ml-hero" aria-label="About ZED certification">
          <div class="ml-logos">
            @if (links.url('ministry'); as u) {
              <a [href]="u" target="_blank" rel="noopener"><img [src]="brand.logo('login-left', '/Images/header/ministry.png')" alt="Ministry of MSME" class="ml-ministry" /></a>
            } @else {
              <img [src]="brand.logo('login-left', '/Images/header/ministry.png')" alt="Ministry of MSME" class="ml-ministry" />
            }
            <img class="ml-zed" [src]="brand.logo('login-right', '/Images/header/zed-logo.png?ui=1')" alt="ZED" />
          </div>
          <div class="ml-hero-body">
            <p class="ml-kicker"><zed-text key="msme.login.hero.kicker" [inline]="true">For manufacturing and service MSMEs</zed-text></p>
            <p class="ml-title"><zed-text key="msme.login.hero.title" [inline]="true">MSME Sustainable (ZED) Certification</zed-text></p>
            <p class="ml-sub"><zed-text key="msme.login.hero.subtitle" [inline]="true">Raise your quality and sustainability, get certified and unlock incentives.</zed-text></p>

            <div class="ml-banner" data-apnaenge>
              <p class="ml-apna"><zed-text key="msme.login.hero.tagline" [inline]="true">Apnaenge ZED!</zed-text></p>
              <p class="ml-apna-sub"><zed-text key="msme.login.hero.taglineText" [inline]="true">Zero Defect, Zero Effect — better quality, less waste, more business.</zed-text></p>
            </div>

            <p class="ml-label ml-label-rule"><zed-text key="msme.login.hero.benefitsHeading" [inline]="true">Benefits of ZED</zed-text></p>
            <ul class="ml-benefits">
              @for (b of benefits; track b.title; let i = $index) {
                <li>
                  <span class="ml-ic" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      @switch (i) {
                        @case (0) { <line x1="19" x2="5" y1="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /> }
                        @case (1) { <rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" /> }
                        @case (2) { <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /><circle cx="9" cy="7" r="4" /> }
                        @default { <path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7" /><polygon points="12 2 20 7 4 7" /> }
                      }
                    </svg>
                  </span>
                  <span>
                    <strong><zed-text [key]="'msme.login.hero.benefit' + (i + 1) + '.title'" [inline]="true">{{ b.title }}</zed-text></strong>
                    <small><zed-text [key]="'msme.login.hero.benefit' + (i + 1) + '.text'" [inline]="true">{{ b.text }}</zed-text></small>
                  </span>
                </li>
              }
            </ul>

            <p class="ml-label"><zed-text key="msme.login.hero.levelsHeading" [inline]="true">Certification levels</zed-text></p>
            <div class="ml-levels">
              @if (levels().steps.length) {
                <ul class="ml-lv-box">
                  @for (l of levels().steps; track l.name; let i = $index) {
                    <li class="ml-level"><span class="ml-bar" [style.background]="l.color"></span><b>{{ l.name }}</b><small>{{ (i + 1).toString().padStart(2, '0') }}</small></li>
                  }
                </ul>
              }
              @for (l of levels().export; track l.name) {
                <ul class="ml-lv-box ml-lv-x">
                  <li class="ml-level"><span class="ml-bar" [style.background]="l.color"></span><b>{{ l.name }}</b><small>Export</small></li>
                </ul>
              }
            </div>
          </div>
        </aside>
        <main class="ml-side">
          <div class="ml-side-top">
            @if (links.url('contact'); as c) {
              <a class="ml-help" [href]="c" target="_blank" rel="noopener">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" /></svg>
                Need help?
              </a>
            }
          </div>
          <section class="ml-card">
            <ng-content />
          </section>
          <ng-content select="[mlBottom]" />
        </main>
      </div>
      <footer class="ml-footer">
        <small>© {{ year }} Ministry of MSME, Government of India</small>
        <small>Best viewed in the latest Chrome, Edge or Firefox</small>
      </footer>
    </div>
  `,
  styles: `
    :host { font-family: 'Archivo', 'Work Sans', Arial, sans-serif; background: #fff; --ml-line: #cfe0dc; --ml-ink: #1c2b2d; --ml-muted: #4d5f61; }
    p { margin: 0; }
    .ml-page { min-height: 100vh; display: flex; flex-direction: column; }
    .ml-cols { flex: 1; display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 3fr); }
    .ml-hero { display: flex; flex-direction: column; min-width: 0; border-right: 2px solid var(--ml-line); background: color-mix(in srgb, var(--zt-soft, #d4ebe6) 45%, #fff); }
    .ml-logos { display: flex; align-items: center; gap: 18px; padding: 12px 48px; border-bottom: 2px solid var(--ml-line); }
    .ml-ministry { height: 92px; display: block; }
    .ml-zed { height: 88px; display: block; margin-left: auto; }
    .ml-hero-body { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 32px 48px; }
    .ml-kicker, .ml-label { font-size: 12px; font-weight: 600; letter-spacing: 1.2px; text-transform: uppercase; color: var(--ml-muted); }
    .ml-kicker { color: var(--zt-dark, #1f5c61); }
    .ml-title { font-size: clamp(34px, 3.6vw, 50px); font-weight: 800; letter-spacing: -1px; line-height: 1; color: var(--ml-ink); margin: 14px 0 16px; }
    .ml-sub { font-size: 17px; color: var(--ml-muted); line-height: 1.5; }
    .ml-banner { display: flex; align-items: center; background: var(--zt-dark, #1f5c61); margin: 26px 0 36px; min-height: 72px; }
    .ml-apna { flex: none; font-size: 32px; font-weight: 800; letter-spacing: -0.3px; color: #fff; padding: 10px 24px; border-right: 2px solid rgb(255 255 255 / 30%); }
    .ml-apna-sub { font-size: 15px; color: #eef6f4; padding: 10px 24px; line-height: 1.4; }
    .ml-label-rule { padding-bottom: 10px; border-bottom: 2px solid var(--zt-dark, #1f5c61); }
    .ml-benefits { list-style: none; padding: 0; margin: 0 0 40px; display: grid; grid-template-columns: 1fr 1fr; }
    .ml-benefits li { display: flex; gap: 12px; padding: 16px 16px 16px 0; min-width: 0; }
    .ml-benefits li:nth-child(odd) { border-right: 2px solid var(--ml-line); }
    .ml-benefits li:nth-child(even) { padding-left: 20px; }
    .ml-benefits li:nth-child(-n + 2) { border-bottom: 2px solid var(--ml-line); }
    .ml-ic { flex: none; width: 40px; height: 40px; background: var(--zt-soft, #d4ebe6); display: flex; align-items: center; justify-content: center; }
    svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .ml-ic svg { color: var(--zt-dark, #1f5c61); }
    .ml-benefits strong { display: block; font-size: 16px; font-weight: 800; color: var(--ml-ink); }
    .ml-benefits small { display: block; font-size: 13px; color: var(--ml-muted); line-height: 1.4; margin-top: 3px; }
    .ml-levels { display: flex; gap: 24px; margin-top: 12px; }
    .ml-lv-box { list-style: none; margin: 0; padding: 0; display: flex; flex: 3; background: #fff; border: 2px solid var(--ml-line); }
    .ml-lv-x { flex: 1; }
    .ml-level { flex: 1; min-width: 0; padding: 14px 14px 16px; display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px; }
    .ml-level + .ml-level { border-left: 2px solid var(--ml-line); }
    .ml-bar { flex: 0 0 100%; height: 6px; margin-bottom: 20px; }
    .ml-level b { font-size: 16px; font-weight: 800; color: var(--ml-ink); }
    .ml-level small { font-size: 12px; color: var(--ml-muted); }
    .ml-side { display: flex; flex-direction: column; min-width: 0; }
    .ml-side-top { display: flex; justify-content: flex-end; align-items: center; min-height: 116px; padding: 0 56px; border-bottom: 2px solid var(--ml-line); }
    .ml-help { display: inline-flex; align-items: center; gap: 8px; color: var(--zt-dark, #1f5c61); font-weight: 600; font-size: 14px; text-decoration: none; }
    .ml-help svg { width: 16px; height: 16px; }
    .ml-card { flex: 1; display: flex; flex-direction: column; justify-content: center; width: 100%; max-width: 480px; margin: 0 auto; padding: 32px 56px; min-width: 0; }
    .ml-footer { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; background: var(--zt-ink, #173f44); color: #d4ebe6; padding: 18px 48px; }
    .ml-footer small { font-size: 13px; }
    @media (max-width: 900px) {
      .ml-cols { grid-template-columns: 1fr; }
      .ml-hero { border-right: 0; border-bottom: 2px solid var(--ml-line); }
      .ml-logos { padding: 10px 20px; }
      .ml-ministry, .ml-zed { height: 54px; }
      .ml-hero-body { padding: 14px 20px 16px; }
      .ml-title { font-size: 24px; letter-spacing: -0.4px; margin: 6px 0 0; }
      .ml-sub, .ml-label, .ml-benefits, .ml-levels { display: none; }
      .ml-banner { margin: 12px 0 0; min-height: 0; }
      .ml-apna { font-size: 22px; padding: 8px 14px; }
      .ml-apna-sub { font-size: 13px; padding: 8px 14px; }
      .ml-side-top { min-height: 48px; padding: 0 20px; }
      .ml-card { padding: 22px 20px 26px; }
      .ml-footer { padding: 14px 20px; justify-content: center; text-align: center; }
    }
  `,
})
export class LoginShell {
  /** Links to pages outside the portal, as the Admin set them (Admin → Links). */
  protected readonly links = inject(PortalLinksService);
  /** 2026-11-15: the Admin's logos (Branding); today's files when none is saved. */
  protected readonly brand = inject(BrandingService);
  protected readonly year = new Date().getFullYear();
  /** 2026-11-16 (approved option A; 2026-11-17 the design's wording): the defaults until the Admin changes them (Administration → Texts, "MSME: Registration"). */
  protected readonly benefits = [
    { title: 'Up to 80% subsidy', text: 'On certification cost: micro 80%, small 60%, medium 50%' },
    { title: '₹10,000 joining reward', text: 'On Bronze certification' },
    { title: 'Handholding', text: 'Expert support to reach the next level' },
    { title: 'Incentives', text: 'Technology upgradation, state and bank benefits' },
  ];
  /**
   * The enabled levels as the Admin named them (Certification Levels; built-in until they arrive), coloured as the design:
   * the numbered steps (Bronze, Silver, Gold and any other) and ZED-X (Export) apart.
   */
  private readonly publicLevels = inject(PublicLevels);
  protected readonly levels = computed(() => {
    const all = this.publicLevels.levels() ?? [];
    const list = all.length
      ? all.map((l) => ({ code: l.code, name: l.name }))
      : [['Bronze', 'Bronze'], ['Silver', 'Silver'], ['Gold', 'Gold'], ['ZEDX', 'ZED-X']].map(([code, name]) => ({ code, name }));
    const shown = list.map((l) => ({ ...l, color: LEVEL_COLOURS[l.code.toUpperCase()] ?? 'var(--zt-mid2, #2a8a8c)' }));
    return { steps: shown.filter((l) => l.code.toUpperCase() !== 'ZEDX'), export: shown.filter((l) => l.code.toUpperCase() === 'ZEDX') };
  });
}
