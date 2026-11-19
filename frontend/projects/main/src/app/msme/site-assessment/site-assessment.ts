import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { Row, SiteAssessmentApi, SiteAssessmentData, SitePhoto, SiteRequirement, SiteSection, canonicalSiteAssessment } from './site-assessment.api';
import { TextPipe, t } from '../../content/page-text';
import { Crumb, PageHead } from '../shared/page-head';
import { UnitFacts } from '../shared/unit-facts';
import { levelName } from '../shared/levels';
import { RequirementVideo } from '../shared/requirement-video';
import { ParameterNav } from '../shared/parameter-status';

export type SiteTab = 'basic' | 'tour' | 'parameters';

/** One block of a milestone's "Basic Information" (ConsultancyBasicInformation columns). */
interface InfoGroup {
  heading?: string;
  /** Emissions, Effluents, ... headings were centred; Electrical, Solar, ... left-aligned. */
  centred?: boolean;
  fields: readonly (readonly [label: string, column: string])[];
}

interface InfoSection {
  title: string;
  groups: readonly InfoGroup[];
}

const measures = () => t('msme.siteAssessment.info.measuresLabel', 'Measures Taken (New technologies, new machines, new processes etc.)');
const energy = (heading: string, prefix: string): InfoGroup => ({
  heading,
  fields: [[t('msme.siteAssessment.info.energy.unitLabel', 'Unit'), `${prefix}Unit`], [t('msme.siteAssessment.info.energy.shareLabel', '% of total consumption'), `${prefix}TotConsumpPer`]],
});

