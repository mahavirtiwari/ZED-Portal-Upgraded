import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppFieldItem, AppFormDetails, AppFormItem, AppFormsPage } from './app-forms';

describe('AppFormsPage', () => {
  let fixture: ComponentFixture<AppFormsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  const url = '/api/staff/settings/app-forms';
  const formUrl = `${url}/msme.basicInfo`;

  const field = (key: string, label: string, more: Partial<AppFieldItem> = {}): AppFieldItem => ({
    key, label, help: null, heading: null, type: 'text', required: true, enabled: true, active: true, custom: false, section: 'basic', order: 10,
    options: null, optionsSource: null, maxItems: null, shownWhen: null, standardLabel: label, standardHelp: null, standardRequired: true,
    customised: false, updatedBy: null, updatedOn: null, columns: null, ...more,
  });
  const forms: AppFormItem[] = [
    { key: 'msme.basicInfo', name: 'Basic Information', app: 'MSME app / Bronze surveillance app', fields: 4, customFields: 1, disabled: 1, updatedOn: null },
    { key: 'assessor.basicInfo', name: 'Basic Information', app: 'Site assessment app', fields: 3, customFields: 0, disabled: 0, updatedOn: null },
  ];
  const details = (): AppFormDetails => ({
    form: forms[0],
    version: 'abc',
    numbered: false,
    sections: [{ key: 'basic', label: 'Basic Information' }],
    customTypes: ['text', 'number', 'decimal', 'date', 'yesno', 'dropdown', 'multiselect', 'checkboxes'],
    fields: [
      field('auditsConducted', 'Audited by a third party?', { type: 'yesno', standardLabel: 'Whether 3rd Party Financial Audits are conducted?', customised: true }),
      field('productDetailsList', 'Products', {
        type: 'rows', order: 20,
        columns: [field('productDetailsList/productName', 'Name of Product manufactured'), field('productDetailsList/productPhoto', 'Product Photo', { type: 'photo', enabled: false })],
      }),
      field('cf_sector', 'Sector', { type: 'dropdown', custom: true, order: 25, options: ['Auto', 'Textile'], standardLabel: null, standardRequired: null, customised: true }),
      field('internationalCustomers', 'Key International Customers', { order: 30, active: false, shownWhen: 'Whether Exported? is Yes' }),
    ],
  });

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const rows = () => [...el.querySelectorAll('tbody tr')].map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
  const row = (key: string) => el.querySelector(`tr[data-key="${key}"]`) as HTMLElement;
  const button = (text: string, root: ParentNode = el) =>
    [...root.querySelectorAll('button, input[type=button]')].find((b) => (b.textContent || (b as HTMLInputElement).value).trim() === text) as HTMLButtonElement;
  const type = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };

  async function reloaded(message: string) {
    await settle();
    http.expectOne((r) => r.method === 'GET' && r.url === formUrl).flush(details());
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain(message);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AppFormsPage], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(AppFormsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne(url).flush(forms);
    await settle();
    http.expectOne(formUrl).flush(details());
    await settle();
  });

  afterEach(() => http.verify());

  it('lists the fields of the first form with their columns, type, required and status', () => {
    expect([...el.querySelectorAll('#appForm option')].map((o) => o.textContent!.trim())).toEqual([
      'Basic Information · MSME app / Bronze surveillance app',
      'Basic Information · Site assessment app',
    ]);
    const r = rows();
    expect(r.length).toBe(6);
    expect(r[0]).toContain('Audited by a third party?');
    expect(r[0]).toContain('Standard: Whether 3rd Party Financial Audits are conducted?');
    expect(r[0]).toContain('Yes / No');
    expect(r[2]).toContain('↳ Name of Product manufactured');
    expect(r[3]).toContain('↳ Product Photo');
    expect(r[3]).toContain('Disabled');
    expect(r[4]).toContain('Added');
    expect(r[4]).toContain('Choices: Auto, Textile');
    expect(r[5]).toContain('Asked when Whether Exported? is Yes');
    expect(r[5]).toContain('Not shown (depends on a disabled field)');
    expect(button('Reset', row('auditsConducted'))).toBeTruthy();
    expect(button('Reset', row('cf_sector'))).toBeUndefined();
    expect(button('↑', row('auditsConducted')).disabled).toBe(true);
  });

  it('edits a standard field without changing its type', async () => {
    button('Edit', row('auditsConducted')).click();
    await settle();
    const dialog = el.querySelector('[role=dialog]')!;
    expect(dialog.querySelector('#fieldType')).toBeNull();
    expect(dialog.textContent).toContain('the type of a standard field cannot be changed');
    await type(dialog.querySelector('#fieldHelp') as HTMLTextAreaElement, 'Statutory audits do not count');
    (dialog.querySelector('#fieldRequired') as HTMLInputElement).click();
    await settle();
    button('SAVE', dialog).click();
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === `${formUrl}/fields`);
    expect(put.request.body).toEqual({
      key: 'auditsConducted', label: 'Audited by a third party?', help: 'Statutory audits do not count', type: null, required: false, enabled: true,
      section: null, options: null,
    });
    put.flush({ message: 'Field saved.' });
    await reloaded('Field saved.');
  });

  it('adds a drop-down field with its choices', async () => {
    button('Add field').click();
    await settle();
    const dialog = el.querySelector('[role=dialog]')!;
    await type(dialog.querySelector('#fieldLabel') as HTMLInputElement, 'Sector of the unit');
    const select = dialog.querySelector('#fieldType') as HTMLSelectElement;
    select.value = 'dropdown';
    select.dispatchEvent(new Event('change'));
    await settle();
    await type(dialog.querySelector('[aria-label="Choice 1"]') as HTMLInputElement, 'Auto');
    button('Add choice', dialog).click();
    await settle();
    await type(dialog.querySelector('[aria-label="Choice 2"]') as HTMLInputElement, ' Textile ');
    button('Add choice', dialog).click();
    await settle();
    (dialog.querySelector('#fieldRequired') as HTMLInputElement).click();
    await settle();
    button('SAVE', dialog).click();
    await settle();
    const post = http.expectOne((r) => r.method === 'POST' && r.url === `${formUrl}/fields`);
    expect(post.request.body).toEqual({
      key: null, label: 'Sector of the unit', help: null, type: 'dropdown', required: true, enabled: true, section: 'basic', options: ['Auto', 'Textile'],
    });
    post.flush({ title: 'Please add at least one choice.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('[role=dialog] .alert-danger')).toBeTruthy();
    button('SAVE', el.querySelector('[role=dialog]')!).click();
    await settle();
    http.expectOne((r) => r.method === 'POST').flush({ message: 'Field added.', key: 'cf_sector_of_the_unit' });
    await reloaded('Field added.');
    expect(el.querySelector('[role=dialog]')).toBeNull();
  });

  it('moves a field down, disables a column and resets a field', async () => {
    button('↓', row('auditsConducted')).click();
    await settle();
    const order = http.expectOne((r) => r.method === 'PUT' && r.url === `${formUrl}/order`);
    expect(order.request.body).toEqual({ section: 'basic', keys: ['productDetailsList', 'auditsConducted', 'cf_sector', 'internationalCustomers'] });
    order.flush({ message: 'Order saved.' });
    await reloaded('Order saved.');

    button('Disable', row('productDetailsList/productName')).click();
    await settle();
    const enabled = http.expectOne((r) => r.method === 'PUT' && r.url === `${formUrl}/enabled`);
    expect(enabled.request.body).toEqual({ key: 'productDetailsList/productName', enabled: false });
    enabled.flush({ message: '"Name of Product manufactured" is no longer shown in the apps.' });
    await reloaded('is no longer shown in the apps.');

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    button('Reset', row('auditsConducted')).click();
    await settle();
    const reset = http.expectOne((r) => r.method === 'POST' && r.url === `${formUrl}/reset`);
    expect(reset.request.body).toEqual({ key: 'auditsConducted' });
    reset.flush({ message: 'The standard field is shown again.' });
    await reloaded('The standard field is shown again.');
  });

  it('switches to another form', async () => {
    const select = el.querySelector('#appForm') as HTMLSelectElement;
    select.value = 'assessor.basicInfo';
    select.dispatchEvent(new Event('change'));
    await settle();
    http.expectOne(`${url}/assessor.basicInfo`).flush({ ...details(), form: forms[1], numbered: true, fields: [field('auditsConducted', 'Audits?')] });
    await settle();
    expect(rows()).toEqual([expect.stringContaining('Audits?')]);
  });
});
