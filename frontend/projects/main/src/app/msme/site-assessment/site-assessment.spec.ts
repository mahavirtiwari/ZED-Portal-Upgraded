import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SiteAssessmentPage } from './site-assessment';
import { SiteAssessmentData, SitePhoto, SiteRequirement, canonicalSiteAssessment } from './site-assessment.api';

const PHOTOS = '/api/msme/site-assessment/photos/';

function photo(name: string, file: string, extra: Partial<SitePhoto> = {}): SitePhoto {
  return { name, src: `${PHOTOS}mobileapi/SaPhotos/ZEDMSME000001/Silver/${file}`, createdDate: null, ncCount: 0, ...extra };
}

function requirement(code: string, extra: Partial<SiteRequirement> = {}): SiteRequirement {
  return { requirementCode: code, milestone: {}, options: [], evidences: [], photos: [], surveillancePhotos: [], bullets: null, ...extra };
}

function assessment(overrides: Partial<SiteAssessmentData> = {}): SiteAssessmentData {
  return {
    certification: 'Silver',
    kind: 'assessment',
    msme: { ZedId: 'ZEDMSME000001', EnterpriseName: 'Acme Castings', EnterpriseType: 'Small', RegistrationType: 'UDYAM', PUnitName: 'Unit 1', PledgeOn: 'May 1, 2024' },
    basicInfo: { UdyogAadharNo: 'UDYAM-UP-29-0003915' },
    assessment: {
      AuditsConducted: 'Yes', DomesticCustomers: 'Tata', SaDomesticCustomers: 'Tata, Mahindra', RawMaterialImported: 'Yes',
      SaRawMaterialImported: 'No', EnergySources: 'Electricity', SaEnergySources: 'Solar', AssessorRemarks: 'Well maintained unit',
    },
    products: [{
      productName: 'Castings', exported: 'No',
      productPhoto: `${PHOTOS}mobileapi/Photos/ZEDMSME000001/Silver/BasicInfo/p1.jpg`,
      productDescriptionPhoto: `${PHOTOS}mobileapi/Photos/ZEDMSME000001/Silver/BasicInfo/d1.pdf`,
      productDescriptionKind: 'pdf', productDescriptionOpened: false,
      photos: [photo('Product on site', 'BasicInfo/41.jpg')],
    }],
    rawMaterials: [{ RawMaterialName: 'Steel', Percentage: '20', CountryName: 'Japan' }],
    siteTourPhotos: [photo('Shop floor', 'SiteTour/9.jpg'), { name: 'Unavailable', src: null, createdDate: null, ncCount: 0 }],
    surveillancePhotos: [],
    sections: [
      {
        sectionCode: '1', sectionName: 'Leadership', iButton: 'About leadership', isAssessmentExcempted: null, ncCount: 0,
        requirements: [requirement('1', {
          options: [{ optionName: 'Vision displayed', subOptions: ['In local language'] }],
          evidences: [{ evidenceName: 'Vision statement', url: `${PHOTOS}mobileapi/Photos/ZEDMSME000001/Silver/Evidences/E55.pdf` }],
          photos: [photo('Vision board', 'SiteTour/31.jpg')],
        })],
      },
      {
        sectionCode: '2', sectionName: 'Swachh Workplace', iButton: 'About 5S', isAssessmentExcempted: 'Yes', ncCount: 0,
        requirements: [requirement('1', { photos: [photo('Hidden photo', 'SiteTour/40.jpg')] })],
      },
    ],
    siteExteriorPhotos: [],
    consultancyBasicInfo: [],
    ...overrides,
  };
}

function milestone(): SiteAssessmentData {
  return assessment({
    certification: 'SilverMilestone2',
    kind: 'milestone',
    assessment: { AssessorRemarks: null },
    products: [],
    rawMaterials: [],
    siteTourPhotos: [photo('Consultant tour', 'SiteTour/7.jpg')],
    siteExteriorPhotos: [{ ncCount: 1, photos: [photo('Site Exterior Photo', 'Site Exterior Photo_1.jpg', { createdDate: 'May 01, 2024 02:30 PM', ncCount: 1 })] }],
    consultancyBasicInfo: [{ NcCount: 1, NumOfAccedents: '0', TurnOver: '10 Cr' }, { NcCount: 2, NumOfAccedents: '1', TurnOver: '12 Cr' }],
    sections: [{
      sectionCode: '1', sectionName: 'Leadership', iButton: 'i', isAssessmentExcempted: 'No', ncCount: 2,
      requirements: [requirement('1', {
        milestone: {
          SaConformance: 'Partially', BaselineRemarks: 'Baseline ok', EstimatedTimeInDays: '30', HActionPlanRemarks: 'Plan ok',
          Intervention: 'Needs ERP', InterventionRemarks: 'Tech ok', IsProposedActivityCompleted: 'Yes', ProgressReviewRemarks: 'Done',
        },
        bullets: { baselineDiagnostic: ['Gap one'], handholdingActionPlan: ['Plan one'], technologyIntervention: ['ERP'] },
        photos: [
          photo('Baseline', 'BaselineDiagnosticStudy/8.jpg', { ncCount: 1, createdDate: 'May 02, 2024 10:00 AM' }),
          photo('Review', 'ProgressReview/9.jpg', { ncCount: 2 }),
        ],
      })],
    }],
  });
}