/** The milestone "Basic Information" tab, in the order and wording of the old page (the Admin can change the wording). */
export function milestoneInfo(): readonly InfoSection[] {
  return [
    {
      title: t('msme.siteAssessment.info.section1.title', 'Occupational (Workplace) Safety'),
      groups: [{
        fields: [
          [t('msme.siteAssessment.info.field.NumOfAccedents', 'No. of accidents (incl. fatalities & disabilities caused, if any)'), 'NumOfAccedents'],
          [t('msme.siteAssessment.info.field.NumOfNearMisses', 'No. of near misses'), 'NumOfNearMisses'],
          [t('msme.siteAssessment.info.field.ManHoursLast', 'Man hours lost'), 'ManHoursLast'],
          [t('msme.siteAssessment.info.field.LosttimeInjuryfreqRate', 'Lost Time Injury Frequency Rate (LTIFR)'), 'LosttimeInjuryfreqRate'],
        ],
      }],
    },
    {
      title: t('msme.siteAssessment.info.section2.title', 'Measurement of Timely Delivery'),
      groups: [{
        fields: [
          [t('msme.siteAssessment.info.field.NumOfDeliveries', 'Number of Deliveries'), 'NumOfDeliveries'],
          [t('msme.siteAssessment.info.field.NumOfDeliveriesOntimeFull', 'Number of Deliveries made On Time In Full (OTIF) per month'), 'NumOfDeliveriesOntimeFull'],
        ],
      }],
    },
    {
      title: t('msme.siteAssessment.info.section3.title', 'Planned Maintenance & Calibration'),
      groups: [{
        fields: [
          [t('msme.siteAssessment.info.field.MeanTimeToRepair', 'Mean Time To Repair (MTTR)'), 'MeanTimeToRepair'],
          [t('msme.siteAssessment.info.field.MeanTimeBetweenFailure', 'Mean Time Between Failure (MTBF)'), 'MeanTimeBetweenFailure'],
        ],
      }],
    },
    {
      title: t('msme.siteAssessment.info.section4.title', 'Energy Management'),
      groups: [
        energy(t('msme.siteAssessment.info.energy.electrical', 'Electrical'), 'Electri'),
        energy(t('msme.siteAssessment.info.energy.solar', 'Solar'), 'Solar'),
        energy(t('msme.siteAssessment.info.energy.wind', 'Wind'), 'Wind'),
        energy(t('msme.siteAssessment.info.energy.fossilFuel', 'Fossil Fuel'), 'Fossil'),
        energy(t('msme.siteAssessment.info.energy.gas', 'Gas'), 'Gas'),
        energy(t('msme.siteAssessment.info.energy.others', 'Others'), 'Others'),
        { fields: [[t('msme.siteAssessment.info.field.TotalCost', 'Total Cost'), 'TotalCost'], [measures(), 'EnergyMgmtMeasuresTaken']] },
      ],
    },
    {
      title: t('msme.siteAssessment.info.section5.title', 'Environment Management'),
      groups: [
        {
          heading: t('msme.siteAssessment.info.heading.emissions', 'Emissions'), centred: true,
          fields: [
            [t('msme.siteAssessment.info.field.Cox', 'COx (please mention unit)'), 'Cox'],
            [t('msme.siteAssessment.info.field.Nox', 'NOx (please mention unit)'), 'Nox'],
            [t('msme.siteAssessment.info.field.Sox', 'SOx (please mention unit)'), 'Sox'],
            [t('msme.siteAssessment.info.field.SuspPertiMaterial', 'Suspended Particulate Material (SPM)'), 'SuspPertiMaterial'],
          ],
        },
        {
          heading: t('msme.siteAssessment.info.heading.effluents', 'Effluents'), centred: true,
          fields: [[t('msme.siteAssessment.info.field.TotSuspenSolid', 'Total Suspended Solid (TSS)'), 'TotSuspenSolid'], [t('msme.siteAssessment.info.field.BioChemOxyDemand', 'Biochemical Oxygen Demand (BOD)'), 'BioChemOxyDemand']],
        },
        {
          heading: t('msme.siteAssessment.info.heading.solidWasteHazardousWaste', 'Solid Waste & Hazardous Waste'), centred: true,
          fields: [
            [t('msme.siteAssessment.info.field.SolidWaste', 'Solid Waste (Kg/Month)'), 'SolidWaste'],
            [t('msme.siteAssessment.info.field.PlasticWaste', 'Plastic Waste (Kg/Month)'), 'PlasticWaste'],
            [t('msme.siteAssessment.info.field.Ewaste', 'e-Waste (Kg/Month)'), 'Ewaste'],
            [t('msme.siteAssessment.info.field.hazardWaste', 'Hazardous Waste (Kg/Month)'), 'hazardWaste'],
          ],
        },
        { heading: t('msme.siteAssessment.info.heading.noiseLevel', 'Noise Level'), centred: true, fields: [[t('msme.siteAssessment.info.field.NoiseLevel', 'Noise Level (dB)'), 'NoiseLevel'], [measures(), 'EnviMgmtMeasuresTaken']] },
      ],
    },
    {
      title: t('msme.siteAssessment.info.section6.title', 'Human Resource Management'),
      groups: [{
        fields: [
          [t('msme.siteAssessment.info.field.EmpEngagedInActivities', '% of employees engaged in improvement activities'), 'EmpEngagedInActivities'],
          [t('msme.siteAssessment.info.field.NumOfSuggestions', 'No. of suggestions received'), 'NumOfSuggestions'],
          [t('msme.siteAssessment.info.field.HrmMeasuresTaken', 'Measures Taken to develop human resources'), 'HrmMeasuresTaken'],
        ],
      }],
    },
    {
      title: t('msme.siteAssessment.info.section7.title', 'Measurement & Analysis'),
      groups: [{
        fields: [
          [t('msme.siteAssessment.info.field.Defects', 'Defects (%)'), 'Defects'],
          [t('msme.siteAssessment.info.field.ReWork', 'Rework (%)'), 'ReWork'],
          [t('msme.siteAssessment.info.field.CustRejections', 'Customer Rejections (%)'), 'CustRejections'],
          [t('msme.siteAssessment.info.field.NumOfCustComplaints', 'Number of Customer Complaints'), 'NumOfCustComplaints'],
          [t('msme.siteAssessment.info.field.NumOfComplaintsResolved', 'Customer Complaints resolved (%)'), 'NumOfComplaintsResolved'],
          [t('msme.siteAssessment.info.field.CustSatisLevel', 'Customer Satisfaction level (%)'), 'CustSatisLevel'],
          [t('msme.siteAssessment.info.field.CostOfPoorQuality', 'Cost of Poor Quality (COPQ)'), 'CostOfPoorQuality'],
        ],
      }],
    },
    {
      title: t('msme.siteAssessment.info.section8.title', 'Natural Resources Management'),
      groups: [
        {
          heading: t('msme.siteAssessment.info.heading.1ConsumptionOfNaturalResources', '1. Consumption of natural resources'), centred: true,
          fields: [[t('msme.siteAssessment.info.field.Water', 'Water (Litres)'), 'Water'], [t('msme.siteAssessment.info.field.Minarals', 'Minerals (Coal) (Kg)'), 'Minarals'], [t('msme.siteAssessment.info.field.Wood', 'Wood (Kg)'), 'Wood'], [t('msme.siteAssessment.info.field.NrmOthers', 'Others'), 'NrmOthers']],
        },
        {
          heading: t('msme.siteAssessment.info.heading.2Conservation', '2. Conservation'), centred: true,
          fields: [
            [t('msme.siteAssessment.info.field.WaterRecycling', 'Water recycling (Litres)'), 'WaterRecycling'],
            [t('msme.siteAssessment.info.field.Waterreuse', 'Water reuse (Litres)'), 'Waterreuse'],
            [t('msme.siteAssessment.info.field.RainWaterHarvest', 'Rain water harvesting (Litres)'), 'RainWaterHarvest'],
            [t('msme.siteAssessment.info.field.NumofTreesPlanted', 'No. of Tree planted'), 'NumofTreesPlanted'],
            [measures(), 'NrmMeasuresTaken'],
          ],
        },
      ],
    },
    {
      title: t('msme.siteAssessment.info.section9.title', 'Financial Performance (Previous Financial Year)'),
      groups: [{ fields: [[t('msme.siteAssessment.info.field.TurnOver', 'Turnover'), 'TurnOver'], [t('msme.siteAssessment.info.field.GrossProfit', 'Gross Profit'), 'GrossProfit']] }],
    },
  ];
}

