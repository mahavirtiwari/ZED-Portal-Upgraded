import { Component, computed, inject } from '@angular/core';
import { PortalLinksService } from '@zed/shared';
import { PORTAL_SYSTEM } from '../portal-system';
import { PORTAL_LABELS } from '../portal-labels';
import { PublicLevels } from '../msme/shared/levels';

/**
 * Frame of the staff sign-in pages (login, forgot password, set a new password). 2026-11-08 redesign (option A, approved):
 * the whole screen in two halves — a teal half (the ministry's white logo, the ZED mark, the portal, its levels and what
 * it is for) and a white half with the page's form, the ZED logo above it and a one-line footer under it. No separate
 * header bar. On a phone the teal half becomes a short band above the form.
 * 2026-11-13 (design 1, approved): the form in a card — a teal top edge, who signs in here, and a secure sign-in line.
 */
@Component({
  selector: 'zed-staff-login-shell',
  host: { class: 'zed-login d-block' },
  template: `
    <div class="zl-page">
      <aside class="zl-hero" aria-label="About the portal">
        <span class="ring ring-1" aria-hidden="true"></span>
        <span class="ring ring-2" aria-hidden="true"></span>
        <div class="zl-ministry">
          @if (links.url('ministry'); as u) {
            <a [href]="u" target="_blank" rel="noopener"><img src="Images/header/ministry-white.png" alt="Ministry of MSME" /></a>
          } @else {
            <img src="Images/header/ministry-white.png" alt="Ministry of MSME" />
          }
        </div>
        <div class="zl-hero-body">
          <div class="brand-mark"><img src="Images/header/zed-logo.png" alt="" /></div>
          <p class="brand-title">Zero Defect Zero Effect</p>
          <p class="brand-sub">{{ portalName }} — staff, agency and assessor portal</p>
          <ul class="brand-points">
            @for (p of points; track p) {
              <li><span class="brand-tick" aria-hidden="true">✓</span>{{ p }}</li>
            }
          </ul>
        </div>
        <div class="brand-levels">
          @for (l of levels(); track l) {
            <span class="brand-chip">{{ l }}</span>
          }
        </div>
      </aside>
      <main class="zl-side">
        <div class="zl-side-top"><img src="Images/header/zed-logo.png" alt="ZED" class="zl-zed" /></div>
        <div class="zl-form">
          <div class="zl-card">
            <span class="zl-tag"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2Zm-7-2a2 2 0 1 1 4 0v2h-4V7Zm2 10.2a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4Z" /></svg>{{ audience }}</span>
            <ng-content />
            <p class="zl-secure"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2Zm-7-2a2 2 0 1 1 4 0v2h-4V7Zm2 10.2a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4Z" /></svg>Secure sign-in for authorised users</p>
          </div>
        </div>
        <footer class="zl-foot">
          <small>ZED © {{ year }} All Rights Reserved</small>
        </footer>
      </main>
    </div>
  `,
  styles: `
    :host { min-height: 100vh; font-family: 'Work Sans', sans-serif; background: #fff; }
    .zl-page { min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); }
    .zl-hero {
      position: relative; overflow: hidden; color: #fff; padding: 28px 44px 36px; display: flex; flex-direction: column;
      background: linear-gradient(160deg, #174a4e 0%, #23656b 48%, #2f8a92 100%);
    }
    .ring { position: absolute; border: 2px solid rgba(255, 255, 255, 0.1); border-radius: 50%; pointer-events: none; }
    .ring-1 { width: 520px; height: 520px; right: -220px; bottom: -240px; }
    .ring-2 { width: 320px; height: 320px; right: -110px; bottom: -130px; }
    /* The ministry's white logo straight on the teal, as the old sign-in page (2026-11-12). */
    .zl-ministry { align-self: flex-start; position: relative; }
    .zl-ministry img { width: 240px; display: block; }
    .zl-hero-body { flex: 1; display: flex; flex-direction: column; justify-content: center; position: relative; padding: 28px 0; }
    .brand-mark { width: 92px; height: 92px; border-radius: 50%; background: #fff; display: flex; align-items: center; justify-content: center; }
    .brand-mark img { width: 74px; }
    .brand-title { font-size: 34px; font-weight: 700; margin: 22px 0 8px; line-height: 1.15; }
    .brand-sub { font-size: 16px; color: #cfe9ec; margin: 0; line-height: 1.5; max-width: 440px; }
    .brand-points { list-style: none; margin: 26px 0 0; padding: 0; font-size: 15px; color: #e4f4f5; }
    .brand-points li { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
    .brand-tick {
      width: 24px; height: 24px; border-radius: 50%; background: rgba(255, 255, 255, 0.16); display: inline-flex;
      align-items: center; justify-content: center; font-size: 12px; flex: none;
    }
    .brand-levels { display: flex; flex-wrap: wrap; gap: 8px; position: relative; }
    .brand-chip {
      font-size: 13px; padding: 4px 14px; border-radius: 14px; background: rgba(255, 255, 255, 0.14);
      border: 1px solid rgba(255, 255, 255, 0.32);
    }
    .zl-side { display: flex; flex-direction: column; padding: 24px 40px 16px; min-width: 0; }
    .zl-side-top { display: flex; justify-content: flex-end; }
    .zl-zed { height: 88px; }
    /* min-width 0: a long sentence (Forgot Password) wraps instead of widening the form. */
    .zl-form { flex: 1; display: flex; flex-direction: column; justify-content: center; width: 100%; max-width: 470px; margin: 0 auto; padding: 24px 0; min-width: 0; }
    .zl-card {
      background: #fff; border: 1px solid #e3ecee; border-top: 4px solid #23656b; border-radius: 16px; padding: 26px 30px 16px;
      box-shadow: 0 18px 40px rgba(23, 74, 78, 0.08); min-width: 0;
    }
    .zl-tag {
      display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 14px;
      background: #d9eef0; color: #174a4e; margin-bottom: 14px;
    }
    .zl-tag svg, .zl-secure svg { width: 13px; height: 13px; fill: currentColor; flex: none; }
    .zl-secure {
      display: flex; align-items: center; gap: 8px; margin: 20px 0 0; padding-top: 12px; border-top: 1px solid #e3ecee;
      font-size: 12.5px; color: #6b7a7c;
    }
    .zl-foot {
      display: flex; justify-content: space-between; align-items: center; gap: 12px; border-top: 1px solid #e3ecee;
      padding-top: 12px; color: #6b7a7c; background: none; /* legacy-login paints footers dark */
    }
    @media (max-width: 900px) {
      .zl-page { grid-template-columns: 1fr; }
      .zl-hero { padding: 16px 20px 18px; }
      .ring { display: none; }
      .zl-ministry img { width: 160px; }
      .zl-hero-body { padding: 14px 0 12px; flex-direction: row; align-items: center; gap: 14px; flex-wrap: wrap; }
      .brand-mark { width: 52px; height: 52px; }
      .brand-mark img { width: 42px; }
      .brand-title { font-size: 21px; margin: 0; flex: 1; }
      .brand-sub, .brand-points { display: none; }
      .zl-side { padding: 8px 20px 14px; }
      .zl-side-top { display: none; }
      .zl-form { padding: 16px 0 20px; }
      .zl-card { padding: 20px 18px 12px; box-shadow: none; }
    }
  `,
})
export class StaffLoginShell {
  /** Links to pages outside the portal, as the Admin set them (Admin → Links). */
  protected readonly links = inject(PortalLinksService);
  protected readonly year = new Date().getFullYear();
  protected readonly portalName = PORTAL_LABELS.portalName;
  /** Who signs in here (the card's tag). */
  protected readonly audience = PORTAL_SYSTEM === 'consultancy' ? 'Staff · Organisation · Consultant' : 'Staff · Agency · Assessor';
  private readonly publicLevels = inject(PublicLevels);
  /** Consultancy: handholding of Silver and Gold; otherwise the enabled levels as the Admin named them. */
  protected readonly levels = computed(() =>
    PORTAL_SYSTEM === 'consultancy' ? ['Silver', 'Gold'] : (this.publicLevels.names() ?? ['Bronze', 'Silver', 'Gold', 'ZED-X']));
  protected readonly points =
    PORTAL_SYSTEM === 'consultancy'
      ? ['Handholding milestones and reviews', 'Dashboards and reports', 'Secure sign-in for authorised users']
      : PORTAL_SYSTEM === 'surveillance'
        ? ['Surveillance assessments', 'Dashboards and reports', 'Secure sign-in for authorised users']
        : ['Desktop and site assessments', 'Dashboards and reports', 'Secure sign-in for authorised users'];
}
