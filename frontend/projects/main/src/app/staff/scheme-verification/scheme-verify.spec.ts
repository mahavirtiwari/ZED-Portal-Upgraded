import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { SchemeVerifyPage } from './scheme-verify';

describe('SchemeVerifyPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let el: HTMLElement;

  const text = (b: Element) => b.textContent!.replace(/\s+/g, ' ').trim();
  const button = (start: string) => [...el.querySelectorAll('button')].find((b) => text(b).startsWith(start)) as HTMLButtonElement;

  function detail(opts: { status?: string; docCheck?: { status: 'Yes' | 'No'; remarks: string | null } | null; accepted?: boolean; round?: number; bank?: boolean } = {}) {
    const status = opts.status ?? 'Verifying';
    const open = status === 'Verifying' && opts.accepted !== false;
    return {
      application: {
        id: 900, zedId: 'ZEDMSME000020', unitName: 'Acme Castings', unitAddress: 'Plot 4, Kanpur', schemeCode: 'TU_DIRECT', schemeName: 'Technology Upgradation (direct)',
        level: 'Bronze', levelName: 'Bronze', certNo: 'B-1', status, claimAmount: 70000, eligibleAmount: null, approvedAmount: null, correctionRound: opts.round ?? 0,
        correctionRounds: 2, correctionDays: 30, correctionDueOn: null, submittedOn: '2026-11-18T10:00:00', decidedOn: null, holdReason: null,
        agency: { userId: 'AG1', name: 'Agency One' }, assessor: { userId: 'DA1', name: 'Assessor One' }, assessorAcceptedOn: open ? '2026-11-19T10:00:00' : null,
        allotmentType: 'RoundRobin', reasonForRejection: null, agencyRemarks: null, accountNo: '123456789012', ifscCode: 'SBIN0001234', branchAddress: 'Kanpur', bankName: 'SBI',
      },
      sections: [{
        key: 'technologies', title: 'Technologies', repeating: true,
        items: [{
          index: 0, pick: 'T1', pickName: 'Solar panels', fields: [
            { key: 'amount_paid', label: 'Amount Paid', type: 'amount', value: '70000', files: [], path: 'technologies/0/amount_paid', isClaim: true,
              check: { status: 'Yes', remarks: null, round: 0, by: 'DA1', on: '2026-11-19T10:00:00' } },
            { key: 'invoice_copy', label: 'Copy of Invoice', type: 'document', value: null, path: 'technologies/0/invoice_copy', isClaim: false,
              files: [{ name: 'a.pdf', url: '/api/staff/scheme-verification/assessor/900/files/a.pdf', isPdf: true }], check: opts.docCheck ?? null },
            { key: 'supplier', label: 'Agency/Supplier', type: 'text', value: 'Sun Ltd', files: [], path: null, isClaim: false, check: null },
          ],
        }],
      }, ...(opts.bank ? [{
        key: '_bank', title: 'Bank', repeating: false,
        items: [{ index: 0, pick: null, pickName: null, fields: [
          { key: 'account', label: 'Bank account details', type: 'text', value: '123456789012, SBIN0001234, SBI, Kanpur', files: [], path: '_bank/0/account', isClaim: false, check: null },
        ] }],
      }] : [])],
      totals: { claimed: 70000, verified: 70000, eligible: 56000, sharePercent: 80, maxAmount: 300000 },
      history: [],
      actions: {
        allot: false, hold: false, respond: false, qc: false, accept: status === 'WithAssessor', check: open, correction: false, reject: open, recommend: false,
        roundsLeft: 2 - (opts.round ?? 0), checked: opts.docCheck ? 2 : 1, checkable: 2, notValid: opts.docCheck?.status === 'No' ? 1 : 0,
        correctionRejects: (opts.round ?? 0) >= 2 && opts.docCheck?.status === 'No',
      },
    };
  }

  async function settle() {
    harness.detectChanges();
    await new Promise((r) => setTimeout(r));
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  async function open() {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'verification/:id', component: SchemeVerifyPage }]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/verification/900', SchemeVerifyPage);
    el = harness.routeNativeElement!;
    await settle();
  }

  afterEach(() => http.verify());

  it('shows each answer and document with its check, the document link and the totals', async () => {
    await open();
    http.expectOne('/api/staff/scheme-verification/assessor/900').flush(detail());
    await settle();

    expect(el.textContent).toContain('Solar panels');
    expect(el.querySelector('a[href="/api/staff/scheme-verification/assessor/900/files/a.pdf"]')).not.toBeNull();
    expect(text(el.querySelector('[data-total="claimed"]')!)).toBe('Rs. 70,000');
    expect(text(el.querySelector('[data-total="eligible"]')!)).toBe('Rs. 56,000');
    expect(text(el.querySelector('[data-progress]')!)).toContain('Checked 1 of 2 · not valid 0');
    // A field the scheme does not check has no Valid / Not valid choice.
    expect(el.querySelectorAll('input[type="radio"]').length).toBe(4);
    expect(button('Recommend').disabled).toBe(true);
    expect(button('Send for correction (round 1 of 2)').disabled).toBe(true);
  });

  it('marks a document not valid with a remark, saves it and sends the application for correction', async () => {
    await open();
    http.expectOne('/api/staff/scheme-verification/assessor/900').flush(detail());
    await settle();

    (el.querySelector('input[type="radio"][name="c-technologies/0/invoice_copy"][value="No"]') as HTMLInputElement).click();
    await settle();
    expect(text(el.querySelector('[data-progress]')!)).toContain('Checked 2 of 2 · not valid 1');
    expect(button('Send for correction').disabled).toBe(false);

    // Without the remark nothing is sent.
    button('Send for correction').click();
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Please write what is not valid');

    const remark = el.querySelector('input[data-path="technologies/0/invoice_copy"]') as HTMLInputElement;
    remark.value = 'Invoice is not legible';
    remark.dispatchEvent(new Event('input'));
    await settle();
    button('Send for correction').click();
    await settle();
    const save = http.expectOne('/api/staff/scheme-verification/assessor/900/checks');
    expect(save.request.method).toBe('PUT');
    expect(save.request.body).toEqual({ checks: [{ path: 'technologies/0/invoice_copy', status: 'No', remarks: 'Invoice is not legible' }] });
    save.flush({ message: 'Checks saved.' });
    await settle();
    http.expectOne('/api/staff/scheme-verification/assessor/900').flush(detail({ docCheck: { status: 'No', remarks: 'Invoice is not legible' } }));
    await settle();

    const dialog = el.querySelector('zed-confirm-dialog')!;
    expect(dialog.textContent).toContain('Round 1 of 2');
    (dialog.querySelector('.cd-ok') as HTMLButtonElement).click();
    await settle();
    const decide = http.expectOne('/api/staff/scheme-verification/assessor/900/decision');
    expect(decide.request.body).toEqual({ decision: 'correction', reason: null });
    decide.flush({ message: 'Sent to the unit for correction (round 1 of 2).' });
    await settle();
    http.expectOne('/api/staff/scheme-verification/assessor/900').flush(detail({ status: 'Correction', docCheck: { status: 'No', remarks: 'Invoice is not legible' } }));
    await settle();
    expect(el.textContent).toContain('Correction with unit');
    expect(el.querySelector('[data-progress]')).toBeNull();
  });

  it('recommends once everything is valid, and rejects with a reason', async () => {
    await open();
    http.expectOne('/api/staff/scheme-verification/assessor/900').flush(detail({ docCheck: { status: 'Yes', remarks: null } }));
    await settle();
    expect(button('Recommend').disabled).toBe(false);
    button('Recommend').click();
    await settle();
    expect(el.querySelector('zed-confirm-dialog')!.textContent).toContain('eligible amount Rs. 56,000');
    (el.querySelector('zed-confirm-dialog .cd-ok') as HTMLButtonElement).click();
    await settle();
    http.expectOne('/api/staff/scheme-verification/assessor/900/decision').flush({ message: 'Recommended.' });
    await settle();
    http.expectOne('/api/staff/scheme-verification/assessor/900').flush(detail({ docCheck: { status: 'Yes', remarks: null } }));
    await settle();

    button('Reject').click();
    await settle();
    // The reason is required.
    (el.querySelector('zed-confirm-dialog .cd-ok') as HTMLButtonElement).click();
    await settle();
    const reason = el.querySelector('zed-confirm-dialog textarea') as HTMLTextAreaElement;
    reason.value = 'Invoices are not genuine';
    reason.dispatchEvent(new Event('input'));
    (el.querySelector('zed-confirm-dialog .cd-ok') as HTMLButtonElement).click();
    await settle();
    const decide = http.expectOne('/api/staff/scheme-verification/assessor/900/decision');
    expect(decide.request.body).toEqual({ decision: 'reject', reason: 'Invoices are not genuine' });
    decide.flush({ message: 'Application rejected.' });
    await settle();
    http.expectOne('/api/staff/scheme-verification/assessor/900').flush(detail({ status: 'Rejected' }));
    await settle();
  });

  it('with no correction round left, says so on the button and rejects after a confirmation', async () => {
    await open();
    http.expectOne('/api/staff/scheme-verification/assessor/900').flush(detail({ round: 2, docCheck: { status: 'No', remarks: 'Invoice is not legible' } }));
    await settle();
    expect(el.textContent).not.toContain('Send for correction');
    const auto = button('Reject (no correction round left)');
    expect(auto.disabled).toBe(false);
    auto.click();
    await settle();
    const dialog = el.querySelector('zed-confirm-dialog')!;
    expect(dialog.textContent).toContain('Not valid after the last correction round');
    expect(dialog.textContent).toContain('may apply again');
    (dialog.querySelector('.cd-ok') as HTMLButtonElement).click();
    await settle();
    const decide = http.expectOne('/api/staff/scheme-verification/assessor/900/decision');
    expect(decide.request.body).toEqual({ decision: 'correction', reason: null });
    decide.flush({ message: 'No correction round was left: the application has been rejected. The unit may apply again.' });
    await settle();
    http.expectOne('/api/staff/scheme-verification/assessor/900').flush(detail({ status: 'Rejected', round: 2 }));
    await settle();
  });

  it('lets the assessor check the bank account details', async () => {
    await open();
    http.expectOne('/api/staff/scheme-verification/assessor/900').flush(detail({ bank: true }));
    await settle();
    expect(el.textContent).toContain('Bank account details');
    expect(el.textContent).toContain('123456789012, SBIN0001234, SBI, Kanpur');
    expect(el.querySelector('input[type="radio"][name="c-_bank/0/account"][value="No"]')).not.toBeNull();
  });

  it('asks the assessor to accept or return an application first', async () => {
    await open();
    http.expectOne('/api/staff/scheme-verification/assessor/900').flush(detail({ status: 'WithAssessor', accepted: false }));
    await settle();
    expect(el.querySelectorAll('input[type="radio"]').length).toBe(0);
    button('Accept').click();
    await settle();
    (el.querySelector('zed-confirm-dialog .cd-ok') as HTMLButtonElement).click();
    await settle();
    http.expectOne('/api/staff/scheme-verification/assessor/900/accept').flush({ message: 'Application accepted.' });
    await settle();
    http.expectOne('/api/staff/scheme-verification/assessor/900').flush(detail());
    await settle();
    expect(el.querySelectorAll('input[type="radio"]').length).toBe(4);
  });
});
