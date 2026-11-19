import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ContentTextComponent } from '../../content/content-text';
import { PaymentBilling, PaymentStep } from '../payment/payment-step';
import { PageHead } from '../shared/page-head';
import { StepTracker, TrackerStep } from '../shared/step-tracker';
import { TextPipe, t } from '../../content/page-text';
import { LevelFact } from './level-card';

export type ApplyStep = 'disclaimer' | 'instructions' | 'payment';

/** What the right rail of the disclaimer shows about the level being applied for (the dashboard's data). */
export interface ApplyLevelVm {
  code: string;
  name: string;
  logo: string;
  unitName: string;
  zedId: string;
  /** Your fee, Valid for, Surveillance (Administration → Certification Levels, Master → Payments). */
  facts: LevelFact[];
  /** "Desktop check and site visit" or "Desktop assessment". */
  assessment: string;
  reCertification: boolean;
  /** The Joining Reward already used: on which level and when (the dashboard's IsCouponUsed, LatestCertification, DateOfAvail). */
  rewardUsed: { level: string; date: string } | null;
}

/**
 * 2026-11-17 (the user's apply-and-pay designs): the apply flow of the dashboard. A page head "Apply for <Level> Certification"
 * with "Step n of 4", the four-step tracker (Disclaimer, Fee & tax details, Payment, Confirmation), then:
 * the disclaimer (the Admin's texts as they are, an explicit consent tick before Accept & proceed, the consent bar pinned to
 * the bottom on a laptop; on the right "You are applying for" and "Key points at a glance"), the instructions (also step 1),
 * and the fee step (zed-payment-step). The dashboard keeps which step is open.
 * 2026-11-19 (the user: "All page wording"): its wording through the t pipe and t() (msme.apply.*).
 */
