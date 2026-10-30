import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EsgChecklistPage, EsgChecklistResponse } from './esg-checklist';
import { ADMIN_PORTAL, AdminPortalService } from '../admin-portal';

describe('EsgChecklistPage', () => {
  let fixture: ComponentFixture<EsgChecklistPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  const url = '/api/staff/settings/esg-checklist';

  const checklist = (customised = false): EsgChecklistResponse => ({
    checklist: {
      sections: [
        {
          title: 'ESG check list',
          questions: [
            { id: 1, question: 'Are you registered under the Factories Act, 1948?', options: ['Yes', 'No', 'Not Applicable'], followUps: [] },
            {
              id: 2, question: 'Is COE and COO applicable to you?', options: ['Yes', 'No', 'Not Applicable'],
              followUps: [{ id: 3, showOn: 'Yes', question: 'If yes, have you acquired the Certificate?', type: 'single_choice', options: ['Yes', 'No'] }],
            },
          ],
        },
        { title: 'Social / OHS check list', questions: [{ id: 16, question: 'Minimum wages?', options: ['Yes', 'No'], followUps: [] }] },
      ],
    },
    customised, version: customised ? '1.7.2' : '1.7', updatedBy: customised ? 'ADMIN1' : null, updatedOn: customised ? '2026-10-27T10:00:00' : null,
  });

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const button = (text: string, root: ParentNode = el) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent!.trim() === text) as HTMLButtonElement;
  const sections = () => [...el.querySelectorAll('section.esg-section')];
  const type = async (input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    await settle();
  };

  async function open(r = checklist()) {
    // Main's own checklist only (the surveillance portal's list has its own test).
    await TestBed.configureTestingModule({
      imports: [EsgChecklistPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: AdminPortalService, useValue: { enabled: false } }],
    }).compileComponents();
    fixture = TestBed.createComponent(EsgChecklistPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne(url).flush(r);
    await settle();
  }

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('shows the two sections with their questions, options and follow-ups', async () => {
    await open();
    expect(sections().length).toBe(2);
    expect(el.textContent).toContain('Standard checklist');
    const first = sections()[0];
    expect((first.querySelector('input.esg-title') as HTMLInputElement).value).toBe('ESG check list');
    expect([...first.querySelectorAll('textarea')].map((t) => t.value)).toEqual(['Are you registered under the Factories Act, 1948?', 'Is COE and COO applicable to you?']);
    expect((first.querySelector('#o-0-1') as HTMLInputElement).value).toBe('Yes, No, Not Applicable');
    expect((first.querySelector('#f-Yes0-1') as HTMLInputElement).checked).toBe(true);
    expect((first.querySelector('#f-No0-1') as HTMLInputElement).checked).toBe(false);
    expect(button('Save').disabled).toBe(true);
    expect(button('Reset to standard')).toBeUndefined();
  });

  it('edits, adds a question with a follow-up on No and saves the checklist with the codes kept', async () => {
    await open();
    await type(el.querySelector('#q-0-0') as HTMLTextAreaElement, 'Registered under the Factories Act?');
    button('+ Add question', sections()[1]).click();
    await settle();
    await type(el.querySelector('#q-1-1') as HTMLTextAreaElement, 'Is there a creche?');
    await type(el.querySelector('#o-1-1') as HTMLInputElement, 'Yes, No');
    (el.querySelector('#f-No1-1') as HTMLInputElement).click();
    await settle();
    await type(el.querySelector('[aria-label="Follow-up on No"]') as HTMLInputElement, 'If no, why?');
    // The follow-up of question 2 becomes a text.
    await type(el.querySelector('[aria-label="Answer type of the follow-up on Yes"]') as HTMLSelectElement, 'text_box');
    expect(el.textContent).toContain('Not saved yet.');

    button('Save').click();
    await settle();
    const req = http.expectOne((r) => r.url === url && r.method === 'PUT');
    const [esg, social] = req.request.body.sections;
    expect(esg.questions[0]).toEqual({ id: 1, question: 'Registered under the Factories Act?', options: ['Yes', 'No', 'Not Applicable'], followUps: [] });
    expect(esg.questions[1].followUps).toEqual([{ id: 3, showOn: 'Yes', question: 'If yes, have you acquired the Certificate?', type: 'text_box', options: [] }]);
    expect(social.questions[1]).toEqual({
      id: null, question: 'Is there a creche?', options: ['Yes', 'No'],
      followUps: [{ id: null, showOn: 'No', question: 'If no, why?', type: 'text_box', options: [] }],
    });
    req.flush({ message: 'ESG checklist saved.' });
    await settle();
    http.expectOne(url).flush(checklist(true));
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('ESG checklist saved.');
    expect(el.textContent).toContain('Changed by ADMIN1');
    expect(button('Save').disabled).toBe(true);
  });

  it('moves and removes questions, and shows why the server refused', async () => {
    await open();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    (el.querySelector('[aria-label="Move question 2 up"]') as HTMLButtonElement).click();
    await settle();
    (el.querySelector('[aria-label="Remove question 2"]') as HTMLButtonElement).click();
    await settle();
    expect([...sections()[0].querySelectorAll('textarea')].map((t) => t.value)).toEqual(['Is COE and COO applicable to you?']);
    // The last question of a section cannot be removed.
    expect((el.querySelector('[aria-label="Remove question 1"]') as HTMLButtonElement).disabled).toBe(true);

    button('Save').click();
    await settle();
    expect(http.expectOne((r) => r.method === 'PUT').request.body.sections[0].questions.map((q: { id: number }) => q.id)).toEqual([2]);
  });

  it('shows a section at a time with the counts and the options as chips', async () => {
    await open();
    // 2 sections, 3 questions, 1 follow-up.
    expect([...el.querySelectorAll('.stat-value')].map((v) => v.textContent!.trim())).toEqual(['2', '3', '1']);
    const tabs = () => [...el.querySelectorAll('.esg-tab')];
    expect(tabs().map((t) => t.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['ESG check list 2', 'Social / OHS check list 1']);
    expect(sections().map((s) => (s as HTMLElement).hidden)).toEqual([false, true]);
    (tabs()[1] as HTMLButtonElement).click();
    await settle();
    expect(sections().map((s) => (s as HTMLElement).hidden)).toEqual([true, false]);

    await type(el.querySelector('#o-1-0') as HTMLInputElement, 'Yes, No, Partly');
    expect([...sections()[1].querySelectorAll('.opt-chip')].map((c) => c.textContent!.trim())).toEqual(['Yes', 'No', 'Partly']);
    button('+ Add question', sections()[1]).click();
    await settle();
    expect(tabs()[1].textContent).toContain('2');
    expect(el.querySelector('.save-bar.is-dirty')!.textContent).toContain('Not saved yet.');
  });

  it('shows a refusal of the server', async () => {
    await open();
    await type(el.querySelector('#o-0-0') as HTMLInputElement, 'Yes');
    button('Save').click();
    await settle();
    http.expectOne((r) => r.method === 'PUT').flush({ title: 'ESG check list, question 1: give 2 to 6 options.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('give 2 to 6 options');
  });

  it('goes back to the standard checklist after a confirmation', async () => {
    await open(checklist(true));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    button('Reset to standard').click();
    await settle();
    http.expectNone((r) => r.method === 'DELETE');
    confirm.mockReturnValue(true);
    button('Reset to standard').click();
    await settle();
    http.expectOne((r) => r.method === 'DELETE').flush({ message: 'The standard ESG checklist is used again.' });
    await settle();
    http.expectOne(url).flush(checklist());
    await settle();
    expect(el.textContent).toContain('Standard checklist');
  });
});

describe('EsgChecklistPage (one Admin)', () => {
  const url = '/api/staff/settings/esg-checklist';
  const q = (id: number | null, question: string) => ({ id, question, options: ['Yes', 'No'], followUps: [] });
  const response = (sections: { title: string; questions: ReturnType<typeof q>[] }[]): EsgChecklistResponse =>
    ({ checklist: { sections }, customised: true, version: '1.7.2', updatedBy: 'ADMIN1', updatedOn: null });

  it('ticks each question for ZED Certification and Surveillance and saves each portal its questions under the same codes', async () => {
    await TestBed.configureTestingModule({ imports: [EsgChecklistPage], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    const fixture = TestBed.createComponent(EsgChecklistPage);
    const http = TestBed.inject(HttpTestingController);
    const el: HTMLElement = fixture.nativeElement;
    const settle = async () => {
      fixture.detectChanges();
      await new Promise((r) => setTimeout(r));
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const main = (r: { url: string; context: { get: (t: typeof ADMIN_PORTAL) => string | null } }) => r.url === url && r.context.get(ADMIN_PORTAL) === null;
    const surv = (r: { url: string; context: { get: (t: typeof ADMIN_PORTAL) => string | null } }) => r.url === url && r.context.get(ADMIN_PORTAL) === 'surveillance';
    await settle();
    http.expectOne(main).flush(response([{ title: 'ESG', questions: [q(1, 'Factories Act?'), q(2, 'COE?')] }, { title: 'OHS', questions: [q(16, 'Wages?')] }]));
    await settle();
    http.expectOne(surv).flush(response([{ title: 'ESG', questions: [q(1, 'Factories Act?'), q(30, 'Surveillance only?')] }, { title: 'OHS', questions: [] }]));
    await settle();
    // Each portal needs a question in every section: saving says so first.
    ([...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Save') as HTMLButtonElement).disabled = false;
    ([...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Save') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('needs at least one question for Surveillance');
    const ohs = [...el.querySelectorAll('section.esg-section')][1].querySelectorAll('.used-in input');
    (ohs[1] as HTMLInputElement).click(); // Wages? on surveillance too
    await settle();
    const ticks = () => [...el.querySelectorAll('section.esg-section')][0].querySelectorAll('.used-in input');
    // 1: both; 2: main only; 30: surveillance only.
    expect([...ticks()].map((t) => (t as HTMLInputElement).checked)).toEqual([true, true, true, false, false, true]);

    (ticks()[3] as HTMLInputElement).click(); // question 2 on surveillance too
    await settle();
    ([...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Save') as HTMLButtonElement).click();
    await settle();
    const putMain = http.expectOne((r) => r.method === 'PUT' && main(r));
    expect(putMain.request.body.sections[0].questions.map((x: { id: number }) => x.id)).toEqual([1, 2]);
    putMain.flush({ message: 'ESG checklist saved. The apps get it the next time they open the checklist.' });
    await settle();
    http.expectOne((r) => r.method === 'GET' && main(r)).flush(response([{ title: 'ESG', questions: [q(1, 'Factories Act?'), q(2, 'COE?')] }, { title: 'OHS', questions: [q(16, 'Wages?')] }]));
    await settle();
    const putSurv = http.expectOne((r) => r.method === 'PUT' && surv(r));
    expect(putSurv.request.body.sections[0].questions.map((x: { id: number }) => x.id)).toEqual([1, 2, 30]);
    expect(putSurv.request.body.sections[1].questions.map((x: { id: number }) => x.id)).toEqual([16]);
    putSurv.flush({ message: 'ok' });
    await settle();
    http.expectOne(main).flush(response([{ title: 'ESG', questions: [q(1, 'Factories Act?'), q(2, 'COE?')] }, { title: 'OHS', questions: [q(16, 'Wages?')] }]));
    await settle();
    http.expectOne(surv).flush(response([{ title: 'ESG', questions: [q(1, 'Factories Act?'), q(2, 'COE?'), q(30, 'Surveillance only?')] }, { title: 'OHS', questions: [q(16, 'Wages?')] }]));
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('for ZED Certification and Surveillance');
    http.verify();
  });
});
