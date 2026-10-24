import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ASSESSMENT_SYSTEM } from '../assessment/assessment-shared';
import { NO_REVIEW } from '../monitoring/review.api';
import { SaDetailsPage } from './sa-details';
import { SaDetails, SaOriginal } from './site-review.api';

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
    // The site page's pop-up is "Remarks" (SaDetails.cshtml #AgencyRemarks), not the desktop page's "Agency Remarks".
    expect(el.querySelector('#reviewRemarksTitle')!.textContent!.trim()).toBe('Remarks');
    expect(el.querySelector('label[for=reviewRemarksText]')!.textContent!.trim()).toBe('Remarks*');
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

  it('has no original certification tab on main', async () => {
    await open(details());
    expect(Array.from(el.querySelectorAll('.nav-link')).some((b) => b.textContent?.includes('Original'))).toBe(false);
  });
});

/** The Surveillance portal's page: the surveillance next to the original certification on main. */
describe('SaDetailsPage (surveillance)', () => {
  let fixture: ComponentFixture<SaDetailsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const tab = async (label: string) => {
    Array.from(el.querySelectorAll<HTMLButtonElement>('.nav-link')).find((b) => b.textContent?.trim() === label)!.click();
    await settle();
  };
  const panel = async (title: string) => {
    Array.from(el.querySelectorAll<HTMLElement>('.panel-black .panel-body')).find((b) => b.textContent?.trim().endsWith(title))!.click();
    await settle();
  };
  const panels = () => Array.from(el.querySelectorAll('.panel-black')).map((p) => p.textContent!.replace(/\s+/g, ' ').trim());
  const edits = () => Array.from(el.querySelectorAll<HTMLInputElement>('input[type=button]')).filter((b) => b.value === 'Edit Remarks');
  /** Table rows as "header value" lines. */
  const rows = () => Array.from(el.querySelectorAll('tr')).map((r) => Array.from(r.children).map((c) => c.textContent!.trim()).join(' ')).join(' | ');

  /** Surveillance rows: requirement 11 is the surveillance copy of main's requirement R12 (section 1). */
  function surveillanceDetails(overrides: Partial<SaDetails> = {}): SaDetails {
    return details({
      msme: {
        ZedId: 'ZEDMSME000001', CertificationStatus: 15, NcCount: 1, AssessmentDate: 'September 1, 2026', CompletedOn: 'September 9, 2026',
        Nc1Raised: 'September 3, 2026', AgencyName: 'Agency SV', CertificationBodyUserId: 'AGENCYSV', SiteAssessorId: 'ASR1', SiteAssessorName: 'Lead One',
        SaAssessorRemarks: 'Surveillance summary',
      },
      location: { SurLatitude: '28.9', SurLongitude: '77.9' },
      saSelfies: [photo(FILES + 'surveillancemobileapi/SaPhotos/ZEDMSME000001/Silver/selfie.jpg', 'Msme Representative Selfie')],
      sections: [{ Id: 41, SectionCode: '1', SectionName: 'Leadership', IsAssessmentExcempted: null }],
      requirements: [{ Id: 11, SectionCode: '1', RequirementCode: '2', RequirementId: 'R12', SaConformance: 'No', SaAssessorRemarks: 'Policy outdated', SaUpdatedDate: 'September 2, 2026', Photos: [] }],
      closeMeeting: { id: 72, comments: 'Closing remark', photos: [], participants: [] },
      surveillance: {
        meetingLink: 'https://meet.example.test/abc', recordingLinks: [{ url: 'https://rec.example.test/1', createdDate: 'May 01, 2026' }], hasOriginal: true,
        planSections: [{ Id: 41, SectionCode: '1', SectionName: 'Leadership', AllotedAssessorId: 'ASR1', AllotedAssessorName: 'Lead One', AssessorRank: 'Lead Assessor' }],
      },
      ...overrides,
    });
  }

  function original(): SaOriginal {
    return {
      zedId: 'ZEDMSME000001', certification: 'Silver',
      msme: { ZedId: 'ZEDMSME000001', PUnitName: 'Original Unit', Certification: 'Silver', ModeOfAssessment: 'Onsite Assessment', AssessmentDate: 'May 5, 2025',
        CompletedOn: 'May 20, 2025', AgencyName: 'Original Agency', CertificationBodyUserId: 'AG0' },
      products: [], rawMaterials: [],
      sections: [
        { Id: 1, SectionCode: '1', SectionName: 'Leadership', SurveMandatories: 'Yes', IsAssessmentExcempted: 'No', AllotedAssessorId: 'ASR7', AllotedAssessorName: 'Original Lead', AssessorRank: 'Lead Assessor' },
        { Id: 2, SectionCode: '2', SectionName: 'Swachh Workplace', SurveMandatories: null, IsAssessmentExcempted: 'No' },
      ],
      requirements: [
        { Id: 101, SectionCode: '1', RequirementCode: '2', RequirementId: 'R12', SaConformance: 'Yes', SaAssessorRemarks: 'Original remark', SaUpdatedDate: 'May 6, 2025', Photos: [] },
        { Id: 102, SectionCode: '2', RequirementCode: '1', RequirementId: 'R21', SaConformance: 'Yes', SaAssessorRemarks: 'Clean', Photos: [] },
      ],
      options: [{ SectionCode: '1', RequirementCode: '2', OptionCode: '1', OptionName: 'Has a quality policy' }],
      subOptions: [], evidences: [],
      saSelfies: [photo(FILES + 'mobileapi/SaPhotos/ZEDMSME000001/Silver/ASR7.jpg', 'Assessor Selfie')],
      saSiteExterior: [], siteTour: [photo(FILES + 'mobileapi/SaPhotos/ZEDMSME000001/Silver/SiteTour/3.jpg', 'Gate')],
      openMeeting: { id: 9, comments: 'Original opening', photos: [], participants: [] },
      closeMeeting: { id: 10, comments: 'Original closing', photos: [], participants: [] },
      location: { SaLatitude: '28.7', SaLongitude: '77.3' },
    };
  }

  async function open(data: SaDetails, withOriginal: SaOriginal | null = original()) {
    await TestBed.configureTestingModule({
      imports: [SaDetailsPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: ASSESSMENT_SYSTEM, useValue: 'surveillance' }],
    }).compileComponents();
    fixture = TestBed.createComponent(SaDetailsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    fixture.componentRef.setInput('zedId', 'ZEDMSME000001');
    fixture.componentRef.setInput('certification', 'Silver');
    await settle();
    for (const r of http.match('/api/config')) r.flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: '' });
    http.expectOne(API).flush(data);
    await settle();
    if (withOriginal) {
      http.expectOne(API + '/original').flush(withOriginal);
      await settle();
    }
  }

  afterEach(() => http.verify());

  it('shows the agency the surveillance next to the original certification, without the original blocks', async () => {
    await open(surveillanceDetails());
    expect(Array.from(el.querySelectorAll('.nav-link')).map((b) => b.textContent!.trim())).toEqual([
      'Assessment Overview', 'Assessment Plan', 'Opening Meeting', 'Basic Information', 'Site Tour', 'Parameters', 'Closing Meeting', 'NC 1',
    ]);
    const overview = rows();
    expect(overview).toContain('Unit Name Original Unit');
    expect(overview).toContain('Certification Date May 20, 2025');
    expect(overview).toContain('Mode of Assessment Remote Assessment');
    expect(overview).toContain('Surveillance Non-Conformance 1 Raised On September 3, 2026');
    expect(overview).toContain('Surveillance Agency Name AGENCYSV - Agency SV');
    expect(overview).toContain('Surveillance Assessor Name ASR1 - Lead One');
    expect(overview).not.toContain('Site Assessment Date');
    expect(overview).not.toContain('Original Agency');
    expect(el.querySelector<HTMLAnchorElement>('a[href="https://meet.example.test/abc"]')!.textContent).toContain('Click here to Join');
    expect(el.querySelector<HTMLAnchorElement>('a[href="https://www.google.com/maps?q=28.9,77.9"]')).not.toBeNull();

    await tab('Assessment Plan');
    expect(panels()).toEqual(['SURVEILLANCE ASSESSMENT PLAN']);
    expect(el.textContent).toContain('ASR1 Lead One');

    await tab('Basic Information');
    expect(el.querySelector('tr.site-assessment')).toBeNull();
    expect(el.querySelector('tr.surveillance-assessment')!.textContent).toContain('Msme Representative Selfie');

    // Parameters: main's sections with SurveMandatories only, collapsed until opened.
    await tab('Parameters');
    expect(panels()).toEqual(['1. Leadership']);
    expect(el.textContent).not.toContain('Has a quality policy');
    await panel('Leadership');
    expect(el.textContent).toContain('Has a quality policy');
    expect(el.querySelector('.onsite-result')).toBeNull();
    const result = el.querySelector('.surveillance-result')!.textContent!.replace(/\s+/g, ' ');
    expect(result).toContain('Surveillance Assessment');
    expect(result).toContain('Policy outdated');
    edits()[0].click();
    await settle();
    expect(el.querySelector<HTMLTextAreaElement>('#reviewRemarksText')!.value).toBe('Policy outdated');
    Array.from(el.querySelectorAll<HTMLInputElement>('input[type=button]')).find((b) => b.value === 'UPDATE')!.click();
    await settle();
    const req = http.expectOne(REVIEW + '/remarks');
    expect(req.request.body).toEqual({ kind: 'requirement', id: 11, remarks: 'Policy outdated' });
    req.flush({ message: 'Remarks updated.' });
    await settle();
    http.expectOne(API).flush(surveillanceDetails());
    await settle();
    // A reload keeps the original certification.
    http.expectNone(API + '/original');
    expect(el.textContent).toContain('Surveillance summary');

    await tab('Closing Meeting');
    expect(panels()).toEqual(['SURVEILLANCE CLOSE MEETING']);
    expect(el.querySelector<HTMLAnchorElement>('a[href="https://rec.example.test/1"]')!.textContent).toContain('View Recording 1');
    expect(el.textContent).toContain('Closing remark');
    await panel('SURVEILLANCE CLOSE MEETING');
    expect(el.textContent).not.toContain('Closing remark');
  });

  it('shows MasterAdmin the ONSITE blocks and the site assessment of the original certification', async () => {
    await open(surveillanceDetails({ role: 'MasterAdmin', permissions: { review: NO_REVIEW, canWithdrawExemption: false, assessorOnCurrentPortal: false } }));
    const overview = rows();
    expect(overview).toContain('Site Assessment Date May 5, 2025');
    expect(overview).toContain('Agency Name AG0 - Original Agency');
    expect(el.querySelector<HTMLAnchorElement>('a[href="https://www.google.com/maps?q=28.7,77.3"]')).not.toBeNull();

    await tab('Assessment Plan');
    expect(panels()).toEqual(['SURVEILLANCE ASSESSMENT PLAN', 'ONSITE ASSESSMENT PLAN']);
    expect(el.textContent).toContain('ASR7 Original Lead');
    await tab('Opening Meeting');
    expect(panels()).toEqual(['SURVEILLANCE OPEN MEETING', 'ONSITE OPEN MEETING']);
    expect(el.textContent).toContain('Original opening');
    await tab('Site Tour');
    expect(panels()).toEqual(['SURVEILLANCE SITE TOUR', 'ONSITE SITE TOUR']);
    await tab('Basic Information');
    expect(el.querySelector('tr.site-assessment')!.textContent).toContain('Assessor Selfie');
    await tab('Closing Meeting');
    expect(panels()).toEqual(['SURVEILLANCE CLOSE MEETING', 'CLOSE MEETING']);

    await tab('Parameters');
    expect(panels()).toEqual(['1. Leadership', '2. Swachh Workplace']);
    await panel('Leadership');
    expect(el.querySelector('.onsite-result')!.textContent).toContain('Original remark');
    expect(el.querySelector('.surveillance-result')!.textContent).toContain('Policy outdated');
    await panel('Swachh Workplace');
    // Main's requirement without a surveillance result: only the original's table.
    expect(el.querySelectorAll('.onsite-result').length).toBe(2);
    expect(el.querySelectorAll('.surveillance-result').length).toBe(1);
    expect(edits().length).toBe(0);
  });

  it('lists the surveillance sections for QC, without the original certification', async () => {
    await open(surveillanceDetails({ role: 'QC', permissions: { review: NO_REVIEW, canWithdrawExemption: false, assessorOnCurrentPortal: false } }), null);
    http.expectNone(API + '/original');
    await tab('Parameters');
    await panel('Leadership');
    expect(el.querySelector('.surveillance-result')!.textContent).toContain('Policy outdated');
  });
});
