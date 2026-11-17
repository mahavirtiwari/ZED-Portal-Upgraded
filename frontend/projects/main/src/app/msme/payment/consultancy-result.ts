import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ContentTextComponent } from '../../content/content-text';
import { handholdingLevel, handholdingLevelName } from '../handholding/handholding.api';
import { levelLogo } from '../shared/levels';
import { PageHead } from '../shared/page-head';
import { StepTracker, TrackerStep } from '../shared/step-tracker';
import { ConsultancyConfirmation, ConsultancyPaymentApi, milestoneTitle } from './consultancy-payment.api';

/**
 * Where the browser lands after a handholding milestone payment (gateway or zero amount).
 * Port of Frontend/ConsultancyPay/success.cshtml and failure.cshtml.
 * 2026-11-17 (the user's "Payment confirmation" design, as the certification result): the four-step tracker closes the payment;
 * a success header with the amount, transaction and order IDs, when and how it was paid
 * (api/msme/consultancy-payments/{level}/confirmation), Download receipt, Download tax invoice (disabled until the ERP has sent
 * it) and E-mail a copy; "Milestone paid" on the right; the failed state with Try again and Contact helpdesk.
 */
@Component({
  selector: 'zed-consultancy-result',
  imports: [RouterLink, ContentTextComponent, PageHead, StepTracker, DecimalPipe, DatePipe],
  template: `
    <div class="container form-page result-page">
      <zed-page-head [crumbs]="[{ label: 'Home', link: '/msme/dashboard' }, { label: 'Incentives', link: '/msme/dashboard', fragment: 'incentives' }, { label: 'Handholding support', link: '/msme/handholding' }, { label: 'Payment' }]"
                     [title]="succeeded() ? 'Payment confirmation' : 'Payment failed'" [subtitle]="subtitle()">
        <a class="btn btn-ph" routerLink="/msme/handholding" [queryParams]="levelQuery()">← Back to Handholding support</a>
      </zed-page-head>
      <zed-step-tracker class="pr-tracker" [steps]="steps()" [current]="succeeded() ? 4 : 2" label="Payment steps" />

      <div class="pr-cols">
        <div class="pr-main">
          @if (succeeded()) {
            <section class="pr-card zed-payment-success">
              <div class="pr-hero">
                <span class="pr-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
                <div>
                  <h2>Payment successful</h2>
                  @switch (milestoneNumber()) {
                    @case (1) { <p>Your payment towards <strong>ZED Handholding Support Milestone 1: Baseline Diagnostic Study and Handholding Action Plan</strong> is successful.</p> }
                    @case (2) { <p>Your payment towards <strong>Milestone 2 : Implementation &amp; Progress Review 1</strong> is successful.</p> }
                    @case (3) { <p>Your payment towards <strong>Milestone 3 : Implementation &amp; Progress Review 2</strong> is successful.</p> }
                    @default { <p>Your payment is successful.</p> }
                  }
                  @if (conf()?.amount != null) { <p class="pr-amt">₹ {{ conf()!.amount | number: '1.2-2' }} received for {{ label() }}.</p> }
                </div>
              </div>
              @if (conf(); as c) {
                @if (c.transactionId || c.orderId || c.paidOn || c.method) {
                  <dl class="pr-facts">
                    @if (c.transactionId) { <div><dt>Transaction ID</dt><dd>{{ c.transactionId }}</dd></div> }
                    @if (c.orderId) { <div><dt>Order ID</dt><dd>{{ c.orderId }}</dd></div> }
                    @if (c.paidOn) { <div><dt>Paid on</dt><dd>{{ c.paidOn | date: 'd MMM y, hh:mm a' }}</dd></div> }
                    @if (c.method) { <div><dt>Method</dt><dd>{{ c.method }}</dd></div> }
                  </dl>
                }
                <div class="pr-actions">
                  @if (c.receiptUrl) { <a class="btn btn-primary pr-solid" [href]="c.receiptUrl" target="_blank" rel="noopener" data-receipt><svg class="pr-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg> Download receipt</a> }
                  @if (c.invoiceUrl) {
                    <a class="btn pr-line" [href]="c.invoiceUrl" target="_blank" rel="noopener" data-invoice><svg class="pr-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg> Download tax invoice</a>
                  } @else {
                    <button type="button" class="btn pr-line" disabled data-invoice aria-describedby="invoiceNote"><svg class="pr-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg> Download tax invoice</button>
                  }
                  @if (c.email) {
                    <button type="button" class="btn btn-link pr-mail" [disabled]="sending()" (click)="emailCopy()"><svg class="pr-i" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg> E-mail a copy</button>
                  }
                </div>
                @if (!c.invoiceUrl) { <p class="pr-note" id="invoiceNote">The tax invoice is issued shortly; it will be in My Documents.</p> }
                @if (sentTo()) { <p class="pr-note pr-sent" role="status">Sent to {{ sentTo() }}</p> }
                @if (mailError()) { <p class="pr-note pr-err" role="alert">{{ mailError() }}</p> }
                @if (c.email && !sentTo()) { <p class="pr-note">A confirmation has been sent to your registered e-mail.</p> }
              }
            </section>
          } @else {
            <section class="pr-card pr-state" role="alert">
              <h2><span aria-hidden="true">✕</span> Payment failed</h2>
              <zed-text key="msme.payment.failed"><p>There seems to be a problem with the payment, please try again and if this issue repeats, contact us at zed.support&#64;qcin.org</p></zed-text>
              <p>No amount was collected. If money left your account, your bank reverses it automatically.</p>
              @if (message()) { <p class="pr-msg"><b>Error Message</b>: <span>{{ message() }}</span></p> }
              <div class="pr-actions">
                @if (level(); as l) { <a class="btn btn-primary pr-solid" [routerLink]="['/msme/handholding', l, 'payment']">Try again</a> }
                <a class="btn pr-line" routerLink="/msme/dashboard">Back to dashboard</a>
                <a class="btn btn-link pr-mail" routerLink="/msme/contact">Contact helpdesk</a>
              </div>
            </section>
          }
        </div>

        @if (succeeded() && level()) {
          <aside class="pr-card pr-rail" aria-labelledby="paidTitle">
            <h3 class="pr-h" id="paidTitle">Milestone paid</h3>
            <div class="pr-level">
              <img [src]="logo()" alt="" />
              <div><b>{{ label() }}</b>@if (milestoneTitle(); as t) { <small>{{ t }}</small> }<span class="pr-chip">✓ PAYMENT RECEIVED</span></div>
            </div>
            @if (conf()?.amount != null) { <p class="pr-paid"><span>Fee paid</span><b>₹ {{ conf()!.amount | number: '1.2-2' }}</b></p> }
            <a class="btn btn-primary pr-solid pr-go" routerLink="/msme/handholding" [queryParams]="levelQuery()">Go to Handholding support →</a>
          </aside>
        }
      </div>
    </div>
  `,
  // 2026-11-18 (the user's applicant designs, zed-msme-09): the confirmation card of the certification payment
  // (zed-payment-result): 14px cards, the 52px tick in a pale green halo, 10px fact labels, 42px buttons, the red failed card.
  styles: `
    .result-page { margin-top: 20px; }
    .pr-tracker { margin-bottom: 20px; }
    .pr-tracker ::ng-deep {
      .st { min-height: 104px; padding: 19px 12px 10px; border-color: #dde7e8; border-radius: 14px; box-shadow: 0 3px 10px rgba(23, 55, 59, .08); }
      .st-step + .st-step::before { top: 14px; right: calc(50% + 24px); left: calc(-50% + 24px); background: #dde7e8; }
      .st-step.st-done + .st-step::before { background: #2f9e58; }
      .st-dot { box-sizing: border-box; width: 30px; height: 30px; border: 2px solid #cfdadb; color: #6f8487; }
      .st-done .st-dot { background: #2f9e58; border-color: #2f9e58; }
      .st-now .st-dot { border: 3px solid #24666b; color: #24666b; font-weight: 800; box-shadow: 0 0 0 6px #e6f2f3; }
      .st-label { margin-top: 12px; font-size: 13.5px; font-weight: 700; line-height: 18px; color: #17373b; }
      .st-step:not(.st-done):not(.st-now) .st-label { color: #6f8487; }
      .st-note { margin-top: 2px; font-size: 11.5px; font-weight: 500; color: #6f8487; }
    }
    .pr-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 420px); gap: 20px; align-items: start; }
    @media (max-width: 991.98px) { .pr-cols { grid-template-columns: minmax(0, 1fr); } }
    .pr-main { display: grid; gap: 20px; min-width: 0; }
    .pr-card { background: #fff; border: 1px solid #dde7e8; border-radius: 14px; box-shadow: 0 3px 10px rgba(23, 55, 59, .08); padding: 24px; }
    .pr-hero { display: flex; gap: 20px; align-items: center; padding: 2px 0 20px; border-bottom: 1px solid #dde7e8; }
    .pr-hero h2 { margin: 0; font-size: 24px; font-weight: 700; color: #17373b; }
    .pr-hero p { margin: 6px 0 0; font-size: 14px; font-weight: 500; color: #3d5559; }
    .pr-hero .pr-amt { color: #6f8487; font-size: 13.5px; }
    .pr-mark { flex: none; width: 52px; height: 52px; margin: 12px; border-radius: 50%; display: grid; place-items: center; background: #2f9e58; box-shadow: 0 0 0 12px #e5f5ea; }
    .pr-mark svg { width: 28px; height: 28px; fill: none; stroke: #fff; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .pr-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px 24px; margin: 0; padding: 18px 0 16px; border-bottom: 1px solid #dde7e8; }
    .pr-facts dt { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: #6f8487; font-weight: 700; }
    .pr-facts dd { margin: 6px 0 0; font-size: 14px; font-weight: 600; color: #17373b; overflow-wrap: anywhere; }
    .pr-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 20px; }
    .pr-i { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .pr-solid, .pr-line { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 42px; padding: 0 22px; font-size: 13.5px; font-weight: 700;
      border-radius: 9px; text-transform: none; }
    .pr-solid { min-width: 200px; background: #24666b; border: 1.5px solid #24666b; color: #fff; }
    .pr-solid:hover { background: #1b4f53; border-color: #1b4f53; color: #fff; }
    .pr-line { min-width: 220px; border: 1.5px solid #24666b; color: #24666b; background: #fff; }
    .pr-line:hover:not(:disabled) { background: #e6f2f3; color: #24666b; }
    .pr-line:disabled { border-color: #c9d6d7; color: #8a9899; }
    .pr-mail { display: inline-flex; align-items: center; gap: 6px; padding: 0 8px; font-size: 13px; font-weight: 700; color: #24666b; text-decoration: none; text-transform: none; }
    .pr-note { margin: 12px 0 0; font-size: 12.5px; font-weight: 500; color: #6f8487; }
    .pr-sent { color: #2f9e58; font-weight: 600; }
    .pr-err { color: #c0392b; }
    .pr-h { min-height: 56px; margin: -24px -24px 18px; padding: 15px 24px 12px; border-bottom: 1px solid #dde7e8; font-size: 16px; font-weight: 700; color: #17373b; }
    .pr-state { padding: 18px 20px 20px; background: #fbe9e7; border-color: #f0c4bf; }
    .pr-state h2 { display: flex; align-items: center; gap: 12px; margin: 0 0 14px; font-size: 15.5px; font-weight: 700; color: #c8473c; }
    .pr-state h2 span { flex: none; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: #fff; font-size: 18px; }
    .pr-state p { font-size: 12.5px; font-weight: 500; color: #17373b; }
    .pr-state .pr-solid, .pr-state .pr-line { min-width: 140px; min-height: 34px; font-size: 13px; }
    .pr-msg { font-size: 12.5px; color: #3d5559; overflow-wrap: anywhere; }
    .pr-level { display: flex; align-items: center; gap: 14px; padding-bottom: 14px; border-bottom: 1px solid #dde7e8; }
    .pr-level img { width: 48px; height: 48px; object-fit: contain; }
    .pr-level b { display: block; font-size: 16px; font-weight: 700; color: #17373b; }
    .pr-level small { display: block; font-size: 12.5px; color: #6f8487; }
    .pr-chip { display: inline-block; margin-top: 4px; padding: 0 12px; border-radius: 11px; background: #e5f5ea; color: #2f9e58; font-size: 10.5px; font-weight: 700;
      line-height: 22px; letter-spacing: .04em; }
    .pr-paid { display: flex; justify-content: space-between; align-items: baseline; margin: 14px 0 12px; font-size: 12.5px; font-weight: 500; color: #6f8487; }
    .pr-paid b { font-size: 13.5px; font-weight: 700; color: #17373b; }
    .pr-go { display: flex; width: 100%; min-height: 40px; }
  `,
})
export class ConsultancyResultPage {
  private readonly api = inject(ConsultancyPaymentApi);
  // Query parameters, bound by the router.
  readonly status = input<string>('');
  readonly certification = input<string>('');
  readonly milestone = input<string>('');
  readonly message = input<string>('');