@Component({
  selector: 'zed-apply-flow',
  imports: [FormsModule, ContentTextComponent, PageHead, StepTracker, PaymentStep, TextPipe],
  template: `
    @let v = vm();
    <zed-page-head [crumbs]="crumbs()" [title]="'Apply for {level} Certification' | t: 'msme.apply.title' : { level: v.name }" [subtitle]="subtitle()">
      <button type="button" class="btn btn-ph" (click)="go.emit(step() === 'payment' ? 'disclaimer' : 'home')">{{ '← Back' | t: 'msme.apply.backButton' }}</button>
    </zed-page-head>
    <zed-step-tracker class="af-tracker" [steps]="steps()" [current]="step() === 'payment' ? 1 : 0" [label]="'Application steps' | t: 'msme.apply.steps.label'" />

    @if (step() === 'payment') {
      <zed-payment-step [certification]="v.code" [billing]="billing()" (back)="go.emit('home')" (previous)="go.emit('disclaimer')" />
    } @else {
      <div class="af-cols">
        <section class="af-card disclaimer-sec" [attr.aria-labelledby]="'afTitle'">
          <header class="af-head">
            <span class="af-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" /><path d="M9 12l2 2 4-4" /></svg></span>
            <h3 id="afTitle">{{ step() === 'disclaimer' ? ('Disclaimer / declaration' | t: 'msme.apply.disclaimer.title') : ('Instructions' | t: 'msme.apply.instructions.title') }}</h3>
          </header>
          <div class="af-body disclaimer-points">
            @if (step() === 'disclaimer') {
              <!-- Points 5–6 are not shown for a re-certification: the last point is then number 5. -->
              <zed-text key="msme.certification.payment.disclaimer" [required]="true" />
              @if (!v.reCertification) {
                <zed-text key="msme.certification.payment.disclaimer.firstCertification" />
                <zed-text key="msme.certification.payment.disclaimer.closing" [values]="{ Number: 7 }" />
              } @else {
                <zed-text key="msme.certification.payment.disclaimer.closing" [values]="{ Number: 5 }" />
              }
            } @else {
              <zed-text key="msme.certification.payment.instructions" [required]="true" />
            }
          </div>
          <div class="af-bar">
            @if (step() === 'disclaimer') {
              <label class="af-consent">
                <input type="checkbox" name="consent" [ngModel]="consent()" (ngModelChange)="consent.set($event)" />
                <span>{{ 'I have read and understood the disclaimer and accept it on behalf of {unit}.' | t: 'msme.apply.consent.label' : { unit: v.unitName || ('my unit' | t: 'msme.apply.consent.myUnit') } }}</span>
              </label>
            }
            <div class="af-actions">
              <button type="button" class="btn af-soft" (click)="go.emit('home')">{{ '← Back to dashboard' | t: 'msme.apply.dashboardButton' }}</button>
              <button type="button" class="btn btn-primary af-go" [disabled]="!textsLoaded() || (step() === 'disclaimer' && !consent())"
                      (click)="go.emit(step() === 'disclaimer' ? 'instructions' : 'payment')">{{ 'Accept & proceed →' | t: 'msme.apply.acceptButton' }}</button>
              <span class="af-free">{{ 'Nothing is charged at this step.' | t: 'msme.apply.freeNote' }}</span>
            </div>
          </div>
        </section>

        <aside class="af-rail">
          <section class="af-card" aria-labelledby="afApplying">
            <h3 class="af-rh" id="afApplying">{{ 'You are applying for' | t: 'msme.apply.rail.applyingTitle' }}</h3>
            <div class="af-level">
              <img [src]="v.logo" alt="" />
              <div><b>{{ '{level} Certification' | t: 'msme.apply.rail.level' : { level: v.name } }}</b><small>{{ v.unitName }}{{ v.unitName && v.zedId ? ' · ' : '' }}{{ v.zedId }}</small></div>
            </div>
            <dl class="af-facts">
              @for (f of v.facts; track f.label) { <div><dt>{{ f.label }}</dt><dd>{{ f.value }}@if (f.note) { <small> {{ f.note }}</small> }</dd></div> }
              <div><dt>{{ 'Assessment' | t: 'msme.apply.rail.assessmentLabel' }}</dt><dd>{{ v.assessment }}</dd></div>
            </dl>
          </section>
          <section class="af-card" aria-labelledby="afKey">
            <h3 class="af-rh" id="afKey">{{ 'Key points at a glance' | t: 'msme.apply.keys.title' }}</h3>
            <ul class="af-keys">
              <li><span class="k-warn" aria-hidden="true">!</span>{{ 'The fee is non-refundable, non-adjustable and non-transferable.' | t: 'msme.apply.keys.fee' }}</li>
              <li><span aria-hidden="true">★</span>
                @if (v.rewardUsed; as r) {
                  @if (r.date) { {{ 'The Joining Reward works once. You used it on {level} ({date}).' | t: 'msme.apply.keys.rewardUsedOn' : { level: r.level, date: r.date } }} }
                  @else { {{ 'The Joining Reward works once. You used it on {level}.' | t: 'msme.apply.keys.rewardUsed' : { level: r.level } }} }
                }
                @else { {{ 'The Joining Reward works once: once used on a level, it cannot be used again.' | t: 'msme.apply.keys.reward' }} }
              </li>
              <li><span aria-hidden="true">₹</span>{{ 'Subsidy is already applied; you pay only the beneficiary contribution.' | t: 'msme.apply.keys.subsidy' }}</li>
              <li><span aria-hidden="true">◷</span>{{ 'Late documents or responses can forfeit the amount paid.' | t: 'msme.apply.keys.late' }}</li>
            </ul>
          </section>
        </aside>
      </div>
    }
  `,
  // 2026-11-18 (the user's applicant designs, zed-msme-06): the 104px tracker card with 30px dots, 56px card heads, the clauses
  // numbered in 24px grey-teal circles (13px text on 20px lines), the 42px buttons, the rail's 34px rows and 34px key-point tiles.
  styles: `
    .af-tracker { margin-bottom: 20px; }
    .af-tracker ::ng-deep {
      .st { min-height: 104px; padding: 19px 12px 10px; border-color: #dde7e8; border-radius: 14px; box-shadow: 0 3px 10px rgba(23, 55, 59, .08); }
      .st-step + .st-step::before { top: 14px; right: calc(50% + 24px); left: calc(-50% + 24px); }
      .st-dot { box-sizing: border-box; width: 30px; height: 30px; border-color: #cfdadb; color: #6f8487; }
      .st-now .st-dot { border: 3px solid #24666b; color: #24666b; font-weight: 800; box-shadow: 0 0 0 6px #e6f2f3; }
      .st-label { margin-top: 12px; font-size: 13.5px; font-weight: 700; line-height: 18px; color: #17373b; }
      .st-step:not(.st-done):not(.st-now) .st-label { color: #6f8487; }
      .st-note { margin-top: 2px; font-size: 11.5px; font-weight: 500; color: #6f8487; }
      .st-now .st-note { font-weight: 600; color: #24666b; }
    }
    .af-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 420px); gap: 20px; align-items: start; }
    @media (max-width: 991.98px) { .af-cols { grid-template-columns: minmax(0, 1fr); } }
    .af-card { background: #fff; border: 1px solid #dde7e8; border-radius: 14px; box-shadow: 0 3px 10px rgba(23, 55, 59, .08); }
    .af-head { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 12px 20px; border-bottom: 1px solid #dde7e8; }
    .af-head h3 { margin: 0; font-size: 16px; font-weight: 700; color: #17373b; }
    .af-ico { flex: none; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: #e6f2f3; }
    .af-ico svg { width: 16px; height: 16px; fill: none; stroke: #24666b; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    .af-body { padding: 22px 24px 24px; color: #3d5559; font-size: 13px; font-weight: 500; line-height: 20px; overflow-wrap: anywhere; }
    .af-body ::ng-deep {
      p { margin: 0 0 14px; font-size: 13.5px; line-height: 21px; color: #17373b; }
      ol { list-style: none; counter-reset: af-c; margin: 0; padding: 0; }
      zed-text + zed-text { display: block; margin-top: 10px; }
      ol[start='2'] { counter-reset: af-c 1; } ol[start='3'] { counter-reset: af-c 2; } ol[start='4'] { counter-reset: af-c 3; }
      ol[start='5'] { counter-reset: af-c 4; } ol[start='6'] { counter-reset: af-c 5; } ol[start='7'] { counter-reset: af-c 6; }
      ol[start='8'] { counter-reset: af-c 7; } ol[start='9'] { counter-reset: af-c 8; }
      ol > li { counter-increment: af-c; position: relative; margin: 0 0 10px; padding-left: 40px; }
      ol > li::before { content: counter(af-c); position: absolute; left: 2px; top: -2px; width: 24px; height: 24px; border-radius: 50%;
        display: grid; place-items: center; font-size: 11.5px; font-weight: 800; color: #24666b; background: #e6f2f3; }
    }
    .af-bar { padding: 22px 24px 24px; border-top: 1px solid #dde7e8; background: #fff; border-radius: 0 0 14px 14px; }
    @media (min-width: 992px) { .af-bar { position: sticky; bottom: 0; z-index: 2; box-shadow: 0 -6px 14px rgba(23, 55, 59, .08); } }
    .af-consent { display: flex; gap: 12px; align-items: flex-start; margin: 0 0 22px; font-size: 13.5px; font-weight: 600; line-height: 20px; color: #17373b; cursor: pointer; }
    .af-consent input { width: 20px; height: 20px; margin: 0; flex: none; accent-color: #24666b; }
    .af-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
    .af-soft, .af-go { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 0 24px; font-size: 13.5px; font-weight: 700;
      border-radius: 9px; text-transform: none; }
    .af-soft { min-width: 190px; background: #e7eeee; border: 0; color: #17373b; }
    .af-soft:hover { background: #dbe5e5; color: #17373b; }
    .af-go { min-width: 210px; background: #24666b; border-color: #24666b; color: #fff; }
    .af-free { margin-left: auto; font-size: 12.5px; font-weight: 500; color: #6f8487; }
    .af-rail { display: grid; gap: 20px; }
    .af-rh { margin: 0; min-height: 56px; padding: 17px 24px 12px; border-bottom: 1px solid #dde7e8; font-size: 16px; font-weight: 700; line-height: 1.6; color: #17373b; }
    .af-level { display: flex; align-items: center; gap: 16px; padding: 18px 24px 16px; }
    .af-level img { width: 60px; height: 60px; object-fit: contain; }
    .af-level b { display: block; font-size: 17px; font-weight: 700; color: #17373b; }
    .af-level small { display: block; margin-top: 2px; color: #6f8487; font-size: 12.5px; font-weight: 500; }
    .af-facts { margin: 0 24px 16px; }
    .af-facts div { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 34px; padding: 6px 0; border-top: 1px solid #dde7e8; }
    .af-facts dt { font-size: 12.5px; font-weight: 500; color: #6f8487; }
    .af-facts dd { margin: 0; text-align: right; font-size: 13px; font-weight: 600; color: #17373b; }
    .af-facts div:first-child dd { font-weight: 700; }
    .af-facts small { font-weight: 400; color: #6f8487; }
    .af-keys { list-style: none; margin: 0; padding: 16px 24px 20px; display: grid; gap: 18px; font-size: 12.5px; font-weight: 500; line-height: 18px; color: #17373b; }
    .af-keys li { display: flex; gap: 14px; align-items: flex-start; }
    .af-keys span { flex: none; width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center; background: #e6f2f3; color: #24666b; font-weight: 700; }
    .af-keys .k-warn { background: #fdf2dc; color: #9a5f06; }
  `,
})
export class ApplyFlow {
  readonly step = input.required<ApplyStep>();
  readonly vm = input.required<ApplyLevelVm>();
  readonly billing = input<PaymentBilling | null>(null);
  /** The Admin's texts have loaded (the disclaimer and instructions must be shown before Accept & proceed). */
  readonly textsLoaded = input(true);
  /** Where to go: another step, or back to the dashboard. */
  readonly go = output<ApplyStep | 'home'>();

