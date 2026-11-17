import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashIcon } from './dash-icon';

/** A row of a level's facts: Valid for, Surveillance, Your fee (with a note under the value, e.g. "incl. GST, after subsidy"). */
export interface LevelFact {
  label: string;
  value: string;
  note?: string;
}

/** What one card of "My Certifications" shows; the dashboard works it out from the unit's statuses and the level's settings. */
export interface LevelCardVm {
  code: string;
  name: string;
  logo: string;
  /** A level the Admin added (not Bronze, Silver, Gold or ZED-X). */
  added: boolean;
  /** Closed while another certification runs, or after a higher one. */
  disabled: boolean;
  /** The level the unit would apply for next (outlined). */
  recommended: boolean;
  facts: LevelFact[];
  chip: { label: string; tone: 'done' | 'ready' | 'new' | 'prog' | 'locked' } | null;
  steps: { label: string; cls: string }[];
  /** How much of the progress strip is filled (0–1). */
  fill: number;
  paid: boolean;
  certified: boolean;
  /** The SURVEILLANCE line once a round is open; paid: its fee is paid. */
  surveillance: { paid: boolean } | null;
  reCertification: boolean;
}

/**
 * 2026-11-17 (the user's Home design): one level of "My Certifications": the level's colour bar, its badge, validity,
 * surveillance and the unit's fee, the status chip, a progress strip, and "View details" with the level's action (Apply,
 * Continue or Certificate). The recommended next level is outlined.
 */
