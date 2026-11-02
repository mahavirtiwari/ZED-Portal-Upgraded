import { Component, HostListener, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService, PortalLinksService } from '@zed/shared';
import { UBP_RETURN_KEY } from '../udyami-signin/udyami-signin';

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
            @if (links.url('ministry'); as u) {<a [href]="u" target="_blank" rel="noopener"><img src="/Images/header/ministry.png" alt="Ministry of MSME" /></a>} @else {<img src="/Images/header/ministry.png" alt="Ministry of MSME" />}
            <a routerLink="/msme/dashboard"><img class="zedv2-logo" src="/Images/header/zed-logo.png" alt="ZED" /></a>
          </div>
        </div>
      </header>

      <nav class="navbar navbar-expand-lg zed-navbar" id="main_navbar" aria-label="MSME menu">
        <div class="container nav-bar-sec">
          <!-- As the live portal: the bar always reads "Dashboard / Home". -->
          <span class="navbar-brand">Dashboard<br /><span>Home</span></span>
          <button class="navbar-toggler" type="button" aria-controls="msme-menu" [attr.aria-expanded]="menuOpen()"
                  aria-label="Toggle navigation" (click)="menuOpen.set(!menuOpen())">
            <span class="navbar-toggler-icon"></span>
          </button>
          <div class="collapse navbar-collapse" id="msme-menu" [class.show]="menuOpen()">
            <ul class="navbar-nav nav ms-auto mb-2 mb-lg-0">
              <li class="nav-item tag">
                <a class="nav-link" routerLink="/msme/dashboard" routerLinkActive="active" aria-label="Dashboard">
                  <img src="/Images/svgicons/home.svg" alt="" /><span class="d-lg-none ms-2">Dashboard</span>
                </a>
              </li>
              <li class="nav-item tag"><a class="nav-link" routerLink="/msme/documents" routerLinkActive="active">My Documents</a></li>
              <!-- The ZED website's contact page (Admin → Links; the Admin can switch it off). -->
              @if (links.url('contact'); as u) {
                <li class="nav-item tag"><a class="nav-link" [href]="u" target="_blank" rel="noopener">Contact ZED</a></li>
              }
              <li class="nav-item dropdown tag user-menu">
                <button type="button" class="nav-link dropdown-toggle btn btn-link" [attr.aria-expanded]="userMenuOpen()"
                        (click)="toggleUserMenu($event)">
                  {{ user()?.userName }}
                </button>
                <ul class="dropdown-menu dropdown-menu-end" [class.show]="userMenuOpen()">
                  <li><a class="dropdown-item" routerLink="/msme/profile">View Profile</a></li>
                  <li><a class="dropdown-item" routerLink="/msme/edit-history">Edit History</a></li>
                  <li><a class="dropdown-item" routerLink="/msme/change-password">Change Password</a></li>
                  <!-- A link like the others, so the old menu style (bold, same padding) applies. -->
                  <li><a class="dropdown-item" href="/msme/login" role="button" (click)="$event.preventDefault(); logout()">Logout</a></li>
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
    /* As the staff pages: a light tint behind the page, so its cards stand out. */
    .msme-content { min-height: calc(100vh - 260px); padding: 18px 0 40px; background: #fff; }
    .dropdown-toggle.btn-link { text-decoration: none; }
    /* The user menu is a button; the old stylesheet styles only the links (.zed-navbar .nav > li > a), so it was grey
       and sat higher than the links. Same look as the links, as in the staff menu bar. */
    .zed-navbar .nav { align-items: center; }
    .zed-navbar .nav > li > button.nav-link {
      margin-top: 10px; color: #fff; font-size: 14px; font-weight: 600; line-height: 24px; white-space: nowrap;
      border: 0; border-radius: 0; background: transparent; box-shadow: none;
    }
    .zed-navbar .nav > li > button.nav-link:hover, .zed-navbar .nav > li > button.nav-link:focus { opacity: 0.9; color: #fff; }
  `,
})
export class MsmeLayout {
  /** Links to pages outside the portal, as the Admin set them (Admin → Links). */
  protected readonly links = inject(PortalLinksService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly user = this.auth.currentUser;
  protected readonly year = new Date().getFullYear();
  protected readonly menuOpen = signal(false);
  protected readonly userMenuOpen = signal(false);

  constructor() {
    this.router.events.subscribe((e) => {
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
    // The Udyami Bharat return link belongs to this sign-in only.
    try {
      sessionStorage.removeItem(UBP_RETURN_KEY);
    } catch {
      // Storage blocked: nothing kept there.
    }
    await this.router.navigateByUrl('/msme/login');
  }
}
