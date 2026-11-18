import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ToastService } from '../toast';
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

  it('lists the units with Accept / Re-allot, as text', () => {
    const rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toContain('Accept');
    expect(rows[1].textContent).toContain('Re-allot');
    expect(rows[1].textContent).toContain('Lead One');
    expect(rows[2].querySelector('button.sa-act')).toBeNull();
    expect(el.querySelector('tbody img')).toBeNull();
    expect(rows[0].textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('requires date, mode and lead assessor before calling the API', async () => {
    button(el, 'Accept')!.click();
    await settle(fixture);
    button(el.querySelector('.modal-footer') as HTMLElement, 'Allot')!.click();
    await settle(fixture);
    expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('Please select valid data.');
    http.expectNone('/api/staff/site-assessment/allotments');
  });

  it('a tile filters the list; the chosen tile again shows every unit', async () => {
    const tile = [...el.querySelectorAll<HTMLButtonElement>('.lc-btn')].find((b) => b.textContent!.includes('Rejected'))!;
    tile.click();
    await settle(fixture);
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
    expect(el.querySelector('tbody')!.textContent).toContain('ZEDMSME000003');
    tile.click();
    await settle(fixture);
    expect(el.querySelectorAll('tbody tr').length).toBe(3);
  });

  it('allots with the chosen assessors and reloads the list', async () => {
    const toast = vi.spyOn(TestBed.inject(ToastService), 'success');
    button(el, 'Accept')!.click();
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

    button(el.querySelector('.modal-footer') as HTMLElement, 'Allot')!.click();
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
    expect(toast).toHaveBeenCalledWith('ZEDMSME000001 allotted', 'To Lead One.');
  });

  it('opens RE-ALLOT with the current assessor selected', async () => {
    (el.querySelectorAll('tbody tr')[1].querySelector('button') as HTMLButtonElement).click();
    await settle(fixture);
    expect((el.querySelector('#SiteAssessorId') as HTMLSelectElement).value).toBe('ASR1');
    expect(el.querySelector('#MeetingLink')).toBeNull();
  });

  it('View details on every row and in its menu, with the profile and Reject (2026-11-18)', async () => {
    const links = [...el.querySelectorAll<HTMLAnchorElement>('tbody a.sa-view')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/staff/assessment/da-details/ZEDMSME000001/Silver', '/staff/assessment/da-details/ZEDMSME000002/Gold', '/staff/assessment/da-details/ZEDMSME000003/Gold',
    ]);
    expect(links[0].classList).toContain('btn-outline-primary');
    const menuOf = async (row: number) => {
      const tr = el.querySelectorAll('tbody tr')[row];
      (tr.querySelector('.rm-btn') as HTMLButtonElement).click();
      await settle(fixture);
      return [...tr.querySelectorAll<HTMLButtonElement>('.rm-item')];
    };
    const first = await menuOf(0);
    expect(first.map((b) => b.textContent!.trim())).toEqual(['View details', 'View MSME profile', 'Reject']);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    first.find((b) => b.textContent!.trim() === 'View MSME profile')!.click();
    await settle(fixture);
    expect(navigate).toHaveBeenCalledWith('/staff/msme-profile/ZEDMSME000001');
    // Allotted to a site assessor, or rejected already: no Reject.
    expect((await menuOf(1)).map((b) => b.textContent!.trim())).toEqual(['View details', 'View MSME profile']);
    expect((await menuOf(2)).map((b) => b.textContent!.trim())).toEqual(['View details', 'View MSME profile']);
  });

  it('rejects a waiting unit with a reason, then reloads with a toast (2026-11-18)', async () => {
    const toast = vi.spyOn(TestBed.inject(ToastService), 'success');
    (el.querySelector('tbody tr .rm-btn') as HTMLButtonElement).click();
    await settle(fixture);
    (el.querySelector('.rm-item.danger') as HTMLButtonElement).click();
    await settle(fixture);
    expect(el.querySelector('.modal h3')!.textContent).toContain('Reject assessment?');
    (el.querySelector('.modal .cd-ok') as HTMLButtonElement).click();
    await settle(fixture);
    expect(el.querySelector('.modal .help-block')!.textContent).toContain('Please enter reason for rejection.');
    http.expectNone('/api/staff/site-assessment/allotments/reject');
    choose(el, '#saRejectReason', 'Outside our sector');
    await settle(fixture);
    (el.querySelector('.modal .cd-ok') as HTMLButtonElement).click();
    const req = http.expectOne('/api/staff/site-assessment/allotments/reject');
    expect(req.request.body).toEqual({ zedId: 'ZEDMSME000001', certification: 'Silver', reasonForRejection: 'Outside our sector' });
    req.flush({ message: 'Unit rejected.' });
    await settle(fixture);
    http.expectOne((r) => r.method === 'GET' && r.url === '/api/staff/site-assessment/allotments').flush({ units, assessors });
    await settle(fixture);
    expect(toast).toHaveBeenCalledWith('ZEDMSME000001 rejected', null);
    expect(el.querySelector('.modal')).toBeNull();
  });

  it('shows the API message when the allotment is refused', async () => {
    button(el, 'Accept')!.click();
    await settle(fixture);
    choose(el, '#FinalSaDate', '2099-01-15');
    choose(el, '#ModeOfAssessment', 'Onsite Assessment');
    choose(el, '#SiteAssessorId', 'ASR1');
    await settle(fixture);
    button(el.querySelector('.modal-footer') as HTMLElement, 'Allot')!.click();
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
    // A router link (the router keeps '&' in a path segment).
    expect((rows[1].querySelector('a.assess') as HTMLAnchorElement).getAttribute('href')).toBe('/staff/remote/ZED&X/Gold');
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
