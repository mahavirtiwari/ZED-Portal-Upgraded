import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Where the browser lands after the payment gateway (or a zero-amount payment).
 * Port of Views/Pay/success.cshtml and failure.cshtml, and of the SurveillancePay ones (kind=surveillance).
 */
@Component({
  selector: 'zed-payment-result',
  imports: [RouterLink],
  template: `
    <div class="container">
      <div class="row justify-content-center">
        <div class="col-sm-9 Dashboard zed-payment-success" style="margin-top: 20px">
          @if (succeeded()) {
            <div class="jumbotron text-center">
              <img src="/Images/svgicons/payment-success.svg" alt="" />
              <h2>Payment Successful!</h2>
              @if (surveillance()) {
                <!-- Views/SurveillancePay/success.cshtml -->
                <p>Your payment towards ZED Surveillance has been successful.</p>
                <div class="w-50 m-auto"><div class="line-icon"></div></div>
              } @else {
                <p>Your payment towards ZED Certification has been successful.</p>
                <p>You can now start the <strong>{{ certificationLabel() }}</strong> from the ZED MSME Mobile Application to proceed to the next step, i.e. Basic Information and Document Upload</p>
                <div class="w-50 m-auto"><div class="line-icon"></div></div>
                <div class="label-highlight">
                  <p>You can now start the <strong>{{ certificationLabel() }}</strong> from the ZED MSME Mobile Application</p>
                  <a href="https://play.google.com/store/apps/details?id=com.qci.zed.msme" target="_blank" rel="noopener"><img src="/Images/google-play.png" alt="Get it on Google Play" width="110" /></a>
                  <img src="/Images/qrcode.png" width="80" alt="QR code for the ZED MSME app" />
                </div>
              }
            </div>
          } @else {
            <div class="jumbotron text-center">
              <img src="/Images/payment/payment-error.png" alt="" width="150" />
              <h2>Payment Failed</h2>
              <p>There seems to be a problem with the payment, please try again and if this issue repeats, contact us at zed.support&#64;qcin.org</p>
              @if (message()) {
                <p><b>Error Message</b>: <span>{{ message() }}</span></p>
              }
            </div>
          }
          <div class="stepper-footer-sec initial-step">
            <a class="btn btn-primary" routerLink="/msme/dashboard">BACK TO DASHBOARD</a>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class PaymentResultPage {
  // Query parameters, bound by the router.
  readonly status = input<string>('');
  readonly certification = input<string>('');
  readonly message = input<string>('');
  /** "surveillance" after a surveillance assessment payment (SurveillancePay success/failure views). */
  readonly kind = input<string>('');

  protected readonly succeeded = computed(() => this.status() === 'success');
  protected readonly surveillance = computed(() => this.kind() === 'surveillance');
  protected readonly certificationLabel = computed(() =>
    this.certification() ? `${this.certification()} Certification` : 'certification',
  );
}
