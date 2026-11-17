import { Component, inject } from '@angular/core';
import { PortalLinksService } from '@zed/shared';
import { ContentTextComponent } from '../../content/content-text';
import { DashIcon } from './dash-icon';

/**
 * 2026-11-17 (the user's Home design): the foot of the dashboard: "How ZED certification works" as one strip of five steps
 * (the Admin's texts, Admin → Texts), "Need help?" (Contact ZED) and "Get the ZED MSME mobile app" (the store links of
 * Admin → Links; a link the Admin switched off is left out).
 */
@Component({
  selector: 'zed-dash-extras',
  imports: [ContentTextComponent, DashIcon],
  host: { class: 'd-block' },
  template: `
    <section class="hiw" aria-labelledby="hiwTitle">
      <h3 class="hiw-title" id="hiwTitle">HOW ZED CERTIFICATION WORKS</h3>
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
          <h3>Need help with your application?</h3>
          <p>Talk to the ZED helpdesk.</p>
          @if (links.url('contact'); as url) {
            <div class="h-btns"><a class="btn h-outline" [href]="url" target="_blank" rel="noopener noreferrer">Contact ZED</a></div>
          }
        </div>
      </section>
      <section class="hcard">
        <span class="h-ic"><zed-dash-icon name="phone" /></span>
        <div class="h-text">
          <h3>Get the ZED MSME mobile app</h3>
          <p>Needed for Basic Information and document upload.</p>
          <div class="h-btns">
            @if (links.url('appStore'); as url) {
              <a class="btn h-dark" [href]="url" target="_blank" rel="noopener noreferrer"><zed-dash-icon name="download" [size]="15" /> iOS app</a>
            }
            @if (links.url('playStore'); as url) {
              <a class="btn h-dark" [href]="url" target="_blank" rel="noopener noreferrer"><zed-dash-icon name="download" [size]="15" /> Android app</a>
            }
          </div>
        </div>
      </section>
    </div>
  `,
  styles: `
    .hiw { background: #fff; border: 1px solid #dfe7e8; border-radius: 12px; padding: 22px 24px; margin-bottom: 24px; }
    .hiw-title { margin: 0 0 18px; font-size: 12px; font-weight: 800; letter-spacing: .1em; color: #4b5b5c; }
    .cert-steps { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 20px; list-style: none; margin: 0; padding: 0; }
    .cert-steps li { position: relative; display: flex; align-items: flex-start; gap: 12px; min-width: 0; margin: 0; }
    .cert-steps li:not(:last-child)::after { content: '›'; position: absolute; right: -14px; top: 2px; color: #a8b4b5; font-size: 18px; }
    /* The numbers keep the legacy green-to-teal colours (styles/_legacy-site.scss .cert-steps). */
    .cert-steps > li > .step-num { flex: none; display: block; width: 30px; height: 30px; line-height: 30px; font-size: 14px; }
    .cert-steps li .step-details { min-width: 0; margin: 0; font-size: 12.5px; color: #5f6f70; }
    .cert-steps li .step-details ::ng-deep h4 { margin: 0 0 4px; font-size: 14px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .cert-steps li .step-details ::ng-deep p { margin: 0; font-size: 12.5px; color: #5f6f70; }
    .help-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
    .hcard { display: flex; gap: 16px; background: #fff; border: 1px solid #dfe7e8; border-radius: 12px; padding: 20px; }
    .h-ic { flex: none; width: 44px; height: 44px; border-radius: 8px; display: grid; place-items: center; background: #eef3f3; color: var(--zt-dark, #1f5c61); }
    .h-text { min-width: 0; }
    .h-text h3 { margin: 0 0 2px; font-size: 16px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .h-text p { margin: 0 0 12px; font-size: 13px; color: #4b5b5c; }
    .h-btns { display: flex; flex-wrap: wrap; gap: 10px; }
    .h-btns .btn { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 700; border-radius: 8px; padding: 6px 24px; }
    .h-outline { background: #fff; color: var(--zt-dark, #1f5c61); border: 1.5px solid var(--zt-dark, #1f5c61); }
    .h-dark { background: var(--zt-ink, #173f44); color: #fff; border: 0; }
    .h-dark:hover { background: var(--zt-dark, #1f5c61); color: #fff; }
    @media (max-width: 991.98px) {
      .cert-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .cert-steps li::after { display: none; }
      .help-row { grid-template-columns: minmax(0, 1fr); }
    }
    @media (max-width: 575.98px) { .cert-steps { grid-template-columns: minmax(0, 1fr); } .hiw { padding: 18px 16px; } }
  `,
})
export class DashExtras {
  protected readonly links = inject(PortalLinksService);
  /** The keys of the steps' texts (Admin → Texts). */
  protected readonly steps = [1, 2, 3, 4, 5].map((n) => `msme.dashboard.certificationSteps.${n}`);
}
