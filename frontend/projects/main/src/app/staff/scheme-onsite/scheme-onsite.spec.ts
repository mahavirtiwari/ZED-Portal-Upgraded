import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { SchemeDetailPage } from '../scheme-verification/scheme-detail';
import { SchemeListPage } from '../scheme-verification/scheme-list';
import { OnsiteAgenciesPage } from './onsite-agencies';
import { OnsiteAgencyFormPage } from './onsite-agency-form';

/** 2026-11-20 (incentive schemes, phase 2): the onsite verification pages (onsite agency lists, Master Admin's onsite agencies). */
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
          { path: 'staff/scheme-onsite/agencies', component: OnsiteAgenciesPage },
          { path: 'staff/scheme-onsite/agencies/new', component: OnsiteAgencyFormPage },
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

  it('lists the onsite agencies with their states, districts and schemes', async () => {
    await open('/staff/scheme-onsite/agencies');
    http.expectOne('/api/staff/scheme-onsite/agencies').flush([
      { userId: 'ZEDAA0099', userName: 'Onsite Partners', spocName: 'S K', email: 'spoc@onsite.test', mobileNo: '9876543210', isActive: true,
        states: [{ state: 'UTTAR PRADESH', districts: ['163', '164'] }, { state: 'GOA', districts: [] }], schemes: ['FA_ONSITE'], assessors: 2 },
    ]);
    await settle();
    expect(el.textContent).toContain('Onsite Verification Agencies');
    expect(el.textContent).toContain('2 district(s)');
    expect(el.textContent).toContain('whole state');
    expect(el.textContent).toContain('spoc@onsite.test · 9876543210');
    expect(el.textContent).toContain('FA_ONSITE');
  });

  it('creates an onsite agency with the whole of one state and districts of another', async () => {
    await open('/staff/scheme-onsite/agencies/new');
    http.expectOne('/api/staff/scheme-onsite/agencies/options').flush({ states: ['GOA', 'UTTAR PRADESH'], schemes: [{ code: 'FA_ONSITE', name: 'FA Onsite', active: true }] });
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
    http.expectOne((r) => r.url === '/api/staff/scheme-onsite/agencies/districts' && r.params.get('state') === 'UTTAR PRADESH')
      .flush([{ code: '163', name: 'KANPUR DEHAT' }, { code: '164', name: 'KANPUR NAGAR' }]);
    await settle();
    const nagar = [...el.querySelectorAll('[data-state="UTTAR PRADESH"] .of-districts label')].find((l) => text(l) === 'KANPUR NAGAR')!;
    (nagar.querySelector('input') as HTMLInputElement).click();
    await settle();
    (el.querySelector('.of-scheme input') as HTMLInputElement).click();
    await settle();
    (el.querySelector('#of-save') as HTMLButtonElement).click();
    await settle();
    const create = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/scheme-onsite/agencies');
    expect(create.request.body).toEqual({
      userName: 'Onsite Partners', spocName: 'S K', emailId: 'spoc@onsite.test', mobileNo: '9876543210', address: 'Kanpur', pinCode: '208001', gstNumber: null,
      states: [{ state: 'GOA', districts: [] }, { state: 'UTTAR PRADESH', districts: ['164'] }], schemes: ['FA_ONSITE'],
    });
    create.flush({ message: 'Agency created successfully.', userId: 'ZEDAA0099' });
    await settle();
    http.expectOne('/api/staff/scheme-onsite/agencies').flush([]);
    await settle();
  });
});
