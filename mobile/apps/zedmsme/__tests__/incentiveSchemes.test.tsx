import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { setZedDeviceForTesting, StackNavigator, UiHost, zedDevice } from '@zed/shared';
import { MsmeAppProvider } from '../src/app/context';
import { AppDrawerHost } from '../src/app/AppDrawer';
import type { MsmeApp } from '../src/app/MsmeApp';
import type { PublicIncentiveCards } from '../src/api';
import { claimOf, dateBound, eligibleOf, type SchemesDashboard, type SchemeTile } from '../src/incentiveSchemes';
import { SCREENS } from '../App';
import { FakeServer, makeApp, type SentRequest } from './helpers/harness';
import { memoryDb } from './helpers/sqljs';
import { writeLegacyLoginRow, writeLegacyPhotoRows, ZED_ID } from './helpers/legacyFixture';

jest.useFakeTimers();
jest.setTimeout(60000);

/**
 * 2026-11-25 (the product owner: the Admin's incentive schemes in the app with the full forms): My Incentives lists what the web
 * dashboard lists, in its order and with the schemes' states; a scheme opens its own screens on Msme/AppIncentiveSchemes.
 */

const PORTAL = 'http://10.0.2.2:5106/';
const CARDS_URL = PORTAL + 'api/public/incentive-cards';
const SCHEMES_URL = PORTAL + 'Msme/AppIncentiveSchemes';

const CARDS: PublicIncentiveCards = {
  builtIn: [
    { card: 'JOINING_REWARD', title: 'Joining Reward', highlight: null, details: null, active: true },
    { card: 'FINANCIAL_ASSISTANCE', title: 'Financial Assistance (75%)', highlight: 'Up to Rs. 50,000', details: null, active: true },
    { card: 'HANDHOLDING', title: 'Handholding Support', highlight: null, details: null, active: true },
    { card: 'TECHNOLOGY_UPGRADATION', title: 'Technology Upgradation', highlight: null, details: null, active: true },
  ],
  incentives: [{ id: 7, title: 'State Subsidy', highlight: null, details: null, department: null, contactPerson: null, email: null, mobileNo: null, webLink: null, videoLink: null }],
};

const tile = (code: string, state: SchemeTile['state'], extra: Partial<SchemeTile> = {}): SchemeTile => ({
  code,
  title: code,
  highlight: null,
  details: null,
  icon: 'star',
  state,
  note: null,
  message: null,
  applicationId: null,
  status: null,
  level: null,
  grade: null,
  activationMode: 'Levels',
  activationLevels: ['Bronze', 'Silver', 'Gold'],
  ...extra,
});

const DASHBOARD: SchemesDashboard = {
  schemes: [
    tile('GREEN', 'progress', { title: 'Green Manufacturing', highlight: 'Up to Rs. 1,00,000', details: '<p>For <b>green</b> processes</p>', applicationId: 9 }),
    tile('SOLAR', 'locked', { title: 'Solar Rooftop', note: 'levelNotCovered', activationLevels: ['Gold'] }),
  ],
  tu: { direct: true, scheme: tile('TU_DIRECT', 'locked', { note: 'notCertified', activationLevels: ['Bronze'] }), legacy: false },
  fa: { scheme: tile('FA', 'open'), legacy: false },
};

// ----- the fake portal of one scheme -----

const SCHEME = {
  code: 'GREEN',
  name: 'Green Scheme',
  card: { title: 'Green Manufacturing', highlight: 'Up to Rs. 1,00,000', details: null, icon: 'star' },
  blocks: { disclaimer: true, instructions: false, unitConfirm: true, bankAccount: true, declaration: true },
  sections: [
    {
      key: 'details',
      title: 'Expense details',
      repeating: false,
      minItems: 0,
      maxItems: 1,
      pick: null,
      fields: [
        { key: 'activity', label: 'Name of the activity', type: 'text', required: true },
        { key: 'amount_paid', label: 'Amount paid', type: 'amount', required: true, isClaim: true },
        { key: 'mode', label: 'Mode of payment', type: 'choice', required: true, options: ['Online', 'Cheque'] },
        { key: 'invoice_copy', label: 'Copy of invoice', type: 'document', required: true, maxFiles: 2 },
      ],
    },
    {
      key: 'machines',
      title: 'Machines',
      repeating: true,
      minItems: 1,
      maxItems: 3,
      pick: { kind: 'Options', label: 'Machine', options: ['Boiler', 'Dryer'], noRepeat: true },
      fields: [{ key: 'qty', label: 'Quantity', type: 'number', required: true, wholeNumber: true }],
    },
  ],
  activationMode: 'Levels',
  activationLevels: ['Bronze'],
  correctionRounds: 2,
  correctionDays: 15,
  disclaimer: 'Read this scheme disclaimer.',
  instructions: null,
  declaration: 'I declare that the claim is true.',
};

