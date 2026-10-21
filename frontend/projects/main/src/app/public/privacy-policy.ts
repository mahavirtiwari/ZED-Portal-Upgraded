import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Public privacy policy page (old Home/PrivacyPolicy). No sign-in, no data. The old page had a heading
 * only; the policy text is to be supplied by the scheme team (the address may be the one listed in the
 * mobile app stores, so it is kept).
 */
@Component({
  selector: 'zed-privacy-policy',
  imports: [RouterLink],
  template: `
    <header class="container py-3 d-flex align-items-center justify-content-between">
      <a href="https://msme.gov.in/" target="_blank" rel="noopener">
        <img src="/Images/header/ministry.png" alt="Ministry of MSME" width="200" />
      </a>
      <img src="/Images/header/zed-logo.png" alt="ZED" width="100" />
    </header>
    <main class="container form-page">
      <div class="text-center">
        <h3 style="font-weight: 600">Privacy Policy</h3>
        <hr />
      </div>
      <p class="text-center"><a routerLink="/msme/login">Back to login</a></p>
    </main>
  `,
})
export class PrivacyPolicyPage {}