describe('SiteAssessmentPage', () => {
  let fixture: ComponentFixture<SiteAssessmentPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function open(route: string, data: SiteAssessmentData, expectedUrl: string) {
    fixture.componentRef.setInput('certification', route);
    await settle();
    http.expectOne(expectedUrl).flush(data);
    await settle();
  }

  /** Visible text with a space between elements (textContent runs cells together). */
  const text = () => {
    const parts: string[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) parts.push(walker.currentNode.textContent!);
    return parts.join(' ').replace(/\s+/g, ' ');
  };
  const buttons = (label: string) => Array.from(el.querySelectorAll<HTMLElement>('button, a, input[type=button]')).filter((b) => (b.textContent!.trim() || (b as HTMLInputElement).value) === label);
  async function tab(label: string) {
    Array.from(el.querySelectorAll<HTMLButtonElement>('.nav-link')).find((b) => b.textContent!.trim() === label)!.click();
    await settle();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SiteAssessmentPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(SiteAssessmentPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
  });

  afterEach(() => http.verify());

  it('knows the certification types the page opens with', () => {
    expect(canonicalSiteAssessment('goldmilestone3')).toBe('GoldMilestone3');
    expect(canonicalSiteAssessment('SILVERSURVEILLANCE')).toBe('SilverSurveillance');
    expect(canonicalSiteAssessment('Bronze')).toBeNull();
    expect(canonicalSiteAssessment('../Silver')).toBeNull();
  });

  it('loads the canonical spelling and shows the unit summary and Basic Info tab', async () => {
    await open('silver', assessment(), '/api/msme/site-assessment/Silver');

    expect(text()).toContain('Acme Castings');
    expect(text()).toContain('UDYAM-UP-29-0003915');
    expect(el.querySelector('.entp-label.small')).toBeTruthy();
    expect(text()).toContain('Site Assessment Information');
    expect(el.querySelector('.step-num')!.textContent!.trim()).toBe('3');
    expect(Array.from(el.querySelectorAll('.nav-link')).map((b) => b.textContent!.trim())).toEqual(['Basic Info', 'Site Tour', 'Parameters']);

    expect(text()).toContain('Whether 3rd Party Financial Audits are conducted? Yes');
    expect(text()).toContain('1. Castings Exported: No');
    expect(text()).toContain('Key Domestic Customers DA Tata Site Assessment Tata, Mahindra');
    expect(text()).toContain('Energy Source(s) Used DA Electricity Site Assessment Solar');
    expect(text()).toContain('Steel 20 Japan');

    const description = buttons('VIEW').find((b) => b.tagName === 'A')!;
    expect(description.getAttribute('href')).toBe(`${PHOTOS}mobileapi/Photos/ZEDMSME000001/Silver/BasicInfo/d1.pdf`);
    expect(description.getAttribute('target')).toBe('_blank');
  });

  it('hides the raw material list unless raw material is imported', async () => {
    await open('Gold', assessment({ certification: 'Gold', assessment: { RawMaterialImported: 'No' } }), '/api/msme/site-assessment/Gold');
    expect(text()).not.toContain('Raw Material Name');
  });

  it('shows site tour photos and the surveillance block only when there are surveillance photos', async () => {
    await open('Silver', assessment(), '/api/msme/site-assessment/Silver');
    await tab('Site Tour');

    expect(text()).toContain('SITE TOUR PHOTOS');
    expect(text()).not.toContain('SURVEILLANCE SITE TOUR PHOTOS');
    expect(el.querySelector<HTMLImageElement>('.evidence-img img')!.getAttribute('src')).toBe(`${PHOTOS}mobileapi/SaPhotos/ZEDMSME000001/Silver/SiteTour/9.jpg`);
    expect(el.querySelectorAll('.evidence-img img').length).toBe(1);
    expect(text()).toContain('Unavailable');

    fixture.componentRef.setInput('certification', 'SilverSurveillance');
    await settle();
    http.expectOne('/api/msme/site-assessment/SilverSurveillance').flush(assessment({ surveillancePhotos: [photo('Surveillance tour', 'SiteTour/5.jpg')] }));
    await settle();
    await tab('Site Tour');
    expect(text()).toContain('SURVEILLANCE SITE TOUR PHOTOS');
    expect(text()).toContain('Surveillance tour');
  });

  it('lists parameters with DA evidence links and SA evidence previews', async () => {
    await open('Silver', assessment(), '/api/msme/site-assessment/Silver');
    await tab('Parameters');

    expect(text()).toContain('1. Leadership');
    expect(el.querySelector('.tooltiptext')!.textContent).toBe('About leadership');
    expect(el.querySelector('.label-top')!.textContent).toBe('1.1');
    expect(text()).toContain('Vision displayed In local language');
    expect(text()).toContain('Exempted from assessment: Yes');
    expect(text()).toContain('Well maintained unit');

    const evidence = Array.from(el.querySelectorAll<HTMLAnchorElement>('.label-highlight-assesor a'));
    expect(evidence.map((a) => a.getAttribute('href'))).toEqual([`${PHOTOS}mobileapi/Photos/ZEDMSME000001/Silver/Evidences/E55.pdf`]);
    expect(text()).toContain('Vision board');
    // The exempted section shows no SA evidences.
    expect(text()).not.toContain('Hidden photo');

    el.querySelector<HTMLButtonElement>('.label-highlight-msme button')!.click();
    await settle();
    expect(el.querySelector<HTMLImageElement>('.modal .sa-preview img')!.getAttribute('src')).toBe(`${PHOTOS}mobileapi/SaPhotos/ZEDMSME000001/Silver/SiteTour/31.jpg`);
    el.querySelector<HTMLInputElement>('.modal-footer input')!.click();
    await settle();
    expect(el.querySelector('.modal')).toBeNull();

    el.querySelector<HTMLButtonElement>('.label-highlight-msme button')!.click();
    await settle();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle();
    expect(el.querySelector('.modal')).toBeNull();
  });

  it('has no assessor or agency controls and only links photos through the API', async () => {
    await open('Silver', assessment(), '/api/msme/site-assessment/Silver');
    for (const t of ['Basic Info', 'Site Tour', 'Parameters']) {
      await tab(t);
      for (const label of ['Validate', 'Edit Remarks', 'Final Submit', 'EDIT', 'UPDATE']) expect(buttons(label)).toEqual([]);
      expect(el.querySelectorAll('textarea, input:not([readonly]):not([disabled]):not([type=button])').length).toBe(0);
      for (const img of Array.from(el.querySelectorAll('img'))) {
        expect(img.getAttribute('src')!).toMatch(/^(\/api\/msme\/site-assessment\/photos\/|\/Images\/)/);
      }
    }
  });

  it('shows the handholding milestone pages', async () => {
    await open('SilverMilestone2', milestone(), '/api/msme/site-assessment/SilverMilestone2');

    expect(text()).toContain('HANDHOLDING SUPPORT');
    expect(el.querySelector('.step-num')).toBeNull();
    expect(Array.from(el.querySelectorAll('.nav-link')).map((b) => b.textContent!.trim())).toEqual(['Basic Information', 'Site Tour', 'Parameters']);

    expect(text()).toContain('Site Exterior Photos');
    expect(el.querySelector('td.milestone-1')!.textContent!.trim()).toBe('Milestone 1');
    expect(text()).toContain('Captured at May 01, 2024 02:30 PM');
    expect(text()).toContain('Occupational (Workplace) Safety');
    expect(text()).toContain('Financial Performance (Previous Financial Year)');
    const turnover = Array.from(el.querySelectorAll<HTMLInputElement>('input[aria-label="Turnover"]'));
    expect(turnover.map((i) => i.value)).toEqual(['10 Cr', '12 Cr']);
    expect(turnover.every((i) => i.readOnly)).toBe(true);

    await tab('Site Tour');
    expect(text()).toContain('SITE TOUR PICTURES');
    expect(text()).toContain('Consultant tour');

    await tab('Parameters');
    expect(text()).toContain('Milestone 1 : Basic Diagnostic Study');
    expect(text()).toContain('Conformance Partially');
    expect(text()).toContain('GAPS IDENTIFIED Gap one');
    expect(text()).toContain('PLANNED ACTIVIES Plan one');
    expect(text()).toContain('ESTIMATED TIME (IN DAYS) 30');
    expect(text()).toContain('SUGGESTED TENCHNOLOGY INTERVENTION ERP');
    expect(text()).toContain('RATIONALE FOR TENCHNOLOGY INTERVENTION Needs ERP');
    expect(text()).toContain('Generated at May 02, 2024 10:00 AM');
    expect(text()).toContain('Milestone 2 : Progress Review 1');
    expect(text()).toContain('Is Proposed Activity Completed Yes');
    expect(text()).toContain('Done');
    expect(text()).not.toContain('Milestone 3 : Progress Review 2');
  });

  it('rejects an unknown certification without calling the API', async () => {
    fixture.componentRef.setInput('certification', 'Bronze');
    await settle();
    expect(text()).toContain('Invalid certification.');
    http.expectNone((r) => r.url.startsWith('/api/msme/site-assessment'));
  });

  it('shows the API message when there is no assessment yet', async () => {
    fixture.componentRef.setInput('certification', 'Gold');
    await settle();
    http.expectOne('/api/msme/site-assessment/Gold').flush(
      { title: 'No site assessment details are available for this certification yet.', status: 404 },
      { status: 404, statusText: 'Not Found' },
    );
    await settle();
    expect(text()).toContain('No site assessment details are available for this certification yet.');
    expect(el.querySelector('.nav-tabs')).toBeNull();
  });
});
