import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CertificationData } from '../certification/certification.api';
import { AssessmentReport, NonConformanceReport, NonConformanceRound } from './assessment.api';
import { BasicInfoPage, NonConformancesPage } from './assessment-report';

const F = (cert: string, source: string, path: string) => `/api/msme/assessment/${cert}/files/${source}/mobileapi/${path}`;

function unit(certification: string): CertificationData {
  return {
    certification,
    msme: { ZedId: 'ZEDMSME000001', EnterpriseName: 'Acme Castings', EnterpriseType: 'Small', RegistrationType: 'UDYAM', PUnitName: 'Unit 1', PledgeOn: 'May 1, 2024' },
    basicInfo: { UdyogAadharNo: 'UDYAM-UP-29-0003915' },
    certStatus: {},
    status: {},
  };
}

function assessment(cert = 'Bronze'): AssessmentReport {
  return {
    certification: cert,
    assessment: { Certification: cert, NcCount: 2, AuditsConducted: 'Yes', DomesticCustomers: 'Tata Motors', RawMaterialImported: 'Yes', EnergySources: 'Solar, Grid', ManufacturingCapacityValue: 100, ManufacturingCapacityUnits: 'Tons' },
    products: [{ Id: 11, ProductName: 'Valve', Exported: 'No', PhotoUrl: F(cert, 'da', 'Photos/Z/B/BasicInfo/p1.jpg'), DescriptionType: 'pdf', DescriptionUrl: F(cert, 'da', 'Photos/Z/B/BasicInfo/d1.pdf') }],
    rawMaterials: [{ RawMaterialName: 'Steel', Percentage: 20, CountryName: 'Japan' }],
    sections: [{ SectionCode: '1', SectionName: 'Leadership', iButton: 'About leadership' }],
    requirements: [{ SectionCode: '1', RequirementCode: '1' }, { SectionCode: '1', RequirementCode: 2 }],
    options: [{ SectionCode: '1', RequirementCode: '1', OptionCode: '1', OptionName: 'Has a quality policy' }],
    subOptions: [{ SectionCode: '1', RequirementCode: '1', OptionCode: '1', SubOptionName: 'Written and displayed' }],
    evidences: [
      { SectionCode: '1', RequirementCode: '1', EvidenceName: 'Policy document', GeneratedTime: 'May 2, 2024', FileUrl: F(cert, 'da', 'Photos/Z/B/Evidences/E1.pdf') },
      { SectionCode: '1', RequirementCode: '1', EvidenceName: 'Training record', GeneratedTime: null, FileUrl: F(cert, 'da', 'Photos/Z/B/Evidences/E2.pdf') },
    ],
    photos: [
      { PhotoType: 'Selfie', TimeStamp: 'T1', CreatedDate: 'C1', UpdatedDate: 'U1', AssessorRemarks: 'Clear photo', FileUrl: F(cert, 'da', 'Photos/Z/B/Selfie/S1.jpg') },
      { PhotoType: 'SiteExteriorPhotos', TimeStamp: 'T2', CreatedDate: 'C2', UpdatedDate: 'U2', AssessorRemarks: 'Name board missing', FileUrl: F(cert, 'da', 'Photos/Z/B/SiteExteriorPhotos/X1.jpg') },
      { PhotoType: 'ProductPhotos', ProductId: 11, PhotoExtension: 'png', TimeStamp: 'T3', CreatedDate: 'C3', FileUrl: F(cert, 'da', 'Photos/Z/B/BasicInfo/P9.png') },
    ],
    esgCheckList: [
      { Code: '1', Question: 'Do you treat effluents?', Answer: 'Yes', IfYesQuestion: 'How?', IfYesAnswer: 'ETP', CheckListType: 'ESG' },
      { Code: 'S1', Question: 'Is PPE provided?', Answer: 'No', IfNoQuestion: 'Why?', IfNoAnswer: 'Planned', CheckListType: 'SOCIAL/OHS' },
    ],
  };
}

