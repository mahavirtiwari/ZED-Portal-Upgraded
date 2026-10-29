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
    levels: [{ code: 'Bronze', name: 'Bronze' }, { code: 'ZEDX', name: 'ZED-X' }],
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
    http.expectOne('/api/staff/masters/sectors').flush([{ id: 1, code: '24', name: 'Basic metals' }, { id: 2, code: '62', name: 'IT services' }]);
    await settle();
    http.expectOne(formUrl).flush(details());
    await settle();
  });

  afterEach(() => http.verify());

  it('lists the fields of the first form with their columns, type, required and status', () => {
    // One tile per form, with its counts; the first chosen.
    const tiles = [...el.querySelectorAll('.form-tile')].map((t) => [...t.querySelectorAll('.tile-name, .tile-app, .tile-counts span')].map((x) => x.textContent!.trim()));
    expect(tiles[0]).toEqual(['Basic Information', 'MSME app / Bronze surveillance app', '4 fields', '1 added', '1 disabled']);
    expect(tiles[1]).toEqual(['Basic Information', 'Site assessment app', '3 fields']);
    expect(el.querySelector('.form-tile.active')!.getAttribute('data-key')).toBe('msme.basicInfo');
    const r = rows();
    expect(r.length).toBe(6);
    expect(r[0]).toContain('Audited by a third party?');
    expect(r[0]).toContain('Standard: Whether 3rd Party Financial Audits are conducted?');
    expect(r[0]).toContain('Yes / No');
    expect(r[0]).toContain('All levels');
    expect(r[0]).toContain('All sectors');
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
    expect(dialog.querySelector('.type-grid')).toBeNull();
    expect(dialog.textContent).toContain('The type of a standard field cannot be changed');
    // Every level and every sector until "Only these" opens the list.
    expect(dialog.querySelector('zed-multi-select')).toBeNull();
    await type(dialog.querySelector('#fieldHelp') as HTMLTextAreaElement, 'Statutory audits do not count');
    (dialog.querySelector('#fieldRequired') as HTMLInputElement).click();
    // V4: asked for ZED-X only, of units of NIC sector 62.
    const pick = (id: string, label: string) =>
      ([...dialog.querySelectorAll(`#${id} ~ ul label, zed-multi-select label`)].find((l) => l.textContent!.trim() === label)!.querySelector('input') as HTMLInputElement).click();
    button('Only these levels', dialog).click();
    button('Only these sectors', dialog).click();
    await settle();
    pick('fieldLevels', 'ZED-X');
    pick('fieldSectors', '62 - IT services');
    await settle();
    button('SAVE', dialog).click();
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === `${formUrl}/fields`);
    expect(put.request.body).toEqual({
      key: 'auditsConducted', label: 'Audited by a third party?', help: 'Statutory audits do not count', type: null, required: false, enabled: true,
      section: null, options: null, levels: ['ZEDX'], nicSectors: ['62'],
    });
    put.flush({ message: 'Field saved.' });
    await reloaded('Field saved.');
  });

  it('adds a drop-down field with its choices', async () => {
    button('Add field').click();
    await settle();
    const dialog = el.querySelector('[role=dialog]')!;
    await type(dialog.querySelector('#fieldLabel') as HTMLInputElement, 'Sector of the unit');
    // The type as tiles, text first.
    expect(dialog.querySelector('.type-tile.active')!.textContent).toContain('Text');
    (dialog.querySelector('#type-dropdown') as HTMLInputElement).click();
    await settle();
    expect(dialog.querySelector('.type-tile.active')!.textContent).toContain('Drop-down (one choice)');
    await type(dialog.querySelector('[aria-label="Choice 1"]') as HTMLInputElement, 'Auto');
    button('Add choice', dialog).click();
    await settle();
    await type(dialog.querySelector('[aria-label="Choice 2"]') as HTMLInputElement, ' Textile ');
    // The preview draws the drop-down with its first choice, and who is asked.
    expect(dialog.querySelector('.dialog-preview .pf-select')!.textContent!.trim()).toBe('Auto');
    expect(dialog.querySelector('.dialog-preview')!.textContent).toContain('Asked for every level, of units of every sector.');
    button('Add choice', dialog).click();
    await settle();
    (dialog.querySelector('#fieldRequired') as HTMLInputElement).click();
    await settle();
    button('SAVE', dialog).click();
    await settle();
    const post = http.expectOne((r) => r.method === 'POST' && r.url === `${formUrl}/fields`);
    expect(post.request.body).toEqual({
      key: null, label: 'Sector of the unit', help: null, type: 'dropdown', required: true, enabled: true, section: 'basic', options: ['Auto', 'Textile'],
      levels: [], nicSectors: [],
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

  it('empties the levels when switched back to every level', async () => {
    button('Edit', row('cf_sector')).click();
    await settle();
    const dialog = el.querySelector('[role=dialog]')!;
    button('Only these levels', dialog).click();
    await settle();
    ([...dialog.querySelectorAll('zed-multi-select label')].find((l) => l.textContent!.trim() === 'ZED-X')!.querySelector('input') as HTMLInputElement).click();
    await settle();
    expect(dialog.querySelector('.dialog-preview')!.textContent).toContain('Asked for ZED-X');
    button('Every level', dialog).click();
    await settle();
    expect(dialog.querySelector('#fieldLevels')).toBeNull();
    button('SAVE', dialog).click();
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === `${formUrl}/fields`);
    expect(put.request.body.levels).toEqual([]);
    put.flush({ message: 'Field saved.' });
    await reloaded('Field saved.');
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
    (el.querySelector('.form-tile[data-key="assessor.basicInfo"]') as HTMLButtonElement).click();
    await settle();
    http.expectOne(`${url}/assessor.basicInfo`).flush({ ...details(), form: forms[1], numbered: true, fields: [field('auditsConducted', 'Audits?')] });
    await settle();
    expect(rows()).toEqual([expect.stringContaining('Audits?')]);
    expect(el.querySelector('.form-tile.active')!.getAttribute('data-key')).toBe('assessor.basicInfo');
  });
});
