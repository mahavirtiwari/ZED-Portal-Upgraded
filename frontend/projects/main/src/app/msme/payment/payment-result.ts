import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PortalLinksService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ContentTextComponent } from '../../content/content-text';
import { TextPipe, t } from '../../content/page-text';
import { isLegacyLevel, levelLogo, levelName } from '../shared/levels';
import { BOLD, boldParts } from '../shared/bold-parts';
import { PageHead } from '../shared/page-head';
import { StepTracker, TrackerStep } from '../shared/step-tracker';
import { PaymentApi, PaymentConfirmation, PaymentKind } from './payment.api';

/**
 * Where the browser lands after the payment gateway (or a zero-amount payment).
 * Port of Views/Pay/success.cshtml and failure.cshtml, and of the SurveillancePay ones (kind=surveillance).
 * 2026-11-17 (the user's "Payment confirmation" design): the four-step tracker closes the apply flow; a success header with the
 * amount, transaction and order IDs, when and how it was paid (api/msme/payments/{level}/confirmation), Download receipt,
 * Download tax invoice (disabled until the ERP has sent it) and E-mail a copy; "What happens next" (the app, basic information,
 * desktop verification, the site visit for a site level); the "Application created" card; and pending / failed states with
 * one action each (Check status / Try again) and Contact helpdesk.
 */
