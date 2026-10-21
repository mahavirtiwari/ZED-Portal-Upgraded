import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { CertificationApi, CertificationData } from '../certification/certification.api';
import { AssessmentApi, AssessmentReport, NonConformanceReport, Row, assessmentType } from './assessment.api';
import { FileItem, basicInfoSections, nonConformanceRounds, photosOfType } from './assessment-view';

export type AssessmentMode = 'basic-info' | 'non-conformances';

type BasicTab = 'basicInfo' | 'esg' | 'elements';

/**
 * The MSME's view of its assessment. One component for the three old pages, which were copies of
 * the desktop assessor's review page:
 * - mode "basic-info": Views/Msme/BasicInfo.cshtml (Basic Information, ESG Checklist, Parameters / Document Uploaded);
 * - mode "non-conformances": Views/Msme/NonConformances.cshtml (Bronze) and NonConformancesSa.cshtml
 *   (Silver/Gold); the API says which one applies (variant "da" / "sa").
 * Read-only: the assessor and agency controls of the old scripts (validate, remarks, final submit,
 * document-opened timestamps) are not part of the MSME pages.
 */
@Component({
  selector: 'zed-msme-assessment-report',
  imports: [RouterLink, NgTemplateOutlet],
  templateUrl: './assessment-report.html',
  styleUrl: './assessment-report.scss',
})
export class AssessmentReportView {
  readonly mode = input.required<AssessmentMode>();
  /** Route parameter :certification. */
  readonly certification = input.required<string>();

  private readonly api = inject(AssessmentApi);
  private readonly certifications = inject(CertificationApi);
  private request = 0;
  private loadedKey = '';

  protected readonly type = computed(() => assessmentType(this.certification()));

  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly unit = signal<CertificationData | null>(null);
  protected readonly basic = signal<AssessmentReport | null>(null);
  protected readonly nc = signal<NonConformanceReport | null>(null);

  protected readonly basicTab = signal<BasicTab>('basicInfo');
  protected readonly ncTab = signal(1);
  protected readonly preview = signal<string | null>(null);
  protected readonly product = signal<Row | null>(null);
  protected readonly rawMaterial = signal<Row | null>(null);

  protected readonly msme = computed<Row>(() => this.unit()?.msme ?? {});
  protected readonly udyam = computed(() => this.unit()?.basicInfo['UdyogAadharNo'] ?? '');
  protected readonly answers = computed<Row>(() => this.basic()?.assessment ?? {});

  protected readonly selfies = computed(() => photosOfType(this.basic()?.photos ?? [], 'Selfie'));
  protected readonly exteriorPhotos = computed(() => photosOfType(this.basic()?.photos ?? [], 'SiteExteriorPhotos'));
  protected readonly sections = computed(() => (this.basic() ? basicInfoSections(this.basic()!) : []));
  protected readonly esg = computed(() => (this.basic()?.esgCheckList ?? []).filter((e) => e['CheckListType'] === 'ESG'));
  protected readonly social = computed(() => (this.basic()?.esgCheckList ?? []).filter((e) => e['CheckListType'] === 'SOCIAL/OHS'));

  protected readonly rounds = computed(() => (this.nc() ? nonConformanceRounds(this.nc()!) : []));
  protected readonly round = computed(() => this.rounds().find((r) => r.number === this.ncTab()) ?? null);
  protected readonly siteVariant = computed(() => this.nc()?.variant === 'sa');

  protected readonly backLink = computed(() => ['/msme/certification', this.certification()]);
  protected readonly pledgeCertificateUrl = '/api/msme/files/pledge-certificate';

  constructor() {
    effect(() => {
      const type = this.type();
      const mode = this.mode();
      untracked(() => void this.load(type, mode));
    });
  }

  protected refresh(): void {
    void this.load(this.type(), this.mode());
  }

  /** VIEW on a photo: images open in the preview dialog, PDFs in a new tab (the files API serves them inline). */
  protected view(item: FileItem): void {
    if (!item.url) return;
    if (item.isPdf) window.open(item.url, '_blank', 'noopener');
    else this.preview.set(item.url);
  }

  protected value(v: unknown): string {
    return v === null || v === undefined ? '' : String(v);
  }

  private async load(type: string | null, mode: AssessmentMode): Promise<void> {
    const request = ++this.request;
    this.error.set('');
    // Refresh keeps the page on screen until the new data arrives; another certification starts empty.
    const key = `${mode}/${type}`;
    if (key !== this.loadedKey) {
      this.loadedKey = key;
      this.basic.set(null);
      this.nc.set(null);
      this.unit.set(null);
    }
    if (!type) {
      this.unit.set(null);
      this.error.set('Invalid certification.');
      return;
    }
    this.loading.set(true);
    try {
      // The unit summary on the left is the certification page's data; the page still works without it.
      const unit = firstValueFrom(this.certifications.get(type)).catch(() => null);
      if (mode === 'basic-info') {
        const report = await firstValueFrom(this.api.basicInfo(type));
        if (request !== this.request) return;
        this.basic.set(report);
      } else {
        const report = await firstValueFrom(this.api.nonConformances(type));
        if (request !== this.request) return;
        this.nc.set(report);
        if (!report.rounds.some((r) => r.number === this.ncTab())) this.ncTab.set(report.rounds[0]?.number ?? 1);
      }
      const u = await unit;
      if (request === this.request && u) this.unit.set(u);
    } catch (err) {
      if (request !== this.request) return;
      this.basic.set(null);
      this.nc.set(null);
      this.error.set(apiErrorMessage(err));
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }
}

/** Msme/BasicInfo/{certification}: "Basic Information & Documents Upload". */
@Component({
  selector: 'zed-msme-basic-info',
  imports: [AssessmentReportView],
  template: `<zed-msme-assessment-report mode="basic-info" [certification]="certification()" />`,
})
export class BasicInfoPage {
  readonly certification = input.required<string>();
}

/** Msme/NonConformances/{certification} (Bronze) and Msme/NonConformancesSa/{certification} (Silver/Gold). */
@Component({
  selector: 'zed-msme-non-conformances',
  imports: [AssessmentReportView],
  template: `<zed-msme-assessment-report mode="non-conformances" [certification]="certification()" />`,
})
export class NonConformancesPage {
  readonly certification = input.required<string>();
}
