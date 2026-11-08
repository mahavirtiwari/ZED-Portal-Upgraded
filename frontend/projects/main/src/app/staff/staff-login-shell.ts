import { Component, computed, inject } from '@angular/core';
import { PortalLinksService } from '@zed/shared';
import { PORTAL_SYSTEM } from '../portal-system';
import { PORTAL_LABELS } from '../portal-labels';
import { PublicLevels } from '../msme/shared/levels';

/**
 * Frame of the staff sign-in pages (login, forgot password, set a new password). 2026-11-07 redesign (approved): a white
 * ministry bar, a teal brand panel (ZED mark, tagline, the portal, its levels and what it is for) beside the sign-in card,
 * and the footer. On a phone the brand panel becomes a short strip above the card. The page puts its form inside.
 */
@Component({
  selector: 'zed-staff-login-shell',
  host: { class: 'zed-login d-block' },
  template: `
    <div class="main-container">
      <header class="login-top">
        @if (links.url('ministry'); as u) {
          <a [href]="u" target="_blank" rel="noopener"><img src="Images/header/ministry.png" alt="Ministry of MSME" class="logo-ministry" /></a>
        } @else {
          <img src="Images/header/ministry.png" alt="Ministry of MSME" class="logo-ministry" />
        }
        <img src="Images/header/zed-logo.png" alt="ZED" class="logo-zed-top" />
      </header>
      <main class="login-user-block">
        <section class="login-section">
          <aside class="brand-panel" aria-label="About the portal">
            <span class="ring ring-1" aria-hidden="true"></span>
            <span class="ring ring-2" aria-hidden="true"></span>
            <div class="brand-mark"><img src="Images/header/zed-logo.png" alt="" /></div>
            <p class="brand-title">Zero Defect Zero Effect</p>
            <p class="brand-sub">{{ portalName }} — staff, agency and assessor portal</p>
            <div class="brand-levels">
              @for (l of levels(); track l) {
                <span class="brand-chip">{{ l }}</span>
              }
            </div>
            <ul class="brand-points">
              @for (p of points; track p) {
                <li><span class="brand-tick" aria-hidden="true">✓</span>{{ p }}</li>
              }
            </ul>
          </aside>
          <div class="login-inner-block"><ng-content /></div>
        </section>
      </main>
      <footer>
        <div class="footer">
          <div><small>ZED © {{ year }} All Rights Reserved</small></div>
          <div><img src="Images/footer/footer-icon.png" alt="QCI" /></div>
          <div><small>Version: 4.0.0</small></div>
        </div>
      </footer>
    </div>
  `,
  styles: `
    :host { background-color: #f3f8f8; min-height: 100vh; font-family: 'Work Sans', sans-serif; }
    .main-container { min-height: 100vh; display: flex; flex-direction: column; }
    .login-top {
      display: flex; justify-content: space-between; align-items: center; background: #fff; padding: 10px 24px;
      border-bottom: 3px solid #45a5ad;
    }
    .logo-ministry { width: 230px; display: block; }
    .logo-zed-top { height: 56px; }
    .login-user-block { flex: 1; display: flex; align-items: center; justify-content: center; padding: 32px 16px; }
    .login-section {
      width: 980px; max-width: 100%; display: grid; grid-template-columns: 1.05fr 1fr; border-radius: 18px; overflow: hidden;
      background: #fff; box-shadow: 0 10px 30px rgba(16, 61, 64, 0.12);
    }
    .brand-panel {
      position: relative; overflow: hidden; color: #fff; padding: 40px 36px;
      background: linear-gradient(150deg, #2f7c83 0%, #368289 55%, #45a5ad 100%);
    }
    .ring { position: absolute; border: 2px solid rgba(255, 255, 255, 0.14); border-radius: 50%; pointer-events: none; }
    .ring-1 { width: 380px; height: 380px; right: -140px; bottom: -170px; }
    .ring-2 { width: 230px; height: 230px; right: -60px; bottom: -90px; }
    .brand-mark { width: 96px; height: 96px; border-radius: 50%; background: #fff; display: flex; align-items: center; justify-content: center; }
    .brand-mark img { width: 78px; }
    .brand-title { font-size: 28px; font-weight: 700; margin: 24px 0 6px; line-height: 1.2; }
    .brand-sub { font-size: 15px; color: #d6eef0; margin: 0 0 22px; line-height: 1.5; max-width: 380px; }
    .brand-levels { display: flex; flex-wrap: wrap; gap: 8px; }
    .brand-chip {
      font-size: 13px; padding: 4px 14px; border-radius: 14px; background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.35);
    }
    .brand-points { list-style: none; margin: 28px 0 0; padding: 0; font-size: 14px; color: #e3f3f4; }
    .brand-points li { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .brand-tick {
      width: 22px; height: 22px; border-radius: 50%; background: rgba(255, 255, 255, 0.18); display: inline-flex;
      align-items: center; justify-content: center; font-size: 12px; flex: none;
    }
    /* min-width 0: a long sentence (Forgot Password) wraps instead of widening the card. */
    .login-inner-block { padding: 40px 40px 32px; display: flex; flex-direction: column; justify-content: center; min-width: 0; }
    footer { background: #2c2c2a; }
    footer .footer { display: flex; justify-content: space-between; align-items: center; padding: 10px 24px; color: #d3d1c7; }
    footer img { height: 34px; }
    @media (max-width: 860px) {
      .login-section { grid-template-columns: 1fr; max-width: 480px; }
      .brand-panel { padding: 22px 24px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
      .brand-mark { width: 56px; height: 56px; }
      .brand-mark img { width: 46px; }
      .brand-title { font-size: 20px; margin: 0; flex: 1; }
      .brand-sub, .brand-points { display: none; }
      .brand-levels { width: 100%; }
      .login-inner-block { padding: 26px 22px; }
    }
    @media (max-width: 600px) {
      .logo-ministry { width: 170px; }
      .logo-zed-top { height: 42px; }
      .login-top { padding: 8px 16px; }
      .login-user-block { padding: 16px; }
      footer .footer { padding: 10px 16px; gap: 8px; }
    }
  `,
})
export class StaffLoginShell {
  /** Links to pages outside the portal, as the Admin set them (Admin → Links). */
  protected readonly links = inject(PortalLinksService);
  protected readonly year = new Date().getFullYear();
  protected readonly portalName = PORTAL_LABELS.portalName;
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
