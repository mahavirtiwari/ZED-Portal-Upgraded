import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TextPipe } from '../../content/page-text';

/** One step of the breadcrumb: a link, or the current page (no link). */
export interface Crumb {
  label: string;
  link?: string | unknown[];
  /** A section of the linked page (e.g. the dashboard's "incentives"). */
  fragment?: string;
}

/**
 * 2026-11-14 (approved frame A): the header of a redesigned applicant page: the breadcrumb, the page's title, and the
 * page's buttons (projected) on the right. The current page is the last crumb.
 * 2026-11-17 (the user's applicant designs): "Home > … > Page" crumbs, a larger title and an optional line under it
 * (e.g. "Step 1 of 4: …").
 */
@Component({
  selector: 'zed-page-head',
  imports: [RouterLink, TextPipe],
  host: { class: 'd-block' },
  template: `
    <div class="ph">
      <div class="ph-text">
        <nav class="ph-crumb" [attr.aria-label]="'Breadcrumb' | t: 'common.pageHead.crumbsAria'">
          @for (c of crumbs(); track $index; let last = $last) {
            @if (c.link && !last) { <a [routerLink]="c.link" [fragment]="c.fragment">{{ c.label }}</a> } @else { <span [attr.aria-current]="last ? 'page' : null">{{ c.label }}</span> }
            @if (!last) { <span class="ph-sep" aria-hidden="true">›</span> }
          }
        </nav>
        @if (level() === 1) { <h1 class="ph-title">{{ title() }}</h1> } @else { <h2 class="ph-title">{{ title() }}</h2> }
        @if (subtitle()) { <p class="ph-sub">{{ subtitle() }}</p> }
      </div>
      <div class="ph-actions"><ng-content /></div>
    </div>
  `,
  styles: `
    .ph { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px; margin: 4px 0 20px; }
    /* 2026-11-21 (UI audit L6): the page's buttons stay top right beside a long subtitle (the text shrinks first). */
    .ph-text { min-width: 0; flex: 1 1 360px; }
    .ph-crumb { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13px; color: #5f6f70; margin-bottom: 6px; }
    .ph-crumb a { color: #5f6f70; text-decoration: none; }
    .ph-crumb a:hover { color: var(--zt-mid2, #2f7c83); }
    .ph-sep { color: #8a9899; }
    .ph-crumb [aria-current] { color: var(--zt-dark, #1f5c61); font-weight: 700; }
    .ph-title { margin: 0; font-size: 25px; font-weight: 700; color: var(--zt-ink, #173f44); overflow-wrap: anywhere; line-height: 1.25; }
    .ph-sub { margin: 4px 0 0; font-size: 13.5px; color: #5f6f70; }
    .ph-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; padding-top: 14px; margin-left: auto; }
    .ph-actions ::ng-deep .btn-ph { background: #e8eff0; border: 0; color: var(--zt-ink, #173f44); border-radius: 8px; padding: 8px 18px; }
    .ph-actions ::ng-deep .btn-ph:hover { background: #dbe7e8; }
    .ph-actions:empty { display: none; }
    .ph-actions ::ng-deep .btn { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
    .ph-actions ::ng-deep .btn img { width: 14px; }
  `,
})
export class PageHead {
  readonly crumbs = input.required<Crumb[]>();
  readonly title = input.required<string>();
  /** 2026-11-21 (UI audit C1): the title's heading level; 1 on a landing page (the staff dashboard), else 2. */
  readonly level = input<1 | 2>(2);
  /** A line under the title (e.g. "Step 2 of 4: confirm tax details and the amount before you pay."). */
  readonly subtitle = input<string | null>(null);
}