type App = Record<string, unknown> & { status: string; answers: { sections: Record<string, Array<Record<string, unknown>>> }; checks: Array<{ path: string; remarks: string | null }> };

function portal(start: App | null = null) {
  let app: App | null = start;
  let files = 0;
  const page = () => ({
    scheme: SCHEME,
    unit: { EnterpriseName: 'Acme Castings', ZedId: ZED_ID, UdyogAadharNo: 'UDYAM-UP-01-0000001', EnterpriseType: 'Micro', PUnitName: 'Unit 1' },
    window: { level: 'Bronze', certRef: 'B-1', openedOn: '2026-11-01', grade: { sharePercent: 75, maxAmount: 50000 } },
    state: !app || app.status === 'Draft' ? 'open' : 'progress',
    note: null,
    canApply: !app || app.status === 'Draft',
    message: null,
    application: app,
    picks: { machines: [{ code: 'Boiler', name: 'Boiler', description: null }, { code: 'Dryer', name: 'Dryer', description: null }] },
    history: [{ id: 3, date: '2026-06-01', status: 'Rejected', level: 'Bronze', amount: 20000, reason: 'Invoice unreadable' }],
  });
  const answer = () => ({ status: '1', page: page() });
  const server = new FakeServer((req: SentRequest) => {
    const url = req.url;
    const json = (req.json ?? {}) as Record<string, unknown>;
    if (url === CARDS_URL) return CARDS;
    if (url === SCHEMES_URL) return { status: '1', dashboard: DASHBOARD };
    if (!url.startsWith(SCHEMES_URL + '/GREEN')) return { status: '1' };
    const rest = url.slice((SCHEMES_URL + '/GREEN').length);
    if (rest === '') return answer();
    if (rest === '/Draft') {
      app ??= { id: 501, status: 'Draft', level: 'Bronze', answers: { sections: {} }, checks: [], claimAmount: 0, eligibleAmount: 0, account: null, correctionOpen: false };
      return answer();
    }
    if (rest === '/Section') {
      app!.answers.sections[json.section as string] = [{ values: json.values, saved: true }];
      return answer();
    }
    if (rest === '/Item') {
      const list = app!.answers.sections[json.section as string] ?? [];
      const old = list[json.index as number];
      list[json.index as number] = { pick: json.pick ?? old?.pick, pickName: json.pick ?? old?.pickName, values: json.values, saved: true };
      app!.answers.sections[json.section as string] = list;
      return answer();
    }
    if (rest === '/Document') {
      files++;
      const fileName = `2026112510000000${files}abcdef.pdf`;
      return { status: '1', upload: { fileName, isPdf: true, url: `/Msme/AppIncentiveSchemes/GREEN/File?name=${fileName}` } };
    }
    if (rest === '/Submit') {
      if (json.declaration !== true) return { status: '0', errorMessage: 'Please accept the declaration.' };
      app!.status = 'Submitted';
      app!.claimAmount = 40000;
      app!.eligibleAmount = 30000;
      return answer();
    }
    if (rest === '/Correction') {
      app!.status = 'Verifying';
      app!.checks = [];
      return answer();
    }
    return { status: '0', errorMessage: 'unexpected ' + rest };
  });
  return { server, current: () => app };
}

// ----- rendering -----

async function signedInApp(server: FakeServer) {
  const loginDb = await memoryDb();
  const mediaDb = await memoryDb();
  await writeLegacyLoginRow(loginDb, 'PW');
  await writeLegacyPhotoRows(mediaDb);
  const { app } = await makeApp(server, { loginDb, mediaDb });
  await app.offlineLogin(ZED_ID, 'PW');
  // A PDF picked from the phone for every upload.
  setZedDeviceForTesting({ ...(zedDevice() as object), pickPdf: async () => ({ uri: 'content://docs/invoice.pdf', size: 1000 }) } as never);
  return app;
}

