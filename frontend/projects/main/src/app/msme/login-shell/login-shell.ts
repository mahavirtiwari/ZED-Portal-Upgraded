import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of } from 'rxjs';
import { PortalLinksService } from '@zed/shared';

/** The live portal's banner (Banner_20220428033601.png, resized), shown until an Admin uploads one in Home Page Settings. */
export const DEFAULT_BANNER = '/Images/HomePage/default-banner.webp';

/**
 * Frame of the MSME login pages (login, forgot password, reset password). 2026-11-07 redesign (option A, approved): a white
 * ministry bar; the Admin's banner in a rounded card with a teal strip under it (the scheme, its levels and three benefits);
 * the page's sign-in card beside it; the footer. On a phone the photo becomes a short banner above the card.
 */
@Component({
  selector: 'zed-login-shell',
  host: { class: 'zed-login d-block' },
  template: `
    <div class="ml-page">
      <header class="ml-top">
        @if (links.url('ministry'); as u) {
          <a [href]="u" target="_blank" rel="noopener"><img src="/Images/header/ministry.png" alt="Ministry of MSME" class="ml-ministry" /></a>
        } @else {
          <img src="/Images/header/ministry.png" alt="Ministry of MSME" class="ml-ministry" />
        }
        <img class="ml-zed" src="/Images/header/zed-logo.png" alt="ZED" />
      </header>
      <main class="ml-main">
        <section class="ml-hero" aria-label="About ZED certification">
          @if (banner(); as url) {
            <img class="ml-photo" [src]="url" alt="" />
          }
          <div class="ml-strip">
            <p class="ml-title">MSME Sustainable (ZED) Certification</p>
            <p class="ml-sub">For manufacturing and service MSMEs — on the web and the ZED MSME app</p>
            <div class="ml-levels">
              @for (l of levels; track l) {
                <span class="ml-chip">{{ l }}</span>
              }
            </div>
            <ul class="ml-benefits">
              <li><span aria-hidden="true">✓</span>Get certified</li>
              <li><span aria-hidden="true">✓</span>Subsidy on fees</li>
              <li><span aria-hidden="true">✓</span>Handholding support</li>
            </ul>
          </div>
        </section>
        <section class="ml-card">
          <ng-content />
        </section>
      </main>
      <footer class="ml-footer">
        <small>ZED © {{ year }} All Rights Reserved</small>
        <img src="/Images/footer/footer-icon.png" alt="QCI" />
        <small>Version: 4.0.0</small>
      </footer>
    </div>
  `,
  styles: `
    :host { background: #f3f8f8; font-family: 'Work Sans', sans-serif; }
    .ml-page { min-height: 100vh; display: flex; flex-direction: column; }
    .ml-top {
      display: flex; justify-content: space-between; align-items: center; background: #fff; padding: 10px 24px;
      border-bottom: 3px solid #45a5ad;
    }
    .ml-ministry { width: 230px; display: block; }
    .ml-zed { height: 60px; }
    .ml-main {
      flex: 1; display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 24px; align-items: stretch;
      width: 1180px; max-width: 100%; margin: 0 auto; padding: 28px 20px;
    }
    .ml-hero {
      position: relative; border-radius: 20px; overflow: hidden; min-height: 520px; background: #fff; border: 1px solid #dce7e8;
      display: flex; flex-direction: column; box-shadow: 0 10px 30px rgba(16, 61, 64, 0.14);
    }
    /* The whole banner (the Admin's banners are composed pictures with their own slogan): contained, not cropped. */
    .ml-photo { flex: 1 1 auto; min-height: 0; width: 100%; object-fit: contain; object-position: center; padding: 16px 16px 8px; }
    .ml-strip { background: #1f5c61; color: #fff; padding: 20px 24px; }
    .ml-title { font-size: 22px; font-weight: 700; margin: 0; line-height: 1.25; }
    .ml-sub { font-size: 14px; color: #d6eef0; margin: 4px 0 12px; }
    .ml-levels { display: flex; flex-wrap: wrap; gap: 8px; }
    .ml-chip { font-size: 13px; padding: 3px 12px; border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.4); background: rgba(255, 255, 255, 0.12); }
    .ml-benefits { list-style: none; margin: 14px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 22px; font-size: 14px; color: #e3f3f4; }
    .ml-benefits span {
      display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%;
      background: rgba(255, 255, 255, 0.18); font-size: 11px; margin-right: 8px;
    }
    .ml-card {
      background: #fff; border-radius: 20px; border: 1px solid #dce7e8; padding: 30px 32px; align-self: center;
      box-shadow: 0 10px 30px rgba(16, 61, 64, 0.08); min-width: 0;
    }
    .ml-footer {
      display: flex; justify-content: space-between; align-items: center; gap: 12px; background: #2c2c2a; color: #d3d1c7;
      padding: 10px 24px;
    }
    .ml-footer img { height: 34px; }
    @media (max-width: 900px) {
      .ml-main { grid-template-columns: 1fr; width: 560px; max-width: 100%; gap: 16px; padding: 16px; }
      .ml-hero { min-height: 0; }
      .ml-photo { max-height: 240px; }
      .ml-benefits { display: none; }
      .ml-card { padding: 22px 20px; }
    }
    @media (max-width: 600px) {
      .ml-ministry { width: 170px; }
      .ml-zed { height: 44px; }
      .ml-top { padding: 8px 16px; }
      .ml-photo { max-height: 180px; padding: 10px 10px 4px; }
      .ml-title { font-size: 18px; }
      .ml-sub { display: none; }
      .ml-footer { padding: 10px 16px; }
    }
  `,
})
export class LoginShell {
  /** Links to pages outside the portal, as the Admin set them (Admin → Links). */
  protected readonly links = inject(PortalLinksService);
  protected readonly year = new Date().getFullYear();
  protected readonly levels = ['Bronze', 'Silver', 'Gold', 'ZED-X'];
  protected readonly banner = toSignal(
    inject(HttpClient)
      .get<{ imageUrl: string | null }>('/api/msme/auth/banner')
      .pipe(
        map((r) => r.imageUrl ?? DEFAULT_BANNER),
        catchError(() => of(DEFAULT_BANNER)),
      ),
    { initialValue: null },
  );
}
