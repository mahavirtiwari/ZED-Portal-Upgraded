import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TextPipe } from '../../content/page-text';
import { DashIcon } from './dash-icon';

/** A row of a level's facts: Valid for, Surveillance, Your fee (with a note under the value, e.g. "incl. GST, after subsidy"). */
export interface LevelFact {
  /** Which fact it is (the label is the Admin's wording, so the code goes by this). */
  id?: 'valid' | 'surveillance' | 'fee';
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
 * Continue or Certificate). 2026-11-18 (the user): no "Recommended next" tag or outline.
 * 2026-11-18 (the user's applicant designs): the header colours, sizes and spacing of zed-msme-00-home-dashboard.svg, the
 * certified chip with its date ("CERTIFIED · 14 NOV 2026"), two equal 34px buttons, and the extra lines in title case.
 * 2026-11-19 (the user: "All page wording"): its wording through the t pipe (msme.dashboard.levelCard.*).
 */
@Component({
  selector: 'zed-dash-level-card',
  imports: [RouterLink, DashIcon, TextPipe],
  host: { class: 'd-block h-100' },
  template: `
    @let v = vm();
    <article class="lv-card panel-{{ v.code.toLowerCase() }}" [class.panel-added]="v.added" [class.plant-activity-disabled]="v.disabled">
      <div class="panel-heading lv-head">
        <h5>{{ '{level} CERTIFICATION' | t: 'msme.dashboard.levelCard.title' : { level: v.name.toUpperCase() } }}</h5>
        <button type="button" class="lv-info" [attr.aria-label]="'About {level}' | t: 'msme.dashboard.levelCard.infoAria' : { level: v.name }" (click)="info.emit()"><zed-dash-icon name="info" [size]="18" /></button>
      </div>
      <div class="lv-body">
        <div class="inner2 lv-logo"><img [src]="v.logo" alt="" /></div>
        @if (v.facts.length) {
          <dl class="lv-facts">
            @for (f of v.facts; track f.label) {
              <div [class.lv-fee]="!!f.note"><dt>{{ f.label }}</dt><dd><b>{{ f.value }}</b>@if (f.note) { <small>{{ f.note }}</small> }</dd></div>
            }
          </dl>
        }
        @if (v.chip; as c) {
          <p class="lv-status is-{{ c.tone }}">@if (c.tone === 'done') { <zed-dash-icon name="check" [size]="12" [stroke]="3" /> }<span>{{ c.label }}</span></p>
        }
        @if (v.disabled) { <p class="lv-lock-note">{{ 'Available after your current certification is completed.' | t: 'msme.dashboard.levelCard.lockedNote' }}</p> }
        <div class="stepper lv-steps" [style.--fill]="v.fill" role="img" [attr.aria-label]="v.chip?.label ?? ''">
          <ol>@for (s of v.steps; track $index) { <li [class]="s.cls"><span class="dot"></span></li> }</ol>
          <div class="lv-steps-labels" aria-hidden="true">
            @for (s of v.steps; track $index) { <span [class.on]="s.cls !== ''">{{ s.label }}</span> }
          </div>
        </div>
        <div class="lv-actions">
          @if (v.paid) {
            <a class="btn btn-outline-primary" [routerLink]="['/msme/certification', v.code]">{{ 'View details' | t: 'msme.dashboard.levelCard.detailsButton' }}</a>
            <a class="btn btn-primary" [routerLink]="['/msme/certification', v.code]" [attr.aria-label]="'Continue {level}' | t: 'msme.dashboard.levelCard.continueAria' : { level: v.name }">
              @if (v.certified) { <zed-dash-icon name="download" [size]="15" /> {{ 'Certificate' | t: 'msme.dashboard.levelCard.certificateButton' }} }
              @else { {{ 'Continue' | t: 'msme.dashboard.levelCard.continueButton' }} <zed-dash-icon name="arrow" [size]="15" /> }
            </a>
          } @else {
            <button type="button" class="btn btn-outline-primary" (click)="details.emit()">{{ 'View details' | t: 'msme.dashboard.levelCard.detailsButton' }}</button>
            <button type="button" class="btn btn-primary apply-btn" (click)="apply.emit()">{{ 'Apply' | t: 'msme.dashboard.levelCard.applyButton' }} <zed-dash-icon name="arrow" [size]="15" /></button>
          }
        </div>
        @if (v.surveillance; as s) {
          <div class="lv-extra">
            @if (s.paid) {
              <a [routerLink]="['/msme/certification', v.code + 'Surveillance']">{{ 'Surveillance' | t: 'msme.dashboard.levelCard.surveillanceLink' }}</a>
              <a [routerLink]="['/msme/certification', v.code + 'Surveillance']" [attr.aria-label]="'{level} surveillance details' | t: 'msme.dashboard.levelCard.surveillanceAria' : { level: v.name }"><zed-dash-icon name="arrow" [size]="16" /></a>
            } @else {
              <a [routerLink]="['/msme/surveillance-payment', v.code]">{{ 'Surveillance' | t: 'msme.dashboard.levelCard.surveillanceLink' }}</a>
              <a [routerLink]="['/msme/surveillance-payment', v.code]" class="btn btn-primary btn-sm">{{ 'Apply' | t: 'msme.dashboard.levelCard.applyButton' }}</a>
            }
          </div>
        }
        @if (v.reCertification) {
          <div class="lv-extra">
            <span class="clickable" (click)="apply.emit()">{{ 'Re-certification' | t: 'msme.dashboard.levelCard.reCertification' }}</span>
            <span class="apply-btn btn btn-primary btn-sm" role="button" tabindex="0" (click)="apply.emit()" (keydown.enter)="apply.emit()">{{ 'Apply' | t: 'msme.dashboard.levelCard.applyButton' }}</span>
          </div>
        }
      </div>
    </article>
  `,
  styles: `
    .lv-card { position: relative; display: flex; flex-direction: column; height: 100%; margin: 0; background: #fff; border: 1px solid #dde7e8; border-radius: 14px;
      box-shadow: 0 3px 10px rgba(16, 61, 64, .09); }
    .lv-card > .lv-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; height: 44px; padding: 0 14px 0 16px; border: 0;
      border-radius: 13px 13px 0 0; background: var(--zt-mid2, #2a8a8c); color: #fff; }
    .lv-card.panel-bronze > .lv-head { background: #c9714f; }
    .lv-card.panel-silver > .lv-head { background: #a5abb0; }
    .lv-card.panel-gold > .lv-head { background: #c9a23f; }
    .lv-card.panel-zedx > .lv-head { background: #3c8f99; }
    .lv-head h5 { margin: 0; min-width: 0; font-size: 12px; font-weight: 700; letter-spacing: .5px; color: #fff; white-space: normal; overflow-wrap: break-word; }
    .lv-info { background: none; border: 0; padding: 0; color: #fff; cursor: pointer; }
    .lv-body { display: flex; flex-direction: column; gap: 12px; padding: 16px 16px 12px; flex: 1 1 auto; }
    .lv-logo { align-self: center; }
    .lv-logo img { width: 84px; height: 84px; object-fit: contain; }
    .lv-facts { margin: 4px 0 0; font-size: 13px; border-top: 1px solid #dde7e8; min-height: 104px; }
    .lv-facts > div { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 8px; align-items: baseline; padding: 7px 0; border-bottom: 1px solid #dde7e8; }
    .lv-facts dt { font-size: 12.5px; font-weight: 500; color: #6f8487; }
    .lv-facts dd { margin: 0; color: #17373b; overflow-wrap: anywhere; }
    .lv-facts dd b { font-weight: 600; }
    .lv-facts .lv-fee dd b { font-size: 16px; font-weight: 800; }
    .lv-facts dd small { display: block; font-size: 11px; font-weight: 500; color: #6f8487; }
    .lv-status { margin: auto 0 0; align-self: flex-start; display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; font-weight: 700; line-height: 14px;
      letter-spacing: .4px; text-transform: uppercase; border-radius: 11px; padding: 4px 12px; color: #9a5f06; background: #fdf2dc; }
    .lv-status.is-done { color: #2f9e58; background: #e5f5ea; }
    .lv-status.is-ready { color: var(--zt-dark, #24666b); background: #e6f2f3; }
    .lv-status.is-new, .lv-status.is-locked { color: #6f8487; background: #ecf0f0; }
    .lv-lock-note { margin: -6px 0 0; font-size: 12px; color: #6f8487; }
    /* A locked level stays readable (the legacy rule fades it to 0.3); its colour bar keeps the level's colour. */
    .lv-card.plant-activity-disabled { opacity: 1; }
    .lv-card.plant-activity-disabled :is(.lv-logo, .lv-steps, .lv-actions) { opacity: .55; filter: grayscale(.6); }
    .lv-steps { margin-top: 2px; }
    .lv-steps ol { position: relative; display: flex; justify-content: space-between; list-style: none; margin: 0; padding: 0; }
    .lv-steps ol::before, .lv-steps ol::after { content: ''; position: absolute; left: 7px; top: 50%; height: 3px; margin-top: -1.5px; border-radius: 2px; }
    .lv-steps ol::before { right: 7px; background: #d5dfe0; }
    .lv-steps ol::after { width: calc((100% - 14px) * var(--fill, 0)); background: #2f9e58; }
    .lv-steps li { position: relative; z-index: 1; }
    .lv-steps .dot { display: block; width: 14px; height: 14px; border-radius: 7px; background: #fff; border: 2px solid #c3d0d2; }
    .lv-steps li.completed .dot { background: #2f9e58; border-color: #2f9e58; }
    .lv-steps li.current .dot { border: 4px solid #2f9e58; }
    .lv-steps-labels { display: flex; justify-content: space-between; margin-top: 6px; font-size: 10.5px; font-weight: 600; color: #6f8487; }
    .lv-steps-labels span { flex: 1 1 0; text-align: center; }
    .lv-steps-labels span:first-child { text-align: left; }
    .lv-steps-labels span:last-child { text-align: right; }
    .lv-steps-labels span.on { color: #2f9e58; }
    .lv-actions { display: flex; gap: 10px; margin-top: -4px; }
    .lv-actions .btn { flex: 1 1 0; min-width: 0; height: 34px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 8px;
      white-space: nowrap; font-size: 12.5px; font-weight: 700; border-radius: 9px; }
    .lv-extra { display: flex; justify-content: space-between; align-items: center; gap: 8px; border-top: 1px dashed #dde7e8; padding-top: 8px; font-size: 12.5px; font-weight: 700; }
    .lv-extra a:not(.btn), .lv-extra .clickable { color: var(--zt-dark, #24666b); text-decoration: none; cursor: pointer; }
  `,
})
export class LevelCard {
  readonly vm = input.required<LevelCardVm>();
  /** The level's information pop-up. */
  readonly info = output<void>();
  /** "View details" of a level not applied for: its pop-up. */
  readonly details = output<void>();
  /** Apply (or Re-certification): the disclaimer, instructions and payment. */
  readonly apply = output<void>();
}