function render(app: MsmeApp, name: string, params?: Record<string, unknown>) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <UiHost>
        <MsmeAppProvider app={app}>
          <AppDrawerHost>
            <StackNavigator screens={SCREENS} initial={{ name, params }} />
          </AppDrawerHost>
        </MsmeAppProvider>
      </UiHost>,
    );
  });
  return r;
}

type R = ReactTestRenderer.ReactTestRenderer;
const handler = (r: R, id: string) => {
  const n = r.root.findAll(x => x.props.testID === id && typeof x.props.onPress === 'function')[0];
  if (!n) throw new Error('no pressable ' + id);
  return n;
};
const press = (r: R, id: string) => act(async () => handler(r, id).props.onPress());
const has = (r: R, id: string) => r.root.findAll(n => n.props.testID === id && typeof n.type === 'string').length > 0;
const type = (r: R, id: string, text: string) =>
  act(async () => {
    const n = r.root.findAll(x => x.props.testID === id && typeof x.props.onChangeText === 'function')[0];
    if (!n) throw new Error('no input ' + id);
    n.props.onChangeText(text);
  });
/** The innermost pressable around a text (the dialogs' buttons). */
const pressText = (r: R, label: string) =>
  act(async () =>
    r.root
      .findAll(n => typeof n.props.onPress === 'function' && n.findAll(c => (c.type as unknown) === 'Text' && [c.props.children].flat().join('') === label).length > 0)
      .at(-1)!
      .props.onPress(),
  );
const texts = (r: R) => r.root.findAll(n => (n.type as unknown) === 'Text').map(n => [n.props.children].flat().join(''));
const settle = () =>
  act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
const cardIds = (r: R) =>
  r.root
    .findAll(n => typeof n.type === 'string' && typeof n.props.testID === 'string' && /^incentive-(joining-reward|financial-assistance|graded-\d|admin-\d+|scheme-[A-Z_]+)$/.test(n.props.testID))
    .map(n => n.props.testID as string);
const enabled = (r: R, id: string) => r.root.findAll(n => n.props.testID === id && 'disabled' in n.props)[0]!.props.disabled !== true;
const textOf = (r: R, id: string) => {
  const n = r.root.findAll(x => x.props.testID === id && (x.type as unknown) === 'Text')[0];
  return n ? [n.props.children].flat().join('') : null;
};

/** A document: "+ Upload", the source sheet's "Pick PDF from Gallery", then the upload. */
async function uploadPdf(r: R, field: string) {
  act(() => {
    void handler(r, `${field}-upload`).props.onPress();
  });
  await settle();
  await press(r, 'pick-item-2');
  await settle();
  await settle();
}

let alerts: Array<[string, string]> = [];
let alertSpy: jest.SpyInstance;
beforeEach(() => {
  alerts = [];
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((title, message) => {
    alerts.push([String(title ?? ''), String(message ?? '')]);
  });
});
afterEach(() => alertSpy.mockRestore());

describe('incentive scheme rules (as the web page)', () => {
  it('claim, eligible amount and date bounds', () => {
    const answers = { sections: { machines: [{ values: { amount: '1000.5' }, saved: true }, { values: { amount: '99' }, saved: false }] } };
    const sections = [{ key: 'machines', title: 'M', repeating: true, minItems: 0, maxItems: 3, fields: [{ key: 'amount', label: 'A', type: 'amount' as const, required: true, isClaim: true }] }];
    expect(claimOf(sections, answers)).toBe(1000.5);
    expect(eligibleOf(500000.75, { sharePercent: 80, maxAmount: 300000 })).toBe(300000);
    expect(eligibleOf(40000.9, { sharePercent: 75, maxAmount: 50000 })).toBe(30000);
    const today = new Date(2026, 10, 25);
    expect(dateBound('today', null, true, today)).toBe('2026-11-25');
    expect(dateBound('days:10', null, false, today)).toBe('2026-11-15');
    expect(dateBound('certified', '2026-11-01', false, today)).toBe('2026-11-01');
    expect(dateBound('date:1990-01-01', null, false, today)).toBe('1990-01-01');
  });
});

