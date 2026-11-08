import { ContentTextComponent } from '../../content/content-text';
import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Where the browser lands after a handholding milestone payment (gateway or zero amount).
 * Port of Frontend/ConsultancyPay/success.cshtml and failure.cshtml.
 */
@Component({
  selector: 'zed-consultancy-result',
  imports: [RouterLink, ContentTextComponent],
  template: `
    <div class="container form-page">
      <div class="result-page zed-payment-success">
        <div class="page-head">
          <div>
            <h3 class="registration-title">Payment Status</h3>
          </div>
        </div>
        @if (succeeded()) {
          <div class="zed-card result-card text-center">
            <img src="/Images/svgicons/payment-success.svg" alt="" />
            <h2>Payment Successful!</h2>
            @switch (milestoneNumber()) {
              @case (1) { <p>Your payment towards <strong>ZED Handholding Support Milestone 1: Baseline Diagnostic Study and Handholding Action Plan</strong> is successful. </p> }
              @case (2) { <p>Your payment towards <strong>Milestone 2 : Implementation &amp; Progress Review 1</strong> is successful. </p> }
              @case (3) { <p>Your payment towards <strong>Milestone 3 : Implementation &amp; Progress Review 2</strong> is successful. </p> }
              @default { <p>Your payment is successful. </p> }
            }
            <div class="w-50 m-auto"><div class="line-icon"></div></div>
          </div>
          <div class="form-actions justify-content-center">
            <a class="btn btn-primary" routerLink="/msme/handholding">BACK TO DASHBOARD</a>
          </div>
        } @else {
          <div class="zed-card result-card text-center">
            <img src="/Images/payment/payment-error.png" alt="" width="150" />
            <h2>Payment Failed</h2>
            <zed-text key="msme.payment.failed"><p>There seems to be a problem with the payment, please try again and if this issue repeats, contact us at zed.support&#64;qcin.org</p></zed-text>
            @if (message()) {
              <p><b>Error Message</b>: <span>{{ message() }}</span></p>
            }
          </div>
          <div class="form-actions justify-content-center">
            <a class="btn btn-primary" routerLink="/msme/dashboard">BACK TO DASHBOARD</a>
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    .result-page { max-width: 760px; margin: 24px auto 0; }
    .result-card { padding: 32px 24px; }
    .result-card h2 { margin: 12px 0 8px; color: #23474a; font-weight: 700; }
    .result-card p { margin-bottom: 8px; }
  `,
})
export class ConsultancyResultPage {
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
}
