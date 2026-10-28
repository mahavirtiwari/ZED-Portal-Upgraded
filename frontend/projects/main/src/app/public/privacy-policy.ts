import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ContentTextComponent } from '../content/content-text';
import { PortalLinksService } from '@zed/shared';

/**
 * Public privacy policy page (old Home/PrivacyPolicy). No sign-in, no data. The old page had a heading
 * only; the policy text is the Admin's (Admin → Texts). The address may be the one listed in the mobile
 * app stores, so it is kept.
 */
@Component({
  selector: 'zed-privacy-policy',
  imports: [RouterLink, ContentTextComponent],
  template: `
    <header class="container py-3 d-flex align-items-center justify-content-between">
      @if (links.url('ministry'); as u) {
        <a [href]="u" target="_blank" rel="noopener"><img src="/Images/header/ministry.png" alt="Ministry of MSME" width="200" /></a>
      } @else {
        <img src="/Images/header/ministry.png" alt="Ministry of MSME" width="200" />
      }
      <img src="/Images/header/zed-logo.png" alt="ZED" width="100" />
    </header>
    <main class="container form-page">
      <div class="text-center">
        <h3 style="font-weight: 600">Privacy Policy</h3>
        <hr />
      </div>
      <zed-text key="public.privacyPolicy" />
      <p class="text-center"><a routerLink="/msme/login">Back to login</a></p>
    </main>
  `,
})
export class PrivacyPolicyPage {
  /** Links to pages outside the portal, as the Admin set them (Admin → Links). */
  protected readonly links = inject(PortalLinksService);
}
