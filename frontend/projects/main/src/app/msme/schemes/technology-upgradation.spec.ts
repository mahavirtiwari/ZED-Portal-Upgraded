import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TuPage } from './schemes.api';
import { TechnologyUpgradationPage } from './technology-upgradation';

describe('TechnologyUpgradationPage', () => {
  let fixture: ComponentFixture<TechnologyUpgradationPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const page = (submitted: boolean): TuPage => ({
    unit: { ZedId: 'ZEDMSME000001', EnterpriseName: 'Acme Castings', UdyogAadharNo: 'UDYAM-UP-29-0003915' },
    canApply: true,
    message: null,
    certification: 'Silver',
    minDate: '2024-01-01',
    technologies: [
      {
        code: 'T1', sNo: 1, name: 'Solar rooftop', description: 'PV', eligibleSubsidyPer: 80, submitted,
        details: submitted ? { NameOfTheManufaturer: 'Acme Solar', DateOfPurchase: '01/15/2024', InvoiceBillDate: '01/16/2024', AmountPaid: '500000', ModeOfPayment: 'Online' } : null,
        documents: submitted ? [{ fileName: 'p.jpg', type: 'Purchased Technology', timeStamp: null, isPdf: false, url: '/api/msme/schemes/tu/files/p.jpg' }] : [],
      },
      { code: 'T2', sNo: 2, name: 'LED lighting', description: null, eligibleSubsidyPer: 80, submitted: false, details: null, documents: [] },
    ],
    totalAmount: submitted ? 500000 : 0,
    eligibleTotal: submitted ? 300000 : 0,
  });

  type Page = {
    go(s: unknown): void;
    open(t: unknown): void;
    tech: Record<string, unknown>;
    upload(target: string, type: string, file: File): Promise<void>;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TechnologyUpgradationPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(TechnologyUpgradationPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
  });

  afterEach(() => http.verify());

  it('shows the reason when the unit may not apply', async () => {
    http.expectOne('/api/msme/schemes/tu').flush({ ...page(false), canApply: false, message: 'Data already submitted.', technologies: [] });
    await settle();
    expect(el.querySelector('#tuMessage')!.textContent).toContain('Data already submitted.');
    expect(el.textContent).not.toContain('DISCLAIMER');
  });

  it('lists technologies and only proceeds once one is submitted', async () => {
    http.expectOne('/api/msme/schemes/tu').flush(page(false));
    await settle();
    (fixture.componentInstance as unknown as Page).go('list');
    await settle();
    const rows = [...el.querySelectorAll('#tuTechnologies tbody tr')].map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent!.trim()));
    expect(rows).toEqual([['1. Solar rooftop', '--', 'APPLY'], ['2. LED lighting', '--', 'APPLY']]);
    expect((el.querySelector('#tuProceed') as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens a submitted technology with its stored values for editing', async () => {
    http.expectOne('/api/msme/schemes/tu').flush(page(true));
    await settle();
    const p = fixture.componentInstance as unknown as Page;
    p.open(page(true).technologies[0]);
    await settle();
    expect(p.tech['dateOfPurchase']).toBe('2024-01-15');
    expect(p.tech['amountPaid']).toBe(500000);
    expect((el.querySelector('#tuPurchase') as HTMLInputElement).min).toBe('2024-01-01');
    expect(el.querySelector('a[href="/api/msme/schemes/tu/files/p.jpg"]')).not.toBeNull();
    expect(el.textContent).not.toContain('Eligible Technology Support');
    expect(el.querySelector('#tuTechnologyForm b')!.parentElement!.textContent!.trim()).toBe('1. Solar rooftop');   // no description
  });

  it('shows the messages under the empty technology fields after submit', async () => {
    http.expectOne('/api/msme/schemes/tu').flush(page(false));
    await settle();
    (fixture.componentInstance as unknown as Page).open(page(false).technologies[0]);
    await settle();
    (el.querySelector('#tuTechnologyForm') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    expect(el.querySelector('[role="dialog"]')!.textContent).toContain('Please enter required data.');
    expect(el.querySelector('#tuMaker')!.parentElement!.textContent).toContain('This is required.');
    expect(el.querySelector('#tuMode')!.parentElement!.textContent).toContain('This is required.');
    http.expectNone('/api/msme/schemes/tu/technologies/T1');
  });

  it('checks the account form under the fields, the IFSC code while typing', async () => {
    http.expectOne('/api/msme/schemes/tu').flush(page(true));
    await settle();
    (fixture.componentInstance as unknown as Page).go('account');
    await settle();
    const ifsc = el.querySelector('#tuIfsc') as HTMLInputElement;
    ifsc.value = 'SBIN1';
    ifsc.dispatchEvent(new Event('input'));
    await settle();
    expect(ifsc.parentElement!.textContent).toContain('Invalid IFSC code format.');
    expect(ifsc.parentElement!.textContent).toContain('The IFSC code must be 11 characters long.');

    (el.querySelector('#tuAccountForm') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    expect(el.querySelector('#tuAccount')!.parentElement!.textContent).toContain('This is required.');
    expect(el.querySelector('#tuAccount2')!.parentElement!.textContent).toContain('Re-Enter Account Number is required.');
  });

  it('submits a technology, reloads the list and shows the server totals in the summary', async () => {
    http.expectOne('/api/msme/schemes/tu').flush(page(false));
    await settle();
    const p = fixture.componentInstance as unknown as Page;
    p.open(page(false).technologies[0]);
    Object.assign(p.tech, {
      nameOfTheManufaturer: 'Acme Solar', makeOrModelName: 'X', dateOfPurchase: '2024-02-01', agencyOrSupplier: 'S', invoiceNo: 'I',
      invoiceBillDate: '2024-02-02', amountPaid: 500000, modeOfPayment: 'Online',
    });
    for (const t of ['Purchased Technology', 'Copy of Invoice']) {
      const pending = p.upload('tech', t, new File(['%PDF-1.4'], 'a.pdf', { type: 'application/pdf' }));
      http.expectOne('/api/msme/schemes/tu/documents').flush({ fileName: `${t.length}2024010110000000aaaaaaaa.pdf`, type: t, timeStamp: null, isPdf: true, url: '/x' });
      await pending;
    }
    await settle();
    (el.querySelector('#tuTechnologyForm') as HTMLFormElement).dispatchEvent(new Event('submit'));
    const req = http.expectOne('/api/msme/schemes/tu/technologies/T1');
    expect(req.request.body.documents.length).toBe(2);
    expect(req.request.body.certId).toBeUndefined();
    req.flush({ message: 'Data submitted Successfully.' });
    await settle();
    http.expectOne('/api/msme/schemes/tu').flush(page(true));
    await settle();

    expect(el.textContent).not.toContain('details submitted');   // back on the list, without a notice (as the live page)
    expect(el.textContent).toContain('List of Technologies');
    expect(el.textContent).not.toContain('List of Technologies (Silver)');
    (el.querySelector('#tuProceed') as HTMLButtonElement).click();
    await settle();
    const summary = el.querySelector('#tuSummary')!.textContent!;
    expect(summary).toContain('5,00,000.00');
    expect(summary).toContain('3,00,000.00');
  });
});
