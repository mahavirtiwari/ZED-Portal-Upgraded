import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ASSESSMENT_SYSTEM } from './assessment-shared';
import { DaDetails } from './assessment.api';
import { DaDetailsPage } from './da-details';
import { NO_REVIEW } from '../monitoring/review.api';

const BASE = '/api/staff/assessment/da/ZEDMSME000001/Bronze';

function details(overrides: Partial<DaDetails> = {}): DaDetails {
  return {
    zedId: 'ZEDMSME000001',
    certification: 'Bronze',
    role: 'DesktopAssessor',
    msme: { ZedId: 'ZEDMSME000001', PUnitName: 'Unit 1', CertificationStatus: 3, NcCount: 0, SecNcCount: 0, AgencyName: 'Agency One', CertificationBodyUserId: 'AGENCY1' },
    products: [{ Id: 21, ProductName: 'Bolt', PhotoUrl: BASE + '/files/mobileapi/Photos/ZEDMSME000001/Bronze/BasicInfo/p.jpg', ProductOpened: true, DescriptionOpened: true, DescriptionKind: null }],
    rawMaterials: [],
    sections: [{ Id: 41, SectionCode: '1', SectionName: 'Leadership', ValidationRequired: 1, IsAssessmentExcempted: null }],
    requirements: [{ Id: 11, SectionCode: '1', RequirementCode: '2', Conformance: null, OpenedFlag: true }],
    options: [{ SectionCode: '1', RequirementCode: '2', OptionCode: '1', OptionName: 'Has a quality policy' }],
    subOptions: [],
    evidences: [{ Id: 31, SectionCode: '1', RequirementCode: '2', EvidenceName: 'Policy', ValidationRequired: true, Opened: true, FileUrl: BASE + '/files/mobileapi/Photos/ZEDMSME000001/Bronze/Evidences/5551.pdf', Screenshots: [] }],
    photos: [{ Id: 61, PhotoType: 'SiteExteriorPhotos', DocumentOpenedTime: 0, Url: BASE + '/files/mobileapi/Photos/ZEDMSME000001/Bronze/SiteExteriorPhotos/777.jpg' }],
    location: { Latitude: '28.6', Longitude: '77.2' },
    esgCheckList: [],
    ncRounds: [],
    permissions: { canAssess: true, canFinalSubmit: true, canWithdrawExemption: false, review: NO_REVIEW },
    ...overrides,
  };
}

