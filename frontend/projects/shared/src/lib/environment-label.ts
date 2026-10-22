import { Component, Injectable, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

/**
 * Portal:EnvironmentLabel from /api/config (e.g. "STAGING"), empty in Production. A test environment runs on a copy of
 * production data, so every page says so: a ribbon and a title prefix.
 */
@Injectable({ providedIn: 'root' })
export class EnvironmentLabelService {
  private readonly title = inject(Title);
  readonly label = signal('');

  set(label: string | null | undefined): void {
    const value = (label ?? '').trim();
    this.label.set(value);
    if (value) this.title.setTitle(this.prefixed(this.title.getTitle()));
  }

  /** "[STAGING] ZED | Login"; unchanged without a label or when already prefixed. */
  prefixed(title: string): string {
    const label = this.label();
    if (!label) return title;
    const prefix = `[${label}] `;
    return title.startsWith(prefix) ? title : prefix + title;
  }
}

/** Route titles with the environment prefix. */
@Injectable({ providedIn: 'root' })
export class EnvironmentTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly environment = inject(EnvironmentLabelService);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const title = this.buildTitle(snapshot);
    if (title !== undefined) this.title.setTitle(this.environment.prefixed(title));
  }
}

/** Fixed ribbon across the top of every page while a label is set. */
@Component({
  selector: 'zed-environment-banner',
  template: `
    @if (environment.label(); as label) {
      <div class="zed-environment-banner" role="status">
        {{ label }}: test environment with a copy of production data. Changes here do not affect the live portal.
      </div>
      <!-- Keeps the page's own header below the ribbon. -->
      <div class="zed-environment-spacer" aria-hidden="true"></div>
    }
  `,
  styles: `
    .zed-environment-banner {
      position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
      background: #b00020; color: #fff; text-align: center;
      font: 600 13px/28px Arial, sans-serif; letter-spacing: .02em;
      box-shadow: 0 2px 4px rgba(0, 0, 0, .3); pointer-events: none;
    }
    .zed-environment-spacer { height: 28px; }
  `,
})
export class EnvironmentBanner {
  protected readonly environment = inject(EnvironmentLabelService);
}
