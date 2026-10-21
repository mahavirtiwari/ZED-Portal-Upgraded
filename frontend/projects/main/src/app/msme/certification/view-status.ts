import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ClientConfigService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { CertificationSteps } from './certification-steps';
import { CertificationApi, CertificationData, canonicalCertification, incentiveUrl } from './certification.api';

/** The old status page only had the Bronze and Silver/Gold timelines. */
const LEVELS = ['Bronze', 'Silver', 'Gold'];

/**
 * Status timeline of one certification of the signed-in MSME. Port of Views/Msme/ViewStatus.cshtml.
 * The old page had no sign-in and took the ZED ID from the address; no page of the old portal links to
 * it. This port shows the signed-in MSME's own status only.
 */
@Component({
  selector: 'zed-msme-view-status',
  imports: [RouterLink, CertificationSteps],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="msme-cer-details">
        @if (error()) {
          <div class="alert alert-danger mt-3" role="alert">
            {{ error() }}
            <a class="btn btn-link" routerLink="/msme/dashboard">Back to dashboard</a>
          </div>
        }
        @if (data(); as d) {
          <div class="row">
            <div class="col-12">
              <h3 class="registration-title">Status</h3>
              <zed-certification-steps [certification]="d.certification" [status]="d.status" [incentiveUrl]="incentiveUrl()" />
            </div>
          </div>
        }
      </div>
    </div>

    @if (loading()) {
      <div class="loadingdiv" style="display: block" role="status" aria-live="polite">
        <div class="loadingimage">
          <div class="loader"></div>
          <div class="text-center">
            <small>Please wait ...</small><br />
            <small>It may take upto 60 seconds</small>
          </div>
        </div>
      </div>
    }
  `,
})
export class ViewStatusPage {
  /** Route parameter :certification (Bronze, Silver or Gold). */
  readonly certification = input.required<string>();

  private readonly api = inject(CertificationApi);
  private readonly config = inject(ClientConfigService);
  private request = 0;

  protected readonly data = signal<CertificationData | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  private readonly legacyUrl = signal('');

  protected readonly type = computed(() => {
    const t = canonicalCertification(this.certification());
    return t && LEVELS.includes(t) ? t : null;
  });

  protected readonly incentiveUrl = computed(() => incentiveUrl(this.data()));

  constructor() {
    effect(() => {
      const type = this.type();
      untracked(() => void this.load(type));
    });
  }

  private async load(type: string | null): Promise<void> {
    const request = ++this.request;
    this.error.set('');
    if (!type) {
      this.data.set(null);
      this.error.set('Invalid certification.');
      return;
    }
    this.loading.set(true);
    try {
      const [config, data] = await Promise.all([this.config.get().catch(() => null), firstValueFrom(this.api.get(type))]);
      if (request !== this.request) return;
      this.legacyUrl.set(config?.legacyPortalUrl ?? '');
      this.data.set(data);
    } catch (err) {
      if (request !== this.request) return;
      this.data.set(null);
      this.error.set(apiErrorMessage(err));
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }
}