describe('DaDetailsPage', () => {
  let fixture: ComponentFixture<DaDetailsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function flushConfig() {
    for (const r of http.match('/api/config')) r.flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: 'https://legacy.example.test' });
  }

  function button(label: string): HTMLInputElement | HTMLButtonElement | undefined {
    return Array.from(el.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input[type=button], input[type=submit], button')).find(
      (b) => (b instanceof HTMLInputElement ? b.value : b.textContent?.trim()) === label,
    );
  }

  function tab(label: string) {
    Array.from(el.querySelectorAll<HTMLButtonElement>('.nav-link')).find((b) => b.textContent?.trim() === label)!.click();
  }

  async function open(data: DaDetails) {
    fixture.componentRef.setInput('zedId', 'ZEDMSME000001');
    fixture.componentRef.setInput('certification', 'bronze');
    await settle();
    flushConfig();
    http.expectOne(BASE).flush(data);
    await settle();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DaDetailsPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(DaDetailsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
  });

  afterEach(() => http.verify());

  it('shows the overview and the parameters with the assessor controls', async () => {
    await open(details());
    const text = el.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('ZEDMSME000001');
    expect(text).toContain('AGENCY1 - Agency One');

    tab('Parameters');
    await settle();
    expect(el.textContent).toContain('Has a quality policy');
    const pdf = el.querySelector<HTMLAnchorElement>('a[href$="Evidences/5551.pdf"]')!;
    expect(pdf.getAttribute('target')).toBe('_blank');
    expect(button('Validate')).toBeTruthy();
    expect(button('Final Submit')).toBeTruthy();
  });

  it('saves the conformance of a requirement and reloads', async () => {
    await open(details());
    tab('Parameters');
    await settle();
    // The requirement's Validate button is the last one in its row.
    const buttons = Array.from(el.querySelectorAll<HTMLInputElement>('td.text-center input[type=button]'));
    buttons[buttons.length - 1].click();
    await settle();

    el.querySelector<HTMLInputElement>('input[name=conformance][value=No]')!.click();
    await settle();
    el.querySelector<HTMLInputElement>('input[type=submit]')!.click();
    await settle();
    expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('Please enter remarks.');
    http.expectNone(BASE + '/requirements/11/conformance');

    const remarks = el.querySelector<HTMLTextAreaElement>('#daConfRemarks')!;
    remarks.value = 'Policy missing';
    remarks.dispatchEvent(new Event('input'));
    await settle();
    el.querySelector<HTMLInputElement>('input[type=submit]')!.click();
    await settle();

    const req = http.expectOne(BASE + '/requirements/11/conformance');
    expect(req.request.body).toEqual({ conformance: 'No', remarks: 'Policy missing' });
    req.flush({ message: 'Data Updated' });
    await settle();
    http.expectOne(BASE).flush(details());
    await settle();
    expect(el.querySelector('.modal')).toBeNull();
  });

  it('uploads evidence screenshots as a form', async () => {
    await open(details());
    tab('Parameters');
    await settle();
    Array.from(el.querySelectorAll<HTMLInputElement>('table.table-striped input[type=button]')).find((b) => b.value === 'Validate')!.click();
    await settle();
    el.querySelector<HTMLInputElement>('input[name=evVerified][value=Yes]')!.click();
    await settle();
    const source = el.querySelector<HTMLInputElement>('#daEvSource')!;
    source.value = 'GST portal';
    source.dispatchEvent(new Event('input'));

    const input = el.querySelector<HTMLInputElement>('#daEvFiles')!;
    const file = new File(['%PDF-1.4'], 'proof.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await settle();
    el.querySelector<HTMLInputElement>('.modal input[type=submit]')!.click();
    await settle();

    const req = http.expectOne(BASE + '/evidences/31/validate');
    const body = req.request.body as FormData;
    expect(body.get('IsVerified')).toBe('Yes');
    expect(body.get('SourceOfValidation')).toBe('GST portal');
    expect((body.get('Files') as File).name).toBe('proof.pdf');
    req.flush({ message: 'Data Updated' });
    await settle();
    http.expectOne(BASE).flush(details());
    await settle();
  });

  it('refuses files that are not PDF or images in the browser too', async () => {
    await open(details());
    tab('Parameters');
    await settle();
    Array.from(el.querySelectorAll<HTMLInputElement>('table.table-striped input[type=button]')).find((b) => b.value === 'Validate')!.click();
    await settle();
    el.querySelector<HTMLInputElement>('input[name=evVerified][value=Yes]')!.click();
    await settle();
    const input = el.querySelector<HTMLInputElement>('#daEvFiles')!;
    Object.defineProperty(input, 'files', { value: [new File(['MZ'], 'tool.exe', { type: 'application/x-msdownload' })] });
    input.dispatchEvent(new Event('change'));
    await settle();
    expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('Please upload valid document');
  });

  it('shows no assessor controls to other roles', async () => {
    await open(details({
      role: 'QC',
      msme: { ZedId: 'ZEDMSME000001', CertificationStatus: 3, NcCount: 0 },
      permissions: { canAssess: false, canFinalSubmit: false, canWithdrawExemption: false, review: NO_REVIEW },
    }));
    expect(el.textContent).not.toContain('Agency Name');
    tab('Parameters');
    await settle();
    expect(button('Validate')).toBeUndefined();
    expect(button('Final Submit')).toBeUndefined();
    expect(el.querySelector('input[type=radio]')).toBeNull();
  });

  it('runs the final-submit check before the pop-up and shows its message', async () => {
    await open(details());
    tab('Parameters');
    await settle();
    button('Final Submit')!.click();
    await settle();
    http.expectOne(BASE + '/final-submit/check').flush({ allowed: false, message: 'You may have missed assessment of one or more products. Please review.', raisesNc: false });
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('missed assessment of one or more products');
    expect(el.querySelector('.modal')).toBeNull();

    button('Final Submit')!.click();
    await settle();
    http.expectOne(BASE + '/final-submit/check').flush({ allowed: true, message: null, raisesNc: false });
    await settle();
    const submit = Array.from(el.querySelectorAll<HTMLInputElement>('.modal input[type=button]')).find((b) => b.value === 'SUBMIT')!;
    expect(submit.disabled).toBe(true);
  });

  it('lets the allotted agency edit remarks and final submit after both confirmations', async () => {
    const review = { editRemarks: true, finalSubmit: true, sendBack: true, reject: false, any: true };
    const agencyView = () => details({
      role: 'Agency',
      msme: { ZedId: 'ZEDMSME000001', CertificationStatus: 5, NcCount: 0, SecNcCount: 0 },
      requirements: [{ Id: 11, SectionCode: '1', RequirementCode: '2', Conformance: 'Yes', AssessorRemarks: 'Seen' }],
      permissions: { canAssess: false, canFinalSubmit: false, canWithdrawExemption: false, review },
    });
    await open(agencyView());
    expect(el.querySelector('.alert-info')).toBeNull();
    tab('Parameters');
    await settle();
    expect(button('Validate')).toBeUndefined();
    expect(button('Reject')).toBeUndefined();

    button('Edit Remarks')!.click();
    await settle();
    const text = el.querySelector<HTMLTextAreaElement>('#reviewRemarksText')!;
    expect(text.value).toBe('Seen');
    text.value = 'Checked by agency';
    text.dispatchEvent(new Event('input'));
    await settle();
    button('UPDATE')!.click();
    await settle();
    const remarks = http.expectOne('/api/staff/monitoring/review/ZEDMSME000001/Bronze/remarks');
    expect(remarks.request.body).toEqual({ kind: 'requirement', id: 11, remarks: 'Checked by agency' });
    remarks.flush({ message: 'Remarks updated.' });
    await settle();
    http.expectOne(BASE).flush(agencyView());
    await settle();

    button('Final Submit')!.click();
    await settle();
    const submit = () => Array.from(el.querySelectorAll<HTMLInputElement>('.modal input[type=button]')).find((b) => b.value === 'SUBMIT')!;
    expect(submit().disabled).toBe(true);
    expect(el.querySelector('#reviewQuality')).toBeNull();
    el.querySelector<HTMLInputElement>('#reviewExemptions')!.click();
    await settle();
    el.querySelector<HTMLInputElement>('#reviewQuality')!.click();
    await settle();
    expect(submit().disabled).toBe(false);
    submit().click();
    await settle();
    const req = http.expectOne('/api/staff/monitoring/review/ZEDMSME000001/Bronze/final-submit');
    expect(req.request.body).toEqual({ exemptionsReviewed: true, qualityChecked: true });
    req.flush({ message: 'Certification completed. The certificate has been mailed to the MSME.' });
    await settle();
    http.expectOne(BASE).flush(details({ role: 'Agency', permissions: { canAssess: false, canFinalSubmit: false, canWithdrawExemption: false, review: NO_REVIEW } }));
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('certificate has been mailed');
    expect(button('Final Submit')).toBeUndefined();
  });

  it('asks for send back remarks and shows server errors', async () => {
    const review = { editRemarks: false, finalSubmit: false, sendBack: true, reject: true, any: true };
    await open(details({ role: 'MasterAdmin', msme: { ZedId: 'ZEDMSME000001', CertificationStatus: 7, NcCount: 6, SecNcCount: 0 },
      permissions: { canAssess: false, canFinalSubmit: false, canWithdrawExemption: false, review } }));
    tab('Parameters');
    await settle();
    button('Send Back to Assessor')!.click();
    await settle();
    const submit = () => Array.from(el.querySelectorAll<HTMLInputElement>('.modal input[type=button]')).find((b) => b.value === 'SUBMIT')!;
    expect(submit().disabled).toBe(true);
    const text = el.querySelector<HTMLTextAreaElement>('#reviewSendBack')!;
    text.value = 'Please recheck';
    text.dispatchEvent(new Event('input'));
    await settle();
    submit().click();
    await settle();
    const req = http.expectOne('/api/staff/monitoring/review/ZEDMSME000001/Bronze/send-back');
    expect(req.request.body).toEqual({ remarks: 'Please recheck' });
    req.flush({ title: 'This action is not available for the assessment in its current status.' }, { status: 403, statusText: 'Forbidden' });
    await settle();
    expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('not available');
  });

  it('explains a record that is not visible to the user', async () => {
    fixture.componentRef.setInput('zedId', 'ZEDMSME000001');
    fixture.componentRef.setInput('certification', 'Bronze');
    await settle();
    flushConfig();
    http.expectOne(BASE).flush({ title: 'Not Found' }, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('not allotted to you');
  });

  it('does not call the API for an invalid address', async () => {
    fixture.componentRef.setInput('zedId', '../x');
    fixture.componentRef.setInput('certification', 'Platinum');
    await settle();
    flushConfig();
    http.expectNone((r) => r.url.startsWith('/api/staff/assessment'));
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Invalid request.');
  });
});

