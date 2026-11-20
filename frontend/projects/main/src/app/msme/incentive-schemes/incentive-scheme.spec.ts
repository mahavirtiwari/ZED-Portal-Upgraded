import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { IncentiveSchemePage } from './incentive-scheme';
import { SchemeApplication, SchemePage } from './incentive-schemes.api';
import { claimOf, dateBound, eligibleOf } from './incentive-schemes.api';

const URL = '/api/msme/incentive-schemes/TU_DIRECT';

function page(application: Partial<SchemeApplication> | null = null, more: Partial<SchemePage> = {}): SchemePage {
  return {
    scheme: {
      code: 'TU_DIRECT', name: 'Technology Upgradation (direct)',
      card: { title: 'Technology Upgradation', highlight: 'Support of upto Rs. 3,00,000/-', details: null, icon: 'zap' },
      blocks: { disclaimer: true, instructions: true, unitConfirm: true, bankAccount: true, declaration: true },
      sections: [{
        key: 'technologies', title: 'Technologies', repeating: true, minItems: 1, maxItems: 3,
        pick: { kind: 'Technologies', label: 'Technology', noRepeat: true },
        fields: [
          { key: 'manufacturer', label: 'Name of Manufacturer', type: 'text', required: true, maxLength: 500 },
          { key: 'purchased_on', label: 'Date of Purchase', type: 'date', required: true, dateMin: 'certified', dateMax: 'today' },
          { key: 'amount_paid', label: 'Amount Paid', type: 'amount', required: true, isClaim: true },
          { key: 'invoice_copy', label: 'Copy of Invoice', type: 'document', required: true, maxFiles: 1 },
        ],
      }],
      rules: [],
      grading: { mode: 'Size', rows: [{ key: 'Micro', sharePercent: 80, maxAmount: 300000 }] },
      activationMode: 'Levels', activationLevels: ['Bronze', 'Silver', 'Gold'], correctionRounds: 2, correctionDays: 30,
    },
    unit: { ZedId: 'ZEDMSME000001', EnterpriseName: 'Acme Castings', EnterpriseType: 'Micro', UdyogAadharNo: 'UDYAM-UP-29-0003915' },
    window: { level: 'Bronze', certRef: 'B-1', openedOn: '2026-11-01', grade: { sharePercent: 80, maxAmount: 300000 } },
    state: 'open', note: null, canApply: true, message: null,
    application: application ? {
      id: 101, status: 'Draft', level: 'Bronze', answers: { sections: {} }, checks: [], claimAmount: 0, eligibleAmount: 0, approvedAmount: null,
      sharePercent: null, maxAmount: null, correctionRound: null, correctionDueOn: null, correctionOpen: false, submittedOn: null, decidedOn: null,
      reason: null, holdReason: null, account: null, ...application,
    } : null,
    picks: { technologies: [{ code: 'T1', name: 'Solar rooftop', description: null }, { code: 'T2', name: 'LED lighting', description: null }] },
    history: [],
    ...more,
  };
}

const item = (pick: string, amount: string) => ({
  pick, pickName: pick === 'T1' ? 'Solar rooftop' : 'LED lighting', saved: true,
  values: { manufacturer: 'Acme', purchased_on: '2026-11-05', amount_paid: amount, invoice_copy: '["20261105101010000abcdef01.pdf"]' },
});