@Component({
  selector: 'zed-dash-level-card',
  imports: [RouterLink, DashIcon],
  host: { class: 'd-block h-100' },
  template: `
    @let v = vm();
    <article class="lv-card panel-{{ v.code.toLowerCase() }}" [class.panel-added]="v.added" [class.plant-activity-disabled]="v.disabled" [class.is-rec]="v.recommended">
      @if (v.recommended) { <span class="lv-rec">RECOMMENDED NEXT</span> }
      <div class="panel-heading lv-head">
        <h5>{{ v.name.toUpperCase() }} CERTIFICATION</h5>
        <button type="button" class="lv-info" [attr.aria-label]="'About ' + v.name" (click)="info.emit()"><zed-dash-icon name="info" [size]="17" /></button>
      </div>
      <div class="lv-body">
        <div class="inner2 lv-logo"><img [src]="v.logo" alt="" /></div>
        @if (v.facts.length) {
          <dl class="lv-facts">
            @for (f of v.facts; track f.label) {
              <div><dt>{{ f.label }}</dt><dd><b>{{ f.value }}</b>@if (f.note) { <small>{{ f.note }}</small> }</dd></div>
            }
          </dl>
        }
        @if (v.chip; as c) {
          <p class="lv-status is-{{ c.tone }}">@if (c.tone === 'done') { <zed-dash-icon name="check" [size]="12" [stroke]="3" /> }<span>{{ c.label }}</span></p>
        }
        @if (v.disabled) { <p class="lv-lock-note">Available after your current certification is completed.</p> }
        <div class="stepper lv-steps" [style.--fill]="v.fill" role="img" [attr.aria-label]="v.chip?.label ?? ''">
          <ol>@for (s of v.steps; track $index) { <li [class]="s.cls"><span class="dot"></span></li> }</ol>
          <div class="lv-steps-labels" aria-hidden="true">
            @for (s of v.steps; track $index) { <span [class.on]="s.cls !== ''">{{ s.label }}</span> }
          </div>
        </div>
        <div class="lv-actions">
          @if (v.paid) {
            <a class="btn btn-outline-primary" [routerLink]="['/msme/certification', v.code]">View details</a>
            <a class="btn btn-primary" [routerLink]="['/msme/certification', v.code]" [attr.aria-label]="'Continue ' + v.name">
              @if (v.certified) { <zed-dash-icon name="download" [size]="15" /> Certificate } @else { Continue <zed-dash-icon name="arrow" [size]="15" /> }
            </a>
          } @else {
            <button type="button" class="btn btn-outline-primary" (click)="details.emit()">View details</button>
            <button type="button" class="btn btn-primary apply-btn" (click)="apply.emit()">Apply <zed-dash-icon name="arrow" [size]="15" /></button>
          }
        </div>
        @if (v.surveillance; as s) {
          <div class="lv-extra">
            @if (s.paid) {
              <a [routerLink]="['/msme/certification', v.code + 'Surveillance']">SURVEILLANCE</a>
              <a [routerLink]="['/msme/certification', v.code + 'Surveillance']" [attr.aria-label]="v.name + ' surveillance details'"><zed-dash-icon name="arrow" [size]="16" /></a>
            } @else {
              <a [routerLink]="['/msme/surveillance-payment', v.code]">SURVEILLANCE</a>
              <a [routerLink]="['/msme/surveillance-payment', v.code]" class="btn btn-primary btn-sm">APPLY</a>
            }
          </div>
        }
        @if (v.reCertification) {
          <div class="lv-extra">
            <span class="clickable" (click)="apply.emit()">RE-CERTIFICATION</span>
            <span class="apply-btn btn btn-primary btn-sm" role="button" tabindex="0" (click)="apply.emit()" (keydown.enter)="apply.emit()">APPLY</span>
          </div>
        }
      </div>
    </article>
  `,
  styles: `
    .lv-card { position: relative; display: flex; flex-direction: column; height: 100%; margin: 0; background: #fff; border: 1px solid #dfe7e8; border-radius: 12px;
      box-shadow: 0 2px 8px rgba(16, 61, 64, .06); }
    .lv-card.is-rec { border: 2px solid var(--zt-ink, #173f44); }
    .lv-rec { position: absolute; top: -11px; left: 50%; transform: translateX(-50%); z-index: 2; white-space: nowrap; background: var(--zt-ink, #173f44); color: #fff;
      font-size: 10.5px; font-weight: 700; letter-spacing: .04em; padding: 3px 12px; border-radius: 10px; }
    .lv-card > .lv-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 12px 16px; border: 0; border-radius: 11px 11px 0 0;
      background: var(--zt-mid2, #2a8a8c); color: #fff; }
    .lv-card.is-rec > .lv-head { border-radius: 10px 10px 0 0; }
    .lv-card.panel-bronze > .lv-head { background: #c8693f; }
    .lv-card.panel-silver > .lv-head { background: #9aa3a8; }
    .lv-card.panel-gold > .lv-head { background: #c9a43a; }
    .lv-card.panel-zedx > .lv-head { background: #3d8fa6; }
    .lv-head h5 { margin: 0; min-width: 0; font-size: 12.5px; font-weight: 700; letter-spacing: .03em; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lv-info { background: none; border: 0; padding: 0; color: #fff; opacity: .9; cursor: pointer; }
    .lv-body { display: flex; flex-direction: column; gap: 12px; padding: 16px; flex: 1 1 auto; }
    .lv-logo { align-self: center; }
    .lv-logo img { width: 84px; height: 84px; object-fit: contain; }
    .lv-facts { margin: 0; font-size: 13px; border-top: 1px solid #eef3f3; min-height: 104px; }
    .lv-facts > div { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 8px; padding: 7px 0; border-bottom: 1px solid #eef3f3; }
    .lv-facts dt { color: #5f6f70; font-weight: 500; }
    .lv-facts dd { margin: 0; color: #232527; overflow-wrap: anywhere; }
    .lv-facts dd b { font-weight: 500; }
    .lv-facts > div:last-child dd b { font-weight: 700; }
    .lv-facts dd small { display: block; font-size: 11px; color: #6b7a7b; }
    .lv-status { margin: auto 0 0; align-self: flex-start; display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700; letter-spacing: .04em;
      text-transform: uppercase; border-radius: 12px; padding: 3px 12px; color: #a86a12; background: #fdf1dc; }
    .lv-status.is-done { color: #1e7a3c; background: #e3f4e8; }
    .lv-status.is-ready { color: var(--zt-dark, #1f5c61); background: var(--zt-soft, #d4ebe6); }
    .lv-status.is-new, .lv-status.is-locked { color: #5f6f70; background: #eef1f1; }
    .lv-lock-note { margin: -6px 0 0; font-size: 12px; color: #5f6f70; }
    /* A locked level stays readable (the legacy rule fades it to 0.3). */
    .lv-card.plant-activity-disabled { opacity: 1; }
    .lv-card.plant-activity-disabled .lv-head { filter: grayscale(.5); }
    .lv-card.plant-activity-disabled :is(.lv-logo, .lv-steps, .lv-actions) { opacity: .55; filter: grayscale(.6); }
    .lv-steps ol { position: relative; display: flex; justify-content: space-between; list-style: none; margin: 0; padding: 0; }
    .lv-steps ol::before, .lv-steps ol::after { content: ''; position: absolute; left: 7px; top: 50%; height: 3px; margin-top: -1.5px; border-radius: 2px; }
    .lv-steps ol::before { right: 7px; background: #e1e8e9; }
    .lv-steps ol::after { width: calc((100% - 14px) * var(--fill, 0)); background: #2e9e5b; }
    .lv-steps li { position: relative; z-index: 1; }
    .lv-steps .dot { display: block; width: 14px; height: 14px; border-radius: 7px; background: #fff; border: 2px solid #c3cfd0; }
    .lv-steps li.completed .dot { background: #2e9e5b; border-color: #2e9e5b; }
    .lv-steps li.current .dot { border: 4px solid #2e9e5b; }
    .lv-steps-labels { display: flex; justify-content: space-between; margin-top: 4px; font-size: 11px; color: #6b7a7b; }
    .lv-steps-labels span { flex: 1 1 0; text-align: center; }
    .lv-steps-labels span:first-child { text-align: left; }
    .lv-steps-labels span:last-child { text-align: right; }
    .lv-steps-labels span.on { color: #1e7a3c; font-weight: 600; }
    .lv-actions { display: flex; gap: 8px; }
    .lv-actions .btn { flex: 1 1 0; display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; font-size: 13px; font-weight: 700;
      padding: 7px 8px; border-radius: 8px; }
    .lv-actions .btn-outline-primary { background: #fff; color: var(--zt-dark, #1f5c61); border: 1.5px solid var(--zt-dark, #1f5c61); }
    .lv-extra { display: flex; justify-content: space-between; align-items: center; gap: 8px; border-top: 1px dashed #dfe9ea; padding-top: 8px; font-size: 12.5px; font-weight: 700; }
    .lv-extra a:not(.btn), .lv-extra .clickable { color: var(--zt-mid2, #2a8a8c); text-decoration: none; cursor: pointer; }
  `,
})
export class LevelCard {
  readonly vm = input.required<LevelCardVm>();
  /** The level's information pop-up. */
  readonly info = output<void>();
  /** "View details" of a level not applied for: its pop-up. */
  readonly details = output<void>();
  /** APPLY (or RE-CERTIFICATION): the disclaimer, instructions and payment. */
  readonly apply = output<void>();
}
