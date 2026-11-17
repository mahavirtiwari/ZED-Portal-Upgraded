import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ContentTextComponent } from '../../content/content-text';
import { PaymentBilling, PaymentStep } from '../payment/payment-step';
import { PageHead } from '../shared/page-head';
import { StepTracker, TrackerStep } from '../shared/step-tracker';
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
 */
@Component({
  selector: 'zed-apply-flow',
  imports: [FormsModule, ContentTextComponent, PageHead, StepTracker, PaymentStep],
  template: `
    @let v = vm();
    <zed-page-head [crumbs]="[{ label: 'Home' }, { label: 'Certifications' }, { label: v.name }, { label: 'Apply' }]"
                   [title]="'Apply for ' + v.name + ' Certification'" [subtitle]="subtitle()">
      <button type="button" class="btn btn-ph" (click)="go.emit(step() === 'payment' ? 'disclaimer' : 'home')">← Back</button>
    </zed-page-head>
    <zed-step-tracker class="af-tracker" [steps]="steps()" [current]="step() === 'payment' ? 1 : 0" label="Application steps" />

    @if (step() === 'payment') {
      <zed-payment-step [certification]="v.code" [billing]="billing()" (back)="go.emit('home')" (previous)="go.emit('disclaimer')" />
    } @else {
      <div class="af-cols">
        <section class="af-card disclaimer-sec" [attr.aria-labelledby]="'afTitle'">
          <header class="af-head">
            <span class="af-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" /><path d="M9 12l2 2 4-4" /></svg></span>
            <h3 id="afTitle">{{ step() === 'disclaimer' ? 'Disclaimer / declaration' : 'Instructions' }}</h3>
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
                <span>I have read and understood the disclaimer and accept it on behalf of {{ v.unitName || 'my unit' }}.</span>
              </label>
            }
            <div class="af-actions">
              <button type="button" class="btn af-soft" (click)="go.emit('home')">← Back to dashboard</button>
              <button type="button" class="btn btn-primary af-go" [disabled]="!textsLoaded() || (step() === 'disclaimer' && !consent())"
                      (click)="go.emit(step() === 'disclaimer' ? 'instructions' : 'payment')">Accept &amp; proceed →</button>
              <span class="af-free">Nothing is charged at this step.</span>
            </div>
          </div>
        </section>

        <aside class="af-rail">
          <section class="af-card" aria-labelledby="afApplying">
            <h3 class="af-rh" id="afApplying">You are applying for</h3>
            <div class="af-level">
              <img [src]="v.logo" alt="" />
              <div><b>{{ v.name }} Certification</b><small>{{ v.unitName }}{{ v.unitName && v.zedId ? ' · ' : '' }}{{ v.zedId }}</small></div>
            </div>
            <dl class="af-facts">
              @for (f of v.facts; track f.label) { <div><dt>{{ f.label }}</dt><dd>{{ f.value }}@if (f.note) { <small> {{ f.note }}</small> }</dd></div> }
              <div><dt>Assessment</dt><dd>{{ v.assessment }}</dd></div>
            </dl>
          </section>
          <section class="af-card" aria-labelledby="afKey">
            <h3 class="af-rh" id="afKey">Key points at a glance</h3>
            <ul class="af-keys">
              <li><span class="k-warn" aria-hidden="true">!</span>The fee is non-refundable, non-adjustable and non-transferable.</li>
              <li><span aria-hidden="true">★</span>
                @if (v.rewardUsed; as r) { The Joining Reward works once. You used it on {{ r.level }}@if (r.date) { ({{ r.date }})}. }
                @else { The Joining Reward works once: once used on a level, it cannot be used again. }
              </li>
              <li><span aria-hidden="true">₹</span>Subsidy is already applied; you pay only the beneficiary contribution.</li>
              <li><span aria-hidden="true">◷</span>Late documents or responses can forfeit the amount paid.</li>
            </ul>
          </section>
        </aside>
      </div>
    }
  `,
  styles: `
    .af-tracker { margin-bottom: 20px; }
    .af-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 420px); gap: 20px; align-items: start; }
    @media (max-width: 991.98px) { .af-cols { grid-template-columns: minmax(0, 1fr); } }
    .af-card { background: #fff; border: 1px solid #e3ecec; border-radius: 12px; box-shadow: 0 2px 8px rgba(16, 61, 64, .05); }
    .af-head { display: flex; align-items: center; gap: 12px; padding: 14px 22px; border-bottom: 1px solid #e8eff0; }
    .af-head h3 { margin: 0; font-size: 17px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .af-ico { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: #eef5f5; }
    .af-ico svg { width: 18px; height: 18px; fill: none; stroke: var(--zt-dark, #1f5c61); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    .af-body { padding: 18px 22px; color: #24393b; font-size: 14.5px; line-height: 1.6; }
    .af-bar { padding: 16px 22px; border-top: 1px solid #e8eff0; background: #fff; border-radius: 0 0 12px 12px; }
    @media (min-width: 992px) { .af-bar { position: sticky; bottom: 0; z-index: 2; box-shadow: 0 -6px 14px rgba(16, 61, 64, .06); } }
    .af-consent { display: flex; gap: 10px; align-items: flex-start; margin: 0 0 14px; font-weight: 500; color: #24393b; cursor: pointer; }
    .af-consent input { width: 18px; height: 18px; margin-top: 2px; flex: none; accent-color: var(--zt-dark, #1f5c61); }
    .af-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
    .af-soft { background: #e8eff0; color: var(--zt-ink, #173f44); font-weight: 700; border-radius: 8px; padding: 10px 22px; }
    .af-go { background: var(--zt-dark, #1f5c61); border-color: var(--zt-dark, #1f5c61); font-weight: 700; border-radius: 8px; padding: 10px 26px; }
    .af-free { margin-left: auto; font-size: 13px; color: #5f6f70; }
    .af-rail { display: grid; gap: 20px; }
    .af-rh { margin: 0; padding: 14px 22px; border-bottom: 1px solid #e8eff0; font-size: 16px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .af-level { display: flex; align-items: center; gap: 14px; padding: 16px 22px 4px; }
    .af-level img { width: 56px; height: 56px; object-fit: contain; }
    .af-level b { display: block; font-size: 17px; color: var(--zt-ink, #173f44); }
    .af-level small { color: #5f6f70; font-size: 13px; }
    .af-facts { margin: 8px 22px 14px; }
    .af-facts div { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 1px solid #eef3f3; font-size: 13.5px; }
    .af-facts dt { font-weight: 400; color: #5f6f70; }
    .af-facts dd { margin: 0; text-align: right; font-weight: 600; color: #24393b; }
    .af-facts small { font-weight: 400; color: #5f6f70; }
    .af-keys { list-style: none; margin: 0; padding: 14px 22px; display: grid; gap: 12px; font-size: 13.5px; color: #24393b; }
    .af-keys li { display: flex; gap: 12px; align-items: flex-start; }
    .af-keys span { flex: none; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: #eef5f5; color: var(--zt-dark, #1f5c61); font-weight: 700; }
    .af-keys .k-warn { background: #fdf3dc; color: #9a6700; }
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

  protected readonly subtitle = computed(() =>
    this.step() === 'payment' ? 'Step 2 of 4: confirm tax details and the amount before you pay.'
      : this.step() === 'instructions' ? 'Step 1 of 4: read the instructions before payment.'
        : 'Step 1 of 4: read and accept the disclaimer before payment.');

  protected readonly steps = computed<TrackerStep[]>(() => {
    const atFee = this.step() === 'payment';
    return [
      { label: 'Disclaimer', note: atFee ? 'Read and accept' : 'You are here' },
      { label: 'Fee & tax details', note: atFee ? 'You are here' : 'GSTIN, TDS, coupon' },
      { label: 'Payment', note: 'Secure gateway' },
      { label: 'Confirmation', note: 'Receipt and next steps' },
    ];
  });
}

