import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PortalLinksService } from '@zed/shared';
import { PORTAL_SYSTEM } from '../portal-system';
import { PublicLevels } from '../msme/shared/levels';

/**
 * Frame of the staff sign-in pages (login, forgot password, set a new password).
 * 2026-11-14 redesign (option A, approved): a light hero on the left — the ministry and ZED logos, the portal's title and
 * purpose, the enabled certification levels with their badges and, on the main portal, quick links for MSMEs (MSME login,
 * registration) — and on the right the page's form in a card (a teal top edge, who signs in here, an "authorised users
 * only" line) with "Need help?" above it. On a phone the hero becomes a short band above the form.
 */
@Component({
  selector: 'zed-staff-login-shell',
  host: { class: 'zed-login d-block' },
  imports: [RouterLink],
  template: `
    <div class="zl-page">
      <aside class="zl-hero" aria-label="About the portal">
        <div class="zl-logos">
          @if (links.url('ministry'); as u) {
            <a [href]="u" target="_blank" rel="noopener"><img src="Images/header/ministry.png" alt="Ministry of MSME" class="zl-ministry" /></a>
          } @else {
            <img src="Images/header/ministry.png" alt="Ministry of MSME" class="zl-ministry" />
          }
          <img src="Images/header/zed-logo.png" alt="ZED" class="zl-zed" />
        </div>
        <div class="zl-hero-body">
          <p class="zl-kicker">{{ kicker }}</p>
          <h2 class="zl-title">{{ title }}</h2>
          <span class="zl-rule" aria-hidden="true"></span>
          <p class="zl-lead">{{ lead }}</p>

          <p class="zl-label">Certification levels</p>
          <ul class="zl-levels">
            @for (l of levels(); track l.name) {
              <li class="zl-level">
                @if (l.logoUrl) { <img [src]="l.logoUrl" alt="" /> } @else { <span class="zl-level-dot" aria-hidden="true"></span> }
                <span>{{ l.name }}</span>
              </li>
            }
          </ul>

          @if (msmeLinks) {
            <p class="zl-label">Are you an MSME?</p>
            <a class="zl-quick" routerLink="/msme/login">
              <span><strong>MSME login</strong><small>Apply for and track your certification</small></span><span class="zl-go" aria-hidden="true">›</span>
            </a>
            <a class="zl-quick" routerLink="/msme/register">
              <span><strong>Register your enterprise</strong><small>With your Udyam registration number</small></span><span class="zl-go" aria-hidden="true">›</span>
            </a>
          }
        </div>
      </aside>
      <main class="zl-side">
        <div class="zl-side-top">
          @if (links.url('contact'); as c) {
            <a class="zl-help" [href]="c" target="_blank" rel="noopener">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 17h-2v-2h2v2Zm2.1-7.7-.9.9c-.7.7-1.2 1.3-1.2 2.8h-2v-.5c0-1.1.4-2.1 1.2-2.8l1.2-1.3a1.9 1.9 0 0 0 .6-1.4 2 2 0 0 0-4 0H8a4 4 0 0 1 8 0 3.2 3.2 0 0 1-.9 2.3Z" /></svg>
              Need help?
            </a>
          }
        </div>
        <div class="zl-form">
          <div class="zl-card">
            <span class="zl-tag">{{ audience }}</span>
            <ng-content />
            <p class="zl-secure"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm-1 14-4-4 1.4-1.4 2.6 2.6 5.6-5.6L18 9l-7 7Z" /></svg>Authorised users only · sign-ins are recorded</p>
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
    .zl-page { min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); }
    .zl-hero {
      position: relative; padding: 28px 48px 32px; display: flex; flex-direction: column; border-right: 1px solid #e3ecee;
      background-color: #f1f8f8; background-image: radial-gradient(#d3e6e8 1px, transparent 1px); background-size: 22px 22px;
    }
    .zl-logos { display: flex; align-items: center; gap: 18px; padding-bottom: 18px; border-bottom: 1px solid #d9e7e8; }
    .zl-ministry { height: 64px; display: block; }
    .zl-zed { height: 56px; display: block; margin-left: auto; }
    .zl-hero-body { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 24px 0 8px; max-width: 560px; }
    .zl-kicker { font-size: 12px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: #23656b; margin: 0 0 8px; }
    .zl-title { font-size: 36px; font-weight: 700; color: #16302f; line-height: 1.15; margin: 0; }
    .zl-rule { display: block; width: 56px; height: 4px; border-radius: 2px; background: #23656b; margin: 16px 0; }
    .zl-lead { font-size: 15.5px; color: #4f6062; line-height: 1.6; margin: 0 0 24px; }
    .zl-label { font-size: 11.5px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: #5f6f70; margin: 4px 0 10px; }
    .zl-levels { list-style: none; padding: 0; margin: 0 0 24px; display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 10px; }
    .zl-level {
      display: flex; align-items: center; gap: 10px; background: #fff; border: 1px solid #dbe8e9; border-radius: 10px; padding: 8px 12px;
      font-weight: 700; color: #1d2b2c; font-size: 14px;
    }
    .zl-level img { width: 32px; height: 32px; object-fit: contain; flex: none; }
    .zl-level-dot { width: 28px; height: 28px; border-radius: 50%; background: #d9eef0; flex: none; }
    .zl-quick {
      display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #fff; border: 1px solid #dbe8e9;
      border-left: 4px solid #23656b; border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; text-decoration: none; color: #1d2b2c;
    }
    .zl-quick:hover { border-color: #23656b; background: #f8fcfc; }
    .zl-quick strong { display: block; font-size: 14.5px; }
    .zl-quick small { display: block; color: #5f6f70; font-size: 12.5px; }
    .zl-go {
      width: 28px; height: 28px; border-radius: 50%; border: 1px solid #cfe0e2; display: inline-flex; align-items: center; justify-content: center;
      color: #23656b; font-size: 18px; flex: none;
    }
    .zl-side { display: flex; flex-direction: column; padding: 24px 40px 16px; min-width: 0; }
    .zl-side-top { display: flex; justify-content: flex-end; min-height: 32px; }
    .zl-help { display: inline-flex; align-items: center; gap: 6px; color: #23656b; font-weight: 600; font-size: 14px; text-decoration: none; }
    .zl-help svg { width: 16px; height: 16px; fill: currentColor; }
    /* min-width 0: a long sentence (Forgot Password) wraps instead of widening the form. */
    .zl-form { flex: 1; display: flex; flex-direction: column; justify-content: center; width: 100%; max-width: 460px; margin: 0 auto; padding: 24px 0; min-width: 0; }
    .zl-card {
      background: #fff; border: 1px solid #e3ecee; border-top: 4px solid #23656b; border-radius: 12px; padding: 26px 30px 16px;
      box-shadow: 0 18px 40px rgba(23, 74, 78, 0.08); min-width: 0;
    }
    .zl-tag {
      display: inline-block; font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 4px; background: #d9eef0; color: #174a4e; margin-bottom: 12px;
    }
    .zl-secure {
      display: flex; align-items: center; justify-content: center; gap: 8px; margin: 18px 0 0; padding-top: 12px; border-top: 1px solid #e3ecee;
      font-size: 12.5px; color: #6b7a7c;
    }
    .zl-secure svg { width: 14px; height: 14px; fill: #23656b; flex: none; }
    .zl-foot {
      display: flex; justify-content: center; align-items: center; gap: 12px; border-top: 1px solid #e3ecee;
      padding-top: 12px; color: #6b7a7c; background: none; /* legacy-login paints footers dark */
    }
    @media (max-width: 900px) {
      .zl-page { grid-template-columns: 1fr; }
      .zl-hero { padding: 14px 20px 16px; border-right: 0; border-bottom: 1px solid #e3ecee; }
      .zl-logos { padding-bottom: 10px; }
      .zl-ministry { height: 40px; }
      .zl-zed { height: 42px; }
      .zl-hero-body { padding: 12px 0 0; }
      .zl-title { font-size: 22px; }
      .zl-rule, .zl-lead, .zl-label, .zl-levels, .zl-quick { display: none; }
      .zl-side { padding: 8px 20px 14px; }
      .zl-form { padding: 16px 0 20px; }
      .zl-card { padding: 20px 18px 12px; box-shadow: none; }
    }
  `,
})
export class StaffLoginShell {
  /** Links to pages outside the portal, as the Admin set them (Admin → Links). */
  protected readonly links = inject(PortalLinksService);
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
        : 'Zero Defect, Zero Effect: desktop and site assessments, reviews and reports for the staff, agencies and assessors of ZED.';
  /** MSMEs sign in and register on the main portal. */
  protected readonly msmeLinks = PORTAL_SYSTEM === 'main';
  private readonly publicLevels = inject(PublicLevels);
  /** Consultancy: handholding of Silver and Gold; otherwise the enabled levels as the Admin named them, with their badges. */
  protected readonly levels = computed(() => {
    const all = this.publicLevels.levels() ?? [];
    const pick = PORTAL_SYSTEM === 'consultancy' ? all.filter((l) => l.code === 'Silver' || l.code === 'Gold') : all;
    return pick.length
      ? pick.map((l) => ({ name: l.name, logoUrl: l.logoUrl }))
      : (PORTAL_SYSTEM === 'consultancy' ? ['Silver', 'Gold'] : ['Bronze', 'Silver', 'Gold', 'ZED-X']).map((name) => ({ name, logoUrl: null as string | null }));
  });
}
