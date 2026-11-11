import { HttpClient } from '@angular/common/http';
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of } from 'rxjs';
import { PortalLinksService } from '@zed/shared';
import { PublicLevels } from '../shared/levels';

/** The live portal's banner (Banner_20220428033601.png, resized), shown until an Admin uploads one in Home Page Settings. */
export const DEFAULT_BANNER = '/Images/HomePage/default-banner.webp';

/**
 * Frame of the MSME login pages (login, forgot password, reset password). 2026-11-08 redesign (option A, approved): the
 * whole screen in two halves — a teal half (the ministry's white logo, the Admin's banner in a white frame, the scheme,
 * its levels and three benefits) and a white half with the page's form, the ZED logo above it and a one-line footer under
 * it. No separate header bar. On a phone the banner becomes a short picture in the teal band above the form.
 */
@Component({
  selector: 'zed-login-shell',
  host: { class: 'zed-login d-block' },
  template: `
    <div class="ml-page">
      <aside class="ml-hero" aria-label="About ZED certification">
        <div class="ml-ministry">
          @if (links.url('ministry'); as u) {
            <a [href]="u" target="_blank" rel="noopener"><img src="/Images/header/ministry-white.png" alt="Ministry of MSME" /></a>
          } @else {
            <img src="/Images/header/ministry-white.png" alt="Ministry of MSME" />
          }
        </div>
        <div class="ml-photo-frame">
          @if (banner(); as url) {
            <img class="ml-photo" [src]="url" alt="" />
          }
        </div>
        <p class="ml-title">MSME Sustainable (ZED) Certification</p>
        <p class="ml-sub">For manufacturing and service MSMEs — on the web and the ZED MSME app</p>
        <div class="ml-levels">
          @for (l of levels(); track l) {
            <span class="ml-chip">{{ l }}</span>
          }
        </div>
        <ul class="ml-benefits">
          <li><span aria-hidden="true">✓</span>Get certified</li>
          <li><span aria-hidden="true">✓</span>Subsidy on fees</li>
          <li><span aria-hidden="true">✓</span>Handholding support</li>
        </ul>
      </aside>
      <main class="ml-side">
        <div class="ml-side-top"><img class="ml-zed" src="/Images/header/zed-logo.png" alt="ZED" /></div>
        <section class="ml-card">
          <ng-content />
        </section>
        <footer class="ml-footer">
          <small>ZED © {{ year }} All Rights Reserved</small>
        </footer>
      </main>
    </div>
  `,
  styles: `
    :host { font-family: 'Work Sans', sans-serif; background: #fff; }
    .ml-page { min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); }
    .ml-hero {
      color: #fff; padding: 28px 40px 32px; display: flex; flex-direction: column; min-width: 0;
      background: linear-gradient(160deg, #174a4e 0%, #23656b 48%, #2f8a92 100%);
    }
    /* The ministry's white logo straight on the teal, as the old sign-in page (2026-11-12). */
    .ml-ministry { align-self: flex-start; position: relative; }
    .ml-ministry img { width: 240px; display: block; }
    /* The whole banner (the Admin's banners are composed pictures with their own slogan): contained, not cropped. */
    .ml-photo-frame {
      flex: 1 1 auto; min-height: 260px; margin: 22px 0 20px; background: #fff; border-radius: 18px; overflow: hidden;
      display: flex; align-items: center; justify-content: center; box-shadow: 0 14px 34px rgba(0, 0, 0, 0.18);
    }
    .ml-photo { width: 100%; height: 100%; max-height: 520px; object-fit: contain; padding: 14px; }
    .ml-title { font-size: 26px; font-weight: 700; margin: 0; line-height: 1.2; }
    .ml-sub { font-size: 15px; color: #cfe9ec; margin: 6px 0 14px; }
    .ml-levels { display: flex; flex-wrap: wrap; gap: 8px; }
    .ml-chip { font-size: 13px; padding: 4px 13px; border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.34); background: rgba(255, 255, 255, 0.13); }
    .ml-benefits { list-style: none; margin: 16px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 22px; font-size: 14px; color: #e4f4f5; }
    .ml-benefits span {
      display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%;
      background: rgba(255, 255, 255, 0.16); font-size: 11px; margin-right: 8px;
    }
    .ml-side { display: flex; flex-direction: column; padding: 24px 40px 16px; min-width: 0; }
    .ml-side-top { display: flex; justify-content: flex-end; }
    .ml-zed { height: 88px; }
    .ml-card { flex: 1; display: flex; flex-direction: column; justify-content: center; width: 100%; max-width: 440px; margin: 0 auto; padding: 20px 0; min-width: 0; }
    .ml-footer {
      display: flex; justify-content: space-between; align-items: center; gap: 12px; border-top: 1px solid #e3ecee;
      padding-top: 12px; color: #6b7a7c; background: none; /* legacy-login paints footers dark */
    }
    @media (max-width: 900px) {
      .ml-page { grid-template-columns: 1fr; }
      .ml-hero { padding: 16px 20px 18px; }
      .ml-ministry img { width: 160px; }
      .ml-photo-frame { min-height: 0; margin: 14px 0; }
      .ml-photo { max-height: 200px; padding: 8px; }
      .ml-title { font-size: 19px; }
      .ml-sub, .ml-benefits { display: none; }
      .ml-side { padding: 8px 20px 14px; }
      .ml-side-top { display: none; }
      .ml-card { padding: 14px 0 20px; }
    }
  `,
})
export class LoginShell {
  /** Links to pages outside the portal, as the Admin set them (Admin → Links). */
  protected readonly links = inject(PortalLinksService);
  protected readonly year = new Date().getFullYear();
  /** The enabled levels as the Admin named them (Certification Levels; built-in until they arrive). */
  private readonly publicLevels = inject(PublicLevels);
  protected readonly levels = computed(() => this.publicLevels.names() ?? ['Bronze', 'Silver', 'Gold', 'ZED-X']);
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
