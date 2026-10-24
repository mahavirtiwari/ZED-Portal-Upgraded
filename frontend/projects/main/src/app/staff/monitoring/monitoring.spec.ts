import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ASSESSMENT_SYSTEM } from '../assessment/assessment-shared';
import { MonitoringPage } from './monitoring';

describe('MonitoringPage', () => {
  let fixture: ComponentFixture<MonitoringPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const counts = { NotStarted: 1, InProgress: 2, Qc: 3, Nc: 4, Rj: 5 };
  const unit = (n: number, extra: Record<string, unknown> = {}) => ({
    RowNumber: n, ZedId: `ZEDMSME${String(n).padStart(6, '0')}`, Certification: 'Silver', PUnitName: `Unit ${n}`,
    CertificationStatus: 14, NcStatus: 0, NcCount: 2, SameUdyamAddress: 0, NcFinalClosureDt: 'October 30, 2026', ...extra,
  });

  const button = (label: string) =>
    [...el.querySelectorAll('button, a')].find((b) => b.textContent!.replace(/\s+/g, ' ').trim().startsWith(label)) as HTMLElement | undefined;

  function listRequest(): TestRequest {
    return http.expectOne((r) => r.method === 'GET' && r.url === '/api/staff/monitoring');
  }

  async function choose(selector: string, value: string) {
    const s = el.querySelector(selector) as HTMLSelectElement;
    s.value = value;
    s.dispatchEvent(new Event('change'));
    await settle();
  }

  /** Picks Silver, then the NC tab, answering both list calls. */
  async function openNcTab(canManage: boolean, units = [unit(1), unit(2, { NcStatus: 2, SameUdyamAddress: 3 })]) {
    await choose('#certification', 'Silver');
    listRequest().flush({ units: [], counts, canManage });
    await settle();
    button('NON-CONFORMANCE')!.click();
    await settle();
    const req = listRequest();
    expect(req.request.params.get('certification')).toBe('Silver');
    expect(req.request.params.get('status')).toBe('4');
    req.flush({ units, counts, canManage });
    await settle();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MonitoringPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(MonitoringPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne('/api/config').flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: 'https://old.example' });
    await settle();
  });

  afterEach(() => http.verify());

  it('loads nothing until a certification level is chosen', () => {
    http.expectNone('/api/staff/monitoring');
    expect(el.querySelector('.no-data')).not.toBeNull();
  });

  it('shows agencies the list without NC dates or admin actions', async () => {
    await openNcTab(false);
    expect(el.textContent).toContain('NON-CONFORMANCE 4');
    const rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(el.querySelector('thead')!.textContent).not.toContain('NC Closure Date');
    expect(el.textContent).not.toContain('October 30, 2026');
    expect(button('Extend NC')).toBeUndefined();
    expect(button('Step Back')).toBeUndefined();
    expect(rows[1].classList).toContain('table-danger');
    expect(rows[1].querySelector('.yellow-background')!.textContent!.trim()).toBe('3');
    expect((button('View Profile') as HTMLAnchorElement).getAttribute('href')).toBe('staff/msme-profile/ZEDMSME000001');
    expect((button('Assessment') as HTMLAnchorElement).getAttribute('href')).toBe('/staff/assessment/sa-details/ZEDMSME000001/Silver');
  });

  it('pages and searches the loaded list on the client', async () => {
    await openNcTab(false, Array.from({ length: 25 }, (_, i) => unit(i + 1)));
    expect(el.querySelectorAll('tbody tr').length).toBe(10);
    button('Last')!.click();
    await settle();
    expect(el.querySelectorAll('tbody tr').length).toBe(5);

    const search = el.querySelector('input[placeholder="ZED ID"]') as HTMLInputElement;
    search.value = 'ZEDMSME000017';
    search.dispatchEvent(new Event('input'));
    await settle();
    const rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('ZEDMSME000017');
  });

  it('lets master admin extend the NC closure date and reloads', async () => {
    await openNcTab(true);
    expect(el.querySelector('thead')!.textContent).toContain('NC Closure Date');
    expect(button('Step Back to NC1')).toBeDefined();

    button('Extend NC')!.click();
    await settle();
    expect(el.querySelector('.modal')!.textContent).toContain('October 30, 2026');
    const days = el.querySelector('#noOfDays') as HTMLSelectElement;
    // As the old pop-up: 0 to 30 days, 0 first.
    expect([...days.options].map((o) => o.text.trim())).toEqual(Array.from({ length: 31 }, (_, i) => String(i)));
    expect(days.options[days.selectedIndex].text.trim()).toBe('0');
    days.value = [...days.options].find((o) => o.text.trim() === '7')!.value;
    days.dispatchEvent(new Event('change'));
    await settle();
    button('SUBMIT')!.click();
    await settle();
    const req = http.expectOne('/api/staff/monitoring/extend-nc-closure');
    expect(req.request.body).toEqual({ zedId: 'ZEDMSME000001', certification: 'Silver', noOfDays: 7 });
    req.flush({ message: 'NC final closure date extended.' });
    await settle();
    listRequest().flush({ units: [unit(1)], counts, canManage: true });
    await settle();
    expect(el.querySelector('.modal')).toBeNull();
    expect(el.querySelector('.alert-success')!.textContent).toContain('NC final closure date extended.');
  });

  it('asks for at least one day before extending', async () => {
    await openNcTab(true);
    button('Extend NC')!.click();
    await settle();
    button('SUBMIT')!.click();
    await settle();
    http.expectNone('/api/staff/monitoring/extend-nc-closure');
    expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('1 to 30');
  });

  it('shows the API message when an action is refused', async () => {
    await openNcTab(true);
    button('Step Back to NC1')!.click();
    await settle();
    button('SUBMIT')!.click();
    await settle();
    http.expectOne('/api/staff/monitoring/step-back-nc').flush({ title: 'Invalid Details.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('Invalid Details.');
  });

  it('offers send back to agency on scheduled units only, never for Bronze', async () => {
    await choose('#certification', 'Gold');
    listRequest().flush({ units: [], counts, canManage: true });
    await settle();
    button('SCHEDULED BUT NOT STARTED')!.click();
    await settle();
    listRequest().flush({ units: [unit(1, { Certification: 'Gold', CertificationStatus: 8 }), unit(2, { Certification: 'Gold', CertificationStatus: 9 })], counts, canManage: true });
    await settle();
    const rows = el.querySelectorAll('tbody tr');
    expect(rows[0].textContent).toContain('Send Back to Agency');
    expect(rows[1].textContent).not.toContain('Send Back to Agency');

    await choose('#certification', 'Bronze');
    listRequest().flush({ units: [unit(1, { Certification: 'Bronze', CertificationStatus: 8 })], counts, canManage: true });
    await settle();
    expect(el.textContent).not.toContain('Send Back to Agency');
  });

  it('renders unit data as text', async () => {
    await openNcTab(false, [unit(1, { PUnitName: '<img src=x onerror=alert(1)>' })]);
    expect(el.querySelector('tbody img')).toBeNull();
    expect(el.querySelector('tbody')!.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('MonitoringPage per system', () => {
  let http: HttpTestingController;

  async function create(system: 'consultancy' | 'surveillance') {
    await TestBed.configureTestingModule({
      imports: [MonitoringPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: ASSESSMENT_SYSTEM, useValue: system }],
    }).compileComponents();
    const fixture = TestBed.createComponent(MonitoringPage);
    http = TestBed.inject(HttpTestingController);
    const settle = async () => {
      fixture.detectChanges();
      await new Promise((r) => setTimeout(r));
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await settle();
    http.expectOne('/api/config').flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: 'https://old.example' });
    await settle();
    const el: HTMLElement = fixture.nativeElement;
    const s = el.querySelector('#certification') as HTMLSelectElement;
    return { fixture, el, settle, select: s };
  }

  const counts = { NotStarted: 1, InProgress: 2, Qc: 3, Nc: 4, Rj: 5 };

  afterEach(() => http.verify());

  it('consultancy: Silver/Gold, three tabs, milestone columns and no admin actions', async () => {
    const { el, settle, select } = await create('consultancy');
    expect(el.textContent).toContain('Consultancy Monitoring');
    expect([...select.options].map((o) => o.text.trim()).filter((t) => t !== 'Select')).toEqual(['Silver', 'Gold']);
    expect(el.textContent).toContain('CONSULTANCY IN-PROGRESS');
    expect(el.textContent).not.toContain('NON-CONFORMANCE');
    select.value = 'Silver';
    select.dispatchEvent(new Event('change'));
    await settle();
    http.expectOne((r) => r.url === '/api/staff/monitoring').flush({
      units: [
        { ZedId: 'ZEDMSME000001', Certification: 'Silver', CertificationStatus: 8, NcCount: 1, BdsFromDate: 'May 1, 2026', HapFromDate: 'May 9, 2026', TechExpertName: 'Expert One' },
        { ZedId: 'ZEDMSME000002', Certification: 'Silver', CertificationStatus: 9, NcCount: 2, SaAssessmentDate: 'June 2, 2026', DocVerifiAllot: 'May 20, 2026' },
      ],
      counts,
      canManage: true,
    });
    await settle();
    const rows = el.querySelectorAll('tbody tr');
    expect(rows[0].textContent).toContain('Milestone 1');
    expect(rows[0].textContent).toContain('BDS: May 1, 2026');
    expect(rows[0].textContent).toContain('Expert One');
    expect(rows[1].textContent).toContain('PR1: June 2, 2026');
    expect(el.textContent).not.toContain('Send Back to Agency');
    expect(el.querySelector('thead')!.textContent).not.toContain('Duplicates');
  });

  it('surveillance: Surveillance No, step back kept, no send back to the agency', async () => {
    const { el, settle, select } = await create('surveillance');
    expect(el.textContent).toContain('Surveillance Monitoring');
    select.value = 'Gold';
    select.dispatchEvent(new Event('change'));
    await settle();
    http.expectOne((r) => r.url === '/api/staff/monitoring').flush({ units: [], counts, canManage: true });
    await settle();
    ([...el.querySelectorAll('button')].find((b) => b.textContent!.includes('SCHEDULED'))!).click();
    await settle();
    http.expectOne((r) => r.url === '/api/staff/monitoring').flush({
      units: [{ ZedId: 'ZEDMSME000001', Certification: 'Gold', CertificationStatus: 8, SurveillanceNo: '2nd Surveillance', ModeOfAssessment: 'Remote' }],
      counts,
      canManage: true,
    });
    await settle();
    const row = el.querySelector('tbody tr')!;
    expect(row.textContent).toContain('2nd Surveillance');
    expect(row.textContent).toContain('Remote');
    expect(row.textContent).not.toContain('Send Back to Agency');
    expect(el.querySelector('thead')!.textContent).toContain('Surveillance Dates');
  });
  it('surveillance: Extend NC Final Closure Date on the REJECTED tab as well, step back only in NC', async () => {
    const { el, settle, select } = await create('surveillance');
    select.value = 'Silver';
    select.dispatchEvent(new Event('change'));
    await settle();
    http.expectOne((r) => r.url === '/api/staff/monitoring').flush({ units: [], counts, canManage: true });
    await settle();
    ([...el.querySelectorAll('button')].find((b) => b.textContent!.includes('REJECTED'))!).click();
    await settle();
    http.expectOne((r) => r.url === '/api/staff/monitoring' && r.params.get('status') === '7').flush({
      units: [{ ZedId: 'ZEDMSME000001', Certification: 'Silver', CertificationStatus: 17, NcCount: 2, NcFinalClosureDt: 'October 30, 2026' }],
      counts,
      canManage: true,
    });
    await settle();
    const row = el.querySelector('tbody tr')!;
    expect(row.textContent).not.toContain('Step Back');
    ([...row.querySelectorAll('button')].find((b) => b.textContent!.includes('Extend NC'))!).click();
    await settle();
    const days = el.querySelector('#noOfDays') as HTMLSelectElement;
    days.value = [...days.options].find((o) => o.text.trim() === '1')!.value;
    days.dispatchEvent(new Event('change'));
    await settle();
    ([...el.querySelectorAll('.modal button')].find((b) => b.textContent!.trim() === 'SUBMIT') as HTMLButtonElement).click();
    await settle();
    const req = http.expectOne('/api/staff/monitoring/extend-nc-closure');
    expect(req.request.body).toEqual({ zedId: 'ZEDMSME000001', certification: 'Silver', noOfDays: 1 });
    req.flush({ message: 'NC final closure date extended.' });
    await settle();
    for (const r of http.match((r) => r.url === '/api/staff/monitoring')) r.flush({ units: [], counts, canManage: true });
  });

  it('surveillance: open NC rows in btn-warning; the agency sees the allotment date before the assessment date', async () => {
    const { el, settle, select } = await create('surveillance');
    select.value = 'Silver';
    select.dispatchEvent(new Event('change'));
    await settle();
    http.expectOne((r) => r.url === '/api/staff/monitoring').flush({
      units: [{ ZedId: 'ZEDMSME000001', Certification: 'Silver', CertificationStatus: 14, NcStatus: 2, DocVerifiAllot: 'May 20, 2026', SaAssessmentDate: 'June 2, 2026' }],
      counts,
      canManage: false,
    });
    await settle();
    const row = el.querySelector('tbody tr')!;
    expect(row.classList).toContain('btn-warning');
    expect(row.classList).not.toContain('table-danger');
    // The two dates are separated by line breaks (no text between them).
    const cell = row.querySelectorAll('td')[6];
    expect(cell.querySelectorAll('br').length).toBe(2);
    expect(cell.textContent!.replace(/\s+/g, ' ').trim()).toBe('May 20, 2026June 2, 2026');
  });

  it('surveillance: the master admin sees the assessment and NC closure dates only', async () => {
    const { el, settle, select } = await create('surveillance');
    select.value = 'Silver';
    select.dispatchEvent(new Event('change'));
    await settle();
    http.expectOne((r) => r.url === '/api/staff/monitoring').flush({
      units: [{ ZedId: 'ZEDMSME000001', Certification: 'Silver', CertificationStatus: 9, DocVerifiAllot: 'May 20, 2026', SaAssessmentDate: 'June 2, 2026', NcFinalClosureDt: 'July 1, 2026' }],
      counts,
      canManage: true,
    });
    await settle();
    const dates = el.querySelectorAll('tbody tr td')[6].textContent!.replace(/\s+/g, ' ').trim();
    expect(dates).toBe('June 2, 2026 July 1, 2026');
  });

  it('consultancy: "Certification Level" with "Select" first, open NC rows in btn-warning', async () => {
    const { el, settle, select } = await create('consultancy');
    expect(el.querySelector('label[for=certification]')!.textContent!.trim()).toBe('Certification Level');
    expect([...select.options].map((o) => o.text.trim())).toEqual(['Select', 'Silver', 'Gold']);
    select.value = 'Gold';
    select.dispatchEvent(new Event('change'));
    await settle();
    http.expectOne((r) => r.url === '/api/staff/monitoring').flush({
      units: [{ ZedId: 'ZEDMSME000001', Certification: 'Gold', CertificationStatus: 4, NcStatus: 2, NcCount: 1 }],
      counts,
      canManage: false,
    });
    await settle();
    expect(el.querySelector('tbody tr')!.classList).toContain('btn-warning');
    expect([...select.options].map((o) => o.text.trim())).toEqual(['Select', 'Silver', 'Gold']);
  });
});
