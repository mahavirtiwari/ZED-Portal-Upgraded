import { Component, ElementRef, HostListener, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService, PortalLinksService } from '@zed/shared';
import { BrandingService } from '../../branding';
import { UBP_RETURN_KEY } from '../udyami-signin/udyami-signin';
import { BhashiniMenu } from './bhashini-menu';
import { NotificationBell } from './notification-bell';
import { TextPipe } from '../../content/page-text';

/**
 * Frame of the signed-in MSME pages: header, MSME menu and footer.
 * Port of the Ulb (MSME) branch of Views/Shared/_Layout.cshtml.
 * 2026-11-17 (the user's applicant designs, approved): a white logo bar (72px, 2026-11-18); the menu strip Home, Certifications,
 * Incentives, My Documents, Profile, Help, with on the right the Bhashini language menu (as on the ZED website), the
 * notification bell and the user's menu; a light grey page; a dark footer.
 */
@Component({
  selector: 'zed-msme-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NotificationBell, BhashiniMenu, TextPipe],
  host: { class: 'zed-legacy zed-msme d-block' },
  template: `
    <div class="main-container">
      <header class="zed-header zed-smooth" id="main_header">
        <div class="container g-0">
          <div class="header-top">
            @if (links.url('ministry'); as u) {<a [href]="u" target="_blank" rel="noopener"><img [src]="brand.logo('header-left', '/Images/header/ministry.png')" [alt]="'Ministry of MSME' | t: 'msme.layout.ministryLogoAlt'" /></a>} @else {<img [src]="brand.logo('header-left', '/Images/header/ministry.png')" [alt]="'Ministry of MSME' | t: 'msme.layout.ministryLogoAlt'" />}
            <a routerLink="/msme/dashboard"><img class="zedv2-logo" [src]="brand.logo('header-right', '/Images/header/zed-logo.png?ui=1')" [alt]="'ZED' | t: 'msme.layout.zedLogoAlt'" /></a>
          </div>
        </div>
      </header>

      <nav class="navbar navbar-expand-lg topnav" id="main_navbar" [attr.aria-label]="'MSME menu' | t: 'msme.layout.menu.aria'">
        <div class="container">
          <span class="topnav-portal d-lg-none">{{ 'ZED Certification' | t: 'msme.layout.menu.portalLabel' }}</span>
          <button class="navbar-toggler" type="button" aria-controls="msme-menu" [attr.aria-expanded]="menuOpen()"
                  [attr.aria-label]="'Toggle navigation' | t: 'msme.layout.menu.toggleAria'" (click)="menuOpen.set(!menuOpen())">
            <span class="navbar-toggler-icon"></span>
          </button>
          <div class="collapse navbar-collapse" id="msme-menu" [class.show]="menuOpen()">
            <ul class="navbar-nav me-auto">
              <li class="nav-item"><a class="nav-link" routerLink="/msme/dashboard" [class.active]="section() === 'home'">{{ 'Home' | t: 'msme.layout.menu.homeLink' }}</a></li>
              <li class="nav-item"><a class="nav-link" routerLink="/msme/dashboard" fragment="certifications" [class.active]="section() === 'certifications'">{{ 'Certifications' | t: 'msme.layout.menu.certificationsLink' }}</a></li>
              <li class="nav-item"><a class="nav-link" routerLink="/msme/dashboard" fragment="incentives" [class.active]="section() === 'incentives'">{{ 'Incentives' | t: 'msme.layout.menu.incentivesLink' }}</a></li>
              <li class="nav-item"><a class="nav-link" routerLink="/msme/documents" routerLinkActive="active">{{ 'My Documents' | t: 'msme.layout.menu.documentsLink' }}</a></li>
              <li class="nav-item"><a class="nav-link" routerLink="/msme/profile" [class.active]="section() === 'profile'">{{ 'Profile' | t: 'msme.layout.menu.profileLink' }}</a></li>
              <li class="nav-item"><a class="nav-link" routerLink="/msme/contact" routerLinkActive="active">{{ 'Help' | t: 'msme.layout.menu.helpLink' }}</a></li>
            </ul>
            <ul class="navbar-nav nav-tools">
              <li class="nav-item tool"><zed-bhashini-menu /></li>
              <li class="nav-item tool"><zed-notification-bell /></li>
              <li class="nav-item dropdown user-menu">
                <button type="button" class="nav-link dropdown-toggle btn btn-link" [attr.aria-expanded]="userMenuOpen()"
                        (click)="toggleUserMenu($event)">
                  <span class="avatar" aria-hidden="true">{{ (user()?.userName || '?').charAt(0) }}</span>{{ user()?.userName }}
                </button>
                <ul class="dropdown-menu dropdown-menu-end" [class.show]="userMenuOpen()">
                  <li><a class="dropdown-item" routerLink="/msme/profile">{{ 'View Profile' | t: 'msme.layout.user.profileLink' }}</a></li>
                  <li><a class="dropdown-item" routerLink="/msme/edit-history">{{ 'Edit History' | t: 'msme.layout.user.historyLink' }}</a></li>
                  <li><a class="dropdown-item" routerLink="/msme/change-password">{{ 'Change Password' | t: 'msme.layout.user.passwordLink' }}</a></li>
                  <!-- A link like the others, so the old menu style (bold, same padding) applies. -->
                  <li><a class="dropdown-item" href="/msme/login" role="button" (click)="$event.preventDefault(); logout()">{{ 'Logout' | t: 'msme.layout.user.logoutButton' }}</a></li>
                </ul>
              </li>
            </ul>
          </div>
        </div>
      </nav>

      <div class="msme-content">
        <router-outlet />
      </div>

      <footer class="msme-footer">
        <div class="container mf">
          <small>{{ 'ZED © {year} All Rights Reserved' | t: 'msme.layout.footer.copyrightText' : { year } }}</small>
          <!-- 2026-11-23 (the user: "remove it from applicant page also"): no footer links, as the staff pages. -->
          <img [src]="brand.logo('footer', '/Images/footer/footer-icon.png')" [alt]="'QCI' | t: 'msme.layout.footer.qciLogoAlt'" height="32" />
        </div>
      </footer>
    </div>
  `,
  styles: `
    /* 2026-11-18 (the user: "not matching with the SVG files"): the designs' 72px logo bar, which scrolls away, and the menu
       strip pinned to the top of the window (the old fixed 100px header stayed while the menu scrolled off). */
    :host { padding-top: 0; color: #333; }
    .zed-header { position: relative; height: 72px; box-shadow: none; }
    .header-top { height: 72px; }
    .header-top a img, .header-top > img { width: auto; }
    .header-top > a:first-child > img, .header-top > img:first-child { height: 80px; margin: -4px 0 -4px -8px; }
    .header-top img.zedv2-logo { width: auto !important; height: 56px; }
    .topnav { position: sticky; top: 0; z-index: 98; }
    .msme-content { min-height: calc(100vh - 230px); padding: 2px 0 40px; background: #f3f6f6; }
    /* The dashboard's sections, scrolled to from the menu, clear the pinned menu. */
    .msme-content ::ng-deep [id] { scroll-margin-top: 64px; }
    .dropdown-toggle.btn-link { text-decoration: none; }
    .topnav { background: var(--zt-dark, #1f5c61); padding: 0; min-height: 48px; }
    .topnav .navbar-nav { align-items: stretch; gap: 2px; }
    .topnav .nav-link, .topnav button.nav-link {
      display: flex; align-items: center; gap: 8px; height: 48px; padding: 0 16px; color: #d4ebe6; font-size: 14px; font-weight: 600;
      border: 0; border-bottom: 3px solid transparent; border-radius: 0; background: transparent; box-shadow: none; white-space: nowrap;
    }
    .topnav .nav-link:hover, .topnav .nav-link:focus-visible { color: #fff; background: rgb(255 255 255 / 6%); }
    .topnav .nav-link.active { color: #fff; font-weight: 800; border-bottom-color: #8fd1a8; }
    .nav-tools { align-items: center !important; }
    .nav-tools .tool { display: flex; align-items: center; padding: 0 4px; }
    .nav-tools .user-menu { border-left: 1px solid rgb(255 255 255 / 20%); margin-left: 6px; padding-left: 6px; }
    .topnav .avatar { width: 26px; height: 26px; border-radius: 13px; display: grid; place-items: center; background: #d4ebe6; color: var(--zt-ink, #173f44);
      font-size: 12.5px; font-weight: 800; }
    .topnav .dropdown-menu { border-radius: 8px; border: 1px solid #dfe9ea; box-shadow: 0 8px 24px rgb(16 61 64 / 14%); padding: 6px; }
    .topnav .dropdown-item { border-radius: 6px; font-size: 14px; font-weight: 600; padding: 7px 12px; }
    .topnav .dropdown-item:hover { background: #eef6f6; color: var(--zt-ink, #173f44); }
    .topnav-portal { color: #fff; font-weight: 700; font-size: 14px; padding: 12px 0; }
    .topnav .navbar-toggler { border-color: rgb(255 255 255 / 40%); margin: 6px 0; }
    .topnav .navbar-toggler-icon { filter: invert(1); }
    .msme-footer { background: #1d2f31; color: #c9dcdc; }
    .mf { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 12px; }
    .mf { padding: 22px 12px; }
    .mf small { font-size: 13px; font-weight: 600; color: #fff; }
    @media (max-width: 991.98px) {
      .topnav .container { flex-wrap: wrap; }
      .topnav .navbar-nav { gap: 0; }
      .header-top > a:first-child > img, .header-top > img:first-child { height: 64px; }
      .topnav .nav-link, .topnav button.nav-link { height: 42px; border-bottom: 0; border-left: 3px solid transparent; }
      .topnav .nav-link.active { border-left-color: #8fd1a8; }
      .topnav .dropdown-menu { position: static; }
      .nav-tools { flex-direction: row; flex-wrap: wrap; padding-bottom: 6px; }
      .nav-tools .user-menu { border-left: 0; }
    }
  `,
})
export class MsmeLayout {
  /** Links to pages outside the portal, as the Admin set them (Admin → Links). */
  protected readonly links = inject(PortalLinksService);
  /** 2026-11-15: the Admin's logos (Branding); today's files when none is saved. */
  protected readonly brand = inject(BrandingService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly user = this.auth.currentUser;
  protected readonly year = new Date().getFullYear();
  protected readonly menuOpen = signal(false);
  protected readonly userMenuOpen = signal(false);
  /** The menu item of the page shown (the dashboard's sections by its fragment; the pages under them by their path). */
  protected readonly section = signal(sectionOf(this.router.url));

  constructor() {
    this.router.events.subscribe((e) => {
      this.menuOpen.set(false);
      this.userMenuOpen.set(false);
      if (e instanceof NavigationEnd) {
        this.section.set(sectionOf(e.urlAfterRedirects));
        // The dashboard's sections (Certifications, Incentives): scrolled to once the page has drawn them.
        const fragment = this.router.parseUrl(e.urlAfterRedirects).fragment;
        if (fragment) setTimeout(() => document.getElementById(fragment)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
      }
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

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * 2026-11-20 (applicant UI pass): Escape closes the open pop-up of any applicant page (its close button, as a click on it
   * would), the newest one first; then the user menu.
   */
  @HostListener('document:keydown.escape', ['$event'])
  protected closeOnEscape(event: Event): void {
    if (closeTopPopup(this.host.nativeElement)) event.preventDefault();
    else this.userMenuOpen.set(false);
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

/** The menu item a page belongs to (2026-11-17 designs: certification and apply pages under Certifications, the
 * schemes and handholding under Incentives, edit history and password under Profile). */
export function sectionOf(url: string): 'home' | 'certifications' | 'incentives' | 'profile' | 'other' {
  const [path, fragment] = url.split('#');
  const p = path.split('?')[0].toLowerCase();
  if (p.startsWith('/msme/dashboard')) return fragment === 'certifications' ? 'certifications' : fragment === 'incentives' ? 'incentives' : 'home';
  if (/^\/msme\/(certification|status|payment|surveillance-payment|entry|assessment|site-assessment)(\/|$)/.test(p)) return 'certifications';
  if (/^\/msme\/(financial-assistance|technology-upgradation|handholding)(\/|$)/.test(p)) return 'incentives';
  if (/^\/msme\/(profile|edit-history|change-password)(\/|$)/.test(p)) return 'profile';
  return 'other';
}

/** Clicks the close button of the last open pop-up inside the element; false when there is none. */
export function closeTopPopup(root: HTMLElement): boolean {
  // The applicant pop-ups are in the page only while open (@if), shown with .d-block (or Bootstrap's .show).
  const open = [...root.querySelectorAll<HTMLElement>('.modal.d-block, .modal.show')];
  const top = open.at(-1);
  const close = top?.querySelector<HTMLElement>(
    '.modal-header .btn-close, .modal-header [aria-label="Close"], .modal-header .close, .modal-footer [data-dismiss], .modal-footer .btn-close');
  if (!close) return false;
  close.click();
  return true;
}