  protected readonly succeeded = computed(() => this.status() === 'success');
  protected readonly milestoneNumber = computed(() => {
    const n = Number(this.milestone());
    return n >= 1 && n <= 3 ? n : 0;
  });
  /** Silver, Gold or ZEDX (any case in the address); null for anything else. */
  protected readonly level = computed(() => handholdingLevel(this.certification()));
  protected readonly logo = computed(() => levelLogo(this.level() ?? 'Silver'));
  protected readonly levelQuery = computed(() => (this.level() ? { level: this.level() } : {}));
  /** The milestone paid: the address's, else the one the confirmation names. */
  private readonly paidMilestone = computed(() => this.milestoneNumber() || this.conf()?.milestone || 0);
  protected readonly milestoneTitle = computed(() => milestoneTitle(this.paidMilestone()));
  protected readonly label = computed(() => {
    const l = this.level();
    const m = this.paidMilestone();
    return `${l ? handholdingLevelName(l) + ' ' : ''}Handholding support${m ? ', Milestone ' + m : ''}`;
  });
  protected readonly subtitle = computed(() => this.succeeded() ? 'Step 4 of 4: your handholding milestone payment is complete.' : 'Step 3 of 4: the payment did not go through.');
  protected readonly steps = computed<TrackerStep[]>(() => {
    const done = this.succeeded();
    return [
      { label: 'Disclaimer', note: 'Done' },
      { label: 'Fee & tax details', note: 'Done' },
      { label: 'Payment', note: done ? 'Done' : 'Not completed' },
      { label: 'Confirmation', note: done ? 'Done' : 'Receipt and next steps' },
    ];
  });

  protected readonly conf = signal<ConsultancyConfirmation | null>(null);
  protected readonly sending = signal(false);
  protected readonly sentTo = signal('');
  protected readonly mailError = signal('');

  constructor() {
    effect(() => {
      const level = this.level();
      const milestone = this.milestoneNumber();
      if (!this.succeeded() || !level) return;
      untracked(() => {
        firstValueFrom(this.api.confirmation(level, milestone || null))
          .then((c) => this.conf.set(c))
          .catch(() => undefined); // the page still shows the success; the details are left out
      });
    });
  }

  protected async emailCopy(): Promise<void> {
    const level = this.level();
    if (!level) return;
    this.sending.set(true);
    this.mailError.set('');
    try {
      const r = await firstValueFrom(this.api.emailCopy(level, this.milestoneNumber() || null));
      this.sentTo.set(r.sentTo);
    } catch (err) {
      this.mailError.set(apiErrorMessage(err));
    } finally {
      this.sending.set(false);
    }
  }
}
