import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { PortalSystem } from '../../portal-system';
import { RemoteAssessmentsPage } from './remote-assessments';
import { SaAllotmentPage } from './sa-allotment';
import { SITE_SYSTEM, isWebLink, todayIso } from './site-assessment.api';

async function settle(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

function choose(el: HTMLElement, selector: string, value: string) {
  const input = el.querySelector(selector) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  input.value = value;
  input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input'));
}

const button = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll('button, a')].find((b) => b.textContent!.trim().startsWith(label)) as HTMLElement | undefined;

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return todayIso(d);
}

function setup<T>(component: Type<T>, system: PortalSystem, params: Record<string, string> = {}) {
  TestBed.configureTestingModule({
    imports: [component],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SITE_SYSTEM, useValue: system },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap(params) } } },
    ],
  });
  const fixture = TestBed.createComponent(component);
  return { fixture, http: TestBed.inject(HttpTestingController), el: fixture.nativeElement as HTMLElement };
}

describe('isWebLink', () => {
  it('accepts only http/https addresses', () => {
    expect(isWebLink('https://meet.example/abc')).toBe(true);
    expect(isWebLink('http://meet.example')).toBe(true);
    expect(isWebLink('javascript:alert(1)')).toBe(false);
    expect(isWebLink('meet.example/abc')).toBe(false);
    expect(isWebLink('https://meet.example/a b')).toBe(false);
  });
});

