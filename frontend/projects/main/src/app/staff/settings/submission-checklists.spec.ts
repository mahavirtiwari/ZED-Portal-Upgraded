import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ObservationReasonsPage, ObservationReasonsResponse } from './observation-reasons';
import { ChecklistView, SubmissionChecklistsPage, itemId } from './submission-checklists';

/** 2026-11-17 (approved): Admin → Submission checklists and Admin → Observation reasons. */
async function settle(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

const button = (root: ParentNode, text: string) =>
  [...root.querySelectorAll('button, input[type=button]')].find((b) => (b.textContent || (b as HTMLInputElement).value).trim() === text) as HTMLButtonElement;

describe('SubmissionChecklistsPage', () => {
  let fixture: ComponentFixture<SubmissionChecklistsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  const url = '/api/staff/settings/submission-checklists';

  const lists = (): ChecklistView[] => [
    {
      code: 'agency-qc', title: 'Agency quality check', who: 'agency', stages: ['Desktop', 'Site'], customised: false,
      items: [
        { id: 'exemptions', text: 'Exemptions reviewed.', stages: ['Desktop'], active: true },
        { id: 'photos', text: 'Photos are geo-tagged.', stages: ['Site'], active: true },
        { id: 'old', text: 'Old item.', stages: ['Desktop', 'Site'], active: false },
      ],
    },
    {
      code: 'assessor-submit', title: 'Assessor final submit', who: 'assessor', stages: ['Desktop', 'Remote', 'Onsite'], customised: true,
      items: [{ id: 'coi', text: 'No conflict of interest.', stages: ['Desktop', 'Remote', 'Onsite'], active: true }],
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SubmissionChecklistsPage], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(SubmissionChecklistsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle(fixture);
    http.expectOne(url).flush({ checklists: lists() });
    await settle(fixture);
  });

  afterEach(() => http.verify());

  it('lists the chosen checklist with where each item is asked, and switches checklists', () => {
    const text = el.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Items (2 on)');
    expect(text).toContain('1 · 1');
    expect(el.querySelector('tr[data-id="exemptions"]')!.textContent).toContain('Desktop');
    expect(el.querySelector('tr[data-id="old"]')!.textContent).toContain('Off');
    expect(button(el, 'Reset to standard items').disabled).toBe(true);

    (el.querySelector('[data-checklist="assessor-submit"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('tr[data-id="coi"]')!.textContent).toContain('Onsite (app)');
    expect(button(el, 'Reset to standard items').disabled).toBe(false);
  });

  it('adds an item with its stages and saves the whole list', async () => {
    button(el, 'Add item').click();
    await settle(fixture);
    const dialog = el.querySelector('[role=dialog]') as HTMLElement;
    button(dialog, 'Save').click();
    await settle(fixture);
    expect(dialog.textContent).toContain('Enter the item.');

    const text = dialog.querySelector('#itemText') as HTMLTextAreaElement;
    text.value = 'NC remarks are complete';
    text.dispatchEvent(new Event('input'));
    (dialog.querySelector('[data-stage="Desktop"]') as HTMLInputElement).click();
    await settle(fixture);
    button(dialog, 'Save').click();
    await settle(fixture);
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === `${url}/agency-qc`);
    expect(put.request.body.items.map((i: { id: string }) => i.id)).toEqual(['exemptions', 'photos', 'old', 'nc-remarks-are-complete']);
    expect(put.request.body.items[3]).toEqual({ id: 'nc-remarks-are-complete', text: 'NC remarks are complete', stages: ['Site'], active: true });
    put.flush({ message: 'Agency quality check checklist saved.' });
    await settle(fixture);
    http.expectOne(url).flush({ checklists: lists() });
    await settle(fixture);
    expect(el.querySelector('.alert-success')!.textContent).toContain('checklist saved');
  });

  it('moves an item and refuses an item asked nowhere', async () => {
    (el.querySelector('tr[data-id="photos"] [aria-label="Move up"]') as HTMLButtonElement).click();
    await settle(fixture);
    const put = http.expectOne(`${url}/agency-qc`);
    expect(put.request.body.items.map((i: { id: string }) => i.id)).toEqual(['photos', 'exemptions', 'old']);
    put.flush({ message: 'Saved.' });
    await settle(fixture);
    http.expectOne(url).flush({ checklists: lists() });
    await settle(fixture);

    button(el.querySelector('tr[data-id="exemptions"]')!, 'Edit').click();
    await settle(fixture);
    const dialog = el.querySelector('[role=dialog]') as HTMLElement;
    (dialog.querySelector('[data-stage="Desktop"]') as HTMLInputElement).click();
    await settle(fixture);
    expect(dialog.textContent).toContain('Choose where it is asked.');
    button(dialog, 'Save').click();
    await settle(fixture);
  });

  it('makes a key from the text', () => {
    expect(itemId('All photos seen!', [])).toBe('all-photos-seen');
    expect(itemId('All photos seen', ['all-photos-seen'])).toBe('all-photos-seen-2');
    expect(itemId('***', [])).toBe('item');
  });
});

describe('ObservationReasonsPage', () => {
  let fixture: ComponentFixture<ObservationReasonsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  const url = '/api/staff/settings/observation-reasons';

  const response = (): ObservationReasonsResponse => ({
    reasons: [
      { id: 'evidence', text: 'Evidence not checked properly', severity: 'Major', active: true },
      { id: 'conduct', text: 'Conduct', severity: 'Critical', active: true },
      { id: 'other', text: 'Other', severity: 'Minor', active: false },
    ],
    severities: ['Minor', 'Major', 'Critical'],
    used: { 'evidence not checked properly': 4, Conduct: 1 },
    customised: false,
    handholding: false,
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ObservationReasonsPage], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(ObservationReasonsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle(fixture);
    http.expectOne(url).flush(response());
    await settle(fixture);
  });

  afterEach(() => http.verify());

  it('lists the reasons with their severity and how often each was used', () => {
    const row = (id: string) => el.querySelector(`tr[data-id="${id}"]`)!.textContent!.replace(/\s+/g, ' ');
    expect(row('evidence')).toContain('Major');
    const used = (id: string) => el.querySelector(`tr[data-id="${id}"] td:nth-child(4)`)!.textContent!.trim();
    expect([used('evidence'), used('conduct'), used('other')]).toEqual(['4', '1', '0']);
    expect(row('conduct')).toContain('Critical');
    expect(row('other')).toContain('Off');
    expect(el.textContent).toContain('holds the final submit');
  });

  it('edits a reason and its severity', async () => {
    button(el.querySelector('tr[data-id="other"]')!, 'Edit').click();
    await settle(fixture);
    const dialog = el.querySelector('[role=dialog]') as HTMLElement;
    const text = dialog.querySelector('#reasonText') as HTMLInputElement;
    text.value = 'conduct';
    text.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(dialog.textContent).toContain('Another reason has this wording.');
    text.value = 'Late reporting';
    text.dispatchEvent(new Event('input'));
    (dialog.querySelector('[data-severity="Major"]') as HTMLButtonElement).click();
    await settle(fixture);
    (el.querySelector('#reasonActive') as HTMLInputElement).click();
    await settle(fixture);
    button(el.querySelector('[role=dialog]')!, 'Save').click();
    await settle(fixture);
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === url);
    expect(put.request.body.reasons[2]).toEqual({ id: 'other', text: 'Late reporting', severity: 'Major', active: true });
    put.flush({ message: 'Observation reasons saved.' });
    await settle(fixture);
    http.expectOne(url).flush(response());
    await settle(fixture);
  });
});
