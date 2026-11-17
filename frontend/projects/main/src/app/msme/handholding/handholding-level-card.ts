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
  // 2026-11-18 (the user's applicant designs): sizes and colours of zed-msme-04 (416 × 176 card, 14px corners, the 6px
  // level colour bar, the active card outlined in dark teal, dots centred over their labels).
  styles: `
    .hh-card { position: relative; height: 100%; min-height: 176px; background: #fff; border: 1px solid #dde7e8; border-top: 6px solid #a5abb0; border-radius: 14px;
      padding: 18px 24px 16px; box-shadow: 0 3px 10px rgba(23, 55, 59, .08); display: flex; flex-direction: column; gap: 0; }
    .hh-card.hh-gold { border-top-color: #c9a23f; }
    .hh-card.hh-zedx { border-top-color: #3c8f99; }
    .hh-card.is-active { border: 2px solid #24666b; border-top: 6px solid #a5abb0; padding: 17px 23px 15px; }
    .hh-card.is-active.hh-gold { border-top-color: #c9a23f; }
    .hh-card.is-active.hh-zedx { border-top-color: #3c8f99; }
    .hh-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .hh-pick { display: flex; align-items: center; gap: 16px; min-width: 0; padding: 0; background: none; border: 0; text-align: left; cursor: pointer; }
    .hh-badge img { width: 48px; height: 48px; object-fit: contain; }
    .hh-id { display: flex; flex-direction: column; gap: 4px; min-width: 0; padding-top: 6px; }
    .hh-id small { font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #6f8487; line-height: 1.2; }
    .hh-name { font-size: 17px; font-weight: 700; color: #17373b; line-height: 1.25; overflow-wrap: anywhere; }
    .hh-side { display: flex; align-items: center; gap: 6px; flex: none; padding-top: 6px; }
    .hh-apply { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 14px; font-size: 13px; font-weight: 700; border-radius: 9px; background: #fff;
      color: #24666b; border: 1.5px solid #24666b; text-transform: none; }
    .hh-apply:hover { background: #e6f2f3; color: #24666b; border-color: #24666b; }
    .hh-apply svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .hh-viewing { font-size: 11.5px; font-weight: 600; color: #24666b; }
    .hh-link { background: none; border: 0; padding: 0; font-size: 11.5px; font-weight: 600; color: #24666b; cursor: pointer; }
    .hh-info { background: none; border: 0; padding: 0 0 0 2px; cursor: pointer; }
    .hh-info img { width: 16px; }
    .hh-chip { align-self: flex-start; margin: 4px 0 0 64px; font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; line-height: 22px;
      border-radius: 11px; padding: 0 14px; color: #6f8487; background: #ecf0f0; }
    .hh-chip.is-prog { color: #9a5f06; background: #fdf2dc; }
    .hh-chip.is-done { color: #1e7a3c; background: #e3f4e8; }
    /* Four dots at fixed points (20px in from each side), each label centred under its dot. */
    .hh-track { position: relative; display: flex; justify-content: space-between; list-style: none; margin: auto 0 0; padding: 22px 20px 0; }
    .hh-track::before { content: ''; position: absolute; left: 20px; right: 20px; top: 29.5px; height: 3px; border-radius: 2px; background: #d5dfe0; }
    .hh-track li { position: relative; flex: 0 0 0; width: 0; display: flex; flex-direction: column; align-items: center; gap: 9px; }
    .dot { box-sizing: border-box; width: 16px; height: 16px; flex: none; border-radius: 50%; background: #fff; border: 2px solid #c3d0d2; }
    .lbl { font-size: 11px; font-weight: 600; color: #6f8487; white-space: nowrap; }
    li.done .dot { background: #2e9e5b; border-color: #2e9e5b; }
    li.done .lbl { color: #1e7a3c; }
    li.now .dot { width: 18px; height: 18px; margin: -1px 0; border: 3px solid #d98a12; }
    li.now .lbl { color: #9a5f06; }
    @media (max-width: 400px) { .hh-card { padding-left: 16px; padding-right: 16px; } .hh-top { flex-wrap: wrap; } .hh-chip { margin-left: 0; } }
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