describe('My Incentives as on the web (2026-11-25)', () => {
  it('lists the cards in the web order with the schemes and their states', async () => {
    const { server } = portal();
    const app = await signedInApp(server);
    const status = app.user!.MsmeDetails!.msmeStatus!;
    status.bronze!.status = 3;
    const r = render(app, 'Incentives');
    await settle();
    // The schemes are asked with the sign-in token when the screen opens.
    expect(server.requests.some(q => q.url === SCHEMES_URL)).toBe(true);
    expect(cardIds(r)).toEqual([
      'incentive-joining-reward',
      'incentive-financial-assistance',
      'incentive-graded-0',
      'incentive-graded-1',
      'incentive-scheme-GREEN',
      'incentive-scheme-SOLAR',
      'incentive-admin-7',
      'incentive-graded-2',
      'incentive-graded-3',
      'incentive-graded-4',
      'incentive-graded-5',
    ]);
    // The Admin's wording of the built-in card; the FA scheme's state.
    expect(texts(r)).toEqual(expect.arrayContaining(['Financial Assistance (75%)', 'Up to Rs. 50,000', 'Green Manufacturing', 'Up to Rs. 1,00,000', 'For green processes']));
    expect(textOf(r, 'incentive-financial-assistance-state')).toBe('Open');
    expect(enabled(r, 'incentive-financial-assistance')).toBe(true);
    // The direct TU scheme is locked until the Bronze certification; SOLAR is for Gold units only.
    expect(textOf(r, 'incentive-graded-1-state')).toBe('Locked');
    expect(textOf(r, 'incentive-graded-1-note')).toBe('Opens after Bronze certification');
    expect(enabled(r, 'incentive-graded-1')).toBe(false);
    expect(textOf(r, 'incentive-scheme-SOLAR-note')).toBe('For units certified at Gold');
    expect(enabled(r, 'incentive-scheme-SOLAR')).toBe(false);
    expect(textOf(r, 'incentive-scheme-GREEN-state')).toBe('In progress');
    expect(enabled(r, 'incentive-scheme-GREEN')).toBe(true);

    // A scheme opens its own screen (its page from the portal).
    await press(r, 'incentive-scheme-GREEN');
    await settle();
    expect(server.requests.some(q => q.url === SCHEMES_URL + '/GREEN')).toBe(true);
    expect(has(r, 'incentive-scheme')).toBe(true);
  });

  it('an earlier application in progress and a card the Admin turned off', async () => {
    const server = new FakeServer(req =>
      req.url === CARDS_URL
        ? { ...CARDS, builtIn: CARDS.builtIn.map(c => (c.card === 'HANDHOLDING' ? { ...c, active: false } : c)) }
        : req.url === SCHEMES_URL
          ? { status: '1', dashboard: { ...DASHBOARD, schemes: [], fa: { scheme: null, legacy: true }, tu: { direct: true, scheme: null, legacy: true } } }
          : { status: '1' },
    );
    const app = await signedInApp(server);
    const r = render(app, 'Incentives');
    await settle();
    expect(cardIds(r)).toEqual([
      'incentive-joining-reward',
      'incentive-financial-assistance',
      'incentive-graded-1',
      'incentive-admin-7',
      'incentive-graded-2',
      'incentive-graded-3',
      'incentive-graded-4',
      'incentive-graded-5',
    ]);
    expect(textOf(r, 'incentive-financial-assistance-state')).toBe('In progress');
    await press(r, 'incentive-financial-assistance');
    expect(alerts.at(-1)).toEqual(['Financial Assistance (75%)', expect.stringContaining('still in progress')]);
    // The old Financial Assistance form is not opened for a new claim.
    expect(has(r, 'financial-assistance')).toBe(false);
  });
});

