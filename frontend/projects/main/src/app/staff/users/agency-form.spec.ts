import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { AgencyFormPage } from './agency-form';

describe('AgencyFormPage', () => {
  let fixture: ComponentFixture<AgencyFormPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function type(selector: string, value: string) {
    const input = el.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  }

  const options = {
    states: ['DELHI', 'GOA'],
    sectors: [{ sectorCode: '24', sectorName: 'Basic metals' }],
    orgPartners: [{ userId: 'OP2', name: 'Partner Two' }],
  };

  async function create(userId: string | null) {
    await TestBed.configureTestingModule({
      imports: [AgencyFormPage],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap(userId ? { userId } : {}) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AgencyFormPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
  }

  afterEach(() => http.verify());

  it('creates an agency and returns to the list with the message', async () => {
    await create(null);
    http.expectOne('/api/staff/users/agencies/options').flush(options);
    await settle();
    expect(el.querySelector('h3')!.textContent).toContain('Add Assessment Agency');
    expect(el.querySelector('#reasonForRejection')).toBeNull();
    expect([...el.querySelectorAll('#orgPartnerId option')].map((o) => o.textContent!.trim())).toEqual(['-- Select Orgnising Partner --', 'Partner Two - [OP2]']);

    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Please enter valid data.');

    await type('#userName', 'New Agency');
    await type('#spocName', 'Spoc');
    await type('#emailId', 'a@b.test');
    await type('#mobileNo', '9876543210');
    await type('#address', 'Addr');
    await type('#pinCode', '110001');
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Please select atleast one verification.');

    (el.querySelector('input[name=desktopVerification]') as HTMLInputElement).click();
    const goa = [...el.querySelectorAll('zed-multi-select label')].find((l) => l.textContent!.trim() === 'GOA')!;
    (goa.querySelector('input') as HTMLInputElement).click();
    await settle();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();

    const req = http.expectOne('/api/staff/users/agencies');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({ userName: 'New Agency', desktopVerification: true, states: ['GOA'], orgPartnerId: '' });
    expect(JSON.stringify(req.request.body)).not.toContain('roleId');
    req.flush({ message: 'User created successfully.', userId: 'ZEDAA0099' });
    await settle();
    expect(navigate).toHaveBeenCalledWith(['/staff/users/agencies'], { state: { message: 'User created successfully.' } });
  });

  it('loads an agency for update and only offers its own organising partner', async () => {
    await create('ZEDAA0001');
    http.expectOne('/api/staff/users/agencies/options').flush(options);
    await settle();
    http.expectOne('/api/staff/users/agencies/ZEDAA0001').flush({
      userId: 'ZEDAA0001', userName: 'Acme', spocName: 'S', emailId: 'a@b.test', mobileNo: '9876543210', address: 'A', pinCode: '110001',
      gstNumber: null, states: ['DELHI'], nicSectors: ['24'], orgPartnerId: 'OP1', orgPartnerName: 'Partner One', desktopVerification: true,
      siteVerification: false, financialVerification: false, reasonForRejection: 'Old reason', isActive: true,
    });
    await settle();
    expect(el.querySelector('h3')!.textContent).toContain('Update Assessment Agency Details');
    expect([...el.querySelectorAll('#orgPartnerId option')].map((o) => o.textContent!.trim())).toEqual(['-- Select Orgnising Partner --', 'Partner One']);
    expect((el.querySelector('#reasonForRejection') as HTMLTextAreaElement).value).toBe('Old reason');

    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    const req = http.expectOne('/api/staff/users/agencies/ZEDAA0001');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toMatchObject({ orgPartnerId: 'OP1', states: ['DELHI'], nicSectors: ['24'] });
    req.flush({ message: 'User updated successfully.' });
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('User updated successfully.');
  });
});