describe('SaAllotmentPage (consultancy)', () => {
  let fixture: ComponentFixture<SaAllotmentPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  const units = [
    { ZedId: 'ZEDMSME000001', Certification: 'Silver', NcCount: 1, PUnitName: 'Acme', SiteAssessorId: null, ReasonForRejection: null, CoConsultantIds: [], TechnicalExpertIds: [] },
    { ZedId: 'ZEDMSME000002', Certification: 'Gold', NcCount: 2, PUnitName: 'Beta', SiteAssessorId: 'CC1', SaAssessorName: 'Lead One', ReasonForRejection: null,
      CoConsultantIds: ['CC2'], TechnicalExpertIds: ['TE1'], CoConsultantNames: 'Co Two', TechnicalExpertNames: 'Expert One' },
    { ZedId: 'ZEDMSME000003', Certification: 'Gold', NcCount: 1, PUnitName: 'Gamma', SiteAssessorId: null, ReasonForRejection: 'No' },
  ];
  const consultants = [{ userId: 'CC1', userName: 'Lead One' }, { userId: 'CC2', userName: 'Co Two' }, { userId: 'CC3', userName: 'Co Three' }];
  const technicalExperts = [{ userId: 'TE1', userName: 'Expert One' }];

  beforeEach(async () => {
    ({ fixture, http, el } = setup(SaAllotmentPage, 'consultancy'));
    await settle(fixture);
    http.expectOne('/api/staff/site-assessment/consultancy/allotments').flush({ units, consultants, technicalExperts });
    await settle(fixture);
  });

  afterEach(() => http.verify());

  it('shows the CO page with ACCEPT / REJECT, RE-ALLOT and REJECTED', () => {
    expect(el.querySelector('h3')!.textContent).toContain('Allot Consultancy');
    const rows = el.querySelectorAll('tbody tr');
    expect(rows[0].textContent).toContain('ACCEPT');
    expect(rows[0].textContent).toContain('REJECT');
    expect(rows[0].textContent).toContain('Milestone 1');
    expect(rows[1].textContent).toContain('RE-ALLOT');
    expect(rows[1].textContent).toContain('Co Two');
    expect(rows[2].textContent).toContain('REJECTED');
  });

  it('allots milestone 1 with the team and the BDS and HAP dates', async () => {
    button(el, 'ACCEPT')!.click();
    await settle(fixture);
    expect(el.querySelector('#HapFromDate')).not.toBeNull();
    choose(el, '#LeadConsultant', 'CC1');
    await settle(fixture);
    // The lead is not offered as a co-consultant.
    expect(el.querySelector('#co-CC1')).toBeNull();
    (el.querySelector('#co-CC3') as HTMLInputElement).click();
    (el.querySelector('#te-TE1') as HTMLInputElement).click();
    choose(el, '#BdsFromDate', inDays(1));
    choose(el, '#BdsToDate', inDays(5));
    choose(el, '#HapFromDate', inDays(2));
    choose(el, '#HapToDate', inDays(6));
    await settle(fixture);
    (el.querySelector('.submit') as HTMLButtonElement).click();
    const req = http.expectOne('/api/staff/site-assessment/consultancy/allotments');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      zedId: 'ZEDMSME000001', certification: 'Silver', leadConsultantId: 'CC1', coConsultantIds: ['CC3'], technicalExpertIds: ['TE1'],
      bdsFromDate: inDays(1), bdsToDate: inDays(5), hapFromDate: inDays(2), hapToDate: inDays(6),
    });
    req.flush({ message: 'Unit allotted.' });
    await settle(fixture);
    http.expectOne('/api/staff/site-assessment/consultancy/allotments').flush({ units, consultants, technicalExperts });
    await settle(fixture);
    expect(el.textContent).toContain('allotted successfully');
  });

  it('re-allots a later milestone without HAP dates, keeping the current team', async () => {
    button(el, 'RE-ALLOT')!.click();
    await settle(fixture);
    expect(el.querySelector('#HapFromDate')).toBeNull();
    expect(el.textContent).toContain('Progress Review 1');
    expect((el.querySelector('#co-CC2') as HTMLInputElement).checked).toBe(true);
    choose(el, '#BdsFromDate', inDays(1));
    choose(el, '#BdsToDate', inDays(1));
    await settle(fixture);
    (el.querySelector('.submit') as HTMLButtonElement).click();
    const req = http.expectOne('/api/staff/site-assessment/consultancy/allotments');
    expect(req.request.body.leadConsultantId).toBe('CC1');
    expect(req.request.body.coConsultantIds).toEqual(['CC2']);
    expect(req.request.body.hapFromDate).toBeNull();
    req.flush({ message: 'ok' });
    await settle(fixture);
    http.expectOne('/api/staff/site-assessment/consultancy/allotments').flush({ units, consultants, technicalExperts });
  });

  it('requires the dates before sending', async () => {
    button(el, 'ACCEPT')!.click();
    await settle(fixture);
    choose(el, '#LeadConsultant', 'CC1');
    await settle(fixture);
    (el.querySelector('.submit') as HTMLButtonElement).click();
    await settle(fixture);
    expect(el.textContent).toContain('Please select required data.');
  });

  it('rejects with a reason', async () => {
    (el.querySelector('tbody tr .reject') as HTMLButtonElement).click();
    await settle(fixture);
    choose(el, '#ReasonForRejection', 'Outside our state');
    await settle(fixture);
    (el.querySelector('.submit-reject') as HTMLButtonElement).click();
    const req = http.expectOne('/api/staff/site-assessment/consultancy/allotments/reject');
    expect(req.request.body).toEqual({ zedId: 'ZEDMSME000001', certification: 'Silver', reasonForRejection: 'Outside our state' });
    req.flush({ message: 'Unit rejected.' });
    await settle(fixture);
    http.expectOne('/api/staff/site-assessment/consultancy/allotments').flush({ units, consultants, technicalExperts });
  });
});

