import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '@zed/shared';
import { ATTENTION_ROLES, AttentionService } from '../attention';

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
 * work for, and only when it lists items for the login (a count of 0 is greyed). Not part of an export.
 */
@Component({
  selector: 'zed-attention-row',
  imports: [RouterLink],
  template: `
    @if (items().length) {
      <section class="at no-export" aria-labelledby="at-h">
        <h2 class="at-h" id="at-h">Needs your attention</h2>
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
    .at { margin-bottom: 18px; }
    .at-h { font-size: 12px; font-weight: 800; letter-spacing: .9px; text-transform: uppercase; color: #4b5c5d; margin: 0 0 10px; }
    .at-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
    .at-item { display: flex; align-items: center; gap: 12px; padding: 14px 16px; background: #fff; border: 1px solid #e1eaea; border-radius: 12px;
      box-shadow: 0 2px 8px rgba(16, 61, 64, .05); color: #24393b; text-decoration: none; }
    .at-item:hover { border-color: var(--zt-soft, #d4ebe6); background: #fbfdfd; }
    .at-item:focus-visible { outline: 2px solid var(--zt-mid2, #2a8a8c); outline-offset: 2px; }
    .at-icon { flex: none; display: grid; place-items: center; width: 38px; height: 38px; border-radius: 10px; background: #e7f2f1; color: var(--zt-dark, #1f5c61); }
    .at-icon.is-warn { background: #fdf1dc; color: #b26a00; }
    .at-icon.is-bad { background: #fbe4e1; color: #c0392b; }
    .at-icon.is-good { background: #e3f4e8; color: #1e7a3c; }
    svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .at-text { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.25; }
    .at-text b { font-size: 20px; font-weight: 800; color: var(--zt-ink, #173f44); }
    .at-text b.is-warn { color: #b26a00; }
    .at-text b.is-bad { color: #c0392b; }
    .at-text b.is-good { color: #1e7a3c; }
    .at-text span { font-size: 13px; color: #3b4b4c; }
    .at-go { flex: none; width: 16px; height: 16px; color: #8a9899; }
    .is-zero { opacity: .65; }
    .is-zero b { color: #7a8a8b !important; }
  `,
})
export class AttentionRow {
  private readonly service = inject(AttentionService);
  private readonly user = inject(AuthService).currentUser;
  /** The roles whose work the server counts. */
  private readonly allowed = computed(() => ATTENTION_ROLES.includes(this.user()?.roleId ?? 0));
  protected readonly items = computed(() => (this.allowed() ? (this.service.data()?.items ?? []) : []));

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
