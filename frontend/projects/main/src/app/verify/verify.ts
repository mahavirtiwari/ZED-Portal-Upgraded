import { HttpClient } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';

/** GET /api/verify/{type}/{code}. */
export interface VerifyResponse {
  certification: 'Pledge' | 'Bronze' | 'Silver' | 'Gold';
  details: Record<string, string | null>;
}

/** Route types of the QR codes (Verify/PC|BC|SC|GC/{code}). */
const TYPES = ['pc', 'bc', 'sc', 'gc'];

interface Line {
  label: string;
  value: string | null;
}

/**
 * Public certificate verification, opened from the QR code printed on the pledge, Bronze, Silver and Gold
 * certificates (https://loginzed.msme.gov.in/Verify/BC/{code}). Port of Views/Verify/Pc|Bc|Sc|Gc.cshtml.
 */
@Component({
  selector: 'zed-verify',
  host: { class: 'd-block' },
  template: `
    <header class="verify-header">
      <a href="https://msme.gov.in/" target="_blank" rel="noopener"><img src="/Images/header/ministry.png" alt="Ministry of MSME" width="200" /></a>
      <img src="/Images/header/zed-logo.png" alt="ZED" width="100" />
    </header>
    <div class="container form-page">
      <div class="row justify-content-center">
        <div class="col-md-8">
          @if (error()) {
            <div class="alert alert-danger mt-4" role="alert">{{ error() }}</div>
          }
          @if (result(); as r) {
            <table class="table table-bordered table-striped mt-4">
              <thead>
                <tr>
                  <th class="text-center">
                    <h3 style="color: #fff">{{ r.certification }} Certification Details</h3>
                    <small>{{ r.certification === 'Pledge' ? r.details['DateOfPledge'] : r.details['DateOfCertification'] }}</small>
                  </th>
                </tr>
              </thead>
              <tbody>
                @for (l of lines(); track l.label) {
                  <tr><td><strong>{{ l.label }}: </strong><br class="d-sm-none" />{{ l.value }}</td></tr>
                }
              </tbody>
            </table>
          }
        </div>
      </div>
    </div>
    @if (loading()) {
      <div class="loadingdiv" style="display: block" role="status" aria-live="polite">
        <div class="loadingimage"><div class="loader"></div></div>
      </div>
    }
  `,
  styles: `
    .verify-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 24px; border-bottom: 1px solid #ddd; }
    thead th { background: #45a5ad; color: #fff; }
  `,
})
export class VerifyPage {
  /** Route parameters. */
  readonly type = input<string>('');
  readonly code = input<string>('');

  private readonly http = inject(HttpClient);
  private request = 0;

  protected readonly result = signal<VerifyResponse | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');

  protected readonly lines = computed<Line[]>(() => {
    const r = this.result();
    if (!r) return [];
    const d = r.details;
    const common: Line[] = [
      { label: 'Unit Name', value: d['EnterpriseName'] },
      { label: 'Udyam Registration No.', value: d['UdyogAadharNo'] },
      { label: 'Address', value: d['Address'] },
    ];
    if (r.certification === 'Pledge') {
      return [...common, { label: 'Date of Pledge', value: d['DateOfPledge'] }, { label: 'Certificate No.', value: d['CertificateNo'] }];
    }
    const lines: Line[] = [
      ...common,
      { label: 'Date of Certification', value: d['DateOfCertification'] },
      { label: 'Certificate Valid upto', value: d['DateOfExpiry'] },
      { label: 'Certificate No.', value: d['CertificateNo'] },
      { label: 'Certification Status', value: d['CertificationPhase'] },
    ];
    const completed = d['SurveillanceCompletionDate'];
    if (r.certification === 'Bronze') {
      lines.push(completed ? { label: 'Surveillance completed on', value: completed } : { label: 'Surveillance Due Date', value: d['FirstSurveDueDate'] });
    } else if (d['OldSurveillanceDate']) {
      lines.push({ label: 'Surveillance 1 completed on', value: d['OldSurveillanceDate'] });
      lines.push({ label: 'Surveillance 2 completed on', value: completed });
    } else {
      lines.push(completed ? { label: 'Surveillance 1 completed on', value: completed } : { label: 'Surveillance 1 Due Date', value: d['FirstSurveDueDate'] });
    }
    return lines;
  });

  constructor() {
    effect(() => {
      const type = this.type().toLowerCase();
      const code = this.code();
      untracked(() => void this.load(type, code));
    });
  }

  private async load(type: string, code: string): Promise<void> {
    const request = ++this.request;
    this.result.set(null);
    this.error.set('');
    if (!TYPES.includes(type) || !/^[A-Za-z0-9]{1,50}$/.test(code)) {
      this.error.set('Invalid verification link.');
      return;
    }
    this.loading.set(true);
    try {
      const r = await firstValueFrom(this.http.get<VerifyResponse>(`/api/verify/${type}/${encodeURIComponent(code)}`));
      if (request === this.request) this.result.set(r);
    } catch (err) {
      if (request === this.request) this.error.set(apiErrorMessage(err));
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }
}
