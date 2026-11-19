import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AgencyAllotment, DaDetails } from './assessment.api';
import { DaDetailsPage } from './da-details';
import { NO_REVIEW } from '../monitoring/review.api';
import { ToastService } from '../toast';

const BASE = '/api/staff/assessment/da/ZEDMSME000001/Bronze';

function allotment(overrides: Partial<AgencyAllotment> = {}): AgencyAllotment {
  return {
    kind: 'desktop', preview: true, stage: 'pending', allottedOn: '17 Nov 2026', assessorId: null, assessorName: null, assessorReason: null, canAllot: true, canReject: true,
    spocName: 'Ravi Kumar', mobile: '9876543210', email: 'ravi@unit.in', pan: 'ABCDE1234F', ...overrides,
  };
}

/** The agency's unit not yet accepted: what the applicant submitted, nothing assessed. */
function preview(overrides: Partial<AgencyAllotment> = {}): DaDetails {
  return {
    zedId: 'ZEDMSME000001',
    certification: 'Bronze',
    role: 'Agency',
    msme: { ZedId: 'ZEDMSME000001', PUnitName: 'Unit 1', CertificationStatus: 2, NcCount: 0, SecNcCount: 0, AgencyName: 'Agency One', CertificationBodyUserId: 'AGENCY1' },
    products: [{ Id: 21, ProductName: 'Bolt', PhotoUrl: BASE + '/files/p.jpg', ProductOpened: false, DescriptionOpened: false, DescriptionKind: null }],
    rawMaterials: [],
    sections: [{ Id: 41, SectionCode: '1', SectionName: 'Leadership', ValidationRequired: 1, IsAssessmentExcempted: null }],
    requirements: [{ Id: 11, SectionCode: '1', RequirementCode: '2', RequirementName: 'Quality policy', Conformance: null, OpenedFlag: false }],
    options: [{ SectionCode: '1', RequirementCode: '2', OptionCode: '1', OptionName: 'Has a quality policy' }],
    subOptions: [],
    evidences: [{ Id: 31, SectionCode: '1', RequirementCode: '2', EvidenceName: 'Policy', ValidationRequired: true, FileUrl: BASE + '/files/Evidences/5551.pdf', Screenshots: [] }],
    photos: [{ Id: 61, PhotoType: 'SiteExteriorPhotos', DocumentOpenedTime: 0, Url: BASE + '/files/SiteExteriorPhotos/777.jpg' }],
    location: { Latitude: '28.6', Longitude: '77.2' },
    esgCheckList: [],
    ncRounds: [],
    permissions: { canAssess: false, canFinalSubmit: false, canWithdrawExemption: false, review: NO_REVIEW },
    allotment: allotment(overrides),
  };
}