describe('SaAllotmentPage (surveillance)', () => {
  let fixture: ComponentFixture<SaAllotmentPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  const units = [{
    ZedId: 'ZEDMSME000001', Certification: 'Silver', PUnitName: 'Acme', SiteAssessorId: null, ReasonForRejection: null,
    SurveillanceNo: '1st Surveillance', AssessmentDate: 'October 22, 2026', LeadInCertification: 'ASR7', LeadNameInCertification: 'Original Lead',
  }];
  const assessors = [{ userId: 'ASR1', userName: 'Lead One' }];

  beforeEach(async () => {
    ({ fixture, http, el } = setup(SaAllotmentPage, 'surveillance'));
    await settle(fixture);
    http.expectOne('/api/staff/site-assessment/allotments').flush({ units, assessors });
    await settle(fixture);
  });

  afterEach(() => http.verify());

  it('shows the surveillance round and date and sends the meeting link', async () => {
    expect(el.textContent).toContain('1st Surveillance');
    expect(el.textContent).toContain('Surveillance Date');
    button(el, 'ALLOT')!.click();
    await settle(fixture);
    expect(el.textContent).toContain('Original Lead');
    // One "Assessor" and no Co Assessor choice, as on the surveillance page.
    expect(el.querySelector('label[for=SiteAssessorId]')!.textContent).toContain('Assessor');
    expect(el.querySelector('label[for=SiteAssessorId]')!.textContent).not.toContain('Lead');
    expect(el.querySelector('#CoAssessorId')).toBeNull();
    choose(el, '#FinalSaDate', inDays(1));
    choose(el, '#SiteAssessorId', 'ASR1');
    choose(el, '#MeetingLink', 'javascript:alert(1)');
    await settle(fixture);
    (el.querySelector('.modal-footer .btn-primary') as HTMLButtonElement).click();
    await settle(fixture);
    expect(el.textContent).toContain('valid meeting link');
    http.expectNone('/api/staff/site-assessment/allotments');

    choose(el, '#MeetingLink', 'https://meet.example/abc');
    await settle(fixture);
    (el.querySelector('.modal-footer .btn-primary') as HTMLButtonElement).click();
    const req = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/site-assessment/allotments');
    expect(req.request.body.meetingLink).toBe('https://meet.example/abc');
    expect(req.request.body.modeOfAssessment).toBe('Onsite Assessment');
    expect(req.request.body.coAssessorId).toBeNull();
    req.flush({ message: 'ok' });
    await settle(fixture);
    http.expectOne('/api/staff/site-assessment/allotments').flush({ units, assessors });
  });
});

describe('RemoteAssessmentsPage (consultancy milestone list)', () => {
  it('loads the milestone from the route and links VIEW DETAILS to the milestone page', async () => {
    const { fixture, http, el } = setup(RemoteAssessmentsPage, 'consultancy', { milestone: '2' });
    await settle(fixture);
    http.expectOne('/api/config').flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: '' });
    http.expectOne('/api/staff/site-assessment/consultancy/milestones/2').flush([
      { ZedId: 'ZEDMSME000001', Certification: 'Silver', EnterpriseName: 'Acme', BdsToDate: 'October 30, 2026', ConsultantRole: 'Lead Consultant' },
    ]);
    await settle(fixture);
    expect(el.querySelector('h3')!.textContent).toContain('Milestone 2');
    expect(el.textContent).toContain('October 30, 2026');
    expect((el.querySelector('a.details') as HTMLAnchorElement).getAttribute('href')).toBe('/staff/consultancy/milestones/ZEDMSME000001/Silver');
  });

  it('falls back to milestone 1 for an invalid parameter', () => {
    expect(RemoteAssessmentsPage.milestoneOf('7')).toBe(1);
    expect(RemoteAssessmentsPage.milestoneOf(null)).toBe(1);
    expect(RemoteAssessmentsPage.milestoneOf('3')).toBe(3);
  });
});

describe('RemoteAssessmentsPage (surveillance)', () => {
  it('offers ASSESS for onsite (meeting link) units and shows them as Remote', async () => {
    const { fixture, http, el } = setup(RemoteAssessmentsPage, 'surveillance');
    await settle(fixture);
    http.expectOne('/api/config').flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: '' });
    http.expectOne('/api/staff/site-assessment/remote-assessments').flush([
      { ZedId: 'ZEDMSME000001', Certification: 'Silver', PUnitName: 'Acme Unit', ModeOfAssessment: 'Onsite Assessment', AssessmentDate: 'October 22, 2026' },
    ]);
    await settle(fixture);
    expect((el.querySelector('a.assess') as HTMLAnchorElement).getAttribute('href')).toBe('/staff/remote/ZEDMSME000001/Silver');
    expect(el.textContent).toContain('Remote');
    expect(el.textContent).toContain('Surveillance Date');
    expect(el.textContent).not.toContain('VIEW DETAILS');
  });
});
