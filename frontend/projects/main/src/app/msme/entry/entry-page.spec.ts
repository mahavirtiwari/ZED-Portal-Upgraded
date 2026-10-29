import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { initialValues, isShown, missing, toRequest } from './entry-form';
import { EntryPage } from './entry-page';
import { EntryState, FormField } from './entry.api';

const URL = '/api/msme/entry/ZEDX';

const field = (key: string, label: string, type: string, order: number, extra: Partial<FormField> = {}): FormField => ({
  key, label, type, order, required: true, custom: false, section: 'basic', ...extra,
});

function state(over: Partial<EntryState> = {}): EntryState {
  return {
    certification: 'ZEDX',
    paid: true,
    editable: true,
    submitted: false,
    certificationStatus: null,
    basicInfoSaved: false,
    form: {
      form: 'msme.basicInfo',
      name: 'Basic Information',
      version: 'v1',
      sections: [{ key: 'basic', label: 'Basic Information of Unit' }],
      fields: [
        field('siteExteriorPhotos', 'Site Exterior Photos (max. 2 photos)', 'photo', 20, { maxItems: 2 }),
        field('auditsConducted', 'Whether 3rd Party Financial Audits are conducted?', 'yesno', 30),
        field('productDetailsList', 'Products', 'rows', 40, {
          columns: [
            field('productName', 'Name of Product manufactured', 'text', 10),
            field('exported', 'Whether Exported?', 'yesno', 20),
            field('productPhoto', 'Product Photos', 'photo', 30, { maxItems: 1 }),
            field('productDescriptionPhoto', 'Product Label/Description Photos', 'photo', 40, { maxItems: 1 }),
          ],
        }),
        field('domesticCustomers', 'Key Domestic Customers', 'text', 50),
        field('internationalCustomers', 'Key International Customers', 'text', 60, { when: { field: 'productDetailsList/exported', equals: 'Yes' } }),
        field('rawMaterialImported', 'Whether Raw Material is imported?', 'yesno', 70),
        field('rawMaterialsList', 'Raw Materials', 'rows', 80, {
          when: { field: 'rawMaterialImported', equals: 'Yes' },
          columns: [
            field('rawMaterialName', 'Name of Raw Material', 'text', 10),
            field('rawMaterialPercentage', '% of raw material imported', 'number', 20),
            field('countryName', 'Name of Country', 'multiselect', 30, { optionsSource: 'countries', separator: ', ' }),
          ],
        }),
        field('energySources', 'Energy Source(s) used', 'checkboxes', 140, { options: ['Electricity', 'Solar'] }),
        field('cf_zedx', 'ZED-X readiness', 'dropdown', 150, { custom: true, required: false, options: ['Ready', 'Not yet'] }),
      ],
    },
    saved: { answers: {}, products: [], rawMaterials: [], siteExteriorPhotos: [], custom: {} },
    sections: [{
      code: '1', name: 'Leadership', requirements: [{
        code: '1.1', name: 'Policy', evidences: [
          { id: 501, code: 'a', name: 'Quality policy', help: null, required: true, uploaded: false, url: null },
          { id: 502, code: 'b', name: 'Record', help: null, required: false, uploaded: false, url: null },
        ],
      }],
    }],
    ...over,
  };
}

