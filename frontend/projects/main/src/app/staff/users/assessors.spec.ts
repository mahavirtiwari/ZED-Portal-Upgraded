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
    ([...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Search') as HTMLButtonElement).click();
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
    expect([...el.querySelectorAll('button')].some((b) => b.textContent!.trim() === 'Search')).toBe(false);
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
    const search = () => ([...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Search') as HTMLButtonElement).click();
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
    expect(el.querySelector('.ph-title')!.textContent).toContain('Add Consultant/Expert');
    expect(el.querySelector('#assessorType-label')!.textContent).toContain('Consultant/Expert');
    expect([...el.querySelectorAll('input[name=assessorType]')].map((i) => i.closest('label')!.textContent!.trim())).toEqual(['Consultant/Expert', 'Technical Expert']);
    expect(el.querySelector('label[for="userName"]')!.textContent).toContain('Consultant/Expert name');
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
    // The rail's open assessments count (assessor-form.spec.ts).
    http.expectOne('/api/staff/users/assessors/ZEDAS0001/open-assessments').flush({ count: null });
    // The registered mobile card (assessor-mobile.spec.ts), first in the right rail.
    http.expectOne('/api/staff/assessor-mobile/ZEDAS0001').flush({ userId: 'ZEDAS0001', device: null, signIns: [] });
    // 2026-11-18: the agency's name for the rail.
    http.expectOne('/api/staff/users/agencies').flush([]);
    await settle(fixture);
    expect(el.querySelector('.ph-title')!.textContent).toContain('Assessor details');
    expect([...el.querySelectorAll('button')].some((b) => ['Create', 'Update'].includes(b.textContent!.trim()))).toBe(false);
    // 2026-11-18 (staff-05): the view shows a compact contact card, no edit fields; the e-mail in full (the user: never masked).
    // An Aadhaar ID proof keeps only its last four (as the server sends it).
    expect(el.querySelector('#idProofNumber')).toBeNull();
    expect(el.querySelector('[data-view="id-proof"]')!.textContent!.trim()).toBe('Aadhaar card · •••••9012');
    expect(el.querySelector('[data-view="email"]')!.textContent!.trim()).toBe('a@z.test');
    expect(el.querySelector('zed-page-head a[data-back]')!.getAttribute('href')).toBe('/staff/users/assessors');
    // The profile card and no save bar.
    const profile = el.querySelector('.af-profile')!.textContent!;
    expect(profile).toContain('Asha');
    expect(profile).toContain('Certificate no. AS1');
    expect(profile).toContain('Active');
    expect(profile).toContain('View only');
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
    http.expectOne('/api/staff/users/assessors/ZEDAS0001/open-assessments').flush({ count: 0 });
    await settle(fixture);
    expect(el.querySelector('.ph-title')!.textContent).toContain('Update Assessor details');
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
    // 2026-11-17: a toast instead of the green alert (assessor-form.spec.ts).
    expect(el.querySelector('.alert-success')).toBeNull();
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
  /** The 2026-11-17 row menu: opens it and gives its item labels. */
  const menuOf = async (tr: Element) => {
    (tr.querySelector('zed-row-menu .rm-btn') as HTMLButtonElement).click();
    await settle(fixture);
    return [...tr.querySelectorAll('.rm-item')].map((b) => b.textContent!.trim());
  };
  const choose = async (tr: Element, label: string) => {
    if (!tr.querySelector('.rm-item')) await menuOf(tr);
    ([...tr.querySelectorAll('.rm-item')].find((b) => b.textContent!.trim() === label) as HTMLButtonElement).click();
    await settle(fixture);
  };
  const submit = async (selector = 'zed-confirm-dialog form') => {
    (el.querySelector(selector) as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
  };
  const toasts = async () => TestBed.inject((await import('../toast')).ToastService).toasts();

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MyAssessorsPage], providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] }).compileComponents();
    fixture = TestBed.createComponent(MyAssessorsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle(fixture);
  });

  afterEach(() => http.verify());

  it('offers no Unblock while the certificate is attached elsewhere, shows the contact in full and no ID proof or PAN column', async () => {
    http.expectOne('/api/staff/users/assessors/mine').flush([
      row('ZEDBA0001', { IsActive: false, IsCertAttached: 1, PanNo: 'ABCDE1234F' }),
      row('ZEDBA0002', { IsActive: false }),
      row('ZEDBA0003'),
    ]);
    await settle(fixture);
    const rows = el.querySelectorAll('tbody tr');
    expect(await menuOf(rows[0])).toEqual(['View history']);
    expect(await menuOf(rows[1])).toEqual(['View history', 'Unblock assessor']);
    expect(await menuOf(rows[2])).toEqual(['Send reset link', 'View history', 'Block assessor']);
    expect(rows[0].textContent).toContain('attached to another active Bronze Assessor');
    expect(rows[1].textContent).not.toContain('attached to another');
    expect(rows[0].textContent).not.toContain('XXXXXXXX9012');
    expect(rows[0].textContent).not.toContain('ABCDE1234F');
    // 2026-11-18 (the user): never masked.
    expect([...rows[0].querySelectorAll('.ma-contact span')].map((s) => s.textContent!.trim())).toEqual(['9000000001', 'x@z.test']);
    // Two buttons at most: Edit and the menu (the mobile number is changed on the edit page).
    expect([...rows[2].querySelectorAll('.ma-btns > a, .ma-btns > button')].map((b) => b.textContent!.trim())).toEqual(['Edit']);
    expect(rows[2].querySelector('.ma-btns a')!.getAttribute('href')).toBe('/staff/users/assessors/ZEDBA0003');
  });

  it('counts the assessors, filters them by status and search, and shows initials, medals and the sector', async () => {
    http.expectOne('/api/staff/users/assessors/mine').flush([
      row('ZEDBA0001', { UserName: 'Asha Rao', SectorActivity: 'Services' }),
      row('ZEDAS0002', { AssessorType: 'Assessor', Assessments: [{ level: 'Bronze', modes: ['Desktop'] }, { level: 'Silver', modes: ['Onsite', 'Desktop'] }] }),
      row('ZEDBA0003', { IsActive: false, IdStatus: 'Blocked' }),
    ]);
    await settle(fixture);
    expect([...el.querySelectorAll('zed-list-counts .lc-item b')].map((c) => c.textContent!.trim())).toEqual(['3', '2', '1']);
    const [first, second] = [...el.querySelectorAll('tbody tr')];
    expect(first.querySelector('.ma-avatar')!.textContent!.trim()).toBe('AR');
    expect(first.querySelector('.ma-type')!.textContent!.trim()).toBe('Bronze Assessor');
    expect(first.querySelector('.ma-pill')!.textContent!.trim()).toBe('Services');
    expect(second.querySelector('.ma-pill')!.textContent!.trim()).toBe('Not set');
    expect([...second.querySelectorAll('.lv')].map((m) => m.className)).toEqual(['lv lv-bronze', 'lv lv-silver']);
    expect(second.querySelector('.lv-row')!.getAttribute('aria-label')).toBe('Bronze: Desktop; Silver: Onsite, Desktop');
    expect(second.querySelector('.ma-levels .ma-sub')!.textContent!.trim()).toBe('Desktop · Onsite');

    ([...el.querySelectorAll('zed-list-counts button')].find((t) => t.textContent!.includes('Blocked')) as HTMLButtonElement).click();
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

  it('sends a reset link from the row menu after the confirmation and confirms it with a toast', async () => {
    http.expectOne('/api/staff/users/assessors/mine').flush([row('ZEDBA0001', { UserName: 'Asha Rao', Email: 'asha@sample.in' })]);
    await settle(fixture);
    await choose(el.querySelector('tbody tr')!, 'Send reset link');
    const dialog = el.querySelector('zed-confirm-dialog')!;
    expect(dialog.querySelector('h3')!.textContent).toContain('Send password reset link?');
    const person = dialog.querySelector('.cd-person')!.textContent!;
    for (const part of ['Asha Rao', 'Assessor · ZEDBA0001', 'asha@sample.in']) expect(person).toContain(part);
    expect(dialog.textContent).toContain('The user chooses the new password.');
    await submit();
    http.expectOne('/api/staff/users/assessors/ZEDBA0001/password-reset').flush({ message: 'A link to set a new password was e-mailed (asha@sample.in).' });
    await settle(fixture);
    expect(el.querySelector('zed-confirm-dialog')).toBeNull();
    expect(el.querySelector('.alert-success')).toBeNull();
    expect((await toasts()).at(-1)).toMatchObject({ tone: 'success', title: 'Reset link sent', message: 'E-mailed to asha@sample.in' });
  });

  it('blocks from the row menu with the open assessments and a required reason, and keeps a refusal in the pop-up', async () => {
    http.expectOne('/api/staff/users/assessors/mine').flush([row('ZEDBA0001', { UserName: 'Asha Rao' })]);
    await settle(fixture);
    await choose(el.querySelector('tbody tr')!, 'Block assessor');
    http.expectOne('/api/staff/users/assessors/ZEDBA0001/open-assessments').flush({ count: 2 });
    await settle(fixture);
    const dialog = () => el.querySelector('zed-confirm-dialog')!;
    expect(dialog().querySelector('h3')!.textContent).toContain('Block Asha Rao?');
    expect(dialog().textContent).toContain('2 assessments allotted to this assessor are still open. You will need to re-allot them.');
    expect(dialog().querySelector('.cd-ok')!.textContent!.trim()).toBe('Block assessor');
    expect(dialog().querySelector('.cd-ok')!.classList).toContain('btn-danger');
    await submit();
    expect(dialog().textContent).toContain('Please enter the reason for blocking.');
    const reason = el.querySelector('#assessor-reason') as HTMLTextAreaElement;
    reason.value = ' Certificate expired ';
    reason.dispatchEvent(new Event('input'));
    await submit();
    const refused = http.expectOne('/api/staff/users/assessors/ZEDBA0001/block');
    expect(refused.request.body).toEqual({ reason: 'Certificate expired' });
    refused.flush({ title: 'The assessor is on an open assessment.' }, { status: 400, statusText: 'Bad Request' });
    await settle(fixture);
    expect(dialog().querySelector('.help-block')!.textContent).toContain('The assessor is on an open assessment.');
    await submit();
    http.expectOne('/api/staff/users/assessors/ZEDBA0001/block').flush({ message: 'User Blocked successful' });
    await settle(fixture);
    http.expectOne('/api/staff/users/assessors/mine').flush([row('ZEDBA0001', { IsActive: false, IdStatus: 'Blocked' })]);
    await settle(fixture);
    expect(el.querySelector('zed-confirm-dialog')).toBeNull();
    expect((await toasts()).at(-1)).toMatchObject({ tone: 'success', title: 'Assessor blocked', message: 'User Blocked successful' });
  });

  it('says the open assessments are not known when they cannot be counted', async () => {
    http.expectOne('/api/staff/users/assessors/mine').flush([row('ZEDBA0001')]);
    await settle(fixture);
    await choose(el.querySelector('tbody tr')!, 'Block assessor');
    http.expectOne('/api/staff/users/assessors/ZEDBA0001/open-assessments').flush({ count: null });
    await settle(fixture);
    expect(el.querySelector('zed-confirm-dialog')!.textContent).toContain('Open assessments allotted to this assessor: not known.');
  });

  it('unblocks with a reason and shows the block history in the side panel', async () => {
    http.expectOne('/api/staff/users/assessors/mine').flush([row('ZEDBA0002', { UserName: 'Ravi Kumar', IsActive: false, IdStatus: 'Blocked' })]);
    await settle(fixture);
    await choose(el.querySelector('tbody tr')!, 'Unblock assessor');
    const box = el.querySelector('#reason-dialog-text') as HTMLTextAreaElement;
    box.value = 'Certificate renewed';
    box.dispatchEvent(new Event('input'));
    await submit('zed-reason-dialog form');
    const unblock = http.expectOne('/api/staff/users/assessors/ZEDBA0002/unblock');
    expect(unblock.request.body).toEqual({ reason: 'Certificate renewed' });
    unblock.flush({ message: 'User UnBlocked successful' });
    await settle(fixture);
    http.expectOne('/api/staff/users/assessors/mine').flush([row('ZEDBA0002', { UserName: 'Ravi Kumar' })]);
    await settle(fixture);
    expect(el.querySelector('zed-reason-dialog')).toBeNull();
    expect((await toasts()).at(-1)).toMatchObject({ title: 'Assessor unblocked' });

    await choose(el.querySelector('tbody tr')!, 'View history');
    expect(el.querySelector('zed-user-history small')!.textContent).toBe('Ravi Kumar · ZEDBA0002');
    http.expectOne('/api/staff/users/assessors/ZEDBA0002/history').flush([
      { action: 'Unblocked', reason: 'Certificate renewed', actionBy: 'AGENCY1', actionByRole: 2, actionDate: '2026-11-17T10:15:00' },
    ]);
    await settle(fixture);
    const item = [...el.querySelector('zed-user-history .hp-list li')!.children].map((c) => c.textContent!.trim());
    expect(item).toEqual(['Unblocked', 'By AGENCY1 (agency) · Reason: Certificate renewed', '17 Nov 2026, 10:15']);
    (el.querySelector('zed-user-history .hp-close') as HTMLButtonElement).click();
    await settle(fixture);
    expect(el.querySelector('zed-user-history')).toBeNull();
  });

  it("shows the Add form's answer as a toast", async () => {
    globalThis.history.replaceState({ message: 'Assessor ZEDBA0009 added.' }, '');
    try {
      const second = TestBed.createComponent(MyAssessorsPage);
      await settle(second);
      http.match('/api/staff/users/assessors/mine').forEach((r) => r.flush([]));
      expect((await toasts()).at(-1)).toMatchObject({ tone: 'success', title: 'Assessor added', message: 'Assessor ZEDBA0009 added.' });
      expect((second.nativeElement as HTMLElement).querySelector('.alert-success')).toBeNull();
    } finally {
      globalThis.history.replaceState(null, '');
    }
  });
});

