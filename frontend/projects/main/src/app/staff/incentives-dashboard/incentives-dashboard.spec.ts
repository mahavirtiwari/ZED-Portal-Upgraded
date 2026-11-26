import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthService } from '@zed/shared';
import { IncentivesDashboard, IncentivesDashboardPage, rupees } from './incentives-dashboard';

describe('IncentivesDashboardPage (2026-11-24)', () => {
  let fixture: ComponentFixture<IncentivesDashboardPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  const data: IncentivesDashboard = {
    generatedAt: '2026-11-24T10:00:00',
    headline: { applications: 4, inVerification: 2, approved: 0, paid: 1, rejected: 0, onHold: 1, claimAmount: 6500, approvedAmount: 2500, paidAmount: 2500, desktopAgencies: 2, onsiteAgencies: 1 },
    schemes: [
      { code: 'SCH1', name: 'Capital Subsidy', total: 4, desktop: 1, onsite: 1, qc: 0, approved: 0, paid: 1, rejected: 0, onHold: 1, claimAmount: 6500, approvedAmount: 2500, flow: 'DesktopOnsite', active: true },
      { code: 'SCH2', name: 'Stock Market', total: 0, desktop: 0, onsite: 0, qc: 0, approved: 0, paid: 0, rejected: 0, onHold: 0, claimAmount: 0, approvedAmount: 0, flow: 'Desktop', active: false },
    ],
    fa: { total: 3, toAllot: 1, inVerification: 1, approved: 0, reimbursed: 1, rejected: 0 },
    months: [{ month: '2026-10', submitted: 1, approved: 0, rejected: 0 }, { month: '2026-11', submitted: 3, approved: 1, rejected: 0 }],
    states: [{ state: 'GOA', total: 3, inVerification: 2, approved: 0, paid: 0, rejected: 0 }, { state: 'KERALA', total: 1, inVerification: 0, approved: 0, paid: 1, rejected: 0 }],
    schemeOptions: [{ code: 'SCH1', name: 'Capital Subsidy' }],
    stateOptions: ['GOA', 'KERALA'],
  };

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function flushOthers() {
    for (const r of http.match('/api/config')) r.flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: '' });
    for (const r of http.match((x) => x.url === '/api/staff/attention')) r.flush({ total: 1, items: [{ key: 'scheme-allot', label: 'Scheme applications awaiting allotment', count: 1, link: '/staff/schemes-verify/applications', query: { status: 'Submitted' }, tone: 'warn', icon: 'people' }] });
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IncentivesDashboardPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    TestBed.inject(AuthService).setUser({ userId: 'INC1', userName: 'Incentives Desk', roleId: 7, role: 'MasterAdmin', subRoles: ['IncentivesOnly'] });
    fixture = TestBed.createComponent(IncentivesDashboardPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    flushOthers();
    http.expectOne((r) => r.url === '/api/staff/incentives-dashboard').flush(data);
    await settle();
    flushOthers();
    await settle();
  });

  afterEach(() => http.verify());

  it('shows the headline figures, the scheme and Financial Assistance cards, the months and the states', () => {
    const kpi = (k: string) => el.querySelector(`[data-kpi="${k}"] .id-kpi-value`)?.textContent?.trim();
    expect(kpi('applications')).toBe('4');
    expect(kpi('approved')).toBe('1');
    expect(kpi('agencies')).toBe('3');
    expect(el.querySelector('[data-kpi="amount"]')?.textContent).toContain('₹2,500');

    const scheme = el.querySelector('[data-scheme="SCH1"]')!;
    expect(scheme.querySelector('.app-level')?.textContent?.trim()).toBe('Capital Subsidy');
    expect(scheme.querySelector('[data-field="onsite"]')?.textContent?.trim()).toBe('1');
    expect(scheme.textContent).toContain('₹6,500');
    expect(el.querySelector('[data-scheme="fa"] [data-field="toAllot"]')?.textContent?.trim()).toBe('1');
    // 2026-11-26 (the user: "dynamic as per incentive scheme"): each card follows its scheme's flow; a scheme without applications
    // shows one line; an off scheme is marked.
    expect(scheme.querySelector('[data-flow]')?.textContent?.trim()).toBe('Desktop + Onsite');
    const desk = el.querySelector('[data-scheme="SCH2"]')!;
    expect(desk.querySelector('[data-flow]')?.textContent?.trim()).toBe('Desktop verification');
    expect(desk.querySelector('[data-off]')).not.toBeNull();
    expect(desk.querySelector('[data-empty]')?.textContent).toContain('No application yet');
    expect(desk.querySelector('[data-field]')).toBeNull();
    expect(el.querySelectorAll('.id-table tbody tr').length).toBe(2);
    expect(el.textContent).toContain('Needs your attention');
    expect(el.textContent).toContain('Scheme applications awaiting allotment');
  });

  it('asks again with the filters chosen', async () => {
    const select = el.querySelector('#id-state') as HTMLSelectElement;
    select.value = 'KERALA';
    select.dispatchEvent(new Event('change'));
    await settle();
    const req = http.expectOne((r) => r.url === '/api/staff/incentives-dashboard');
    expect(req.request.params.get('state')).toBe('KERALA');
    req.flush({ ...data, states: [data.states[1]] });
    await settle();
    expect(el.querySelectorAll('.id-table tbody tr').length).toBe(1);
  });

  it('tells the scheme cards from the Financial Assistance card and shows a line, not a flat chart, with no application (2026-11-25)', async () => {
    expect(el.querySelector('[data-scheme="SCH1"] .app-src')?.textContent?.trim()).toBe('Scheme Applications');
    expect(el.querySelector('[data-scheme="fa"] .app-src')?.textContent?.trim()).toBe('Financial Assistance screen');
    expect(el.querySelector('zed-grouped-column-chart')).not.toBeNull();
    (el.querySelector('.id-btn') as HTMLButtonElement).click();
    await settle();
    http.expectOne((r) => r.url === '/api/staff/incentives-dashboard').flush({ ...data, months: data.months.map((m) => ({ ...m, submitted: 0, approved: 0 })) });
    await settle();
    flushOthers();
    expect(el.querySelector('zed-grouped-column-chart')).toBeNull();
    expect(el.querySelector('.id-empty-chart')?.textContent).toContain('No scheme application was submitted in the last 12 months.');
  });

  it('writes amounts in rupees with Indian grouping, short in lakh and crore', () => {
    expect(rupees(1234567)).toBe('₹12,34,567');
    expect(rupees(1234567, true)).toBe('₹12.35 L');
    expect(rupees(25000000, true)).toBe('₹2.5 Cr');
  });
});
