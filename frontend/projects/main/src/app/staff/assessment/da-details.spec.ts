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
    // The requirement's Validate button is in the conformance block of its card.
    el.querySelector<HTMLInputElement>('[data-requirement="11"] .zp-conf input[type=button]')!.click();
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

  it('answers a requirement checkpoint by checkpoint when it has checkpoints', async () => {
    const checkpoints = [
      { id: 501, requirementId: 11, optionCode: '1', text: 'Has a quality policy', actions: ['Write the policy', 'Display it'],
        evidences: [{ id: 31, name: 'Policy', mandatory: true, uploaded: true, verified: 'Yes' }],
        desktop: null, site: null, baseline: null, review1: null, review2: null },
      { id: 502, requirementId: 11, optionCode: '2', text: 'Staff know the policy', actions: ['Train the staff'], evidences: [],
        desktop: { value: 'Partial' as const, actions: ['Train the staff'], remarks: null }, site: null, baseline: null, review1: null, review2: null },
    ];
    await open(details({ checkpoints }));
    tab('Parameters');
    await settle();
    el.querySelector<HTMLInputElement>('[data-requirement="11"] .zp-conf input[type=button]')!.click();
    await settle();
    // The checkpoint pop-up, not the old Yes / No one.
    expect(el.querySelector('#daConfRemarks')).toBeNull();
    expect(el.querySelectorAll('zed-checkpoint-dialog section.cp').length).toBe(2);

    el.querySelector<HTMLInputElement>('section[data-checkpoint="1"] input[value=No]')!.click();
    await settle();
    button('SUBMIT')!.click();
    await settle();
    expect(el.querySelector('zed-checkpoint-dialog .alert-danger')!.textContent).toContain('Checkpoint 1: please tick the actions needed.');
    http.expectNone(BASE + '/requirements/11/checkpoints');

    el.querySelector<HTMLInputElement>('section[data-checkpoint="1"] input[type=checkbox]')!.click();
    await settle();
    expect(el.querySelector('.cp-result')!.textContent).toContain('Not conforming');
    button('SUBMIT')!.click();
    await settle();
    const req = http.expectOne(BASE + '/requirements/11/checkpoints');
    expect(req.request.body).toEqual({
      answers: [
        { id: 501, answer: 'No', actions: ['Write the policy'], remarks: null },
        { id: 502, answer: 'Partial', actions: ['Train the staff'], remarks: null },
      ],
      remarks: null,
    });
    req.flush({ message: 'Data Updated' });
    await settle();
    http.expectOne(BASE).flush(details({ checkpoints: [{ ...checkpoints[0], desktop: { value: 'No', actions: ['Write the policy'], remarks: null } }, checkpoints[1]] }));
    await settle();
    expect(el.querySelector('zed-checkpoint-dialog')).toBeNull();
    // The page lists option 1 only: its answer is shown beside it.
    expect(Array.from(el.querySelectorAll('.cp-chip')).map((c) => c.textContent!.trim())).toEqual(['No']);
  });

  it('uploads evidence screenshots as a form', async () => {
    await open(details());
    tab('Parameters');
    await settle();
    Array.from(el.querySelectorAll<HTMLInputElement>('.zp-ev-row input[type=button]')).find((b) => b.value === 'Validate')!.click();
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
    Array.from(el.querySelectorAll<HTMLInputElement>('.zp-ev-row input[type=button]')).find((b) => b.value === 'Validate')!.click();
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
    expect(el.querySelector('label[for="reviewExemptions"] [data-key="staff.monitoring.review.exemptionsReviewed.checkbox"]')).not.toBeNull();
    el.querySelector<HTMLInputElement>('#reviewExemptions')!.click();
    await settle();
    expect(el.querySelector('label[for="reviewQuality"] [data-key="staff.monitoring.review.qualityChecked.checkbox"]')).not.toBeNull();
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

  it('shows the assessment summary as a card of key facts with the location', async () => {
    await open(details({ msme: { ...details().msme, PlantAddress: 'Plot 4, Industrial Area', Certification: 'Bronze' } }));
    const factEls = Array.from(el.querySelectorAll('.summary .fact'));
    const facts = new Map(factEls.map((f) => [f.querySelector('dt')!.textContent!.trim(), f.querySelector('dd')!.textContent!.replace(/\s+/g, ' ').trim()]));
    expect(facts.get('ZED ID')).toBe('ZEDMSME000001');
    expect(facts.get('Unit Name')).toBe('Unit 1');
    expect(facts.get('Agency Name')).toBe('AGENCY1 - Agency One');
    // Empty values show a dash.
    expect(facts.get('Udyam Registration Number')).toBe('—');
    expect(facts.get('Desktop Assessor Name')).toBe('—');
    // The long address spans two columns; the location is one of the facts, with its map link.
    expect(factEls.find((f) => f.querySelector('dt')!.textContent!.trim() === 'Unit Address')!.classList).toContain('wide');
    expect(facts.get('Location')).toContain('28.6');
    expect(facts.get('Location')).toContain('77.2');
    const map = el.querySelector<HTMLAnchorElement>('.summary a.map-link')!;
    expect(map.textContent!.trim()).toBe('Map');
    expect(map.getAttribute('href')).toBe('https://www.google.com/maps?q=28.6,77.2');
    expect(map.getAttribute('target')).toBe('_blank');
    expect(el.querySelector('table.kv')).toBeNull();
  });

  it('numbers the basic information rows 1, 2, 3 in display order', async () => {
    await open(details({ products: [{ ...details().products[0], DescriptionKind: 'pdf', DescriptionUrl: BASE + '/files/desc.pdf', DescriptionOpened: false }] }));
    tab('Basic Information');
    await settle();
    for (const r of http.match((req) => req.url.startsWith('/api/staff/app-form-values'))) r.flush([]);
    await settle();
    const rows = Array.from(el.querySelectorAll<HTMLTableRowElement>('table.basic-info > tbody > tr'));
    const numbers = rows.map((r) => r.cells[0].textContent!.trim()).filter(Boolean);
    expect(numbers).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
    // The product description PDF is a chip, not the missing pdf-icon image.
    const chip = el.querySelector<HTMLAnchorElement>('a[href$="/files/desc.pdf"]')!;
    expect(chip.querySelector('.pdf-chip .pdf-tag')!.textContent).toBe('PDF');
    expect(chip.querySelector('.pdf-chip')!.classList).not.toContain('opened');
    expect(el.querySelector('img[src*="pdf-icon"]')).toBeNull();
  });

  it('shows evidences as PDF chips, tinted once opened', async () => {
    await open(details({
      evidences: [
        ...details().evidences,
        { Id: 32, SectionCode: '1', RequirementCode: '2', EvidenceName: '', ValidationRequired: true, Opened: false, FileUrl: BASE + '/files/x/6662.pdf', Screenshots: [] },
        { Id: 33, SectionCode: '1', RequirementCode: '2', EvidenceName: 'GST', ValidationRequired: true, Opened: true, FileUrl: BASE + '/files/x/7.pdf', IsVerified: 'No',
          SourceOfValidation: 'GST portal', AssessorRemarks: 'Expired', Screenshots: ['/s/1.pdf', '/s/2.pdf'] },
      ],
    }));
    tab('Parameters');
    await settle();
    const opened = el.querySelector<HTMLAnchorElement>('a[href$="Evidences/5551.pdf"]')!;
    expect(opened.querySelector('.pdf-chip')!.classList).toContain('opened');
    expect(opened.querySelector('.pdf-tag')!.textContent).toBe('PDF');
    expect(opened.textContent).toContain('Policy');
    const fresh = el.querySelector<HTMLAnchorElement>('a[href$="/6662.pdf"]')!;
    expect(fresh.querySelector('.pdf-chip')!.classList).not.toContain('opened');
    expect(fresh.textContent).toContain('View PDF');
    // The evidences table: document | verified | source | screenshots | action.
    const [policyRow, freshRow] = Array.from(el.querySelectorAll<HTMLTableRowElement>('.zp-ev-table tbody tr.zp-ev-row'));
    expect(Array.from(el.querySelectorAll('.zp-ev-table thead th')).map((th) => th.textContent!.trim()).slice(0, 4)).toEqual(['Document', 'Verified', 'Source', 'Screenshots']);
    expect(freshRow.querySelector('.zp-ev-verified')!.textContent!.trim()).toBe('Not checked');
    expect(freshRow.querySelector('.zp-ev-source')!.textContent!.trim()).toBe('—');
    expect(freshRow.querySelector('.zp-ev-shots')!.textContent!.trim()).toBe('—');
    expect(policyRow.querySelector<HTMLInputElement>('.zp-ev-act input[type=button]')!.value).toBe('Validate');
    expect(freshRow.querySelector('.zp-ev-act input')).toBeNull();
    const gstRow = el.querySelectorAll<HTMLTableRowElement>('.zp-ev-table tbody tr.zp-ev-row')[2];
    expect(gstRow.querySelector('.zp-ev-verified .zp-chip')!.getAttribute('data-v')).toBe('No');
    expect(gstRow.querySelector('.zp-ev-source')!.textContent!.trim()).toBe('GST portal');
    expect(gstRow.querySelector('.zp-ev-doc .zp-ev-remarks')!.textContent).toContain('Expired');
    expect(Array.from(gstRow.querySelectorAll('.zp-ev-shots a')).map((x) => x.textContent!.replace('PDF', '').trim())).toEqual(['1', '2']);
    expect(gstRow.querySelector<HTMLInputElement>('.zp-ev-act input')!.value).toBe('Edit');
    expect(el.querySelector('img[src*="pdf-icon"]')).toBeNull();

    // Opening an evidence still records it (the old SaveTimestamp) and reloads.
    fresh.addEventListener('click', (ev) => ev.preventDefault());
    fresh.click();
    await settle();
    const req = http.expectOne(BASE + '/opened');
    expect(req.request.body).toEqual({ type: 'Evidence', id: 32 });
    req.flush({ message: 'ok' });
    await settle();
    http.expectOne(BASE).flush(details());
    await settle();
  });

  it('lists the parameters with their status and shows the selected one', async () => {
    await open(details({
      sections: [
        { Id: 41, SectionCode: '1', SectionName: 'Leadership', ValidationRequired: 0, IsAssessmentExcempted: null },
        { Id: 42, SectionCode: '2', SectionName: 'Swachh Workplace', ValidationRequired: 0, IsAssessmentExcempted: 'Yes' },
        { Id: 43, SectionCode: '3', SectionName: 'Occupational Safety', ValidationRequired: 0, IsAssessmentExcempted: null },
        { Id: 44, SectionCode: '4', SectionName: 'Quality Management', ValidationRequired: 0, IsAssessmentExcempted: null },
      ],
      requirements: [
        { Id: 11, SectionCode: '1', RequirementCode: '2', Conformance: null, OpenedFlag: true },
        { Id: 12, SectionCode: '2', RequirementCode: '1', Conformance: 'Yes' },
        { Id: 13, SectionCode: '2', RequirementCode: '2', Conformance: 'Yes' },
        { Id: 14, SectionCode: '3', RequirementCode: '1', Conformance: 'Yes' },
        { Id: 15, SectionCode: '3', RequirementCode: '2', Conformance: 'No' },
        { Id: 16, SectionCode: '4', RequirementCode: '1', Conformance: 'Yes' },
        { Id: 17, SectionCode: '4', RequirementCode: '2', Conformance: null },
      ],
      options: [
        ...details().options,
        { SectionCode: '2', RequirementCode: '1', OptionCode: '1', OptionName: 'Work area is clean' },
        { SectionCode: '3', RequirementCode: '1', OptionCode: '1', OptionName: 'Fire extinguishers placed' },
      ],
    }));
    tab('Parameters');
    await settle();
    const items = Array.from(el.querySelectorAll<HTMLButtonElement>('.zp-nav .zp-nav-item'));
    expect(items.map((i) => i.querySelector('.zp-num')!.textContent!.trim())).toEqual(['1', '2', '3', '4']);
    expect(items.map((i) => i.querySelector('.zp-chip')!.textContent!.trim())).toEqual(['Pending', 'Exempt', 'No', 'Partial']);
    // Progress: requirements with a conformance out of all; an exempted parameter says so and counts as complete.
    expect(items.map((i) => i.querySelector('.zp-nav-meta')!.textContent!.trim())).toEqual(['0 of 1 requirements', 'Exempted', '2 of 2 requirements', '1 of 2 requirements']);
    expect(items.map((i) => i.querySelector<HTMLElement>('.zp-bar > span')!.style.width)).toEqual(['0%', '100%', '100%', '50%']);
    expect(el.querySelector('.zp-nav .zp-nav-head')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Parameters · 2 of 4 complete');

    // The first parameter is shown by default, one at a time.
    expect(items[0].classList).toContain('active');
    expect(el.querySelectorAll('.zp-main .zp-req').length).toBe(1);
    expect(el.querySelector('.zp-main')!.textContent).toContain('Has a quality policy');
    expect(el.querySelector('.zp-head .zp-chip')!.textContent!.trim()).toBe('Pending');

    items[2].click();
    await settle();
    const main = el.querySelector('.zp-main')!;
    expect(el.querySelectorAll('.zp-nav .zp-nav-item')[2].classList).toContain('active');
    expect(main.querySelector('.zp-head h5')!.textContent).toContain('Occupational Safety');
    expect(main.querySelector('.zp-head .zp-chip')!.textContent!.trim()).toBe('No');
    expect(Array.from(main.querySelectorAll('.zp-req .zp-code')).map((c) => c.textContent!.trim())).toEqual(['3.1', '3.2']);
    expect(main.textContent).toContain('Fire extinguishers placed');
    expect(main.textContent).not.toContain('Has a quality policy');
    // Each card: status chip in the title row, conformance and assessor remarks in its footer.
    expect(Array.from(main.querySelectorAll('.zp-req .zp-req-title .zp-req-status')).map((c) => c.textContent!.trim())).toEqual(['Yes', 'No']);
    expect(Array.from(main.querySelectorAll('.zp-req .zp-foot .zp-conf .zp-chip')).map((c) => c.textContent!.trim())).toEqual(['Yes', 'No']);
    expect(Array.from(main.querySelectorAll('.zp-req .zp-foot .zp-remarks .zp-row')).map((c) => c.textContent!.trim())).toEqual(['—', '—']);
  });

  it('marks a parameter Partial while only some checkpoints are answered', async () => {
    const checkpoints = [
      { id: 501, requirementId: 11, optionCode: '1', text: 'Has a quality policy', actions: [], evidences: [],
        desktop: { value: 'Partial' as const, actions: ['Write the policy'], remarks: 'Draft only' }, site: null, baseline: null, review1: null, review2: null },
    ];
    await open(details({ checkpoints }));
    tab('Parameters');
    await settle();
    expect(el.querySelector('.zp-nav-item .zp-chip')!.textContent!.trim()).toBe('Partial');
    const row = el.querySelector('.zp-checkpoints .zp-cp')!;
    expect(row.querySelector('.zp-cp-answer .cp-chip')!.textContent!.trim()).toBe('Partial');
    expect(row.textContent).toContain('Write the policy');
    expect(row.textContent).toContain('Draft only');
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
