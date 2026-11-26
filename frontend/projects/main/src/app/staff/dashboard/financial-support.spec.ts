import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthService } from '@zed/shared';
import { FinancialSupportPage } from './financial-support';
import { ADMIN_PORTAL, AdminPortalService } from '../admin-portal';

describe('FinancialSupportPage (2026-11-26)', () => {
  let fixture: ComponentFixture<FinancialSupportPage>;
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
      imports: [FinancialSupportPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    TestBed.inject(AuthService).setUser({ userId: 'D1', userName: 'Dashboard', roleId: 10, role: 'SuperAdmin', subRoles: [] });
    fixture = TestBed.createComponent(FinancialSupportPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne((r) => r.url === '/api/staff/dashboard/financial-support').flush([
      { Certification: 'Silver', PUnitName: 'Pump Engineers', ZedId: 'ZEDM000005', EnterpriseType: 'Micro', ZedIdStatus: 'Active', CertificationFee: 40000, Amount: 8000, FinancialSupport: 32000 },
      { Certification: 'Bronze', PUnitName: 'Old Unit', ZedId: 'ZEDM000002', ZedIdStatus: 'Rejected', CertificationFee: 10000, Amount: 0, FinancialSupport: 10000 },
      { Certification: 'FA', PUnitName: 'FA Unit', ZedId: 'ZEDM000003', ZedIdStatus: null, CertificationFee: null, Amount: null, FinancialSupport: 125000 },
    ]);
    await settle();
  });

  afterEach(() => http.verify());

  it('writes the amounts with Indian grouping, a dash where there is none, and marks a rejected unit', () => {
    const amounts = [...el.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td.amount')].map((c) => c.textContent!.trim()));
    expect(amounts).toEqual([['40,000', '8,000', '32,000'], ['10,000', '0', '10,000'], ['—', '—', '1,25,000']]);
    expect(el.querySelectorAll('tbody tr')[1].querySelector('.status-badge.is-danger')?.textContent?.trim()).toBe('Rejected');
    expect(el.querySelectorAll('tbody tr')[0].querySelector('.status-badge.is-info')).not.toBeNull();
  });
});

describe('FinancialSupportPage on Handholding (2026-11-26)', () => {
  it('asks main for the paid milestones and adds the state support column', async () => {
    await TestBed.configureTestingModule({
      imports: [FinancialSupportPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    TestBed.inject(AuthService).setUser({ userId: 'D1', userName: 'Dashboard', roleId: 10, role: 'SuperAdmin', subRoles: [] });
    TestBed.inject(AdminPortalService).select('consultancy');
    const fixture = TestBed.createComponent(FinancialSupportPage);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    await fixture.whenStable();
    const req = http.expectOne((r) => r.url === '/api/staff/dashboard/financial-support/handholding');
    expect(req.request.context.get(ADMIN_PORTAL)).toBe('main');
    req.flush([{ Certification: 'Silver', PUnitName: 'Pump Engineers', ZedId: 'ZEDM000005', ZedIdStatus: 'Milestone 1 - In Progress', CertificationFee: 80000, Amount: 8000, FinancialSupport: 72000, StateSupport: 0 }]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Handholding Fee');
    expect([...el.querySelectorAll('tbody td.amount')].map((c) => c.textContent!.trim())).toEqual(['80,000', '8,000', '72,000', '0']);
    http.verify();
    sessionStorage.removeItem('zed.adminPortal');
  });
});