describe('MyAssessorsPage (consultancy)', () => {
  it('offers Unblock for every blocked user', async () => {
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
    const tr = (fixture.nativeElement as HTMLElement).querySelector('tbody tr')!;
    expect(tr.textContent).toContain('Consultant');
    (tr.querySelector('zed-row-menu .rm-btn') as HTMLButtonElement).click();
    await settle(fixture);
    expect([...tr.querySelectorAll('.rm-item')].map((b) => b.textContent!.trim())).toEqual(['View history', 'Unblock consultant']);
    http.verify();
  });
});

describe('AssessorListPage', () => {
  async function create(query: Record<string, string> = {}) {
    await TestBed.configureTestingModule({
      imports: [AssessorListPage],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AssessorListPage);
    const http = TestBed.inject(HttpTestingController);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    const choose = async (tr: Element, label: string) => {
      (tr.querySelector('zed-row-menu .rm-btn') as HTMLButtonElement).click();
      await settle(fixture);
      ([...tr.querySelectorAll('.rm-item')].find((b) => b.textContent!.trim() === label) as HTMLButtonElement).click();
      await settle(fixture);
    };
    const submit = async (selector = 'zed-confirm-dialog form') => {
      (el.querySelector(selector) as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settle(fixture);
    };
    const toasts = async () => TestBed.inject((await import('../toast')).ToastService).toasts();
    return { fixture, http, el, choose, submit, toasts };
  }

  it('blocks an assessor with a reason after showing its open assessments, unblocks one and shows the history panel', async () => {
    const { fixture, http, el, choose, submit, toasts } = await create();
    const list = [
      { RowNumber: 1, Id: 1, UserId: 'ZEDDA01', UserName: 'Desk One', IsActive: true, IdStatus: 'Active' },
      { RowNumber: 2, Id: 2, UserId: 'ZEDSA02', UserName: 'Site Two', IsActive: false, IdStatus: 'Blocked', BlockReason: 'Report quality complaints', BlockedOn: '2026-11-06T15:42:00' },
    ];
    http.expectOne((r) => r.url === '/api/staff/users/assessors').flush(list);
    await settle(fixture);
    const tr = (i: number) => el.querySelectorAll('tbody tr')[i];
    expect(tr(1).querySelector('[data-block-note]')!.textContent!.replace(/\s+/g, ' ')).toContain('“Report quality complaints” · 06 Nov 2026');
    // View stays visible; Reset link, History and Block / Unblock are in the row menu.
    expect([...tr(0).querySelectorAll('.as-btns > a, .as-btns > button')].map((b) => b.textContent!.trim())).toEqual(['View']);
    expect(tr(0).querySelector('.as-btns a')!.getAttribute('href')).toBe('/staff/users/assessors/ZEDDA01');

    // Block: the open assessments are read first, then the confirmation asks for a reason.
    await choose(tr(0), 'Block assessor');
    expect(el.querySelector('zed-confirm-dialog')).toBeNull();
    http.expectOne('/api/staff/users/assessors/ZEDDA01/open-assessments').flush({ count: 2 });
    await settle(fixture);
    const dialog = el.querySelector('zed-confirm-dialog')!;
    expect(dialog.querySelector('h3')!.textContent).toContain('Block Desk One?');
    expect(dialog.textContent).toContain('2 assessments allotted to this assessor are still open. The assessment agency will need to re-allot them.');
    expect(dialog.textContent).toContain("The login can't sign in on the web or the app");
    await submit();
    expect(el.querySelector('zed-confirm-dialog')!.textContent).toContain('Please enter the reason for blocking.');
    const reason = el.querySelector('#as-block-reason') as HTMLTextAreaElement;
    reason.value = 'Certificate expired';
    reason.dispatchEvent(new Event('input'));
    await submit();
    const block = http.expectOne('/api/staff/users/assessors/ZEDDA01/block');
    expect(block.request.body).toEqual({ reason: 'Certificate expired' });
    block.flush({ message: 'User Blocked successful' });
    await settle(fixture);
    http.expectOne((r) => r.url === '/api/staff/users/assessors').flush(list);
    await settle(fixture);
    expect(el.querySelector('zed-confirm-dialog')).toBeNull();
    expect((await toasts()).at(-1)).toMatchObject({ tone: 'success', title: 'Assessor blocked', message: 'User Blocked successful' });
    expect(el.querySelector('.alert-success')).toBeNull();

    // Unblock with its reason (2026-11-16).
    await choose(tr(1), 'Unblock assessor');
    const box = el.querySelector('#reason-dialog-text') as HTMLTextAreaElement;
    box.value = 'Certificate renewed';
    box.dispatchEvent(new Event('input'));
    await submit('zed-reason-dialog form');
    const unblock = http.expectOne('/api/staff/users/assessors/ZEDSA02/unblock');
    expect(unblock.request.body).toEqual({ reason: 'Certificate renewed' });
    unblock.flush({ message: 'User UnBlocked successful' });
    await settle(fixture);
    http.expectOne((r) => r.url === '/api/staff/users/assessors').flush(list);
    await settle(fixture);
    expect((await toasts()).at(-1)).toMatchObject({ title: 'Assessor unblocked' });

    // History: the side panel (popup-08).
    await choose(tr(1), 'View history');
    expect(el.querySelector('zed-user-history .hp-none')!.textContent).toContain('Loading');
    http.expectOne('/api/staff/users/assessors/ZEDSA02/history').flush([
      { action: 'Blocked', reason: 'Report quality complaints', actionBy: 'MASTER1', actionByRole: 7, actionDate: '2026-11-06T15:42:00' },
      { action: 'Unblocked', reason: null, actionBy: 'ZEDV4AG01', actionByRole: 2, actionDate: '2026-09-12T11:05:00' },
    ]);
    await settle(fixture);
    expect(el.querySelector('zed-user-history small')!.textContent).toBe('Site Two · ZEDSA02');
    const items = [...el.querySelectorAll('zed-user-history .hp-list li')].map((li) =>
      [...li.children].map((c) => c.textContent!.trim()).join(' | '));
    expect(items[0]).toBe('Blocked | By MASTER1 (Master Admin) · Reason: Report quality complaints | 06 Nov 2026, 15:42');
    expect(items[1]).toMatch(/^Unblocked \| By ZEDV4AG01 \(agency\) \| 12 Sept? 2026, 11:05$/);
    expect(el.querySelector('zed-user-history .hp-list li')!.className).toBe('is-bad');
    http.verify();
  });

  it('sends a reset link after the confirmation and shows a refusal in the pop-up', async () => {
    const { fixture, http, el, choose, submit, toasts } = await create();
    http.expectOne((r) => r.url === '/api/staff/users/assessors').flush([
      { RowNumber: 1, Id: 1, UserId: 'ZEDBA01', UserName: 'Asha Rao', Email: 'asha@sample.in', IsActive: true, IdStatus: 'Active' },
    ]);
    await settle(fixture);
    await choose(el.querySelector('tbody tr')!, 'Send reset link');
    expect(el.querySelector('zed-confirm-dialog')!.textContent).toContain('asha@sample.in');
    await submit();
    http.expectOne('/api/staff/users/assessors/ZEDBA01/password-reset').flush({ title: 'No e-mail address is saved.' }, { status: 400, statusText: 'Bad Request' });
    await settle(fixture);
    expect(el.querySelector('zed-confirm-dialog .help-block')!.textContent).toContain('No e-mail address is saved.');
    await submit();
    http.expectOne('/api/staff/users/assessors/ZEDBA01/password-reset').flush({ message: 'Link sent.' });
    await settle(fixture);
    expect(el.querySelector('zed-confirm-dialog')).toBeNull();
    // No address in the answer: the list's address.
    expect((await toasts()).at(-1)).toMatchObject({ title: 'Reset link sent', message: 'E-mailed to asha@sample.in' });
    http.verify();
  });

  it('passes the agency and type filters and pages the result', async () => {
    const { fixture, http, el } = await create({ agencyId: 'ZEDAA0001', type: 'DA' });
    const req = http.expectOne((r) => r.url === '/api/staff/users/assessors');
    expect(req.request.params.get('agencyId')).toBe('ZEDAA0001');
    expect(req.request.params.get('type')).toBe('DA');
    req.flush(Array.from({ length: 25 }, (_, i) => ({ RowNumber: i + 1, Id: i, UserId: `ZEDAS${i}`, UserName: `A${i}`, IsActive: true })));
    await settle(fixture);
    expect(el.querySelector('h2')!.textContent).toBe('Assessors of ZEDAA0001');
    expect(el.querySelectorAll('tbody tr').length).toBe(20);
    ([...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Next') as HTMLButtonElement).click();
    await settle(fixture);
    expect(el.querySelectorAll('tbody tr').length).toBe(5);
    http.verify();
  });

  it('shows the contact in full and has no PAN column', async () => {
    const { fixture, http, el } = await create();
    http.expectOne((r) => r.url === '/api/staff/users/assessors').flush([
      { RowNumber: 1, Id: 1, UserId: 'ZEDBA01', UserName: 'Ravi', MobileNo: '9876543210', Email: 'ravi@sample.in', PanNo: 'ABCDE1234F', IsActive: true, IdStatus: 'Active' },
      { RowNumber: 2, Id: 2, UserId: 'ZEDBA02', UserName: 'Asha', MobileNo: null, Email: null, IsActive: true, IdStatus: 'Active' },
    ]);
    await settle(fixture);
    const [first, second] = [...el.querySelectorAll('tbody tr')];
    // 2026-11-18 (the user): never masked; a long e-mail is cut with "…" and its tooltip.
    expect([...first.querySelectorAll('.as-contact span')].map((s) => s.textContent!.trim())).toEqual(['9876543210', 'ravi@sample.in']);
    expect(first.querySelector('.as-contact .as-sub')!.getAttribute('title')).toBe('ravi@sample.in');
    expect(second.querySelector('.as-contact')!.textContent!.trim()).toBe('Mobile not saved');
    expect(el.querySelector('tbody')!.textContent).not.toContain('ABCDE1234F');
    expect([...el.querySelectorAll('thead th')].map((th) => th.textContent!.trim())).toEqual(['Assessor', 'Levels and modes', 'Sector', 'Contact', 'Agency', 'Status', 'Actions']);
    http.verify();
  });

  it('counts the assessors and filters them by status, type, sector type and agency', async () => {
    const { fixture, http, el } = await create();
    const a = (i: number, extra: Partial<AssessorRow>): AssessorRow => ({
      RowNumber: i, Id: i, UserId: `ZEDAS000${i}`, UserName: `Assessor ${i}`, MobileNo: null, Email: null, Address: null, IdStatus: 'Active', IsActive: true,
      AssessorType: 'BronzeAssessor', SectorActivity: 'Manufacturing', AgencyUserId: 'ZEDAA0001', AgencyUserName: 'Alpha Quality', ...extra,
    });
    http.expectOne((r) => r.url === '/api/staff/users/assessors').flush([
      a(1, { UserName: 'Ravi Kumar' }),
      a(2, { AssessorType: 'Assessor', SectorActivity: 'Services', Assessments: [{ level: 'Gold', modes: ['Remote'] }, { level: 'ZEDX', modes: ['Onsite'] }] }),
      a(3, { IsActive: false, IdStatus: 'Blocked', SectorActivity: null, AgencyUserId: 'ZEDAA0002', AgencyUserName: 'Beta Audits' }),
      a(4, { AssessorType: 'Assessor', SectorActivity: 'Both', AgencyUserId: 'ZEDAA0002', AgencyUserName: 'Beta Audits' }),
    ]);
    await settle(fixture);
    const rows = () => [...el.querySelectorAll('tbody tr')].map((r) => r.querySelector('.as-id')?.textContent?.trim());
    const pickOption = async (label: string, value: string) => {
      const select = el.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
      select.value = value;
      select.dispatchEvent(new Event('change'));
      await settle(fixture);
    };
    const tile = (label: string) => [...el.querySelectorAll('zed-list-counts button')].find((t) => t.textContent!.includes(label)) as HTMLButtonElement;
    expect([...el.querySelectorAll('zed-list-counts .lc-item b')].map((c) => c.textContent!.trim())).toEqual(['4', '3', '1']);
    expect(tile('All').getAttribute('aria-pressed')).toBe('true');
    expect([...el.querySelectorAll('zed-chip-filter .cf-chip')].map((t) => t.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['All types 4', 'Bronze Assessor 2', 'Assessor 2']);
    const [first, second, third] = [...el.querySelectorAll('tbody tr')];
    expect(first.querySelector('.as-avatar')!.textContent!.trim()).toBe('RK');
    expect(first.querySelector('.as-type')!.textContent!.trim()).toBe('Bronze Assessor');
    expect(first.querySelector('.as-pill')!.textContent!.trim()).toBe('Manufacturing');
    expect([...second.querySelectorAll('.lv')].map((m) => [m.className, m.getAttribute('title')])).toEqual([['lv lv-gold', 'Gold: Remote'], ['lv lv-zedx', 'ZED-X: Onsite']]);
    expect(second.querySelector('.as-levels .as-sub')!.textContent!.trim()).toBe('Remote · Onsite');
    expect(third.querySelector('.as-pill')!.textContent!.trim()).toBe('Not set');
    expect([...first.querySelector('.as-agency')!.children].map((c) => c.textContent!.trim())).toEqual(['Alpha Quality', 'ZEDAA0001']);

    tile('Blocked').click();
    await settle(fixture);
    expect(rows()).toEqual(['ZEDAS0003']);
    expect(tile('Blocked').getAttribute('aria-pressed')).toBe('true');

    tile('All').click();
    await settle(fixture);
    ([...el.querySelectorAll('zed-chip-filter .cf-chip')].find((t) => t.textContent!.includes('Bronze Assessor')) as HTMLButtonElement).click();
    await settle(fixture);
    expect(rows()).toEqual(['ZEDAS0001', 'ZEDAS0003']);

    await pickOption('Sector type', 'none');
    expect(rows()).toEqual(['ZEDAS0003']);

    await pickOption('Sector type', 'Manufacturing');
    await pickOption('Assessment Agency', 'ZEDAA0002');
    expect(el.querySelector('tbody .no-data')!.textContent).toContain('No assessor matches the filters.');
    ([...el.querySelectorAll('tbody button')].find((b) => b.textContent!.trim() === 'Show all') as HTMLButtonElement).click();
    await settle(fixture);
    expect(rows().length).toBe(4);
    http.verify();
  });
});

describe('AssessorListPage: one phone per assessor (2026-11-18)', () => {
  const rows: AssessorRow[] = [
    { RowNumber: 1, Id: 1, UserId: 'ZEDAS0001', UserName: 'Ravi Kumar', MobileNo: null, Email: null, Address: null, IdStatus: 'Active', IsActive: true, AssessorType: 'Assessor', AgencyUserId: null, AgencyUserName: null },
    { RowNumber: 2, Id: 2, UserId: 'ZEDAS0002', UserName: 'Sita Devi', MobileNo: null, Email: null, Address: null, IdStatus: 'Active', IsActive: true, AssessorType: 'Assessor', AgencyUserId: null, AgencyUserName: null },
    { RowNumber: 3, Id: 3, UserId: 'ZEDAS0003', UserName: 'Om Prakash', MobileNo: null, Email: null, Address: null, IdStatus: 'Active', IsActive: true, AssessorType: 'Assessor', AgencyUserId: null, AgencyUserName: null },
  ];
  const phones = [
    { userId: 'zedas0001', app: 'SA', appName: 'Site assessment app', model: 'Samsung SM-A515F', make: 'Samsung', lastLoginAt: '2026-11-17T10:00:00', refusedToday: false, lastRefusedAt: null },
    { userId: 'ZEDAS0003', app: null, appName: null, model: null, make: null, lastLoginAt: null, refusedToday: true, lastRefusedAt: '2026-11-18T09:00:00' },
  ];

  async function create(roleId: number) {
    await TestBed.configureTestingModule({
      imports: [AssessorListPage],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
      ],
    }).compileComponents();
    signIn(roleId);
    const fixture = TestBed.createComponent(AssessorListPage);
    const http = TestBed.inject(HttpTestingController);
    await settle(fixture);
    return { fixture, http, el: fixture.nativeElement as HTMLElement };
  }

  it("shows each assessor's Phone chip and releases a phone with a reason from the row menu", async () => {
    const { fixture, http, el } = await create(StaffRole.MasterAdmin);
    http.expectOne((r) => r.url === '/api/staff/users/assessors').flush(rows);
    http.expectOne('/api/staff/assessor-mobile').flush(phones);
    await settle(fixture);
    const tr = (i: number) => el.querySelectorAll('tbody tr')[i];
    const chip = (i: number) => tr(i).querySelector('zed-phone-chip [data-phone]')!;
    expect(chip(0).textContent!.trim()).toBe('Registered · Samsung SM-A515F');
    expect(chip(1).textContent!.trim()).toBe('Not registered');
    expect(chip(2).textContent!.trim()).toBe('Refused sign-in today');
    expect(chip(2).classList).toContain('is-warn');

    const menu = async (i: number) => {
      (tr(i).querySelector('zed-row-menu .rm-btn') as HTMLButtonElement).click();
      await settle(fixture);
      return [...tr(i).querySelectorAll('.rm-item')].map((b) => b.textContent!.trim());
    };
    // Only a registered phone can be released.
    expect(await menu(1)).not.toContain('Release mobile');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle(fixture);
    expect(await menu(0)).toEqual(['Send reset link', 'View history', 'Release mobile', 'Block assessor']);
    ([...tr(0).querySelectorAll('.rm-item')].find((b) => b.textContent!.trim() === 'Release mobile') as HTMLButtonElement).click();
    await settle(fixture);
    const dialog = el.querySelector('zed-confirm-dialog')!;
    expect(dialog.querySelector('h3')!.textContent).toContain('Release the mobile of Ravi Kumar?');
    expect(dialog.textContent).toContain('ZEDAS0001 · Samsung SM-A515F');
    (dialog.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(dialog.textContent).toContain('Please enter the reason for releasing the mobile.');
    const reason = el.querySelector('#as-release-reason') as HTMLTextAreaElement;
    reason.value = 'Phone replaced';
    reason.dispatchEvent(new Event('input'));
    (dialog.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    const post = http.expectOne('/api/staff/assessor-mobile/ZEDAS0001/release');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ reason: 'Phone replaced' });
    post.flush({ message: 'Mobile released.' });
    await settle(fixture);
    http.expectOne('/api/staff/assessor-mobile').flush([phones[1]]);
    await settle(fixture);
    expect(el.querySelector('zed-confirm-dialog')).toBeNull();
    expect(chip(0).textContent!.trim()).toBe('Not registered');
    http.verify();
  });

  it('shows no chip, menu item or phone list to an agency', async () => {
    const { fixture, http, el } = await create(StaffRole.Agency);
    http.expectOne((r) => r.url === '/api/staff/users/assessors').flush(rows);
    await settle(fixture);
    expect(el.querySelector('zed-phone-chip')).toBeNull();
    http.expectNone('/api/staff/assessor-mobile');
    http.verify();
  });
});
