import { Component, input, output } from '@angular/core';
import { HandholdingLevel } from './handholding.api';

/** One point of a level card's milestone tracker (Baseline, Review 1, Review 2, Complete). */
export interface TrackPoint {
  label: string;
  done: boolean;
  now: boolean;
}

/** What one level card shows; the page works it out from the unit's handholding status. */
export interface LevelCardVm {
  code: HandholdingLevel;
  name: string;
  logo: string;
  chip: { label: string; tone: 'prog' | 'new' | 'done' };
  points: TrackPoint[];
  /** Not started and the server says it can be paid now: Apply leads to the payment. */
  canApply: boolean;
  /** Its milestones are open below (the card is outlined). */
  selected: boolean;
}

/**
 * 2026-11-17 (the user's Handholding support design): one handholding level open to the unit: its colour bar, badge,
 * "HANDHOLDING FOR <Level>", the status chip, the four-point milestone tracker, and Apply for a level not started yet.
 * The level whose milestones are shown below is outlined.
 */
@Component({
  selector: 'zed-hh-level-card',
  host: { class: 'd-block h-100' },
  template: `
    @let v = vm();
    <article class="hh-card hh-{{ v.code.toLowerCase() }}" [class.is-active]="v.selected" [attr.data-level]="v.code">
      <div class="hh-top">
        <button type="button" class="hh-pick" [attr.aria-pressed]="v.selected" [attr.aria-label]="'Show ' + v.name + ' handholding milestones'" (click)="pick.emit()">
          <span class="hh-badge"><img [src]="v.logo" alt="" /></span>
          <span class="hh-id"><small>Handholding for</small><strong class="hh-name">{{ v.name }}</strong></span>
        </button>
        <div class="hh-side">
          @if (v.canApply) {
            <button type="button" class="btn hh-apply" (click)="apply.emit()">Apply
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          } @else if (v.selected) {
            <span class="hh-viewing">Viewing below</span>
          } @else {
            <button type="button" class="hh-link" (click)="pick.emit()">View milestones</button>
          }
          <button type="button" class="hh-info" [attr.aria-label]="'About Handholding for ' + v.name + ' Level'" (click)="info.emit()"><img src="/Images/svgicons/infoIcon.svg" alt="" /></button>
        </div>
      </div>
      <p class="hh-chip is-{{ v.chip.tone }}">{{ v.chip.label }}</p>
      <ol class="hh-track" [attr.aria-label]="v.name + ' milestones'">
        @for (p of v.points; track p.label) {
          <li [class.done]="p.done" [class.now]="p.now" [attr.aria-current]="p.now ? 'step' : null"><span class="dot"></span><span class="lbl">{{ p.label }}</span></li>
        }
      </ol>
    </article>
  `,
  styles: `
    .hh-card { position: relative; height: 100%; background: #fff; border: 1px solid #dfe7e8; border-top: 6px solid #9aa3a8; border-radius: 12px;
      padding: 16px 18px 14px; box-shadow: 0 2px 8px rgba(16, 61, 64, .06); display: flex; flex-direction: column; gap: 10px; }
    .hh-card.hh-gold { border-top-color: #c9a43a; }
    .hh-card.hh-zedx { border-top-color: var(--zt-mid2, #2a8a8c); }
    .hh-card.is-active { border: 2px solid var(--zt-ink, #173f44); border-top-width: 6px; padding: 15px 17px 13px; }
    .hh-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .hh-pick { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 0; background: none; border: 0; text-align: left; cursor: pointer; }
    .hh-badge img { width: 50px; height: 50px; object-fit: contain; }
    .hh-id { display: flex; flex-direction: column; min-width: 0; }
    .hh-id small { font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #5f6f70; }
    .hh-name { font-size: 17px; color: var(--zt-ink, #173f44); overflow-wrap: anywhere; }
    .hh-side { display: flex; align-items: center; gap: 6px; flex: none; }
    .hh-apply { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; font-size: 13.5px; font-weight: 700; border-radius: 8px; background: #fff;
      color: var(--zt-dark, #1f5c61); border: 1.5px solid var(--zt-dark, #1f5c61); }
    .hh-apply:hover { background: var(--zt-soft, #d4ebe6); }
    .hh-apply svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
    .hh-viewing { font-size: 12.5px; color: var(--zt-dark, #1f5c61); }
    .hh-link { background: none; border: 0; padding: 0; font-size: 12.5px; font-weight: 600; color: var(--zt-mid2, #2a8a8c); cursor: pointer; }
    .hh-info { background: none; border: 0; padding: 0 0 0 2px; cursor: pointer; }
    .hh-info img { width: 16px; }
    .hh-chip { align-self: flex-start; margin: 0 0 0 62px; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
      border-radius: 12px; padding: 3px 12px; color: #5f6f70; background: #eef1f1; }
    .hh-chip.is-prog { color: #a86a12; background: #fdf1dc; }
    .hh-chip.is-done { color: #1e7a3c; background: #e3f4e8; }
    .hh-track { position: relative; display: flex; justify-content: space-between; list-style: none; margin: 6px 0 0; padding: 0; }
    .hh-track::before { content: ''; position: absolute; left: 8px; right: 8px; top: 7px; height: 2px; background: #dfe7e8; }
    .hh-track li { position: relative; flex: 1 1 0; display: flex; flex-direction: column; align-items: center; gap: 5px; min-width: 0; }
    .hh-track li:first-child { align-items: flex-start; }
    .hh-track li:last-child { align-items: flex-end; }
    .dot { width: 16px; height: 16px; border-radius: 50%; background: #fff; border: 2px solid #c3cfd0; }
    .lbl { font-size: 11.5px; color: #5f6f70; white-space: nowrap; }
    li.done .dot { background: #2e9e5b; border-color: #2e9e5b; }
    li.done .lbl { color: #1e7a3c; }
    li.now .dot { border: 3px solid #d98a1c; }
    li.now .lbl { color: #a86a12; font-weight: 700; }
    @media (max-width: 400px) { .hh-top { flex-wrap: wrap; } .hh-chip { margin-left: 0; } }
  `,
})
export class HandholdingLevelCard {
  readonly vm = input.required<LevelCardVm>();
  /** Show this level's milestones below. */
  readonly pick = output<void>();
  /** Apply: the disclaimer, instructions and payment of the level's first milestone. */
  readonly apply = output<void>();
  /** The level's information pop-up. */
  readonly info = output<void>();
}
