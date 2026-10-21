import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { Row, SiteAssessmentApi, SiteAssessmentData, SitePhoto, SiteRequirement, SiteSection, canonicalSiteAssessment } from './site-assessment.api';

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

const MEASURES = 'Measures Taken (New technologies, new machines, new processes etc.)';
const energy = (heading: string, prefix: string): InfoGroup => ({
  heading,
  fields: [['Unit', `${prefix}Unit`], ['% of total consumption', `${prefix}TotConsumpPer`]],
});

/** The milestone "Basic Information" tab, in the order and wording of the old page. */
export const MILESTONE_INFO: readonly InfoSection[] = [
  {
    title: 'Occupational (Workplace) Safety',
    groups: [{
      fields: [
        ['No. of accidents (incl. fatalities & disabilities caused, if any)', 'NumOfAccedents'],
        ['No. of near misses', 'NumOfNearMisses'],
        ['Man hours lost', 'ManHoursLast'],
        ['Lost Time Injury Frequency Rate (LTIFR)', 'LosttimeInjuryfreqRate'],
      ],
    }],
  },
  {
    title: 'Measurement of Timely Delivery',
    groups: [{
      fields: [
        ['Number of Deliveries', 'NumOfDeliveries'],
        ['Number of Deliveries made On Time In Full (OTIF) per month', 'NumOfDeliveriesOntimeFull'],
      ],
    }],
  },
  {
    title: 'Planned Maintenance & Calibration',
    groups: [{
      fields: [
        ['Mean Time To Repair (MTTR)', 'MeanTimeToRepair'],
        ['Mean Time Between Failure (MTBF)', 'MeanTimeBetweenFailure'],
      ],
    }],
  },
  {
    title: 'Energy Management',
    groups: [
      energy('Electrical', 'Electri'),
      energy('Solar', 'Solar'),
      energy('Wind', 'Wind'),
      energy('Fossil Fuel', 'Fossil'),
      energy('Gas', 'Gas'),
      energy('Others', 'Others'),
      { fields: [['Total Cost', 'TotalCost'], [MEASURES, 'EnergyMgmtMeasuresTaken']] },
    ],
  },
  {
    title: 'Environment Management',
    groups: [
      {
        heading: 'Emissions', centred: true,
        fields: [
          ['COx (please mention unit)', 'Cox'],
          ['NOx (please mention unit)', 'Nox'],
          ['SOx (please mention unit)', 'Sox'],
          ['Suspended Particulate Material (SPM)', 'SuspPertiMaterial'],
        ],
      },
      {
        heading: 'Effluents', centred: true,
        fields: [['Total Suspended Solid (TSS)', 'TotSuspenSolid'], ['Biochemical Oxygen Demand (BOD)', 'BioChemOxyDemand']],
      },
      {
        heading: 'Solid Waste & Hazardous Waste', centred: true,
        fields: [
          ['Solid Waste (Kg/Month)', 'SolidWaste'],
          ['Plastic Waste (Kg/Month)', 'PlasticWaste'],
          ['e-Waste (Kg/Month)', 'Ewaste'],
          ['Hazardous Waste (Kg/Month)', 'hazardWaste'],
        ],
      },
      { heading: 'Noise Level', centred: true, fields: [['Noise Level (dB)', 'NoiseLevel'], [MEASURES, 'EnviMgmtMeasuresTaken']] },
    ],
  },
  {
    title: 'Human Resource Management',
    groups: [{
      fields: [
        ['% of employees engaged in improvement activities', 'EmpEngagedInActivities'],
        ['No. of suggestions received', 'NumOfSuggestions'],
        ['Measures Taken to develop human resources', 'HrmMeasuresTaken'],
      ],
    }],
  },
  {
    title: 'Measurement & Analysis',
    groups: [{
      fields: [
        ['Defects (%)', 'Defects'],
        ['Rework (%)', 'ReWork'],
        ['Customer Rejections (%)', 'CustRejections'],
        ['Number of Customer Complaints', 'NumOfCustComplaints'],
        ['Customer Complaints resolved (%)', 'NumOfComplaintsResolved'],
        ['Customer Satisfaction level (%)', 'CustSatisLevel'],
        ['Cost of Poor Quality (COPQ)', 'CostOfPoorQuality'],
      ],
    }],
  },
  {
    title: 'Natural Resources Management',
    groups: [
      {
        heading: '1. Consumption of natural resources', centred: true,
        fields: [['Water (Litres)', 'Water'], ['Minerals (Coal) (Kg)', 'Minarals'], ['Wood (Kg)', 'Wood'], ['Others', 'NrmOthers']],
      },
      {
        heading: '2. Conservation', centred: true,
        fields: [
          ['Water recycling (Litres)', 'WaterRecycling'],
          ['Water reuse (Litres)', 'Waterreuse'],
          ['Rain water harvesting (Litres)', 'RainWaterHarvest'],
          ['No. of Tree planted', 'NumofTreesPlanted'],
          [MEASURES, 'NrmMeasuresTaken'],
        ],
      },
    ],
  },
  {
    title: 'Financial Performance (Previous Financial Year)',
    groups: [{ fields: [['Turnover', 'TurnOver'], ['Gross Profit', 'GrossProfit']] }],
  },
];

/**
 * Read-only report of the MSME's site (onsite/remote) assessment for Silver/Gold, or of a
 * handholding milestone. Port of Views/Msme/SiteAssessmentInfo.cshtml (MSME view). The assessor and
 * agency controls of the old page (validate, edit remarks, final submit, photo capture) are not part
 * of it; Bootstrap tabs and the image modal are signal-controlled markup.
 */
@Component({
  selector: 'zed-msme-site-assessment',
  imports: [RouterLink, NgTemplateOutlet],
  templateUrl: './site-assessment.html',
  styleUrl: './site-assessment.scss',
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

  protected readonly milestoneInfo = MILESTONE_INFO;
  protected readonly pledgeCertificateUrl = '/api/msme/files/pledge-certificate';

  protected readonly type = computed(() => canonicalSiteAssessment(this.certification()));
  protected readonly msme = computed<Row>(() => this.data()?.msme ?? {});
  protected readonly basic = computed<Row>(() => this.data()?.basicInfo ?? {});
  protected readonly assessment = computed<Row>(() => this.data()?.assessment ?? {});
  protected readonly isMilestone = computed(() => this.data()?.kind === 'milestone');

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
      this.error.set('Invalid certification.');
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