describe('IncentiveSchemePage', () => {
  let fixture: ComponentFixture<IncentiveSchemePage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  type Page = {
    next(): Promise<void>;
    go(i: number): Promise<void>;
    consent: { set(v: boolean): void };
    unitConfirmed: { set(v: boolean): void };
    declaration: { set(v: boolean): void };
    setPick(v: string): void;
    setValue(k: string, v: string | null): void;
    setAccount(k: string, v: string): void;
    setCheque(v: string | null): void;
    claim(): number;
    eligible(): number;
  };
  const p = () => fixture.componentInstance as unknown as Page;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function open(reply: SchemePage) {
    fixture = TestBed.createComponent(IncentiveSchemePage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne(URL).flush(reply);
    await settle();
  }

  const button = (id: string) => el.querySelector(`#${id}`) as HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IncentiveSchemePage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ code: 'TU_DIRECT' }) } } }],
    }).compileComponents();
    window.scrollTo = () => undefined;
  });

  afterEach(() => http?.verify());

  it('works out the claim, the eligible amount and the date bounds as the server does', () => {
    const sections = page().scheme.sections;
    expect(claimOf(sections, { sections: { technologies: [item('T1', '300000.75'), item('T2', '200000'), { ...item('T2', '5'), saved: false }] } })).toBe(500000.75);
    expect(eligibleOf(500000.75, { sharePercent: 80, maxAmount: 300000 })).toBe(300000);
    expect(eligibleOf(1000.9, { sharePercent: 75, maxAmount: 50000 })).toBe(750);
    expect(dateBound('certified', '2026-11-01', false)).toBe('2026-11-01');
    expect(dateBound('days:10', null, false, new Date(2026, 10, 20))).toBe('2026-11-10');
    expect(dateBound('date:2020-01-31', null, true)).toBe('2020-01-31');
  });

  it('walks the steps: disclaimer, instructions, unit, the items, the bank account and the summary, then submits', async () => {
    await open(page());
    // The scheme's disclaimer from the Texts (the schemes' common one inside, until the Admin writes one).
    expect(el.querySelector('[data-key="msme.scheme.disclaimer"] [data-key="msme.schemes.disclaimer"]')).not.toBeNull();
    expect(button('isNext').disabled).toBe(true);
    p().consent.set(true);
    await settle();
    button('isNext').click();
    await settle();
    expect(el.querySelector('[data-key="msme.scheme.instructions"]')).not.toBeNull();
    button('isNext').click();
    await settle();
    expect(el.textContent).toContain('Acme Castings');
    p().unitConfirmed.set(true);
    await settle();
    button('isNext').click();
    await settle();
    // The first section starts the application (the draft) and opens the first item.
    http.expectOne({ method: 'POST', url: `${URL}/draft` }).flush(page({}));
    await settle();
    expect(el.querySelector('#isEditor')).not.toBeNull();
    const pick = el.querySelector('#isPick') as HTMLSelectElement;
    expect([...pick.options].map((o) => o.textContent)).toEqual(['-Select-', 'Solar rooftop', 'LED lighting']);
    expect((el.querySelector('#isf-technologies-0-purchased_on') as HTMLInputElement).min).toBe('2026-11-01');
    expect(el.textContent).toContain('PDF / JPG / PNG ≤ 5 MB');

    p().setPick('T1');
    p().setValue('manufacturer', 'Acme');
    p().setValue('purchased_on', '2026-11-05');
    p().setValue('amount_paid', '240000');
    p().setValue('invoice_copy', '["20261105101010000abcdef01.pdf"]');
    await settle();
    // The live claim box.
    expect(p().claim()).toBe(240000);
    expect(el.querySelector('#isClaim')!.textContent).toContain('1,92,000.00');
    button('isSaveItem').click();
    await settle();
    const save = http.expectOne({ method: 'PUT', url: `${URL}/sections/technologies/items/0` });
    expect(save.request.body.pick).toBe('T1');
    expect(save.request.body.values.amount_paid).toBe('240000');
    save.flush(page({ answers: { sections: { technologies: [item('T1', '240000')] } } }));
    await settle();
    // Saved: a card with the pick, the amount and the documents; "+ Add more" without the technology already added.
    expect(el.querySelector('.is-item')!.textContent).toContain('Solar rooftop');
    expect(el.querySelector('.is-item')!.textContent).toContain('2,40,000.00');
    expect(el.querySelector('.is-item')!.textContent).toContain('1 document(s)');
    button('isAddMore').click();
    await settle();
    expect([...(el.querySelector('#isPick') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['-Select-', 'LED lighting']);
    (el.querySelector('#isEditor .fa-btn-soft') as HTMLButtonElement).click();
    await settle();

    button('isNext').click();
    await settle();
    expect(el.querySelector('#isAccount')).not.toBeNull();
    // The bank account is checked before going on.
    button('isNext').click();
    await settle();
    expect(el.querySelector('zed-alert-dialog')!.textContent).toContain('Please enter the account details.');
    for (const [k, v] of [['accountNo', '123456789012'], ['confirmAccountNo', '123456789012'], ['ifscCode', 'sbin0001234'], ['branchAddress', 'MG Road'], ['bankName', 'SBI']])
      p().setAccount(k, v);
    p().setCheque('["20261105101010000abcdef02.pdf"]');
    button('isNext').click();
    await settle();

    expect(el.querySelector('zed-scheme-answers')!.textContent).toContain('Solar rooftop');
    expect(el.querySelector('[data-key="msme.scheme.declaration"]')).not.toBeNull();
    expect(button('isSubmit').disabled).toBe(true);
    p().declaration.set(true);
    await settle();
    button('isSubmit').click();
    await settle();
    const submit = http.expectOne({ method: 'POST', url: `${URL}/submit` });
    expect(submit.request.body).toEqual({
      account: { accountNo: '123456789012', confirmAccountNo: '123456789012', ifscCode: 'SBIN0001234', branchAddress: 'MG Road', bankName: 'SBI' },
      cheque: ['20261105101010000abcdef02.pdf'], unitConfirmed: true, declaration: true,
    });
    submit.flush(page({ status: 'Submitted', claimAmount: 240000, eligibleAmount: 192000, sharePercent: 80, maxAmount: 300000,
      answers: { sections: { technologies: [item('T1', '240000')] } } }, { state: 'progress', canApply: false }));
    await settle();
    // The status tracker after submission.
    expect(el.querySelector('#isStatus')!.textContent).toContain('Submitted');
    expect([...el.querySelectorAll('.st-label')].map((l) => l.textContent)).toEqual(['Submitted', 'Desktop verification', 'Correction', 'Agency QC', 'Approved', 'Paid']);
    expect(el.querySelector('.st-now .st-label')!.textContent).toBe('Desktop verification');
  });

  it('in a correction round shows the answers found not valid with the remarks and edits only those', async () => {
    await open(page({
      status: 'Correction', correctionRound: 1, correctionDueOn: '2026-12-05', correctionOpen: true, sharePercent: 80, maxAmount: 300000,
      answers: { sections: { technologies: [item('T1', '100000')] } },
      checks: [{ path: 'technologies/0/amount_paid', remarks: 'The invoice says 90,000.' }],
    }, { state: 'progress', canApply: false }));
    expect(el.querySelector('#isCorrection')!.textContent).toContain('05-12-2026');
    const fix = el.querySelector('.is-fix') as HTMLElement;
    expect(fix.querySelector('.isf-flag')!.textContent).toContain('The invoice says 90,000.');
    expect((fix.querySelector('#isf-technologies-0-amount_paid') as HTMLInputElement).disabled).toBe(false);
    expect((fix.querySelector('#isf-technologies-0-manufacturer') as HTMLInputElement).disabled).toBe(true);

    const amount = fix.querySelector('#isf-technologies-0-amount_paid') as HTMLInputElement;
    amount.value = '90000';
    amount.dispatchEvent(new Event('input'));
    (fix.querySelector('.is-editor-actions button') as HTMLButtonElement).click();
    await settle();
    const save = http.expectOne({ method: 'PUT', url: `${URL}/sections/technologies/items/0` });
    expect(save.request.body.values.amount_paid).toBe('90000');
    save.flush(page({ status: 'Correction', correctionDueOn: '2026-12-05', correctionOpen: true,
      answers: { sections: { technologies: [item('T1', '90000')] } }, checks: [{ path: 'technologies/0/amount_paid', remarks: 'The invoice says 90,000.' }] },
    { state: 'progress', canApply: false }));
    await settle();

    button('isSubmitCorrections').click();
    await settle();
    const corr = http.expectOne({ method: 'POST', url: `${URL}/correction` });
    expect(corr.request.body).toEqual({ account: null, cheque: null });
    corr.flush(page({ status: 'Verifying' }, { state: 'progress', canApply: false }));
    await settle();
    expect(el.querySelector('#isStatus')).not.toBeNull();
  });

  it('after a rejection shows the reason and applies again', async () => {
    await open(page({ status: 'Rejected', reason: 'Invoice before the certification.' }, {
      history: [{ id: 90, date: '2026-10-01', status: 'Rejected', level: 'Bronze', amount: 1000, reason: 'Duplicate' }],
    }));
    expect(el.querySelector('#isRejected')!.textContent).toContain('Invoice before the certification.');
    expect(el.querySelector('#isHistory')!.textContent).toContain('Duplicate');
    button('isApplyAgain').click();
    await settle();
    http.expectOne({ method: 'POST', url: `${URL}/draft` }).flush(page({}));
    await settle();
    expect(el.querySelector('[data-key="msme.scheme.disclaimer"]')).not.toBeNull();
  });

  it('says why a locked scheme cannot be applied for', async () => {
    await open(page(null, { state: 'locked', note: 'notCertified', canApply: false, window: null, message: 'This scheme opens after Bronze, Silver, Gold certification.' }));
    expect(el.querySelector('#isMessage')!.textContent).toContain('Opens after Bronze, Silver, Gold certification');
    expect(el.querySelector('zed-step-tracker')).toBeNull();
  });

  // 2026-11-20: each scheme shows its own disclaimer, instructions and declaration (the global Texts when it has none).
  it("shows the scheme's own texts with their line breaks", async () => {
    const base = page({});
    await open({ ...base, scheme: { ...base.scheme, disclaimer: 'TU clause 1\nTU clause 2', instructions: 'Keep the invoice ready.', declaration: 'We declare.' } });
    const disclaimer = el.querySelector('#isDisclaimerText') as HTMLElement;
    expect(disclaimer.textContent).toBe('TU clause 1\nTU clause 2');
    expect(disclaimer.classList).toContain('is-scheme-text');
    expect(el.querySelector('[data-key="msme.scheme.disclaimer"]')).toBeNull();
    p().consent.set(true);
    await p().next();
    await settle();
    expect(el.querySelector('#isInstructionsText')!.textContent).toBe('Keep the invoice ready.');
  });

  it('words a hold for the applicant, never the staff reason', async () => {
    await open(page({ status: 'OnHold', holdKind: 'suspended', holdReason: 'Your certificate is suspended; the ZED team will resume or close the application.' },
      { state: 'onhold', canApply: false }));
    const hold = el.querySelector('#isHold')!.textContent!;
    expect(hold).toContain('Your certificate is suspended; the ZED team will resume or close the application.');
    expect(hold).not.toContain('was Verifying');
  });

  it('words the new locked reasons', async () => {
    await open(page(null, { state: 'locked', note: 'legacyInProgress', canApply: false, window: null, message: null }));
    expect(el.querySelector('#isMessage')!.textContent).toContain('earlier application for this benefit is still in progress');
  });
});
