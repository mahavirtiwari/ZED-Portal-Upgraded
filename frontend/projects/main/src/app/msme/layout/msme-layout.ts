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

      <!-- 2026-11-14 (approved frame A, refined top menu): a slim menu strip with text links, the current page underlined;
           the page's name is in the page's own header (breadcrumb and title), no more "Dashboard / Home" on every page. -->
      <nav class="navbar navbar-expand-lg topnav" id="main_navbar" aria-label="MSME menu">
        <div class="container">
          <span class="topnav-portal d-lg-none">ZED Certification</span>
          <button class="navbar-toggler" type="button" aria-controls="msme-menu" [attr.aria-expanded]="menuOpen()"
                  aria-label="Toggle navigation" (click)="menuOpen.set(!menuOpen())">
            <span class="navbar-toggler-icon"></span>
          </button>
          <div class="collapse navbar-collapse" id="msme-menu" [class.show]="menuOpen()">
            <ul class="navbar-nav me-auto">
              <li class="nav-item"><a class="nav-link" routerLink="/msme/dashboard" routerLinkActive="active">Home</a></li>
              <li class="nav-item"><a class="nav-link" routerLink="/msme/profile" routerLinkActive="active">Profile</a></li>
              <li class="nav-item"><a class="nav-link" routerLink="/msme/documents" routerLinkActive="active">My Documents</a></li>
              <!-- The ZED website's contact page (Admin → Links; the Admin can switch it off). -->
              @if (links.url('contact'); as u) {
                <li class="nav-item"><a class="nav-link" [href]="u" target="_blank" rel="noopener">Contact ZED</a></li>
              }
            </ul>
            <ul class="navbar-nav">
              <li class="nav-item dropdown user-menu">
                <button type="button" class="nav-link dropdown-toggle btn btn-link" [attr.aria-expanded]="userMenuOpen()"
                        (click)="toggleUserMenu($event)">
                  <span class="avatar" aria-hidden="true">{{ (user()?.userName || '?').charAt(0) }}</span>{{ user()?.userName }}
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
    /* Frame A: the menu strip. */
    .topnav { background: #23656b; padding: 0; min-height: 48px; box-shadow: 0 2px 6px rgba(16, 61, 64, 0.12); }
    .topnav .navbar-nav { align-items: stretch; gap: 2px; }
    .topnav .nav-link, .topnav button.nav-link {
      display: flex; align-items: center; gap: 8px; height: 48px; padding: 0 14px; color: #d9eef0; font-size: 14px; font-weight: 700;
      border: 0; border-bottom: 3px solid transparent; border-radius: 0; background: transparent; box-shadow: none; white-space: nowrap;
    }
    .topnav .nav-link:hover, .topnav .nav-link:focus-visible { color: #fff; background: rgba(255, 255, 255, 0.06); }
    .topnav .nav-link.active { color: #fff; border-bottom-color: #c9e8a0; }
    .topnav .avatar { width: 26px; height: 26px; border-radius: 13px; display: grid; place-items: center; background: #c9e8a0; color: #174a4e;
      font-size: 12.5px; font-weight: 800; }
    .topnav .dropdown-menu { border-radius: 8px; border: 1px solid #dfe9ea; box-shadow: 0 8px 24px rgba(16, 61, 64, 0.14); padding: 6px; }
    .topnav .dropdown-item { border-radius: 6px; font-size: 14px; font-weight: 600; padding: 7px 12px; }
    .topnav .dropdown-item:hover { background: #eef6f6; color: #174a4e; }
    .topnav-portal { color: #fff; font-weight: 700; font-size: 14px; padding: 12px 0; }
    .topnav .navbar-toggler { border-color: rgba(255, 255, 255, 0.4); margin: 6px 0; }
    .topnav .navbar-toggler-icon { filter: invert(1); }
    @media (max-width: 991.98px) {
      .topnav .container { flex-wrap: wrap; }
      .topnav .navbar-nav { gap: 0; }
      .topnav .nav-link, .topnav button.nav-link { height: 42px; border-bottom: 0; border-left: 3px solid transparent; }
      .topnav .nav-link.active { border-left-color: #c9e8a0; }
      .topnav .dropdown-menu { position: static; }
    }
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