@Component({
  selector: 'zed-payment-result',
  imports: [RouterLink, ContentTextComponent, PageHead, StepTracker, DecimalPipe, DatePipe, TextPipe],
  template: `
    <div class="container form-page result-page">
      <zed-page-head [crumbs]="crumbs()" [title]="title()" [subtitle]="subtitle()">
        <a class="btn btn-ph" routerLink="/msme/dashboard">{{ '← Back to dashboard' | t: 'msme.paymentResult.backButton' }}</a>
      </zed-page-head>
      <zed-step-tracker class="pr-tracker" [steps]="steps()" [current]="state() === 'success' ? 4 : 2" [label]="'Application steps' | t: 'msme.paymentResult.stepsAria'" />

      <div class="pr-cols">
        <div class="pr-main">
          @switch (state()) {
            @case ('success') {
              <section class="pr-card zed-payment-success">
                <div class="pr-hero">
                  <span class="pr-mark ok" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
                  <div>
                    <h2>{{ 'Payment successful' | t: 'msme.paymentResult.success.title' }}</h2>
                    <p>@if (conf()?.amount != null) { {{ '₹ {amount} received for {item}.' | t: 'msme.paymentResult.success.amountText' : { amount: (conf()!.amount | number: '1.2-2'), item: label() } }} }
                      @else if (surveillance()) { {{ 'Your payment towards ZED Surveillance has been successful.' | t: 'msme.paymentResult.success.surveillanceText' }} }
                      @else { {{ 'Your payment towards ZED Certification has been successful.' | t: 'msme.paymentResult.success.certificationText' }} }</p>
                  </div>
                </div>
                @if (conf(); as c) {
                  @if (c.transactionId || c.orderId || c.paidOn || c.method) {
                    <dl class="pr-facts">
                      @if (c.transactionId) { <div><dt>{{ 'Transaction ID' | t: 'msme.paymentResult.transactionLabel' }}</dt><dd>{{ c.transactionId }}</dd></div> }
                      @if (c.orderId) { <div><dt>{{ 'Order ID' | t: 'msme.paymentResult.orderLabel' }}</dt><dd>{{ c.orderId }}</dd></div> }
                      @if (c.paidOn) { <div><dt>{{ 'Paid on' | t: 'msme.paymentResult.paidOnLabel' }}</dt><dd>{{ c.paidOn | date: 'd MMM y, hh:mm a' }}</dd></div> }
                      @if (c.method) { <div><dt>{{ 'Method' | t: 'msme.paymentResult.methodLabel' }}</dt><dd>{{ c.method }}</dd></div> }
                    </dl>
                  }
                  <div class="pr-actions">
                    @if (c.receiptUrl) { <a class="btn btn-primary pr-solid" [href]="c.receiptUrl" target="_blank" rel="noopener"><svg class="pr-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg> {{ 'Download receipt' | t: 'msme.paymentResult.receiptButton' }}</a> }
                    @if (c.invoiceUrl) {
                      <a class="btn pr-line" [href]="c.invoiceUrl" target="_blank" rel="noopener" data-invoice><svg class="pr-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg> {{ 'Download tax invoice' | t: 'msme.paymentResult.invoiceButton' }}</a>
                    } @else {
                      <button type="button" class="btn pr-line" disabled data-invoice aria-describedby="invoiceNote"><svg class="pr-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg> {{ 'Download tax invoice' | t: 'msme.paymentResult.invoiceButton' }}</button>
                    }
                    @if (c.email) {
                      <button type="button" class="btn btn-link pr-mail" [disabled]="sending()" (click)="emailCopy()"><svg class="pr-i" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg> {{ 'E-mail a copy' | t: 'msme.paymentResult.emailButton' }}</button>
                    }
                  </div>
                  @if (!c.invoiceUrl) { <p class="pr-note" id="invoiceNote">{{ 'The tax invoice is issued shortly; it will be in My Documents.' | t: 'msme.paymentResult.invoiceNote' }}</p> }
                  @if (sentTo()) { <p class="pr-note pr-sent" role="status">{{ 'Sent to {email}' | t: 'msme.paymentResult.sentMessage' : { email: sentTo() } }}</p> }
                  @if (mailError()) { <p class="pr-note pr-err" role="alert">{{ mailError() }}</p> }
                  @if (c.email && !sentTo()) { <p class="pr-note">{{ 'A confirmation has been sent to your registered e-mail.' | t: 'msme.paymentResult.emailNote' }}</p> }
                }
              </section>

              @if (!surveillance()) {
                <section class="pr-card" aria-labelledby="nextTitle">
                  <header class="pr-h">
                    <span class="pr-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg></span>
                    <h3 id="nextTitle">{{ 'What happens next' | t: 'msme.paymentResult.next.title' }}</h3>
                  </header>
                  <ol class="pr-next">
                    <li class="now">
                      @let line = appLine();
                      <div><b>{{ 'Download the ZED MSME mobile app' | t: 'msme.paymentResult.next.appHeading' }}</b> <i class="you">{{ 'YOU' | t: 'msme.paymentResult.next.youChip' }}</i>
                        <p>{{ line.before }}<strong>{{ line.bold }}</strong>{{ line.after }}</p></div>
                      <div class="pr-apps">
                        @if (links.url('appStore'); as u) { <a class="btn pr-dark" [href]="u" target="_blank" rel="noopener"><svg class="pr-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg> {{ 'iOS app' | t: 'msme.paymentResult.next.iosButton' }}</a> }
                        @if (links.url('playStore'); as u) { <a class="btn pr-dark" [href]="u" target="_blank" rel="noopener"><svg class="pr-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg> {{ 'Android app' | t: 'msme.paymentResult.next.androidButton' }}</a> }
                        <img src="/api/public/links/playStore/qr" width="64" height="64" [alt]="'QR code for the ZED MSME app' | t: 'msme.paymentResult.next.qrAlt'" />
                      </div>
                    </li>
                    <li><div><b>{{ 'Fill Basic Information and upload documents' | t: 'msme.paymentResult.next.basicHeading' }}</b> <i class="you">{{ 'YOU' | t: 'msme.paymentResult.next.youChip' }}</i><p>{{ 'Your application moves to verification once you submit.' | t: 'msme.paymentResult.next.basicText' }}</p></div></li>
                    <li><div><b>{{ 'Desktop verification' | t: 'msme.paymentResult.next.desktopHeading' }}</b> <i>{{ 'ZED' | t: 'msme.paymentResult.next.zedChip' }}</i><p>{{ 'An assessor reviews your documents. Non-conformances, if any, are raised to you.' | t: 'msme.paymentResult.next.desktopText' }}</p></div></li>
                    @if (siteVisit()) {
                      <li><div><b>{{ 'Site visit and certification' | t: 'msme.paymentResult.next.siteHeading' }}</b> <i>{{ 'ZED' | t: 'msme.paymentResult.next.zedChip' }}</i><p>{{ 'After the on-site assessment, your certificate and report are generated.' | t: 'msme.paymentResult.next.siteText' }}</p></div></li>
                    } @else {
                      <li><div><b>{{ 'Certification' | t: 'msme.paymentResult.next.certHeading' }}</b> <i>{{ 'ZED' | t: 'msme.paymentResult.next.zedChip' }}</i><p>{{ 'Once the assessment is complete, your certificate and report are generated.' | t: 'msme.paymentResult.next.certText' }}</p></div></li>
                    }
                  </ol>
                </section>
              }
            }
            @case ('pending') {
              <section class="pr-card pr-state warn" role="status">
                <h2><span aria-hidden="true">◷</span> {{ 'Payment pending' | t: 'msme.paymentResult.pending.heading' }}</h2>
                <p>{{ 'We are confirming with your bank. This can take a few minutes. Please do not pay again.' | t: 'msme.paymentResult.pending.text' }}</p>
                @if (message()) { <p class="pr-msg">{{ message() }}</p> }
                @if (checkNote()) { <p class="pr-msg">{{ checkNote() }}</p> }
                <div class="pr-actions">
                  <button type="button" class="btn pr-line" [disabled]="checking()" (click)="checkStatus()">{{ 'Check status' | t: 'msme.paymentResult.pending.checkButton' }}</button>
                  <a class="btn btn-link pr-mail" routerLink="/msme/contact">{{ 'Contact helpdesk' | t: 'msme.paymentResult.helpdeskLink' }}</a>
                </div>
              </section>
            }
            @default {
              <section class="pr-card pr-state bad" role="alert">
                <h2><span aria-hidden="true">✕</span> {{ 'Payment failed' | t: 'msme.paymentResult.failed.heading' }}</h2>
                <zed-text key="msme.payment.failed"><p>There seems to be a problem with the payment, please try again and if this issue repeats, contact us at zed.support&#64;qcin.org</p></zed-text>
                <p>{{ 'No amount was collected. If money left your account, your bank reverses it automatically.' | t: 'msme.paymentResult.failed.text' }}</p>
                @if (message()) { <p class="pr-msg"><b>{{ 'Error Message' | t: 'msme.paymentResult.failed.errorLabel' }}</b>: <span>{{ message() }}</span></p> }
                <div class="pr-actions">
                  <a class="btn btn-primary pr-solid" [routerLink]="retryLink()" [queryParams]="retryQuery()">{{ 'Try again' | t: 'msme.paymentResult.failed.retryButton' }}</a>
                  <a class="btn btn-link pr-mail" routerLink="/msme/contact">{{ 'Contact helpdesk' | t: 'msme.paymentResult.helpdeskLink' }}</a>
                </div>
              </section>
            }
          }
        </div>

        @if (state() === 'success' && certification()) {
          <aside class="pr-card pr-rail" aria-labelledby="createdTitle">
            <h3 class="pr-h pr-rh" id="createdTitle">{{ surveillance() ? ('Surveillance paid' | t: 'msme.paymentResult.rail.surveillanceTitle') : ('Application created' | t: 'msme.paymentResult.rail.title') }}</h3>
            <div class="pr-level">
              <img [src]="logo()" alt="" />
              <div><b>{{ label() }}</b><span class="pr-chip">✓ {{ surveillance() ? ('PAYMENT RECEIVED' | t: 'msme.paymentResult.rail.paymentChip') : ('APPLICATION RECEIVED' | t: 'msme.paymentResult.rail.applicationChip') }}</span></div>
            </div>
            @if (conf()?.amount != null) { <p class="pr-paid"><span>{{ 'Fee paid' | t: 'msme.paymentResult.rail.feeLabel' }}</span><b>₹ {{ conf()!.amount | number: '1.2-2' }}</b></p> }
            <a class="btn btn-primary pr-solid pr-go" [routerLink]="['/msme/certification', certification() + (surveillance() ? 'Surveillance' : '')]">
              {{ surveillance() ? ('Go to my {level} surveillance →' | t: 'msme.paymentResult.rail.surveillanceButton' : { level: name() }) : ('Go to my {level} application →' | t: 'msme.paymentResult.rail.applicationButton' : { level: name() }) }}</a>
          </aside>
        }
      </div>
    </div>
  `,
  // 2026-11-18 (the user's applicant designs, zed-msme-09): 14px cards, the 52px tick in a pale green halo, the 10px fact labels,
  // 42px buttons (dark teal / white with a teal border), the numbered "What happens next" timeline with the current step in a
  // pale teal box and YOU / ZED chips, the 40px "Go to my application" button, and the amber / red pending and failed cards.
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
    .pr-hero { display: flex; gap: 20px; align-items: center; padding: 2px 0 20px 0; border-bottom: 1px solid #dde7e8; }
    .pr-hero h2 { margin: 0; font-size: 24px; font-weight: 700; color: #17373b; }
    .pr-hero p { margin: 6px 0 0; font-size: 14px; font-weight: 500; color: #3d5559; }
    .pr-mark { flex: none; width: 52px; height: 52px; margin: 12px; border-radius: 50%; display: grid; place-items: center; background: #2f9e58; box-shadow: 0 0 0 12px #e5f5ea; }
    .pr-mark svg { width: 28px; height: 28px; fill: none; stroke: #fff; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .pr-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px 24px; margin: 0; padding: 18px 0 16px; border-bottom: 1px solid #dde7e8; }
    .pr-facts dt { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #6f8487; font-weight: 700; }
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
    .pr-h { display: flex; align-items: center; gap: 12px; min-height: 56px; margin: -24px -24px 14px; padding: 12px 20px; border-bottom: 1px solid #dde7e8; font-size: 16px; font-weight: 700; color: #17373b; }
    .pr-h h3 { margin: 0; font-size: 16px; font-weight: 700; color: #17373b; }
    .pr-rh { padding: 12px 24px; margin-bottom: 18px; }
    .pr-ico { flex: none; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: #e6f2f3; }
    .pr-ico svg { width: 16px; height: 16px; fill: none; stroke: #24666b; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    /* The steps: 24px numbered circles on a grey line, the current one in a pale teal box (80px a step). */
    .pr-next { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; counter-reset: s; }
    .pr-next li { counter-increment: s; position: relative; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px;
      min-height: 76px; margin-left: 46px; padding: 14px 20px; border-radius: 12px; }
    .pr-next li::before { content: counter(s); box-sizing: border-box; position: absolute; left: -38px; top: 16px; z-index: 1; width: 24px; height: 24px; border-radius: 50%;
      display: grid; place-items: center; border: 2px solid #c3d0d2; font-size: 11.5px; font-weight: 800; color: #6f8487; background: #fff; }
    .pr-next li:not(:last-child)::after { content: ''; position: absolute; left: -27px; top: 40px; bottom: -20px; width: 2px; background: #dde7e8; }
    .pr-next li.now { background: #e6f2f3; }
    .pr-next li.now::before { border: 3px solid #24666b; color: #24666b; }
    .pr-next b { font-size: 15px; font-weight: 700; color: #17373b; }
    .pr-next p { margin: 4px 0 0; font-size: 12.5px; font-weight: 500; line-height: 18px; color: #3d5559; }
    .pr-next i { display: inline-block; margin-left: 10px; padding: 0 10px; border-radius: 11px; font-style: normal; font-size: 11px; font-weight: 700; line-height: 22px;
      letter-spacing: .04em; background: #e5f5ea; color: #2f9e58; vertical-align: 1px; }
    .pr-next i.you { background: #e6f2f3; color: #24666b; }
    .pr-next li.now i.you { background: #fff; }
    .pr-apps { display: flex; align-items: center; gap: 8px; }
    .pr-dark { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 0 16px; background: #16292b; color: #fff; font-size: 12.5px; font-weight: 700;
      border-radius: 9px; text-transform: none; }
    .pr-dark:hover { background: #24363a; color: #fff; }
    /* Pending and failed: one action each and Contact helpdesk. */
    .pr-state { padding: 18px 20px 20px; }
    .pr-state h2 { display: flex; align-items: center; gap: 12px; margin: 0 0 14px; font-size: 15.5px; font-weight: 700; }
    .pr-state h2 span { flex: none; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: #fff; font-size: 18px; }
    .pr-state p { font-size: 12.5px; font-weight: 500; color: #17373b; }
    .pr-state .pr-solid, .pr-state .pr-line { min-width: 140px; min-height: 34px; font-size: 13px; }
    .pr-state .pr-mail { font-size: 12.5px; }
    .pr-state.warn { background: #fdf2dc; border-color: #f1d9a4; }
    .pr-state.warn h2 { color: #9a5f06; }
    .pr-state.bad { background: #fbe9e7; border-color: #f0c4bf; }
    .pr-state.bad h2 { color: #c8473c; }
    .pr-msg { font-size: 12.5px; color: #3d5559; }
    .pr-level { display: flex; align-items: center; gap: 14px; padding-bottom: 14px; border-bottom: 1px solid #dde7e8; }
    .pr-level img { width: 48px; height: 48px; object-fit: contain; }
    .pr-level b { display: block; font-size: 16px; font-weight: 700; color: #17373b; }
    .pr-chip { display: inline-block; margin-top: 4px; padding: 0 12px; border-radius: 11px; background: #e5f5ea; color: #2f9e58; font-size: 11px; font-weight: 700;
      line-height: 22px; letter-spacing: .04em; }
    .pr-paid { display: flex; justify-content: space-between; align-items: baseline; margin: 14px 0 12px; font-size: 12.5px; font-weight: 500; color: #6f8487; }
    .pr-paid b { font-size: 13.5px; font-weight: 700; color: #17373b; }
    .pr-go { display: flex; width: 100%; min-height: 40px; margin-top: 0; }
  `,
})
export class PaymentResultPage {
  /** Links to pages outside the portal, as the Admin set them (Admin → Links). */
  protected readonly links = inject(PortalLinksService);
  private readonly api = inject(PaymentApi);
  private readonly http = inject(HttpClient);
  // Query parameters, bound by the router.
  readonly status = input<string>('');
  readonly certification = input<string>('');
  readonly message = input<string>('');
  /** "surveillance" after a surveillance assessment payment (SurveillancePay success/failure views). */
  readonly kind = input<string>('');

  /** A pending payment confirmed by "Check status". */
  private readonly confirmed = signal(false);
  protected readonly state = computed<'success' | 'pending' | 'failure'>(() =>
    this.status() === 'success' || this.confirmed() ? 'success' : this.status() === 'pending' ? 'pending' : 'failure');
  protected readonly surveillance = computed(() => this.kind() === 'surveillance');
  private readonly paymentKind = computed<PaymentKind>(() => (this.surveillance() ? 'surveillance' : 'certification'));
  protected readonly name = computed(() => (this.certification() ? levelName(this.certification()) : 'ZED'));
  protected readonly logo = computed(() => levelLogo(this.certification()));
  protected readonly label = computed(() => this.surveillance()
    ? t('msme.paymentResult.surveillanceLabel', '{level} Surveillance', { level: this.name() })
    : t('msme.paymentResult.certificationLabel', '{level} Certification', { level: this.name() }));
  protected readonly crumbs = computed(() => [
    { label: t('msme.paymentResult.crumb.home', 'Home'), link: '/msme/dashboard' },
    { label: t('msme.paymentResult.crumb.certifications', 'Certifications'), link: '/msme/dashboard' },
    { label: this.label() },
    { label: t('msme.paymentResult.crumb.payment', 'Payment') },
  ]);
  protected readonly title = computed(() => this.state() === 'success' ? t('msme.paymentResult.title', 'Payment confirmation')
    : this.state() === 'pending' ? t('msme.paymentResult.pendingTitle', 'Payment pending') : t('msme.paymentResult.failedTitle', 'Payment failed'));
  protected readonly subtitle = computed(() => {
    if (this.state() === 'pending') return t('msme.paymentResult.pending.sub', 'Step 3 of 4: we are confirming your payment with the bank.');
    if (this.state() === 'failure') return t('msme.paymentResult.failed.sub', 'Step 3 of 4: the payment did not go through.');
    return this.surveillance() ? t('msme.paymentResult.surveillance.sub', 'Step 4 of 4: your {level} surveillance payment is complete.', { level: this.name() })
      : t('msme.paymentResult.sub', 'Step 4 of 4: your {level} application has been created.', { level: this.name() });
  });
  protected readonly steps = computed<TrackerStep[]>(() => {
    const done = this.state() === 'success';
    const doneNote = t('msme.paymentResult.tracker.doneNote', 'Done');
    return [
      { label: t('msme.payment.tracker.disclaimerLabel', 'Disclaimer'), note: doneNote },
      { label: t('msme.payment.tracker.feeLabel', 'Fee & tax details'), note: doneNote },
      { label: t('msme.payment.tracker.paymentLabel', 'Payment'), note: done ? doneNote : this.state() === 'pending'
        ? t('msme.paymentResult.tracker.awaitingNote', 'Awaiting the bank') : t('msme.paymentResult.tracker.notCompletedNote', 'Not completed') },
      { label: t('msme.payment.tracker.confirmationLabel', 'Confirmation'), note: done ? doneNote : t('msme.payment.tracker.confirmationNote', 'Receipt and next steps') },
    ];
  });
  /** "You can now start the <strong>{level} Certification</strong> from the app…": the sentence around its bold value. */
  protected readonly appLine = computed(() => {
    const bold = t('msme.paymentResult.next.appCertification', '{level} Certification', { level: this.name() });
    return boldParts(t('msme.paymentResult.next.appText',
      'You can now start the {certification} from the ZED MSME Mobile Application: basic information and documents are submitted in the app.',
      { certification: BOLD }), bold);
  });

  protected readonly conf = signal<PaymentConfirmation | null>(null);
  protected readonly sending = signal(false);
  protected readonly sentTo = signal('');
  protected readonly mailError = signal('');
  protected readonly checking = signal(false);
  protected readonly checkNote = signal('');
  /** A level with a site visit (Silver, Gold; the Admin's levels by their assessment mode). */
  protected readonly siteVisit = signal(true);

  constructor() {
    effect(() => {
      const cert = this.certification();
      if (this.state() !== 'success' || !cert) return;
      untracked(() => {
        if (!this.conf()) void this.loadConfirmation(); // "Check status" has it already
      });
    });
    effect(() => {
      const cert = this.certification();
      if (!cert || this.surveillance()) return;
      untracked(() => {
        if (isLegacyLevel(cert)) this.siteVisit.set(cert !== 'Bronze');
        else firstValueFrom(this.http.get<{ code: string; assessmentMode: string }[]>('/api/public/levels'))
          .then((l) => this.siteVisit.set(l.find((x) => x.code === cert)?.assessmentMode !== 'Desktop')).catch(() => undefined);
      });
    });
  }

  /** Try again: the apply flow of the level (dashboard ?apply=), or the surveillance payment page. */
  protected readonly retryLink = computed(() => (this.surveillance() && this.certification() ? ['/msme/surveillance-payment', this.certification()] : ['/msme/dashboard']));
  protected readonly retryQuery = computed(() => (!this.surveillance() && this.certification() ? { apply: this.certification() } : {}));

  private async loadConfirmation(): Promise<PaymentConfirmation | null> {
    try {
      const c = await firstValueFrom(this.api.confirmation(this.certification(), this.paymentKind()));
      this.conf.set(c);
      return c;
    } catch {
      return null; // the page still shows the success; the details are left out
    }
  }

  /** "Check status" of a pending payment: shown as paid once the payment is recorded. */
  protected async checkStatus(): Promise<void> {
    this.checking.set(true);
    this.checkNote.set('');
    try {
      const c = await firstValueFrom(this.api.confirmation(this.certification(), this.paymentKind()));
      this.conf.set(c);
      this.confirmed.set(true);
    } catch (err) {
      this.checkNote.set(err instanceof HttpErrorResponse && err.status === 404
        ? t('msme.paymentResult.pending.notConfirmedMessage', 'Not confirmed yet. Please check again in a few minutes.') : apiErrorMessage(err));
    } finally {
      this.checking.set(false);
    }
  }

  protected async emailCopy(): Promise<void> {
    this.sending.set(true);
    this.mailError.set('');
    try {
      const r = await firstValueFrom(this.api.emailCopy(this.certification(), this.paymentKind()));
      this.sentTo.set(r.sentTo);
    } catch (err) {
      this.mailError.set(apiErrorMessage(err));
    } finally {
      this.sending.set(false);
    }
  }
}
