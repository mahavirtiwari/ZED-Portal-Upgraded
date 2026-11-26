import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { SchemeDetailPage } from '../scheme-verification/scheme-detail';
import { SchemeListPage } from '../scheme-verification/scheme-list';
import { IncentiveAgenciesPage } from './incentive-agencies';
import { IncentiveAgencyFormPage } from './incentive-agency-form';
import { SCHEME_ONSITE_ROUTES } from './scheme-onsite.routes';

/**
 * 2026-11-20 (incentive schemes, phase 2): the onsite verification pages (onsite agency lists); 2026-11-20 (the product owner): the
 * Master Admin's Incentive Verification Agencies (desktop and onsite).
 */
describe('scheme onsite verification pages', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let el: HTMLElement;

  const row = (id: number, status: string, extra: Record<string, unknown> = {}) => ({
    id, zedId: `ZEDMSME0000${id}`, unitName: `Unit ${id}`, state: 'UTTAR PRADESH', district: 'KANPUR NAGAR', schemeCode: 'FA_ONSITE', schemeName: 'FA Onsite',
    level: 'Bronze', levelName: 'Bronze', status, claimAmount: 70000, eligibleAmount: 50000, approvedAmount: null, submittedOn: '2026-11-18T10:00:00',
    decidedOn: null, correctionRound: 0, correctionDueOn: null, holdReason: null, agency: 'AG1', agencyName: 'Desktop Agency', assessor: 'DA1', assessorName: 'Desk Assessor',
    allotmentType: 'RoundRobin', reasonForRejection: null, agencyRemarks: null, assessorAcceptedOn: null, onsiteAgency: null, onsiteAgencyName: null,
    onsiteAssessor: null, onsiteAssessorName: null, onsiteAllotmentType: null, visitStartedOn: null, ...extra,
  });

  const text = (b: Element) => b.textContent!.replace(/\s+/g, ' ').trim();
  const button = (label: string) => [...el.querySelectorAll('button, a')].filter((b) => text(b) === label) as HTMLElement[];

  async function settle() {
    harness.detectChanges();
    await new Promise((r) => setTimeout(r));
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  async function open(url: string) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'applications', data: { mode: 'admin' }, component: SchemeListPage },
          { path: 'onsite/allotment', data: { mode: 'onsiteAllotment' }, component: SchemeListPage },
          { path: 'onsite/qc/:id', data: { mode: 'onsiteQc' }, component: SchemeDetailPage },
          { path: 'staff/scheme-agencies', component: IncentiveAgenciesPage },
          { path: 'staff/scheme-agencies/new', component: IncentiveAgencyFormPage },
          { path: 'staff/scheme-agencies/:userId', component: IncentiveAgencyFormPage },
        ]),
        provideHttpClient(), provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    el = harness.routeNativeElement!;
    await settle();
  }

  const choose = async (value: string) => {
    const select = el.querySelector('zed-confirm-dialog select') as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await settle();
    (el.querySelector('zed-confirm-dialog .cd-ok') as HTMLButtonElement).click();
    await settle();
  };

  afterEach(() => http.verify());

  it('lets the onsite agency accept naming its onsite assessor, with no date', async () => {
    await open('/onsite/allotment');
    const list = http.expectOne((r) => r.url === '/api/staff/scheme-onsite/agency');
    expect(list.request.params.get('status')).toBe('OnsiteWithAgency');
    list.flush({ rows: [row(31, 'OnsiteWithAgency', { onsiteAgency: 'OS1' }), row(32, 'OnsiteWithAssessor', { onsiteAgency: 'OS1', onsiteAssessor: 'OSA1', onsiteAssessorName: 'Onsite Assessor' })],
      counts: { OnsiteWithAgency: 1, OnsiteWithAssessor: 1 }, schemes: [], states: [] });
    await settle();
    expect(el.textContent).toContain('Scheme Onsite Allotment');
    expect(el.textContent).toContain('With onsite agency');
    expect(el.textContent).toContain('KANPUR NAGAR');
    // The onsite assessor is shown, not the desktop one.
    expect(el.textContent).toContain('Onsite Assessor');
    expect(el.textContent).not.toContain('Desk Assessor');
    expect(button('Change assessor').length).toBe(1);

    button('Accept')[0].click();
    await settle();
    http.expectOne('/api/staff/scheme-onsite/agency/31/assessors').flush([{ userId: 'OSA1', userName: 'Onsite Assessor' }]);
    await settle();
    expect(el.querySelector('zed-confirm-dialog')!.textContent).toContain('date of verification');
    await choose('OSA1');
    const accept = http.expectOne('/api/staff/scheme-onsite/agency/31/accept');
    expect(accept.request.body).toEqual({ assessorUserId: 'OSA1' });
    accept.flush({ message: 'Application accepted.' });
    await settle();
    http.expectOne((r) => r.url === '/api/staff/scheme-onsite/agency').flush({ rows: [], counts: {}, schemes: [], states: [] });
    await settle();
  });

  it('shows the onsite QC the onsite report and approves on the claim verified onsite', async () => {
    await open('/onsite/qc/41');
    http.expectOne('/api/staff/scheme-onsite/agency/41').flush({
      application: { ...row(41, 'Qc'), unitAddress: null, certNo: 'B-1', correctionRounds: 2, correctionDays: 30, agency: { userId: 'AG1', name: 'Desktop Agency' }, assessor: null,
        accountNo: null, ifscCode: null, branchAddress: null, bankName: null },
      sections: [], totals: { claimed: 70000, verified: 70000, eligible: 50000, sharePercent: 75, maxAmount: 50000 }, history: [],
      actions: { allot: false, hold: false, respond: false, qc: false, accept: false, check: false, correction: false, reject: false, recommend: false,
        roundsLeft: 0, checked: 0, checkable: 0, notValid: 0, onsiteQc: true },
      onsite: {
        agency: { userId: 'OS1', name: 'Onsite One' }, assessor: { userId: 'OSA1', name: 'Onsite Assessor' }, allotmentType: 'RoundRobin', allotmentDate: '2026-11-19T09:00:00',
        rejectedAgencies: null, visitStartedOn: '2026-11-20T10:30:00', visitSubmittedOn: '2026-11-20T12:00:00', latitude: '26.4', longitude: '80.3',
        representativeName: 'R Sharma', representativeMobile: '9876543210', remarks: 'All machines installed.', verifiedClaim: 60000, eligible: 45000,
        photosMin: 1, photosMax: 3,
        photos: [{ photoId: 'p1.jpg', kind: 'selfie', title: null, url: '/api/staff/scheme-onsite/agency/41/onsite-photos/p1.jpg', timeStamp: null, latitude: '26.4', longitude: '80.3', on: null },
          { photoId: 'p2.jpg', kind: 'item', title: 'Machines 1', url: '/api/staff/scheme-onsite/agency/41/onsite-photos/p2.jpg', timeStamp: null, latitude: null, longitude: null, on: null }],
        checks: [{ path: 'items/0/installed', label: 'Machine installed', value: 'Yes', status: 'No', remarks: 'Not yet installed', by: 'OSA1', on: null }],
      },
    });
    await settle();
    expect(el.textContent).toContain('Onsite verification');
    expect(el.querySelector('[data-visit]')!.textContent).toContain('20-Nov-2026');
    // The representative's mobile in full (signed-in page).
    expect(el.textContent).toContain('R Sharma · 9876543210');
    expect(el.querySelector('[data-onsite="eligible"]')!.textContent).toContain('45,000');
    expect(el.textContent).toContain('Selfie at the unit');
    expect(el.textContent).toContain('Machines 1');
    expect(el.textContent).toContain('Not yet installed');

    button('Approve')[0].click();
    await settle();
    expect(el.querySelector('zed-confirm-dialog')!.textContent).toContain('45,000');
    const amount = el.querySelector('zed-confirm-dialog textarea, zed-confirm-dialog input') as HTMLInputElement;
    amount.value = '45000';
    amount.dispatchEvent(new Event('input'));
    (el.querySelector('zed-confirm-dialog .cd-ok') as HTMLButtonElement).click();
    await settle();
    const approve = http.expectOne('/api/staff/scheme-onsite/agency/41/approve');
    expect(approve.request.body).toEqual({ amount: 45000 });
    approve.flush({ message: 'Application approved.' });
    await settle();
    http.expectOne('/api/staff/scheme-onsite/agency/41').flush(null);
    await settle();
  });

  it('lets the Master Admin allot an application waiting for an onsite agency', async () => {
    await open('/applications');
    http.expectOne('/api/staff/scheme-applications').flush({ rows: [row(51, 'OnsiteAllot')], counts: { OnsiteAllot: 1 }, schemes: [], states: [] });
    await settle();
    expect(el.textContent).toContain('Waiting for onsite agency');
    button('Allot onsite')[0].click();
    await settle();
    http.expectOne('/api/staff/scheme-applications/51/onsite-agencies').flush([{ userId: 'OS2', userName: 'Onsite Two', rejectedBefore: false }]);
    await settle();
    await choose('OS2');
    const allot = http.expectOne('/api/staff/scheme-applications/51/onsite-allot');
    expect(allot.request.body).toEqual({ agencyUserId: 'OS2' });
    allot.flush({ message: 'Application allotted.' });
    await settle();
    http.expectOne('/api/staff/scheme-applications').flush({ rows: [], counts: {}, schemes: [], states: [] });
    await settle();
  });

  it('lists the desktop and onsite agencies with their type, states, districts and schemes', async () => {
    await open('/staff/scheme-agencies');
    http.expectOne('/api/staff/scheme-agencies').flush([
      { userId: 'ZEDAA0099', userName: 'Onsite Partners', spocName: 'S K', email: 'spoc@onsite.test', mobileNo: '9876543210', isActive: true,
        states: [{ state: 'UTTAR PRADESH', districts: ['163', '164'] }, { state: 'GOA', districts: [] }], schemes: ['FA_ONSITE'], assessors: 2, type: 'Onsite' },
      { userId: 'ZEDAA0100', userName: 'Desk Partners', spocName: 'D K', email: 'spoc@desk.test', mobileNo: '9876543211', isActive: true,
        states: [{ state: 'GOA', districts: [] }], schemes: ['FA'], assessors: 1, type: 'Desktop' },
    ]);
    http.expectOne('/api/staff/scheme-agencies/options').flush({
      states: ['GOA', 'UTTAR PRADESH'], schemes: [{ code: 'FA_ONSITE', name: 'FA Onsite', active: true }], desktopSchemes: [{ code: 'FA', name: 'Financial Assistance', active: true }],
    });
    await settle();
    expect(el.textContent).toContain('Incentive Verification Agencies');
    expect(el.textContent).toContain('spoc@onsite.test · 9876543210');
    // 2026-11-26 (the user: every state on its own line "is not looking good"): a summary and the first states; scheme names.
    const area = el.querySelectorAll<HTMLButtonElement>('[data-area]');
    expect(area[0].textContent!.trim()).toBe('2 states · 2 districts · 1 whole');
    expect(el.querySelector('.oa-area-few')!.textContent).toContain('UTTAR PRADESH (2), GOA');
    expect(area[1].textContent!.trim()).toBe('1 state · whole');
    expect(el.textContent).toContain('FA Onsite');
    expect(el.textContent).not.toContain('FA_ONSITE');
    // The side panel: each state, its districts by name.
    area[0].click();
    await settle();
    http.expectOne((r) => r.url === '/api/staff/scheme-agencies/districts' && r.params.get('state') === 'UTTAR PRADESH')
      .flush([{ code: '163', name: 'KANPUR DEHAT' }, { code: '164', name: 'KANPUR NAGAR' }]);
    await settle();
    const drawer = el.querySelector('[data-drawer="agency-area-drawer"]')!;
    expect(drawer.querySelector('[data-area-summary]')!.textContent).toContain('2 states · 2 districts · 1 whole');
    expect(drawer.querySelector('[data-area-list]')!.textContent).toContain('KANPUR NAGAR');
    expect(drawer.textContent).toContain('Whole state');
    (drawer.querySelector('.ad-foot .btn-default') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('[data-drawer="agency-area-drawer"]')).toBeNull();
    expect(el.querySelector('[data-type="Desktop"]')!.textContent).toContain('Desktop verification');
    expect(el.querySelector('[data-type="Onsite"]')!.textContent).toContain('Onsite verification');

    // Filtered by type.
    const type = el.querySelector('.oa-type') as HTMLSelectElement;
    type.value = 'Desktop';
    type.dispatchEvent(new Event('change'));
    await settle();
    expect(el.textContent).toContain('Desk Partners');
    expect(el.textContent).not.toContain('Onsite Partners');
  });

  it('redirects the old onsite agencies address to the incentive agencies page', () => {
    expect(SCHEME_ONSITE_ROUTES.find((r) => r.path === 'agencies')?.redirectTo).toBe('/staff/scheme-agencies');
    expect(SCHEME_ONSITE_ROUTES.find((r) => r.path === 'agencies/:userId')?.redirectTo).toBe('/staff/scheme-agencies/:userId');
  });

  const fillDetails = () => {
    const fill = (id: string, v: string) => {
      const i = el.querySelector(id) as HTMLInputElement;
      i.value = v;
      i.dispatchEvent(new Event('input'));
    };
    fill('#of-name', 'Desk Partners');
    fill('#of-address', 'Lucknow');
    fill('#of-pin', '226001');
    fill('#of-spoc', 'D K');
    fill('#of-email', 'spoc@desk.test');
    fill('#of-mobile', '9876543211');
  };

  it('creates a desktop verification agency: the type first, then its schemes (every scheme)', async () => {
    await open('/staff/scheme-agencies/new');
    http.expectOne('/api/staff/scheme-agencies/options').flush({
      states: ['GOA'], schemes: [{ code: 'FA_ONSITE', name: 'FA Onsite', active: true }],
      desktopSchemes: [{ code: 'FA', name: 'Financial Assistance', active: true }, { code: 'FA_ONSITE', name: 'FA Onsite', active: true }],
    });
    await settle();
    expect(el.querySelectorAll('.of-scheme').length).toBe(0);
    expect(el.textContent).toContain('Choose the type of agency first.');
    fillDetails();
    const s = el.querySelector('.of-add select') as HTMLSelectElement;
    s.value = 'GOA';
    s.dispatchEvent(new Event('change'));
    await settle();
    button('Add state')[0].click();
    await settle();
    // Without a type the form refuses.
    (el.querySelector('#of-save') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('type of agency');
    // 2026-11-21 (UI audit F4): the message is also under the field (scrolled into view), and only there.
    expect([...el.querySelectorAll('.help-block')].map((h) => h.textContent!.trim())).toEqual([expect.stringContaining('type of agency')]);

    (el.querySelector('input[name="agencyType"][value="Desktop"]') as HTMLInputElement).click();
    await settle();
    expect(el.textContent).toContain('Schemes verified at the desktop');
    expect(el.querySelectorAll('.of-scheme').length).toBe(2);
    (el.querySelector('.of-scheme input') as HTMLInputElement).click();
    await settle();
    (el.querySelector('#of-save') as HTMLButtonElement).click();
    await settle();
    const create = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/scheme-agencies');
    expect(create.request.body).toEqual({
      userName: 'Desk Partners', spocName: 'D K', emailId: 'spoc@desk.test', mobileNo: '9876543211', address: 'Lucknow', pinCode: '226001', gstNumber: null,
      states: [{ state: 'GOA', districts: [] }], schemes: ['FA'], type: 'Desktop',
    });
    create.flush({ message: 'Agency created successfully.', userId: 'ZEDAA0100' });
    await settle();
    http.expectOne('/api/staff/scheme-agencies').flush([]);
    http.expectOne('/api/staff/scheme-agencies/options').flush({ states: [], schemes: [], desktopSchemes: [] });
    await settle();
  });

  it('adds every state at once with "All states", each as the whole state, and removes them all (2026-11-22)', async () => {
    await open('/staff/scheme-agencies/new');
    http.expectOne('/api/staff/scheme-agencies/options').flush({ states: ['GOA', 'KERALA', 'UTTAR PRADESH'], schemes: [], desktopSchemes: [] });
    await settle();
    const s = el.querySelector('.of-add select') as HTMLSelectElement;
    expect([...s.options].map((o) => o.textContent!.trim())).toEqual(['-- Add a state --', 'All states', 'GOA', 'KERALA', 'UTTAR PRADESH']);
    s.value = 'GOA';
    s.dispatchEvent(new Event('change'));
    await settle();
    button('Add state')[0].click();
    await settle();
    s.value = '*ALL*';
    s.dispatchEvent(new Event('change'));
    await settle();
    button('Add state')[0].click();
    await settle();
    expect([...el.querySelectorAll('.of-area')].map((a) => a.getAttribute('data-state'))).toEqual(['GOA', 'KERALA', 'UTTAR PRADESH']);
    expect([...el.querySelectorAll('.of-area input[type="radio"]:checked')].length).toBe(3);
    // Nothing is left to add: no "All states" any more.
    expect([...(el.querySelector('.of-add select') as HTMLSelectElement).options].map((o) => o.textContent!.trim())).toEqual(['-- Add a state --']);
    button('Remove all states')[0].click();
    await settle();
    expect(el.querySelectorAll('.of-area').length).toBe(0);
  });

  it('shows the type of an existing agency as fixed', async () => {
    await open('/staff/scheme-agencies/ZEDAA0100');
    http.expectOne('/api/staff/scheme-agencies/options').flush({ states: ['GOA'], schemes: [], desktopSchemes: [{ code: 'FA', name: 'Financial Assistance', active: true }] });
    await settle();
    http.expectOne('/api/staff/scheme-agencies/ZEDAA0100').flush({
      userId: 'ZEDAA0100', userName: 'Desk Partners', spocName: 'D K', email: 'spoc@desk.test', mobileNo: '9876543211', address: 'Lucknow', pinCode: '226001',
      gstNumber: null, isActive: true, reasonForRejection: null, states: [{ state: 'GOA', districts: [] }], schemes: ['FA'], type: 'Desktop',
    });
    await settle();
    expect(el.querySelector('[data-type-fixed]')!.textContent).toContain('Desktop verification');
    expect(el.querySelector('input[name="agencyType"]')).toBeNull();
    expect((el.querySelector('.of-scheme input') as HTMLInputElement).checked).toBe(true);
  });

  it('creates an onsite agency with the whole of one state and districts of another', async () => {
    await open('/staff/scheme-agencies/new');
    http.expectOne('/api/staff/scheme-agencies/options').flush({ states: ['GOA', 'UTTAR PRADESH'], schemes: [{ code: 'FA_ONSITE', name: 'FA Onsite', active: true }], desktopSchemes: [] });
    await settle();
    (el.querySelector('input[name="agencyType"][value="Onsite"]') as HTMLInputElement).click();
    await settle();
    const fill = (id: string, v: string) => {
      const i = el.querySelector(id) as HTMLInputElement;
      i.value = v;
      i.dispatchEvent(new Event('input'));
    };
    fill('#of-name', 'Onsite Partners');
    fill('#of-address', 'Kanpur');
    fill('#of-pin', '208001');
    fill('#of-spoc', 'S K');
    fill('#of-email', 'spoc@onsite.test');
    fill('#of-mobile', '9876543210');
    const pick = async (state: string) => {
      const s = el.querySelector('.of-add select') as HTMLSelectElement;
      s.value = state;
      s.dispatchEvent(new Event('change'));
      await settle();
      button('Add state')[0].click();
      await settle();
    };
    await pick('GOA');
    await pick('UTTAR PRADESH');
    const up = el.querySelector('[data-state="UTTAR PRADESH"]')!;
    (up.querySelectorAll('input[type="radio"]')[1] as HTMLInputElement).click();
    await settle();
    http.expectOne((r) => r.url === '/api/staff/scheme-agencies/districts' && r.params.get('state') === 'UTTAR PRADESH')
      .flush([{ code: '163', name: 'KANPUR DEHAT' }, { code: '164', name: 'KANPUR NAGAR' }]);
    await settle();
    const nagar = [...el.querySelectorAll('[data-state="UTTAR PRADESH"] .of-districts label')].find((l) => text(l) === 'KANPUR NAGAR')!;
    (nagar.querySelector('input') as HTMLInputElement).click();
    await settle();
    (el.querySelector('.of-scheme input') as HTMLInputElement).click();
    await settle();
    (el.querySelector('#of-save') as HTMLButtonElement).click();
    await settle();
    const create = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/scheme-agencies');
    expect(create.request.body).toEqual({
      userName: 'Onsite Partners', spocName: 'S K', emailId: 'spoc@onsite.test', mobileNo: '9876543210', address: 'Kanpur', pinCode: '208001', gstNumber: null,
      states: [{ state: 'GOA', districts: [] }, { state: 'UTTAR PRADESH', districts: ['164'] }], schemes: ['FA_ONSITE'], type: 'Onsite',
    });
    create.flush({ message: 'Agency created successfully.', userId: 'ZEDAA0099' });
    await settle();
    http.expectOne('/api/staff/scheme-agencies').flush([]);
    http.expectOne('/api/staff/scheme-agencies/options').flush({ states: [], schemes: [], desktopSchemes: [] });
    await settle();
  });
});