function round(n: number, cert = 'Bronze', source = `nc${n}`): NonConformanceRound {
  return {
    number: n,
    products: [{ Id: 20 + n, ProductName: 'Valve', ProductParentId: 11, PreviousAssessorRemarks: `Label unclear (NC${n})`, MsmeRemarks: 'New label', MsmeUpdatedDate: 'M' }],
    sections: [{ SectionCode: '1', SectionName: 'Leadership', iButton: '' }],
    requirements: [
      { SectionCode: '1', RequirementCode: '1', PreviousAssessorRemarks: `Policy not signed (NC${n})`, PreviousAssessorUpdatedDate: 'P', MsmeComments: 'Signed now', MsmeUpdatedDate: n === 1 ? 'June 1' : null },
    ],
    options: [{ SectionCode: '1', RequirementCode: '1', OptionCode: '1', OptionName: 'Has a quality policy' }],
    subOptions: [],
    evidences: [{ SectionCode: '1', RequirementCode: '1', EvidenceName: 'Policy v2', GeneratedTime: `G${n}`, FileUrl: F(cert, source, `Photos/Z/B/Evidences/N${n}.pdf`) }],
    photos: n === 1 ? [{ PhotoType: 'SiteExteriorPhotos', TimeStamp: 'T', CreatedDate: 'Reply date', MsmeRemarks: 'Board installed', FileUrl: F(cert, source, 'Photos/Z/B/SiteExteriorPhotos/R1.jpg') }] : [],
    productPhotos: cert === 'Bronze' ? [] : [{ ProductId: 20 + n, ProductParentId: 11, IsPdf: false, FileUrl: F(cert, source, `SaPhotos/Z/S/BasicInfo/R${n}.jpg`) }],
  };
}

