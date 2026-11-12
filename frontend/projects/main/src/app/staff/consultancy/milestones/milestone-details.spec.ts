import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MilestoneDetailsPage } from './milestone-details';
import { MilestoneDetails } from './milestones.api';

const API = '/api/consultancy/milestones/ZEDMSME000836/Silver';
const FILES = API + '/files/';

function details(overrides: Partial<MilestoneDetails> = {}): MilestoneDetails {
  return {
    zedId: 'ZEDMSME000836',
    certification: 'Silver',
    milestone: 1,
    status: 13,
    party: 'Lead',
    role: 'DesktopAssessor',
    milestones: [{ NcCount: 1, CertificationStatus: 13, PUnitName: 'ACME', CertificationBodyUserId: 'ZEDCO0001', AgencyName: 'CO One', SiteAssessorId: 'ZEDCC0015' }],
    coConsultants: [{ userId: 'ZEDCC1019', submitted: false, submittedOn: null }],
    allotments: [],
    sections: [{ Id: 41, SectionCode: '1', SectionName: 'Leadership' }],
    requirements: [
      { Id: 11, SectionCode: '1', RequirementCode: '1', SaConformance: 'Partial', BaselineRemarks: 'old remarks', Editable: true, Photos: [] },
    ],
    options: [],
    subOptions: [],
    bullets: [{ id: 501, requirementId: '11', reqType: 'BaselineDiagnostic', text: 'gap one', ncCount: 1, editable: true }],
    zedTrainings: [{ Id: 31, TrainingTopic: 'ZED', Remarks: 'done', NcCount: 1, Editable: false }],
    zedTrainingPhotos: [],
    handholdingTrainings: [],
    handholdingTrainingPhotos: [],
    basicInformation: [],
    openMeetings: [],
    closeMeetings: [],
    siteExterior: [],
    siteTour: [
      { id: 1, name: 'Shop floor', url: FILES + 'consultancymobileapi/SaPhotos/ZEDMSME000836/Silver/SiteTour/1.jpg', createdDate: null, ncCount: 1, assessorId: null },
      { id: 2, name: 'Foreign', url: null, createdDate: null, ncCount: 1, assessorId: null },
    ],
    selfies: [],
    attendance: [],
    attendanceConsultants: [],
    locations: [],
    zedLocation: null,
    permissions: {
      canEdit: true, editableFields: ['BaselineRemarks', 'EstimatedTimeInDays', 'HActionPlanRemarks', 'Intervention', 'InterventionRemarks'],
      canEditBullets: true, canConsultantFinalSubmit: true, canCoFinalSubmit: false, canSendBack: false, canReject: false,
      canEditFinalComments: false,
    },
    ...overrides,
  };
}

