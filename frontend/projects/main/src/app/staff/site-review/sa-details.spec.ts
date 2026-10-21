import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NO_REVIEW } from '../monitoring/review.api';
import { SaDetailsPage } from './sa-details';
import { SaDetails } from './site-review.api';

const API = '/api/staff/site-review/ZEDMSME000001/Silver';
const FILES = API + '/files/';
const REVIEW = '/api/staff/monitoring/review/ZEDMSME000001/Silver';

function photo(url: string | null, name = 'Photo') {
  return { id: 1, name, url, createdDate: 'May 01, 2024', isVerified: null, assessorRemarks: null };
}

function details(overrides: Partial<SaDetails> = {}): SaDetails {
  return {
    zedId: 'ZEDMSME000001',
    certification: 'Silver',
    role: 'Agency',
    msme: { ZedId: 'ZEDMSME000001', PUnitName: 'Unit 1', CertificationStatus: 15, NcCount: 1, AgencyName: 'Agency SV', CertificationBodyUserId: 'AGENCYSV', SaAssessorRemarks: 'All good' },
    location: { Latitude: '28.6', Longitude: '77.2', SaLatitude: '28.7', SaLongitude: '77.3' },
    daSelfies: [],
    daSiteExterior: [photo(FILES + 'mobileapi/Photos/ZEDMSME000001/Silver/SiteExteriorPhotos/777.jpg')],
    saSelfies: [],
    saSiteExterior: [photo(FILES + 'mobileapi/SaPhotos/ZEDMSME000001/Silver/ext.jpg', 'Site Exterior Photo')],
    products: [{ id: 21, source: 'da', productName: 'Bolt', exported: 'No', photoUrl: null, descriptionUrl: null, descriptionKind: null, isVerified: 'Yes', assessorRemarks: 'ok', isSaVerified: 'Yes', saAssessorRemarks: 'fine', photos: [photo(FILES + 'mobileapi/SaPhotos/ZEDMSME000001/Silver/BasicInfo/6.jpg')] }],
    rawMaterials: [],
    sections: [{ Id: 41, SectionCode: '1', SectionName: 'Leadership', IsAssessmentExcempted: 'No', OfiComments: 'Improve docs' }],
    requirements: [{ Id: 11, SectionCode: '1', RequirementCode: '2', SaConformance: 'Yes', SaAssessorRemarks: 'Seen on site', Photos: [] }],
    options: [{ SectionCode: '1', RequirementCode: '2', OptionCode: '1', OptionName: 'Has a quality policy' }],
    subOptions: [],
    evidences: [],
    evidencePhotos: [],
    siteTour: [photo(FILES + 'mobileapi/SaPhotos/ZEDMSME000001/Silver/SiteTour/9.jpg', 'Shop floor'), photo(null, 'Foreign')],
    openMeeting: { id: 71, comments: 'Opening done', photos: [], participants: [{ Name: 'Owner', Designation: 'MD' }] },
    closeMeeting: null,
    attendance: [],
    consultants: [],
    ncRounds: [{ ncCount: 1, products: [], oldProducts: [], sections: [], requirements: [], options: [], subOptions: [], evidences: [], photos: [], commentsId: 81, assessorComments: 'NC comments' }],
    permissions: { review: { editRemarks: true, finalSubmit: true, sendBack: true, reject: false, any: true }, canWithdrawExemption: false, assessorOnCurrentPortal: false },
    ...overrides,
  };
}

