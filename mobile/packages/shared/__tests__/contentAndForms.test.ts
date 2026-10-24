import { AppTexts, fillPlaceholders } from '../src/content/appTexts';
import { KeyValueStore } from '../src/db/keyValueStore';
import {
  AppForms,
  customFieldsPayload,
  hiddenStandardKeys,
  isFieldShown,
  isFormChangedRefusal,
  validateForm,
  valueAtPath,
  type FormDefinition,
} from '../src/forms/appForms';
import { decimalFilter } from '../src/forms/validation';
import { htmlToPlain, parseSimpleHtml } from '../src/ui/components/HtmlText';
import { memoryDb } from './helpers/sqljs';

describe('Admin texts (docs/mobile/APP-TEXTS.md)', () => {
  const builtIn = { 'app.x.note': 'Built-in note', 'app.x.success': '<p>Start "{{Certification}} Certification"</p>' };

  it('uses the built-in wording until an answer arrives, then the server text; disabled texts are not shown', async () => {
    const store = new KeyValueStore(await memoryDb());
    await store.ensureSchema();
    const texts = new AppTexts(store, builtIn);
    await texts.load();
    expect(texts.get('app.x.note')).toEqual({ html: 'Built-in note', fromServer: false });
    expect(texts.get('app.x.success', { Certification: 'Bronze' })!.html).toBe('<p>Start "Bronze Certification"</p>');

    const ok = await texts.refresh(async () => ({
      status: '1',
      texts: [
        { key: 'app.x.note', enabled: true, html: '<p>Admin note</p>' },
        { key: 'app.x.success', enabled: false, html: '<p>x</p>' },
      ],
    }));
    expect(ok).toBe(true);
    expect(texts.get('app.x.note')).toEqual({ html: '<p>Admin note</p>', fromServer: true });
    expect(texts.get('app.x.success')).toBeNull();
    expect(texts.get('app.x.unknown')).toEqual({ html: '', fromServer: false });
  });

  it('keeps the last answer for offline use and ignores failed or refused calls', async () => {
    const db = await memoryDb();
    const store = new KeyValueStore(db);
    await store.ensureSchema();
    const first = new AppTexts(store, builtIn);
    await first.refresh(async () => ({ status: '1', texts: [{ key: 'app.x.note', enabled: true, html: 'Kept' }] }));

    const later = new AppTexts(store, builtIn); // a new start, offline
    await later.load();
    expect(later.get('app.x.note')!.html).toBe('Kept');
    expect(await later.refresh(async () => Promise.reject(new TypeError('Network request failed')))).toBe(false);
    expect(await later.refresh(async () => ({ status: '0', errorMessage: 'x' }))).toBe(false);
    expect(later.get('app.x.note')!.html).toBe('Kept');
  });

  it('fills placeholders HTML-encoded; unknown fields become empty', () => {
    expect(fillPlaceholders('Sent to {{Email}} {{Other}}.', { Email: 'a<b>&"c\'' })).toBe('Sent to a&lt;b&gt;&amp;&quot;c&#39; .');
  });

  it('renders the simple HTML of the Admin texts', () => {
    const blocks = parseSimpleHtml('<p>What is <b>Non-Conformance</b>?</p><ol><li>One &amp; two</li><li>Three<br>four</li></ol><ul><li><a href="https://x">link</a></li></ul>');
    expect(blocks.map(b => [b.marker ?? '', b.runs.map(r => r.text).join('')])).toEqual([
      ['', 'What is Non-Conformance?'],
      ['1.', 'One & two'],
      ['2.', 'Three\nfour'],
      ['•', 'link'],
    ]);
    expect(blocks[0]!.runs.find(r => r.bold)?.text).toBe('Non-Conformance');
    expect(blocks[3]!.runs[0]!.href).toBe('https://x');
    expect(htmlToPlain('To view Basic Information &amp; Documents uploaded')).toBe('To view Basic Information & Documents uploaded');
    expect(htmlToPlain('Line one\nline two')).toBe('Line one\nline two');
  });
});

const def: FormDefinition = {
  status: '1',
  form: 'msme.basicInfo',
  name: 'Basic Information',
  numbered: false,
  sections: [{ key: 'basic', label: 'Basic Information' }],
  fields: [
    { key: 'auditsConducted', label: 'Audits?', type: 'yesno', required: true, custom: false, section: 'basic', order: 30 },
    { key: 'cf_gst', label: 'GST number', type: 'text', required: true, custom: true, section: 'basic', order: 35, maxLength: 15 },
    { key: 'cf_staff', label: 'Employees', type: 'number', required: false, custom: true, section: 'basic', order: 36 },
    { key: 'cf_turnover', label: 'Turnover', type: 'decimal', required: false, custom: true, section: 'basic', order: 37 },
    { key: 'cf_since', label: 'Since', type: 'date', required: false, custom: true, section: 'basic', order: 38 },
    { key: 'cf_sector', label: 'Sector', type: 'dropdown', required: false, custom: true, section: 'basic', order: 39, options: ['Food', 'Textiles'] },
    {
      key: 'productDetailsList',
      label: 'Products',
      type: 'rows',
      required: true,
      custom: false,
      section: 'basic',
      order: 40,
      columns: [
        { key: 'productName', label: 'Name of Product manufactured', type: 'text', required: true, custom: false, section: 'basic', order: 10 },
        { key: 'exported', label: 'Whether Exported?', type: 'yesno', required: true, custom: false, section: 'basic', order: 20 },
      ],
    },
    {
      key: 'internationalCustomers',
      label: 'Key International Customers',
      type: 'text',
      required: true,
      custom: false,
      section: 'basic',
      order: 60,
      when: { field: 'productDetailsList/exported', equals: 'Yes' },
    },
    { key: 'cf_export_note', label: 'Export note', type: 'text', required: true, custom: true, section: 'basic', order: 61, when: { field: 'cf_sector', equals: 'food' } },
  ],
  version: 'v1',
};

