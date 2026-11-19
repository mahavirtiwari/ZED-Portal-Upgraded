import { Component, DestroyRef, ElementRef, HostListener, Injector, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService, ClientConfigService, PortalLinksService } from '@zed/shared';
import { BrandingService } from '../branding';
import { StaffMenuEntry, StaffMenuItem, StaffRole, menuEntries, menuFor, menuGroupText, menuText, staffRoleName } from './staff-menu';
import { RemoteAllotments } from './remote-allotments';
import { ZedIdSearch, MSME_PROFILE_ROLES } from './zed-id-search';
import { ATTENTION_ROLES, AttentionBell } from './attention';
import { ToastHost } from './toast';
import { ConfirmHost } from './confirm-dialog';
import { PORTAL_SYSTEM } from '../portal-system';
import { TextPipe } from '../content/page-text';

/**
 * Frame of the staff pages: header, role-based menu and footer. Port of the staff branches of
 * Views/Shared/_Layout.cshtml (per system: staff-menu.ts). Menu entries not migrated yet open the old portal.
 * Images are relative so that they load from the build's baseHref (/Consultancy/, /surveillance/).
 * V4: the bar names the role and the portal (each page has its own heading); on wide screens the menu stays on one row: the entries that do not fit
 * (measured, again on every resize) are under "More". Phones list every entry. Every page has the bar's width.
 * 2026-11-17 (approved staff redesign): "Search ZED ID" (Ctrl K) for the roles that can open a unit's profile, the bell with
 * the work waiting (api/staff/attention) for Master Admin, agencies and assessors, the toasts of the pages (ToastService),
 * and the footer's links (as the applicant's footer).
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): the designs' sizes (72px logo bar, 48px menu strip with
 * lighter tabs and no separators, so the Master Admin's whole menu fits on the row from 1440px), the footer's four links.
 * The shared blocks of the pages (buttons, tables, pills, cards) are in styles/_v4-skin.scss.
 */
