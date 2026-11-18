import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TaxDetails, gstinCheckDigit, gstinProblem, panProblem } from './expenditure.api';
import { TaxDetailsCard } from './tax-details';

const open: TaxDetails = {
  available: true, submitted: false, gstin: null, pan: null, hasGstFile: false, hasPanFile: false, submittedOn: null, submittedBy: null, suggestedGstin: null,
};
const locked: TaxDetails = {
  available: true, submitted: true, gstin: '27AAPFU0939F1ZV', pan: 'AAPFU0939F', hasGstFile: true, hasPanFile: true, submittedOn: '2026-11-18T05:00:00',
  submittedBy: 'ZEDAA0080', suggestedGstin: null,
};

describe('TaxDetailsCard (the one-time GSTIN and PAN)', () => {
  let fixture: ComponentFixture<TaxDetailsCard>;
  let http: HttpTestingController;
  let el: HTMLElement;
  let saved: number;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const button = (label: string) => [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === label) as HTMLButtonElement | undefined;

  async function create(tax: TaxDetails, editable: boolean) {
    await TestBed.configureTestingModule({ imports: [TaxDetailsCard], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(TaxDetailsCard);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    saved = 0;
    fixture.componentInstance.saved.subscribe(() => saved++);
    fixture.componentRef.setInput('tax', tax);
    fixture.componentRef.setInput('partyId', 'ZEDAA0080');
    fixture.componentRef.setInput('editable', editable);
    await settle();
  }

  const type = (name: string, value: string) => {
    const i = el.querySelector(`input[name="${name}"]`) as HTMLInputElement;
    i.value = value;
    i.dispatchEvent(new Event('input'));
  };
  const attach = (name: string, file: File) => {
    const i = el.querySelector(`input[name="${name}"]`) as HTMLInputElement;
    Object.defineProperty(i, 'files', { value: [file], configurable: true });
    i.dispatchEvent(new Event('change'));
  };
  const submit = async () => {
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
  };
  const alert = () => el.querySelector('form .alert')?.textContent?.trim() ?? '';

  afterEach(() => http?.verify());

  it('checks the GSTIN (state code, check digit) and the PAN as the server does', () => {
    expect(gstinCheckDigit('27AAPFU0939F1ZV')).toBe('V');
    expect(gstinProblem(' 27aapfu0939f1zv ')).toBeNull();
    expect(gstinProblem('27AAPFU0939F1ZA')).toContain('check digit');
    expect(gstinProblem('99AAPFU0939F1ZV')).toContain('15 characters');
    expect(panProblem('AAPFU0939F', '27AAPFU0939F1ZV')).toBeNull();
    expect(panProblem('AAPFU0939G', '27AAPFU0939F1ZV')).toContain('(AAPFU0939F)');
  });

  it('asks for the GSTIN, PAN, both documents and the declaration, then confirms and submits once', async () => {
    await create(open, true);
    type('gstin', '27AAPFU0939F1ZA');
    await submit();
    expect(alert()).toContain('check digit');
    type('gstin', '27aapfu0939f1zv');
    await settle();
    expect(el.textContent).toContain('Characters 3 to 12 of the GSTIN: AAPFU0939F');
    type('pan', 'AAPFU0939G');
    await submit();
    expect(alert()).toContain('does not match the GSTIN');
    type('pan', 'aapfu0939f');
    await submit();
    expect(alert()).toBe('Please upload the GST registration certificate (PDF, JPG or PNG, up to 5 MB).');
    attach('gstFile', new File(['%PDF-1.4 %%EOF'], 'gst.pdf', { type: 'application/pdf' }));
    attach('panFile', new File(['x'], 'pan.gif', { type: 'image/gif' }));
    await submit();
    expect(alert()).toBe('The PAN card must be a PDF, JPG or PNG file.');
    attach('panFile', new File(['x'], 'pan.jpg', { type: 'image/jpeg' }));
    await submit();
    expect(alert()).toContain('tick the declaration');
    const tick = el.querySelector('input[name="declaration"]') as HTMLInputElement;
    tick.click();
    await submit();
    expect(alert()).toBe('');

    // The confirmation says they are locked afterwards.
    const dialog = el.querySelector('zed-confirm-dialog')!;
    expect(dialog.textContent).toContain('cannot be changed afterwards');
    expect(dialog.textContent).toContain('27AAPFU0939F1ZV · AAPFU0939F');
    button('Submit')!.click();
    await settle();
    const req = http.expectOne({ method: 'POST', url: '/api/staff/expenditure/my/tax' });
    const body = req.request.body as FormData;
    expect([body.get('gstin'), body.get('pan'), body.get('declaration')]).toEqual(['27AAPFU0939F1ZV', 'AAPFU0939F', 'true']);
    expect([(body.get('gstFile') as File).name, (body.get('panFile') as File).name]).toEqual(['gst.pdf', 'pan.jpg']);
    req.flush({ message: 'Your GSTIN and PAN are saved. You can now upload your invoices.' });
    await settle();
    expect(saved).toBe(1);
    expect(el.querySelector('zed-confirm-dialog')).toBeNull();
  });

  it("shows the server's refusal of a second submission in the confirmation", async () => {
    await create({ ...open, suggestedGstin: '27AAPFU0939F1ZV' }, true);
    expect((el.querySelector('input[name="gstin"]') as HTMLInputElement).value).toBe('27AAPFU0939F1ZV');
    attach('gstFile', new File(['%PDF-1.4 %%EOF'], 'gst.pdf', { type: 'application/pdf' }));
    attach('panFile', new File(['x'], 'pan.png', { type: 'image/png' }));
    (el.querySelector('input[name="declaration"]') as HTMLInputElement).click();
    await submit();
    button('Submit')!.click();
    await settle();
    http.expectOne({ method: 'POST', url: '/api/staff/expenditure/my/tax' }).flush(
      { title: 'Your GSTIN and PAN were submitted on 18 Nov 2026 and cannot be changed.' }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(el.querySelector('zed-confirm-dialog')!.textContent).toContain('cannot be changed');
    expect(saved).toBe(0);
  });

  it('is locked and read-only once submitted, with the two documents', async () => {
    await create(locked, true);
    expect(el.textContent).toContain('Locked');
    expect(el.textContent).toContain('27AAPFU0939F1ZV');
    expect(el.textContent).toContain('AAPFU0939F');
    expect(el.textContent).toContain('18 Nov 2026');
    expect(el.querySelector('input')).toBeNull();
    expect(button('Submit Tax Details')).toBeUndefined();
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:doc'), configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    button('View GST Certificate')!.click();
    await settle();
    const req = http.expectOne((r) => r.url === '/api/staff/expenditure/tax/gst' && r.params.get('partyId') === 'ZEDAA0080');
    req.flush(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
    await settle();
    expect(open).toHaveBeenCalled();
  });

  it('shows a manager the details read-only, or that they are not submitted yet', async () => {
    await create(open, false);
    expect(el.textContent).toContain('Not submitted yet');
    expect(el.querySelector('input')).toBeNull();
    fixture.componentRef.setInput('tax', locked);
    await settle();
    expect(el.textContent).toContain('27AAPFU0939F1ZV');
    expect(button('View PAN Card')).toBeTruthy();
    expect(el.textContent).not.toContain('Write to the master admin');
  });
});
