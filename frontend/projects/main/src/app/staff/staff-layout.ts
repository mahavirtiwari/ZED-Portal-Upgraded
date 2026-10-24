import { Component, DestroyRef, ElementRef, HostListener, Injector, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService, ClientConfigService } from '@zed/shared';
import { StaffMenuEntry, StaffMenuItem, menuEntries, menuFor } from './staff-menu';

/**
 * Frame of the staff pages: header, role-based menu and footer. Port of the staff branches of
 * Views/Shared/_Layout.cshtml (per system: staff-menu.ts). Menu entries not migrated yet open the old portal.
 * Images are relative so that they load from the build's baseHref (/Consultancy/, /surveillance/).
 * V4: the bar names the open page and the role; on wide screens the menu stays on one row: the entries that do not fit
 * (measured, again on every resize) are under "More". Phones list every entry. Every page has the bar's width.
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
          <span class="navbar-brand" [title]="pageTitle()">{{ pageTitle() }}<span>{{ user()?.role }}</span></span>
          <button class="navbar-toggler" type="button" aria-controls="staff-menu" [attr.aria-expanded]="menuOpen()"
                  aria-label="Toggle navigation" (click)="menuOpen.set(!menuOpen())">
            <span class="navbar-toggler-icon"></span>
          </button>
          <div class="collapse navbar-collapse" id="staff-menu" [class.show]="menuOpen()">
            <ul class="navbar-nav nav ms-auto mb-2 mb-lg-0" #bar>
              <li class="nav-item tag">
                <a class="nav-link" routerLink="/staff" [routerLinkActiveOptions]="{ exact: true }" routerLinkActive="active" aria-label="Home">
                  <img src="Images/svgicons/home.svg" alt="" />
                </a>
              </li>
              @for (entry of entries(); track $index) {
                @if ('group' in entry) {
                  <li class="nav-item dropdown tag" [class.d-lg-none]="$index >= fit()">
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
                  <li class="nav-item tag" [class.d-lg-none]="$index >= fit()">
                    @if (entry.item.route) {
                      <a class="nav-link" [routerLink]="entry.item.route" [queryParams]="entry.item.queryParams" routerLinkActive="active">{{ entry.item.label }}</a>
                    } @else {
                      <a class="nav-link" [href]="legacy(entry.item)" title="Opens the current portal">{{ entry.item.label }}</a>
                    }
                  </li>
                }
              }
              @if (fit() < entries().length) {
                <!-- Wide screens: the entries that do not fit on the row (the phone menu lists them all above). -->
                <li class="nav-item dropdown tag d-none d-lg-block more">
                  <button type="button" class="nav-link dropdown-toggle btn btn-link" [class.active]="moreActive()"
                          [attr.aria-expanded]="openGroup() === moreGroup" (click)="toggleGroup(moreGroup, $event)">More</button>
                  <ul class="dropdown-menu dropdown-menu-end more-menu" [class.show]="openGroup() === moreGroup">
                    @for (entry of entries(); track $index) {
                      @if ($index >= fit()) {
                        @if ('group' in entry) {
                          <li><span class="dropdown-header">{{ entry.group }}</span></li>
                          @for (item of entry.items; track item.label + (item.route ?? item.legacyPath)) {
                            <li>
                              @if (item.route) {
                                <a class="dropdown-item ps-4" [routerLink]="item.route" [queryParams]="item.queryParams" routerLinkActive="active" [routerLinkActiveOptions]="activeOptions(item)">{{ item.label }}</a>
                              } @else {
                                <a class="dropdown-item ps-4" [href]="legacy(item)" title="Opens the current portal">{{ item.label }}</a>
                              }
                            </li>
                          }
                        } @else {
                          <li>
                            @if (entry.item.route) {
                              <a class="dropdown-item" [routerLink]="entry.item.route" [queryParams]="entry.item.queryParams" routerLinkActive="active">{{ entry.item.label }}</a>
                            } @else {
                              <a class="dropdown-item" [href]="legacy(entry.item)" title="Opens the current portal">{{ entry.item.label }}</a>
                            }
                          </li>
                        }
                      }
                    }
                  </ul>
                </li>
              }
              <li class="nav-item dropdown tag user-menu">
                <button type="button" class="nav-link dropdown-toggle btn btn-link" [attr.aria-expanded]="userMenuOpen()" (click)="toggleUserMenu($event)"
                        [title]="user()?.actingUserId ? 'Working for ' + user()?.userName + ' (' + user()?.userId + ')' : ''">
                  {{ user()?.actingUserName || user()?.userName }}
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

      <main class="staff-content"><div class="container staff-page"><router-outlet /></div></main>

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
    .staff-content { min-height: calc(100vh - 260px); padding-bottom: 32px; }
    /* Every page has the menu bar's width: a page's own container (fixed, fluid or none) lines up with it. */
    .staff-page { padding-top: 8px; }
    :host ::ng-deep .staff-page .container, :host ::ng-deep .staff-page .container-fluid { max-width: none; padding-left: 0; padding-right: 0; }
    /* The bar: page name and role on the left, the menu on one row on the right. */
    .zed-navbar .navbar-brand { max-width: 260px; white-space: normal; line-height: 1.15; font-size: 22px; }
    .zed-navbar .navbar-brand span { margin-top: 4px; opacity: 0.9; }
    .zed-navbar .nav { align-items: center; }
    .zed-navbar .tag { padding: 0 12px; }
    .zed-navbar .nav > li > a.nav-link, .zed-navbar .nav > li > button.nav-link { white-space: nowrap; }
    .more-menu .dropdown-header { font-weight: 700; color: #45a5ad; padding: 8px 16px 4px; }
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
  private readonly destroyRef = inject(DestroyRef);

  protected readonly user = this.auth.currentUser;
  protected readonly menu = computed(() => {
    const u = this.user();
    return u ? menuFor(u.roleId, u.subRoles ?? [], undefined, u.permissionRoutes) : [];
  });
  /** The menu bar: long menus fold into drop-downs as in the old layout (StaffMenuItem.group). */
  protected readonly entries = computed(() => menuEntries(this.menu()));
  protected readonly openGroup = signal<string | null>(null);
  protected readonly year = new Date().getFullYear();
  protected readonly menuOpen = signal(false);
  protected readonly userMenuOpen = signal(false);
  /** The open page's name (its route title without "ZED | "), shown in the bar. */
  protected readonly pageTitle = signal('Home');

  /** How many menu entries are on the row (wide screens); the rest are under "More". */
  protected readonly fit = signal(Number.MAX_SAFE_INTEGER);
  protected readonly moreGroup = '__more__';
  private readonly bar = viewChild<ElementRef<HTMLUListElement>>('bar');
  /** Width of each entry, measured while all are on the row. */
  private widths: number[] = [];

  constructor() {
    inject(ClientConfigService).get().then((c) => this.legacyUrl.set(c.legacyPortalUrl)).catch(() => undefined);
    this.router.events.subscribe((e) => {
      this.menuOpen.set(false);
      this.userMenuOpen.set(false);
      this.openGroup.set(null);
      if (e instanceof NavigationEnd) this.pageTitle.set(StaffLayout.titleOf(this.router.routerState.snapshot.root));
    });
    this.pageTitle.set(StaffLayout.titleOf(this.router.routerState.snapshot.root));

    // The row: measure the entries (all shown), then keep as many as fit; again when the menu or the width changes.
    const injector = inject(Injector);
    effect(() => {
      this.entries();
      untracked(() => {
        this.fit.set(Number.MAX_SAFE_INTEGER);
        afterNextRender(() => this.measure(), { injector });
      });
    });
    afterNextRender(() => {
      const observer = new ResizeObserver(() => this.layout());
      const bar = this.bar()?.nativeElement;
      if (bar?.parentElement) observer.observe(bar.parentElement.parentElement ?? bar.parentElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    }, { injector });
  }

  /** The deepest route title ("ZED | Sectors" -> "Sectors"). */
  private static titleOf(route: ActivatedRouteSnapshot): string {
    let title = '';
    for (let r: ActivatedRouteSnapshot | null = route; r; r = r.firstChild) if (typeof r.title === 'string' && r.title) title = r.title;
    return title.replace(/^.*\|\s*/, '').trim() || 'Home';
  }

  /** Widths of the entries while all are on the row (the home icon, "More" and the user menu are measured too). */
  private measure(): void {
    const bar = this.bar()?.nativeElement;
    if (!bar || window.innerWidth < 992) return;
    const items = Array.from(bar.children) as HTMLElement[];
    // Home icon first, then the entries, then "More" (absent while all are shown) and the user menu.
    const widths = items.slice(1, 1 + this.entries().length).map((li) => li.getBoundingClientRect().width);
    if (widths.length !== this.entries().length || widths.some((w) => w === 0)) return;
    this.widths = widths;
    this.layout();
  }

  /** Keeps as many entries on the row as fit beside the page name, the home icon, "More" and the user menu. */
  private layout(): void {
    const bar = this.bar()?.nativeElement;
    const nav = bar?.closest('.nav-bar-sec') as HTMLElement | null;
    if (!bar || !nav) return;
    if (window.innerWidth < 992) {
      this.fit.set(Number.MAX_SAFE_INTEGER);
      return;
    }
    if (this.widths.length !== this.entries().length) {
      // Not measured yet (e.g. opened at phone width): show all, measure on the next frame.
      this.fit.set(Number.MAX_SAFE_INTEGER);
      requestAnimationFrame(() => this.measure());
      return;
    }
    const brand = (nav.querySelector('.navbar-brand') as HTMLElement | null)?.getBoundingClientRect().width ?? 0;
    const style = getComputedStyle(nav);
    const available = nav.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - brand - 24;
    const home = (bar.firstElementChild as HTMLElement | null)?.getBoundingClientRect().width ?? 60;
    const user = (bar.querySelector('.user-menu') as HTMLElement | null)?.getBoundingClientRect().width ?? 160;
    const more = 90;
    const total = this.widths.reduce((a, b) => a + b, 0);
    if (home + total + user <= available) {
      this.fit.set(Number.MAX_SAFE_INTEGER);
      return;
    }
    let used = home + user + more;
    let n = 0;
    while (n < this.widths.length && used + this.widths[n] <= available) used += this.widths[n++];
    this.fit.set(n);
  }

  /** "More" is highlighted while one of its pages is open. */
  protected moreActive(): boolean {
    return this.entries().slice(this.fit()).some((e: StaffMenuEntry) => this.groupActive('group' in e ? e.items : [e.item]));
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