describe('An incentive scheme in the app (2026-11-25)', () => {
  it('a full application: disclaimer, unit, a plain section with a document, an "Add more" item, bank account, review and submit', async () => {
    const { server, current } = portal();
    const app = await signedInApp(server);
    const r = render(app, 'IncentiveScheme', { code: 'GREEN' });
    await settle();
    expect(texts(r)).toEqual(expect.arrayContaining(['Green Manufacturing', 'Disclaimer', 'Read this scheme disclaimer.']));

    // Disclaimer: the consent first.
    await press(r, 'scheme-consent');
    await press(r, 'scheme-next');
    // The unit, confirmed.
    expect(texts(r)).toEqual(expect.arrayContaining(['Confirm your unit', 'Acme Castings', 'UDYAM-UP-01-0000001']));
    await press(r, 'scheme-next');
    expect(alerts.at(-1)?.[1]).toBe('Please confirm the unit details.');
    await press(r, 'scheme-unit-confirm');
    await press(r, 'scheme-next');
    await settle();
    // The draft starts with the first section.
    expect(server.requests.filter(q => q.url.endsWith('/GREEN/Draft'))).toHaveLength(1);
    expect(has(r, 'scheme-step-section')).toBe(true);

    // The plain section: a required field is checked before the portal.
    await press(r, 'scheme-next');
    expect(alerts.at(-1)?.[1]).toBe('Please fill in "Name of the activity".');
    await type(r, 'scheme-field-details-0-activity', 'Boiler upgrade');
    await type(r, 'scheme-field-details-0-amount_paid', '40000');
    await press(r, 'scheme-field-details-0-mode-Online');
    await uploadPdf(r, 'scheme-field-details-0-invoice_copy');
    const upload = server.last('/GREEN/Document')!;
    expect(upload.fields).toEqual({ section: 'details', item: '0', field: 'invoice_copy' });
    expect(upload.files!.map(f => [f.name, f.type])).toEqual([['file', 'application/pdf']]);
    expect(texts(r)).toContain('PDF document 1');
    // The live claim: 75% of 40,000.
    expect(textOf(r, 'scheme-eligible')).toBe('Eligible: ₹ 30,000');
    await press(r, 'scheme-next');
    await settle();
    expect(server.last('/GREEN/Section')!.json).toEqual({
      section: 'details',
      values: { activity: 'Boiler upgrade', amount_paid: '40000', mode: 'Online', invoice_copy: JSON.stringify(['20261125100000001abcdef.pdf']) },
    });

    // "Add more": the first item opens by itself; the pick and the quantity, then Save item.
    expect(has(r, 'scheme-editor')).toBe(true);
    await press(r, 'scheme-next');
    expect(alerts.at(-1)?.[1]).toBe('Please save or cancel the item you are editing.');
    await press(r, 'scheme-save-item');
    expect(alerts.at(-1)?.[1]).toBe('Please choose Machine.');
    act(() => {
      void handler(r, 'scheme-pick-press').props.onPress();
    });
    await settle();
    await press(r, 'pick-item-1');
    await pressText(r, 'OK');
    await settle();
    await type(r, 'scheme-field-machines-0-qty', '2');
    await press(r, 'scheme-save-item');
    await settle();
    expect(server.last('/GREEN/Item')!.json).toEqual({ section: 'machines', index: 0, pick: 'Dryer', values: { qty: '2' } });
    expect(has(r, 'scheme-item-0')).toBe(true);
    expect(has(r, 'scheme-add-more')).toBe(true);
    await press(r, 'scheme-next');

    // The bank account and the cancelled cheque.
    expect(has(r, 'scheme-step-bank')).toBe(true);
    await press(r, 'scheme-next');
    expect(alerts.at(-1)?.[1]).toBe('Please enter the account details.');
    await type(r, 'scheme-account', '123456789012');
    await type(r, 'scheme-account2', '123456789012');
    await type(r, 'scheme-ifsc', 'sbin0001234');
    await type(r, 'scheme-bank', 'SBI');
    await type(r, 'scheme-branch', 'MG Road');
    await press(r, 'scheme-next');
    expect(alerts.at(-1)?.[1]).toBe('Please upload the cancelled cheque.');
    await uploadPdf(r, 'scheme-field-_bank-0-cheque');
    expect(server.last('/GREEN/Document')!.fields).toEqual({ section: '_bank', item: '0', field: 'cheque' });
    await press(r, 'scheme-next');

    // The review: the answers, the declaration, submit.
    expect(has(r, 'scheme-step-summary')).toBe(true);
    expect(texts(r)).toEqual(expect.arrayContaining(['Boiler upgrade', '₹ 40,000', '1. Dryer', 'I declare that the claim is true.']));
    await press(r, 'scheme-next');
    expect(alerts.at(-1)?.[1]).toBe('Please accept the declaration.');
    await press(r, 'scheme-declaration');
    await press(r, 'scheme-next');
    await settle();
    expect(server.last('/GREEN/Submit')!.json).toEqual({
      account: { accountNo: '123456789012', confirmAccountNo: '123456789012', ifscCode: 'SBIN0001234', branchAddress: 'MG Road', bankName: 'SBI' },
      cheque: ['20261125100000002abcdef.pdf'],
      unitConfirmed: true,
      declaration: true,
    });
    expect(current()!.status).toBe('Submitted');
    // After the submission: the status, the claim and the earlier applications.
    expect(has(r, 'scheme-status-page')).toBe(true);
    expect(textOf(r, 'scheme-status')).toBe('Submitted');
    expect(texts(r)).toEqual(expect.arrayContaining(['Earlier applications', '01-06-2026 · Rejected', 'Reason: Invoice unreadable']));
    // Every call of the scheme carried the sign-in token, never a ZED ID of its own.
    const calls = server.requests.filter(q => q.url.startsWith(SCHEMES_URL + '/GREEN'));
    expect(calls.every(q => !JSON.stringify(q.json ?? {}).includes('zedId'))).toBe(true);
  });

  it('a correction round: the assessor\'s remarks, only the answers found not valid are editable, then Submit corrections', async () => {
    const { server, current } = portal({
      id: 501,
      status: 'Correction',
      level: 'Bronze',
      answers: {
        sections: {
          details: [{ values: { activity: 'Boiler upgrade', amount_paid: '40000', mode: 'Online', invoice_copy: JSON.stringify(['a.pdf']) }, saved: true }],
          machines: [{ pick: 'Dryer', pickName: 'Dryer', values: { qty: '2' }, saved: true }],
        },
      },
      checks: [{ path: 'details/0/amount_paid', remarks: 'The invoice says 36,000.' }],
      claimAmount: 40000,
      eligibleAmount: 30000,
      correctionRound: 1,
      correctionDueOn: '2026-12-10',
      correctionOpen: true,
      account: { accountNo: '123456789012', ifscCode: 'SBIN0001234', branchAddress: 'MG Road', bankName: 'SBI' },
    });
    const app = await signedInApp(server);
    const r = render(app, 'IncentiveScheme', { code: 'GREEN' });
    await settle();
    expect(textOf(r, 'scheme-correction-intro')).toBe('Please correct the answers marked below and submit the corrections by 10-12-2026.');
    expect(texts(r)).toEqual(expect.arrayContaining(['Not valid: The invoice says 36,000.']));
    // The amount is editable, the activity (found valid) is not.
    const editable = (id: string) => r.root.findAll(n => n.props.testID === id && typeof n.props.onChangeText === 'function')[0]!.props.editable !== false;
    expect(editable('scheme-field-details-0-amount_paid')).toBe(true);
    expect(editable('scheme-field-details-0-activity')).toBe(false);
    await type(r, 'scheme-field-details-0-amount_paid', '36000');
    await press(r, 'scheme-fix-details/0-save');
    await settle();
    expect(server.last('/GREEN/Section')!.json).toEqual({
      section: 'details',
      values: { activity: 'Boiler upgrade', amount_paid: '36000', mode: 'Online', invoice_copy: JSON.stringify(['a.pdf']) },
    });
    await press(r, 'scheme-submit-corrections');
    await settle();
    // Account and cheque were not found not valid: they are not sent again.
    expect(server.last('/GREEN/Correction')!.json).toEqual({});
    expect(current()!.status).toBe('Verifying');
    expect(textOf(r, 'scheme-status')).toBe('Desktop verification');
  });

  it('the page cannot be loaded: the reason and Retry', async () => {
    const server = new FakeServer(req => (req.url === SCHEMES_URL + '/GONE' ? { status: '0', errorMessage: 'This scheme is not available for your unit.' } : { status: '1' }));
    const app = await signedInApp(server);
    const r = render(app, 'IncentiveScheme', { code: 'GONE' });
    await settle();
    expect(has(r, 'scheme-error')).toBe(true);
    expect(texts(r)).toContain('This scheme is not available for your unit.');
    await press(r, 'scheme-retry');
    await settle();
    expect(server.requests.filter(q => q.url === SCHEMES_URL + '/GONE')).toHaveLength(2);
  });
});
