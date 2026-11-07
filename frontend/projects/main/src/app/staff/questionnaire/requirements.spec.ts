import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { RequirementsPage } from './requirements';
import { RequirementsResponse } from './questionnaire.api';

const BASE = '/api/staff/questionnaire/Bronze/P1/requirements';

async function settle(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

function type(el: HTMLElement, selector: string, value: string) {
  const input = el.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function buttonByText(el: HTMLElement, text: string): HTMLButtonElement {
  return [...el.querySelectorAll('button')].find((b) => b.textContent!.replace(/\s+/g, ' ').trim() === text) as HTMLButtonElement;
}

const response: RequirementsResponse = {
  sectionType: 'Bronze',
  sectionCode: 'P1',
  sectionName: 'Leadership',
  checklistReady: true,
  requirements: [
    {
      id: 11, requirementCode: '1', canRemove: false, purpose: 'Clear roles', benefits: 'Fewer gaps', videoUrl: 'https://youtu.be/abc123',
      points: [{ id: 101, optionCode: '1', name: '<img src=x onerror=alert(1)>', bullets: [{ id: 501, subOptionCode: '1', name: 'Bullet A' }], actions: ['Prepare a chart'] }],
      mandatoryEvidences: [
        { evidenceCode: '1', evidenceName: 'Org chart', helpText: 'Signed', validationRequired: true, optionCode: '1', sampleFile: 'sample_20261030_abcd1234.pdf' },
        { evidenceCode: '2', evidenceName: 'Old policy', helpText: null, validationRequired: false, optionCode: null, sampleFile: null },
      ],
      optionalEvidences: [{ evidenceCode: '3', evidenceName: 'Photo', helpText: null, validationRequired: false, optionCode: '1', sampleFile: null }],
    },
    {
      id: 12, requirementCode: '2', canRemove: true, purpose: null, benefits: null,
      points: [{ id: 201, optionCode: '1', name: 'First', bullets: [], actions: [] }, { id: 202, optionCode: '2', name: 'Second', bullets: [], actions: [] }],
      mandatoryEvidences: [], optionalEvidences: [],
    },
  ],
};

describe('RequirementsPage', () => {
  let fixture: ComponentFixture<RequirementsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RequirementsPage],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ sectionType: 'Bronze', sectionCode: 'P1' }) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RequirementsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle(fixture);
    http.expectOne(BASE).flush(response);
    await settle(fixture);
  });

  afterEach(() => vi.restoreAllMocks());

  it('lists the requirements with what each lacks, and shows the chosen one with its video, purpose and checkpoints, as text', async () => {
    expect(el.querySelector('.summary')!.textContent!.replace(/\s+/g, ' ')).toContain('2 requirements · 3 checkpoints · 3 evidences (2 mandatory) · 1 action');
    const items = [...el.querySelectorAll('.rq-item')];
    expect(items.map((i) => i.querySelector('.rq-code')!.textContent)).toEqual(['P1.1', 'P1.2']);
    expect(items[1].querySelector('.rq-name')!.textContent).toBe('First');
    expect(items[1].querySelector('.rq-missing')!.textContent).toBe('Missing: purpose, benefits, evidence, action');
    expect(items[0].querySelector('.rq-ok')!.textContent).toContain('Complete');

    const card = el.querySelector('.req-card')!;
    expect(card.querySelector('.req-meta')!.textContent!.replace(/\s+/g, ' ')).toContain('1 checkpoint · 3 evidences · 1 action');
    expect(card.querySelector('.video-link')!.getAttribute('href')).toBe('https://youtu.be/abc123');
    expect(card.querySelector('.pb')!.textContent).toContain('Clear roles');
    // Shown as text, never as HTML.
    expect(card.querySelector('.point-text')!.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(card.querySelector('.point-text img')).toBeNull();
    const cp = card.querySelector('.cpv')!;
    expect(cp.querySelector('.bullets')!.textContent).toContain('Bullet A');
    expect(cp.querySelectorAll('.cpv-col')[0].textContent).toContain('Org chart');
    expect(cp.querySelectorAll('.cpv-col')[0].textContent).toContain('MANDATORY');
    expect(cp.querySelector('.samp')!.getAttribute('href')).toBe(`${BASE}/samples/sample_20261030_abcd1234.pdf`);
    expect(cp.querySelectorAll('.cpv-col')[1].textContent).toContain('Prepare a chart');
    // Added before checkpoints: listed as the whole requirement's.
    expect(card.querySelector('.general-row')!.textContent).toContain('Old policy');
    // 1.1 cannot be removed; choosing 1.2 shows it, with Delete and no video yet.
    expect(el.querySelectorAll('.remove-requirement').length).toBe(0);
    (items[1] as HTMLButtonElement).click();
    await settle(fixture);
    expect(el.querySelector('.req-card .video-row')!.textContent).toContain('No video tutorial yet');
    expect(el.querySelector('.req-card .pb')!.textContent).toContain('Not written yet');
    expect(el.querySelectorAll('.remove-requirement').length).toBe(1);
  });

  it('adds a requirement with its checkpoints, evidence, actions and video tutorial', async () => {
    (el.querySelector('.add-requirement') as HTMLButtonElement).click();
    await settle(fixture);
    type(el, '#purpose', 'Why');
    type(el, '#video', ' https://www.youtube.com/watch?v=xyz ');
    type(el, '#cp-0', 'Defined?');
    type(el, 'input[aria-label="Evidence 1 of checkpoint 1"]', 'Chart');
    type(el, 'input[aria-label="Action 1 of checkpoint 1"]', 'Prepare a chart');
    await settle(fixture);
    expect(el.querySelector('.field .count')!.textContent).toContain('3 / 500');

    // The add buttons are coloured buttons.
    expect(buttonByText(el, '+ Add evidence').classList).toContain('btn-add-evidence');
    expect(buttonByText(el, '+ Add action').classList).toContain('btn-add-action');
    expect(buttonByText(el, '+ Add checkpoint').classList).toContain('btn-add-checkpoint');
    buttonByText(el, '+ Add checkpoint').click();
    await settle(fixture);
    type(el, '#cp-1', 'Communicated?');
    (el.querySelectorAll('.cp .tick input')[1] as HTMLInputElement).click();
    await settle(fixture);
    buttonByText(el, 'SAVE REQUIREMENT').click();
    await settle(fixture);
    const req = http.expectOne(`${BASE}/checklist`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      purpose: 'Why', benefits: '', videoUrl: 'https://www.youtube.com/watch?v=xyz',
      checkpoints: [
        { optionCode: null, text: 'Defined?', evidences: [{ evidenceName: 'Chart', mandatory: true, sampleFile: null, helpText: null, validationRequired: false }], actions: ['Prepare a chart'] },
        { optionCode: null, text: 'Communicated?', evidences: [], actions: [] },
      ],
      generalEvidences: [],
    });
    req.flush({ message: 'Requirement P1.3 saved.' });
    await settle(fixture);
    http.expectOne(BASE).flush(response);
    await settle(fixture);
    expect(el.querySelector('.alert-success')!.textContent).toContain('P1.3 saved');
    expect(el.querySelector('.req-form')).toBeNull();
    http.verify();
  });

  it('edits a requirement, keeping its checkpoint codes, sample copies and the whole requirement evidence', async () => {
    (el.querySelector('.edit-requirement') as HTMLButtonElement).click();
    await settle(fixture);
    expect((el.querySelector('#purpose') as HTMLTextAreaElement).value).toBe('Clear roles');
    expect((el.querySelector('#video') as HTMLInputElement).value).toBe('https://youtu.be/abc123');
    expect(el.querySelector('.file')!.textContent).toBe('sample_20261030_abcd1234.pdf');
    type(el, '#cp-0', 'Are roles defined?');
    await settle(fixture);
    buttonByText(el, 'UPDATE REQUIREMENT').click();
    await settle(fixture);
    const req = http.expectOne(`${BASE}/11/checklist`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.checkpoints[0]).toEqual({
      optionCode: '1', text: 'Are roles defined?', actions: ['Prepare a chart'],
      evidences: [
        { evidenceName: 'Org chart', mandatory: true, sampleFile: 'sample_20261030_abcd1234.pdf', helpText: 'Signed', validationRequired: true },
        { evidenceName: 'Photo', mandatory: false, sampleFile: null, helpText: null, validationRequired: false },
      ],
    });
    expect(req.request.body.videoUrl).toBe('https://youtu.be/abc123');
    expect(req.request.body.generalEvidences).toEqual([{ evidenceName: 'Old policy', mandatory: true, sampleFile: null, helpText: null, validationRequired: false }]);
    req.flush({ message: 'Requirement P1.1 updated.' });
    await settle(fixture);
    http.expectOne(BASE).flush(response);
  });

  it('uploads a sample copy for an evidence', async () => {
    (el.querySelector('.add-requirement') as HTMLButtonElement).click();
    await settle(fixture);
    const input = el.querySelector('.up input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['%PDF'], 'chart.pdf', { type: 'application/pdf' })] });
    input.dispatchEvent(new Event('change'));
    await settle(fixture);
    http.expectOne(`${BASE}/samples`).flush({ fileName: 'sample_20261030_00000001.pdf', message: 'ok' });
    await settle(fixture);
    expect(el.querySelector('.file')!.textContent).toBe('sample_20261030_00000001.pdf');
  });

  it('asks for the checkpoint text, and a web address for the video, before saving', async () => {
    (el.querySelector('.add-requirement') as HTMLButtonElement).click();
    await settle(fixture);
    buttonByText(el, 'SAVE REQUIREMENT').click();
    await settle(fixture);
    expect(el.querySelector('.help-block')!.textContent).toContain('Please write checkpoint 1');
    type(el, '#cp-0', 'Defined?');
    type(el, '#video', 'youtube.com/watch');
    await settle(fixture);
    buttonByText(el, 'SAVE REQUIREMENT').click();
    await settle(fixture);
    expect(el.querySelector('.help-block')!.textContent).toContain('video link');
    http.expectNone(`${BASE}/checklist`);
  });

  it('removes the last requirement after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    (el.querySelectorAll('.rq-item')[1] as HTMLButtonElement).click();
    await settle(fixture);
    (el.querySelector('.remove-requirement') as HTMLButtonElement).click();
    await settle(fixture);
    const req = http.expectOne(`${BASE}/12`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ message: 'Requirement Removed.' });
    await settle(fixture);
    http.expectOne(BASE).flush(response);
  });

  it('says when the database is not ready for checkpoints', async () => {
    fixture = TestBed.createComponent(RequirementsPage);
    el = fixture.nativeElement;
    await settle(fixture);
    http.expectOne(BASE).flush({ ...response, checklistReady: false });
    await settle(fixture);
    expect(el.querySelector('.alert-warning')!.textContent).toContain('migration 0034');
    expect((el.querySelector('.edit-requirement') as HTMLButtonElement).disabled).toBe(true);
    expect(el.querySelector('zed-excel-tools')).toBeNull();
  });
});
