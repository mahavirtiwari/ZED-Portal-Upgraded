import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PortalLinksService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ContentTextComponent } from '../../content/content-text';
import { isLegacyLevel, levelLogo, levelName } from '../shared/levels';
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
  imports: [RouterLink, ContentTextComponent, PageHead, StepTracker, DecimalPipe, DatePipe],
  template: `
    <div class="container form-page result-page">
      <zed-page-head [crumbs]="[{ label: 'Home', link: '/msme/dashboard' }, { label: 'Certifications', link: '/msme/dashboard' }, { label: label() }, { label: 'Payment' }]"
                     [title]="state() === 'success' ? 'Payment confirmation' : state() === 'pending' ? 'Payment pending' : 'Payment failed'" [subtitle]="subtitle()">
        <a class="btn btn-ph" routerLink="/msme/dashboard">← Back to dashboard</a>
      </zed-page-head>
      <zed-step-tracker class="pr-tracker" [steps]="steps()" [current]="state() === 'success' ? 4 : 2" label="Application steps" />

      <div class="pr-cols">
        <div class="pr-main">
          @switch (state()) {
            @case ('success') {
              <section class="pr-card zed-payment-success">
                <div class="pr-hero">
                  <span class="pr-mark ok" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
                  <div>
                    <h2>Payment successful</h2>
                    <p>@if (conf()?.amount != null) { ₹ {{ conf()!.amount | number: '1.2-2' }} received for {{ label() }}. }
                      @else { Your payment towards {{ surveillance() ? 'ZED Surveillance' : 'ZED Certification' }} has been successful. }</p>
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
                    @if (c.receiptUrl) { <a class="btn btn-primary pr-solid" [href]="c.receiptUrl" target="_blank" rel="noopener">⤓ Download receipt</a> }
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

              @if (!surveillance()) {
                <section class="pr-card" aria-labelledby="nextTitle">
                  <h3 class="pr-h" id="nextTitle">What happens next</h3>
                  <ol class="pr-next">
                    <li class="now">
                      <div><b>Download the ZED MSME mobile app</b> <i class="you">YOU</i>
                        <p>You can now start the <strong>{{ name() }} Certification</strong> from the ZED MSME Mobile Application: basic information and documents are submitted in the app.</p></div>
                      <div class="pr-apps">
                        @if (links.url('appStore'); as u) { <a class="btn pr-dark" [href]="u" target="_blank" rel="noopener">iOS app</a> }
                        @if (links.url('playStore'); as u) { <a class="btn pr-dark" [href]="u" target="_blank" rel="noopener">Android app</a> }
                        <img src="/api/public/links/playStore/qr" width="64" height="64" alt="QR code for the ZED MSME app" />
                      </div>
                    </li>
                    <li><div><b>Fill Basic Information and upload documents</b> <i class="you">YOU</i><p>Your application moves to verification once you submit.</p></div></li>
                    <li><div><b>Desktop verification</b> <i>ZED</i><p>An assessor reviews your documents. Non-conformances, if any, are raised to you.</p></div></li>
                    @if (siteVisit()) {
                      <li><div><b>Site visit and certification</b> <i>ZED</i><p>After the on-site assessment, your certificate and report are generated.</p></div></li>
                    } @else {
                      <li><div><b>Certification</b> <i>ZED</i><p>Once the assessment is complete, your certificate and report are generated.</p></div></li>
                    }
                  </ol>
                </section>
              }
            }
            @case ('pending') {
              <section class="pr-card pr-state warn" role="status">
                <h2><span aria-hidden="true">◷</span> Payment pending</h2>
                <p>We are confirming with your bank. This can take a few minutes. Please do not pay again.</p>
                @if (message()) { <p class="pr-msg">{{ message() }}</p> }
                @if (checkNote()) { <p class="pr-msg">{{ checkNote() }}</p> }
                <div class="pr-actions">
                  <button type="button" class="btn pr-line" [disabled]="checking()" (click)="checkStatus()">Check status</button>
                  <a class="btn btn-link pr-mail" routerLink="/msme/contact">Contact helpdesk</a>
                </div>
              </section>
            }
            @default {
              <section class="pr-card pr-state bad" role="alert">
                <h2><span aria-hidden="true">✕</span> Payment failed</h2>
                <zed-text key="msme.payment.failed"><p>There seems to be a problem with the payment, please try again and if this issue repeats, contact us at zed.support&#64;qcin.org</p></zed-text>
                <p>No amount was collected. If money left your account, your bank reverses it automatically.</p>
                @if (message()) { <p class="pr-msg"><b>Error Message</b>: <span>{{ message() }}</span></p> }
                <div class="pr-actions">
                  <a class="btn btn-primary pr-solid" [routerLink]="retryLink()" [queryParams]="retryQuery()">Try again</a>
                  <a class="btn btn-link pr-mail" routerLink="/msme/contact">Contact helpdesk</a>
                </div>
              </section>
            }
          }
        </div>

        @if (state() === 'success' && certification()) {
          <aside class="pr-card pr-rail" aria-labelledby="createdTitle">
            <h3 class="pr-h" id="createdTitle">{{ surveillance() ? 'Surveillance paid' : 'Application created' }}</h3>
            <div class="pr-level">
              <img [src]="logo()" alt="" />
              <div><b>{{ label() }}</b><span class="pr-chip">✓ {{ surveillance() ? 'PAYMENT RECEIVED' : 'APPLICATION RECEIVED' }}</span></div>
            </div>
            @if (conf()?.amount != null) { <p class="pr-paid"><span>Fee paid</span><b>₹ {{ conf()!.amount | number: '1.2-2' }}</b></p> }
            <a class="btn btn-primary pr-solid pr-go" [routerLink]="['/msme/certification', certification() + (surveillance() ? 'Surveillance' : '')]">
              Go to my {{ name() }} {{ surveillance() ? 'surveillance' : 'application' }} →</a>
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
    .pr-next { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; counter-reset: s; }
    .pr-next li { counter-increment: s; position: relative; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px;
      padding: 12px 16px 12px 52px; border-radius: 10px; }
    .pr-next li::before { content: counter(s); position: absolute; left: 12px; top: 14px; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center;
      border: 2px solid #c9d6d7; font-size: 12px; font-weight: 700; color: #5f6f70; background: #fff; }
    .pr-next li.now { background: #e9f3f3; }
    .pr-next li.now::before { border-color: var(--zt-dark, #1f5c61); color: var(--zt-dark, #1f5c61); }
    .pr-next b { color: #24393b; }
    .pr-next p { margin: 2px 0 0; font-size: 13.5px; color: #4b5b5c; }
    .pr-next i { font-style: normal; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px; background: #dcf1e3; color: #1e7a3c; margin-left: 6px; }
    .pr-next i.you { background: #e3ecec; color: var(--zt-dark, #1f5c61); }
    .pr-apps { display: flex; align-items: center; gap: 8px; }
    .pr-dark { background: #1d2b2c; color: #fff; font-weight: 700; border-radius: 8px; }
    .pr-state h2 { font-size: 20px; font-weight: 700; margin: 0 0 8px; }
    .pr-state.warn { background: #fdf6e6; border-color: #f0dca8; }
    .pr-state.warn h2 { color: #9a6700; }
    .pr-state.bad { background: #fcebea; border-color: #f2c4c0; }
    .pr-state.bad h2 { color: #c0392b; }
    .pr-msg { font-size: 13.5px; color: #4b5b5c; }
    .pr-level { display: flex; align-items: center; gap: 14px; padding-bottom: 14px; border-bottom: 1px solid #e8eff0; }
    .pr-level img { width: 52px; height: 52px; object-fit: contain; }
    .pr-level b { display: block; font-size: 17px; color: var(--zt-ink, #173f44); }
    .pr-chip { display: inline-block; margin-top: 4px; padding: 2px 10px; border-radius: 10px; background: #dcf1e3; color: #1e7a3c; font-size: 11.5px; font-weight: 700; }
    .pr-paid { display: flex; justify-content: space-between; margin: 12px 0; color: #5f6f70; }
    .pr-paid b { color: #24393b; }
    .pr-go { display: block; width: 100%; text-align: center; margin-top: 8px; }
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
  protected readonly label = computed(() => `${this.name()} ${this.surveillance() ? 'Surveillance' : 'Certification'}`);
  protected readonly subtitle = computed(() => {
    if (this.state() === 'pending') return 'Step 3 of 4: we are confirming your payment with the bank.';
    if (this.state() === 'failure') return 'Step 3 of 4: the payment did not go through.';
    return this.surveillance() ? `Step 4 of 4: your ${this.name()} surveillance payment is complete.` : `Step 4 of 4: your ${this.name()} application has been created.`;
  });
  protected readonly steps = computed<TrackerStep[]>(() => {
    const done = this.state() === 'success';
    return [
      { label: 'Disclaimer', note: 'Done' },
      { label: 'Fee & tax details', note: 'Done' },
      { label: 'Payment', note: done ? 'Done' : this.state() === 'pending' ? 'Awaiting the bank' : 'Not completed' },
      { label: 'Confirmation', note: done ? 'Done' : 'Receipt and next steps' },
    ];
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
        ? 'Not confirmed yet. Please check again in a few minutes.' : apiErrorMessage(err));
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
