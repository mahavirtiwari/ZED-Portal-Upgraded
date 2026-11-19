import { Component, inject } from '@angular/core';
import { PortalLinksService } from '@zed/shared';
import { ContentTextComponent } from '../../content/content-text';
import { TextPipe } from '../../content/page-text';
import { DashIcon } from './dash-icon';

/**
 * 2026-11-17 (the user's Home design): the foot of the dashboard: "How ZED certification works" as one strip of five steps
 * (the Admin's texts, Admin → Texts), "Need help?" (Contact ZED) and "Get the ZED MSME mobile app" (the store links of
 * Admin → Links; a link the Admin switched off is left out).
 * 2026-11-18 (the user's applicant designs): "Scheme guidelines" next to Contact ZED (Admin → Links, guidelines), the app's
 * QR code on the right of the app card (the picture the certification details page shows), and the design's sizes.
 * 2026-11-19 (the user: "All page wording"): its wording through the t pipe (msme.dashboard.help.*).
 */
@Component({
  selector: 'zed-dash-extras',
  imports: [ContentTextComponent, DashIcon, TextPipe],
  host: { class: 'd-block' },
  template: `
    <section class="hiw" aria-labelledby="hiwTitle">
      <h3 class="hiw-title" id="hiwTitle">{{ 'HOW ZED CERTIFICATION WORKS' | t: 'msme.dashboard.help.stepsTitle' }}</h3>
      <ol class="cert-steps">
        @for (s of steps; track $index) {
          <li>
            <span class="step-num">{{ $index + 1 }}</span>
            <div class="step-details"><zed-text [key]="s" /></div>
          </li>
        }
      </ol>
    </section>
    <div class="help-row">
      <section class="hcard">
        <span class="h-ic"><zed-dash-icon name="help" /></span>
        <div class="h-text">
          <h3>{{ 'Need help with your application?' | t: 'msme.dashboard.help.title' }}</h3>
          <p>{{ links.url('guidelines') ? ('Talk to the ZED helpdesk or read the scheme guidelines.' | t: 'msme.dashboard.help.textGuidelines') : ('Talk to the ZED helpdesk.' | t: 'msme.dashboard.help.text') }}</p>
          <div class="h-btns">
            @if (links.url('contact'); as url) {
              <a class="btn btn-outline-primary" [href]="url" target="_blank" rel="noopener noreferrer">{{ 'Contact ZED' | t: 'msme.dashboard.help.contactButton' }}</a>
            }
            @if (links.url('guidelines'); as url) {
              <a class="btn h-quiet" [href]="url" target="_blank" rel="noopener noreferrer">{{ 'Scheme guidelines' | t: 'msme.dashboard.help.guidelinesButton' }}</a>
            }
          </div>
        </div>
      </section>
      <section class="hcard">
        <span class="h-ic"><zed-dash-icon name="phone" /></span>
        <div class="h-text">
          <h3>{{ 'Get the ZED MSME mobile app' | t: 'msme.dashboard.app.title' }}</h3>
          <p>{{ 'Needed for Basic Information and document upload.' | t: 'msme.dashboard.app.text' }}</p>
          <div class="h-btns">
            @if (links.url('appStore'); as url) {
              <a class="btn h-dark" [href]="url" target="_blank" rel="noopener noreferrer"><zed-dash-icon name="download" [size]="15" /> {{ 'iOS app' | t: 'msme.dashboard.app.iosButton' }}</a>
            }
            @if (links.url('playStore'); as url) {
              <a class="btn h-dark" [href]="url" target="_blank" rel="noopener noreferrer"><zed-dash-icon name="download" [size]="15" /> {{ 'Android app' | t: 'msme.dashboard.app.androidButton' }}</a>
            }
          </div>
        </div>
        <span class="h-qr"><img src="/Images/qrcode.png" [alt]="'QR code for the ZED MSME app' | t: 'msme.dashboard.app.qrAlt'" /></span>
      </section>
    </div>
  `,
  styles: `
    .hiw { background: #fff; border: 1px solid #dde7e8; border-radius: 14px; box-shadow: 0 3px 10px rgba(16, 61, 64, .09); padding: 26px 24px 24px; margin-bottom: 24px; }
    .hiw-title { margin: 0 0 22px; font-size: 11px; font-weight: 800; letter-spacing: 1px; color: #6f8487; }
    .cert-steps { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 20px; list-style: none; margin: 0; padding: 0; }
    .cert-steps li { position: relative; display: flex; align-items: flex-start; gap: 12px; min-width: 0; margin: 0; }
    .cert-steps li:not(:last-child)::after { content: '›'; position: absolute; right: -14px; top: 0; color: #b3c4c6; font-size: 20px; }
    /* The numbers go from green to teal (the design's colours over the legacy ones, styles/_legacy-site.scss .cert-steps). */
    .cert-steps > li > .step-num { flex: none; display: block; width: 32px; height: 32px; line-height: 32px; font-size: 14px; font-weight: 800; background: #9ad45f; }
    .cert-steps > li:nth-child(2) > .step-num { background: #84cb72; }
    .cert-steps > li:nth-child(3) > .step-num { background: #6dbf86; }
    .cert-steps > li:nth-child(4) > .step-num { background: #56ae9b; }
    .cert-steps > li:nth-child(5) > .step-num { background: #3f9aa0; }
    .cert-steps li .step-details { min-width: 0; margin: 0; font-size: 11.5px; color: #6f8487; }
    .cert-steps li .step-details ::ng-deep h4 { margin: 0 0 4px; font-size: 13px; font-weight: 700; color: #17373b; }
    .cert-steps li .step-details ::ng-deep p { margin: 0; font-size: 11.5px; font-weight: 500; color: #6f8487; }
    .help-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
    .hcard { display: flex; gap: 16px; min-height: 124px; background: #fff; border: 1px solid #dde7e8; border-radius: 14px; box-shadow: 0 3px 10px rgba(16, 61, 64, .09);
      padding: 22px 20px 16px; }
    .h-ic { flex: none; width: 48px; height: 48px; border-radius: 12px; display: grid; place-items: center; background: #e6f2f3; color: var(--zt-dark, #24666b); }
    .h-text { min-width: 0; }
    .h-text h3 { margin: 0 0 3px; font-size: 15.5px; font-weight: 700; color: #17373b; }
    .h-text p { margin: 0 0 12px; font-size: 12.5px; font-weight: 500; color: #3d5559; }
    .h-btns { display: flex; flex-wrap: wrap; gap: 10px; }
    .h-btns .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-width: 130px; height: 32px; padding: 0 20px; font-size: 13px;
      font-weight: 700; border-radius: 9px; }
    .h-quiet, .h-quiet:focus { background: #e7eeee; color: #17373b; border: 1.5px solid #e7eeee; min-width: 170px; }
    .h-quiet:hover { background: #d9e4e4; border-color: #d9e4e4; color: #10292c; }
    .h-dark { background: #16292b; color: #fff; border: 0; }
    .h-dark:hover { background: var(--zt-dark, #24666b); color: #fff; }
    .h-qr { flex: none; align-self: center; margin: -10px -6px -6px auto; width: 100px; height: 100px; padding: 9px; background: #fff; border: 1px solid #dde7e8;
      border-radius: 10px; }
    .h-qr img { display: block; width: 100%; height: 100%; object-fit: contain; }
    @media (max-width: 991.98px) {
      .cert-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .cert-steps li::after { display: none; }
      .help-row { grid-template-columns: minmax(0, 1fr); }
    }
    @media (max-width: 575.98px) { .cert-steps { grid-template-columns: minmax(0, 1fr); } .hiw { padding: 18px 16px; } .h-qr { display: none; } }
  `,
})
export class DashExtras {
  protected readonly links = inject(PortalLinksService);
  /** The keys of the steps' texts (Admin → Texts). */
  protected readonly steps = [1, 2, 3, 4, 5].map((n) => `msme.dashboard.certificationSteps.${n}`);
}