describe('DaDetailsPage: the agency preview before acceptance (2026-11-18)', () => {
  let fixture: ComponentFixture<DaDetailsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function button(label: string, root: ParentNode = el): HTMLInputElement | HTMLButtonElement | undefined {
    return Array.from(root.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input[type=button], input[type=submit], button')).find(
      (b) => (b instanceof HTMLInputElement ? b.value : b.textContent?.trim()) === label,
    );
  }

  function tab(label: string) {
    Array.from(el.querySelectorAll<HTMLButtonElement>('.nav-link')).find((b) => (b.querySelector('.uv-tab-name') ?? b).textContent?.trim() === label)!.click();
  }

  async function open(data: DaDetails) {
    fixture.componentRef.setInput('zedId', 'ZEDMSME000001');
    fixture.componentRef.setInput('certification', 'Bronze');
    await settle();
    for (const r of http.match('/api/config')) r.flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: 'https://legacy.example.test' });
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

  afterEach(() => {
    for (const r of http.match((req) => req.url.endsWith('/form-checks'))) r.flush({ applies: false, canCheck: false, round: 0, ncRound: false, items: [] });
    for (const r of http.match((req) => req.url.endsWith('/same-pan'))) r.flush({ pan: null, this: null, others: [] });
    for (const r of http.match((req) => req.url.startsWith('/api/staff/app-form-values/'))) r.flush([]);
    http.verify();
  });

  it('shows the banner with the date, the applicant contact in full and Accept / Reject; no NC tab', async () => {
    await open(preview());
    const banner = el.querySelector('[data-allotment-banner]')!;
    const text = banner.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Allotted to your agency on 17 Nov 2026 · not yet accepted');
    expect(text).toContain('Ravi Kumar');
    expect(text).toContain('9876543210');
    expect(text).toContain('ravi@unit.in');
    expect(text).toContain('ABCDE1234F');
    expect(button('Accept', banner)).toBeTruthy();
    expect(button('Reject', banner)).toBeTruthy();
    expect([...el.querySelectorAll('.uv-tab-name')].map((t) => t.textContent!.trim())).not.toContain('Non-conformances');
  });

  it('is read-only: the documents and answers of the unit, no conformance, verdicts or edit buttons', async () => {
    await open(preview());
    tab('Parameters');
    await settle();
    expect(el.textContent).toContain('Has a quality policy');
    expect(el.querySelector('a[href$="Evidences/5551.pdf"]')).toBeTruthy();
    for (const label of ['Validate', 'Edit', 'Final Submit', '+ Observation', 'Edit Remarks']) expect(button(label)).toBeUndefined();
    expect(el.querySelector('.zp-foot')).toBeNull();
    expect(el.querySelector('.zp-req-status')).toBeNull();
    expect(el.querySelector('.zp-head-status')).toBeNull();
    expect(el.querySelector('.zp-ev-verified')).toBeNull();
    expect(el.querySelector('.zp-section-note input[type=radio]')).toBeNull();

    tab('Basic information');
    await settle();
    expect(el.textContent).toContain('Bolt');
    expect(el.querySelector('.bi-verdict')).toBeNull();
    expect(el.querySelector('.bi-chips')).toBeNull();
    expect(el.querySelector('zed-form-checks')).toBeNull();
    expect(button('Validate')).toBeUndefined();
  });

  it('Accept allots the unit to an assessor with the list API, then returns to the list with a toast', async () => {
    await open(preview());
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const toast = vi.spyOn(TestBed.inject(ToastService), 'success');
    button('Accept', el.querySelector('[data-allotment-banner]')!)!.click();
    await settle();
    http.expectOne('/api/staff/assessment/da-allotment').flush({
      rows: [{ ZedId: 'ZEDMSME000001', Certification: 'Bronze', PUnitName: 'Unit 1' }],
      assessors: [{ userId: 'ASSESSOR9', userName: 'Silver assessor' }],
      bronzeAssessors: [{ userId: 'ASSESSOR1', userName: 'Bronze assessor' }],
    });
    await settle();
    const select = el.querySelector<HTMLSelectElement>('#daAssessor')!;
    expect(Array.from(select.options).map((o) => o.textContent?.trim())).toEqual(['--Select--', 'Bronze assessor']);
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change'));
    await settle();
    button('Allot to assessor')!.click();
    await settle();
    const post = http.expectOne('/api/staff/assessment/da-allotment/allot');
    expect(post.request.body).toEqual({ zedId: 'ZEDMSME000001', certification: 'Bronze', desktopAssessorId: 'ASSESSOR1' });
    post.flush({ message: 'Assessment allotted to the assessor.' });
    await settle();
    expect(toast).toHaveBeenCalledWith('ZEDMSME000001 allotted', 'To Bronze assessor.');
    expect(navigate).toHaveBeenCalledWith('/staff/assessment/da-allotment');
  });

  /** 2026-11-19 (rejection reasons, approved): the Admin's reasons; the pop-up's drop-down. */
  const reasons = [
    { id: 'no-capacity', text: 'No assessor available', autoReallot: true },
    { id: 'sector', text: 'Outside our sector', autoReallot: false },
  ];
  const pick = async (id: string) => {
    const select = el.querySelector<HTMLSelectElement>('#daRejectReason-choice')!;
    select.value = id;
    select.dispatchEvent(new Event('change'));
    await settle();
  };

  it('Reject needs a reason of the list, posts it with the remarks, then returns to the list with the server message', async () => {
    await open(preview());
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const toast = vi.spyOn(TestBed.inject(ToastService), 'success');
    button('Reject', el.querySelector('[data-allotment-banner]')!)!.click();
    await settle();
    http.expectOne('/api/staff/assessment/rejection-reasons').flush(reasons);
    await settle();
    expect(el.querySelector('.modal h3')!.textContent).toContain('Reject assessment?');
    el.querySelector<HTMLButtonElement>('.modal .cd-ok')!.click();
    await settle();
    expect(el.querySelector('.modal .help-block')!.textContent).toContain('Please select the reason for rejection.');
    http.expectNone('/api/staff/assessment/da-allotment/reject');
    await pick('sector');
    expect(el.querySelector('.modal .cd-choice-note')!.textContent).toContain('goes back to the ZED team (Master Admin)');
    const remarks = el.querySelector<HTMLTextAreaElement>('#daRejectReason')!;
    remarks.value = 'Textiles only';
    remarks.dispatchEvent(new Event('input'));
    await settle();
    el.querySelector<HTMLButtonElement>('.modal .cd-ok')!.click();
    await settle();
    const post = http.expectOne('/api/staff/assessment/da-allotment/reject');
    expect(post.request.body).toEqual({ zedId: 'ZEDMSME000001', certification: 'Bronze', reasonId: 'sector', remarks: 'Textiles only' });
    post.flush({ message: 'Assessment rejected. It goes back to the ZED team.', reallotted: false });
    await settle();
    expect(toast).toHaveBeenCalledWith('ZEDMSME000001 rejected', 'Assessment rejected. It goes back to the ZED team.');
    expect(navigate).toHaveBeenCalledWith('/staff/assessment/da-allotment');
  });

  it('after the assessor rejected it: Re-allot and the reason in the banner', async () => {
    await open(preview({ stage: 'rejected', assessorId: 'ASSESSOR1', assessorName: 'Assessor One', assessorReason: 'Busy' }));
    const banner = el.querySelector('[data-allotment-banner]')!;
    expect(banner.textContent).toContain('Assessor One rejected it: Busy');
    expect(button('Re-allot', banner)).toBeTruthy();
    expect(button('Accept', banner)).toBeUndefined();
  });

  it('site allotment: Accept allots to a site assessor with the site list API, then returns to that list (2026-11-18)', async () => {
    await open(preview({ kind: 'site' }));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const toast = vi.spyOn(TestBed.inject(ToastService), 'success');
    const banner = el.querySelector('[data-allotment-banner]')!;
    expect(banner.textContent).toContain('site assessors');
    button('Accept', banner)!.click();
    await settle();
    http.expectOne('/api/staff/site-assessment/allotments').flush({
      units: [{ ZedId: 'ZEDMSME000001', Certification: 'Bronze', PUnitName: 'Unit 1', SiteAssessorId: null, ReasonForRejection: null }],
      assessors: [{ userId: 'ASR1', userName: 'Lead One' }],
    });
    await settle();
    const set = (selector: string, value: string) => {
      const input = el.querySelector(selector) as HTMLInputElement | HTMLSelectElement;
      input.value = value;
      input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input'));
    };
    set('#FinalSaDate', '2099-01-15');
    set('#ModeOfAssessment', 'Onsite Assessment');
    await settle();
    set('#SiteAssessorId', 'ASR1');
    await settle();
    el.querySelector<HTMLButtonElement>('.modal .sa-ok')!.click();
    await settle();
    const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/site-assessment/allotments');
    expect(post.request.body).toEqual({
      zedId: 'ZEDMSME000001', certification: 'Bronze', siteAssessorId: 'ASR1', coAssessorId: null, assessmentDate: '2099-01-15', modeOfAssessment: 'Onsite Assessment',
    });
    post.flush({ message: 'Unit allotted.' });
    await settle();
    expect(toast).toHaveBeenCalledWith('ZEDMSME000001 allotted', 'To Lead One.');
    expect(navigate).toHaveBeenCalledWith('/staff/sa-allotment');
  });

  it('site allotment: Reject posts the reason picked and the remarks to the site list API, with the server message', async () => {
    await open(preview({ kind: 'site' }));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const toast = vi.spyOn(TestBed.inject(ToastService), 'success');
    button('Reject', el.querySelector('[data-allotment-banner]')!)!.click();
    await settle();
    http.expectOne('/api/staff/assessment/rejection-reasons').flush(reasons);
    await settle();
    await pick('no-capacity');
    expect(el.querySelector('.modal .cd-choice-note')!.textContent).toContain('goes to another agency automatically');
    const remarks = el.querySelector<HTMLTextAreaElement>('#daRejectReason')!;
    expect(remarks.maxLength).toBe(1000);
    remarks.value = 'No site assessor free';
    remarks.dispatchEvent(new Event('input'));
    await settle();
    el.querySelector<HTMLButtonElement>('.modal .cd-ok')!.click();
    await settle();
    const post = http.expectOne('/api/staff/site-assessment/allotments/reject');
    expect(post.request.body).toEqual({ zedId: 'ZEDMSME000001', certification: 'Bronze', reasonId: 'no-capacity', remarks: 'No site assessor free' });
    post.flush({ message: 'Unit rejected. It went to Agency Two.', reallotted: true });
    await settle();
    expect(toast).toHaveBeenCalledWith('ZEDMSME000001 rejected', 'Unit rejected. It went to Agency Two.');
    expect(navigate).toHaveBeenCalledWith('/staff/sa-allotment');
  });

  it('site allotment after a desktop assessment: the banner, and the assessment results are shown', async () => {
    const data = preview({ kind: 'site', preview: false });
    data.requirements = [{ Id: 11, SectionCode: '1', RequirementCode: '2', RequirementName: 'Quality policy', Conformance: 'Yes', OpenedFlag: true }];
    await open(data);
    expect(el.querySelector('[data-allotment-banner]')).toBeTruthy();
    tab('Parameters');
    await settle();
    expect(el.querySelector('.zp-foot')).toBeTruthy();
    expect(button('Validate')).toBeUndefined();
  });

  it('no banner and the usual page when the server sends no allotment', async () => {
    const data = preview();
    delete data.allotment;
    await open(data);
    expect(el.querySelector('[data-allotment-banner]')).toBeNull();
  });
});
