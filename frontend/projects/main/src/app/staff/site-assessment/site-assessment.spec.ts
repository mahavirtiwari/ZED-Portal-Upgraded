import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RemoteAssessmentsPage } from './remote-assessments';
import { SaAllotmentPage } from './sa-allotment';
import { todayIso } from './site-assessment.api';

async function settle(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

function choose(el: HTMLElement, selector: string, value: string) {
  const input = el.querySelector(selector) as HTMLInputElement | HTMLSelectElement;
  input.value = value;
  input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input'));
}

const button = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll('button, a')].find((b) => b.textContent!.trim().startsWith(label)) as HTMLElement | undefined;

describe('SaAllotmentPage', () => {
  let fixture: ComponentFixture<SaAllotmentPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  const units = [
    { ZedId: 'ZEDMSME000001', Certification: 'Silver', PUnitName: '<img src=x onerror=alert(1)>', UnitAddress: 'Plot 4', SiteAssessorId: null, ReasonForRejection: null },
    { ZedId: 'ZEDMSME000002', Certification: 'Gold', PUnitName: 'Beta', SiteAssessorId: 'ASR1', SaAssessorName: 'Lead One', ReasonForRejection: null },
    { ZedId: 'ZEDMSME000003', Certification: 'Gold', PUnitName: 'Gamma', SiteAssessorId: null, ReasonForRejection: 'Rejected earlier' },
  ];
  const assessors = [{ userId: 'ASR1', userName: 'Lead One' }, { userId: 'ASR2', userName: 'Co Two' }];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SaAllotmentPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(SaAllotmentPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle(fixture);
    http.expectOne('/api/staff/site-assessment/allotments').flush({ units, assessors });
    await settle(fixture);
  });

  afterEach(() => http.verify());

  it('lists the units with ALLOT / RE-ALLOT as on the old page, as text', () => {
    const rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toContain('ALLOT');
    expect(rows[1].textContent).toContain('RE-ALLOT');
    expect(rows[1].textContent).toContain('Lead One');
    expect(rows[2].querySelector('button')).toBeNull();
    expect(el.querySelector('tbody img')).toBeNull();
    expect(rows[0].textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('requires date, mode and lead assessor before calling the API', async () => {
    button(el, 'ALLOT')!.click();
    await settle(fixture);
    button(el.querySelector('.modal-footer') as HTMLElement, 'ALLOT')!.click();
    await settle(fixture);
    expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('Please select valid data.');
    http.expectNone('/api/staff/site-assessment/allotments');
  });

  it('allots with the chosen assessors and reloads the list', async () => {
    button(el, 'ALLOT')!.click();
    await settle(fixture);
    expect((el.querySelector('#FinalSaDate') as HTMLInputElement).min).toBe(todayIso());

    choose(el, '#FinalSaDate', '2099-01-15');
    choose(el, '#ModeOfAssessment', 'Onsite Assessment');
    await settle(fixture);
    choose(el, '#SiteAssessorId', 'ASR1');
    await settle(fixture);
    const coOptions = [...el.querySelectorAll('#CoAssessorId option')].map((o) => (o as HTMLOptionElement).value);
    expect(coOptions).toEqual(['', 'ASR2']);
    choose(el, '#CoAssessorId', 'ASR2');
    await settle(fixture);

    button(el.querySelector('.modal-footer') as HTMLElement, 'ALLOT')!.click();
    await settle(fixture);
    const req = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/site-assessment/allotments');
    expect(req.request.body).toEqual({
      zedId: 'ZEDMSME000001', certification: 'Silver', siteAssessorId: 'ASR1', coAssessorId: 'ASR2',
      assessmentDate: '2099-01-15', modeOfAssessment: 'Onsite Assessment',
    });
    req.flush({ message: 'Unit allotted.' });
    await settle(fixture);
    http.expectOne((r) => r.method === 'GET' && r.url === '/api/staff/site-assessment/allotments').flush({ units, assessors });
    await settle(fixture);
    expect(el.querySelector('.modal')).toBeNull();
    expect(el.querySelector('.alert-success')!.textContent).toContain('ZEDMSME000001 allotted');
  });

  it('shows the API message when the allotment is refused', async () => {
    button(el, 'ALLOT')!.click();
    await settle(fixture);
    choose(el, '#FinalSaDate', '2099-01-15');
    choose(el, '#ModeOfAssessment', 'Onsite Assessment');
    choose(el, '#SiteAssessorId', 'ASR1');
    await settle(fixture);
    button(el.querySelector('.modal-footer') as HTMLElement, 'ALLOT')!.click();
    await settle(fixture);
    http.expectOne((r) => r.method === 'POST').flush({ title: 'Please select an assessor of your agency.' }, { status: 400, statusText: 'Bad Request' });
    await settle(fixture);
    expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('Please select an assessor of your agency.');
  });
});

describe('RemoteAssessmentsPage', () => {
  let fixture: ComponentFixture<RemoteAssessmentsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RemoteAssessmentsPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(RemoteAssessmentsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle(fixture);
  });

  afterEach(() => http.verify());

  it('lists allotted assessments with links to the current portal', async () => {
    http.expectOne('/api/config').flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: 'https://old.example' });
    http.expectOne('/api/staff/site-assessment/remote-assessments').flush([
      { ZedId: 'ZEDMSME000001', Certification: 'Silver', EnterpriseName: 'Acme', ModeOfAssessment: 'Onsite Assessment', AssessmentDate: 'October 21, 2026', AgencyName: 'Agency A' },
      { ZedId: 'ZED&X', Certification: 'Gold', EnterpriseName: 'Beta', ModeOfAssessment: 'Remote Assessment' },
      { ZedId: 'ZEDMSME000003', Certification: 'Gold', EnterpriseName: 'Gamma', ModeOfAssessment: null },
    ]);
    await settle(fixture);

    const rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(3);
    expect((rows[0].querySelector('a') as HTMLAnchorElement).getAttribute('href')).toBe('/staff/assessment/sa-details/ZEDMSME000001/Silver');
    expect(rows[0].textContent).toContain('Onsite');
    expect((rows[1].querySelector('a') as HTMLAnchorElement).getAttribute('href')).toBe('/staff/remote/ZED%26X/Gold');
    expect(rows[2].querySelector('a')).toBeNull();
    expect(rows[2].textContent).toContain('Desktop');
  });

  it('shows "No Data" for an empty list', async () => {
    http.expectOne('/api/config').flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: '' });
    http.expectOne('/api/staff/site-assessment/remote-assessments').flush([]);
    await settle(fixture);
    expect(el.querySelector('.no-data')!.textContent).toContain('No Data');
  });
});