describe('SaDetailsPage', () => {
  let fixture: ComponentFixture<SaDetailsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function button(label: string): HTMLInputElement | HTMLButtonElement | undefined {
    return Array.from(el.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input[type=button], button')).find(
      (b) => (b instanceof HTMLInputElement ? b.value : b.textContent?.trim()) === label,
    );
  }

  function tab(label: string) {
    Array.from(el.querySelectorAll<HTMLButtonElement>('.nav-link')).find((b) => b.textContent?.trim() === label)!.click();
  }

  async function open(data: SaDetails, certification = 'silver') {
    fixture.componentRef.setInput('zedId', 'ZEDMSME000001');
    fixture.componentRef.setInput('certification', certification);
    await settle();
    for (const r of http.match('/api/config')) r.flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: 'https://legacy.example.test' });
    http.expectOne(API).flush(data);
    await settle();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SaDetailsPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(SaDetailsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
  });

  afterEach(() => http.verify());

  it('shows the overview, the tabs of the old page and only authorised photo addresses', async () => {
    await open(details());
    const text = el.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('AGENCYSV - Agency SV');
    expect(Array.from(el.querySelectorAll('.nav-link')).map((b) => b.textContent!.trim())).toEqual([
      'Assessment Overview', 'Assessment Plan', 'Opening Meeting', 'Basic Information', 'Site Tour', 'Parameters', 'Closing Meeting', 'NC1', 'Attendance',
    ]);
    tab('Site Tour');
    await settle();
    const images = Array.from(el.querySelectorAll<HTMLImageElement>('.tab-pane img'));
    expect(images.map((i) => i.getAttribute('src'))).toEqual([FILES + 'mobileapi/SaPhotos/ZEDMSME000001/Silver/SiteTour/9.jpg']);
  });

  it('lets the agency edit OFI comments and certify after the quality check confirmation', async () => {
    await open(details());
    tab('Parameters');
    await settle();
    expect(el.textContent).toContain('Has a quality policy');
    expect(button('Reject')).toBeUndefined();

    // Edit Remarks buttons: requirement, OFI comments, summary.
    const edits = Array.from(el.querySelectorAll<HTMLInputElement>('input[type=button]')).filter((b) => b.value === 'Edit Remarks');
    expect(edits.length).toBe(3);
    edits[1].click();
    await settle();
    expect(el.querySelector('#reviewRemarksTitle')!.textContent).toContain('OFI Comments');
    const text = el.querySelector<HTMLTextAreaElement>('#reviewRemarksText')!;
    expect(text.value).toBe('Improve docs');
    text.value = 'Improve records';
    text.dispatchEvent(new Event('input'));
    await settle();
    button('UPDATE')!.click();
    await settle();
    const ofi = http.expectOne(REVIEW + '/ofi-comments');
    expect(ofi.request.body).toEqual({ sectionId: 41, comments: 'Improve records' });
    ofi.flush({ message: 'OFI comments updated.' });
    await settle();
    http.expectOne(API).flush(details());
    await settle();

    button('Final Submit')!.click();
    await settle();
    expect(el.querySelector('#reviewExemptions')).toBeNull();
    el.querySelector<HTMLInputElement>('#reviewQuality')!.click();
    await settle();
    Array.from(el.querySelectorAll<HTMLInputElement>('.modal input[type=button]')).find((b) => b.value === 'SUBMIT')!.click();
    await settle();
    const req = http.expectOne(REVIEW + '/final-submit');
    expect(req.request.body).toEqual({ exemptionsReviewed: true, qualityChecked: true });
    req.flush({ message: 'Certification completed. The certificate has been mailed to the MSME.' });
    await settle();
    http.expectOne(API).flush(details({ permissions: { review: NO_REVIEW, canWithdrawExemption: false, assessorOnCurrentPortal: false } }));
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('certificate has been mailed');
  });

  it('edits the meeting remarks and the NC assessor comments', async () => {
    await open(details());
    tab('Opening Meeting');
    await settle();
    expect(el.textContent).toContain('Owner');
    button('Edit Remarks')!.click();
    await settle();
    button('UPDATE')!.click();
    await settle();
    const meeting = http.expectOne(REVIEW + '/remarks');
    expect(meeting.request.body).toEqual({ kind: 'meeting', id: 71, remarks: 'Opening done' });
    meeting.flush({ message: 'Remarks updated.' });
    await settle();
    http.expectOne(API).flush(details());
    await settle();

    tab('NC1');
    await settle();
    expect(el.textContent).toContain('NC comments');
    button('Edit Remarks')!.click();
    await settle();
    button('UPDATE')!.click();
    await settle();
    const nc = http.expectOne(REVIEW + '/remarks');
    expect(nc.request.body).toEqual({ kind: 'nc-comments', id: 81, remarks: 'NC comments' });
    nc.flush({ title: 'This action is not available for the assessment in its current status.' }, { status: 403, statusText: 'Forbidden' });
    await settle();
    expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('not available');
  });

  it('shows read-only roles no actions and links the site assessor to the current portal', async () => {
    await open(details({ role: 'DesktopAssessor', permissions: { review: NO_REVIEW, canWithdrawExemption: false, assessorOnCurrentPortal: true } }));
    const link = el.querySelector<HTMLAnchorElement>('.alert-info a')!;
    expect(link.getAttribute('href')).toBe('https://legacy.example.test/Assessment/SaDetails?zedId=ZEDMSME000001&Certification=Silver');
    tab('Parameters');
    await settle();
    expect(button('Edit Remarks')).toBeUndefined();
    expect(button('Final Submit')).toBeUndefined();
  });

  it('lets the master admin withdraw an exemption', async () => {
    await open(details({
      role: 'MasterAdmin',
      sections: [{ Id: 41, SectionCode: '1', SectionName: 'Leadership', IsAssessmentExcempted: 'Yes' }],
      permissions: { review: NO_REVIEW, canWithdrawExemption: true, assessorOnCurrentPortal: false },
    }));
    tab('Parameters');
    await settle();
    el.querySelector<HTMLInputElement>('input[name=saExempt41][value=No]')!.click();
    await settle();
    const req = http.expectOne('/api/staff/assessment/da/ZEDMSME000001/Silver/sections/41/exemption');
    expect(req.request.body).toEqual({ isAssessmentExcempted: 'No' });
    req.flush({ message: 'Parameter not exempted from Remote/Site Assessment' });
    await settle();
    http.expectOne(API).flush(details());
    await settle();
  });

  it('does not call the API for Bronze or a malformed ZED ID', async () => {
    fixture.componentRef.setInput('zedId', 'ZEDMSME000001');
    fixture.componentRef.setInput('certification', 'Bronze');
    await settle();
    for (const r of http.match('/api/config')) r.flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: '' });
    http.expectNone((r) => r.url.startsWith('/api/staff/site-review'));
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Invalid request.');
  });

  it('explains a record that is not visible to the user', async () => {
    fixture.componentRef.setInput('zedId', 'ZEDMSME000001');
    fixture.componentRef.setInput('certification', 'Gold');
    await settle();
    for (const r of http.match('/api/config')) r.flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: '' });
    http.expectOne('/api/staff/site-review/ZEDMSME000001/Gold').flush({ title: 'Not Found' }, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('not allotted to you');
  });

  it('shows the surveillance meeting and recording links and loads the original certification on demand', async () => {
    await open(details({
      closeMeeting: { id: 72, comments: 'Closing', photos: [], participants: [] },
      surveillance: { meetingLink: 'https://meet.example.test/abc', recordingLinks: [{ url: 'https://rec.example.test/1', createdDate: 'May 01, 2026' }], hasOriginal: true },
    }));
    expect(el.querySelector<HTMLAnchorElement>('a[href="https://meet.example.test/abc"]')!.textContent).toContain('Click here to Join');
    tab('Closing Meeting');
    await settle();
    expect(el.querySelector<HTMLAnchorElement>('a[href="https://rec.example.test/1"]')!.textContent).toContain('View Recording 1');

    tab('Original Certification');
    await settle();
    http.expectOne(API + '/original').flush({
      zedId: 'ZEDMSME000001', certification: 'Silver', msme: { AgencyName: 'Original Agency', CertificationBodyUserId: 'AG0' },
      products: [], rawMaterials: [], sections: [{ SectionCode: '1', SectionName: 'Leadership' }],
      requirements: [{ SectionCode: '1', RequirementCode: '2', SaConformance: 'Yes', SaAssessorRemarks: 'fine', Photos: [] }],
      options: [], subOptions: [], evidences: [], saSelfies: [], saSiteExterior: [], siteTour: [], openMeeting: null, closeMeeting: null,
    });
    await settle();
    expect(el.textContent).toContain('AG0 - Original Agency');
    expect(el.textContent).toContain('Level 2: Yes');
    // Opened again: not reloaded.
    tab('Assessment Overview');
    tab('Original Certification');
    await settle();
    http.expectNone(API + '/original');
  });

  it('has no original certification tab on main', async () => {
    await open(details());
    expect(Array.from(el.querySelectorAll('.nav-link')).some((b) => b.textContent?.includes('Original'))).toBe(false);
  });
});