@Component({
  selector: 'zed-staff-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ZedIdSearch, AttentionBell, ToastHost, ConfirmHost, TextPipe],
  // 2026-11-19 (the user, Admin login: 'make the buttons in dark color'): .zed-admin while the signed-in role is Admin
  // (RoleId 1), the scope of the dark buttons (styles/_admin-skin.scss); the other staff roles keep the designs' buttons.
  host: { class: 'zed-legacy zed-v4 d-block', '[class.zed-admin]': 'isAdmin()' },
  template: `
    <div class="main-container">
      <header class="zed-header zed-smooth" id="main_header">
        <div class="container">
          <div class="header-top">
            @if (links.url('ministry'); as u) {<a [href]="u" target="_blank" rel="noopener"><img [src]="brand.logo('header-left', 'Images/header/ministry.png')" [alt]="'Ministry of MSME' | t: 'staff.layout.ministryLogoAlt'" /></a>} @else {<img [src]="brand.logo('header-left', 'Images/header/ministry.png')" [alt]="'Ministry of MSME' | t: 'staff.layout.ministryLogoAlt'" />}
            <a routerLink="/staff"><img class="zedv2-logo" [src]="brand.logo('header-right', 'Images/header/zed-logo.png?ui=1')" [alt]="'ZED' | t: 'staff.layout.zedLogoAlt'" /></a>
          </div>
        </div>
      </header>

      <nav class="navbar navbar-expand-lg zed-navbar" id="main_navbar" [attr.aria-label]="'Staff menu' | t: 'staff.layout.menu.aria'">
        <div class="container nav-bar-sec">
          <!-- 2026-11-14 (approved frame A): the role and portal are shown with the user on wide screens; the bar's name on phones only. -->
          <a class="navbar-brand" routerLink="/staff">{{ roleName() }}</a>
          <button class="navbar-toggler" type="button" aria-controls="staff-menu" [attr.aria-expanded]="menuOpen()"
                  [attr.aria-label]="'Toggle navigation' | t: 'staff.layout.menu.toggleAria'" (click)="menuOpen.set(!menuOpen())">
            <span class="navbar-toggler-icon"></span>
          </button>
          <div class="collapse navbar-collapse" id="staff-menu" [class.show]="menuOpen()">
            <ul class="navbar-nav nav mb-2 mb-lg-0" #bar>
              <li class="nav-item tag">
                <a class="nav-link" routerLink="/staff" [routerLinkActiveOptions]="{ exact: true }" routerLinkActive="active" [attr.aria-label]="'Home' | t: 'staff.layout.menu.homeLink'">{{ 'Home' | t: 'staff.layout.menu.homeLink' }}</a>
              </li>
              @for (entry of entries(); track $index) {
                @if ('group' in entry) {
                  <li class="nav-item dropdown tag" [class.d-lg-none]="$index >= fit()">
                    <button type="button" class="nav-link dropdown-toggle btn btn-link" [class.active]="groupActive(entry.items)"
                            [attr.aria-expanded]="openGroup() === entry.group" (click)="toggleGroup(entry.group, $event)">
                      {{ menuGroupText(entry.group) }}
                    </button>
                    <ul class="dropdown-menu" [class.show]="openGroup() === entry.group">
                      @for (section of entry.sections; track $index) {
                        @if (section.heading) { <li><span class="dropdown-header">{{ menuGroupText(section.heading) }}</span></li> }
                        @for (item of section.items; track item.label + (item.route ?? item.legacyPath)) {
                          <li>
                            @if (item.route) {
                              <a class="dropdown-item" [class.ps-4]="section.heading" [routerLink]="item.route" [queryParams]="item.queryParams" routerLinkActive="active" [routerLinkActiveOptions]="activeOptions(item)">{{ menuText(item.label) }}</a>
                            } @else {
                              <a class="dropdown-item" [class.ps-4]="section.heading" [href]="legacy(item)" [title]="'Opens the current portal' | t: 'staff.layout.menu.legacyTooltip'">{{ menuText(item.label) }}</a>
                            }
                          </li>
                        }
                      }
                    </ul>
                  </li>
                } @else {
                  <li class="nav-item tag" [class.d-lg-none]="$index >= fit()">
                    @if (entry.item.route) {
                      <a class="nav-link" [routerLink]="entry.item.route" [queryParams]="entry.item.queryParams" routerLinkActive="active">{{ menuText(entry.item.label) }}</a>
                    } @else {
                      <a class="nav-link" [href]="legacy(entry.item)" [title]="'Opens the current portal' | t: 'staff.layout.menu.legacyTooltip'">{{ menuText(entry.item.label) }}</a>
                    }
                  </li>
                }
              }
              @if (fit() < entries().length) {
                <!-- Wide screens: the entries that do not fit on the row (the phone menu lists them all above). -->
                <li class="nav-item dropdown tag d-none d-lg-block more">
                  <button type="button" class="nav-link dropdown-toggle btn btn-link" [class.active]="moreActive()"
                          [attr.aria-expanded]="openGroup() === moreGroup" (click)="toggleGroup(moreGroup, $event)">{{ 'More' | t: 'staff.layout.menu.moreButton' }}</button>
                  <ul class="dropdown-menu dropdown-menu-end more-menu" [class.show]="openGroup() === moreGroup">
                    @for (entry of entries(); track $index) {
                      @if ($index >= fit()) {
                        @if ('group' in entry) {
                          <li><span class="dropdown-header">{{ menuGroupText(entry.group) }}</span></li>
                          @for (item of entry.items; track item.label + (item.route ?? item.legacyPath) + item.group) {
                            <li>
                              @if (item.route) {
                                <a class="dropdown-item ps-4" [routerLink]="item.route" [queryParams]="item.queryParams" routerLinkActive="active" [routerLinkActiveOptions]="activeOptions(item)">{{ menuText(item.label) }}</a>
                              } @else {
                                <a class="dropdown-item ps-4" [href]="legacy(item)" [title]="'Opens the current portal' | t: 'staff.layout.menu.legacyTooltip'">{{ menuText(item.label) }}</a>
                              }
                            </li>
                          }
                        } @else {
                          <li>
                            @if (entry.item.route) {
                              <a class="dropdown-item" [routerLink]="entry.item.route" [queryParams]="entry.item.queryParams" routerLinkActive="active">{{ menuText(entry.item.label) }}</a>
                            } @else {
                              <a class="dropdown-item" [href]="legacy(entry.item)" [title]="'Opens the current portal' | t: 'staff.layout.menu.legacyTooltip'">{{ menuText(entry.item.label) }}</a>
                            }
                          </li>
                        }
                      }
                    }
                  </ul>
                </li>
              }
              @if (canSearch() || canBell()) {
                <li class="nav-item nav-tools">
                  @if (canSearch()) { <zed-zed-id-search /> }
                  @if (canBell()) { <zed-attention-bell /> }
                </li>
              }
              <li class="nav-item dropdown tag user-menu">
                <button type="button" class="nav-link dropdown-toggle btn btn-link" [attr.aria-expanded]="userMenuOpen()" (click)="toggleUserMenu($event)"
                        [title]="user()?.actingUserId ? ('Working for {name} ({id})' | t: 'staff.layout.user.workingForTooltip' : { name: user()?.userName, id: user()?.userId }) : ''">
                  <span class="avatar" aria-hidden="true">{{ (user()?.actingUserName || user()?.userName || '?').charAt(0) }}</span>
                  <span class="who"><b>{{ user()?.actingUserName || user()?.userName }}</b><small>{{ roleName() }}</small></span>
                </button>
                <ul class="dropdown-menu dropdown-menu-end" [class.show]="userMenuOpen()">
                  <li><a class="dropdown-item" routerLink="/staff/change-password">{{ 'Change Password' | t: 'staff.layout.user.changePasswordLink' }}</a></li>
                  <li><button type="button" class="dropdown-item" (click)="logout()">{{ 'Logout' | t: 'staff.layout.user.logoutButton' }}</button></li>
                </ul>
              </li>
            </ul>
          </div>
        </div>
      </nav>

      <main class="staff-content"><div class="container staff-page"><router-outlet /></div></main>

      <footer class="sfoot">
        <div class="footer">
          <div class="container sf">
            <small>{{ 'ZED © {year} All Rights Reserved' | t: 'staff.layout.footer.copyrightText' : { year } }}</small>
            <!-- 2026-11-18 (the user: staff pages 'not aligned with SVG files'): the designs' four links, as the applicant's footer
                 (Admin → Links); the account's documents and the portal's privacy page when the Admin cleared a link. -->
            <nav class="sf-links" [attr.aria-label]="'Footer' | t: 'staff.layout.footer.aria'">
              @if (links.url('guidelines'); as u) { <a [href]="u" target="_blank" rel="noopener">{{ 'Scheme guidelines' | t: 'staff.layout.footer.guidelinesLink' }}</a> }
              @else if (hasDocuments()) { <a routerLink="/staff/documents">{{ 'Scheme guidelines' | t: 'staff.layout.footer.guidelinesLink' }}</a> }
              @if (links.url('privacy'); as u) { <a [href]="u" target="_blank" rel="noopener">{{ 'Privacy policy' | t: 'staff.layout.footer.privacyLink' }}</a> }
              @else if (main) { <a routerLink="/privacy-policy">{{ 'Privacy policy' | t: 'staff.layout.footer.privacyLink' }}</a> }
              @if (links.url('terms'); as u) { <a [href]="u" target="_blank" rel="noopener">{{ 'Terms of use' | t: 'staff.layout.footer.termsLink' }}</a> }
              @if (links.url('contact'); as u) { <a [href]="u" target="_blank" rel="noopener">{{ 'Help desk' | t: 'staff.layout.footer.helpDeskLink' }}</a> }
            </nav>
            <img [src]="brand.logo('footer', 'Images/footer/footer-icon.png')" [alt]="'QCI' | t: 'staff.layout.footer.qciLogoAlt'" height="36" />
          </div>
        </div>
      </footer>
    </div>
    <zed-toast />
    <!-- 2026-11-19: the pages' confirmations (ConfirmService), in place of the browser's confirm() box. -->
    <zed-confirm-host />
  `,
  styles: `
    :host { color: #333; }
    /* 2026-11-18 (the user: staff pages 'not aligned with SVG files'): the designs' frame. A 72px logo bar that scrolls away (the
       ministry image is 80px tall in its transparent margin, the ZED logo 56px, as the MSME layout), then the 48px menu strip
       pinned to the top; the page starts 17px under it on the designs' grey (#f4f7f7). The logos sit on the page's left and right
       edges (the ministry image's margin is 4px at this size). */
    .zed-header { position: static; height: 72px; padding: 0; box-shadow: none; }
    .header-top { height: 72px; }
    .header-top a img, .header-top > img { width: auto; }
    .header-top > a:first-child > img, .header-top > img:first-child { height: 80px; margin: -4px 0 -4px -4px; }
    .header-top img.zedv2-logo { width: auto !important; height: 56px; }
    .zed-navbar { position: sticky; top: 0; z-index: 99; padding: 0; background: var(--zt-dark, #24666b); box-shadow: none; }
    .zed-navbar .nav-bar-sec { min-height: 48px; background: none; border-radius: 0; box-shadow: none; }
    :host ::ng-deep .staff-page [id] { scroll-margin-top: 64px; }
    .staff-content { min-height: calc(100vh - 190px); padding: 17px 0 40px; background: #f4f7f7; }
    /* Every page has the menu bar's width: a page's own container (fixed, fluid or none) lines up with it. */
    :host ::ng-deep .staff-page .container, :host ::ng-deep .staff-page .container-fluid { max-width: none; padding-left: 0; padding-right: 0; }
    .zed-navbar .navbar-brand { max-width: 260px; white-space: normal; line-height: 1.15; font-size: 20px; text-decoration: none; color: #fff; }
    .zed-navbar .nav { align-items: center; }
    .zed-navbar .tag { padding: 0; }
    .zed-navbar .nav > li:not(:last-child) { border-right: 0; }
    .zed-navbar .nav > li > a.nav-link, .zed-navbar .nav > li > button.nav-link { white-space: nowrap; }
    .zed-navbar .dropdown-header { font-weight: 700; color: var(--zt-mid2, #2f7c83); font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px; padding: 10px 16px 4px; }
    .dropdown-toggle.btn-link { text-decoration: none; }
    /* The drop-downs are buttons; the old stylesheet styles only the links (.zed-navbar .nav > li > a). */
    .zed-navbar .nav > li > button.nav-link { margin-top: 10px; color: #fff; font-size: 14px; font-weight: 600; line-height: 24px; border: 0; border-radius: 0;
      background: transparent; box-shadow: none; }
    .zed-navbar .dropdown-menu { top: 100%; margin-top: 0; border-radius: 10px !important; box-shadow: 0 8px 24px rgba(16, 61, 64, 0.14); }
    /* 2026-11-19 (Admin UI audit): the long drop-downs, the white phone menu button and the phone menu are in styles/_staff-shared.scss. */
    .zed-navbar .avatar { flex: none; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: #cdeccf;
      color: var(--zt-dark, #24666b); font-size: 13px; font-weight: 800; }
    .zed-navbar .who { display: flex; flex-direction: column; min-width: 0; line-height: 1.2; text-align: left; }
    .zed-navbar .who b { max-width: 170px; overflow: hidden; text-overflow: ellipsis; font-size: 12.5px; font-weight: 700; color: #fff; }
    .zed-navbar .who small { font-size: 10.5px; font-weight: 500; color: #bcd8da; }
    .zed-navbar .nav-tools { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
    /* Footer (#1c2e30): copyright on the left, the links in the middle, the logo on the right. */
    .sfoot { background: #1c2e30; color: #c9d6d7; }
    .sfoot .footer { min-height: 68px; }
    .sf { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px 16px; padding: 14px 12px; }
    .sf small { font-size: 12.5px; font-weight: 500; }
    .sf img { justify-self: end; width: auto; height: 36px; }
    .sf-links { display: flex; flex-wrap: wrap; justify-content: center; font-size: 12.5px; font-weight: 500; }
    .sf-links a { color: #9fb3b5; text-decoration: none; }
    .sf-links a + a::before { content: '·'; margin: 0 12px; color: #9fb3b5; }
    .sf-links a:hover { color: #fff; text-decoration: underline; }
    @media (max-width: 767.98px) { .sf { grid-template-columns: minmax(0, 1fr); justify-items: center; text-align: center; } .sf img { justify-self: center; } }
    @media (max-width: 991.98px) { .header-top > a:first-child > img, .header-top > img:first-child { height: 64px; } }
    @media (min-width: 992px) {
      .zed-navbar .navbar-brand { display: none; }
      /* Home starts at the page's left edge (its text, not its padding); no bottom margin (mb-2). */
      .zed-navbar .navbar-collapse > .nav { flex: 1 1 auto; margin: 0 0 0 -13.5px !important; }
      .zed-navbar .nav { align-items: stretch; }
      /* The designs' tabs: 13.5px medium, no separators, the current one bold and white with a 4px light-green line. */
      .zed-navbar .nav > li > a.nav-link, .zed-navbar .nav > li > button.nav-link {
        position: relative; display: flex; align-items: center; height: 48px; margin: 0; padding: 0 13.5px; color: #d3e6e8; font-size: 13.5px;
        font-weight: 500; line-height: 1.2; border: 0; border-radius: 0; background: transparent; opacity: 1;
      }
      .zed-navbar .nav > li > a.nav-link:hover, .zed-navbar .nav > li > button.nav-link:hover { color: #fff; background: rgba(255, 255, 255, 0.06); }
      .zed-navbar .nav > li > a.nav-link.active, .zed-navbar .nav > li > button.nav-link.active { color: #fff; font-weight: 700; border: 0; }
      .zed-navbar .nav > li > .nav-link.active::before { content: ''; position: absolute; left: 9.5px; right: 9.5px; bottom: 0; height: 4px; border-radius: 2px;
        background: #9fe0a8; }
      /* A drop-down's chevron (not the filled caret). */
      .zed-navbar .nav > li > .dropdown-toggle::after { flex: none; width: 5px; height: 5px; margin: -3px -1px 0 10px; border: solid currentColor;
        border-width: 0 1.6px 1.6px 0; transform: rotate(45deg); vertical-align: 0; }
      .zed-navbar .nav > li.nav-tools { margin-left: auto; padding: 0 12px 0 0; }
      .zed-navbar .nav > li.user-menu { position: relative; margin-left: auto; }
      .zed-navbar .nav > li.nav-tools + li.user-menu { margin-left: 0; }
      .zed-navbar .nav > li.nav-tools + li.user-menu::before { content: ''; position: absolute; left: 0; top: 10px; bottom: 10px; width: 1px;
        background: rgba(255, 255, 255, 0.2); }
      .zed-navbar .nav > li.user-menu > .nav-link { gap: 7px; padding: 0 0 0 13px; color: #fff; }
      .zed-navbar .nav > li.user-menu > .nav-link:hover { background: transparent; }
      .zed-navbar .nav > li.user-menu > .dropdown-toggle::after { width: 6px; height: 6px; margin-left: 14px; margin-right: 2px; }
    }
  `,
})
export class StaffLayout {
  /** Links to pages outside the portal, as the Admin set them (Admin → Links). */
  protected readonly links = inject(PortalLinksService);
  /** 2026-11-15: the Admin's logos (Branding); today's files when none is saved. */
  protected readonly brand = inject(BrandingService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly legacyUrl = signal('');
  private readonly destroyRef = inject(DestroyRef);

  protected readonly user = this.auth.currentUser;
  private readonly remote = inject(RemoteAllotments);
  protected readonly menu = computed(() => {
    const u = this.user();
    return u ? this.remote.filter(menuFor(u.roleId, u.subRoles ?? [], undefined, u.permissionRoutes)) : [];
  });
  /** The menu bar: long menus fold into drop-downs as in the old layout (StaffMenuItem.group). */
  protected readonly entries = computed(() => menuEntries(this.menu()));
  protected readonly openGroup = signal<string | null>(null);
  protected readonly year = new Date().getFullYear();
  protected readonly menuOpen = signal(false);
  protected readonly userMenuOpen = signal(false);
  /** "Search ZED ID": the roles that can open /staff/msme-profile (its guard). */
  protected readonly canSearch = computed(() => MSME_PROFILE_ROLES.includes(this.user()?.roleId ?? 0));
  /** The bell: the roles whose work api/staff/attention counts. */
  protected readonly canBell = computed(() => ATTENTION_ROLES.includes(this.user()?.roleId ?? 0));
  /** Footer: without the Admin's guidelines link, "Scheme guidelines" opens the documents the Admin gave to the account type (not for the Admin). */
  protected readonly hasDocuments = computed(() => this.menu().some((i) => i.route === '/staff/documents'));
  /** The privacy policy page is on the main portal. */
  protected readonly main = PORTAL_SYSTEM === 'main';
  /** 2026-11-19: the Admin login (RoleId 1) gets the dark buttons (host class zed-admin). */
  protected readonly isAdmin = computed(() => this.user()?.roleId === StaffRole.Admin);
  /** The role as people say it ("MasterAdmin" -> "Master Admin"). */
  protected readonly roleName = computed(() => staffRoleName(this.user()));
  /** The wording shown for the menu's labels and drop-downs (Admin → Texts → Page wording). */
  protected readonly menuText = menuText;
  protected readonly menuGroupText = menuGroupText;

  /** How many menu entries are on the row (wide screens); the rest are under "More". */
  protected readonly fit = signal(Number.MAX_SAFE_INTEGER);
  protected readonly moreGroup = '__more__';
  private readonly bar = viewChild<ElementRef<HTMLUListElement>>('bar');
  /** Width of each entry, measured while all are on the row. */
  private widths: number[] = [];

  constructor() {
    inject(ClientConfigService).get().then((c) => this.legacyUrl.set(c.legacyPortalUrl)).catch(() => undefined);
    this.router.events.subscribe(() => {
      this.menuOpen.set(false);
      this.userMenuOpen.set(false);
      this.openGroup.set(null);
    });

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
    // The user menu, with the search box and bell beside it.
    const user = ((bar.querySelector('.user-menu') as HTMLElement | null)?.getBoundingClientRect().width ?? 160)
      + ((bar.querySelector('.nav-tools') as HTMLElement | null)?.getBoundingClientRect().width ?? 0);
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
