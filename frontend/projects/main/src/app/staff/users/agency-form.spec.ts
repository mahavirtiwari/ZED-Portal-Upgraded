import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { ToastService } from '../toast';
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

  async function create(userId: string | null, consultancy = false) {
    await TestBed.configureTestingModule({
      imports: [AgencyFormPage],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap(userId ? { userId } : {}) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AgencyFormPage);
    // The page reads the build's PORTAL_SYSTEM; the consultancy spec switches the instance before its first render.
    if (consultancy) (fixture.componentInstance as unknown as { consultancy: boolean }).consultancy = true;
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
  }

  afterEach(() => http.verify());

  it('creates an agency and returns to the list with the message', async () => {
    await create(null);
    http.expectOne('/api/staff/users/agencies/options').flush(options);
    await settle();
    expect(el.querySelector('h2')!.textContent).toContain('Add Assessment Agency');
    expect(el.querySelector('#reasonForRejection')).toBeNull();
    expect([...el.querySelectorAll('#orgPartnerId option')].map((o) => o.textContent!.trim())).toEqual(['-- Select Organising Partner --', 'Partner Two - [OP2]']);

    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Please enter valid data.');
    // The error is repeated in the save bar at the bottom of the window.
    expect(el.querySelector('.save-bar .save-error')!.textContent).toContain('Please enter valid data.');

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
    // V4: Manufacturing, Services or Both is required.
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Manufacturing, Services or Both');
    http.expectNone('/api/staff/users/agencies');
    ([...el.querySelectorAll('input[name=sectorActivity]')].find((i) => i.closest('label')!.querySelector('.choice-name')!.textContent!.trim() === 'Services') as HTMLInputElement).click();
    await settle();
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();

    const req = http.expectOne('/api/staff/users/agencies');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({ userName: 'New Agency', desktopVerification: true, states: ['GOA'], orgPartnerId: '', sectorActivity: 'Services' });
    expect(JSON.stringify(req.request.body)).not.toContain('roleId');
    req.flush({ message: 'User created successfully.', userId: 'ZEDAA0099' });
    await settle();
    expect(navigate).toHaveBeenCalledWith(['/staff/users/agencies'], { state: { message: 'User created successfully.' } });
  });

  it('consultancy: the old Category boxes, Handholding Support and Technology Intervention excluding each other', async () => {
    await create(null, true);
    http.expectOne('/api/staff/users/agencies/options').flush({ ...options, tuStates: [{ code: '09', name: 'UTTAR PRADESH' }] });
    await settle();
    expect(el.textContent).toContain('Category');
    expect(el.textContent).not.toContain('Activity Involved');
    expect(el.querySelector('input[name=desktopVerification]')).toBeNull();
    expect(el.querySelector('label[for="gstNumber"]')!.textContent).toContain('GST Number');
    const label = (name: string) => el.querySelector(`input[name=${name}]`)!.closest('label')!.querySelector('.choice-name')!.textContent!.trim();
    expect(label('siteVerification')).toBe('Handholding Support');
    expect(label('financialVerification')).toBe('Technology Intervention');

    const site = () => el.querySelector('input[name=siteVerification]') as HTMLInputElement;
    const tu = () => el.querySelector('input[name=financialVerification]') as HTMLInputElement;
    // Ticking one unticks and disables the other, as the old form's script.
    site().click();
    await settle();
    expect(site().checked).toBe(true);
    expect(tu().disabled).toBe(true);
    expect(el.querySelector('#tuPreferredState')).toBeNull();
    site().click();
    await settle();
    expect(tu().disabled).toBe(false);
    tu().click();
    await settle();
    expect(tu().checked).toBe(true);
    expect(site().disabled).toBe(true);
    expect(el.querySelector('#tuPreferredState')).not.toBeNull();
  });

  it('loads an agency for update and only offers its own organising partner', async () => {
    await create('ZEDAA0001');
    http.expectOne('/api/staff/users/agencies/options').flush(options);
    await settle();
    http.expectOne('/api/staff/users/agencies/ZEDAA0001').flush({
      userId: 'ZEDAA0001', userName: 'Acme', spocName: 'S', emailId: 'a@b.test', mobileNo: '9876543210', address: 'A', pinCode: '110001',
      gstNumber: null, states: ['DELHI'], nicSectors: ['24'], orgPartnerId: 'OP1', orgPartnerName: 'Partner One', desktopVerification: true,
      siteVerification: false, financialVerification: false, reasonForRejection: 'Old reason', isActive: true, sectorActivity: 'Both',
    });
    await settle();
    expect(el.querySelector('h2')!.textContent).toContain('Update Assessment Agency Details');
    expect([...el.querySelectorAll('#orgPartnerId option')].map((o) => o.textContent!.trim())).toEqual(['-- Select Organising Partner --', 'Partner One']);
    expect((el.querySelector('#reasonForRejection') as HTMLTextAreaElement).value).toBe('Old reason');
    expect(el.querySelector('.login-id')!.textContent).toContain('ZEDAA0001');
    expect(el.querySelector('.login-id .status-badge')!.textContent).toContain('Active');
    expect(el.querySelector('.save-bar')!.textContent).toContain('No changes.');
    const spoc = el.querySelector('#spocName') as HTMLInputElement;
    spoc.value = 'New Spoc';
    spoc.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(el.querySelector('.save-bar')!.classList).toContain('is-dirty');
    expect(el.querySelector('.save-bar')!.textContent).toContain('Not saved yet.');

    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    const req = http.expectOne('/api/staff/users/agencies/ZEDAA0001');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toMatchObject({ orgPartnerId: 'OP1', states: ['DELHI'], nicSectors: ['24'], sectorActivity: 'Both' });
    req.flush({ message: 'User updated successfully.' });
    await settle();
    expect(TestBed.inject(ToastService).toasts().at(-1)).toMatchObject({ tone: 'success', message: 'User updated successfully.' });
    expect(el.querySelector('.alert-success')).toBeNull();
    expect(el.querySelector('.save-bar')!.classList).not.toContain('is-dirty');
  });

  it('ticks each section as it becomes valid, checks the formats as you type and says what happens on submit (2026-11-17)', async () => {
    await create(null);
    http.expectOne('/api/staff/users/agencies/options').flush(options);
    await settle();
    const ticks = () => [...el.querySelectorAll('.af-step')].map((s) => s.classList.contains('done'));
    const bar = () => el.querySelector('.save-bar')!.textContent!;
    expect([...el.querySelectorAll('.af-step strong')].map((s) => s.textContent)).toEqual(['Agency', 'SPOC contact', 'Coverage']);
    expect(ticks()).toEqual([false, false, false]);
    expect(bar()).toContain('0 of 3 sections complete. Finish Agency to create the agency.');
    expect(el.querySelector('.af-rail')!.textContent).toContain('On submit');
    expect(el.querySelector('.af-rail')!.textContent).toContain('Levels are switched on in Agency Level Allocation.');
    expect(el.querySelector('#sec-login')).toBeNull();

    await type('#pinCode', '1100');
    expect(el.querySelector('#pinCode')!.parentElement!.textContent).toContain('Enter the 6 digit PIN code.');
    await type('#mobileNo', '98765');
    expect(el.querySelector('#mobileNo')!.parentElement!.textContent).toContain('Enter the 10 digit mobile number.');
    await type('#emailId', 'not-mail');
    expect(el.querySelector('#emailId')!.parentElement!.textContent).toContain('Enter a valid e-mail address.');
    await type('#gstNumber', 'GST-1');
    expect(el.querySelector('#gstNumber')!.parentElement!.textContent).toContain('Letters and digits only, up to 20.');

    await type('#userName', 'New Agency');
    await type('#address', 'Addr');
    await type('#pinCode', '110001');
    await type('#gstNumber', '');
    expect(ticks()).toEqual([true, false, false]);
    expect(bar()).toContain('1 of 3 sections complete. Finish SPOC contact to create the agency.');
    await type('#spocName', 'Spoc');
    await type('#emailId', 'a@b.test');
    // An invalid mobile keeps the section open and refuses the submit before the server.
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Please enter valid data.');
    http.expectNone('/api/staff/users/agencies');
    await type('#mobileNo', '9876543210');
    expect(ticks()).toEqual([true, true, false]);
    (el.querySelector('input[name=desktopVerification]') as HTMLInputElement).click();
    ([...el.querySelectorAll('input[name=sectorActivity]')].find((i) => i.closest('label')!.textContent!.trim() === 'Both') as HTMLInputElement).click();
    await settle();
    expect(ticks()).toEqual([true, true, true]);
    expect(bar()).toContain('Create agency');
  });
});
