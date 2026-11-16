import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormChecks, FormChecksPanel, formChecksUrl } from './form-checks';

const URL = '/api/staff/assessment/da/ZEDMSME000001/Bronze/form-checks';

function checks(overrides: Partial<FormChecks> = {}): FormChecks {
  return {
    applies: true,
    canCheck: true,
    round: 0,
    ncRound: false,
    items: [
      {
        form: 'msme.basicInfo', formName: 'Basic Information', key: 'cf_gst', label: 'GST number', type: 'text', value: '27AAACZ1234F1Z5',
        status: null, remarks: null, ncRound: null, previousValue: null, ncRemarks: null, answered: false,
      },
    ],
    ...overrides,
  };
}

describe('FormChecksPanel (App Forms: Validation required)', () => {
  let fixture: ComponentFixture<FormChecksPanel>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function open(data: FormChecks) {
    fixture.componentRef.setInput('kind', 'desktop');
    fixture.componentRef.setInput('zedId', 'ZEDMSME000001');
    fixture.componentRef.setInput('certification', 'Bronze');
    await settle();
    http.expectOne(URL).flush(data);
    await settle();
  }

  const button = (label: string) => [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === label) as HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FormChecksPanel], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(FormChecksPanel);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
  });

  afterEach(() => http.verify());

  it('builds the desktop and the remote address', () => {
    expect(formChecksUrl('desktop', 'Z1', 'Bronze')).toContain('/api/staff/assessment/da/Z1/Bronze/form-checks');
    expect(formChecksUrl('remote', 'Z1', 'Silver')).toContain('/api/staff/remote/Z1/Silver/form-checks');
    // 2026-11-16: the agency's site review of the site assessor's own form.
    expect(formChecksUrl('agency', 'Z1', 'Gold')).toContain('/api/staff/monitoring/review/Z1/Gold/form-checks');
  });

  it('lists each answer to check with Valid and Not valid', async () => {
    await open(checks());
    expect(el.textContent).toContain('Basic Information · to validate');
    expect(el.textContent).toContain('0 of 1 checked');
    expect(el.textContent).toContain('27AAACZ1234F1Z5');
    expect(button('✓ Valid')).toBeTruthy();
    expect(button('✕ Not valid')).toBeTruthy();
  });

  it('shows nothing when the page does not check this level', async () => {
    await open(checks({ applies: false, items: [] }));
    expect(el.querySelector('[data-testid=form-checks]')).toBeNull();
  });

  it('Valid is saved at once', async () => {
    await open(checks());
    button('✓ Valid').click();
    await settle();
    const save = http.expectOne((r) => r.method === 'POST' && r.url === URL);
    expect(save.request.body).toEqual({ form: 'msme.basicInfo', key: 'cf_gst', status: 'Yes', remarks: null });
    save.flush({ message: 'Saved.' });
    await settle();
    const items = checks().items.map((i) => ({ ...i, status: 'Yes' }));
    http.expectOne((r) => r.method === 'GET' && r.url === URL).flush(checks({ items }));
    await settle();
    expect(el.textContent).toContain('1 of 1 checked');
  });

  it('Not valid needs a remark before it is saved', async () => {
    await open(checks());
    button('✕ Not valid').click();
    await settle();
    button('Save').click();
    await settle();
    expect(el.textContent).toContain('Please enter a remark');
    http.expectNone((r) => r.method === 'POST');

    const input = el.querySelector<HTMLInputElement>('.fc-remark input')!;
    input.value = 'Does not match the certificate';
    input.dispatchEvent(new Event('input'));
    await settle();
    button('Save').click();
    await settle();
    const save = http.expectOne((r) => r.method === 'POST' && r.url === URL);
    expect(save.request.body).toEqual({ form: 'msme.basicInfo', key: 'cf_gst', status: 'No', remarks: 'Does not match the certificate' });
    save.flush({ message: 'Saved.' });
    await settle();
    http.expectOne((r) => r.method === 'GET' && r.url === URL).flush(checks());
    await settle();
  });

  it('in an NC round shows the earlier answer and remark; read-only for viewers', async () => {
    const item = { ...checks().items[0], ncRound: 1, previousValue: 'OLD', ncRemarks: 'Wrong number', answered: true, status: 'No', remarks: 'Still wrong' };
    await open(checks({ canCheck: false, ncRound: true, round: 1, items: [item] }));
    expect(el.textContent).toContain('Earlier answer: OLD');
    expect(el.textContent).toContain('Wrong number');
    expect(el.textContent).toContain('Not valid');
    expect(button('✓ Valid')).toBeUndefined();
  });
});
