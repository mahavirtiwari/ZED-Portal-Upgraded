import { Component, ElementRef, HostListener, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PortalLinksService } from '@zed/shared';
import { BrandingService } from '../../branding';
import { ContactPage } from '../contact/contact';
import { PageHead } from '../shared/page-head';
import { TextPipe, t } from '../../content/page-text';
import { closeTopPopup } from '../layout/msme-layout';

/**
 * Frame of the public pages (registration, Contact ZED), as Views/Shared/_LayoutHome.cshtml drew it: the logo header,
 * the green bar with the page name and "Back to Login" / "Contact ZED", and the footer.
 * 2026-11-18 (the user: the registration header "is not aligned with other page headers"): the same frame as the
 * signed-in MSME pages: the 72px logo bar, the dark teal strip (pinned on scroll) with "Back to Login" and "Contact ZED",
 * the breadcrumb and the page name as the page title, the light grey page, the dark footer, and the new buttons.
 */
@Component({
  selector: 'zed-public-layout',
  imports: [RouterLink, PageHead, TextPipe],
  host: { class: 'zed-legacy zed-msme d-block' },
  template: `
    <div class="main-container">
      <header class="zed-header" id="main_header">
        <div class="container g-0">
          <div class="header-top">
            @if (links.url('ministry'); as u) {<a [href]="u" target="_blank" rel="noopener"><img [src]="brand.logo('header-left', '/Images/header/ministry.png')" [alt]="'Ministry of MSME' | t: 'public.layout.ministryLogoAlt'" /></a>} @else {<img [src]="brand.logo('header-left', '/Images/header/ministry.png')" [alt]="'Ministry of MSME' | t: 'public.layout.ministryLogoAlt'" />}
            <a routerLink="/msme/login"><img class="zedv2-logo" [src]="brand.logo('header-right', '/Images/header/zed-logo.png?ui=1')" [alt]="'ZED' | t: 'public.layout.zedLogoAlt'" /></a>
          </div>
        </div>
      </header>

      <nav class="pub-nav" id="main_navbar" [attr.aria-label]="'Public menu' | t: 'public.layout.menu.aria'">
        <div class="container pub-nav-in">
          <span class="pub-portal">{{ 'ZED Certification' | t: 'public.layout.menu.portalLabel' }}</span>
          <ul class="pub-links">
            <li><a routerLink="/msme/login">{{ 'Back to Login' | t: 'public.layout.menu.loginLink' }}</a></li>
            <!-- The ZED website's contact page (Admin → Links; the Admin can switch it off). -->
            @if (links.url('contact'); as u) {
              <li><a [href]="u" target="_blank" rel="noopener">{{ 'Contact ZED' | t: 'public.layout.menu.contactLink' }}</a></li>
            }
          </ul>
        </div>
      </nav>

      <div class="public-content">
        @if (head()) {
        <div class="container">
          <zed-page-head [crumbs]="[{ label: ('Login' | t: 'public.layout.crumb.login'), link: '/msme/login' }, { label: name() }]" [title]="name()" />
        </div>
        }
        <ng-content />
      </div>

      <footer class="pub-footer">
        <div class="container pf">
          <small>{{ 'ZED © {year} All Rights Reserved' | t: 'public.layout.footer.copyrightText' : { year } }}</small>
          <!-- 2026-11-23 (the user: "remove it from applicant page also"): no footer links ("Back to Login" stays in the bar). -->
          <img [src]="brand.logo('footer', '/Images/footer/footer-icon.png')" [alt]="'QCI' | t: 'public.layout.footer.qciLogoAlt'" height="32" />
        </div>
      </footer>
    </div>
  `,
  styles: `
    :host { padding-top: 0; color: #333; }
    .zed-header { position: relative; height: 72px; box-shadow: none; }
    .header-top { height: 72px; }
    .header-top a img, .header-top > img { width: auto; }
    .header-top > a:first-child > img, .header-top > img:first-child { height: 80px; margin: -4px 0 -4px -8px; }
    .header-top img.zedv2-logo { width: auto !important; height: 56px; }
    .pub-nav { position: sticky; top: 0; z-index: 98; background: var(--zt-dark, #1f5c61); min-height: 48px; }
    .pub-nav-in { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 48px; }
    .pub-portal { color: #fff; font-size: 14px; font-weight: 800; }
    .pub-links { display: flex; align-items: stretch; margin: 0; padding: 0; list-style: none; }
    .pub-links li + li { border-left: 1px solid rgb(255 255 255 / 20%); }
    .pub-links a { display: flex; align-items: center; height: 48px; padding: 0 16px; color: #d4ebe6; font-size: 14px; font-weight: 600;
      text-decoration: none; white-space: nowrap; }
    .pub-links a:hover, .pub-links a:focus-visible { color: #fff; background: rgb(255 255 255 / 6%); }
    .public-content { min-height: calc(100vh - 230px); padding: 2px 0 40px; background: #f3f6f6; }
    .pub-footer { background: #1d2f31; color: #c9dcdc; }
    .pf { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 22px 12px; }
    .pf small { font-size: 13px; font-weight: 600; color: #fff; }
    @media (max-width: 575.98px) {
      .header-top > a:first-child > img, .header-top > img:first-child { height: 64px; }
      .pub-portal { display: none; }
      .pub-links a { padding: 0 10px; }
    }
  `,
})
export class PublicLayout {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** 2026-11-20 (applicant UI pass): Escape closes the open pop-up (registration's e-mail and OTP boxes), as in the MSME layout. */
  @HostListener('document:keydown.escape', ['$event'])
  protected closeOnEscape(event: Event): void {
    if (closeTopPopup(this.host.nativeElement)) event.preventDefault();
  }

  /** Links to pages outside the portal, as the Admin set them (Admin → Links). */
  protected readonly links = inject(PortalLinksService);
  /** 2026-11-15: the Admin's logos (Branding); today's files when none is saved. */
  protected readonly brand = inject(BrandingService);
  /** The page name (old ViewBag title: "Registration", "Contact ZED"), now the page title under the breadcrumb. */
  /** Unset: the standard "Home" (Admin-editable). */
  readonly title = input<string>();
  protected readonly name = computed(() => this.title() || t('public.layout.homeTitle', 'Home'));
  /** False when the page draws its own breadcrumb and title (Contact ZED). */
  readonly head = input(true);
  protected readonly year = new Date().getFullYear();
}

/** "Contact ZED" for visitors who are not signed in (old Home/Contact was public; the form's API is public too). */
@Component({
  selector: 'zed-public-contact',
  imports: [PublicLayout, ContactPage],
  template: `<zed-public-layout title="Contact ZED" [head]="false"><zed-msme-contact /></zed-public-layout>`,
})
export class PublicContactPage {}