describe('DaDetailsPage (surveillance ESG tab)', () => {
  it('numbers the ESG questions and the tabs as the surveillance page did', async () => {
    await TestBed.configureTestingModule({
      imports: [DaDetailsPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: ASSESSMENT_SYSTEM, useValue: 'surveillance' }],
    }).compileComponents();
    const fixture = TestBed.createComponent(DaDetailsPage);
    const http = TestBed.inject(HttpTestingController);
    const el: HTMLElement = fixture.nativeElement;
    const settle = async () => {
      fixture.detectChanges();
      await new Promise((r) => setTimeout(r));
      await fixture.whenStable();
      fixture.detectChanges();
    };
    fixture.componentRef.setInput('zedId', 'ZEDMSME000001');
    fixture.componentRef.setInput('certification', 'Bronze');
    await settle();
    for (const r of http.match('/api/config')) r.flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: '' });
    http.expectOne(BASE).flush(
      details({
        esgCheckList: [
          { Code: 'E1', CheckListType: 'ESG', Question: 'Waste segregated?', Answer: 'Yes' },
          { Code: 'S1', CheckListType: 'SOCIAL/OHS', Question: 'First aid kit?', Answer: 'No' },
        ],
      }),
    );
    await settle();
    Array.from(el.querySelectorAll<HTMLButtonElement>('.nav-link')).find((b) => b.textContent?.trim() === 'Esg Compliance')!.click();
    await settle();

    expect(el.querySelector('.numberCircle')!.textContent!.trim()).toBe('3');
    const [esg, social] = Array.from(el.querySelectorAll('table'));
    expect(Array.from(esg.querySelectorAll('th')).map((th) => th.textContent!.trim())[0]).toBe('S.No');
    expect(esg.querySelector('tbody td')!.textContent!.trim()).toBe('E1');
    expect(social.querySelector('tbody td')!.textContent!.trim()).toBe('S1');
    expect(Array.from(el.querySelectorAll('.panel-black')).map((p) => p.textContent!.trim())).toEqual(['ESG Check List', 'Social/OHS Check List']);
    http.verify();
  });
});
