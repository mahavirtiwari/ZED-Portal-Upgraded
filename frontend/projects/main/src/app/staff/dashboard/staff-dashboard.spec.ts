import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StaffDashboardPage } from './staff-dashboard';
import { ClientPager } from './dashboard-filters';
import { PortalSystem } from '../../portal-system';
import { STAFF_SYSTEM } from '../staff-menu';

const analytics = (view: 'registered' | 'certified' = 'registered', more: object = {}) => ({
  view,
  totals: { registered: 724287, certified: 512808, bronze: 500112, silver: 7735, gold: 4961 },
  sizes: [{ label: 'Micro', total: 666594 }, { label: 'Small', total: 50485 }, { label: 'Medium', total: 7207 }],
  genders: [{ label: 'male', total: 574614 }, { label: 'female', total: 141933 }, { label: 'OTHERS', total: 7739 }],
  socialCategories: [{ label: 'General', total: 378031 }, { label: 'OBC', total: 297002 }],
  months: [{ period: '2025-12', registered: 53478, certified: 41020 }, { period: '2026-01', registered: 8810, certified: 6120 }],
  years: [{ period: '2025', registered: 400000, certified: 300000 }, { period: '2026', registered: 8810, certified: 6120 }],
  states: [{ label: 'GUJARAT', total: 146518 }, { label: 'UTTAR PRADESH', total: 122101 }],
  districts: [{ label: 'SURAT', total: 57498 }],
  activities: [{ label: '13-Manufacture of textiles', total: 230213 }],
  districtOptions: [],
  boundState: null,
  generatedAt: '2026-10-27T10:00:00+05:30',
  statusCards: { BronzeTotal: 12, BronzePending: 3, SaGoldCompleted: 7, GoldRejected: null },
  ...more,
});

