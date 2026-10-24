import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService, ClientConfigService } from '@zed/shared';
import { StaffMenuItem, menuEntries, menuFor } from './staff-menu';

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
          <span class="navbar-brand">Dashboard<br /><span>Home</span></span>
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
              @for (entry of entries(); track $index) {
                @if ('group' in entry) {
                  <li class="nav-item dropdown tag">
                    <button type="button" class="nav-link dropdown-toggle btn btn-link" [class.active]="groupActive(entry.items)"
                            [attr.aria-expanded]="openGroup() === entry.group" (click)="toggleGroup(entry.group, $event)">
                      {{ entry.group }}
                    </button>
                    <ul class="dropdown-menu" [class.show]="openGroup() === entry.group">
                      @for (item of entry.items; track item.label + (item.route ?? item.legacyPath)) {
                        <li>
                          @if (item.route) {
                            <a class="dropdown-item" [routerLink]="item.route" [queryParams]="item.queryParams" routerLinkActive="active" [routerLinkActiveOptions]="activeOptions(item)">{{ item.label }}</a>
                          } @else {
                            <a class="dropdown-item" [href]="legacy(item)" title="Opens the current portal">{{ item.label }}</a>
                          }
                        </li>
                      }
                    </ul>
                  </li>
                } @else {
                  <li class="nav-item tag">
                    @if (entry.item.route) {
                      <a class="nav-link" [routerLink]="entry.item.route" [queryParams]="entry.item.queryParams" routerLinkActive="active">{{ entry.item.label }}</a>
                    } @else {
                      <a class="nav-link" [href]="legacy(entry.item)" title="Opens the current portal">{{ entry.item.label }}</a>
                    }
                  </li>
                }
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
    /* The drop-downs are buttons; the old stylesheet styles only the links (.zed-navbar .nav > li > a). */
    .zed-navbar .nav > li > button.nav-link {
      margin-top: 10px; color: #fff; font-size: 14px; font-weight: 600; line-height: 24px;
      border: 0; border-radius: 0; background: transparent; box-shadow: none;
    }
    .zed-navbar .nav > li > button.nav-link.active { border-bottom: 2px solid #fff; }
    .zed-navbar .nav > li > button.nav-link:hover, .zed-navbar .nav > li > button.nav-link:focus { opacity: 0.9; }
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
  /** The menu bar: long menus fold into drop-downs as in the old layout (StaffMenuItem.group). */
  protected readonly entries = computed(() => menuEntries(this.menu()));
  protected readonly openGroup = signal<string | null>(null);
  protected readonly year = new Date().getFullYear();
  protected readonly menuOpen = signal(false);
  protected readonly userMenuOpen = signal(false);

  constructor() {
    inject(ClientConfigService).get().then((c) => this.legacyUrl.set(c.legacyPortalUrl)).catch(() => undefined);
    this.router.events.subscribe(() => {
      this.menuOpen.set(false);
      this.userMenuOpen.set(false);
      this.openGroup.set(null);
    });
  }

  protected legacy(item: StaffMenuItem): string {
    return this.legacyUrl() + (item.legacyPath ?? '');
  }

  protected toggleUserMenu(event: Event): void {
    event.stopPropagation();
    this.openGroup.set(null);
    this.userMenuOpen.update((v) => !v);
  }

  protected toggleGroup(group: string, event: Event): void {
    event.stopPropagation();
    this.userMenuOpen.set(false);
    this.openGroup.update((g) => (g === group ? null : group));
  }

  /** Entries that differ only by query parameters (incentive types) are active only for their own parameters. */
  protected activeOptions(item: StaffMenuItem): { exact: boolean } | { paths: 'subset'; queryParams: 'exact'; matrixParams: 'ignored'; fragment: 'ignored' } {
    return item.queryParams ? { paths: 'subset', queryParams: 'exact', matrixParams: 'ignored', fragment: 'ignored' } : { exact: false };
  }

  /** A drop-down is highlighted while one of its pages is open. */
  protected groupActive(items: readonly StaffMenuItem[]): boolean {
    const url = this.router.url.split(/[?#]/)[0];
    return items.some((i) => !!i.route && (url === i.route || url.startsWith(i.route + '/')));
  }

  @HostListener('document:click')
  protected closeMenus(): void {
    this.userMenuOpen.set(false);
    this.openGroup.set(null);
  }

  protected async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
