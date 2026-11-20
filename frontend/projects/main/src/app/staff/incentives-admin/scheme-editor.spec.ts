import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { SchemeEditorPage } from './scheme-editor';
import { SchemeDefinition } from './schemes-admin.api';
import { formatBound, parseBound } from './field-dialog';

describe('SchemeEditorPage', () => {
  let fixture: ComponentFixture<SchemeEditorPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  const url = '/api/staff/settings/schemes';
  const definition = (): SchemeDefinition => ({
    code: 'FA_STATE', name: 'State FA', active: false, orderNo: 2,
    card: { title: 'State FA', highlight: '75%', details: null, icon: 'rupee' },
    activation: { mode: 'Levels', levels: ['Bronze', 'Silver'] },
    grading: { mode: 'Level', rows: [{ key: 'Bronze', sharePercent: 75, maxAmount: 50000 }] },
    form: {
      blocks: { disclaimer: true, instructions: true, unitConfirm: true, bankAccount: true, declaration: true },
      sections: [{
        key: 'certificate', title: 'Certification details', help: null, repeating: false, minItems: 1, maxItems: 1, pick: null,
        fields: [
          { key: 'certificate_no', label: 'Certificate Number', type: 'text', required: true, assessorChecks: true, maxLength: 50, options: [], isClaim: false },
          { key: 'amount_paid', label: 'Amount Paid', type: 'amount', required: true, assessorChecks: true, min: 1, max: 100000000, options: [], isClaim: true },
          { key: 'invoice_copy', label: 'Copy of Invoice', type: 'document', required: true, assessorChecks: true, options: [], isClaim: false, maxFiles: 1 },
        ],
      }],
      rules: [],
    },
    verification: { flow: 'Desktop', correctionRounds: 2, correctionDays: 30, autoAllot: true },
  });
  const meta = {
    schemes: [], templates: ['FA', 'TU'], sizes: ['Micro', 'Small', 'Medium'],
    levels: [{ code: 'Bronze', name: 'Bronze' }, { code: 'Silver', name: 'Silver' }, { code: 'Gold', name: 'Gold' }, { code: 'ZEDX', name: 'ZED-X' }],
  };

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const button = (scope: Element, label: string) => [...scope.querySelectorAll('button')].find((b) => b.textContent!.trim() === label) as HTMLButtonElement;
  const tab = async (name: string) => { (el.querySelector(`[data-tab="${name}"]`) as HTMLButtonElement).click(); await settle(); };
  const type = (sel: string, value: string) => {
    const input = el.querySelector(sel) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SchemeEditorPage],
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ code: 'FA_STATE' }) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SchemeEditorPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne(url).flush(meta);
    http.expectOne(`${url}/FA_STATE`).flush(definition());
    await settle();
  });

  afterEach(() => http.verify());

  it('loads the scheme with its card and activation', () => {
    expect(el.querySelector('h3')!.textContent).toContain('State FA');
    expect((el.querySelector('#se-title') as HTMLInputElement).value).toBe('State FA');
    expect(el.querySelector('[data-level="Bronze"]')!.classList).toContain('on');
    expect(el.querySelector('[data-level="Gold"]')!.classList).not.toContain('on');
    expect(el.querySelector('[data-level="ZEDX"]')!.textContent).toContain('ZED-X');
  });

  it('switches the activation to Registration and fits the grading', async () => {
    (el.querySelector('[data-mode="Registration"]') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('[data-level="Bronze"]')!.classList).not.toContain('on');
    await tab('grading');
    const keys = [...el.querySelectorAll('.se-grades select option')].map((o) => o.textContent!.trim());
    expect(keys).toEqual(['Registration', 'All']);
    (el.querySelector('[data-grading="Size"]') as HTMLButtonElement).click();
    await settle();
    (el.querySelector('#se-add-grade') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelectorAll('.se-grades tbody tr').length).toBe(2);
  });

  it('edits a field, adds an "Add more" section with a field and saves', async () => {
    await tab('form');
    // Edit the certificate number's label.
    button(el.querySelector('tr[data-key="certificate_no"]')!, 'Edit').click();
    await settle();
    expect((el.querySelector('#fd-key') as HTMLInputElement).disabled).toBe(true);
    type('#fd-label', 'Certificate No.');
    await settle();
    (el.querySelector('#fd-ok') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('tr[data-key="certificate_no"]')!.textContent).toContain('Certificate No.');

    // A new "Add more" section: its key follows the title while new.
    (el.querySelector('#se-add-repeating') as HTMLButtonElement).click();
    await settle();
    type('#se-sec-title', 'Machines bought');
    await settle();
    expect((el.querySelector('#se-sec-key') as HTMLInputElement).value).toBe('machines_bought');
    const pick = el.querySelector('#se-sec-pick') as HTMLSelectElement;
    pick.value = 'Technologies';
    pick.dispatchEvent(new Event('change'));
    await settle();
    (el.querySelector('#se-add-field') as HTMLButtonElement).click();
    await settle();
    type('#fd-label', 'Invoice date');
    const ty = el.querySelector('#fd-type') as HTMLSelectElement;
    ty.value = 'date';
    ty.dispatchEvent(new Event('change'));
    await settle();
    expect((el.querySelector('#fd-key') as HTMLInputElement).value).toBe('invoice_date');
    const min = el.querySelector('#fd-date-min') as HTMLSelectElement;
    min.value = 'certified';
    min.dispatchEvent(new Event('change'));
    await settle();
    (el.querySelector('#fd-ok') as HTMLButtonElement).click();
    await settle();

    (el.querySelector('#se-save') as HTMLButtonElement).click();
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === `${url}/FA_STATE`);
    const body = put.request.body as SchemeDefinition;
    expect(body.form.sections[0].fields[0].label).toBe('Certificate No.');
    const added = body.form.sections[1];
    expect(added).toEqual(expect.objectContaining({ key: 'machines_bought', title: 'Machines bought', repeating: true, minItems: 1, maxItems: 10 }));
    expect(added.pick).toEqual(expect.objectContaining({ kind: 'Technologies', sectorFilter: true, noRepeat: true }));
    expect(added.fields).toEqual([expect.objectContaining({ key: 'invoice_date', type: 'date', dateMin: 'certified', dateMax: null, maxLength: null })]);
    put.flush({ title: '"Machines bought": add at least one field.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('add at least one field');
  });

  it('sets the verification and shows the server message on save', async () => {
    await tab('verification');
    type('#se-rounds', '4');
    expect(el.querySelector('#se-photos-max')).toBeNull();
    (el.querySelector('input[value="DesktopOnsite"]') as HTMLInputElement).click();
    await settle();
    // Phase 2: the onsite photos per item (min / max) of the Desktop + Onsite flow.
    type('#se-photos-max', '4');
    await settle();
    (el.querySelector('#se-save') as HTMLButtonElement).click();
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT');
    expect(put.request.body.verification).toEqual({ flow: 'DesktopOnsite', correctionRounds: 4, correctionDays: 30, autoAllot: true, onsitePhotosMin: 1, onsitePhotosMax: 4 });
    put.flush({ message: 'Scheme saved.' });
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('Scheme saved.');
  });

  it('reads and writes the date limits', () => {
    expect(formatBound(parseBound('days:30'))).toBe('days:30');
    expect(formatBound(parseBound('date:2026-01-01'))).toBe('date:2026-01-01');
    expect(formatBound(parseBound(null))).toBeNull();
  });
});