describe('StaffDashboardPage', () => {
  let fixture: ComponentFixture<StaffDashboardPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function create(system?: PortalSystem) {
    await TestBed.configureTestingModule({
      imports: [StaffDashboardPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), ...(system ? [{ provide: STAFF_SYSTEM, useValue: system }] : [])],
    }).compileComponents();
    fixture = TestBed.createComponent(StaffDashboardPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
  }

  afterEach(() => http.verify());

  const text = (e: Element | null) => e!.textContent!.replace(/\s+/g, ' ').trim();
  const analyticsCall = () => http.expectOne((r) => r.url === '/api/staff/dashboard/analytics');
  const choose = async (selector: string, value: string) => {
    const select = el.querySelector(selector) as HTMLSelectElement | HTMLInputElement;
    select.value = value;
    select.dispatchEvent(new Event(select instanceof HTMLSelectElement ? 'change' : 'input'));
    await settle();
  };

  it('main portal: one view with the filters, the totals, the status cards and the figures', async () => {
    await create('main');
    // Main: no separate cards call; the cards come with the filtered figures.
    http.expectNone('/api/staff/dashboard');
    const first = analyticsCall();
    expect(first.request.params.get('view')).toBe('registered');
    first.flush(analytics());
    await settle();

    expect(el.querySelector('.an-tabs')).toBeNull();
    // Updated time and Refresh in the page head; no second title.
    expect(text(el.querySelector('.page-head .dash-meta'))).toContain('Updated');
    expect(el.querySelector('.an h4')).toBeNull();
    (el.querySelector('.page-head .dash-meta .btn-outline-primary') as HTMLButtonElement).click();
    await settle();
    analyticsCall().flush(analytics());
    await settle();
    expect(el.querySelector('#registered')).toBeNull();
    expect([...el.querySelectorAll('.an-kpi')].map((k) => `${text(k.querySelector('.an-kpi-label'))}: ${text(k.querySelector('.an-kpi-value'))}`))
      .toEqual(['Registered units: 7,24,287', 'Certified units: 5,12,808', 'Bronze certified: 5,00,112', 'Silver certified: 7,735', 'Gold certified: 4,961']);

    // The status cards (no Financial Assistance), after the filters and the totals.
    expect(text(el.querySelector('.an-status h5'))).toBe('Applications under your charge');
    expect(el.querySelector('.page-sub')).toBeNull();
    expect(el.querySelector('.an-status [data-field="BronzeTotal"]')!.textContent).toBe('12');
    expect(el.querySelector('[data-field="SaGoldCompleted"]')!.textContent).toBe('7');
    expect(el.querySelector('[data-field="GoldRejected"]')!.textContent).toBe('0');
    expect(el.querySelector('[data-field="FaRejected"]')).toBeNull();
    expect([...el.querySelectorAll('.an-status .app-level')].map(text)).toEqual(['Bronze', 'Silver', 'Gold']);
    // Each status with its share of the level's applications in brackets (3 of 12 pending = 25%).
    const pending = el.querySelector('.an-status .app-card .app-stats li')!;
    expect([text(pending.querySelector('.app-label')), text(pending.querySelector('.app-value')), text(pending.querySelector('.app-share'))]).toEqual(['Assessment Pending', '3', '(25%)']);
    expect(el.querySelector('.an-status .app-card .app-seg.is-pending')!.getAttribute('style')).toContain('width: 25%');
    const after = (x: string, y: string) => !!(el.querySelector(x)!.compareDocumentPosition(el.querySelector(y)!) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect([after('.an-filters', '.an-kpis'), after('.an-kpis', '.an-status'), after('.an-status', '.an-grid-top')]).toEqual([true, true, true]);

    // The level and month charts, the splits and the rankings.
    // No level chart (the tiles and cards have those numbers) and no notes under the tiles.
    // The monthly and year-wise trend: registrations and certifications side by side.
    const trend = el.querySelectorAll('.an-trend .an-card');
    expect([...trend].map((c) => text(c.querySelector('h5')))).toEqual(['Monthly trend last 12 months of the range', 'Year-wise trend']);
    expect([...trend[0].querySelectorAll('.gc-label')].map(text)).toEqual(['Dec 25', 'Jan 26']);
    expect([...trend[0].querySelectorAll('.gc-legend li')].map(text)).toEqual(['Registered', 'Certified']);
    expect([...trend[1].querySelectorAll('.gc-label')].map(text)).toEqual(['2025', '2026']);
    expect([...trend[1].querySelectorAll('.gc-value')].map(text)).toEqual(['4.0L', '3.0L', '8.8K', '6.1K']);
    expect(el.querySelector('.an-kpi-note')).toBeNull();
    expect([...el.querySelectorAll('.an-grid-3 .cc-label')].map(text)).toEqual(['Male', 'Female', 'Others']);
    expect([...(el.querySelector('#an-gender') as HTMLSelectElement).options].map((o) => o.textContent!.trim())).toEqual(['All', 'Male', 'Female', 'Others']);
    const top = el.querySelector('.rk-list li')!;
    expect([text(top.querySelector('.rk-rank')), text(top.querySelector('.rk-label')), text(top.querySelector('.rk-value'))]).toEqual(['1', 'GUJARAT', '1,46,518']);
    // Every row, sortable by count or name; the rank stays the rank by count.
    const states = el.querySelector('zed-rank-list')!;
    expect(text(states.querySelector('.rk-title'))).toBe('State (2)');
    const sortBy = async (v: string) => {
      const select = states.querySelector('.rk-sort select') as HTMLSelectElement;
      select.value = v;
      select.dispatchEvent(new Event('change'));
      await settle();
    };
    const rows = () => [...states.querySelectorAll('.rk-list li')].map((li) => `${text(li.querySelector('.rk-rank'))} ${text(li.querySelector('.rk-label'))}`);
    await sortBy('low');
    expect(rows()).toEqual(['2 UTTAR PRADESH', '1 GUJARAT']);
    await sortBy('name');
    expect(rows()).toEqual(['1 GUJARAT', '2 UTTAR PRADESH']);
    expect((el.querySelector('#an-district') as HTMLSelectElement).disabled).toBe(true);

    // A filter changes the cards too.
    await choose('#an-state', 'GUJARAT');
    analyticsCall().flush(analytics('registered', { statusCards: { BronzeTotal: 5 } }));
    await settle();
    expect(el.querySelector('[data-field="BronzeTotal"]')!.textContent).toBe('5');
  });

  it('main portal: districts follow the state; the dates apply to registration or certification', async () => {
    await create('main');
    analyticsCall().flush(analytics());
    await settle();

    await choose('#an-state', 'GUJARAT');
    const byState = analyticsCall();
    expect(byState.request.params.get('state')).toBe('GUJARAT');
    byState.flush(analytics('registered', { districtOptions: ['SURAT', 'VADODARA'] }));
    await settle();
    const district = el.querySelector('#an-district') as HTMLSelectElement;
    expect(district.disabled).toBe(false);
    expect([...district.options].map((o) => o.textContent!.trim())).toEqual(['All', 'SURAT', 'VADODARA']);

    // Another state: its own districts only, none of the previous state's while it loads.
    await choose('#an-state', 'BIHAR');
    expect([...district.options].map((o) => o.textContent!.trim())).toEqual(['All']);
    const bihar = analyticsCall();
    expect([bihar.request.params.get('state'), bihar.request.params.get('district')]).toEqual(['BIHAR', null]);
    bihar.flush(analytics('registered', { districtOptions: ['PATNA'] }));
    await settle();
    expect([...district.options].map((o) => o.textContent!.trim())).toEqual(['All', 'PATNA']);

    // The certification level is a filter in both date modes.
    await choose('#an-cert', 'Silver');
    const silver = analyticsCall();
    expect([silver.request.params.get('view'), silver.request.params.get('certification')]).toEqual(['registered', 'Silver']);
    silver.flush(analytics());
    await settle();

    await choose('#an-dateby', 'certified');
    const cert = analyticsCall();
    expect([cert.request.params.get('view'), cert.request.params.get('state'), cert.request.params.get('certification')]).toEqual(['certified', 'BIHAR', 'Silver']);
    cert.flush(analytics('certified'));
    await settle();

    await choose('#an-from', '2026-01-01');
    const dated = analyticsCall();
    expect([dated.request.params.get('view'), dated.request.params.get('from')]).toEqual(['certified', '2026-01-01']);
    dated.flush(analytics('certified'));
    await settle();

    (el.querySelector('.page-head .dash-reset') as HTMLButtonElement).click();
    await settle();
    const cleared = analyticsCall();
    expect(cleared.request.params.keys()).toEqual(['view']);
    expect(cleared.request.params.get('view')).toBe('registered');
    cleared.flush(analytics());
    await settle();
    expect(el.querySelector('.page-head .dash-reset')).toBeNull();
  });

  it('main portal: a state-bound Ministry user keeps the state fixed', async () => {
    await create('main');
    analyticsCall().flush(analytics('registered', { boundState: 'UTTAR PRADESH', districtOptions: ['AGRA'] }));
    await settle();
    const state = el.querySelector('#an-state') as HTMLSelectElement;
    expect(state.disabled).toBe(true);
    expect(state.value).toBe('UTTAR PRADESH');
  });

  it('surveillance: the same figures, worded for surveillance, with its cards', async () => {
    await create('surveillance');
    http.expectNone('/api/staff/dashboard');
    analyticsCall().flush(analytics('registered', {
      statusCards: { BronzeTotal: 10, BronzePending: 4, BronzeCompleted: 5, SilverTotal: 4, SaSilverNcRaised: 1 },
    }));
    await settle();
    expect(el.querySelector('#registered')).toBeNull();
    expect(el.querySelector('.page-sub')).toBeNull();
    expect([...el.querySelectorAll('.an-kpi-label')].map(text))
      .toEqual(['Registered units', 'Surveillance completed', 'Bronze completed', 'Silver completed', 'Gold completed']);
    expect([...(el.querySelector('#an-dateby') as HTMLSelectElement).options].map((o) => o.textContent!.trim())).toEqual(['Registration', 'Surveillance completion']);
    expect([...el.querySelectorAll('.an-trend .an-card')[0].querySelectorAll('.gc-legend li')].map(text)).toEqual(['Registered', 'Surveillance completed']);
    expect([...el.querySelectorAll('.an-status .app-level')].map(text)).toEqual(['Bronze', 'Silver', 'Gold']);
    // Bronze surveillance has no NC Raised.
    const bronze = el.querySelector('.an-status .app-card')!;
    expect([...bronze.querySelectorAll('.app-label')].map(text)).toEqual(['Surveillance Pending', 'Surveillance Completed', 'Rejected']);
    expect(text(bronze.querySelector('.app-stats li .app-share'))).toBe('(40%)');
    expect(el.querySelector('[data-field="SaSilverNcRaised"]')!.textContent).toBe('1');
  });

  it('consultancy: handholding figures, Silver and Gold milestones and Technology Intervention', async () => {
    await create('consultancy');
    // The consultant tiles come from the summary (MasterAdmin only); the cards from the filtered figures.
    http.expectOne('/api/staff/dashboard').flush({ AssessmentAgencies: 4, SiteAssessors: 9, SilverTotal: 99 });
    analyticsCall().flush(analytics('registered', {
      totals: { registered: 300, certified: 12, bronze: 80, silver: 60, gold: 20 },
      statusCards: { SilverTotal: 60, SilverM1PaymentDone: 45, SilverCompleted: 30, SaSilverCompleted: 12, GoldTotal: 20, FaTotal: 8, FaCompleted: 2, FaPending: 6 },
    }));
    await settle();
    expect(el.querySelector('[data-field="AssessmentAgencies"]')!.textContent).toBe('4');
    expect([...el.querySelectorAll('.an-kpi')].map((k) => `${text(k.querySelector('.an-kpi-label'))}: ${text(k.querySelector('.an-kpi-value'))}`))
      .toEqual(['Registered units: 300', 'Handholding completed: 12', 'Applications: 80', 'Silver applications: 60', 'Gold applications: 20']);
    expect([...(el.querySelector('#an-cert') as HTMLSelectElement).options].map((o) => o.textContent!.trim())).toEqual(['All', 'Silver', 'Gold']);
    expect([...(el.querySelector('#an-dateby') as HTMLSelectElement).options].map((o) => o.textContent!.trim())).toEqual(['Registration', 'Handholding completion']);
    expect([...el.querySelectorAll('.an-status .app-level')].map(text)).toEqual(['Silver', 'Gold', 'Technology Intervention']);

    // The milestones: payments received and completed, each as a share of the level's applications.
    const silver = el.querySelector('.an-status .ms-card')!;
    expect(silver.querySelector('[data-field="SilverTotal"]')!.textContent).toBe('60');
    const m1 = silver.querySelector('.ms-list li')!;
    expect(text(m1.querySelector('.ms-no'))).toBe('Milestone 1');
    expect([...m1.querySelectorAll('.ms-figure')].map(text)).toEqual(['45(75%)', '30(50%)']);
    expect(silver.querySelectorAll('.ms-list li').length).toBe(3);
    expect(text(silver.querySelectorAll('.ms-list li')[2].querySelectorAll('.ms-figure')[1])).toBe('12(20%)');
    const ti = el.querySelectorAll('.an-status .app-card')[2];
    expect([...ti.querySelectorAll('.app-label')].map(text)).toEqual(['Approved', 'Pending']);
    expect(text(ti.querySelector('.app-stats li .app-share'))).toBe('(25%)');

    await choose('#an-cert', 'Gold');
    const gold = analyticsCall();
    expect(gold.request.params.get('certification')).toBe('Gold');
    gold.flush(analytics());
    await settle();
  });

  it('shows an error when the dashboard cannot be loaded', async () => {
    await create('main');
    analyticsCall().flush({ title: 'Nope' }, { status: 403, statusText: 'Forbidden' });
    await settle();
    expect(el.querySelectorAll('.alert-danger').length).toBe(1);
  });
});

describe('ClientPager', () => {
  it('pages and searches the loaded rows like the old pages', () => {
    const p = new ClientPager();
    p.set(Array.from({ length: 25 }, (_, i) => ({ ZedId: `ZEDMSME${String(i).padStart(6, '0')}`, PUnitName: i === 7 ? 'Acme Castings' : 'Unit' })));
    expect(p.lastPage()).toBe(3);
    expect(p.page().length).toBe(10);
    p.go(2);
    expect(p.pageNo()).toBe(3);
    expect(p.page().length).toBe(5);
    expect(p.serial(0)).toBe(21);
    p.go(1);
    expect(p.pageNo()).toBe(3);

    p.setSearch('acme');
    expect(p.pageNo()).toBe(1);
    expect(p.filtered().map((r) => r['ZedId'])).toEqual(['ZEDMSME000007']);
    p.setPageSize('50');
    expect(p.lastPage()).toBe(1);
  });
});
