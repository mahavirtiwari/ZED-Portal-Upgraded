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

function click(el: HTMLElement, selector: string) {
  (el.querySelector(selector) as HTMLElement).click();
}

function buttonByText(el: HTMLElement, text: string): HTMLButtonElement {
  return [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === text) as HTMLButtonElement;
}

const response: RequirementsResponse = {
  sectionType: 'Bronze',
  sectionCode: 'P1',
  sectionName: 'Leadership',
  requirements: [
    {
      id: 11, requirementCode: '1', canRemove: false,
      points: [{ id: 101, optionCode: '1', name: '<img src=x onerror=alert(1)>', bullets: [{ id: 501, subOptionCode: '1', name: 'Bullet A' }] }],
      mandatoryEvidences: [{ evidenceCode: '1', evidenceName: 'Policy', helpText: 'Signed', validationRequired: true }],
      optionalEvidences: [{ evidenceCode: '2', evidenceName: 'Photo', helpText: null, validationRequired: false }],
    },
    {
      id: 12, requirementCode: '2', canRemove: true,
      points: [{ id: 201, optionCode: '1', name: 'First', bullets: [] }, { id: 202, optionCode: '2', name: 'Second', bullets: [] }],
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

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('lists requirements as text with only the allowed remove buttons', () => {
    expect(el.textContent).toContain('Bronze – P1. Leadership');
    const rows = el.querySelectorAll('table.requirements tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('<img src=x onerror=alert(1)>');
    expect(el.querySelector('table.requirements img')).toBeNull();
    expect(rows[0].textContent).toContain('(Validation Required)');
    expect(rows[0].querySelector('.remove-requirement')).toBeNull();
    expect(rows[1].querySelector('.remove-requirement')).not.toBeNull();
    // Only the last point after the first has a remove button.
    expect(rows[0].querySelectorAll('.remove-point').length).toBe(0);
    expect(rows[1].querySelectorAll('.remove-point').length).toBe(1);
    expect(el.querySelector('a.btn')!.getAttribute('href')).toBe('/staff/masters/parameters/Bronze');
  });

  it('builds a requirement from points and bullets and saves it', async () => {
    type(el, '#requirementName', 'Point one');
    click(el, 'form button[type=submit]');
    await settle(fixture);
    click(el, '.draft-points button.btn-primary');
    await settle(fixture);
    type(el, '#bulletText', 'Bullet x');
    (el.querySelector('#bulletText') as HTMLElement).closest('form')!.dispatchEvent(new Event('submit'));
    await settle(fixture);
    click(el, '.modal [aria-label=Close]');
    await settle(fixture);
    expect(el.querySelector('.draft-points')!.textContent).toContain('Bullet x');

    buttonByText(el, 'Save').click();
    const req = http.expectOne((r) => r.method === 'POST' && r.url === BASE);
    expect(req.request.body).toEqual({ points: [{ name: 'Point one', bullets: ['Bullet x'] }] });
    req.flush({ message: 'Requirement saved.' });
    await settle(fixture);
    http.expectOne(BASE).flush(response);
    await settle(fixture);
    expect(el.querySelector('.alert-success')!.textContent).toContain('Requirement saved.');
    expect(el.querySelector('.draft-points')).toBeNull();
  });

  it('adds mandatory evidences and sends both lists', async () => {
    buttonByText(el, 'Add Evidences').click();
    await settle(fixture);
    type(el, '#evidenceName', 'Certificate');
    type(el, '#evidenceHelp', 'Latest one');
    click(el, '.add-evidence');
    await settle(fixture);
    expect(el.querySelectorAll('.modal tr.added').length).toBe(1);
    click(el, '.save-evidences');
    const req = http.expectOne((r) => r.method === 'PUT' && r.url === BASE + '/11/evidences');
    expect(req.request.body).toEqual({
      mandatoryEvidences: [
        { evidenceName: 'Policy', helpText: 'Signed', validationRequired: true },
        { evidenceName: 'Certificate', helpText: 'Latest one', validationRequired: false },
      ],
      optionalEvidences: [{ evidenceName: 'Photo', helpText: null, validationRequired: false }],
    });
    req.flush({ message: 'Evidences saved.' });
    await settle(fixture);
    http.expectOne(BASE).flush(response);
    await settle(fixture);
    expect(el.querySelector('.modal')).toBeNull();
  });

  it('removes the last requirement after confirmation and shows API errors', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    click(el, '.remove-requirement');
    await settle(fixture);
    http.expectNone((r) => r.method === 'DELETE');

    confirm.mockReturnValue(true);
    click(el, '.remove-point');
    const del = http.expectOne((r) => r.method === 'DELETE' && r.url === BASE + '/12/points/202');
    del.flush({ title: 'Only the last point after the first can be removed.' }, { status: 400, statusText: 'Bad Request' });
    await settle(fixture);
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Only the last point');
  });
});
