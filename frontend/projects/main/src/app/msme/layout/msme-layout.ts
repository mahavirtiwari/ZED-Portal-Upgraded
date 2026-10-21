import { Component, HostListener, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '@zed/shared';

/**
 * Frame of the signed-in MSME pages: header, MSME menu and footer.
 * Port of the Ulb (MSME) branch of Views/Shared/_Layout.cshtml.
 */
@Component({
  selector: 'zed-msme-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  host: { class: 'zed-legacy d-block' },
  template: `
    <div class="main-container">
      <header class="zed-header zed-smooth" id="main_header">
        <div class="container g-0">
          <div class="header-top">
            <a href="https://msme.gov.in/" target="_blank" rel="noopener"><img src="/Images/header/ministry.png" alt="Ministry of MSME" /></a>
            <a routerLink="/msme/dashboard"><img class="zedv2-logo" src="/Images/header/zed-logo.png" alt="ZED" /></a>
          </div>
        </div>
      </header>

      <nav class="navbar navbar-expand-lg zed-navbar" id="main_navbar" aria-label="MSME menu">
        <div class="container nav-bar-sec">
          <span class="navbar-brand">Dashboard<br /><span>Home</span></span>
          <button class="navbar-toggler" type="button" aria-controls="msme-menu" [attr.aria-expanded]="menuOpen()"
                  aria-label="Toggle navigation" (click)="menuOpen.set(!menuOpen())">
            <span class="navbar-toggler-icon"></span>
          </button>
          <div class="collapse navbar-collapse" id="msme-menu" [class.show]="menuOpen()">
            <ul class="navbar-nav nav ms-auto mb-2 mb-lg-0">
              <li class="nav-item tag">
                <a class="nav-link" routerLink="/msme/dashboard" routerLinkActive="active" aria-label="Dashboard">
                  <img src="/Images/svgicons/home.svg" alt="" />
                </a>
              </li>
              <li class="nav-item tag"><a class="nav-link" routerLink="/msme/documents" routerLinkActive="active">My Documents</a></li>
              <li class="nav-item tag"><a class="nav-link" routerLink="/msme/contact" routerLinkActive="active">Contact ZED</a></li>
              <li class="nav-item dropdown tag">
                <button type="button" class="nav-link dropdown-toggle btn btn-link" [attr.aria-expanded]="userMenuOpen()"
                        (click)="toggleUserMenu($event)">
                  {{ user()?.userName }}
                </button>
                <ul class="dropdown-menu dropdown-menu-end" [class.show]="userMenuOpen()">
                  <li><a class="dropdown-item" routerLink="/msme/profile">View Profile</a></li>
                  <li><a class="dropdown-item" routerLink="/msme/change-password">Change Password</a></li>
                  <li><button type="button" class="dropdown-item" (click)="logout()">Logout</button></li>
                </ul>
              </li>
            </ul>
          </div>
        </div>
      </nav>

      <div class="msme-content">
        <router-outlet />
      </div>

      <footer>
        <div class="footer">
          <div class="container d-flex justify-content-between align-items-center py-2">
            <small>ZED © {{ year }} All Rights Reserved</small>
            <img src="/Images/footer/footer-icon.png" alt="QCI" height="32" />
          </div>
        </div>
      </footer>
    </div>
  `,
  styles: `
    /* The MVC layout had body { padding-top: 100px } under its fixed 100px header (Content/swachh.css). */
    :host { padding-top: 100px; color: #333; }
    .msme-content { min-height: calc(100vh - 260px); }
    .dropdown-toggle.btn-link { text-decoration: none; }
  `,
})
export class MsmeLayout {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly user = this.auth.currentUser;
  protected readonly year = new Date().getFullYear();
  protected readonly menuOpen = signal(false);
  protected readonly userMenuOpen = signal(false);

  constructor() {
    this.router.events.subscribe(() => {
      this.menuOpen.set(false);
      this.userMenuOpen.set(false);
    });
  }

  protected toggleUserMenu(event: Event): void {
    event.stopPropagation();
    this.userMenuOpen.update((v) => !v);
  }

  @HostListener('document:click')
  protected closeMenus(): void {
    this.userMenuOpen.set(false);
  }

  protected async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/msme/login');
  }
}
