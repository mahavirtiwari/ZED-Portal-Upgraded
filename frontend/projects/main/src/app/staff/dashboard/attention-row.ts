import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '@zed/shared';
import { ATTENTION_ROLES, AttentionService } from '../attention';
import { TextPipe } from '../../content/page-text';

/**
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): staff-00's order for a Master Admin: allotment, overdue NC
 * closures, open quality observations, re-allotment; any other item keeps the server's order after these.
 */
const ORDER = ['allot', 'nc-overdue', 'quality-open', 'reallot'];

/** The tile icons (AttentionItem.icon), as stroke paths on a 24 grid. */
const ICONS: Record<string, string> = {
  people: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 19v-1a4 4 0 0 0-3-3.87M16 3.13a3.5 3.5 0 0 1 0 6.75',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2',
  chat: 'M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  check: 'M20 6 9 17l-5-5',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
};

/**
 * 2026-11-17 (approved staff redesign): the dashboard's "Needs your attention" row: the work waiting for the login
 * (AttentionService, the header bell's figures), each a link to the page that lists it. Only for the roles the server counts
 * work for, and only when it lists items for the login. Not part of an export.
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): staff-00's 72px tiles with a 40px tinted icon tile and the
 * number in the tone's colour; a count of 0 keeps its colours (only the arrow is lighter).
 */
@Component({
  selector: 'zed-attention-row',
  imports: [RouterLink, TextPipe],
  template: `
    @if (items().length) {
      <section class="at no-export" aria-labelledby="at-h">
        <h2 class="at-h" id="at-h">{{ 'Needs your attention' | t: 'staff.dashboard.attention.heading' }}</h2>
        <div class="at-grid">
          @for (i of items(); track i.key) {
            <a class="at-item" [routerLink]="i.link" [queryParams]="i.query" [class.is-zero]="!i.count" [attr.data-key]="i.key">
              <span [class]="'at-icon is-' + i.tone" aria-hidden="true"><svg viewBox="0 0 24 24"><path [attr.d]="icon(i.icon)" /></svg></span>
              <span class="at-text"><b [class]="'is-' + i.tone">{{ i.count.toLocaleString('en-IN') }}</b><span>{{ i.label }}</span></span>
              <svg class="at-go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </a>
          }
        </div>
      </section>
    }
  `,
  styles: `
    .at { margin-bottom: 20px; }
    .at-h { font-size: 11px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #6f8487; margin: 0 0 10px; }
    .at-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
    .at-item { display: flex; align-items: center; gap: 14px; min-height: 72px; padding: 0 16px; background: #fff; border: 1px solid #dde7e8; border-radius: 14px;
      box-shadow: 0 3px 10px rgba(16, 61, 64, .06); color: #17373b; text-decoration: none; }
    .at-item:hover { border-color: #b9cdcf; background: #fbfdfd; }
    .at-item:focus-visible { outline: 2px solid #24666b; outline-offset: 2px; }
    .at-icon { flex: none; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 10px; background: #e6f2f3; color: #24666b; }
    .at-icon.is-warn { background: #fdf2dc; color: #9a5f06; }
    .at-icon.is-bad { background: #fbe9e7; color: #c8473c; }
    .at-icon.is-good { background: #e3f4e8; color: #1e7a3c; }
    svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .at-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .at-text b { font-size: 20px; font-weight: 800; line-height: 22px; color: #24666b; }
    .at-text b.is-warn { color: #9a5f06; }
    .at-text b.is-bad { color: #c8473c; }
    .at-text b.is-good { color: #1e7a3c; }
    .at-text span { font-size: 12.5px; font-weight: 500; line-height: 17px; color: #3d5559; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .at-go { flex: none; width: 16px; height: 16px; color: #6f8487; }
    .is-zero .at-go { opacity: .5; }
  `,
})
export class AttentionRow {
  private readonly service = inject(AttentionService);
  private readonly user = inject(AuthService).currentUser;
  /** The roles whose work the server counts. */
  private readonly allowed = computed(() => ATTENTION_ROLES.includes(this.user()?.roleId ?? 0));
  protected readonly items = computed(() => {
    const items = this.allowed() ? (this.service.data()?.items ?? []) : [];
    const rank = (key: string, i: number) => (ORDER.includes(key) ? ORDER.indexOf(key) : ORDER.length + i);
    return items.map((it, i) => ({ it, r: rank(it.key, i) })).sort((a, b) => a.r - b.r).map((x) => x.it);
  });

  constructor() {
    if (this.allowed()) void this.service.load();
  }

  /** Refresh on the dashboard: the counts again at once. */
  refresh(): void {
    if (this.allowed()) void this.service.refresh();
  }

  protected icon(name: string): string {
    return ICONS[name] ?? ICONS['check'];
  }
}
