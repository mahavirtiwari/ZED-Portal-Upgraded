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
  genders: [{ label: 'male', total: 574614 }, { label: 'female', total: 141933 }, { label: 'NA', total: 43 }],
  socialCategories: [{ label: 'General', total: 378031 }, { label: 'OBC', total: 297002 }],
  months: [{ label: '2025-12', total: 53478 }, { label: '2026-01', total: 8810 }],
  states: [{ label: 'GUJARAT', total: 146518 }, { label: 'UTTAR PRADESH', total: 122101 }],
  districts: [{ label: 'SURAT', total: 57498 }],
  activities: [{ label: '13-Manufacture of textiles', total: 230213 }],
  districtOptions: [],
  boundState: null,
  generatedAt: '2026-10-27T10:00:00+05:30',
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

  it('main portal: the certification cards, then the ZED Dashboard figures', async () => {
    await create('main');
    http.expectOne('/api/staff/dashboard').flush({ BronzeTotal: 12, BronzePending: 3, SaGoldCompleted: 7, FaRejected: null });
    const first = analyticsCall();
    expect(first.request.params.get('view')).toBe('registered');
    first.flush(analytics());
    await settle();

    expect(el.querySelector('[data-field="BronzeTotal"]')!.textContent).toBe('12');
    expect(el.querySelector('[data-field="FaRejected"]')!.textContent).toBe('0');
    expect(el.querySelector('#registered')).toBeNull();
    expect([...el.querySelectorAll('.an-kpi')].map((k) => `${text(k.querySelector('.an-kpi-label'))}: ${text(k.querySelector('.an-kpi-value'))}`))
      .toEqual(['Registered units: 7,24,287', 'Bronze certified: 5,00,112', 'Silver certified: 7,735', 'Gold certified: 4,961']);
    expect([...el.querySelectorAll('.an-grid-top .cc-label')].map(text)).toEqual(['Dec 25', 'Jan 26']);
    expect([...el.querySelectorAll('zed-column-chart[arialabel="Units by gender of the owner"] .cc-label, .an-grid-3 .cc-label')].map(text))
      .toEqual(['Male', 'Female', 'Not given']);
    const top = el.querySelector('.rk-list li')!;
    expect([text(top.querySelector('.rk-rank')), text(top.querySelector('.rk-label')), text(top.querySelector('.rk-value'))]).toEqual(['1', 'GUJARAT', '1,46,518']);
    expect((el.querySelector('#an-district') as HTMLSelectElement).disabled).toBe(true);
  });

  it('main portal: a state brings its districts; the certification tab has the level filter', async () => {
    await create('main');
    http.expectOne('/api/staff/dashboard').flush({});
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

    (el.querySelectorAll('.an-tabs .nav-link')[1] as HTMLButtonElement).click();
    await settle();
    const cert = analyticsCall();
    expect([cert.request.params.get('view'), cert.request.params.get('state')]).toEqual(['certified', 'GUJARAT']);
    cert.flush(analytics('certified'));
    await settle();
    expect(el.querySelector('#an-cert')).not.toBeNull();
    expect(text(el.querySelector('.an-kpi .an-kpi-label'))).toBe('Certified units');
    expect([...el.querySelectorAll('.an-grid-top.has-levels .an-card:first-child .cc-label')].map(text)).toEqual(['Bronze', 'Silver', 'Gold']);

    await choose('#an-from', '2026-01-01');
    const dated = analyticsCall();
    expect(dated.request.params.get('from')).toBe('2026-01-01');
    dated.flush(analytics('certified'));
    await settle();

    (el.querySelector('.an-reset .btn-link') as HTMLButtonElement).click();
    await settle();
    const cleared = analyticsCall();
    expect(cleared.request.params.keys()).toEqual(['view']);
    cleared.flush(analytics('certified'));
    await settle();
  });

  it('main portal: a state-bound Ministry user keeps the state fixed', async () => {
    await create('main');
    http.expectOne('/api/staff/dashboard').flush({});
    analyticsCall().flush(analytics('registered', { boundState: 'UTTAR PRADESH', districtOptions: ['AGRA'] }));
    await settle();
    const state = el.querySelector('#an-state') as HTMLSelectElement;
    expect(state.disabled).toBe(true);
    expect(state.value).toBe('UTTAR PRADESH');
  });

  it('other portals keep the filtered counts strip', async () => {
    await create('surveillance');
    http.expectOne('/api/staff/dashboard').flush({ BronzeTotal: 12 });
    http.expectOne('/api/staff/dashboard/counts').flush({ total: 40000, bronze: 2000, silver: 1000, gold: 500 });
    await settle();
    expect(el.querySelector('#registered')!.textContent).toBe('40,000');
    expect(el.querySelector('zed-staff-analytics')).toBeNull();

    const gender = el.querySelector('#d-gender') as HTMLSelectElement;
    gender.value = 'female';
    gender.dispatchEvent(new Event('change'));
    await settle();
    const req = http.expectOne((r) => r.url === '/api/staff/dashboard/counts');
    expect(req.request.params.get('gender')).toBe('female');
    req.flush({ total: 10, bronze: 1, silver: 0, gold: 0 });
    await settle();
    expect(el.querySelector('#registered')!.textContent).toBe('10');
  });

  it('shows an error when the dashboard cannot be loaded', async () => {
    await create('main');
    http.expectOne('/api/staff/dashboard').flush({ title: 'Nope' }, { status: 403, statusText: 'Forbidden' });
    analyticsCall().flush({ title: 'Nope' }, { status: 403, statusText: 'Forbidden' });
    await settle();
    expect(el.querySelectorAll('.alert-danger').length).toBe(2);
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
