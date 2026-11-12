import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { RemoteAssessmentPage } from './remote-assessment';
import { RemoteDetails } from './remote.api';

const BASE = '/api/staff/remote/ZEDMSME000001/Silver';

async function settle(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

function details(canAssess = true): RemoteDetails {
  return {
    zedId: 'ZEDMSME000001',
    certification: 'Silver',
    msme: { ZedId: 'ZEDMSME000001', EnterpriseName: 'Acme <b>Steel</b>', CertificationStatus: 9, SaAuditsConducted: 'Yes', AuditsConducted: 'No' },
    products: [{ Id: 31, ProductName: 'Valve', Exported: 'No', IsSaVerified: null, RemotePhotos: [] }],
    rawMaterials: [],
    sections: [{ Id: 41, SectionCode: '1', SectionName: 'Leadership', IsAssessmentExcempted: 'No', OfiComments: null }],
    requirements: [{ Id: 51, SectionCode: '1', RequirementCode: '1', Conformance: 'Yes', SaConformance: null, RemotePhotos: [] }],
    options: [{ SectionCode: '1', RequirementCode: '1', OptionCode: '1', OptionName: '<img src=x onerror=alert(1)>' }],
    subOptions: [],
    evidences: [],
    daPhotos: [],
    location: { Latitude: '26.1', Longitude: '80.2' },
    siteExteriorPhotos: [{ id: 61, name: 'Front', url: BASE + '/files/SaPhotos/ZEDMSME000001/Silver/a.jpg', deletable: canAssess }],
    siteTourPhotos: [{ id: 85, name: 'Shop floor', url: BASE + '/files/SaPhotos/ZEDMSME000001/Silver/t.jpg', deletable: canAssess }],
    openMeeting: { id: 71, comments: 'Introductions', participants: [{ Name: 'R Sharma', Designation: 'Owner' }], photos: [] },
    closeMeeting: { id: 72, comments: null, participants: [], photos: [] },
    selfies: [],
    permissions: { isLeadAssessor: canAssess, canAssess },
  };
}

describe('RemoteAssessmentPage', () => {
  let fixture: ComponentFixture<RemoteAssessmentPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function create(data: RemoteDetails) {
    await TestBed.configureTestingModule({
      imports: [RemoteAssessmentPage],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ zedId: 'ZEDMSME000001', certification: 'Silver' }) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RemoteAssessmentPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle(fixture);
    http.expectOne(BASE).flush(data);
    await settle(fixture);
  }

  function button(text: string): HTMLButtonElement {
    return [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === text) as HTMLButtonElement;
  }

  async function openTab(title: string) {
    button(title).click();
    await settle(fixture);
  }

  async function reload(data = details()) {
    await settle(fixture);
    http.expectOne((r) => r.method === 'GET' && r.url === BASE).flush(data);
    await settle(fixture);
  }

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('shows the overview as text and a map link', async () => {
    await create(details());
    expect(el.textContent).toContain('Acme <b>Steel</b>');
    expect(el.querySelector('table b')).toBeNull();
    expect(el.querySelector('a.map-link')!.getAttribute('href')).toBe('https://www.google.com/maps?q=26.1,80.2');
  });

  it('is read-only for the co-assessor', async () => {
    await create(details(false));
    expect(el.querySelector('.alert-info')!.textContent).toContain('Only the lead assessor');
    await openTab('Parameters');
    expect(el.querySelector('.validate-requirement')).toBeNull();
    expect(el.querySelector('.final-submit')).toBeNull();
    expect(el.querySelector('.zp-req.requirement img')).toBeNull(); // option text is not HTML
    expect(el.querySelector('.zp-req.requirement')!.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('lists the parameters with their status and shows the selected one as requirement cards', async () => {
    const data = details();
    data.sections = [
      { Id: 41, SectionCode: '1', SectionName: 'Leadership', IsAssessmentExcempted: 'No', OfiComments: 'Improve' },
      { Id: 42, SectionCode: '2', SectionName: 'Safety', IsAssessmentExcempted: 'No', OfiComments: null },
      { Id: 43, SectionCode: '3', SectionName: 'Swachh', IsAssessmentExcempted: 'Yes', OfiComments: null },
    ];
    data.requirements = [
      { Id: 51, SectionCode: '1', RequirementCode: '1', Conformance: 'Yes', AssessorRemarks: 'Desk ok', SaConformance: 'Yes', SaAssessorRemarks: 'Seen', RemotePhotos: [] },
      { Id: 52, SectionCode: '2', RequirementCode: '1', Conformance: 'No', SaConformance: null, RemotePhotos: [] },
      { Id: 53, SectionCode: '2', RequirementCode: '2', Conformance: 'Yes', SaConformance: 'No', RemotePhotos: [] },
      { Id: 54, SectionCode: '3', RequirementCode: '1', Conformance: 'Yes', SaConformance: null, RemotePhotos: [] },
    ];
    data.evidences = [{ Id: 91, SectionCode: '1', RequirementCode: '1', EvidenceName: 'Policy', IsVerified: 'Yes', FileUrl: BASE + '/files/e.pdf' }];
    await create(data);
    await openTab('Parameters');
    const items = [...el.querySelectorAll<HTMLButtonElement>('.zp-nav-item')];
    expect(items.map((i) => i.querySelector('.zp-chip')!.textContent!.trim())).toEqual(['Yes', 'No', 'Exempt']);
    expect(items.map((i) => i.querySelector('.zp-nav-meta')!.textContent!.trim())).toEqual(['1 of 1 requirements', '1 of 2 requirements', 'Exempted']);
    expect(el.querySelector('.zp-nav-head')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Parameters · 2 of 3 complete');
    const card = el.querySelector('.zp-main .zp-req')!;
    expect(card.querySelector('.zp-ev-table a.evidence-file')!.textContent).toContain('Policy');
    expect(card.querySelector('.zp-ev-verified .zp-chip')!.textContent!.trim()).toBe('Yes');
    expect(card.querySelector('.zp-foot .zp-conf.zp-da .zp-chip')!.textContent!.trim()).toBe('Yes');
    expect(card.querySelector('.zp-foot .zp-conf.zp-sa .validate-requirement')!.textContent!.trim()).toBe('Edit');
    expect(el.querySelector('.zp-ofi .edit-ofi')!.textContent!.trim()).toBe('Edit');

    items[1].click();
    await settle(fixture);
    expect(el.querySelector('.zp-head h5')!.textContent).toContain('Safety');
    expect([...el.querySelectorAll('.zp-main .zp-req .zp-code')].map((c) => c.textContent!.trim())).toEqual(['2.1', '2.2']);
    items[2].click();
    await settle(fixture);
    // Exempted: no remote conformance, photos or OFI comments.
    expect(el.querySelector('.validate-requirement')).toBeNull();
    expect(el.querySelector('.zp-site-photos')).toBeNull();
    expect(el.querySelector('.edit-ofi')).toBeNull();
  });

  it('records conformance and reloads', async () => {
    await create(details());
    await openTab('Parameters');
    (el.querySelector('.validate-requirement') as HTMLButtonElement).click();
    await settle(fixture);
    const no = el.querySelector('.modal input[value=No]') as HTMLInputElement;
    no.click();
    no.dispatchEvent(new Event('change'));
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('Please enter remarks.');
    const remarks = el.querySelector('#choiceRemarks') as HTMLTextAreaElement;
    remarks.value = 'Not seen';
    remarks.dispatchEvent(new Event('input'));
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    const req = http.expectOne(BASE + '/requirements/51/conformance');
    expect(req.request.body).toEqual({ conformance: 'No', remarks: 'Not seen' });
    req.flush({ message: 'Data Updated' });
    await reload();
    expect(el.querySelector('.modal')).toBeNull();
  });

  it('answers the checkpoints of a requirement that has them, beside the desktop answers', async () => {
    const checkpoint = {
      id: 701, requirementId: 51, optionCode: '1', text: 'Policy on display', actions: ['Display the policy'], evidences: [],
      desktop: { value: 'Yes' as const, actions: [], remarks: null }, site: null, baseline: null, review1: null, review2: null,
    };
    await create({ ...details(), checkpoints: [checkpoint] });
    await openTab('Parameters');
    expect(el.querySelector('.cp-chip')!.textContent!.trim()).toBe('DA: Yes');
    (el.querySelector('.validate-requirement') as HTMLButtonElement).click();
    await settle(fixture);
    expect(el.querySelector('#choiceRemarks')).toBeNull();
    expect(el.querySelector('zed-checkpoint-dialog')!.textContent).toContain('Site assessment');
    el.querySelector<HTMLInputElement>('section[data-checkpoint="1"] input[value=Partial]')!.click();
    await settle(fixture);
    el.querySelector<HTMLInputElement>('section[data-checkpoint="1"] input[type=checkbox]')!.click();
    await settle(fixture);
    el.querySelector<HTMLInputElement>('zed-checkpoint-dialog input[value=SUBMIT]')!.click();
    await settle(fixture);
    const req = http.expectOne(BASE + '/requirements/51/checkpoints');
    expect(req.request.body).toEqual({ answers: [{ id: 701, answer: 'Partial', actions: ['Display the policy'], remarks: null }], remarks: null });
    req.flush({ message: 'Data Updated' });
    await reload({ ...details(), checkpoints: [{ ...checkpoint, site: { value: 'Partial', actions: ['Display the policy'], remarks: null } }] });
    expect(el.querySelector('zed-checkpoint-dialog')).toBeNull();
    expect(Array.from(el.querySelectorAll('.cp-chip')).map((c) => c.textContent!.trim())).toEqual(['DA: Yes', 'SA: Partial']);
  });

  it('takes only a JPEG upload and saves it under the name given', async () => {
    await create(details());
    await openTab('Site Tour');
    const input = el.querySelector('label.capture input[type=file]') as HTMLInputElement;
    expect(input.getAttribute('accept')).toBe('image/jpeg');
    const pick = async (file: File) => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change'));
      await settle(fixture);
      await new Promise((r) => setTimeout(r, 20)); // FileReader
      await settle(fixture);
    };
    await pick(new File(['x'], 'a.png', { type: 'image/png' }));
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Please upload a JPEG photo of at most 5 MB.');
    expect(el.querySelector('.modal')).toBeNull();

    await pick(new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    const capture = (fixture.componentInstance as unknown as { capture: WritableSignal<{ image: string; name: string } | null> }).capture;
    expect(capture()!.image).toMatch(/^data:image\/jpeg;base64,/);
    expect(capture()!.name).toBe('Site Tour');
    capture.set({ ...capture()!, image: 'data:image/jpeg;base64,/9j/4AAQ', name: 'Boiler' });
    await settle(fixture);
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    const req = http.expectOne(BASE + '/photos');
    expect(req.request.body).toEqual({ target: 'SiteTour', targetId: null, name: 'Boiler', image: 'data:image/jpeg;base64,/9j/4AAQ' });
    req.flush({ photos: [] });
    await reload();
  });

  it('reuses a site tour photo for a parameter and removes own photos after confirmation', async () => {
    await create(details());
    await openTab('Parameters');
    (el.querySelector('.from-tour') as HTMLButtonElement).click();
    await settle(fixture);
    (el.querySelector('.select-tour') as HTMLButtonElement).click();
    await settle(fixture);
    const req = http.expectOne(BASE + '/photos');
    expect(req.request.body).toEqual({ target: 'Requirement', targetId: 51, fromPhotoId: 85 });
    req.flush({ photos: [] });
    await reload();

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openTab('Site Tour');
    (el.querySelector('[aria-label="Remove photo"]') as HTMLButtonElement).click();
    await settle(fixture);
    http.expectOne((r) => r.method === 'DELETE' && r.url === BASE + '/photos/85').flush({ message: 'Photo removed.' });
    await reload();
  });

  it('checks before the final submit and needs the confirmation', async () => {
    await create(details());
    await openTab('Parameters');
    (el.querySelector('.final-submit') as HTMLButtonElement).click();
    await settle(fixture);
    http.expectOne(BASE + '/final-submit/check').flush({ allowed: false, message: 'You may have missed one or more OFI comments. Please review.', raisesNc: false });
    await settle(fixture);
    expect(el.querySelector('.alert-danger')!.textContent).toContain('OFI comments');

    (el.querySelector('.final-submit') as HTMLButtonElement).click();
    await settle(fixture);
    http.expectOne(BASE + '/final-submit/check').flush({ allowed: true, message: null, raisesNc: true });
    await settle(fixture);
    expect(el.querySelector('.modal')!.textContent).toContain('Non-conformance(s) will be raised');
    const submit = el.querySelector('.modal .submit') as HTMLInputElement;
    expect(submit.disabled).toBe(true);
    const comments = el.querySelector('#finalComments') as HTMLTextAreaElement;
    comments.value = 'Assessment done';
    comments.dispatchEvent(new Event('input'));
    expect(el.querySelector('label[for="finalConfirm"] [data-key="staff.assessment.remote.fairConfirm.checkbox"]')).not.toBeNull();
    const confirm = el.querySelector('#finalConfirm') as HTMLInputElement;
    confirm.click();
    await settle(fixture);
    expect(submit.disabled).toBe(false);
    submit.click();
    await settle(fixture);
    const req = http.expectOne(BASE + '/final-submit');
    expect(req.request.body).toEqual({ comments: 'Assessment done' });
    req.flush({ message: 'Assessment submitted.' });
    await reload();
    expect(el.querySelector('.alert-success')!.textContent).toContain('Assessment submitted.');
  });

  it('reviews an onsite unit after the SA app without the video call', async () => {
    await create({ ...details(), onsiteReview: true });
    expect(el.querySelector('#onsiteReview')!.textContent).toContain('Assessed onsite with the SA app');
  });

  it('has no video call: full-width tabs and the refresh link on main', async () => {
    await create(details());
    expect(el.querySelector('.zed-tabs')!.classList).toContain('col-lg-12');
    expect(el.querySelector('.video-panel')).toBeNull();
    expect(el.querySelector('#output')).toBeNull();
    expect(button('Start Assessment')).toBeUndefined();
    expect(el.querySelector('.refresh-link')).not.toBeNull();
    expect(el.querySelector('a.assessment-report')).toBeNull();
  });

  it('shows the saved opened state of product descriptions and records opened evidence (SaveTimestamp)', async () => {
    const data = details();
    data.products = [
      { Id: 31, ProductName: 'Valve', Exported: 'No', DescriptionKind: 'pdf', DescriptionUrl: '/files/d.pdf', RemotePhotos: [] },
      { Id: 32, ProductName: 'Pump', Exported: 'No', DescriptionKind: 'pdf', DescriptionUrl: '/files/e.pdf', ProductDescOpenedTime: '2024-01-01', RemotePhotos: [] },
    ];
    data.evidences = [{ Id: 91, SectionCode: '1', RequirementCode: '1', EvidenceName: 'Policy', FileUrl: '/files/p.pdf' }];
    await create(data);
    await openTab('Basic Info');
    // 2026-11-12: a "PDF" chip (the old icon pictures did not exist), tinted once opened.
    const chips = () => [...el.querySelectorAll('a.product-description .pdf-chip')].map((c) => c.classList.contains('opened'));
    expect(chips()).toEqual([false, true]);

    // The legacy remote page never recorded product descriptions (its UpdateTimestamp2 did not exist): nothing is sent.
    const link = el.querySelector('a.product-description') as HTMLAnchorElement;
    link.addEventListener('click', (e) => e.preventDefault());
    link.click();
    await settle(fixture);
    expect(http.match('/api/staff/assessment/da/ZEDMSME000001/Silver/opened').length).toBe(0);

    await openTab('Parameters');
    const evidence = el.querySelector('a.evidence-file') as HTMLAnchorElement;
    evidence.addEventListener('click', (e) => e.preventDefault());
    evidence.click();
    await settle(fixture);
    http.expectOne('/api/staff/assessment/da/ZEDMSME000001/Silver/opened').flush({ message: 'Saved' });
    expect(http.match(BASE).length).toBe(0);
  });

  it('does not record opened documents for the read-only co-assessor', async () => {
    const data = details(false);
    data.evidences = [{ Id: 91, SectionCode: '1', RequirementCode: '1', EvidenceName: 'Policy', FileUrl: '/files/p.pdf' }];
    await create(data);
    await openTab('Parameters');
    const evidence = el.querySelector('a.evidence-file') as HTMLAnchorElement;
    evidence.addEventListener('click', (e) => e.preventDefault());
    evidence.click();
    await settle(fixture);
    http.expectNone('/api/staff/assessment/da/ZEDMSME000001/Silver/opened');
  });

  it('lists the sub-options of each option in the final-submit pop-up', async () => {
    const data = details();
    data.requirements = [{ Id: 51, SectionCode: '1', RequirementCode: '1', Conformance: 'Yes', SaConformance: 'No', SaAssessorRemarks: 'Missing', RemotePhotos: [] }];
    data.options = [{ SectionCode: '1', RequirementCode: '1', OptionCode: '1', OptionName: 'Policy exists' }];
    data.subOptions = [
      { SectionCode: '1', RequirementCode: '1', OptionCode: '1', SubOptionCode: '1', SubOptionName: 'Signed by owner' },
      { SectionCode: '1', RequirementCode: '1', OptionCode: '2', SubOptionCode: '1', SubOptionName: 'Other option' },
    ];
    await create(data);
    await openTab('Parameters');
    (el.querySelector('.final-submit') as HTMLButtonElement).click();
    await settle(fixture);
    http.expectOne(BASE + '/final-submit/check').flush({ allowed: true, message: null, raisesNc: true });
    await settle(fixture);
    const items = [...el.querySelectorAll('.modal li')].map((li) => li.textContent!.trim());
    expect(items).toEqual(['Signed by owner']);
    expect(el.querySelector('.modal')!.textContent).toContain('Policy exists');
  });
  describe('NC round', () => {
    const SITE = '/api/staff/site-review/ZEDMSME000001/Silver';
    const round = {
      ncCount: 1,
      products: [{ id: 32, productName: 'Valve', exported: 'No', ncCount: 1, productParentId: null, photoUrl: null, descriptionUrl: null, descriptionKind: null, isSaVerified: null, saAssessorRemarks: null, msmeRemarks: 'New label' }],
      oldProducts: [],
      sections: [{ Id: 42, SectionCode: '1', SectionName: 'Leadership' }],
      requirements: [{ Id: 52, SectionCode: '1', RequirementCode: '1', SaConformance: null, SaAssessorRemarks: null, MsmeComments: 'Policy signed', PreviousAssessorRemarks: 'Policy not signed' }],
      options: [{ SectionCode: '1', RequirementCode: '1', OptionCode: '1', OptionName: 'Policy exists' }],
      subOptions: [],
      evidences: [{ Id: 93, SectionCode: '1', RequirementCode: '1', EvidenceName: 'NC1', FileUrl: '/files/nc1.pdf' }],
      photos: [],
      commentsId: null,
      assessorComments: null,
    };

    function ncDetails(submitted: boolean): RemoteDetails {
      return { ...details(), msme: { ...details().msme, CertificationStatus: 14, NcCount: 1 }, nc: { round: 1, submitted } };
    }

    async function createNc(data: RemoteDetails) {
      await create(data);
      http.expectOne(SITE).flush({ ncRounds: [round] });
      await settle(fixture);
    }

    it('opens on the NC tab and waits for the MSME before anything can be assessed', async () => {
      await createNc(ncDetails(false));
      expect(el.querySelector('#ncState')!.textContent).toContain('NC 1 has been raised to the MSME');
      expect(el.querySelector('.nav-link.active')!.textContent!.trim()).toBe('NC 1');
      expect(el.querySelector('.nc-waiting')).not.toBeNull();
      expect(el.querySelector('.nc-final-submit')).toBeNull();
    });

    it('shows the MSME answers, validates the round rows and keeps the first assessment read-only', async () => {
      await createNc(ncDetails(true));
      expect(el.querySelector('table.nc-products')!.textContent).toContain('New label');
      const requirement = el.querySelector('table.nc-requirement')!.textContent!;
      expect(requirement).toContain('Policy not signed');
      expect(requirement).toContain('Policy signed');
      expect(el.querySelector('a.nc-evidence')!.getAttribute('href')).toBe('/files/nc1.pdf');

      (el.querySelector('.nc-validate-product') as HTMLButtonElement).click();
      await settle(fixture);
      const yes = el.querySelector('.modal input[value=Yes]') as HTMLInputElement;
      yes.click();
      yes.dispatchEvent(new Event('change'));
      (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settle(fixture);
      const req = http.expectOne(BASE + '/products/32/validate');
      expect(req.request.body).toEqual({ isVerified: 'Yes', remarks: '' });
      req.flush({ message: 'Data Updated' });
      await reload(ncDetails(true));
      http.expectOne(SITE).flush({ ncRounds: [round] });
      await settle(fixture);

      (el.querySelector('.nc-validate-requirement') as HTMLButtonElement).click();
      await settle(fixture);
      expect(el.querySelector('.modal-title')!.textContent).toContain('Conformance');

      (el.querySelector('.modal .btn-close') as HTMLButtonElement).click();
      await settle(fixture);
      await openTab('Parameters');
      expect(el.querySelector('.validate-requirement')).toBeNull();
      expect(el.querySelector('.final-submit')).toBeNull();
    });

    it('final-submits the round and shows the server message', async () => {
      await createNc(ncDetails(true));
      (el.querySelector('.nc-final-submit') as HTMLButtonElement).click();
      await settle(fixture);
      http.expectOne(BASE + '/final-submit/check').flush({ allowed: true, message: null, raisesNc: false });
      await settle(fixture);
      (el.querySelector('#finalComments') as HTMLTextAreaElement).value = 'NCs closed';
      el.querySelector('#finalComments')!.dispatchEvent(new Event('input'));
      const confirm = el.querySelector('#finalConfirm') as HTMLInputElement;
      confirm.click();
      confirm.dispatchEvent(new Event('change'));
      await settle(fixture);
      (el.querySelector('.modal .submit') as HTMLInputElement).click();
      await settle(fixture);
      http.expectOne(BASE + '/final-submit').flush({ message: 'Assessment submitted. The NCs are closed and the assessment goes to the agency.' });
      // The onsite unit is no longer open here (404): only the outcome and the way back stay.
      await settle(fixture);
      http.expectOne((r) => r.method === 'GET' && r.url === BASE).flush({ title: 'Not Found' }, { status: 404, statusText: 'Not Found' });
      await settle(fixture);
      expect(el.querySelector('.alert-success')!.textContent).toContain('The NCs are closed');
      expect(el.querySelector('.alert-danger')).toBeNull();
      expect(el.querySelector('a.back-to-list')).not.toBeNull();
      expect(el.querySelector('.nav-tabs')).toBeNull();
    });
  });
});
