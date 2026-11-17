import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PortalLinksService } from '@zed/shared';
import { BrandingService } from '../branding';
import { PORTAL_SYSTEM } from '../portal-system';
import { HANDHOLDING_LEVEL_CODES, PublicLevels } from '../msme/shared/levels';
import { ContentTextComponent } from '../content/content-text';
import { loginLevels } from '../msme/login-shell/login-shell';

/**
 * Frame of the staff sign-in pages (login, forgot password, set a new password).
 * 2026-11-17 (approved): the MSME login's frame (the user's design "ZED Login 3a", login-frame.scss): the logos over a rule,
 * the portal's title and purpose, "Apnaenge ZED!", on the main portal the MSME links (MSME login, registration) and the
 * levels as coloured bars; on the right "Need help?", who signs in here and the page's form, "Authorised users only" in the
 * light band at the foot, and the dark footer band. On a phone the hero becomes a short band above the form.
 */
@Component({
  selector: 'zed-staff-login-shell',
  host: { class: 'zed-login d-block' },
  imports: [RouterLink, ContentTextComponent],
  template: `
    <div class="ml-page">
      <div class="ml-cols">
        <aside class="ml-hero" aria-label="About the portal">
          <div class="ml-logos">
            @if (links.url('ministry'); as u) {
              <a [href]="u" target="_blank" rel="noopener"><img [src]="brand.logo('login-left', 'Images/header/ministry.png')" alt="Ministry of MSME" class="ml-ministry" /></a>
            } @else {
              <img [src]="brand.logo('login-left', 'Images/header/ministry.png')" alt="Ministry of MSME" class="ml-ministry" />
            }
            <img [src]="brand.logo('login-right', 'Images/header/zed-logo.png?ui=1')" alt="ZED" class="ml-zed" />
          </div>
          <div class="ml-hero-body">
            <p class="ml-kicker">{{ kicker }}</p>
            <h2 class="ml-title">{{ title }}</h2>
            <p class="ml-sub">{{ lead }}</p>

            <div class="ml-banner" data-apnaenge>
              <p class="ml-apna"><zed-text key="msme.login.hero.tagline" [inline]="true">Apnaenge ZED!</zed-text></p>
              <p class="ml-apna-sub"><zed-text key="msme.login.hero.taglineText" [inline]="true">Zero Defect, Zero Effect — better quality, less waste, more business.</zed-text></p>
            </div>

            @if (msmeLinks) {
              <p class="ml-label ml-label-rule">Are you an MSME?</p>
              <ul class="ml-benefits ml-quick">
                <li>
                  <span class="ml-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" /></svg></span>
                  <a routerLink="/msme/login"><strong>MSME login →</strong><small>Apply for and track your certification</small></a>
                </li>
                <li>
                  <span class="ml-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M2 20h20M4 20V10l5 3V10l5 3V6l6-3v17" /></svg></span>
                  <a routerLink="/msme/register"><strong>Register your enterprise →</strong><small>With your Udyam registration number</small></a>
                </li>
              </ul>
            }

            <p class="ml-label">Certification levels</p>
            <div class="ml-levels">
              @if (levels().steps.length) {
                <ul class="ml-lv-box">
                  @for (l of levels().steps; track l.name) {
                    <li class="ml-level"><span class="ml-lv-name"><img [src]="l.logo" alt="" />{{ l.name }}</span></li>
                  }
                </ul>
              }
              @for (l of levels().export; track l.name) {
                <ul class="ml-lv-box ml-lv-x">
                  <li class="ml-level"><span class="ml-lv-name"><img [src]="l.logo" alt="" />{{ l.name }} (Export)</span></li>
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
            <span class="ml-tag">{{ audience }}</span>
            <ng-content />
          </section>
          <div class="ml-secure">
            <span class="ml-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" /></svg></span>
            <p><strong>Authorised users only</strong><small>Sign-ins are recorded.</small></p>
          </div>
        </main>
      </div>
      <footer class="ml-footer">
        <small>© {{ year }} Ministry of MSME, Government of India</small>
        <small>Best viewed in the latest Chrome, Edge or Firefox</small>
      </footer>
    </div>
  `,
  styleUrl: '../msme/login-shell/login-frame.scss',
  styles: `
    .ml-tag { align-self: flex-start; display: inline-block; font-size: 11.5px; font-weight: 600; padding: 3px 9px; background: var(--zt-soft, #d4ebe6); color: var(--zt-ink, #173f44); margin-bottom: 18px; }
    .ml-quick li { border-bottom: 0 !important; }
    .ml-quick a { text-decoration: none; min-width: 0; }
    .ml-quick a strong { color: var(--zt-dark, #1f5c61); }
    .ml-quick a:hover strong { text-decoration: underline; }
    .ml-secure { display: flex; align-items: center; gap: 14px; background: color-mix(in srgb, var(--zt-soft, #d4ebe6) 45%, #fff); border-top: 2px solid var(--ml-line); padding: 22px 56px 24px; }
    .ml-secure strong { display: block; font-size: 15px; font-weight: 800; color: var(--ml-ink); }
    .ml-secure small { display: block; font-size: 13px; color: var(--ml-muted); }
    @media (max-width: 900px) { .ml-secure { padding: 14px 20px; } }
    @media (min-width: 901px) and (max-height: 900px) { .ml-tag { margin-bottom: 10px; } .ml-secure { padding: 12px 56px 14px; } }
  `,
})
export class StaffLoginShell {
  /** Links to pages outside the portal, as the Admin set them (Admin → Links). */
  protected readonly links = inject(PortalLinksService);
  /** 2026-11-15: the Admin's logos (Branding); today's files when none is saved. */
  protected readonly brand = inject(BrandingService);
  protected readonly year = new Date().getFullYear();
  /** Who signs in here (the card's tag). */
  protected readonly audience = PORTAL_SYSTEM === 'consultancy' ? 'Staff · Organisation · Consultant' : 'Staff · Agency · Assessor';
  protected readonly kicker = PORTAL_SYSTEM === 'consultancy' ? 'Organisation and consultant portal' : PORTAL_SYSTEM === 'surveillance' ? 'Surveillance · agency and assessor portal' : 'Staff, agency and assessor portal';
  protected readonly title = PORTAL_SYSTEM === 'consultancy' ? 'ZED Handholding' : 'MSME Sustainable (ZED) Certification';
  protected readonly lead =
    PORTAL_SYSTEM === 'consultancy'
      ? 'Handholding of MSMEs towards ZED Silver and Gold: milestones, reviews and reports for organisations and consultants.'
      : PORTAL_SYSTEM === 'surveillance'
        ? 'Surveillance of ZED certified MSMEs: assessments, reviews and reports for agencies and assessors.'
        : 'Desktop and site assessments, reviews and reports for the staff, agencies and assessors of ZED.';
  /** MSMEs sign in and register on the main portal. */
  protected readonly msmeLinks = PORTAL_SYSTEM === 'main';
  private readonly publicLevels = inject(PublicLevels);
  /** Consultancy: handholding of Silver, Gold and ZED-X; otherwise the enabled levels as the Admin named them, coloured as the design. */
  protected readonly levels = computed(() => {
    const all = this.publicLevels.levels() ?? [];
    const pick = PORTAL_SYSTEM === 'consultancy' ? all.filter((l) => HANDHOLDING_LEVEL_CODES.includes(l.code)) : all;
    const list = pick.length
      ? pick.map((l) => ({ code: l.code, name: l.name }))
      : (PORTAL_SYSTEM === 'consultancy' ? [['Silver', 'Silver'], ['Gold', 'Gold'], ['ZEDX', 'ZED-X']] : [['Bronze', 'Bronze'], ['Silver', 'Silver'], ['Gold', 'Gold'], ['ZEDX', 'ZED-X']])
          .map(([code, name]) => ({ code, name }));
    return loginLevels(list);
  });
}
