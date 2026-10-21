import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService, ClientConfigService } from '@zed/shared';
import { StaffMenuItem, menuFor } from './staff-menu';
import { PORTAL_SYSTEM } from '../portal-system';
import { PORTAL_LABELS } from '../portal-labels';

/**
 * Frame of the staff pages: header, role-based menu and footer. Port of the staff branches of
 * Views/Shared/_Layout.cshtml (per system: staff-menu.ts). Menu entries not migrated yet open the old portal.
 * Images are relative so that they load from the build's baseHref (/Consultancy/, /surveillance/).
 */
@Component({
  selector: 'zed-staff-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  host: { class: 'zed-legacy d-block' },
  template: `
    <div class="main-container">
      <header class="zed-header zed-smooth" id="main_header">
        <div class="container g-0">
          <div class="header-top">
            <a href="https://msme.gov.in/" target="_blank" rel="noopener"><img src="Images/header/ministry.png" alt="Ministry of MSME" /></a>
            <a routerLink="/staff"><img class="zedv2-logo" src="Images/header/zed-logo.png" alt="ZED" /></a>
          </div>
        </div>
      </header>

      <nav class="navbar navbar-expand-lg zed-navbar" id="main_navbar" aria-label="Staff menu">
        <div class="container nav-bar-sec">
          <span class="navbar-brand">{{ user()?.role }}<br /><span>{{ systemName || 'Home' }}</span></span>
          <button class="navbar-toggler" type="button" aria-controls="staff-menu" [attr.aria-expanded]="menuOpen()"
                  aria-label="Toggle navigation" (click)="menuOpen.set(!menuOpen())">
            <span class="navbar-toggler-icon"></span>
          </button>
          <div class="collapse navbar-collapse" id="staff-menu" [class.show]="menuOpen()">
            <ul class="navbar-nav nav ms-auto mb-2 mb-lg-0 flex-wrap">
              <li class="nav-item tag">
                <a class="nav-link" routerLink="/staff" [routerLinkActiveOptions]="{ exact: true }" routerLinkActive="active" aria-label="Home">
                  <img src="Images/svgicons/home.svg" alt="" />
                </a>
              </li>
              @for (item of menu(); track item.label + (item.route ?? item.legacyPath)) {
                <li class="nav-item tag">
                  @if (item.route) {
                    <a class="nav-link" [routerLink]="item.route" routerLinkActive="active">{{ item.label }}</a>
                  } @else {
                    <a class="nav-link" [href]="legacy(item)" title="Opens the current portal">{{ item.label }}</a>
                  }
                </li>
              }
              <li class="nav-item dropdown tag">
                <button type="button" class="nav-link dropdown-toggle btn btn-link" [attr.aria-expanded]="userMenuOpen()" (click)="toggleUserMenu($event)">
                  {{ user()?.userName }}
                </button>
                <ul class="dropdown-menu dropdown-menu-end" [class.show]="userMenuOpen()">
                  <li><a class="dropdown-item" routerLink="/staff/change-password">Change Password</a></li>
                  <li><button type="button" class="dropdown-item" (click)="logout()">Logout</button></li>
                </ul>
              </li>
            </ul>
          </div>
        </div>
      </nav>

      <div class="staff-content"><router-outlet /></div>

      <footer>
        <div class="footer">
          <div class="container d-flex justify-content-between align-items-center py-2">
            <small>ZED © {{ year }} All Rights Reserved</small>
            <img src="Images/footer/footer-icon.png" alt="QCI" height="32" />
          </div>
        </div>
      </footer>
    </div>
  `,
  styles: `
    :host { padding-top: 100px; color: #333; }
    .staff-content { min-height: calc(100vh - 260px); }
    .dropdown-toggle.btn-link { text-decoration: none; }
  `,
})
export class StaffLayout {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly legacyUrl = signal('');

  protected readonly user = this.auth.currentUser;
  protected readonly menu = computed(() => {
    const u = this.user();
    return u ? menuFor(u.roleId, u.subRoles ?? []) : [];
  });
  protected readonly year = new Date().getFullYear();
  /** Consultancy / Surveillance builds: the portal's name in the menu bar. */
  protected readonly systemName = PORTAL_SYSTEM === 'main' ? '' : PORTAL_LABELS.portalName;
  protected readonly menuOpen = signal(false);
  protected readonly userMenuOpen = signal(false);

  constructor() {
    inject(ClientConfigService).get().then((c) => this.legacyUrl.set(c.legacyPortalUrl)).catch(() => undefined);
    this.router.events.subscribe(() => {
      this.menuOpen.set(false);
      this.userMenuOpen.set(false);
    });
  }

  protected legacy(item: StaffMenuItem): string {
    return this.legacyUrl() + (item.legacyPath ?? '');
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
    await this.router.navigateByUrl('/login');
  }
}
