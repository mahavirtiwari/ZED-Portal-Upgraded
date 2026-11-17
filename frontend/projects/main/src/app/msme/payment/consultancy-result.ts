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
                  @if (c.receiptUrl) { <a class="btn btn-primary pr-solid" [href]="c.receiptUrl" target="_blank" rel="noopener" data-receipt>⤓ Download receipt</a> }
                  @if (c.invoiceUrl) {
                    <a class="btn pr-line" [href]="c.invoiceUrl" target="_blank" rel="noopener" data-invoice>⤓ Download tax invoice</a>
                  } @else {
                    <button type="button" class="btn pr-line" disabled data-invoice aria-describedby="invoiceNote">⤓ Download tax invoice</button>
                  }
                  @if (c.email) {
                    <button type="button" class="btn btn-link pr-mail" [disabled]="sending()" (click)="emailCopy()">✉ E-mail a copy</button>
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
              <h2><span aria-hidden="true">✕</span> Payment Failed</h2>
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
  styles: `
    .result-page { margin-top: 20px; }
    .pr-tracker { margin-bottom: 20px; }
    .pr-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 420px); gap: 20px; align-items: start; }
    @media (max-width: 991.98px) { .pr-cols { grid-template-columns: minmax(0, 1fr); } }
    .pr-main { display: grid; gap: 20px; min-width: 0; }
    .pr-card { background: #fff; border: 1px solid #e3ecec; border-radius: 12px; box-shadow: 0 2px 8px rgba(16, 61, 64, .05); padding: 20px 22px; }
    .pr-hero { display: flex; gap: 18px; align-items: center; padding-bottom: 16px; border-bottom: 1px solid #e8eff0; }
    .pr-hero h2 { margin: 0; font-size: 24px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .pr-hero p { margin: 4px 0 0; color: #24393b; }
    .pr-hero .pr-amt { color: #5f6f70; font-size: 14px; }
    .pr-mark { flex: none; width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; background: #2e9e57; box-shadow: 0 0 0 8px #dcf1e3; }
    .pr-mark svg { width: 34px; height: 34px; fill: none; stroke: #fff; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .pr-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px 20px; margin: 0; padding: 16px 0; border-bottom: 1px solid #e8eff0; }
    .pr-facts dt { font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; color: #5f6f70; font-weight: 700; }
    .pr-facts dd { margin: 4px 0 0; color: #24393b; overflow-wrap: anywhere; }
    .pr-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 16px; }
    .pr-solid { background: var(--zt-dark, #1f5c61); border-color: var(--zt-dark, #1f5c61); color: #fff; font-weight: 700; border-radius: 8px; padding: 10px 22px; }
    .pr-line { border: 1.5px solid var(--zt-dark, #1f5c61); color: var(--zt-dark, #1f5c61); background: #fff; font-weight: 700; border-radius: 8px; padding: 9px 20px; }
    .pr-line:disabled { border-color: #c9d6d7; color: #8a9899; }
    .pr-mail { font-weight: 700; color: var(--zt-dark, #1f5c61); text-decoration: none; }
    .pr-note { margin: 10px 0 0; font-size: 13px; color: #5f6f70; }
    .pr-sent { color: #1e7a3c; font-weight: 600; }
    .pr-err { color: #c0392b; }
    .pr-h { margin: -20px -22px 16px; padding: 14px 22px; border-bottom: 1px solid #e8eff0; font-size: 17px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .pr-state { background: #fcebea; border-color: #f2c4c0; }
    .pr-state h2 { font-size: 20px; font-weight: 700; margin: 0 0 8px; color: #c0392b; }
    .pr-msg { font-size: 13.5px; color: #4b5b5c; overflow-wrap: anywhere; }
    .pr-level { display: flex; align-items: center; gap: 14px; padding-bottom: 14px; border-bottom: 1px solid #e8eff0; }
    .pr-level img { width: 52px; height: 52px; object-fit: contain; }
    .pr-level b { display: block; font-size: 17px; color: var(--zt-ink, #173f44); }
    .pr-level small { display: block; font-size: 13px; color: #5f6f70; }
    .pr-chip { display: inline-block; margin-top: 4px; padding: 2px 10px; border-radius: 10px; background: #dcf1e3; color: #1e7a3c; font-size: 11.5px; font-weight: 700; }
    .pr-paid { display: flex; justify-content: space-between; margin: 12px 0; color: #5f6f70; }
    .pr-paid b { color: #24393b; }
    .pr-go { display: block; width: 100%; text-align: center; margin-top: 8px; }
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
