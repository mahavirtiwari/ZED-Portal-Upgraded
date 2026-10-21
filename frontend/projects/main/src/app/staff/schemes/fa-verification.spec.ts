import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AuthService } from '@zed/shared';
import { StaffRole } from '../staff-menu';
import { FaApplication } from './fa.api';
import { FaVerificationPage } from './fa-verification';

describe('FaVerificationPage', () => {
  let fixture: ComponentFixture<FaVerificationPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  const Zed = 'ZEDMSME000010';
  const base = `/api/staff/schemes/fa/${Zed}`;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const doc = (id: number, photoType: string, extra: Record<string, unknown> = {}) => ({
    id, photoType, name: null, timeStamp: '01-01-2026', isPdf: true, url: `${base}/Bronze/documents/${id}`, opened: false,
    isVerified: null, sourceOfValidation: null, assessorRemarks: null, screenshots: [], ...extra,
  });

  const app = (extra: Partial<FaApplication> = {}): FaApplication => ({
    certification: 'Bronze',
    details: { VerificationStatus: 2, IsApproved: null, CategoryOfCertificate: 'Quality', AccountNo: '123456789012', IfscCode: 'SBIN0001234', BranchAddress: 'MG Road', BankName: 'SBI' },
    documents: [doc(1, 'Copy of Certificate'), doc(2, 'Copy of Invoice', { isPdf: false })],
    canValidate: true, canDecide: false, canEditAccount: true,
    ...extra,
  });

  const button = (label: string) =>
    [...el.querySelectorAll('button, a')].filter((b) => b.textContent!.replace(/\s+/g, ' ').trim() === label) as HTMLElement[];

  async function create(roleId: number) {
    await TestBed.configureTestingModule({
      imports: [FaVerificationPage],
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ zedId: Zed }), queryParamMap: convertToParamMap({ certification: 'Bronze' }) } } },
      ],
    }).compileComponents();
    TestBed.inject(AuthService).setUser({ userId: 'DA1', userName: 'Assessor', roleId, role: 'x', subRoles: ['FinancialVerification'] });
    fixture = TestBed.createComponent(FaVerificationPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
  }

  afterEach(() => http.verify());

  it('shows documents through the API and offers validation only after a document is opened', async () => {
    await create(StaffRole.DesktopAssessor);
    http.expectOne(base).flush([app()]);
    await settle();

    expect(el.textContent).toContain('Certification Details');
    expect(el.textContent).toContain('Quality');
    const view = button('VIEW')[0] as HTMLAnchorElement;
    expect(view.getAttribute('href')).toBe(`${base}/Bronze/documents/1`);
    expect(button('VALIDATE').length).toBe(0);

    view.addEventListener('click', (e) => e.preventDefault());
    view.click();
    await settle();
    expect(button('VALIDATE').length).toBe(1);

    button('VALIDATE')[0].click();
    await settle();
    (el.querySelector('input[value="Yes"]') as HTMLInputElement).dispatchEvent(new Event('change'));
    await settle();
    // The certificate needs a source and a screenshot.
    button('Submit')[0].click();
    await settle();
    expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('source of validation');

    const source = el.querySelector('#faSource') as HTMLInputElement;
    source.value = 'Certification body portal';
    source.dispatchEvent(new Event('input'));
    const input = el.querySelector('#faShot') as HTMLInputElement;
    const file = new File(['%PDF-1.4'], 'shot.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await settle();
    button('Submit')[0].click();
    await settle();

    const req = http.expectOne(`${base}/Bronze/documents/1/validation`);
    const body = req.request.body as FormData;
    expect(body.get('isVerified')).toBe('Yes');
    expect(body.get('sourceOfValidation')).toBe('Certification body portal');
    expect((body.get('file') as File).name).toBe('shot.pdf');
    req.flush({ message: 'Saved.' });
    await settle();
    http.expectOne(base).flush([app()]);
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('Saved.');
  });

  it('refuses screenshots that are too large before uploading', async () => {
    await create(StaffRole.DesktopAssessor);
    http.expectOne(base).flush([app({ documents: [doc(1, 'Copy of Certificate', { opened: true })] })]);
    await settle();
    button('VALIDATE')[0].click();
    await settle();
    (el.querySelector('input[value="Yes"]') as HTMLInputElement).dispatchEvent(new Event('change'));
    await settle();
    const input = el.querySelector('#faShot') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.pdf')] });
    input.dispatchEvent(new Event('change'));
    await settle();
    expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('less than 2 MB');
  });

  it('submits the final decision only after confirmation', async () => {
    await create(StaffRole.Agency);
    http.expectOne(base).flush([app({ canValidate: false, canDecide: true, canEditAccount: false, details: { VerificationStatus: 3, IsApproved: 1 } })]);
    await settle();
    expect(button('Edit Account Details').length).toBe(0);

    button('ACCEPT')[0].click();
    await settle();
    const submit = button('SUBMIT')[0] as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const confirm = el.querySelector('#faConfirm') as HTMLInputElement;
    confirm.checked = true;
    confirm.dispatchEvent(new Event('change'));
    await settle();
    (button('SUBMIT')[0] as HTMLButtonElement).click();
    await settle();

    const req = http.expectOne(`${base}/Bronze/decision`);
    expect(req.request.body).toEqual({ decision: 'approve', comments: '' });
    req.flush({ message: 'Application approved.' });
    await settle();
    http.expectOne(base).flush([app({ canValidate: false, canDecide: false, details: { VerificationStatus: 4, IsApproved: 1 } })]);
    await settle();
    expect(el.textContent).toContain('ACCEPTED');
  });

  it('edits the reimbursement account when allowed', async () => {
    await create(StaffRole.MasterAdmin);
    http.expectOne(base).flush([app({ canValidate: false, details: { VerificationStatus: 4, AccountNo: '123456789012', IfscCode: 'SBIN0001234', BranchAddress: 'MG Road', BankName: 'SBI' } })]);
    await settle();
    button('Edit Account Details')[0].click();
    await settle();
    const ifsc = el.querySelector('input[aria-label="IFSC Code"]') as HTMLInputElement;
    ifsc.value = 'HDFC0001234';
    ifsc.dispatchEvent(new Event('input'));
    await settle();
    button('Update Account Details')[0].click();
    await settle();
    const req = http.expectOne(`${base}/Bronze/account`);
    expect(req.request.body).toEqual({ accountNo: '123456789012', ifscCode: 'HDFC0001234', branchAddress: 'MG Road', bankName: 'SBI' });
    req.flush({ title: 'The account details cannot be changed at this stage.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('cannot be changed');
  });

  it('shows the API error when the application is not available', async () => {
    await create(StaffRole.DesktopAssessor);
    http.expectOne(base).flush(null, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(el.querySelector('.alert-danger')).not.toBeNull();
  });
});
