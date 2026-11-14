import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { AuthService } from '@zed/shared';
import { STAFF_SYSTEM, StaffRole } from '../staff-menu';
import { AssessorFormPage } from './assessor-form';
import { AssessorListPage } from './assessor-list';
import { MyAssessorsPage } from './my-assessors';
import { AssessorRow, OwnAssessorRow } from './users.api';

async function settle(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

function signIn(roleId: number, subRoles: string[] = []) {
  TestBed.inject(AuthService).setUser({ userId: roleId === StaffRole.Agency ? 'AGENCY1' : 'MASTER1', userName: 'Acme', roleId, role: 'x', subRoles });
}

/** The page reads the build's PORTAL_SYSTEM; the consultancy specs switch the instance before its first render. */
function asConsultancy(page: unknown) {
  (page as { consultancy: boolean }).consultancy = true;
}

const options = {
  states: ['DELHI', 'MAHARASHTRA'],
  sectors: [{ sectorCode: '24', sectorName: 'Basic metals' }],
  areasOfKnowledge: ['Quality'],
  // The training portal's lookup (Admin -> Settings -> Professional Verification); the other modes have their own specs.
  verification: { mode: 'TrainingPortal', needsPan: false },
};
const withMode = (mode: string) => ({ ...options, verification: { mode, needsPan: mode !== 'TrainingPortal' } });

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

  /** Clicks the choice chip (radio) of a group by its label. */
  async function pick(name: string, label: string) {
    ([...el.querySelectorAll(`input[name=${name}]`)].find((i) => i.closest('label')!.textContent!.trim() === label) as HTMLInputElement).click();
    await settle(fixture);
  }

  const saveNote = () => el.querySelector('.save-bar span')!.textContent!.trim();

  async function create(roleId: number, userId: string | null, consultancy = false, subRoles: string[] = []) {
    await TestBed.configureTestingModule({
      imports: [AssessorFormPage],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap(userId ? { userId } : {}) } } },
      ],
    }).compileComponents();
    signIn(roleId, subRoles);
    fixture = TestBed.createComponent(AssessorFormPage);
    if (consultancy) asConsultancy(fixture.componentInstance);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle(fixture);
  }

  afterEach(() => http.verify());

  it('requires the professional lookup before creating and sends no identity fields', async () => {
    await create(StaffRole.Agency, null);
    http.expectOne('/api/staff/users/assessors/options').flush(options);
    await settle(fixture);
    // The agency assesses Manufacturing only: its assessors cannot be Services.
    http.expectOne('/api/staff/users/assessors/agency-sector-activity').flush({ message: 'Manufacturing' });
    await settle(fixture);
    expect(([...el.querySelectorAll('input[name=sectorActivity]')].find((i) => i.closest('label')!.textContent!.trim() === 'Services') as HTMLInputElement).disabled).toBe(true);
    expect(el.textContent).toContain('Your agency assesses Manufacturing only.');
    const createButton = [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Create') as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
    expect(saveNote()).toBe('Search the certified professional to continue.');

    await pick('assessorType', 'Bronze Assessor');
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
    expect(el.querySelector('.af-found')!.textContent).toContain('Real Pro found.');
    expect(saveNote()).not.toBe('Search the certified professional to continue.');

    // Changing the certificate number invalidates the lookup.
    await type('#certificateNo', 'BA9999');
    expect(createButton.disabled).toBe(true);
    await type('#certificateNo', 'BA1234');

    await pick('idProofType', 'PAN Card');
    await type('#idProofNumber', 'ABCDE1234F');
    ([...el.querySelectorAll('input[name=sectorActivity]')].find((i) => i.closest('label')!.textContent!.trim() === 'Manufacturing') as HTMLInputElement).click();
    await settle(fixture);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(el.querySelector('.alert-danger')?.textContent ?? '').toBe('');
    const req = http.expectOne('/api/staff/users/assessors');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({
      assessorType: 'BronzeAssessor', certificateNo: 'BA1234', professionalEmail: 'pro@zed.test', address: '12 Main Rd', idProofNumber: 'ABCDE1234F',
      sectorActivity: 'Manufacturing',
    });
    expect(Object.keys(req.request.body)).not.toEqual(expect.arrayContaining(['userName']));
    expect(Object.keys(req.request.body)).not.toContain('emailId');
    req.flush({ message: 'User created successfully.', userId: 'ZEDBA0001' });
    await settle(fixture);
    expect(navigate).toHaveBeenCalledWith(['/staff/users/my-assessors'], { state: { message: 'User created successfully.' } });
  });

  it('one kind of assessor: the agency ticks the levels and modes instead of a type (2026-11-14)', async () => {
    await create(StaffRole.Agency, null);
    http.expectOne('/api/staff/users/assessors/options').flush({
      ...withMode('Off'),
      levels: [{ code: 'Bronze', name: 'Bronze', modes: ['Desktop'] }, { code: 'Silver', name: 'Silver', modes: ['Desktop', 'Onsite'] }],
    });
    await settle(fixture);
    http.expectOne('/api/staff/users/assessors/agency-sector-activity').flush({ message: 'Both' });
    await settle(fixture);
    // No Bronze Assessor / Assessor choice; a mode the level does not use cannot be ticked.
    expect(el.querySelector('input[name=assessorType]')).toBeNull();
    expect(el.querySelector('[data-scope="Bronze:Onsite"]')).toBeNull();
    expect(el.querySelector('.af-scope-table tbody tr td:nth-child(4)')!.textContent!.trim()).toBe('not used');
    // Bronze at the desktop only: a Bronze Assessor for the lookup; the certificate fields open.
    (el.querySelector('[data-scope="Bronze:Desktop"]') as HTMLInputElement).click();
    await settle(fixture);
    expect(el.querySelector('#certificateNo')).not.toBeNull();
    (el.querySelector('[data-scope="Silver:Onsite"]') as HTMLInputElement).click();
    await settle(fixture);
    await type('#certificateNo', 'AS1234');
    await type('#pan', 'ABCDE1234F');
    await type('#userName', 'Typed Pro');
    await type('#emailId', 'typed@zed.test');
    await type('#mobileNo', '9222222222');
    await type('#address', 'Street 1');
    await type('#pinCode', '411001');
    await pick('idProofType', 'Aadhaar Card');
    await type('#idProofNumber', '123412341234');
    await pick('sectorActivity', 'Both');
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    const req = http.expectOne('/api/staff/users/assessors');
    expect(req.request.body).toMatchObject({
      assessorType: 'Assessor',
      assessments: [{ level: 'Bronze', modes: ['Desktop'] }, { level: 'Silver', modes: ['Onsite'] }],
    });
    req.flush({ message: 'User created successfully.', userId: 'ZEDAS0099' });
    await settle(fixture);
  });

  it('verification off: the agency types the certificate, PAN, name, e-mail and mobile, without SEARCH', async () => {
    await create(StaffRole.Agency, null);
    http.expectOne('/api/staff/users/assessors/options').flush(withMode('Off'));
    await settle(fixture);
    http.expectOne('/api/staff/users/assessors/agency-sector-activity').flush({ message: 'Both' });
    await settle(fixture);
    await pick('assessorType', 'Assessor');
    expect(el.querySelector('.alert-warning')!.textContent!.trim()).toBe("Verification is off: enter the assessor's details as on the certificate.");
    expect([...el.querySelectorAll('button')].some((b) => b.textContent!.trim() === 'SEARCH')).toBe(false);
    expect(el.querySelector('#professionalEmail')).toBeNull();
    expect((el.querySelector('#userName') as HTMLInputElement).readOnly).toBe(false);
    expect(el.querySelector('label[for="pan"]')!.textContent).toContain('PAN Number*');
    const createButton = [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Create') as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
    expect(saveNote()).not.toBe('Search the certified professional to continue.');

    await type('#certificateNo', 'AS1234');
    await type('#pan', 'abcde1234f');
    expect((el.querySelector('#pan') as HTMLInputElement).value).toBe('ABCDE1234F');
    await type('#userName', 'Typed Pro');
    await type('#emailId', 'typed@zed.test');
    await type('#mobileNo', '12345');
    expect(createButton.disabled).toBe(true);
    await type('#mobileNo', '9222222222');
    expect(createButton.disabled).toBe(false);
    await type('#address', 'Street 1');
    await type('#pinCode', '411001');
    await pick('idProofType', 'Aadhaar Card');
    await type('#idProofNumber', '123412341234');
    await pick('sectorActivity', 'Both');
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(el.querySelector('.alert-danger')?.textContent ?? '').toBe('');
    const req = http.expectOne('/api/staff/users/assessors');
    expect(req.request.body).toMatchObject({
      assessorType: 'Assessor', certificateNo: 'AS1234', pan: 'ABCDE1234F', userName: 'Typed Pro', emailId: 'typed@zed.test', mobileNo: '9222222222',
    });
    http.expectNone('/api/staff/users/assessors/lookup');
    req.flush({ message: 'User created successfully.', userId: 'ZEDAS0099' });
    await settle(fixture);
  });

  it('api mode: SEARCH by certificate number and PAN, then the details are locked', async () => {
    await create(StaffRole.Agency, null);
    http.expectOne('/api/staff/users/assessors/options').flush(withMode('Api'));
    await settle(fixture);
    http.expectOne('/api/staff/users/assessors/agency-sector-activity').flush({ message: 'Both' });
    await settle(fixture);
    await pick('assessorType', 'Bronze Assessor');
    expect(el.querySelector('.alert-warning')).toBeNull();
    expect(el.querySelector('#professionalEmail')).toBeNull();
    expect(saveNote()).toBe('Search the certified professional to continue.');
    await type('#certificateNo', 'BA1234');
    await type('#pan', 'ABCDE123');
    const search = () => ([...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'SEARCH') as HTMLButtonElement).click();
    search();
    await settle(fixture);
    expect(el.querySelector('.alert-danger')!.textContent).toContain('a valid PAN');
    http.expectNone('/api/staff/users/assessors/lookup');
    await type('#pan', 'abcde1234f');
    search();
    await settle(fixture);
    const lookup = http.expectOne('/api/staff/users/assessors/lookup');
    expect(lookup.request.body).toEqual({ assessorType: 'BronzeAssessor', certificateNo: 'BA1234', pan: 'ABCDE1234F' });
    lookup.flush({ name: 'Api Pro', email: 'api@zed.test', mobileNo: '9333333333', address: null, pinCode: null, selfieUrl: null });
    await settle(fixture);
    expect((el.querySelector('#userName') as HTMLInputElement).value).toBe('Api Pro');
    expect((el.querySelector('#userName') as HTMLInputElement).readOnly).toBe(true);
    expect(el.querySelector('.af-found')!.textContent).toContain('come from the other portal');
    const createButton = [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Create') as HTMLButtonElement;
    expect(createButton.disabled).toBe(false);
    // Another PAN needs a new SEARCH.
    await type('#pan', 'ABCDE1234G');
    expect(createButton.disabled).toBe(true);
    await type('#pan', 'ABCDE1234F');
    await type('#address', 'Street 1');
    await type('#pinCode', '411001');
    await pick('idProofType', 'Aadhaar Card');
    await type('#idProofNumber', '123412341234');
    await pick('sectorActivity', 'Both');
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    const req = http.expectOne('/api/staff/users/assessors');
    expect(req.request.body).toMatchObject({ certificateNo: 'BA1234', pan: 'ABCDE1234F' });
    expect(Object.keys(req.request.body)).not.toContain('userName');
    req.flush({ message: 'User created successfully.', userId: 'ZEDBA0099' });
    await settle(fixture);
  });

  it('consultancy, verification off: the consultant/expert is typed in too; a technical expert has no PAN', async () => {
    await create(StaffRole.Agency, null, true, ['SiteVerification']);
    http.expectOne('/api/staff/users/assessors/options').flush(withMode('Off'));
    await settle(fixture);
    await pick('assessorType', 'Consultant/Expert');
    expect(el.querySelector('.alert-warning')!.textContent).toContain("enter the consultant/expert's details as on the certificate.");
    expect(el.querySelector('#pan')).not.toBeNull();
    await pick('assessorType', 'Technical Expert');
    expect(el.querySelector('.alert-warning')).toBeNull();
    expect(el.querySelector('#pan')).toBeNull();
    expect(el.querySelector('#certificateNo')).toBeNull();
  });

  it('consultancy: names the Consultant/Expert and offers Technical Expert and the states only with SiteVerification', async () => {
    await create(StaffRole.Agency, null, true, ['SiteVerification']);
    http.expectOne('/api/staff/users/assessors/options').flush(options);
    await settle(fixture);
    expect(el.querySelector('h3')!.textContent).toContain('Add Consultant/Expert');
    expect(el.querySelector('#assessorType-label')!.textContent).toContain('Consultant/Expert');
    expect([...el.querySelectorAll('input[name=assessorType]')].map((i) => i.closest('label')!.textContent!.trim())).toEqual(['Consultant/Expert', 'Technical Expert']);
    expect(el.querySelector('label[for="userName"]')!.textContent).toContain('Consultant/Expert Name');
    expect(el.textContent).toContain('Applicable States');
  });

  it('consultancy: a CO without SiteVerification adds Consultant/Experts only, without states', async () => {
    await create(StaffRole.Agency, null, true, ['FinancialVerification']);
    http.expectOne('/api/staff/users/assessors/options').flush(options);
    await settle(fixture);
    expect([...el.querySelectorAll('input[name=assessorType]')].map((i) => i.closest('label')!.textContent!.trim())).toEqual(['Consultant/Expert']);
    expect(el.textContent).not.toContain('Applicable States');
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
    // The registered mobile card (assessor-mobile.spec.ts) loads below the form.
    http.expectOne('/api/staff/assessor-mobile/ZEDAS0001').flush({ userId: 'ZEDAS0001', device: null, signIns: [] });
    await settle(fixture);
    expect(el.querySelector('h3')!.textContent).toContain('Assessor Details');
    expect((el.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
    expect([...el.querySelectorAll('button')].some((b) => ['Create', 'Update'].includes(b.textContent!.trim()))).toBe(false);
    expect((el.querySelector('#idProofNumber') as HTMLInputElement).placeholder).toBe('XXXXXXXX9012');
    expect(el.querySelector('.page-actions a')!.getAttribute('href')).toBe('/staff/users/assessors');
    // The profile card, the chosen ID proof chip and no save bar.
    const profile = el.querySelector('.af-profile')!.textContent!;
    expect(profile).toContain('Asha');
    expect(profile).toContain('Certificate AS1');
    expect(profile).toContain('Active');
    expect(el.querySelector('.page-actions')!.textContent).toContain('View only');
    expect(el.querySelector('.af-chip.active')!.textContent!.trim()).toBe('Aadhaar Card');
    expect(el.querySelector('.save-bar')).toBeNull();
  });

  it('shows unsaved changes in the save bar of an agency update and clears them after saving', async () => {
    await create(StaffRole.Agency, 'ZEDAS0001');
    http.expectOne('/api/staff/users/assessors/options').flush(options);
    await settle(fixture);
    http.expectOne('/api/staff/users/assessors/ZEDAS0001').flush({
      userId: 'ZEDAS0001', userName: 'Asha Rao', emailId: 'a@z.test', mobileNo: '9000000001', address: 'Street', pinCode: '560001',
      assessorType: 'Assessor', certificateNo: 'AS1', idProofType: 'Aadhaar Card', idProofNumberMasked: 'XXXXXXXX9012', states: ['DELHI'],
      nicSectors: [], areasOfKnowledge: [], reasonForRejection: null, isActive: true, agencyUserId: 'AGENCY1', canEdit: true, sectorActivity: 'Manufacturing',
    });
    await settle(fixture);
    expect(el.querySelector('h3')!.textContent).toContain('Update Assessor Details');
    expect(el.querySelector('.af-avatar')!.textContent!.trim()).toBe('AR');
    expect([...el.querySelectorAll('.af-head')].map((h) => h.textContent!.trim())).toEqual(['1Contact details', '2ID proof', '3What the assessor assesses', '4Block reason']);
    expect(saveNote()).toBe('No unsaved changes.');
    expect(el.querySelector('.save-bar')!.classList).not.toContain('is-dirty');

    const address = el.querySelector('#address') as HTMLTextAreaElement;
    address.value = 'New Street';
    address.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(fixture);
    expect(saveNote()).toBe('Not saved yet.');
    // 2026-11-13: the mobile number is editable on the agency's edit page (checked before saving).
    const mobile = el.querySelector('#mobileNo') as HTMLInputElement;
    expect(mobile.readOnly).toBe(false);
    mobile.value = '12345';
    mobile.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(fixture);
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(el.querySelector('.alert-danger')!.textContent).toContain('10 digit mobile');
    http.expectNone('/api/staff/users/assessors/ZEDAS0001');
    mobile.value = '9123456780';
    mobile.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(fixture);
    expect(el.querySelector('.save-bar')!.classList).toContain('is-dirty');

    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    const req = http.expectOne('/api/staff/users/assessors/ZEDAS0001');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toMatchObject({ address: 'New Street', idProofType: 'Aadhaar Card', idProofNumber: '', sectorActivity: 'Manufacturing', mobileNo: '9123456780' });
    req.flush({ message: 'Updated.' });
    await settle(fixture);
    expect(el.querySelector('.alert-success')!.textContent).toContain('Updated.');
    expect(saveNote()).toBe('No unsaved changes.');
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

  it('hides UnBlock while the certificate is attached elsewhere and has no Mobile No button', async () => {
    http.expectOne('/api/staff/users/assessors/mine').flush([
      row('ZEDBA0001', { IsActive: false, IsCertAttached: 1 }),
      row('ZEDBA0002', { IsActive: false }),
    ]);
    await settle(fixture);
    const rows = el.querySelectorAll('tbody tr');
    expect(rows[0].textContent).not.toContain('UnBlock');
    expect(rows[1].textContent).toContain('UnBlock');
    expect(rows[0].textContent).toContain('XXXXXXXX9012');
    expect(rows[0].textContent).toContain('attached to another active Bronze Assessor');
    expect(rows[1].textContent).not.toContain('attached to another');

    // 2026-11-13: the mobile number is changed on the edit page, not from the list.
    expect([...rows[0].querySelectorAll('button')].some((b) => b.textContent!.trim() === 'Mobile No')).toBe(false);
  });

  it('counts the assessors, filters them by status and search, and shows initials and chips', async () => {
    http.expectOne('/api/staff/users/assessors/mine').flush([
      row('ZEDBA0001', { UserName: 'Asha Rao', SectorActivity: 'Services' }),
      row('ZEDAS0002', { AssessorType: 'Assessor' }),
      row('ZEDBA0003', { IsActive: false, IdStatus: 'Blocked' }),
    ]);
    await settle(fixture);
    expect([...el.querySelectorAll('.ma-stat-count')].map((c) => c.textContent!.trim())).toEqual(['3', '2', '1']);
    const first = el.querySelector('tbody tr')!;
    expect(first.querySelector('.ma-avatar')!.textContent!.trim()).toBe('AR');
    expect([...first.querySelectorAll('.zed-chip, .sector-chip')].map((c) => c.textContent!.trim())).toEqual(['Bronze Assessor', 'Services']);
    expect(el.querySelectorAll('tbody tr')[1].textContent).toContain('Sector type not set');

    ([...el.querySelectorAll('.ma-stat')].find((t) => t.textContent!.includes('Blocked')) as HTMLButtonElement).click();
    await settle(fixture);
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
    expect(el.querySelector('tbody tr')!.textContent).toContain('ZEDBA0003');

    const search = el.querySelector('input[aria-label="Search assessors"]') as HTMLInputElement;
    search.value = 'nobody';
    search.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(el.querySelector('tbody .no-data')!.textContent).toContain('No assessor matches the search.');
    ([...el.querySelectorAll('tbody button')].find((b) => b.textContent!.trim() === 'Show all') as HTMLButtonElement).click();
    await settle(fixture);
    expect(el.querySelectorAll('tbody tr').length).toBe(3);
  });

  it('shows an empty state that leads to Add when the agency has no assessors', async () => {
    http.expectOne('/api/staff/users/assessors/mine').flush([]);
    await settle(fixture);
    expect(el.querySelector('table')).toBeNull();
    expect(el.querySelector('.ma-empty')!.textContent).toContain('No assessors yet');
    expect(el.querySelector('.ma-empty a')!.getAttribute('href')).toBe('/staff/users/assessors/new');
  });
});

describe('MyAssessorsPage (consultancy)', () => {
  it('offers UnBlock for every blocked user', async () => {
    await TestBed.configureTestingModule({
      imports: [MyAssessorsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: STAFF_SYSTEM, useValue: 'consultancy' }],
    }).compileComponents();
    const fixture = TestBed.createComponent(MyAssessorsPage);
    const http = TestBed.inject(HttpTestingController);
    await settle(fixture);
    http.expectOne('/api/staff/users/assessors/mine').flush([
      { Id: 1, UserId: 'ZEDCC0001', UserName: 'C1', IdStatus: 'Blocked', IsActive: false, IsCertAttached: 1, UserType: 'Consultant' },
    ]);
    await settle(fixture);
    expect((fixture.nativeElement as HTMLElement).querySelector('tbody tr')!.textContent).toContain('UnBlock');
    http.verify();
  });
});

describe('AssessorListPage', () => {
  it('blocks an assessor with a reason, unblocks one and shows the history (2026-11-08)', async () => {
    await TestBed.configureTestingModule({
      imports: [AssessorListPage],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AssessorListPage);
    const http = TestBed.inject(HttpTestingController);
    await settle(fixture);
    const list = [
      { RowNumber: 1, Id: 1, UserId: 'ZEDDA01', UserName: 'Desk One', IsActive: true, IdStatus: 'Active' },
      { RowNumber: 2, Id: 2, UserId: 'ZEDSA02', UserName: 'Site Two', IsActive: false, IdStatus: 'Blocked', BlockReason: 'Report quality complaints', BlockedOn: '2026-11-06T15:42:00' },
    ];
    http.expectOne((r) => r.url === '/api/staff/users/assessors').flush(list);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    const rowButton = (row: number, label: string) =>
      [...el.querySelectorAll('tbody tr')[row].querySelectorAll('button')].find((b) => b.textContent!.trim() === label) as HTMLButtonElement;
    expect(el.querySelectorAll('tbody tr')[1].querySelector('[data-block-note]')!.textContent!.replace(/\s+/g, ' ')).toContain('“Report quality complaints” · 06 Nov 2026');
    expect(rowButton(0, 'Unblock')).toBeUndefined();
    expect(rowButton(1, 'Block')).toBeUndefined();

    // Block: the open assessments, then a reason.
    rowButton(0, 'Block').click();
    await settle(fixture);
    http.expectOne('/api/staff/users/assessors/ZEDDA01/open-assessments').flush({ count: 2 });
    await settle(fixture);
    expect(el.querySelector('[data-open-warning]')!.textContent).toContain('2 assessments allotted to this assessor are still open');
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(el.querySelector('.modal')!.textContent).toContain('Please enter the reason for blocking.');
    const reason = el.querySelector('#as-block-reason') as HTMLTextAreaElement;
    reason.value = 'Certificate expired';
    reason.dispatchEvent(new Event('input'));
    await settle(fixture);
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    const block = http.expectOne('/api/staff/users/assessors/ZEDDA01/block');
    expect(block.request.body).toEqual({ reason: 'Certificate expired' });
    block.flush({ message: 'User Blocked successful' });
    await settle(fixture);
    http.expectOne((r) => r.url === '/api/staff/users/assessors').flush(list);
    await settle(fixture);
    expect(el.querySelector('.modal')).toBeNull();

    // Unblock after confirming.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    rowButton(1, 'Unblock').click();
    await settle(fixture);
    http.expectOne('/api/staff/users/assessors/ZEDSA02/unblock').flush({ message: 'User UnBlocked successful' });
    await settle(fixture);
    http.expectOne((r) => r.url === '/api/staff/users/assessors').flush(list);
    await settle(fixture);

    // History.
    rowButton(1, 'History').click();
    await settle(fixture);
    http.expectOne('/api/staff/users/assessors/ZEDSA02/history').flush([
      { action: 'Blocked', reason: 'Report quality complaints', actionBy: 'MASTER1', actionByRole: 7, actionDate: '2026-11-06T15:42:00' },
      { action: 'Unblocked', reason: null, actionBy: 'ZEDV4AG01', actionByRole: 2, actionDate: '2026-09-12T11:05:00' },
    ]);
    await settle(fixture);
    const items = [...el.querySelectorAll('.as-history li')].map((li) => li.textContent!.replace(/\s+/g, ' ').trim());
    expect(items[0]).toMatch(/^Blocked\s*06 Nov 2026, 3:42 PM · by MASTER1 \(Master Admin\)\s*“Report quality complaints”$/);
    expect(items[1]).toMatch(/^Unblocked\s*12 Sept? 2026, 11:05 AM · by ZEDV4AG01 \(agency\)$/);
    http.verify();
    vi.restoreAllMocks();
  });

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

  it('counts the assessors and filters them by status, type, sector type and agency', async () => {
    await TestBed.configureTestingModule({
      imports: [AssessorListPage],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AssessorListPage);
    const http = TestBed.inject(HttpTestingController);
    await settle(fixture);
    const a = (i: number, extra: Partial<AssessorRow>): AssessorRow => ({
      RowNumber: i, Id: i, UserId: `ZEDAS000${i}`, UserName: `Assessor ${i}`, MobileNo: null, Email: null, Address: null, IdStatus: 'Active', IsActive: true,
      AssessorType: 'BronzeAssessor', SectorActivity: 'Manufacturing', AgencyUserId: 'ZEDAA0001', AgencyUserName: 'Alpha Quality', ...extra,
    });
    http.expectOne((r) => r.url === '/api/staff/users/assessors').flush([
      a(1, { UserName: 'Ravi Kumar' }),
      a(2, { AssessorType: 'Assessor', SectorActivity: 'Services' }),
      a(3, { IsActive: false, IdStatus: 'Blocked', SectorActivity: null, AgencyUserId: 'ZEDAA0002', AgencyUserName: 'Beta Audits' }),
      a(4, { AssessorType: 'Assessor', SectorActivity: 'Both', AgencyUserId: 'ZEDAA0002', AgencyUserName: 'Beta Audits' }),
    ]);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    const rows = () => [...el.querySelectorAll('tbody tr')].map((r) => r.querySelector('.as-id')?.textContent?.trim());
    const choose = async (label: string, value: string) => {
      const select = el.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
      select.value = value;
      select.dispatchEvent(new Event('change'));
      await settle(fixture);
    };
    expect([...el.querySelectorAll('.as-stat-count')].map((c) => c.textContent!.trim())).toEqual(['4', '3', '1']);
    expect([...el.querySelectorAll('.as-tab')].map((t) => t.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['All types 4', 'Bronze Assessor 2', 'Assessor 2']);
    const first = el.querySelector('tbody tr')!;
    expect(first.querySelector('.as-avatar')!.textContent!.trim()).toBe('RK');
    expect([...first.querySelectorAll('.zed-chip, .sector-chip')].map((c) => c.textContent!.trim())).toEqual(['Bronze Assessor', 'Manufacturing']);
    expect(el.querySelectorAll('tbody tr')[2].textContent).toContain('Sector type not set');

    ([...el.querySelectorAll('.as-stat')].find((t) => t.textContent!.includes('Blocked')) as HTMLButtonElement).click();
    await settle(fixture);
    expect(rows()).toEqual(['ZEDAS0003']);

    ([...el.querySelectorAll('.as-stat')].find((t) => t.textContent!.includes('All')) as HTMLButtonElement).click();
    await settle(fixture);
    ([...el.querySelectorAll('.as-tab')].find((t) => t.textContent!.includes('Bronze Assessor')) as HTMLButtonElement).click();
    await settle(fixture);
    expect(rows()).toEqual(['ZEDAS0001', 'ZEDAS0003']);

    await choose('Sector type', 'none');
    expect(rows()).toEqual(['ZEDAS0003']);

    await choose('Sector type', 'Manufacturing');
    await choose('Assessment Agency', 'ZEDAA0002');
    expect(el.querySelector('tbody .no-data')!.textContent).toContain('No assessor matches the filters.');
    ([...el.querySelectorAll('tbody button')].find((b) => b.textContent!.trim() === 'Show all') as HTMLButtonElement).click();
    await settle(fixture);
    expect(rows().length).toBe(4);
    http.verify();
  });
});