  /** The explicit consent to the disclaimer. */
  protected readonly consent = signal(false);

  protected readonly crumbs = computed(() => [{ label: t('msme.apply.crumb.home', 'Home') }, { label: t('msme.apply.crumb.certifications', 'Certifications') },
    { label: this.vm().name }, { label: t('msme.apply.crumb.apply', 'Apply') }]);

  protected readonly subtitle = computed(() =>
    this.step() === 'payment' ? t('msme.apply.sub.payment', 'Step 2 of 4: confirm tax details and the amount before you pay.')
      : this.step() === 'instructions' ? t('msme.apply.sub.instructions', 'Step 1 of 4: read the instructions before payment.')
        : t('msme.apply.sub.disclaimer', 'Step 1 of 4: read and accept the disclaimer before payment.'));

  protected readonly steps = computed<TrackerStep[]>(() => {
    const atFee = this.step() === 'payment';
    const here = t('msme.apply.steps.here', 'You are here');
    return [
      { label: t('msme.apply.steps.disclaimer', 'Disclaimer'), note: atFee ? t('msme.apply.steps.disclaimerNote', 'Read and accept') : here },
      { label: t('msme.apply.steps.fee', 'Fee & tax details'), note: atFee ? here : t('msme.apply.steps.feeNote', 'GSTIN, TDS, coupon') },
      { label: t('msme.apply.steps.payment', 'Payment'), note: t('msme.apply.steps.paymentNote', 'Secure gateway') },
      { label: t('msme.apply.steps.confirmation', 'Confirmation'), note: t('msme.apply.steps.confirmationNote', 'Receipt and next steps') },
    ];
  });
}

