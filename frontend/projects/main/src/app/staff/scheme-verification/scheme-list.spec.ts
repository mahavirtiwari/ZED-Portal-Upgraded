import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ToastService } from '../toast';
import { SchemeListPage } from './scheme-list';

describe('SchemeListPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let el: HTMLElement;

  const row = (id: number, status: string, extra: Record<string, unknown> = {}) => ({
    id, zedId: `ZEDMSME0000${id}`, unitName: `Unit ${id}`, state: 'UTTAR PRADESH', schemeCode: 'TU_DIRECT', schemeName: 'Technology Upgradation (direct)',
    level: 'Bronze', levelName: 'Bronze', status, claimAmount: 70000, eligibleAmount: null, approvedAmount: null, submittedOn: '2026-11-18T10:00:00',
    decidedOn: null, correctionRound: 0, correctionDueOn: null, holdReason: null, agency: null, agencyName: null, assessor: null, assessorName: null,
    allotmentType: null, reasonForRejection: null, agencyRemarks: null, assessorAcceptedOn: null, ...extra,
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
          { path: 'allotment', data: { mode: 'allotment' }, component: SchemeListPage },
        ]),
        provideHttpClient(), provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, SchemeListPage);
    el = harness.routeNativeElement!;
    await settle();
  }

  afterEach(() => http.verify());

  it('shows the Master Admin every application with counts, filters and the allot pop-up', async () => {
    await open('/applications');
    const list = http.expectOne((r) => r.url === '/api/staff/scheme-applications');
    expect(list.request.params.keys().length).toBe(0);
    list.flush({
      rows: [row(11, 'Submitted'), row(12, 'OnHold', { holdReason: 'Certificate B-1 SUSPENDED (was Verifying)', agency: 'AG1', agencyName: 'Agency One' })],
      counts: { Submitted: 1, OnHold: 1, Paid: 3 }, schemes: [{ code: 'TU_DIRECT', name: 'Technology Upgradation (direct)' }], states: ['UTTAR PRADESH'],
    });
    await settle();

    expect(el.textContent).toContain('Scheme Applications');
    expect(el.textContent).toContain('Waiting for allotment');
    expect(el.textContent).toContain('On hold');
    expect(el.querySelectorAll('tbody tr').length).toBe(2);
    expect(button('Allot').length).toBe(1);
    expect(button('Resume').length).toBe(1);

    // A count tile filters by its status.
    const tile = [...el.querySelectorAll('.lc-btn')].find((b) => text(b).includes('Paid')) as HTMLElement;
    tile.click();
    await settle();
    const filtered = http.expectOne((r) => r.url === '/api/staff/scheme-applications');
    expect(filtered.request.params.get('status')).toBe('Paid');
    filtered.flush({ rows: [], counts: {}, schemes: [], states: [] });
    await settle();
    expect(el.textContent).toContain('No application here.');
  });

  it('allots a submitted application to an agency', async () => {
    await open('/applications');
    http.expectOne('/api/staff/scheme-applications').flush({ rows: [row(11, 'Submitted')], counts: { Submitted: 1 }, schemes: [], states: [] });
    await settle();
    const toast = vi.spyOn(TestBed.inject(ToastService), 'success');

    button('Allot')[0].click();
    await settle();
    http.expectOne('/api/staff/scheme-applications/11/agencies').flush([
      { userId: 'AG1', userName: 'Agency One', rejectedBefore: false },
      { userId: 'AG2', userName: 'Agency Two', rejectedBefore: true },
    ]);
    await settle();
    const select = el.querySelector('zed-confirm-dialog select') as HTMLSelectElement;
    expect(select.options.length).toBe(3);
    select.value = 'AG2';
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(el.textContent).toContain('This agency returned the application before.');
    (el.querySelector('zed-confirm-dialog .cd-ok') as HTMLButtonElement).click();
    await settle();
    const allot = http.expectOne('/api/staff/scheme-applications/11/allot');
    expect(allot.request.body).toEqual({ agencyUserId: 'AG2' });
    allot.flush({ message: 'Application allotted.' });
    await settle();
    http.expectOne('/api/staff/scheme-applications').flush({ rows: [], counts: {}, schemes: [], states: [] });
    await settle();
    expect(toast).toHaveBeenCalledWith('Application allotted.');
    expect(el.querySelector('zed-confirm-dialog')).toBeNull();
  });

  it('lets the agency accept with an assessor and reject with a listed reason', async () => {
    await open('/allotment');
    const list = http.expectOne((r) => r.url === '/api/staff/scheme-verification/agency');
    expect(list.request.params.get('status')).toBe('WithAgency');
    list.flush({ rows: [row(21, 'WithAgency', { agency: 'AG1' })], counts: { WithAgency: 1 }, schemes: [], states: [] });
    await settle();
    expect(el.textContent).toContain('Scheme Allotment');

    button('Accept')[0].click();
    await settle();
    http.expectOne('/api/staff/scheme-verification/agency/21/assessors').flush([{ userId: 'DA1', userName: 'Assessor One' }]);
    await settle();
    // Nothing chosen: the pop-up says so and sends nothing.
    (el.querySelector('zed-confirm-dialog .cd-ok') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('zed-confirm-dialog')!.textContent).toContain('Please select an assessor.');
    const select = el.querySelector('zed-confirm-dialog select') as HTMLSelectElement;
    select.value = 'DA1';
    select.dispatchEvent(new Event('change'));
    (el.querySelector('zed-confirm-dialog .cd-ok') as HTMLButtonElement).click();
    await settle();
    const accept = http.expectOne('/api/staff/scheme-verification/agency/21/accept');
    expect(accept.request.body).toEqual({ assessorUserId: 'DA1' });
    accept.flush({ message: 'Application accepted.' });
    await settle();
    http.expectOne((r) => r.url === '/api/staff/scheme-verification/agency').flush({ rows: [row(21, 'WithAgency', { agency: 'AG1' })], counts: {}, schemes: [], states: [] });
    await settle();

    // Reject: in the ⋮ menu, with a reason of the Admin's list and optional remarks.
    (el.querySelector('tbody .rm-btn') as HTMLButtonElement).click();
    await settle();
    ([...el.querySelectorAll('.rm-item')].find((b) => text(b) === 'Reject') as HTMLButtonElement).click();
    await settle();
    http.expectOne('/api/staff/scheme-verification/agency/rejection-reasons').flush([
      { id: 'conflict', text: 'Conflict of interest with the unit', action: 'Auto', active: true },
      { id: 'other', text: 'Other', action: 'MasterAdmin', active: true },
    ]);
    await settle();
    const reason = el.querySelector('zed-confirm-dialog select') as HTMLSelectElement;
    reason.value = 'other';
    reason.dispatchEvent(new Event('change'));
    await settle();
    expect(el.textContent).toContain('goes back to the ZED team');
    const remarks = el.querySelector('zed-confirm-dialog textarea') as HTMLTextAreaElement;
    remarks.value = 'Wrong address';
    remarks.dispatchEvent(new Event('input'));
    (el.querySelector('zed-confirm-dialog .cd-ok') as HTMLButtonElement).click();
    await settle();
    const reject = http.expectOne('/api/staff/scheme-verification/agency/21/reject');
    expect(reject.request.body).toEqual({ reasonId: 'other', remarks: 'Wrong address' });
    reject.flush({ message: 'Application rejected. It goes back to the ZED team for allotment.' });
    await settle();
    http.expectOne((r) => r.url === '/api/staff/scheme-verification/agency').flush({ rows: [], counts: {}, schemes: [], states: [] });
    await settle();
  });
});
