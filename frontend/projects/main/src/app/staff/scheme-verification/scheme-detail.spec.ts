import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { SchemeDetailPage } from './scheme-detail';
import { SCHEME_VERIFICATION_ROUTES } from './scheme-verification.routes';
import { SchemeTicksPanel } from './scheme-ticks-panel';

describe('SchemeDetailPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let el: HTMLElement;

  const text = (b: Element) => b.textContent!.replace(/\s+/g, ' ').trim();
  const button = (label: string) => [...el.querySelectorAll('button')].find((b) => text(b) === label) as HTMLButtonElement;

  async function settle() {
    harness.detectChanges();
    await new Promise((r) => setTimeout(r));
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  const detail = (status: string, actions: Record<string, unknown>) => ({
    application: {
      id: 900, zedId: 'ZEDMSME000020', unitName: 'Acme Castings', unitAddress: null, schemeCode: 'TU_DIRECT', schemeName: 'Technology Upgradation (direct)',
      level: 'Bronze', levelName: 'Bronze', certNo: 'B-1', status, claimAmount: 70000, eligibleAmount: 50000, approvedAmount: null, correctionRound: 1,
      correctionRounds: 2, correctionDays: 30, correctionDueOn: null, submittedOn: '2026-11-18T10:00:00', decidedOn: null,
      holdReason: status === 'OnHold' ? 'Certificate B-1 SUSPENDED (was Verifying)' : null, agency: { userId: 'AG1', name: 'Agency One' },
      assessor: { userId: 'DA1', name: 'Assessor One' }, assessorAcceptedOn: null, allotmentType: 'RoundRobin', reasonForRejection: null, agencyRemarks: null,
      accountNo: null, ifscCode: null, branchAddress: null, bankName: null,
    },
    sections: [{ key: 'items', title: 'Items', repeating: false, items: [{ index: 0, pick: null, pickName: null, fields: [
      { key: 'amount', label: 'Amount', type: 'amount', value: '70000', files: [], path: 'items/0/amount', isClaim: true, check: { status: 'No', remarks: 'Does not match', round: 1, by: 'DA1', on: null } },
    ] }] }],
    totals: { claimed: 70000, verified: 0, eligible: 0, sharePercent: 75, maxAmount: 50000 },
    history: [{ on: '2026-11-19T10:00:00', text: 'Scheme application on hold' }],
    actions: { allot: false, hold: false, respond: false, qc: false, accept: false, check: false, correction: false, reject: false, recommend: false, roundsLeft: 1, checked: 1, checkable: 1, notValid: 1, ...actions },
  });

  afterEach(() => http.verify());

  it('lets the Master Admin resume an application on hold and shows the checks read-only', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'applications/:id', data: { mode: 'admin' }, component: SchemeDetailPage }]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/applications/900', SchemeDetailPage);
    el = harness.routeNativeElement!;
    await settle();
    http.expectOne('/api/staff/scheme-applications/900').flush(detail('OnHold', { hold: true }));
    await settle();

    expect(el.textContent).toContain('On hold: Certificate B-1 SUSPENDED (was Verifying)');
    expect(el.textContent).toContain('Does not match');
    expect(el.querySelectorAll('input[type="radio"]').length).toBe(0);
    expect(el.textContent).toContain('Scheme application on hold');

    button('Resume').click();
    await settle();
    (el.querySelector('zed-confirm-dialog .cd-ok') as HTMLButtonElement).click();
    await settle();
    http.expectOne('/api/staff/scheme-applications/900/resume').flush({ message: 'Application resumed.' });
    await settle();
    http.expectOne('/api/staff/scheme-applications/900').flush(detail('Verifying', {}));
    await settle();
    expect(button('Resume')).toBeUndefined();
  });

  it('lets the agency approve an amount in QC', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'qc/:id', data: { mode: 'qc' }, component: SchemeDetailPage }]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/qc/900', SchemeDetailPage);
    el = harness.routeNativeElement!;
    await settle();
    const d = detail('Qc', { qc: true });
    d.totals.eligible = 50000;
    http.expectOne('/api/staff/scheme-verification/agency/900').flush(d);
    await settle();

    button('Approve').click();
    await settle();
    expect(el.querySelector('zed-confirm-dialog')!.textContent).toContain('Rs. 50,000');
    const amount = el.querySelector('zed-confirm-dialog textarea') as HTMLTextAreaElement;
    amount.value = '45,000';
    amount.dispatchEvent(new Event('input'));
    (el.querySelector('zed-confirm-dialog .cd-ok') as HTMLButtonElement).click();
    await settle();
    const approve = http.expectOne('/api/staff/scheme-verification/agency/900/approve');
    expect(approve.request.body).toEqual({ amount: 45000 });
    approve.flush({ message: 'Application approved.' });
    await settle();
    http.expectOne('/api/staff/scheme-verification/agency/900').flush(detail('Approved', {}));
    await settle();
  });

  it('exports the routes of the four screens with role guards', () => {
    expect(SCHEME_VERIFICATION_ROUTES.map((r) => r.path)).toEqual(['applications', 'allotment', 'qc', 'verification']);
    expect(SCHEME_VERIFICATION_ROUTES.every((r) => (r.canActivate?.length ?? 0) === 1)).toBe(true);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  it('opens the scheme ticks on demand and saves them', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(SchemeTicksPanel);
    fixture.componentRef.setInput('kind', 'assessors');
    fixture.componentRef.setInput('userId', 'DA1');
    fixture.detectChanges();
    await fixture.whenStable();
    el = fixture.nativeElement;
    // Nothing is loaded until it is opened.
    http.expectNone('/api/staff/users/assessors/DA1/schemes');
    ([...el.querySelectorAll('button')].find((b) => text(b) === 'Show') as HTMLButtonElement).click();
    fixture.detectChanges();
    http.expectOne('/api/staff/users/assessors/DA1/schemes').flush({
      userId: 'DA1', userName: 'Assessor One', canEdit: true,
      schemes: [{ code: 'TU_DIRECT', name: 'Technology Upgradation (direct)', desktop: false, onsite: false, canDesktop: true, canOnsite: false }],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const boxes = el.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
    expect(boxes[1].disabled).toBe(true);
    boxes[0].click();
    fixture.detectChanges();
    ([...el.querySelectorAll('button')].find((b) => text(b) === 'Save schemes') as HTMLButtonElement).click();
    const save = http.expectOne('/api/staff/users/assessors/DA1/schemes');
    expect(save.request.method).toBe('PUT');
    expect(save.request.body).toEqual({ ticks: [{ code: 'TU_DIRECT', desktop: true, onsite: false }] });
    save.flush({ message: 'Scheme verification saved.' });
  });
});
