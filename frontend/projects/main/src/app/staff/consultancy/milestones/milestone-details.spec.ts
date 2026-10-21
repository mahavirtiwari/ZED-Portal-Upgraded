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
      { id: 1, name: 'Shop floor', url: FILES + 'consultancymobileapi/SaPhotos/ZEDMSME000836/Silver/SiteTour/1.jpg', createdDate: null, ncCount: 1 },
      { id: 2, name: 'Foreign', url: null, createdDate: null, ncCount: 1 },
    ],
    selfies: [],
    attendance: [],
    attendanceConsultants: [],
    permissions: {
      canEdit: true, editableFields: ['BaselineRemarks', 'EstimatedTimeInDays', 'HActionPlanRemarks', 'Intervention', 'InterventionRemarks'],
      canEditBullets: true, canConsultantFinalSubmit: true, canCoFinalSubmit: false, canSendBack: false, canReject: false,
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
      (b) => (b instanceof HTMLInputElement ? b.value : b.textContent?.trim()) === label,
    );
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
    // Progress review columns are not shown (or editable) in milestone 1.
    expect(el.textContent).not.toContain('Progress Review 1 Remarks');
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

  it('adds and deletes bullets', async () => {
    await open(details());
    await tab('Parameters');
    Array.from(el.querySelectorAll<HTMLInputElement>('input[type=button]')).filter((b) => b.value === 'Add More')[1].click();
    await settle();
    type('input[type=text]', 'plan A');
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

  it('shows the CO decisions only when the server allows them and needs the confirmation', async () => {
    await open(details({ party: 'Co', status: 15, permissions: { ...details().permissions, canConsultantFinalSubmit: false, canCoFinalSubmit: true, canSendBack: true, canReject: true } }));
    await tab('Closing Meeting');
    expect(button('Send Back to Consultant')).toBeDefined();
    button('Reject')!.click();
    await settle();
    expect((button('REJECT') as HTMLInputElement).disabled).toBe(true);
    el.querySelector<HTMLInputElement>('#milestoneConfirm')!.click();
    await settle();
    button('REJECT')!.click();
    await settle();
    http.expectOne(API + '/reject').flush({ message: 'Handholding rejected.' });
    await settle();
    http.expectOne(API).flush(details({ status: 99 }));
    await settle();
  });

  it('shows no edit buttons to a viewer', async () => {
    const perms = { canEdit: false, editableFields: [], canEditBullets: false, canConsultantFinalSubmit: false, canCoFinalSubmit: false, canSendBack: false, canReject: false };
    await open(details({ party: 'Viewer', permissions: perms, requirements: [{ Id: 11, SectionCode: '1', RequirementCode: '1', Editable: false, Photos: [] }], bullets: [] }));
    await tab('Parameters');
    expect(button('EDIT')).toBeUndefined();
    expect(button('Add More')).toBeUndefined();
    await tab('Closing Meeting');
    expect(button('Final Submit')).toBeUndefined();
  });
});
