import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '@zed/shared';
import { StaffDashboardPage } from './staff-dashboard';
import { ClientPager } from './dashboard-filters';
import { PortalSystem } from '../../portal-system';
import { STAFF_SYSTEM } from '../staff-menu';
import { TableExport } from '../table-export';
import { flattenSheets } from './dashboard-export';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The month n months before this one: yyyy-MM, "Sep" and "Sep 2026" (the trend always ends with this month, 2026-11-18). */
const monthsAgo = (n: number) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  const name = MONTH_NAMES[d.getMonth()];
  return { period: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, short: name, full: `${name} ${d.getFullYear()}` };
};
const M2 = monthsAgo(2);
const M1 = monthsAgo(1);

const analytics = (view: 'registered' | 'certified' = 'registered', more: object = {}) => ({
  view,
  totals: { registered: 724287, certified: 512808, bronze: 500112, silver: 7735, gold: 4961, zedx: 64 },
  sizes: [{ label: 'Micro', total: 666594 }, { label: 'Small', total: 50485 }, { label: 'Medium', total: 7207 }],
  genders: [{ label: 'male', total: 574614 }, { label: 'female', total: 141933 }, { label: 'OTHERS', total: 7739 }],
  socialCategories: [{ label: 'General', total: 378031 }, { label: 'OBC', total: 297002 }],
  months: [{ period: M2.period, registered: 53478, certified: 41020 }, { period: M1.period, registered: 8810, certified: 6120 }],
  years: [{ period: '2025', registered: 400000, certified: 300000 }, { period: '2026', registered: 8810, certified: 6120 }],
  states: [{ label: 'GUJARAT', total: 146518 }, { label: 'UTTAR PRADESH', total: 122101 }],
  districts: [{ label: 'SURAT', total: 57498 }],
  activities: [{ label: '13-Manufacture of textiles', total: 230213 }],
  districtOptions: [],
  boundState: null,
  generatedAt: '2026-10-27T10:00:00+05:30',
  statusCards: { BronzeTotal: 12, BronzePending: 3, SaGoldCompleted: 7, GoldRejected: null, ZedxTotal: 4, SaZedxPending: 1 },
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

  async function create(system?: PortalSystem, roleId?: number) {
    await TestBed.configureTestingModule({
      imports: [StaffDashboardPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), ...(system ? [{ provide: STAFF_SYSTEM, useValue: system }] : [])],
    }).compileComponents();
    if (roleId) TestBed.inject(AuthService).setUser({ userId: 'U1', userName: 'User', roleId, role: 'Role' });
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
    // 2026-11-17: the shared page head: Home > Dashboard, the Updated time under the title, the date basis, Refresh and Export.
    expect([...el.querySelectorAll('zed-page-head .ph-crumb a, zed-page-head .ph-crumb [aria-current]')].map(text)).toEqual(['Home', 'Dashboard']);
    expect(text(el.querySelector('zed-page-head .ph-title'))).toBe('Dashboard');
    // 2026-11-21 (UI audit C1): the landing page's title is its h1.
    expect(el.querySelector('zed-page-head h1.ph-title')).not.toBeNull();
    expect(text(el.querySelector('zed-page-head .ph-sub'))).toMatch(/^Updated 27-10-2026 \d\d:\d\d$/);
    expect([...el.querySelectorAll('zed-page-head .ph-actions .btn')].map(text)).toEqual(['Refresh', 'Export']);
    expect(el.querySelector('.an h4')).toBeNull();
    // No attention row for a login whose work the server does not count.
    expect(el.querySelector('zed-attention-row section')).toBeNull();
    (el.querySelector('zed-page-head .dash-refresh') as HTMLButtonElement).click();
    await settle();
    analyticsCall().flush(analytics());
    await settle();
    expect(el.querySelector('#registered')).toBeNull();
    expect([...el.querySelectorAll('.an-kpi')].map((k) => `${text(k.querySelector('.an-kpi-label'))}: ${text(k.querySelector('.an-kpi-value'))}`))
      .toEqual(['Registered units: 7,24,287', 'Certified units: 5,12,808', 'Bronze certified: 5,00,112', 'Silver certified: 7,735', 'Gold certified: 4,961', 'ZED-X certified: 64']);

    // The status cards (no Financial Assistance), after the filters and the totals.
    expect(text(el.querySelector('.an-status h5'))).toBe('Applications under your charge');
    expect(el.querySelector('.page-sub')).toBeNull();
    expect(el.querySelector('.an-status [data-field="BronzeTotal"]')!.textContent).toBe('12');
    expect(el.querySelector('[data-field="SaGoldCompleted"]')!.textContent).toBe('7');
    expect(el.querySelector('[data-field="GoldRejected"]')!.textContent).toBe('0');
    expect(el.querySelector('[data-field="FaRejected"]')).toBeNull();
    expect([...el.querySelectorAll('.an-status .app-level')].map(text)).toEqual(['Bronze', 'Silver', 'Gold', 'ZED-X']);
    expect(el.querySelector('.an-status [data-field="ZedxTotal"]')!.textContent).toBe('4');
    // Each status with its share of the level's applications in brackets (3 of 12 pending = 25%).
    const pending = el.querySelector('.an-status .app-card .app-stats li')!;
    expect([text(pending.querySelector('.app-label')), text(pending.querySelector('.app-value')), text(pending.querySelector('.app-share'))]).toEqual(['Assessment pending', '3', '(25%)']);
    expect(el.querySelector('.an-status .app-card .app-seg.is-pending')!.getAttribute('style')).toContain('width: 25%');
    // One stacked bar per level with its legend.
    expect(el.querySelectorAll('.an-status .app-card')[0].querySelectorAll('.app-bar').length).toBe(1);
    expect(text(el.querySelector('.an-status .app-total-label'))).toBe('total applications');
    const after = (x: string, y: string) => !!(el.querySelector(x)!.compareDocumentPosition(el.querySelector(y)!) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect([after('.an-filters', '.an-kpis'), after('.an-kpis', '.an-status'), after('.an-status', '.an-mid'), after('.an-mid', '.an-ranks')]).toEqual([true, true, true, true]);
    // Neither month of the range is this month: no "this month" figures.
    expect(el.querySelector('.an-kpi-note')).toBeNull();

    // The trend: registrations and certifications side by side on a value axis, by month or (Yearly) by year.
    const trend = el.querySelector('.an-trend')!;
    expect(text(trend.querySelector('h5'))).toBe('Monthly trend · last 12 months');
    // 2026-11-18: always the last 12 months, named by month ("Nov"), the months without figures as 0.
    const labels = [...trend.querySelectorAll('.gc-label')].map(text);
    expect(labels.length).toBe(12);
    expect(labels.slice(9)).toEqual([M2.short, M1.short, monthsAgo(0).short]);
    expect([...trend.querySelectorAll('.an-legend li')].map(text)).toEqual(['Registered', 'Certified']);
    expect([...trend.querySelectorAll('.gc-ticks span')].map(text)).toEqual(['0', '20,000', '40,000', '60,000', '80,000']);
    const groups = trend.querySelectorAll('.gc-group');
    expect(groups[9].getAttribute('aria-label')).toBe(`${M2.full}: Registered 53,478, Certified 41,020`);
    expect(groups[0].getAttribute('aria-label')).toBe(`${monthsAgo(11).full}: Registered 0, Certified 0`);
    (trend.querySelectorAll('.an-period button')[1] as HTMLButtonElement).click();
    await settle();
    expect(text(trend.querySelector('h5'))).toBe('Year-wise trend');
    expect([...trend.querySelectorAll('.gc-label')].map(text)).toEqual(['2025', '2026']);
    // Who is registering: size, gender and social category as three stacked bars with their shares.
    const who = el.querySelectorAll('.an-who zed-stacked-bar');
    expect([...who].map((b) => text(b.querySelector('.sb-head')))).toEqual(['MSME size', 'Gender', 'Social category']);
    expect([...who[1].querySelectorAll('.sb-legend li')].map(text)).toEqual(['Male 79%', 'Female 20%', 'Others 1%']);
    expect([...who[0].querySelectorAll('.sb-legend li')].map(text)).toEqual(['Micro 92%', 'Small 7%', 'Medium 1%']);
    // Gender, size and social category under More filters.
    expect((el.querySelector('#an-more') as HTMLElement).hidden).toBe(true);
    (el.querySelector('.an-more-btn button') as HTMLButtonElement).click();
    await settle();
    expect((el.querySelector('#an-more') as HTMLElement).hidden).toBe(false);
    expect([...(el.querySelector('#an-gender') as HTMLSelectElement).options].map((o) => o.textContent!.trim())).toEqual(['All', 'Male', 'Female', 'Others']);
    // 2026-11-16: Sector (Manufacturing / Services) under More filters too.
    expect([...(el.querySelector('#an-sector') as HTMLSelectElement).options].map((o) => o.textContent!.trim())).toEqual(['All', 'Manufacturing', 'Services']);
    const top = el.querySelector('.rk-list li')!;
    expect([text(top.querySelector('.rk-rank')), text(top.querySelector('.rk-label')), text(top.querySelector('.rk-value'))]).toEqual(['1', 'GUJARAT', '1,46,518']);
    // 2026-11-18: "13-Manufacture of textiles" as "13 Textiles" (staff-00).
    expect(text(el.querySelectorAll('.an-ranks zed-rank-list')[2].querySelector('.rk-label'))).toBe('13 Textiles');
    expect([...el.querySelectorAll('.an-ranks .rk-title')].map(text)).toEqual(['Top states', 'Top districts', 'Top sectors (two-digit activity)']);
    // Two states only: no View All (it opens the full list in the card; there is no separate page).
    expect(el.querySelector('.an-ranks .rk-more')).toBeNull();
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

    // The date basis as tabs.
    expect([...el.querySelectorAll('.an-basis-tab')].map(text)).toEqual(['By registration date', 'By certification date']);
    (el.querySelector('.an-basis-tab[data-view="certified"]') as HTMLButtonElement).click();
    await settle();
    const cert = analyticsCall();
    expect([cert.request.params.get('view'), cert.request.params.get('state'), cert.request.params.get('certification')]).toEqual(['certified', 'BIHAR', 'Silver']);
    cert.flush(analytics('certified'));
    await settle();

    await choose('#an-from', '2026-01-01');
    const dated = analyticsCall();
    expect([dated.request.params.get('view'), dated.request.params.get('from')]).toEqual(['certified', '2026-01-01']);
    dated.flush(analytics('certified'));
    await settle();

    // A From date after the To date is not sent: the message shows, the figures are hidden (audit item 4).
    await choose('#an-to', '2025-12-31');
    http.expectNone((r) => r.url.includes('/analytics'));
    expect(text(el.querySelector('#an-range-error'))).toBe('The From date must be on or before the To date.');
    expect(el.querySelector('#an-from')!.classList).toContain('is-invalid');
    expect(el.querySelector('.an-kpis')).toBeNull();
    // The chips show the dates as dd-MM-yyyy.
    expect([...el.querySelectorAll('.an-chip')].map(text).join(' | ')).toContain('From: 01-01-2026');

    // Clear All clears the filters and keeps the chosen date basis (audit item 4).
    (el.querySelector('.an-filters .dash-reset') as HTMLButtonElement).click();
    await settle();
    const cleared = analyticsCall();
    expect(cleared.request.params.keys()).toEqual(['view']);
    expect(cleared.request.params.get('view')).toBe('certified');
    cleared.flush(analytics('certified'));
    await settle();
    expect(el.querySelector('#an-range-error')).toBeNull();
    // 2026-11-18: Clear All is always there (staff-00), disabled with nothing to clear.
    expect((el.querySelector('.an-filters .dash-reset') as HTMLButtonElement).disabled).toBe(true);
    expect(text(el.querySelector('.an-filters .dash-reset'))).toBe('Clear All');
  });

  it('main portal: a state-bound Ministry user keeps the state fixed', async () => {
    await create('main');
    analyticsCall().flush(analytics('registered', { boundState: 'UTTAR PRADESH', districtOptions: ['AGRA'] }));
    await settle();
    const state = el.querySelector('#an-state') as HTMLSelectElement;
    expect(state.disabled).toBe(true);
    expect(state.value).toBe('UTTAR PRADESH');
  });

  it('main portal: the Sector filter (2026-11-16), fixed for a one-sector login', async () => {
    await create('main');
    analyticsCall().flush(analytics());
    await settle();
    await choose('#an-sector', 'Services');
    const services = analyticsCall();
    expect(services.request.params.get('sector')).toBe('Services');
    services.flush(analytics());
    await settle();
    expect([...el.querySelectorAll('.an-chip')].map(text)).toContain('Sector: Services ×');
    expect(text(el.querySelector('.an-more-btn button'))).toContain('More Filters (1)');

    // A login limited to Manufacturing: the filter shows Manufacturing and cannot be changed.
    await choose('#an-sector', '');
    analyticsCall().flush(analytics('registered', { boundSector: 'Manufacturing' }));
    await settle();
    const sector = el.querySelector('#an-sector') as HTMLSelectElement;
    expect(sector.disabled).toBe(true);
    expect(sector.value).toBe('Manufacturing');
    expect(el.querySelector('.an-chip button')).toBeNull();
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
    expect([...el.querySelectorAll('.an-basis-tab')].map(text)).toEqual(['By registration date', 'By surveillance completion date']);
    expect([...el.querySelectorAll('.an-trend .an-legend li')].map(text)).toEqual(['Registered', 'Surveillance completed']);
    expect([...el.querySelectorAll('.an-status .app-level')].map(text)).toEqual(['Bronze', 'Silver', 'Gold']);
    // Bronze surveillance has no NC Raised.
    const bronze = el.querySelector('.an-status .app-card')!;
    expect([...bronze.querySelectorAll('.app-label')].map(text)).toEqual(['Surveillance pending', 'Surveillance completed', 'Rejected']);
    expect(text(bronze.querySelector('.app-stats li .app-share'))).toBe('(40%)');
    expect(el.querySelector('[data-field="SaSilverNcRaised"]')!.textContent).toBe('1');
  });

  it('consultancy: handholding figures, Silver, Gold and ZED-X milestones and Technology Intervention', async () => {
    await create('consultancy');
    // The consultant tiles come from the summary (MasterAdmin only); the cards from the filtered figures.
    http.expectOne('/api/staff/dashboard').flush({ AssessmentAgencies: 4, SiteAssessors: 9, SilverTotal: 99 });
    analyticsCall().flush(analytics('registered', {
      totals: { registered: 300, certified: 12, bronze: 80, silver: 60, gold: 15, zedx: 5 },
      statusCards: { SilverTotal: 60, SilverM1PaymentDone: 45, SilverCompleted: 30, SaSilverCompleted: 12, GoldTotal: 15, ZEDXTotal: 5, ZEDXM1PaymentDone: 5, FaTotal: 8, FaCompleted: 2, FaPending: 6 },
    }));
    await settle();
    expect(el.querySelector('[data-field="AssessmentAgencies"]')!.textContent).toBe('4');
    expect([...el.querySelectorAll('.an-kpi')].map((k) => `${text(k.querySelector('.an-kpi-label'))}: ${text(k.querySelector('.an-kpi-value'))}`))
      .toEqual(['Registered units: 300', 'Handholding completed: 12', 'Applications: 80', 'Silver applications: 60', 'Gold applications: 15', 'ZED-X applications: 5']);
    expect([...(el.querySelector('#an-cert') as HTMLSelectElement).options].map((o) => o.textContent!.trim())).toEqual(['All', 'Silver', 'Gold', 'ZED-X']);
    expect([...el.querySelectorAll('.an-basis-tab')].map(text)).toEqual(['By registration date', 'By handholding completion date']);
    expect([...el.querySelectorAll('.an-status .app-level')].map(text)).toEqual(['Silver', 'Gold', 'ZED-X', 'Technology Intervention']);
    expect(el.querySelector('[data-field="ZEDXTotal"]')!.textContent).toBe('5');

    // The milestones: payments received and completed, each as a share of the level's applications.
    const silver = el.querySelector('.an-status .ms-card')!;
    expect(silver.querySelector('[data-field="SilverTotal"]')!.textContent).toBe('60');
    const m1 = silver.querySelector('.ms-list li')!;
    expect(text(m1.querySelector('.ms-no'))).toBe('Milestone 1');
    expect([...m1.querySelectorAll('.ms-figure')].map(text)).toEqual(['45(75%)', '30(50%)']);
    expect(silver.querySelectorAll('.ms-list li').length).toBe(3);
    expect(text(silver.querySelectorAll('.ms-list li')[2].querySelectorAll('.ms-figure')[1])).toBe('12(20%)');
    const ti = el.querySelectorAll('.an-status .app-card')[3];
    expect([...ti.querySelectorAll('.app-label')].map(text)).toEqual(['Approved', 'Pending']);
    expect(text(ti.querySelector('.app-stats li .app-share'))).toBe('(25%)');

    await choose('#an-cert', 'Gold');
    const gold = analyticsCall();
    expect(gold.request.params.get('certification')).toBe('Gold');
    gold.flush(analytics());
    await settle();
  });

  it('main portal: the top five of each ranking, View all with the sort', async () => {
    await create('main');
    const states = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((s, i) => ({ label: `STATE ${s}`, total: 100 - i * 10 }));
    analyticsCall().flush(analytics('registered', { states }));
    await settle();
    const list = el.querySelector('.an-ranks zed-rank-list')!;
    const rows = () => [...list.querySelectorAll('.rk-list li')].map((li) => `${text(li.querySelector('.rk-rank'))} ${text(li.querySelector('.rk-label'))}`);
    expect(rows()).toEqual(['1 STATE A', '2 STATE B', '3 STATE C', '4 STATE D', '5 STATE E']);
    expect(list.querySelector('.rk-sort')).toBeNull();
    (list.querySelector('.rk-more') as HTMLButtonElement).click();
    await settle();
    expect(rows().length).toBe(7);
    // Every row, sortable by count or name; the rank stays the rank by count.
    const sortBy = async (v: string) => {
      const select = list.querySelector('.rk-sort select') as HTMLSelectElement;
      select.value = v;
      select.dispatchEvent(new Event('change'));
      await settle();
    };
    await sortBy('low');
    expect(rows()[0]).toBe('7 STATE G');
    await sortBy('name');
    expect(rows()[0]).toBe('1 STATE A');
    expect(text(list.querySelector('.rk-more'))).toBe('Show Top 5');
  });

  it("main portal: this month's registrations and certifications on the first two tiles when the range reaches this month", async () => {
    await create('main');
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    analyticsCall().flush(analytics('registered', { months: [{ period: '2025-01', registered: 10, certified: 5 }, { period, registered: 1312, certified: 1042 }] }));
    await settle();
    const tiles = el.querySelectorAll('.an-kpi');
    // 2026-11-18: green, right on the label line; 2026-11-21 (audit item 4): "this month" on both tiles.
    expect(text(tiles[0].querySelector('.an-kpi-note'))).toBe('+1,312 this month');
    expect(text(tiles[1].querySelector('.an-kpi-note'))).toBe('+1,042 this month');
    expect(tiles[1].querySelector('.an-kpi-note')!.getAttribute('title')).toBe('+1,042 this month');
    expect(tiles[2].querySelector('.an-kpi-note')).toBeNull();
  });

  it('Needs your attention: the work waiting for a Master Admin, each a link to its page; Refresh counts again', async () => {
    await create('main', 7);
    analyticsCall().flush(analytics());
    http.expectOne('/api/staff/attention').flush({
      total: 29, items: [
        { key: 'allot', label: 'Units awaiting allotment', count: 18, link: '/staff/assessment/allot', query: null, tone: 'warn', icon: 'people' },
        { key: 'reallot', label: 'Rejected, to re-allot', count: 4, link: '/staff/assessment/allot', query: { type: 'REALLOT' }, tone: 'warn', icon: 'refresh' },
        { key: 'nc-overdue', label: 'NC closures overdue', count: 7, link: '/staff/monitoring', query: { tab: 'nc' }, tone: 'bad', icon: 'clock' },
        { key: 'quality-open', label: 'Quality observations open', count: 0, link: '/staff/quality-observations', query: null, tone: 'info', icon: 'chat' },
      ],
    });
    await settle();
    const row = el.querySelector('zed-attention-row section')!;
    expect(text(row.querySelector('h2'))).toBe('Needs your attention');
    const items = [...row.querySelectorAll('a.at-item')];
    // 2026-11-18: staff-00's order (re-allotment last); a count of 0 keeps its colours.
    expect(items.map((a) => text(a))).toEqual(['18Units awaiting allotment', '7NC closures overdue', '0Quality observations open', '4Rejected, to re-allot']);
    expect(items[1].getAttribute('href')).toBe('/staff/monitoring?tab=nc');
    expect(items[2].classList.contains('is-zero')).toBe(true);
    // Between the headline tiles and the level cards, and never in an export.
    expect(!!(el.querySelector('.an-kpis')!.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(!!(row.compareDocumentPosition(el.querySelector('.an-status')!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(row.classList.contains('no-export')).toBe(true);

    (el.querySelector('.dash-refresh') as HTMLButtonElement).click();
    await settle();
    analyticsCall().flush(analytics());
    const again = http.expectOne((r) => r.url === '/api/staff/attention');
    expect(again.request.params.get('fresh')).toBe('true');
    again.flush({ total: 0, items: [] });
    await settle();
    expect(el.querySelector('zed-attention-row section')).toBeNull();
  });

  it('Export: a pop-up with the filters, the sections and the format; Excel sends the loaded figures, CSV one table', async () => {
    await create('main');
    analyticsCall().flush(analytics());
    await settle();
    await choose('#an-state', 'GUJARAT');
    analyticsCall().flush(analytics());
    await settle();

    (el.querySelector('.dash-export-btn') as HTMLButtonElement).click();
    await settle();
    const dialog = el.querySelector('zed-dashboard-export [role="dialog"]')!;
    expect(text(dialog.querySelector('h2'))).toBe('Export dashboard');
    expect([...dialog.querySelectorAll('.xd-chips li')].map(text)).toEqual(['By registration date', 'State: GUJARAT', 'Certification: All']);
    expect([...dialog.querySelectorAll('.xd-check')].map(text))
      .toEqual(['Headline numbers', 'Applications by level', 'Monthly and yearly trend', 'MSME size, gender and social category', 'State, district and sector tables']);
    expect([...dialog.querySelectorAll('.xd-check input')].every((c) => (c as HTMLInputElement).checked)).toBe(true);
    expect([...dialog.querySelectorAll('.xd-formats button')].map(text)).toEqual(['Excel (.xlsx)', 'CSV', 'PDF']);

    // Excel without the rankings: the filters, then the chosen sections, built from what the page loaded.
    (dialog.querySelector('[data-section="tables"]') as HTMLInputElement).click();
    await settle();
    (dialog.querySelector('.xd-go') as HTMLButtonElement).click();
    await settle();
    const post = http.expectOne('/api/staff/export/xlsx');
    const body = post.request.body as { fileName: string; sheets: { name: string; columns: string[]; rows: unknown[][] }[] };
    expect(body.fileName).toMatch(/^ZED-Dashboard-\d{12}$/);
    expect(body.sheets.map((s) => s.name)).toEqual(['Filters', 'Headline numbers', 'Applications by level', 'Monthly trend', 'Yearly trend', 'Who is registering']);
    expect(body.sheets[0].rows.slice(0, 2)).toEqual([['Count by', 'By registration date'], ['State', 'GUJARAT']]);
    expect(body.sheets[1].rows[0]).toEqual(['Registered units', 724287, null]);
    expect(body.sheets[2].rows.slice(0, 2)).toEqual([['Bronze', 'Total applications', 12, null], ['Bronze', 'Assessment pending', 3, 25]]);
    expect(body.sheets[3].rows[0]).toEqual([M2.full, 53478, 41020]);
    expect(body.sheets[5].rows[0]).toEqual(['MSME size', 'Micro', 666594, 92]);
    const saved = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    const url = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: url, revokeObjectURL: vi.fn() });
    post.flush(new Blob(['xlsx']));
    await settle();
    expect(url).toHaveBeenCalled();
    expect(el.querySelector('zed-dashboard-export')).toBeNull();

    // CSV: the same sheets as one table, one line per figure.
    const csv = vi.spyOn(TestBed.inject(TableExport), 'csv').mockImplementation(() => undefined);
    (el.querySelector('.dash-export-btn') as HTMLButtonElement).click();
    await settle();
    (el.querySelector('[data-format="csv"]') as HTMLButtonElement).click();
    await settle();
    (el.querySelector('.xd-go') as HTMLButtonElement).click();
    await settle();
    expect(csv).toHaveBeenCalledTimes(1);
    const sheet = csv.mock.calls[0][1];
    expect(sheet.columns).toEqual(['Section', 'Item', 'Figure', 'Value']);
    expect(sheet.rows).toContainEqual(['Applications by level', 'Bronze · Assessment pending', 'Share of the level (%)', 25]);
    expect(sheet.rows).toContainEqual(['States', '1 · GUJARAT', 'Registered units', 146518]);
    Object.assign(URL, { createObjectURL: saved.create, revokeObjectURL: saved.revoke });
  });

  it('flattenSheets: one line per figure, empty figures left out', () => {
    const t = flattenSheets('X', [{ name: 'Headline numbers', keys: 1, columns: ['Figure', 'Count', 'This month'], rows: [['Registered units', 5, null]] }]);
    expect(t.rows).toEqual([['Headline numbers', 'Registered units', 'Count', 5]]);
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
