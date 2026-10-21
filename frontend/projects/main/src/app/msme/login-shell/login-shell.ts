import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of } from 'rxjs';

/** Two-column frame of the MSME login pages: ministry/ZED header and banner on the left, form on the right. */
@Component({
  selector: 'zed-login-shell',
  host: { class: 'zed-login d-block' },
  template: `
    <div class="container-fluid">
      <div class="row">
        <div class="col-12 col-md-7 p-0">
          <section class="login-block1 container-sec">
            <header>
              <div class="header-block">
                <a href="https://msme.gov.in/" target="_blank" rel="noopener">
                  <img src="/Images/header/ministry.png" alt="Ministry of MSME" width="200" />
                </a>
                <img class="zed-logo zedv2-logo" src="/Images/header/zed-logo.png" alt="ZED" width="100" />
              </div>
            </header>
            <section>
              @if (banner(); as url) {
                <div class="login-zed-portal-img d-block d-sm-none">
                  <img [src]="url" alt="" style="width: 100%" />
                </div>
                <div class="login-zed-img d-none d-sm-block">
                  <div class="login-svg-img" [style.--banner]="'url(' + url + ')'"></div>
                </div>
              }
            </section>
          </section>
        </div>
        <div class="col-12 col-md-5 p-0">
          <section class="login-block2 container-sec">
            <ng-content />
          </section>
        </div>
      </div>
    </div>
    <footer>
      <div class="container-fluid">
        <div class="row">
          <div class="col-8 p-0">
            <div class="footer">
              <div><small>ZED © {{ year }} All Rights Reserved</small></div>
              <div><img src="/Images/footer/footer-icon.png" alt="QCI" /></div>
            </div>
          </div>
          <div class="col-4 p-0 align-self-center">
            <div class="footer-version"><small>Version: 4.0.0</small></div>
          </div>
        </div>
      </div>
    </footer>
  `,
  styles: `
    .login-svg-img::before { height: 500px; background-image: var(--banner); }
    .mb-3 input { max-width: 100%; }
  `,
})
export class LoginShell {
  protected readonly year = new Date().getFullYear();
  protected readonly banner = toSignal(
    inject(HttpClient)
      .get<{ imageUrl: string | null }>('/api/msme/auth/banner')
      .pipe(
        map((r) => r.imageUrl),
        catchError(() => of(null)),
      ),
    { initialValue: null },
  );
}
