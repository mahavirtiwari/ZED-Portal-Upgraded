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
    .inc-card { display: flex; flex-direction: column; height: 100%; background: #fff; border: 1px solid #dfe7e8; border-radius: 12px; padding: 16px 16px 0;
      box-shadow: 0 2px 8px rgba(16, 61, 64, .05); }
    .inc-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
    .inc-ic { width: 44px; height: 44px; border-radius: 8px; display: grid; place-items: center; background: #eef3f3; color: var(--zt-dark, #1f5c61); }
    .inc-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
      border-radius: 10px; padding: 3px 10px; }
    .inc-chip.is-availed { color: #1e7a3c; background: #e3f4e8; }
    .inc-chip.is-open { color: var(--zt-dark, #1f5c61); background: var(--zt-soft, #d4ebe6); }
    .inc-chip.is-progress { color: #a8620f; background: #fdeed6; }
    .inc-chip.is-locked { color: #7a8a8b; background: #eef1f1; }
    h4 { margin: 0 0 2px; font-size: 16px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .inc-hl { margin: 0 0 4px; font-size: 13.5px; font-weight: 700; color: var(--zt-dark, #1f5c61); }
    .inc-txt { margin: 0 0 12px; font-size: 12.5px; color: #5f6f70; white-space: pre-line; }
    .inc-txt.clamp { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .inc-note { margin: 0 0 10px; font-size: 12px; color: #7a8a8b; }
    .inc-foot { margin-top: auto; border-top: 1px solid #eef3f3; padding: 11px 0 12px; }
    .inc-foot .inc-note { margin: 0; }
    .inc-foot a, .inc-foot button { display: flex; width: 100%; justify-content: space-between; align-items: center; background: none; border: 0; padding: 0;
      font-size: 13.5px; font-weight: 700; color: var(--zt-ink, #173f44); text-decoration: none; cursor: pointer; }
    .inc-foot a:hover, .inc-foot button:hover { color: var(--zt-mid2, #2a8a8c); }
    .is-locked :is(h4, .inc-hl, .inc-txt, .inc-ic) { opacity: .6; }
  `,
})
export class IncentiveTile {
  readonly tile = input.required<IncentiveTileVm>();
  /** The card's button (a card without a link): the dashboard opens its pop-up. */
  readonly act = output<void>();
  protected readonly chip = computed(() => CHIPS[this.tile().state]);
}
