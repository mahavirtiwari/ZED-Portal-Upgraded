import { Component, computed, inject } from '@angular/core';
import { PortalLinksService } from '@zed/shared';
import { BrandingService } from '../../branding';
import { PublicLevels } from '../shared/levels';
import { ContentTextComponent } from '../../content/content-text';

/** The live portal's banner (Banner_20220428033601.png, resized); no longer shown on the login pages since 2026-11-14. */
export const DEFAULT_BANNER = '/Images/HomePage/default-banner.webp';

/**
 * Frame of the MSME login pages (login, forgot password, reset password).
 * 2026-11-14 redesign (approved; the picture removed): as the staff sign-in — a light hero on the left (the ministry and ZED
 * logos, who it is for, the scheme, how it works in four steps, the enabled levels with their badges and the ZED MSME app
 * links) and on the right the page's form in a card, "Need help?" above it and a one-line footer. On a phone the hero
 * becomes a short band above the form.
 */
@Component({
  selector: 'zed-login-shell',
  imports: [ContentTextComponent],
  host: { class: 'zed-login d-block' },
  template: `
    <div class="ml-page">
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
          <!-- 2026-11-15 (the user): every text here is the Admin's (Administration → Texts, "MSME: Registration"); the words
               below are the defaults until the Admin changes them. -->
          <p class="ml-kicker"><zed-text key="msme.login.hero.kicker" [inline]="true">For manufacturing and service MSMEs</zed-text></p>
          <p class="ml-title"><zed-text key="msme.login.hero.title" [inline]="true">MSME Sustainable (ZED) Certification</zed-text></p>
          <span class="ml-rule" aria-hidden="true"></span>
          <p class="ml-sub"><zed-text key="msme.login.hero.subtitle" [inline]="true">Raise your quality and sustainability, get certified and unlock incentives.</zed-text></p>

          <p class="ml-label"><zed-text key="msme.login.hero.stepsHeading" [inline]="true">How it works</zed-text></p>
          <ol class="ml-steps">
            @for (s of steps; track s.title; let i = $index) {
              <li>
                <span class="ml-no">{{ i + 1 }}</span>
                <strong><zed-text [key]="'msme.login.hero.step' + (i + 1) + '.title'" [inline]="true">{{ s.title }}</zed-text></strong>
                <small><zed-text [key]="'msme.login.hero.step' + (i + 1) + '.text'" [inline]="true">{{ s.text }}</zed-text></small>
              </li>
            }
          </ol>

          <p class="ml-label"><zed-text key="msme.login.hero.levelsHeading" [inline]="true">Certification levels</zed-text></p>
          <ul class="ml-levels">
            @for (l of levels(); track l.name) {
              <li class="ml-level">
                @if (l.logoUrl) { <img [src]="l.logoUrl" alt="" /> } @else { <span class="ml-level-dot" aria-hidden="true"></span> }
                <span>{{ l.name }}</span>
              </li>
            }
          </ul>

        </div>
        <!-- 2026-11-15 (the user): the copyright at the bottom of the left column. -->
        <footer class="ml-footer ml-foot-wide">
          <small>ZED © {{ year }} All Rights Reserved</small>
        </footer>
      </aside>
      <main class="ml-side">
        <div class="ml-side-top">
          @if (links.url('contact'); as c) {
            <a class="ml-help" [href]="c" target="_blank" rel="noopener">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 17h-2v-2h2v2Zm2.1-7.7-.9.9c-.7.7-1.2 1.3-1.2 2.8h-2v-.5c0-1.1.4-2.1 1.2-2.8l1.2-1.3a1.9 1.9 0 0 0 .6-1.4 2 2 0 0 0-4 0H8a4 4 0 0 1 8 0 3.2 3.2 0 0 1-.9 2.3Z" /></svg>
              Need help?
            </a>
          }
        </div>
        <section class="ml-card">
          <ng-content />
        </section>
        <footer class="ml-footer ml-foot-phone">
          <small>ZED © {{ year }} All Rights Reserved</small>
        </footer>
      </main>
    </div>
  `,
  styles: `
    :host { font-family: 'Work Sans', sans-serif; background: #fff; }
    .ml-page { min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); }
    .ml-hero {
      padding: 24px 44px 28px; display: flex; flex-direction: column; min-width: 0; border-right: 1px solid #e3ecee;
      background-color: #f1f8f8; background-image: radial-gradient(#d3e6e8 1px, transparent 1px); background-size: 22px 22px;
    }
    .ml-logos { display: flex; align-items: center; gap: 18px; padding-bottom: 16px; border-bottom: 1px solid #d9e7e8; }
    /* 2026-11-15 (the user): bigger logos. */
    .ml-ministry { height: 84px; display: block; }
    .ml-zed { height: 76px; display: block; margin-left: auto; }
    .ml-hero-body { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 20px 0 4px; }
    .ml-kicker { font-size: 12px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: #23656b; margin: 0 0 8px; }
    .ml-title { font-size: 34px; font-weight: 700; color: #16302f; line-height: 1.15; margin: 0; }
    .ml-rule { display: block; width: 56px; height: 4px; border-radius: 2px; background: #23656b; margin: 14px 0; }
    .ml-sub { font-size: 15.5px; color: #4f6062; line-height: 1.6; margin: 0 0 20px; }
    .ml-label { font-size: 11.5px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: #5f6f70; margin: 4px 0 10px; }
    .ml-steps { list-style: none; padding: 0; margin: 0 0 20px; display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 10px; }
    .ml-steps li { background: #fff; border: 1px solid #dbe8e9; border-radius: 10px; padding: 12px 14px; }
    .ml-steps strong { display: block; font-size: 14px; color: #1d2b2c; margin-top: 6px; }
    .ml-steps small { display: block; font-size: 12.5px; color: #5f6f70; line-height: 1.4; }
    .ml-no { width: 24px; height: 24px; border-radius: 50%; background: #23656b; color: #fff; font-size: 12px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
    .ml-levels { list-style: none; padding: 0; margin: 0 0 20px; display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 10px; }
    .ml-level { display: flex; align-items: center; gap: 10px; background: #fff; border: 1px solid #dbe8e9; border-radius: 10px; padding: 10px 14px; font-weight: 700; color: #1d2b2c; font-size: 14px; }
    .ml-level img { width: 32px; height: 32px; object-fit: contain; flex: none; }
    .ml-level-dot { width: 28px; height: 28px; border-radius: 50%; background: #d9eef0; flex: none; }
    .ml-side { display: flex; flex-direction: column; padding: 24px 40px 12px; min-width: 0; }
    .ml-side-top { display: flex; justify-content: flex-end; min-height: 32px; }
    .ml-help { display: inline-flex; align-items: center; gap: 6px; color: #23656b; font-weight: 600; font-size: 14px; text-decoration: none; }
    .ml-help svg { width: 16px; height: 16px; fill: currentColor; }
    .ml-card { flex: 1; display: flex; flex-direction: column; justify-content: center; width: 100%; max-width: 440px; margin: 0 auto; padding: 16px 0; min-width: 0; }
    .ml-footer {
      display: flex; justify-content: center; align-items: center; gap: 12px; border-top: 1px solid #e3ecee;
      padding-top: 10px; color: #6b7a7c; background: none; /* legacy-login paints footers dark */
    }
    .ml-foot-wide { justify-content: flex-start; border-top-color: #d9e7e8; margin-top: 16px; }
    .ml-foot-phone { display: none; }
    @media (max-width: 900px) {
      .ml-foot-wide { display: none; }
      .ml-foot-phone { display: flex; }
      .ml-page { grid-template-columns: 1fr; }
      .ml-hero { padding: 14px 20px 16px; border-right: 0; border-bottom: 1px solid #e3ecee; }
      .ml-ministry { height: 40px; }
      .ml-zed { height: 42px; }
      .ml-hero-body { padding: 12px 0 0; }
      .ml-title { font-size: 21px; }
      .ml-rule, .ml-sub, .ml-label, .ml-steps, .ml-levels { display: none; }
      .ml-side { padding: 8px 20px 14px; }
      .ml-card { padding: 14px 0 20px; }
    }
  `,
})
export class LoginShell {
  /** Links to pages outside the portal, as the Admin set them (Admin → Links). */
  protected readonly links = inject(PortalLinksService);
  /** 2026-11-15: the Admin's logos (Branding); today's files when none is saved. */
  protected readonly brand = inject(BrandingService);
  protected readonly year = new Date().getFullYear();
  protected readonly steps = [
    { title: 'Register', text: 'With your Udyam number' },
    { title: 'Apply', text: 'Choose a level and pay' },
    { title: 'Assessment', text: 'Your documents, then a visit' },
    { title: 'Certificate', text: 'And the incentives it unlocks' },
  ];
  /** The enabled levels as the Admin named them, with their badges (Certification Levels; built-in until they arrive). */
  private readonly publicLevels = inject(PublicLevels);
  protected readonly levels = computed(() => {
    const all = this.publicLevels.levels() ?? [];
    return all.length
      ? all.map((l) => ({ name: l.name, logoUrl: l.logoUrl }))
      : ['Bronze', 'Silver', 'Gold', 'ZED-X'].map((name) => ({ name, logoUrl: null as string | null }));
  });
}
