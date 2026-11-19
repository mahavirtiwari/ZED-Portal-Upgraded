import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ClientConfigService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { TextPipe, t } from '../../content/page-text';
import { CertificationTimeline } from './certification-timeline';
import { progressOptions, progressSteps, timelineItems } from './certification-progress';
import { CertificationApi, CertificationData, canonicalCertification, certificationKind, certificationLevel, incentiveUrl } from './certification.api';
import { PageHead } from '../shared/page-head';
import { StepTracker } from '../shared/step-tracker';
import { PublicLevels, levelName } from '../shared/levels';


/**
 * Status timeline of one certification of the signed-in MSME. Port of Views/Msme/ViewStatus.cshtml.
 * The old page had no sign-in and took the ZED ID from the address; no page of the old portal links to
 * it. This port shows the signed-in MSME's own status only.
 * 2026-11-17 (the user's applicant design, zed-msme-01): the certification page's look: page head, step tracker and the
 * application timeline.
 */
@Component({
  selector: 'zed-msme-view-status',
  imports: [RouterLink, PageHead, StepTracker, CertificationTimeline, TextPipe],
  template: `
    <div class="container status-page">
      <zed-page-head [crumbs]="crumbs()" [title]="'Status' | t: 'msme.viewStatus.title'">
        <a class="btn btn-ph" routerLink="/msme/dashboard"><img src="/Images/svgicons/back.svg" alt="" /> {{ 'Back to dashboard' | t: 'msme.viewStatus.dashboardButton' }}</a>
      </zed-page-head>
      @if (error()) {
        <div class="alert alert-danger" role="alert">
          {{ error() }}
          <a class="btn btn-link" routerLink="/msme/dashboard">{{ 'Back to dashboard' | t: 'msme.viewStatus.dashboardButton' }}</a>
        </div>
      }
      @if (data()) {
        <zed-step-tracker class="vs-track" [steps]="progress().steps" [current]="progress().current" [label]="'Certification progress' | t: 'msme.viewStatus.trackerAria'" />
        <zed-certification-timeline [items]="timeline()" />
        @if (certified()) {
          <p class="vs-incentives"><a [href]="incentiveUrl()">{{ 'Click here to view your Incentives' | t: 'msme.viewStatus.incentivesLink' }}</a></p>
        }
      }
    </div>

    @if (loading()) {
      <div class="loadingdiv" style="display: block" role="status" aria-live="polite">
        <div class="loadingimage">
          <div class="loader"></div>
          <div class="text-center">
            <small>{{ 'Please wait ...' | t: 'msme.viewStatus.waitText' }}</small><br />
            <small>{{ 'It may take upto 60 seconds' | t: 'msme.viewStatus.waitNote' }}</small>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .status-page { max-width: 960px; padding-top: 20px; padding-bottom: 32px; }
    .vs-track { margin-bottom: 20px; }
    .vs-incentives { margin: 16px 0 0; font-weight: 700; }
    .vs-incentives a { color: var(--zt-dark, #1f5c61); }
  `,
})
export class ViewStatusPage {
  /** Route parameter :certification (Bronze, Silver, Gold or a V4 level). */
  readonly certification = input.required<string>();

  private readonly api = inject(CertificationApi);
  private readonly config = inject(ClientConfigService);
  private request = 0;

  protected readonly data = signal<CertificationData | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  private readonly legacyUrl = signal('');

  protected readonly type = computed(() => {
    // The old status page had the Bronze and Silver/Gold timelines: a level's own (ZED-X and the Admin's levels as
    // Silver / Gold), not its surveillance or a milestone.
    const c = canonicalCertification(this.certification());
    return c && ['bronze', 'silverGold'].includes(certificationKind(c)) ? c : null;
  });

  protected readonly incentiveUrl = computed(() => incentiveUrl(this.data()));

  private readonly levels = inject(PublicLevels);
  protected readonly crumbs = computed(() => [
    { label: t('msme.viewStatus.crumb.home', 'Home'), link: '/msme/dashboard' },
    { label: t('msme.viewStatus.crumb.certifications', 'Certifications'), link: '/msme/dashboard' },
    ...(this.type() ? [{ label: levelName(certificationLevel(this.type()!)), link: ['/msme/certification', this.type()!] }] : []),
    { label: t('msme.viewStatus.crumb.status', 'Status') },
  ]);
  private readonly options = computed(() => {
    const c = this.type() ?? 'Bronze';
    const code = certificationLevel(c).toLowerCase();
    return progressOptions(c, this.levels.levels()?.find((l) => l.code.toLowerCase() === code)?.assessmentFlow);
  });
  protected readonly progress = computed(() => progressSteps(this.data()?.status ?? {}, this.options()));
  protected readonly timeline = computed(() => timelineItems(this.data()?.status ?? {}, this.options()));
  protected readonly certified = computed(() => !!this.data()?.status?.['GetCertified']);

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
      this.error.set(t('msme.viewStatus.error.invalidLevel', 'Invalid certification.'));
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