describe('Assessment pages (MSME, read-only)', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BasicInfoPage, NonConformancesPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function settle(fixture: ComponentFixture<unknown>) {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function open<T>(page: Type<T>, route: string, api: string, body: object, cert: string) {
    const fixture = TestBed.createComponent(page);
    fixture.componentRef.setInput('certification', route);
    await settle(fixture);
    const req = http.expectOne(api);
    expect(req.request.method).toBe('GET');
    req.flush(body);
    http.expectOne(`/api/msme/certifications/${cert}`).flush(unit(cert));
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    return { fixture, el, text: () => el.textContent!.replace(/\s+/g, ' ') };
  }

  const tab = (el: HTMLElement, label: string) =>
    Array.from(el.querySelectorAll<HTMLButtonElement>('.nav-tabs .nav-link')).find((b) => b.textContent!.trim() === label)!;

  /** No assessor/agency control of the old pages: nothing to fill in or submit. */
  function expectReadOnly(el: HTMLElement) {
    expect(el.querySelectorAll('form, input, textarea, select').length).toBe(0);
    const buttons = Array.from(el.querySelectorAll('button, a')).map((b) => b.textContent!.trim().toUpperCase());
    for (const label of ['VALIDATE', 'EDIT REMARKS', 'FINAL SUBMIT', 'SUBMIT', 'YES', 'NO', 'EXEMPT']) expect(buttons).not.toContain(label);
  }

  it('basic information: unit answers, photos and products through the files API', async () => {
    const { fixture, el, text } = await open(BasicInfoPage, 'bronze', '/api/msme/assessment/Bronze/basic-info', assessment(), 'Bronze');

    expect(text()).toContain('Acme Castings');
    expect(text()).toContain('UDYAM-UP-29-0003915');
    // 2026-11-14: the key facts strip (no pledge row) in place of the unit side bar.
    expect(el.querySelector('zed-unit-facts')).toBeTruthy();
    expect(text()).toContain('Basic Information & Documents Upload');
    expect(text()).toContain('Tata Motors');
    expect(text()).toContain('100 Tons');
    expect(el.querySelector('a[href="/msme/certification/bronze"]')).toBeTruthy();

    const images = Array.from(el.querySelectorAll('img')).map((i) => i.getAttribute('src'));
    expect(images).toContain(F('Bronze', 'da', 'Photos/Z/B/Selfie/S1.jpg'));
    expect(images).toContain(F('Bronze', 'da', 'Photos/Z/B/SiteExteriorPhotos/X1.jpg'));
    expect(images).toContain(F('Bronze', 'da', 'Photos/Z/B/BasicInfo/p1.jpg'));
    // Only the app's icons and the authorised files API, never the mobile app's public folders.
    expect(images.every((s) => s!.startsWith('/Images/') || s!.startsWith('/api/msme/assessment/'))).toBe(true);
    // Raw materials are listed because RawMaterialImported is Yes.
    expect(text()).toContain('Steel');

    // Product dialog: label PDF opens in a new tab, the photo in the preview.
    Array.from(el.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent!.trim() === 'VIEW')[2].click();
    await settle(fixture);
    const dialog = el.querySelector('.modal')!;
    expect(dialog.textContent).toContain('Valve');
    expect(dialog.querySelector('a')!.getAttribute('href')).toBe(F('Bronze', 'da', 'Photos/Z/B/BasicInfo/d1.pdf'));
    (dialog.querySelector('button.btn-primary') as HTMLButtonElement).click();
    await settle(fixture);
    expect(el.querySelector('.preview-modal .modal-body img')!.getAttribute('src')).toBe(F('Bronze', 'da', 'Photos/Z/B/BasicInfo/p1.jpg'));
    expectReadOnly(el);
  });

  it('parameters: the list of parameters and the selected one as requirement cards', async () => {
    const data = assessment();
    data.sections = [...data.sections, { SectionCode: '2', SectionName: 'Swachh Workplace', iButton: '' }];
    data.requirements = [...data.requirements, { SectionCode: '2', RequirementCode: '1' }];
    data.options = [...data.options, { SectionCode: '2', RequirementCode: '1', OptionCode: '1', OptionName: 'Work area is clean' }];
    const { fixture, el, text } = await open(BasicInfoPage, 'Bronze', '/api/msme/assessment/Bronze/basic-info', data, 'Bronze');
    tab(el, 'Parameters / Document Uploaded').click();
    await settle(fixture);
    const items = Array.from(el.querySelectorAll<HTMLButtonElement>('.zp-nav-item'));
    expect(items.map((i) => i.querySelector('.zp-nav-meta')!.textContent!.trim())).toEqual(['2 requirements', '1 requirements']);
    // The unit's report has no conformance: no status chips.
    expect(el.querySelector('.zp-nav .zp-chip')).toBeNull();
    expect(items[0].classList).toContain('active');
    expect(text()).toContain('Has a quality policy');

    items[1].click();
    await settle(fixture);
    expect(el.querySelector('.zp-head h5')!.textContent).toContain('Swachh Workplace');
    expect(Array.from(el.querySelectorAll('.zp-req .zp-code')).map((c) => c.textContent!.trim())).toEqual(['2.1']);
    expect(text()).toContain('Work area is clean');
    expect(text()).not.toContain('Has a quality policy');
    expect(text()).toContain('No Documents necessary');
    expectReadOnly(el);
  });

  it('basic information: ESG checklist and parameters with their evidence documents', async () => {
    const { fixture, el, text } = await open(BasicInfoPage, 'Bronze', '/api/msme/assessment/Bronze/basic-info', assessment(), 'Bronze');

    tab(el, 'ESG Checklist').click();
    await settle(fixture);
    const tables = el.querySelectorAll('.tab-pane table');
    expect(tables[0].textContent).toContain('Do you treat effluents?');
    expect(tables[0].textContent).not.toContain('Is PPE provided?');
    expect(tables[1].textContent).toContain('S1');
    expect(tables[1].textContent).toContain('Planned');

    tab(el, 'Parameters / Document Uploaded').click();
    await settle(fixture);
    // The parameter list and the first parameter's requirement cards.
    expect(Array.from(el.querySelectorAll('.zp-nav-item .zp-nav-name')).map((n) => n.textContent!.trim())).toEqual(['Leadership']);
    expect(el.querySelector('.zp-nav-item .zp-nav-meta')!.textContent!.trim()).toBe('2 requirements');
    expect(el.querySelector('.zp-head h5')!.textContent).toContain('Leadership');
    expect(Array.from(el.querySelectorAll('.zp-req .zp-code')).map((c) => c.textContent!.trim())).toEqual(['1.1', '1.2']);
    expect(text()).toContain('Has a quality policy');
    expect(text()).toContain('Written and displayed');
    expect(text()).toContain('Generated at May 2, 2024');
    // Not generated yet, and a requirement without documents.
    expect(text()).toContain('No Documents uploaded');
    expect(text()).toContain('No Documents necessary');
    const view = Array.from(el.querySelectorAll<HTMLAnchorElement>('.zp-ev-table a'));
    expect(view.map((a) => a.getAttribute('href'))).toEqual([F('Bronze', 'da', 'Photos/Z/B/Evidences/E1.pdf')]);
    expect(view[0].target).toBe('_blank');

    // Opening a document no longer posts a "document opened" timestamp (Assessment/SaveTimestamp).
    view[0].addEventListener('click', (e) => e.preventDefault());
    view[0].click();
    expectReadOnly(el);
  });

  it('rejects certification types that have no assessment pages without calling the API', async () => {
    const fixture = TestBed.createComponent(BasicInfoPage);
    fixture.componentRef.setInput('certification', 'SilverMilestone1');
    await settle(fixture);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Invalid certification.');
  });

  it('shows the API message when no assessment exists yet', async () => {
    const fixture = TestBed.createComponent(NonConformancesPage);
    fixture.componentRef.setInput('certification', 'Gold');
    await settle(fixture);
    http.expectOne('/api/msme/assessment/Gold/non-conformances').flush(
      { title: 'No assessment details are available for this certification yet.' }, { status: 404, statusText: 'Not Found' });
    http.expectOne('/api/msme/certifications/Gold').flush(unit('Gold'));
    await settle(fixture);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No assessment details are available for this certification yet.');
  });

  it('Bronze non-conformances: one tab per raised NC, each compared with the previous step', async () => {
    const report: NonConformanceReport = {
      certification: 'Bronze', variant: 'da', ncCount: 2, assessment: assessment(), rounds: [round(1), round(2)], saEvidencePhotos: [],
    };
    const { fixture, el, text } = await open(NonConformancesPage, 'Bronze', '/api/msme/assessment/Bronze/non-conformances', report, 'Bronze');

    expect(Array.from(el.querySelectorAll('.nav-tabs .nav-link')).map((b) => b.textContent!.trim())).toEqual(['NC1', 'NC2']);
    expect(text()).toContain('Non-Conformance(s)');
    expect(el.querySelector('zed-unit-facts')).toBeTruthy();

    // NC1: site exterior photos of the desktop assessment and the MSME's reply.
    expect(text()).toContain('ASSESSOR RESPONSE');
    expect(text()).toContain('Clear photo'); // first photo row of the assessment, as before
    expect(text()).toContain('Board installed');
    const srcs = () => Array.from(el.querySelectorAll('img')).map((i) => i.getAttribute('src'));
    expect(srcs()).toContain(F('Bronze', 'da', 'Photos/Z/B/SiteExteriorPhotos/X1.jpg'));
    expect(srcs()).toContain(F('Bronze', 'nc1', 'Photos/Z/B/SiteExteriorPhotos/R1.jpg'));
    // Product: the desktop product photo (ProductId = ProductParentId) and the assessor's comment.
    expect(srcs()).toContain(F('Bronze', 'da', 'Photos/Z/B/BasicInfo/P9.png'));
    expect(text()).toContain('Label unclear (NC1)');
    // Requirement: the desktop evidences with their names, then the reply's documents.
    expect(text()).toContain('Policy document');
    expect(text()).toContain('Policy not signed (NC1)');
    expect(text()).toContain('Signed now');
    const links = () => Array.from(el.querySelectorAll<HTMLAnchorElement>('a.zp-doc')).map((a) => a.getAttribute('href'));
    expect(links()).toEqual([
      F('Bronze', 'da', 'Photos/Z/B/Evidences/E1.pdf'), F('Bronze', 'da', 'Photos/Z/B/Evidences/E2.pdf'), F('Bronze', 'nc1', 'Photos/Z/B/Evidences/N1.pdf'),
    ]);

    // The requirement's conversation: the assessor's NC with the documents it was raised on, then the unit's reply.
    const messages = () => Array.from(el.querySelectorAll<HTMLElement>('.zp-round .zp-chat .zp-msg'));
    expect(messages().map((m) => m.getAttribute('data-from'))).toEqual(['assessor', 'msme']);
    expect(messages()[0].textContent).toContain('Policy not signed (NC1)');
    expect(messages()[1].textContent).toContain('Signed now');
    expect(messages()[1].querySelector('.zp-msg-meta')!.textContent).toContain('June 1');

    tab(el, 'NC2').click();
    await settle(fixture);
    expect(text()).toContain('Policy not signed (NC2)');
    expect(text()).toContain('No response yet');
    // NC2 continues NC1's conversation; NC2 has not been answered, so its own documents are not listed.
    expect(messages().map((m) => m.getAttribute('data-from'))).toEqual(['assessor', 'msme', 'assessor']);
    expect(messages()[2].textContent).toContain('Policy not signed (NC2)');
    expect(links()).toEqual([
      F('Bronze', 'da', 'Photos/Z/B/Evidences/E1.pdf'), F('Bronze', 'da', 'Photos/Z/B/Evidences/E2.pdf'), F('Bronze', 'nc1', 'Photos/Z/B/Evidences/N1.pdf'),
    ]);
    expect(el.querySelector('.label-highlight-assesor')).toBeTruthy();
    expectReadOnly(el);
  });

  it('Silver non-conformances start NC1 from the site assessment evidence photos', async () => {
    const report: NonConformanceReport = {
      certification: 'Silver', variant: 'sa', ncCount: 2, assessment: assessment('Silver'), rounds: [round(1, 'Silver'), round(2, 'Silver')],
      saEvidencePhotos: [
        { Name: 'Signed policy photo', SectionCode: '1', RequirementCode: '1', GeneratedTime: null, IsPdf: false, FileUrl: F('Silver', 'sa', 'SaPhotos/Z/S/Evidences/SA1.jpg') },
      ],
    };
    const { fixture, el, text } = await open(NonConformancesPage, 'silver', '/api/msme/assessment/Silver/non-conformances', report, 'Silver');

    expect(el.querySelector('.zp-chat .zp-pics img[alt="Signed policy photo-"]')).not.toBeNull();
    expect(text()).not.toContain('Policy document');
    const srcs = () => Array.from(el.querySelectorAll('img')).map((i) => i.getAttribute('src'));
    expect(srcs()).toContain(F('Silver', 'sa', 'SaPhotos/Z/S/Evidences/SA1.jpg'));
    // Reply product photos come from the round's SaPhotos.
    expect(srcs()).toContain(F('Silver', 'nc1', 'SaPhotos/Z/S/BasicInfo/R1.jpg'));

    tab(el, 'NC2').click();
    await settle(fixture);
    // NC2: the previous round's reply photos (same parent product) and its evidences.
    expect(srcs()).toContain(F('Silver', 'nc1', 'SaPhotos/Z/S/BasicInfo/R1.jpg'));
    expect(srcs()).toContain(F('Silver', 'nc2', 'SaPhotos/Z/S/BasicInfo/R2.jpg'));
    expect(Array.from(el.querySelectorAll<HTMLAnchorElement>('a.zp-doc')).map((a) => a.getAttribute('href')))
      .toEqual([F('Silver', 'nc1', 'Photos/Z/B/Evidences/N1.pdf')]);
    expectReadOnly(el);
  });

  it('non-conformances: the round lists its parameters with the answered count and shows the selected one', async () => {
    const r1 = round(1);
    r1.sections = [...r1.sections, { SectionCode: '2', SectionName: 'Safety', iButton: '' }, { SectionCode: '3', SectionName: 'Quiet', iButton: '' }];
    r1.requirements = [...r1.requirements, { SectionCode: '2', RequirementCode: '4', PreviousAssessorRemarks: 'No extinguisher', MsmeComments: null, MsmeUpdatedDate: null }];
    const report: NonConformanceReport = { certification: 'Bronze', variant: 'da', ncCount: 1, assessment: assessment(), rounds: [r1], saEvidencePhotos: [] };
    const { fixture, el, text } = await open(NonConformancesPage, 'Bronze', '/api/msme/assessment/Bronze/non-conformances', report, 'Bronze');
    const items = Array.from(el.querySelectorAll<HTMLButtonElement>('.zp-round .zp-nav-item'));
    expect(items.map((i) => i.querySelector('.zp-nav-name')!.textContent!.trim())).toEqual(['Leadership', 'Safety']);
    expect(items.map((i) => i.querySelector('.zp-nav-meta')!.textContent!.trim())).toEqual(['1 of 1 answered', '0 of 1 answered']);
    expect(el.querySelector('.zp-round .zp-req .zp-req-status')!.textContent!.trim()).toBe('Answered');
    expect(el.querySelector('.zp-round .zp-nav-head')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('NC1 · 1 of 2 answered');
    expect(el.querySelector('.zp-round .zp-chat .zp-msg.from-msme')!.textContent).toContain('Signed now');
    items[1].click();
    await settle(fixture);
    expect(el.querySelector('.zp-round .zp-head h5')!.textContent).toContain('Safety');
    expect(Array.from(el.querySelectorAll('.zp-round .zp-req .zp-code')).map((c) => c.textContent!.trim())).toEqual(['2.4']);
    expect(text()).toContain('No extinguisher');
    expect(el.querySelector('.zp-round .zp-req .zp-req-status')!.textContent!.trim()).toBe('No response yet');
    expectReadOnly(el);
  });

  it('non-conformances: the conversation shows the assessor NC, then the unit reply with a picture and a PDF', async () => {
    const r1 = round(1);
    r1.evidences = [...r1.evidences, { SectionCode: '1', RequirementCode: '1', EvidenceName: 'Board photo', GeneratedTime: 'G1', FileUrl: F('Bronze', 'nc1', 'Photos/Z/B/Evidences/N1b.jpg') }];
    const report: NonConformanceReport = { certification: 'Bronze', variant: 'da', ncCount: 1, assessment: assessment(), rounds: [r1], saEvidencePhotos: [] };
    const { fixture, el } = await open(NonConformancesPage, 'Bronze', '/api/msme/assessment/Bronze/non-conformances', report, 'Bronze');
    const messages = Array.from(el.querySelectorAll<HTMLElement>('.zp-round .zp-chat .zp-msg'));
    expect(messages.map((m) => m.getAttribute('data-from'))).toEqual(['assessor', 'msme']);
    expect(messages[0].querySelector('.zp-msg-meta')!.textContent).toContain('NC1');
    expect(messages[0].textContent).toContain('Policy not signed (NC1)');
    expect(messages[0].querySelector('.zp-av')!.textContent!.trim()).toBe('AS');
    expect(messages[1].querySelector('.zp-av')!.textContent!.trim()).toBe('MS');
    expect(messages[1].querySelector('.zp-pics img')!.getAttribute('src')).toBe(F('Bronze', 'nc1', 'Photos/Z/B/Evidences/N1b.jpg'));
    expect(messages[1].querySelector<HTMLAnchorElement>('.zp-files a')!.getAttribute('href')).toBe(F('Bronze', 'nc1', 'Photos/Z/B/Evidences/N1.pdf'));
    messages[1].querySelector<HTMLButtonElement>('.zp-pic')!.click();
    await settle(fixture);
    expect(el.querySelector('.preview-modal .modal-body img')!.getAttribute('src')).toBe(F('Bronze', 'nc1', 'Photos/Z/B/Evidences/N1b.jpg'));
  });

  it('refresh reloads the report', async () => {
    const report: NonConformanceReport = { certification: 'Bronze', variant: 'da', ncCount: 0, assessment: assessment(), rounds: [], saEvidencePhotos: [] };
    const { fixture, el, text } = await open(NonConformancesPage, 'Bronze', '/api/msme/assessment/Bronze/non-conformances', report, 'Bronze');
    expect(text()).toContain('No non-conformance has been raised.');

    (el.querySelector('.refresh-link') as HTMLButtonElement).click();
    await settle(fixture);
    http.expectOne('/api/msme/assessment/Bronze/non-conformances').flush({ ...report, ncCount: 1, rounds: [round(1)] });
    http.expectOne('/api/msme/certifications/Bronze').flush(unit('Bronze'));
    await settle(fixture);
    expect(text()).toContain('Policy not signed (NC1)');
  });
});
