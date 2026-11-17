import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashIcon } from './dash-icon';

export type IncentiveState = 'availed' | 'open' | 'progress' | 'locked';

/** What one card of "My Incentives" shows; the dashboard works it out from the unit's eligibility and statuses. */
export interface IncentiveTileVm {
  key: string;
  icon: string;
  title: string | null;
  highlight: string | null;
  details: string | null;
  state: IncentiveState;
  /** The card's link (routerLink, with its query) or, without a link, a button the dashboard handles; null: no action. */
  action: { label: string; link?: string; query?: Record<string, string> } | null;
  /** Why a locked card is locked. */
  note: string | null;
  /** Long texts (the Admin's incentives) clamped to three lines. */
  clamp?: boolean;
}

const CHIPS: Record<IncentiveState, string> = { availed: 'Availed', open: 'Open', progress: 'In progress', locked: 'Locked' };

/**
 * 2026-11-17 (the user's Home design): one incentive: its icon and status chip (Availed / Open / In progress / Locked), the
 * title, the amount, a line of text, and the action at the foot; a locked card says why instead.
 * 2026-11-18 (the user's applicant designs): the design's sizes and colours (teal action, a locked card faded as a whole).
 */
@Component({
  selector: 'zed-dash-incentive',
  imports: [RouterLink, DashIcon],
  host: { class: 'd-block h-100' },
  template: `
    @let t = tile();
    <article class="inc-card" [class.is-locked]="t.state === 'locked'">
      <div class="inc-top">
        <span class="inc-ic"><zed-dash-icon [name]="t.icon" [size]="22" [stroke]="1.8" /></span>
        <span class="inc-chip is-{{ t.state }}">@if (t.state === 'locked') { <zed-dash-icon name="lock" [size]="11" /> }{{ chip() }}</span>
      </div>
      <h4>{{ t.title }}</h4>
      @if (t.highlight) { <p class="inc-hl">{{ t.highlight }}</p> }
      <p class="inc-txt" [class.clamp]="t.clamp">{{ t.details }}</p>
      @if (t.action && t.note) { <p class="inc-note">{{ t.note }}</p> }
      <div class="inc-foot">
        @if (t.action; as a) {
          @if (a.link) {
            <a [routerLink]="a.link" [queryParams]="a.query ?? null">{{ a.label }} <zed-dash-icon name="arrow" [size]="16" /></a>
          } @else {
            <button type="button" (click)="act.emit()">{{ a.label }} <zed-dash-icon name="arrow" [size]="16" /></button>
          }
        } @else {
          <span class="inc-note">{{ t.note }}</span>
        }
      </div>
    </article>
  `,
  styles: `
    .inc-card { display: flex; flex-direction: column; height: 100%; min-height: 204px; background: #fff; border: 1px solid #dde7e8; border-radius: 14px;
      padding: 16px 16px 0; box-shadow: 0 3px 10px rgba(16, 61, 64, .09); }
    .inc-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .inc-ic { width: 44px; height: 44px; border-radius: 10px; display: grid; place-items: center; background: #e6f2f3; color: var(--zt-dark, #24666b); }
    .inc-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 700; line-height: 14px; letter-spacing: .4px;
      text-transform: uppercase; border-radius: 11px; padding: 4px 12px; }
    .inc-chip.is-availed { color: #2f9e58; background: #e5f5ea; }
    .inc-chip.is-open { color: var(--zt-dark, #24666b); background: #e6f2f3; }
    .inc-chip.is-progress { color: #9a5f06; background: #fdf2dc; }
    .inc-chip.is-locked { color: #6f8487; background: #ecf0f0; }
    h4 { margin: 0 0 3px; font-size: 15.5px; font-weight: 700; color: #17373b; }
    .inc-hl { margin: 0 0 3px; font-size: 12.5px; font-weight: 700; color: var(--zt-dark, #24666b); }
    .inc-txt { margin: 0 0 12px; font-size: 12px; font-weight: 500; line-height: 16px; color: #6f8487; white-space: pre-line; }
    .inc-txt.clamp { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .inc-note { margin: 0 0 10px; font-size: 12px; color: #6f8487; }
    .inc-foot { margin: auto -16px 0; border-top: 1px solid #dde7e8; padding: 11px 16px 13px; }
    .inc-foot .inc-note { margin: 0; font-size: 12.5px; font-weight: 600; }
    .inc-foot a, .inc-foot button { display: flex; width: 100%; justify-content: space-between; align-items: center; background: none; border: 0; padding: 0;
      font-size: 13px; font-weight: 700; color: var(--zt-dark, #24666b); text-decoration: none; cursor: pointer; }
    .inc-foot a:hover, .inc-foot button:hover { color: var(--zt-ink, #1a4c50); }
    .inc-card.is-locked { opacity: .62; }
  `,
})
export class IncentiveTile {
  readonly tile = input.required<IncentiveTileVm>();
  /** The card's button (a card without a link): the dashboard opens its pop-up. */
  readonly act = output<void>();
  protected readonly chip = computed(() => CHIPS[this.tile().state]);
}