describe('MilestoneDetailsPage', () => {
  let fixture: ComponentFixture<MilestoneDetailsPage>;
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
      (b) => (b instanceof HTMLInputElement ? b.value : b.textContent?.trim() || b.getAttribute('aria-label')) === label,
    );
  }

  /** Picks a parameter in the parameters list. */
  async function expand(section: string) {
    Array.from(el.querySelectorAll<HTMLElement>('.zp-nav-item')).find((h) => h.textContent?.includes(section))!.click();
    await settle();
  }

  async function tab(label: string) {
    Array.from(el.querySelectorAll<HTMLButtonElement>('.nav-link')).find((b) => b.textContent?.trim() === label)!.click();
    await settle();
  }

  function type(selector: string, value: string) {
    const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  async function open(data: MilestoneDetails) {
    fixture.componentRef.setInput('zedId', 'ZEDMSME000836');
    fixture.componentRef.setInput('certification', 'silver');
    await settle();
    http.expectOne(API).flush(data);
    await settle();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MilestoneDetailsPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(MilestoneDetailsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
  });

  afterEach(() => http.verify());

  it('shows the milestone and only authorised photo addresses', async () => {
    await open(details());
    expect(el.textContent).toContain('Milestone 1');
    expect(el.textContent).toContain('ZEDCO0001 - CO One');
    await tab('Site Tour');
    const images = Array.from(el.querySelectorAll<HTMLImageElement>('.tab-pane img'));
    expect(images.map((i) => i.getAttribute('src'))).toEqual([FILES + 'consultancymobileapi/SaPhotos/ZEDMSME000836/Silver/SiteTour/1.jpg']);
    expect(el.textContent).toContain('Photo not available');
  });

  it('edits an allow-listed requirement field and reloads', async () => {
    await open(details());
    await tab('Parameters');
    // The first parameter is shown.
    expect(el.querySelector('[data-requirement]')).not.toBeNull();
    await expand('Leadership');
    expect(el.textContent).toContain('Milestone 1 : Basic Diagnostic Study');
    // The requirement has no evidence: the old page's empty row.
    expect(el.textContent).toContain('No Documents Uploaded');
    // Progress reviews are not shown before the section reaches milestone 2.
    expect(el.textContent).not.toContain('Progress Review 1');
    el.querySelector<HTMLInputElement>('input[aria-label="Edit Baseline Diagnostic Remarks"]')!.click();
    await settle();
    type('textarea', 'new remarks');
    await settle();
    button('UPDATE')!.click();
    await settle();
    const req = http.expectOne(API + '/requirements/11');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ field: 'BaselineRemarks', value: 'new remarks' });
    req.flush({ message: 'Updated.' });
    await settle();
    http.expectOne(API).flush(details());
    await settle();
    expect(el.textContent).toContain('Updated.');
  });

  it('lists the parameters with their status and shows the selected one as requirement cards', async () => {
    await open(details({
      sections: [
        { Id: 41, SectionCode: '1', SectionName: 'Leadership', NcCount: 1 },
        { Id: 42, SectionCode: '2', SectionName: 'Safety', NcCount: 2 },
        { Id: 43, SectionCode: '3', SectionName: 'Swachh', IsAssessmentExcempted: 'Yes' },
      ],
      requirements: [
        { Id: 11, SectionCode: '1', RequirementCode: '1', SaConformance: 'Partial', Editable: true, Photos: [] },
        { Id: 12, SectionCode: '2', RequirementCode: '1', SaConformance: 'Yes', Editable: true, Photos: [] },
        { Id: 13, SectionCode: '2', RequirementCode: '2', SaConformance: 'Yes', Editable: true, Photos: [] },
        { Id: 14, SectionCode: '3', RequirementCode: '1', SaConformance: null, Editable: true, Photos: [] },
      ],
    }));
    await tab('Parameters');
    const items = Array.from(el.querySelectorAll<HTMLButtonElement>('.zp-nav-item'));
    expect(items.map((i) => i.querySelector('.zp-chip')!.textContent!.trim())).toEqual(['Partial', 'Yes', 'Exempt']);
    expect(items.map((i) => i.querySelector('.zp-nav-meta')!.textContent!.trim())).toEqual(['0 of 1 requirements', '2 of 2 requirements', 'Exempted']);
    expect(el.querySelector('.zp-nav-head')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Parameters · 2 of 3 complete');
    expect(el.querySelector('.zp-main .zp-req .zp-foot .zp-chip')!.textContent!.trim()).toBe('Partial');
    expect(Array.from(el.querySelectorAll('.zp-main .zp-milestone .zp-block-head')).map((h) => h.textContent!.trim())).toEqual([
      'Milestone 1 : Basic Diagnostic Study', 'Milestone 1 : Handholding Action Plan', 'Milestone 1 : Technology Intervention',
    ]);

    items[1].click();
    await settle();
    expect(el.querySelector('.zp-head h5')!.textContent).toContain('Safety');
    expect(Array.from(el.querySelectorAll('.zp-main .zp-req .zp-code')).map((c) => c.textContent!.trim())).toEqual(['2.1', '2.2']);
    // The section reached milestone 2: its progress review block is shown.
    expect(el.querySelector('.zp-main')!.textContent).toContain('Milestone 2 :');
  });

  it('answers the baseline checkpoints of an editable parameter', async () => {
    const checkpoint = {
      id: 801, requirementId: 11, optionCode: '1', text: 'Written quality policy', actions: ['Write the policy', 'Display it'],
      evidences: [{ id: 91, name: 'Policy document', mandatory: true, uploaded: false, verified: null }],
      desktop: null, site: null, baseline: null, review1: null, review2: null,
    };
    const options = [{ SectionCode: '1', RequirementCode: '1', OptionCode: '1', OptionName: 'Written quality policy' }];
    await open(details({ options, checkpoints: [checkpoint], checkpointStage: 'Baseline' }));
    await tab('Parameters');
    await expand('Leadership');
    button('ANSWER CHECKPOINTS')!.click();
    await settle();
    // Handholding has no per-evidence uploads: the evidence is listed to look at.
    expect(el.querySelector('zed-checkpoint-dialog')!.textContent).toContain('Evidence to see');
    el.querySelector<HTMLInputElement>('section[data-checkpoint="1"] input[value=No]')!.click();
    await settle();
    el.querySelectorAll<HTMLInputElement>('section[data-checkpoint="1"] input[type=checkbox]')[1].click();
    await settle();
    el.querySelector<HTMLInputElement>('zed-checkpoint-dialog input[value=SUBMIT]')!.click();
    await settle();
    const req = http.expectOne(API + '/requirements/11/checkpoints');
    expect(req.request.body).toEqual({ answers: [{ id: 801, answer: 'No', actions: ['Display it'], remarks: null }], remarks: null });
    req.flush({ message: 'Saved. 1 action added to the Handholding Action Plan.' });
    await settle();
    http.expectOne(API).flush(details({ options, checkpointStage: 'Baseline', checkpoints: [{ ...checkpoint, baseline: { value: 'No', actions: ['Display it'], remarks: null } }] }));
    await settle();
    expect(el.textContent).toContain('1 action added to the Handholding Action Plan');
    expect(el.querySelector('.cp-chip')!.textContent!.trim()).toBe('Baseline: No');
  });

  it('shows no checkpoint button to a viewer', async () => {
    const checkpoint = { id: 801, requirementId: 11, optionCode: '1', text: 'Policy', actions: [], evidences: [], desktop: null, site: null, baseline: null, review1: null, review2: null };
    await open(details({ checkpoints: [checkpoint], checkpointStage: null }));
    await tab('Parameters');
    await expand('Leadership');
    expect(button('ANSWER CHECKPOINTS')).toBeUndefined();
  });

  it('adds and deletes bullets', async () => {
    await open(details());
    await tab('Parameters');
    await expand('Leadership');
    Array.from(el.querySelectorAll<HTMLInputElement>('input[type=button]')).filter((b) => b.value === 'Add More')[1].click();
    await settle();
    type('textarea', 'plan A');
    await settle();
    button('UPDATE')!.click();
    await settle();
    const add = http.expectOne(API + '/bullets');
    expect(add.request.body).toEqual({ requirementId: 11, reqType: 'HandholdingActionPlan', text: 'plan A' });
    add.flush({ message: 'Added.' });
    await settle();
    http.expectOne(API).flush(details());
    await settle();

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    button('Delete')!.click();
    await settle();
    const del = http.expectOne(API + '/bullets/501');
    expect(del.request.method).toBe('DELETE');
    del.flush({ message: 'Deleted.' });
    await settle();
    http.expectOne(API).flush(details());
    await settle();
  });

  it('runs the completeness check before the consultant final submit', async () => {
    await open(details());
    await tab('Closing Meeting');
    button('Final Submit')!.click();
    await settle();
    http.expectOne(API + '/consultant/check').flush({ allowed: false, message: 'You may have missed one or more estimated time. Please review.' });
    await settle();
    expect(el.textContent).toContain('estimated time');
    expect(el.querySelector('#milestoneDialogTitle')).toBeNull();

    button('Final Submit')!.click();
    await settle();
    http.expectOne(API + '/consultant/check').flush({ allowed: true, message: '' });
    await settle();
    expect((button('SUBMIT') as HTMLInputElement).disabled).toBe(true);
    type('#milestoneDialogText', 'All done');
    await settle();
    button('SUBMIT')!.click();
    await settle();
    const submit = http.expectOne(API + '/consultant/final-submit');
    expect(submit.request.body).toEqual({ remarks: 'All done' });
    submit.flush({ message: 'Milestone submitted to the Consultant Organisation.' });
    await settle();
    http.expectOne(API).flush(details({ status: 15, permissions: { ...details().permissions, canEdit: false, canConsultantFinalSubmit: false } }));
    await settle();
    expect(el.textContent).toContain('Milestone submitted');
  });

  it('shows the CO decisions the server allows, without the Reject button the old page never showed', async () => {
    await open(details({ party: 'Co', status: 15, permissions: { ...details().permissions, canConsultantFinalSubmit: false, canCoFinalSubmit: true, canSendBack: true, canReject: true } }));
    await tab('Closing Meeting');
    expect(button('Send Back to Consultant')).toBeDefined();
    expect(button('Final Submit')).toBeDefined();
    expect(button('Reject')).toBeUndefined();
    button('Final Submit')!.click();
    await settle();
    expect((button('SUBMIT') as HTMLInputElement).disabled).toBe(true);
    expect(el.querySelector('label[for="milestoneConfirm"] [data-key="staff.consultancy.milestone.review.checkbox"]')).not.toBeNull();
    el.querySelector<HTMLInputElement>('#milestoneConfirm')!.click();
    await settle();
    button('SUBMIT')!.click();
    await settle();
    http.expectOne(API + '/final-submit').flush({ message: 'Milestone 1 completed.' });
    await settle();
    http.expectOne(API).flush(details({ status: 16 }));
    await settle();
  });

  it('lets the CO edit the consultant final comments in its review (status 15)', async () => {
    const closing = { id: 8, ncCount: 1, comments: 'Closed', photos: [], participants: [], editable: false };
    const co = details({
      party: 'Co', status: 15, closeMeetings: [closing],
      milestones: [{ NcCount: 1, CertificationStatus: 15, PUnitName: 'ACME', SaAssessorRemarks: 'Milestone done' }],
      permissions: { ...details().permissions, canConsultantFinalSubmit: false, canCoFinalSubmit: true, canSendBack: true, canEditFinalComments: true },
    });
    await open(co);
    await tab('Closing Meeting');
    expect(el.textContent).toContain('Consultant Final Comments :');
    button('Edit Remarks')!.click();
    await settle();
    expect(el.querySelector<HTMLTextAreaElement>('#milestoneDialogText')!.value).toBe('Milestone done');
    expect(el.querySelector<HTMLTextAreaElement>('#milestoneDialogText')!.maxLength).toBe(2000);
    type('#milestoneDialogText', 'Milestone done and reviewed');
    await settle();
    button('UPDATE')!.click();
    await settle();
    const req = http.expectOne(API + '/final-comments');
    expect(req.request.body).toEqual({ remarks: 'Milestone done and reviewed' });
    req.flush({ message: 'Remarks updated.' });
    await settle();
    http.expectOne(API).flush(co);
    await settle();
    expect(el.textContent).toContain('Remarks updated.');
  });

  it('shows no edit buttons to a viewer', async () => {
    const perms = {
      canEdit: false, editableFields: [], canEditBullets: false, canConsultantFinalSubmit: false, canCoFinalSubmit: false, canSendBack: false, canReject: false,
      canEditFinalComments: false,
    };
    await open(details({ party: 'Viewer', permissions: perms, requirements: [{ Id: 11, SectionCode: '1', RequirementCode: '1', Editable: false, Photos: [] }], bullets: [] }));
    await tab('Parameters');
    await expand('Leadership');
    expect(button('EDIT')).toBeUndefined();
    expect(button('Add More')).toBeUndefined();
    await tab('Closing Meeting');
    expect(button('Final Submit')).toBeUndefined();
    expect(button('Edit Remarks')).toBeUndefined();
  });

  it('shows the overview per milestone and the locations', async () => {
    await open(details({
      milestones: [
        { NcCount: 1, ZedId: 'ZEDMSME000836', PUnitName: 'ACME', Certification: 'Silver', LastestCertification: 'Bronze', BdsFromDate: 'May 1, 2025', CoAssessorId: 'ZEDCC1019', CoAssessorName: 'Co One', SiteAssessorId: 'ZEDCC0015', SiteAssessorName: 'Lead' },
        { NcCount: 2, BdsFromDate: 'June 1, 2025', SiteAssessorId: 'ZEDCC0015', SiteAssessorName: 'Lead' },
      ],
      locations: [{ SaLatitude: '28.6', SaLongitude: '77.2' }],
      zedLocation: { ZedSaLatitude: '28.5', ZedSaLongitude: '77.1' },
    }));
    expect(el.textContent).toContain('Existing Level of Certification');
    expect(el.textContent).toContain('BDSR From: May 1, 2025');
    expect(el.textContent).toContain('Milestone 1 Co-consultant Name & ID');
    expect(el.textContent).toContain('ZEDCC1019 - Co One');
    expect(el.textContent).toContain('PR 1 From: June 1, 2025');
    expect(el.textContent).not.toContain('Milestone 2 Co-consultant');
    expect(el.textContent).not.toContain('Milestone 3 Date');
    expect(el.textContent).toContain('Location-ZED Certification');
    const maps = Array.from(el.querySelectorAll<HTMLAnchorElement>('a[target=_blank]')).map((a) => a.getAttribute('href'));
    expect(maps).toEqual(['https://www.google.com/maps?q=28.5,77.1', 'https://www.google.com/maps?q=28.6,77.2']);
  });

  it('shows the basic information by section and milestone', async () => {
    await open(details({ basicInformation: [{ NcCount: 1, NumOfAccedents: '2', ElectriUnit: '500', TurnOver: '10 Cr' }] }));
    await tab('Basic Information');
    expect(el.textContent).toContain('Occupational (Workplace) Safety');
    expect(el.textContent).toContain('Financial Performance (Previous Financial Year)');
    expect(el.textContent).toContain('Electrical');
    const value = (label: string) => el.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)?.value;
    expect(value('No. of accidents (incl. fatalities & disabilities caused, if any)')).toBe('2');
    expect(value('Turnover')).toBe('10 Cr');
  });

  it('edits the remarks of a meeting the server marks editable', async () => {
    const meeting = { id: 7, ncCount: 1, comments: 'Opening held', photos: [], participants: [{ Name: 'Owner', Designation: 'MD' }], editable: true };
    await open(details({ openMeetings: [meeting], closeMeetings: [{ ...meeting, id: 8, editable: false }] }));
    await tab('Closing Meeting');
    expect(button('Edit Remarks')).toBeUndefined();
    await tab('Opening Meeting');
    expect(el.textContent).toContain('1. Owner');
    button('Edit Remarks')!.click();
    await settle();
    expect(el.querySelector<HTMLTextAreaElement>('#milestoneDialogText')!.value).toBe('Opening held');
    type('#milestoneDialogText', 'Opening held with the owner');
    await settle();
    button('UPDATE')!.click();
    await settle();
    const req = http.expectOne(API + '/meetings/7/remarks');
    expect(req.request.body).toEqual({ remarks: 'Opening held with the owner' });
    req.flush({ message: 'Remarks updated.' });
    await settle();
    http.expectOne(API).flush(details());
    await settle();
    expect(el.textContent).toContain('Remarks updated.');
  });
});