describe('Admin forms (docs/mobile/APP-FORMS.md)', () => {
  const data = (over: Record<string, unknown> = {}) => ({ auditsConducted: 'Yes', productDetailsList: [{ productName: 'P', exported: 'No' }], cf_gst: '09ABC', ...over });
  const check = (d: Record<string, unknown>) => validateForm(def, f => d[f.key]);

  it('requires the shown required fields, rows with every required column, and fields asked by `when`', () => {
    expect(check(data()).size).toBe(0);
    expect([...check(data({ cf_gst: ' ', auditsConducted: null })).keys()]).toEqual(['auditsConducted', 'cf_gst']);
    expect(check(data({ productDetailsList: [] })).get('productDetailsList')).toBe('Required');
    expect(check(data({ productDetailsList: [{ productName: 'P' }] })).get('productDetailsList')).toBe('Please fill in Whether Exported? for every entry of Products.');
    // Any exported product asks for the international customers (rows/column).
    expect(check(data({ productDetailsList: [{ productName: 'P', exported: 'No' }, { productName: 'Q', exported: 'yes' }] })).get('internationalCustomers')).toBe('Required');
    expect(check(data({ cf_sector: 'Food' })).get('cf_export_note')).toBe('Required');
  });

  it('checks custom answers by type, length and choices', () => {
    expect(check(data({ cf_staff: '2.5' })).get('cf_staff')).toBe('Employees: please enter a whole number.');
    expect(check(data({ cf_turnover: '12.1234567' })).get('cf_turnover')).toBe('Turnover: please enter a number.');
    expect(check(data({ cf_since: '24/10/2026' })).get('cf_since')).toBe('Since: please enter a date.');
    expect(check(data({ cf_sector: 'Steel' })).get('cf_sector')).toBe('Sector: "Steel" is not one of the choices.');
    expect(check(data({ cf_gst: '0123456789012345' })).get('cf_gst')).toBe('GST number: at most 15 characters.');
    expect(check(data({ cf_staff: '25', cf_turnover: '1.5', cf_since: '2020-01-31', cf_sector: 'food', cf_export_note: 'x' })).size).toBe(0);
  });

  it('sends every shown custom field (unanswered as null, numbers as numbers) and drops hidden ones', () => {
    const answers = { cf_gst: ' 09ABC ', cf_staff: '25', cf_turnover: '', cf_export_note: 'not asked' };
    const payload = customFieldsPayload(def, answers, k => (answers as Record<string, unknown>)[k]);
    expect(payload).toEqual({ cf_gst: '09ABC', cf_staff: 25, cf_turnover: null, cf_since: null, cf_sector: null });
    expect(hiddenStandardKeys(def, ['assessorSelfie', 'auditsConducted', 'energySources'])).toEqual(['assessorSelfie', 'energySources']);
  });

  it('helpers: paths, conditions, refusals, decimal input', () => {
    expect(valueAtPath({ energyManagement: { electrical: { unit: 'kWh' } } }, 'energyManagement.electrical.unit')).toBe('kWh');
    expect(isFieldShown(def.fields[7]!, () => [{ exported: 'No' }])).toBe(false);
    expect(isFormChangedRefusal('Please fill in: GST number. (The form was changed on the server; please refresh it.)')).toBe(true);
    expect(decimalFilter('-12.3.4a')).toBe('-12.34');
  });

  it('keeps the last definition for offline use, the built-in form until then', async () => {
    const store = new KeyValueStore(await memoryDb());
    await store.ensureSchema();
    const builtIn = { ...def, version: 'built-in', fields: def.fields.slice(0, 1) };
    const forms = new AppForms(store, { 'msme.basicInfo': builtIn });
    await forms.load(['msme.basicInfo']);
    expect(forms.get('msme.basicInfo').version).toBe('built-in');
    expect(await forms.refresh('msme.basicInfo', async () => def)).toBe(true);
    expect(await forms.refresh('msme.basicInfo', async () => def)).toBe(false); // same version
    expect(await forms.refresh('msme.basicInfo', async () => ({ ...def, status: '0' }))).toBe(false);

    const offline = new AppForms(store, { 'msme.basicInfo': builtIn });
    await offline.load(['msme.basicInfo']);
    expect(offline.get('msme.basicInfo').version).toBe('v1');
    expect(offline.isFromServer('msme.basicInfo')).toBe(true);
  });
});
