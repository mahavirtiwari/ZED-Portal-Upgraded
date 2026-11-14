import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** One step of the breadcrumb: a link, or the current page (no link). */
export interface Crumb {
  label: string;
  link?: string | unknown[];
}

/**
 * 2026-11-14 (approved frame A): the header of a redesigned applicant page: the breadcrumb, the page's title, and the
 * page's buttons (projected) on the right. The current page is the last crumb.
 */
@Component({
  selector: 'zed-page-head',
  imports: [RouterLink],
  host: { class: 'd-block' },
  template: `
    <div class="ph">
      <div class="ph-text">
        <nav class="ph-crumb" aria-label="Breadcrumb">
          @for (c of crumbs(); track $index; let last = $last) {
            @if (c.link && !last) { <a [routerLink]="c.link">{{ c.label }}</a> } @else { <span [attr.aria-current]="last ? 'page' : null">{{ c.label }}</span> }
            @if (!last) { <span aria-hidden="true">›</span> }
          }
        </nav>
        <h2 class="ph-title">{{ title() }}</h2>
      </div>
      <div class="ph-actions"><ng-content /></div>
    </div>
  `,
  styles: `
    .ph { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin: 4px 0 16px; }
    .ph-text { min-width: 0; }
    .ph-crumb { display: flex; flex-wrap: wrap; gap: 6px; font-size: 12.5px; color: #7a8a8b; margin-bottom: 2px; }
    .ph-crumb a { color: #7a8a8b; text-decoration: none; }
    .ph-crumb a:hover { color: #2f7c83; }
    .ph-crumb [aria-current] { color: #2f7c83; font-weight: 600; }
    .ph-title { margin: 0; font-size: 22px; font-weight: 700; color: #23474a; overflow-wrap: anywhere; }
    .ph-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .ph-actions:empty { display: none; }
    .ph-actions ::ng-deep .btn { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
    .ph-actions ::ng-deep .btn img { width: 14px; }
  `,
})
export class PageHead {
  readonly crumbs = input.required<Crumb[]>();
  readonly title = input.required<string>();
}
