import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { PublicIncentiveSubmissionsPage } from './incentive-submissions';
import { PublicIncentivesPage } from './incentives';
import { IncentiveDetails } from './schemes.api';
import { PUBLIC_INCENTIVE_ROUTES, SCHEME_LEGACY_REDIRECTS } from './schemes.routes';

@Component({ template: '' })
class Blank {}

describe('Public incentive pages', () => {
  let http: HttpTestingController;

  async function settle(harness: RouterTestingHarness) {
    harness.detectChanges();
    await new Promise((r) => setTimeout(r));
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  const details: IncentiveDetails = {
    certification: 'Bronze',
    state: 9,
    common: [{
      id: 11, ministryOrDepartment: 'Ministry of MSME', incentive: 'CLCS-TUS', details: '<b>details</b>', contactPerson: 'Mr X', email: 'x@gov.test',
      mobileNo: '011', webLink: 'https://msme.gov.in/clcs', videoLink: null, document1: '/api/public/incentives/11/documents/1?ct=Bronze', document2: null,
    }],
    states: [],
    other: [],
    financial: [
      { id: 41, ministryOrDepartment: 'SIDBI', incentive: 'Loan', details: 'd', contactPerson: null, email: null, mobileNo: null, webLink: null, videoLink: null, document1: null, document2: null },
    ],
    financialDepartments: ['SIDBI'],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          ...PUBLIC_INCENTIVE_ROUTES.map((r) => ({ ...r, loadComponent: undefined, component: r.path === 'incentives/submissions' ? PublicIncentiveSubmissionsPage : PublicIncentivesPage })),
          ...SCHEME_LEGACY_REDIRECTS,
          { path: 'msme/financial-assistance', component: Blank },
          { path: 'msme/technology-upgradation', component: Blank },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists the incentives of the level and state with safe links, text encoded', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/incentives?ct=Bronze&id=9');
    const req = http.expectOne((r) => r.url === '/api/public/incentives');
    expect(req.request.params.get('ct')).toBe('Bronze');
    expect(req.request.params.get('id')).toBe('9');
    req.flush(details);
    await settle(harness);

    const el = harness.routeNativeElement!;
    expect(el.querySelector('#incCommon')!.textContent).toContain('1. CLCS-TUS');
    expect(el.querySelector('#incCommon')!.innerHTML).toContain('&lt;b&gt;details&lt;/b&gt;');
    expect(el.querySelector('a[href="https://msme.gov.in/clcs"]')!.textContent).toContain('Avail');
    expect(el.querySelector('a[href="/api/public/incentives/11/documents/1?ct=Bronze"]')).not.toBeNull();
    expect(el.querySelector('#incFinancial')!.textContent).toContain('Loan');
    expect(el.querySelector('#incStates')!.textContent).toContain('No State Incentives available currently');
    expect(el.querySelector('header')).not.toBeNull();
  });

  it('shows one section when it= is given and no header on the mobile page', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/incentives/mobile?ct=Gold&it=Financial');
    http.expectOne((r) => r.url === '/api/public/incentives').flush({ ...details, certification: 'Gold' });
    await settle(harness);
    const el = harness.routeNativeElement!;
    expect(el.querySelector('#incFinancial')).not.toBeNull();
    expect(el.querySelector('#incCommon')).toBeNull();
    expect(el.querySelector('header')).toBeNull();
  });

  it('keeps the old addresses used by the certification pages and the mobile app', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    await harness.navigateByUrl('/Incentive/Details/28?ct=Silver');
    expect(router.url).toBe('/incentives?ct=Silver&id=28');
    http.expectOne((r) => r.url === '/api/public/incentives').flush(details);

    await harness.navigateByUrl('/Incentive/Details?id=9&it=States&ct=Gold');
    expect(router.url).toBe('/incentives?ct=Gold&id=9&it=States');
    http.expectOne((r) => r.url === '/api/public/incentives').flush(details);

    await harness.navigateByUrl('/FinancialAssistance');
    expect(router.url).toBe('/msme/financial-assistance');
    await harness.navigateByUrl('/TechnologyUpgradation/Index');
    expect(router.url).toBe('/msme/technology-upgradation');
  });

  it('lists public submissions without personal columns and pages them', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/incentives/submissions?id=9&ct=Bronze&gender=female');
    const req = http.expectOne((r) => r.url === '/api/public/incentives/submissions');
    expect(req.request.params.get('id')).toBe('9');
    expect(req.request.params.has('gender')).toBe(false);
    req.flush(Array.from({ length: 12 }, (_, i) => ({
      PUnitName: `Unit ${i + 1}`, PStateName: 'UTTAR PRADESH', Certification: 'Bronze', ServiceName: 'Svc', IncentiveName: 'Inc', DataFrom: 'API',
    })));
    await settle(harness);
    const el = harness.routeNativeElement!;
    expect(el.querySelectorAll('#incSubmissions tbody tr').length).toBe(10);
    expect([...el.querySelectorAll('#incSubmissions th')].map((t) => t.textContent!.trim())).toEqual(['S.No', 'Unit NameState Name', 'Certification', 'Service NameIncentive Name']);
    expect(el.textContent).toContain('Page 1 of 2');
  });
});
