import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StaffDashboardPage } from './staff-dashboard';
import { ClientPager } from './dashboard-filters';

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

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StaffDashboardPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(StaffDashboardPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
  });

  afterEach(() => http.verify());

  it('shows the certification cards and the filtered counts', async () => {
    await settle();
    http.expectOne('/api/staff/dashboard').flush({ BronzeTotal: 12, BronzePending: 3, SaGoldCompleted: 7, FaRejected: null });
    http.expectOne('/api/staff/dashboard/counts').flush({ total: 40000, bronze: 2000, silver: 1000, gold: 500 });
    await settle();

    expect(el.querySelector('[data-field="BronzeTotal"]')!.textContent).toBe('12');
    expect(el.querySelector('[data-field="SaGoldCompleted"]')!.textContent).toBe('7');
    expect(el.querySelector('[data-field="FaRejected"]')!.textContent).toBe('0');
    expect(el.querySelector('#registered')!.textContent).toBe('40,000');

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
    await settle();
    http.expectOne('/api/staff/dashboard').flush({ title: 'Nope' }, { status: 403, statusText: 'Forbidden' });
    http.expectOne('/api/staff/dashboard/counts').flush({ total: 0, bronze: 0, silver: 0, gold: 0 });
    await settle();
    expect(el.querySelector('.alert-danger')).toBeTruthy();
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
