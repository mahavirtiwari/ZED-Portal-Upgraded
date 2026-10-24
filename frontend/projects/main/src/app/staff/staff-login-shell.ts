import { Component } from '@angular/core';

/**
 * Frame of the staff sign-in pages (login, forgot password, set a new password), as Views/User/Login.cshtml drew it:
 * teal page with the white ministry logo, a light card with the ZED logo on the left and the white form panel on the
 * right, the two gears and the footer. The page puts its form inside.
 */
@Component({
  selector: 'zed-staff-login-shell',
  host: { class: 'zed-login d-block' },
  template: `
    <div class="main-container">
      <img class="outer-gear" src="Images/svgicons/login-gear-outer.svg" alt="" aria-hidden="true" />
      <main class="login-user-block">
        <header>
          <a href="https://msme.gov.in/" target="_blank" rel="noopener">
            <img src="Images/header/ministry-white.png" alt="Ministry of MSME" class="logo-zed" />
          </a>
        </header>
        <section class="login-section">
          <div class="login-section-inner">
            <img class="inner-gear" src="Images/svgicons/login-gear-inner.svg" alt="" aria-hidden="true" />
            <div class="logo-zed-brand"><img src="Images/header/zed-logo.png" alt="ZED" /></div>
            <div class="login-inner-block"><ng-content /></div>
          </div>
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
    :host { background-color: #45a5ad; min-height: 100vh; font-family: 'Work Sans', sans-serif; }
    .main-container { position: relative; min-height: 100vh; overflow: hidden; }
    .login-user-block { min-height: calc(100vh - 60px); position: relative; }
    .logo-zed { margin: 20px; width: 250px; }
    .login-section { width: 900px; max-width: calc(100% - 32px); margin: 0 auto 40px; }
    .login-section-inner {
      border-radius: 10px; position: relative; display: flex; justify-content: space-evenly; align-items: center;
      background: #f3f5f8;
    }
    .logo-zed-brand { height: 450px; display: flex; align-items: center; justify-content: center; }
    .login-inner-block {
      position: relative; background-color: #fff; border-radius: 10px; padding: 25px; margin: 25px 0;
      min-width: 400px; margin-right: -50px; z-index: 1;
    }
    .inner-gear { position: absolute; bottom: -48px; left: -30px; pointer-events: none; }
    .outer-gear { position: absolute; bottom: 0; left: 0; pointer-events: none; }
    footer { position: relative; z-index: 1; }
    footer .footer { display: flex; justify-content: space-between; align-items: center; padding: 10px 24px; color: #fff; }
    @media (max-width: 1024px) { .login-section { width: 730px; } }
    @media (max-width: 600px) {
      .login-section-inner { flex-direction: column; }
      .logo-zed-brand { height: 150px; }
      .logo-zed-brand img { width: 100px; }
      .login-inner-block { min-width: 0; width: calc(100% - 32px); margin: 0 16px 16px; }
      .logo-zed { width: 180px; }
    }
  `,
})
export class StaffLoginShell {
  protected readonly year = new Date().getFullYear();
}
