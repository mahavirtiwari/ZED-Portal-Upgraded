import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { CertificationApi, CertificationData } from '../certification/certification.api';
import { AssessmentApi, AssessmentReport, NonConformanceReport, Row, assessmentType } from './assessment.api';
import { FileItem, NcRequirementView, NcSectionView, SectionView, basicInfoSections, nonConformanceRounds, photosOfType } from './assessment-view';
import { ParameterNav } from '../shared/parameter-status';
import { ThreadMessage, hasContent, message } from '../shared/nc-thread';
import { Crumb, PageHead } from '../shared/page-head';
import { UnitFacts } from '../shared/unit-facts';
import { levelName } from '../shared/levels';

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
  imports: [RouterLink, NgTemplateOutlet, PageHead, UnitFacts],
  templateUrl: './assessment-report.html',
  styleUrls: ['../shared/msme-page.scss', './assessment-report.scss'],
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
  /** 2026-11-14: the level's name ("Bronze", "Bronze surveillance") for the header and the facts strip. */
  protected readonly levelTitle = computed(() => {
    const c = this.type() ?? this.certification() ?? '';
    const base = c.replace(/Surveillance$/i, '');
    return levelName(base) + (base !== c ? ' surveillance' : '');
  });
  protected readonly pageTitle = computed(() =>
    `${this.levelTitle()}: ${this.mode() === 'basic-info' ? 'Basic information and documents' : 'Non-conformances'}`);
  protected readonly crumbs = computed<Crumb[]>(() => [
    { label: 'Home', link: '/msme/dashboard' },
    { label: `${this.levelTitle()} certification`, link: ['/msme/certification', this.certification()] },
    { label: this.mode() === 'basic-info' ? 'Basic information' : 'Non-conformances' },
  ]);

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
  /** Parameters tab: the parameter list and the selected parameter (the unit's report has no conformance: no status). */
  protected readonly pn = new ParameterNav<SectionView, SectionView['requirements'][number]>({
    sections: () => this.sections(),
    id: (s) => String(s.section['SectionCode'] ?? ''),
    requirements: (s) => s.requirements,
    conformance: () => null,
  });
  protected readonly esg = computed(() => (this.basic()?.esgCheckList ?? []).filter((e) => e['CheckListType'] === 'ESG'));
  protected readonly social = computed(() => (this.basic()?.esgCheckList ?? []).filter((e) => e['CheckListType'] === 'SOCIAL/OHS'));

  protected readonly rounds = computed(() => (this.nc() ? nonConformanceRounds(this.nc()!) : []));
  protected readonly round = computed(() => this.rounds().find((r) => r.number === this.ncTab()) ?? null);
  protected readonly siteVariant = computed(() => this.nc()?.variant === 'sa');
  /** NC tabs: the round's parameters that have requirements in it. */
  protected readonly ncSections = computed(() => (this.round()?.sections ?? []).filter((s) => s.requirements.length > 0));
  /**
   * NC tabs: the round's parameter list and the selected parameter. The unit's report has no conformance of the round, so
   * the progress counts the requirements the unit has answered.
   */
  protected readonly rn = new ParameterNav<NcSectionView, NcRequirementView>({
    sections: () => this.ncSections(),
    id: (s) => String(s.section['SectionCode'] ?? ''),
    requirements: (s) => s.requirements,
    conformance: (r) => (r.responded ? 'Yes' : null),
  });

  protected readonly backLink = computed(() => ['/msme/certification', this.certification()]);

  constructor() {
    effect(() => {
      const type = this.type();
      const mode = this.mode();
      untracked(() => void this.load(type, mode));
    });
  }

  /**
   * NC tabs: the requirement's conversation up to the round shown, oldest first: per round the assessor's comment that
   * raised it (the first with the documents / photos it was raised on) and the unit's reply (comments and documents).
   */
  protected ncThread(req: NcRequirementView): ThreadMessage[] {
    const shown = this.round()?.number ?? 0;
    const same = (x: NcRequirementView) =>
      String(x.requirement['SectionCode']) === String(req.requirement['SectionCode']) && String(x.requirement['RequirementCode']) === String(req.requirement['RequirementCode']);
    const out: ThreadMessage[] = [];
    let first = true;
    for (const rv of this.rounds().filter((x) => x.number <= shown)) {
      const rq = rv.sections.flatMap((x) => x.requirements).find(same);
      if (!rq) continue;
      // From NC2 on, what the NC was raised on is the previous reply's documents, already in the conversation.
      const raisedOn = first ? rq.previous.filter((e) => !!e.url) : [];
      first = false;
      out.push(message('assessor', `NC${rv.number} raised`, {
        date: this.value(rq.requirement['PreviousAssessorUpdatedDate']),
        text: this.value(rq.requirement['PreviousAssessorRemarks']),
        files: raisedOn.filter((e) => e.isPdf).map((e) => ({ name: e.label, url: e.url ?? '' })),
        pictures: raisedOn.filter((e) => !e.isPdf).map((e) => ({ name: e.label, url: e.url ?? '' })),
      }));
      if (rq.responded) {
        out.push(message('msme', `NC${rv.number}`, {
          date: this.value(rq.requirement['MsmeUpdatedDate']),
          text: this.value(rq.requirement['MsmeComments']),
          all: rq.current.map((e) => ({ name: this.value(e['EvidenceName']), url: this.value(e['FileUrl']) })),
        }));
      }
    }
    return out.filter(hasContent);
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
