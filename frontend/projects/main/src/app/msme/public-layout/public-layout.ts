import { Component, input, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ContactPage } from '../contact/contact';

/**
 * Frame of the public pages (registration, Contact ZED), as Views/Shared/_LayoutHome.cshtml drew it: the logo header,
 * the green bar with the page name and "Back to Login" / "Contact ZED", and the footer.
 */
@Component({
  selector: 'zed-public-layout',
  imports: [RouterLink, RouterLinkActive],
  host: { class: 'zed-legacy d-block' },
  template: `
    <div class="main-container">
      <header class="zed-header zed-smooth" id="main_header">
        <div class="container g-0">
          <div class="header-top">
            <a href="https://msme.gov.in/" target="_blank" rel="noopener"><img src="/Images/header/ministry.png" alt="Ministry of MSME" /></a>
            <a routerLink="/msme/login"><img class="zedv2-logo" src="/Images/header/zed-logo.png" alt="ZED" /></a>
          </div>
        </div>
      </header>

      <nav class="navbar navbar-expand-lg zed-navbar" id="main_navbar" aria-label="Public menu">
        <div class="container nav-bar-sec">
          <span class="navbar-brand">{{ title() }}<br /><span>Home</span></span>
          <button class="navbar-toggler" type="button" aria-controls="public-menu" [attr.aria-expanded]="menuOpen()"
                  aria-label="Toggle navigation" (click)="menuOpen.set(!menuOpen())">
            <span class="navbar-toggler-icon"></span>
          </button>
          <div class="collapse navbar-collapse" id="public-menu" [class.show]="menuOpen()">
            <ul class="navbar-nav nav ms-auto mb-2 mb-lg-0">
              <li class="nav-item tag"><a class="nav-link" routerLink="/msme/login">Back to Login</a></li>
              <li class="nav-item tag"><a class="nav-link" routerLink="/contact" routerLinkActive="active">Contact ZED</a></li>
            </ul>
          </div>
        </div>
      </nav>

      <div class="public-content"><ng-content /></div>

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
    :host { padding-top: 100px; color: #333; }
    .public-content { min-height: calc(100vh - 260px); }
  `,
})
export class PublicLayout {
  /** The page name shown in the green bar (old ViewBag title: "Registration", "Contact ZED"). */
  readonly title = input('Home');
  protected readonly menuOpen = signal(false);
  protected readonly year = new Date().getFullYear();
}

/** "Contact ZED" for visitors who are not signed in (old Home/Contact was public; the form's API is public too). */
@Component({
  selector: 'zed-public-contact',
  imports: [PublicLayout, ContactPage],
  template: `<zed-public-layout title="Contact ZED"><zed-msme-contact /></zed-public-layout>`,
})
export class PublicContactPage {}
