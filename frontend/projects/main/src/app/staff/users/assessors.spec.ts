import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { AuthService } from '@zed/shared';
import { StaffRole } from '../staff-menu';
import { AssessorFormPage } from './assessor-form';
import { AssessorListPage } from './assessor-list';
import { MyAssessorsPage } from './my-assessors';
import { OwnAssessorRow } from './users.api';

async function settle(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

function signIn(roleId: number) {
  TestBed.inject(AuthService).setUser({ userId: roleId === StaffRole.Agency ? 'AGENCY1' : 'MASTER1', userName: 'Acme', roleId, role: 'x', subRoles: [] });
}

const options = {
  states: ['DELHI', 'MAHARASHTRA'],
  sectors: [{ sectorCode: '24', sectorName: 'Basic metals' }],
  areasOfKnowledge: ['Quality'],
};

describe('AssessorFormPage', () => {
  let fixture: ComponentFixture<AssessorFormPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function type(selector: string, value: string) {
    const input = el.querySelector(selector) as HTMLInputElement | HTMLSelectElement;
    input.value = value;
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input'));
    await settle(fixture);
  }

  async function create(roleId: number, userId: string | null) {
    await TestBed.configureTestingModule({
      imports: [AssessorFormPage],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap(userId ? { userId } : {}) } } },
      ],
    }).compileComponents();
    signIn(roleId);
    fixture = TestBed.createComponent(AssessorFormPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle(fixture);
  }

  afterEach(() => http.verify());

  it('requires the professional lookup before creating and sends no identity fields', async () => {
    await create(StaffRole.Agency, null);
    http.expectOne('/api/staff/users/assessors/options').flush(options);
    await settle(fixture);
    const createButton = [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Create') as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);

    await type('#assessorType', 'BronzeAssessor');
    await type('#certificateNo', 'BA1234');
    await type('#professionalEmail', 'pro@zed.test');
    ([...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'SEARCH') as HTMLButtonElement).click();
    await settle(fixture);
    const lookup = http.expectOne('/api/staff/users/assessors/lookup');
    expect(lookup.request.body).toEqual({ assessorType: 'BronzeAssessor', certificateNo: 'BA1234', email: 'pro@zed.test' });
    lookup.flush({ name: 'Real Pro', email: 'pro@zed.test', mobileNo: '9111111111', address: '12 Main Rd', pinCode: '411001', selfieUrl: 'https://training.zed.org.in/p/1.jpg' });
    await settle(fixture);
    expect((el.querySelector('#userName') as HTMLInputElement).value).toBe('Real Pro');
    expect((el.querySelector('#userName') as HTMLInputElement).readOnly).toBe(true);
    expect((el.querySelector('#selfieimg') as HTMLImageElement).src).toBe('https://training.zed.org.in/p/1.jpg');
    expect(createButton.disabled).toBe(false);

    // Changing the certificate number invalidates the lookup.
    await type('#certificateNo', 'BA9999');
    expect(createButton.disabled).toBe(true);
    await type('#certificateNo', 'BA1234');

    await type('#idProofType', 'PAN Card');
    await type('#idProofNumber', 'ABCDE1234F');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    const req = http.expectOne('/api/staff/users/assessors');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({ assessorType: 'BronzeAssessor', certificateNo: 'BA1234', professionalEmail: 'pro@zed.test', address: '12 Main Rd', idProofNumber: 'ABCDE1234F' });
    expect(Object.keys(req.request.body)).not.toEqual(expect.arrayContaining(['userName']));
    expect(Object.keys(req.request.body)).not.toContain('emailId');
    req.flush({ message: 'User created successfully.', userId: 'ZEDBA0001' });
    await settle(fixture);
    expect(navigate).toHaveBeenCalledWith(['/staff/users/my-assessors'], { state: { message: 'User created successfully.' } });
  });

  it('shows an assessor read-only to the MasterAdmin', async () => {
    await create(StaffRole.MasterAdmin, 'ZEDAS0001');
    http.expectOne('/api/staff/users/assessors/options').flush(options);
    await settle(fixture);
    http.expectOne('/api/staff/users/assessors/ZEDAS0001').flush({
      userId: 'ZEDAS0001', userName: 'Asha', emailId: 'a@z.test', mobileNo: '9000000001', address: 'Street', pinCode: '560001',
      assessorType: 'Assessor', certificateNo: 'AS1', idProofType: 'Aadhaar Card', idProofNumberMasked: 'XXXXXXXX9012', states: ['DELHI'],
      nicSectors: [], areasOfKnowledge: [], reasonForRejection: null, isActive: true, agencyUserId: 'AGENCY1', canEdit: false,
    });
    await settle(fixture);
    expect(el.querySelector('h3')!.textContent).toContain('Assessor Details');
    expect((el.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
    expect([...el.querySelectorAll('button')].some((b) => ['Create', 'Update'].includes(b.textContent!.trim()))).toBe(false);
    expect((el.querySelector('#idProofNumber') as HTMLInputElement).placeholder).toBe('XXXXXXXX9012');
    expect(el.querySelector('a.btn-back')!.getAttribute('href')).toBe('/staff/users/assessors');
  });
});

describe('MyAssessorsPage', () => {
  let fixture: ComponentFixture<MyAssessorsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  const row = (id: string, extra: Partial<OwnAssessorRow> = {}): OwnAssessorRow => ({
    Id: 1, UserId: id, UserName: `${id} name`, Address: 'Addr', MobileNo: '9000000001', Email: 'x@z.test', IdStatus: 'Active', IsActive: true,
    AssessorType: 'BronzeAssessor', IsCertAttached: 0, IdProofNumber: 'XXXXXXXX9012', PhotoPath: null, ...extra,
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MyAssessorsPage], providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] }).compileComponents();
    fixture = TestBed.createComponent(MyAssessorsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle(fixture);
  });

  afterEach(() => http.verify());

  it('hides UnBlock while the certificate is attached elsewhere and validates the mobile number', async () => {
    http.expectOne('/api/staff/users/assessors/mine').flush([
      row('ZEDBA0001', { IsActive: false, IsCertAttached: 1 }),
      row('ZEDBA0002', { IsActive: false }),
    ]);
    await settle(fixture);
    const rows = el.querySelectorAll('tbody tr');
    expect(rows[0].textContent).not.toContain('UnBlock');
    expect(rows[1].textContent).toContain('UnBlock');
    expect(rows[0].textContent).toContain('XXXXXXXX9012');

    ([...rows[0].querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Mobile No') as HTMLButtonElement).click();
    await settle(fixture);
    const input = el.querySelector('#assessor-mobile') as HTMLInputElement;
    input.value = '12345';
    input.dispatchEvent(new Event('input'));
    await settle(fixture);
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(el.querySelector('.modal .help-block')!.textContent).toContain('10 digit');
    http.expectNone('/api/staff/users/assessors/ZEDBA0001/mobile');

    input.value = '9123456780';
    input.dispatchEvent(new Event('input'));
    await settle(fixture);
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    const req = http.expectOne('/api/staff/users/assessors/ZEDBA0001/mobile');
    expect(req.request.body).toEqual({ mobileNo: '9123456780' });
    req.flush({ message: 'Mobile No updated successful' });
    await settle(fixture);
    http.expectOne('/api/staff/users/assessors/mine').flush([]);
  });
});

describe('AssessorListPage', () => {
  it('passes the agency and type filters and pages the result', async () => {
    await TestBed.configureTestingModule({
      imports: [AssessorListPage],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ agencyId: 'ZEDAA0001', type: 'DA' }) } } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AssessorListPage);
    const http = TestBed.inject(HttpTestingController);
    await settle(fixture);
    const req = http.expectOne((r) => r.url === '/api/staff/users/assessors');
    expect(req.request.params.get('agencyId')).toBe('ZEDAA0001');
    expect(req.request.params.get('type')).toBe('DA');
    req.flush(Array.from({ length: 25 }, (_, i) => ({ RowNumber: i + 1, Id: i, UserId: `ZEDAS${i}`, UserName: `A${i}`, IsActive: true })));
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('tbody tr').length).toBe(20);
    ([...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Next') as HTMLButtonElement).click();
    await settle(fixture);
    expect(el.querySelectorAll('tbody tr').length).toBe(5);
    http.verify();
  });
});