/**
 * Read-only report of the MSME's site (onsite/remote) assessment for Silver/Gold, or of a
 * handholding milestone. Port of Views/Msme/SiteAssessmentInfo.cshtml (MSME view). The assessor and
 * agency controls of the old page (validate, edit remarks, final submit, photo capture) are not part
 * of it; Bootstrap tabs and the image modal are signal-controlled markup.
 */
@Component({
  selector: 'zed-msme-site-assessment',
  imports: [RouterLink, NgTemplateOutlet, PageHead, UnitFacts, RequirementVideo, TextPipe],
  templateUrl: './site-assessment.html',
  styleUrls: ['../shared/msme-page.scss', './site-assessment.scss'],
  host: { '(document:keydown.escape)': 'closePreview()' },
})
export class SiteAssessmentPage {
  /** Route parameter :certification. */
  readonly certification = input.required<string>();

  private readonly api = inject(SiteAssessmentApi);
  private request = 0;

  protected readonly data = signal<SiteAssessmentData | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly tab = signal<SiteTab>('basic');
  /** Address of the image shown in the "Image" pop-up. */
  protected readonly preview = signal<string | null>(null);

  protected readonly milestoneInfo = computed(() => milestoneInfo());

  protected readonly type = computed(() => canonicalSiteAssessment(this.certification()));
  protected readonly msme = computed<Row>(() => this.data()?.msme ?? {});
  protected readonly basic = computed<Row>(() => this.data()?.basicInfo ?? {});
  protected readonly assessment = computed<Row>(() => this.data()?.assessment ?? {});
  protected readonly isMilestone = computed(() => this.data()?.kind === 'milestone');
  /** 2026-11-14: "Gold", "Gold surveillance" or "Silver milestone 2", for the header and the facts strip. */
  protected readonly levelTitle = computed(() => {
    const c = this.type() ?? this.certification() ?? '';
    const m = /^(.*?)(Surveillance|Milestone(\d))$/i.exec(c);
    if (!m) return levelName(c);
    return m[3] ? t('msme.siteAssessment.milestoneLevel', '{level} milestone {milestone}', { level: levelName(m[1]), milestone: m[3] })
      : t('msme.siteAssessment.surveillanceLevel', '{level} surveillance', { level: levelName(m[1]) });
  });
  protected readonly crumbs = computed<Crumb[]>(() => this.isMilestone()
    ? [{ label: t('msme.siteAssessment.crumb.home', 'Home'), link: '/msme/dashboard' },
      { label: t('msme.siteAssessment.crumb.handholding', 'Handholding support'), link: '/msme/handholding' }, { label: this.levelTitle() }]
    : [{ label: t('msme.siteAssessment.crumb.home', 'Home'), link: '/msme/dashboard' },
      { label: t('msme.siteAssessment.crumb.certification', '{level} certification', { level: this.levelTitle() }), link: ['/msme/certification', this.certification()] },
      { label: t('msme.siteAssessment.crumb.page', 'Site assessment') }]);
  /**
   * Parameters tab: the parameter list and the selected parameter. Handholding milestones show the basic diagnostic
   * conformance as status; the Silver / Gold report has no conformance for the unit, so it lists the parameters only.
   */
  protected readonly pn = new ParameterNav<SiteSection, SiteRequirement>({
    sections: () => this.data()?.sections ?? [],
    id: (s) => s.sectionCode ?? '',
    requirements: (s) => s.requirements,
    conformance: (r) => r.milestone?.['SaConformance'],
    exempted: (s) => this.exempted(s),
  });

  constructor() {
    effect(() => {
      const type = this.type();
      untracked(() => void this.load(type));
    });
  }

  protected select(tab: SiteTab): void {
    this.tab.set(tab);
  }

  protected openPreview(src: string | null): void {
    if (src) this.preview.set(src);
  }

  protected closePreview(): void {
    this.preview.set(null);
  }

  protected refresh(): void {
    void this.load(this.type());
  }

  // ----- template helpers -----

  /** Text of a column ('' when empty). */
  protected text(row: Row | null | undefined, column: string): string {
    const v = row?.[column];
    return v === null || v === undefined ? '' : String(v);
  }

  protected exempted(s: SiteSection): boolean {
    return s.isAssessmentExcempted === 'Yes';
  }

  protected photosOf(r: SiteRequirement, ncCount: number): SitePhoto[] {
    return r.photos.filter((p) => p.ncCount === ncCount);
  }

  private async load(type: string | null): Promise<void> {
    const request = ++this.request;
    this.error.set('');
    this.preview.set(null);
    if (!type) {
      this.data.set(null);
      this.error.set(t('msme.siteAssessment.error.invalidLevel', 'Invalid certification.'));
      return;
    }
    this.loading.set(true);
    try {
      const data = await firstValueFrom(this.api.get(type));
      if (request !== this.request) return;
      this.data.set(data);
      this.tab.set('basic');
    } catch (err) {
      if (request !== this.request) return;
      this.data.set(null);
      this.error.set(apiErrorMessage(err));
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }
}