describe('ZED-X data entry: form logic', () => {
  it('shows a column condition when any row has the answer, and checks required answers', () => {
    const s = state();
    const form = initialValues(s);
    const international = s.form.fields.find((f) => f.key === 'internationalCustomers')!;
    expect(isShown(international, form)).toBe(false);
    form.rows['productDetailsList'][0]['exported'] = 'Yes';
    expect(isShown(international, form)).toBe(true);
    expect(missing(s.form, form)).toBe('Please fill in: Site Exterior Photos (max. 2 photos).');
  });

  it('sends saved photos by id, new ones as uploads, and the raw materials only when imported', async () => {
    const s = state({
      saved: {
        answers: { auditsConducted: 'Yes', rawMaterialImported: 'No', energySources: ['Solar'] },
        products: [{ productName: 'Valve', exported: 'No', productPhoto: { id: 'ZEDMSME00000117', url: '/p.jpg', isPdf: false }, productDescriptionPhoto: null }],
        rawMaterials: [{ rawMaterialName: 'Steel', rawMaterialPercentage: '10', countryName: 'Japan, Germany' }],
        siteExteriorPhotos: [{ id: 'ZEDMSME00000118', url: '/s.jpg', isPdf: false }],
        custom: { cf_zedx: 'Ready' },
      },
    });
    const form = initialValues(s);
    expect(form.rows['rawMaterialsList'][0]['countryName']).toEqual(['Japan', 'Germany']);
    const file = new File(['%PDF-1.4'], 'label.pdf', { type: 'application/pdf' });
    form.rows['productDetailsList'][0]['productDescriptionPhoto'] = [{ file }];

    const body = toRequest(s.form, form, { latitude: '26.4', longitude: '80.3' });
    const data = JSON.parse(body.get('data') as string);
    expect(data.siteExteriorPhotos).toEqual([{ id: 'ZEDMSME00000118' }]);
    expect(data.products[0].productPhoto).toEqual({ id: 'ZEDMSME00000117' });
    expect(data.products[0].productDescriptionPhoto).toEqual({ upload: 'f0' });
    expect((body.get('f0') as File).name).toBe('label.pdf');
    expect(data.rawMaterials).toEqual([]);
    expect(data.answers.energySources).toEqual(['Solar']);
    expect(data.customFields).toEqual({ cf_zedx: 'Ready' });
    expect(data.formVersion).toBe('v1');
    expect(data.latitude).toBe('26.4');

    form.values['rawMaterialImported'] = 'Yes';
    const again = JSON.parse(toRequest(s.form, form, null).get('data') as string);
    expect(again.rawMaterials).toEqual([{ rawMaterialName: 'Steel', rawMaterialPercentage: '10', countryName: 'Japan, Germany' }]);
  });
});

describe('EntryPage', () => {
  let fixture: ComponentFixture<EntryPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function open(s: EntryState | null, route = 'ZEDX') {
    fixture.componentRef.setInput('certification', route);
    await settle();
    if (s) http.expectOne(URL).flush(s);
    await settle();
  }

  const text = () => el.textContent!.replace(/\s+/g, ' ');
  const tab = (label: string) => Array.from(el.querySelectorAll<HTMLButtonElement>('.entry-tabs button')).find((b) => b.textContent!.includes(label))!;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EntryPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(EntryPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
  });

  afterEach(() => http.verify());

  it('is only for the levels entered on the web', async () => {
    await open(null, 'Bronze');
    expect(text()).toContain('entered in the ZED mobile app');
  });

  it("renders the Admin's form: rows, conditions and the Admin's own fields", async () => {
    await open(state());
    expect(text()).toContain('Site Exterior Photos (max. 2 photos)');
    expect(text()).toContain('Name of Product manufactured');
    expect(text()).toContain('ZED-X readiness');
    expect(text()).not.toContain('Key International Customers');
    expect(text()).not.toContain('Name of Raw Material');

    const yes = Array.from(el.querySelectorAll<HTMLInputElement>('[data-field="rawMaterialImported"] input[type=radio]'))[0];
    yes.click();
    await settle();
    expect(text()).toContain('Name of Raw Material');
  });

  it('refuses to save with a required answer missing, without calling the server', async () => {
    await open(state());
    el.querySelector<HTMLButtonElement>('#saveBasicInfo')!.click();
    await settle();
    expect(text()).toContain('Please fill in: Site Exterior Photos');
    http.expectNone(`${URL}/basic-info`);
  });

  it('uploads a document and refreshes its state', async () => {
    await open(state({ basicInfoSaved: true }));
    tab('Documents').click();
    await settle();
    expect(text()).toContain('(0/1 required)');

    const input = el.querySelector<HTMLInputElement>('[data-evidence="501"] input[type=file]')!;
    const file = new File(['%PDF-1.4'], 'policy.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await settle();
    el.querySelector<HTMLButtonElement>('[data-evidence="501"] button')!.click();
    await settle();

    const req = http.expectOne(`${URL}/evidences/501`);
    expect((req.request.body as FormData).getAll('files').length).toBe(1);
    req.flush({ message: 'Document uploaded.' });
    await settle();
    const after = state({ basicInfoSaved: true });
    after.sections[0].requirements[0].evidences[0] = { ...after.sections[0].requirements[0].evidences[0], uploaded: true, url: '/api/msme/entry/ZEDX/files/Evidences/501.pdf' };
    http.expectOne(URL).flush(after);
    await settle();
    expect(text()).toContain('(1/1 required)');
    expect(el.querySelector('[data-evidence="501"] a')!.getAttribute('href')).toBe('/api/msme/entry/ZEDX/files/Evidences/501.pdf');
  });

  it('allows the final submit only when everything is there and confirmed', async () => {
    const ready = state({ basicInfoSaved: true });
    ready.sections[0].requirements[0].evidences[0] = { ...ready.sections[0].requirements[0].evidences[0], uploaded: true };
    await open(ready);
    tab('Submit').click();
    await settle();
    const submit = el.querySelector<HTMLButtonElement>('#finalSubmit')!;
    expect(submit.disabled).toBe(true);
    el.querySelector<HTMLInputElement>('#confirmSubmit')!.click();
    await settle();
    expect(submit.disabled).toBe(false);
    submit.click();
    await settle();
    http.expectOne(`${URL}/final-submit`).flush({ message: 'Submitted.' });
    await settle();
    http.expectOne(URL).flush(state({ basicInfoSaved: true, editable: false, submitted: true, certificationStatus: 2 }));
    await settle();
    expect(el.querySelector('#entrySubmitted')).not.toBeNull();
    expect(el.querySelector('#finalSubmit')).toBeNull();
  });

  it('opens on the NC tab, saves an answer and submits the NC', async () => {
    const withNc = (answered: boolean) => state({
      basicInfoSaved: true, editable: false, submitted: true, certificationStatus: 14,
      nc: {
        number: 1,
        siteExterior: null,
        products: [],
        sections: [{ code: '1', name: 'Leadership', requirements: [{ id: 11, code: '1.1', name: 'Policy', assessorRemarks: 'Policy not signed', answered, url: null }] }],
      },
    });
    await open(withNc(false));
    expect(el.querySelector('#ncIntro')).not.toBeNull();
    expect(text()).toContain('Policy not signed');
    expect(text()).toContain('(0/1 answered)');

    const row = el.querySelector<HTMLElement>('[data-nc="requirement-11"]')!;
    const input = row.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [new File(['%PDF-1.4'], 'policy.pdf', { type: 'application/pdf' })] });
    input.dispatchEvent(new Event('change'));
    const remarks = row.querySelector<HTMLInputElement>('input:not([type=file])')!;
    remarks.value = 'Signed copy';
    remarks.dispatchEvent(new Event('input'));
    await settle();
    row.querySelector<HTMLButtonElement>('button')!.click();
    await settle();
    const req = http.expectOne(`${URL}/nc/requirements/11`);
    expect((req.request.body as FormData).get('remarks')).toBe('Signed copy');
    req.flush({ message: 'Answer saved.' });
    await settle();
    http.expectOne(URL).flush(withNc(true));
    await settle();
    expect(text()).toContain('(1/1 answered)');

    tab('Submit').click();
    await settle();
    el.querySelector<HTMLInputElement>('#confirmSubmit')!.click();
    await settle();
    const submit = el.querySelector<HTMLButtonElement>('#finalSubmit')!;
    expect(submit.textContent).toContain('SUBMIT NC ANSWERS');
    submit.click();
    await settle();
    http.expectOne(`${URL}/final-submit`).flush({ message: 'Your answers to NC 1 are submitted.' });
    await settle();
    http.expectOne(URL).flush(state({ basicInfoSaved: true, editable: false, submitted: true, certificationStatus: 14, nc: null }));
    await settle();
    expect(el.querySelector('#finalSubmit')).toBeNull();
  });
});
