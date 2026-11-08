import React from 'react';
import { Alert, Linking, ToastAndroid } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StackNavigator, UiHost } from '@zed/shared';
import { MsmeAppProvider } from '../src/app/context';
import { AppDrawerHost } from '../src/app/AppDrawer';
import type { MsmeApp } from '../src/app/MsmeApp';
import type { PublicIncentiveCards } from '../src/api';
import {
  eligibleAmount,
  financialAssistanceIsValid,
  newFinancialAssistance,
  type FinancialAssistance,
} from '../src/financialAssistance';
import { SCREENS } from '../App';
import { FakeServer, makeApp } from './helpers/harness';
import { memoryDb } from './helpers/sqljs';
import { legacyPhoto, writeLegacyLoginRow, writeLegacyPhotoRows, ZED_ID } from './helpers/legacyFixture';

jest.useFakeTimers();
jest.setTimeout(60000);

async function signedInApp(server = new FakeServer()) {
  const loginDb = await memoryDb();
  const mediaDb = await memoryDb();
  await writeLegacyLoginRow(loginDb, 'PW');
  await writeLegacyPhotoRows(mediaDb);
  const { app } = await makeApp(server, { loginDb, mediaDb });
  await app.offlineLogin(ZED_ID, 'PW');
  return app;
}

function render(app: MsmeApp, name: string) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <UiHost>
        <MsmeAppProvider app={app}>
          <AppDrawerHost>
            <StackNavigator screens={SCREENS} initial={{ name }} />
          </AppDrawerHost>
        </MsmeAppProvider>
      </UiHost>,
    );
  });
  return r;
}

const pressable = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && 'disabled' in n.props)[0]!;

function completeClaim(): FinancialAssistance {
  const c = newFinancialAssistance(ZED_ID);
  Object.assign(c.CertificationDetails, {
    CategoryOfCertificate: 'Quality',
    NameOfCertficate: 'ISO 9001',
    CertificationAgency: 'Agency',
    CertficateNumber: 'Q-1',
    DateOfIssue: '2026-10-01',
    ValidityOfCertificate: '3 years',
    Photos: [legacyPhoto('ZEDRNTEST00011700000000001', 'a1.jpg')],
  });
  Object.assign(c.ExpenditureDetails, {
    ExpenditureCertficate: 'ISO 9001',
    AgencyOrSupplier: 'Agency',
    InvoiceNo: 'INV-1',
    InvoiceBillDate: '2026-10-02',
    DescriptionOfExpenses: 'Certification fee',
    AmountPaid: '40000',
    ModeOfPayment: 'NEFT',
    EligibleAmount: eligibleAmount('40000'),
    Photos: [legacyPhoto('ZEDRNTEST00011700000000002', 'a2.jpg')],
    InvoicePhotos: [legacyPhoto('ZEDRNTEST00011700000000003', 'e1.jpg')],
  });
  Object.assign(c.AccountDetails, {
    AccountNo: '1234567890',
    IfscCode: 'SBIN0000001',
    BranchAddress: 'Noida',
    BankName: 'SBI',
    Photos: [legacyPhoto('ZEDRNTEST00011700000000004', 'e2.jpg')],
  });
  return c;
}

describe('Financial Assistance claim (FinancialAssistance.isValid)', () => {
  it('is complete only with every field and every upload', () => {
    const c = completeClaim();
    expect(financialAssistanceIsValid(c)).toBe(true);
    c.AccountDetails.Photos = [];
    expect(financialAssistanceIsValid(c)).toBe(false);
    expect(financialAssistanceIsValid(newFinancialAssistance(ZED_ID))).toBe(false);
  });

  it('eligible amount: 75% of the whole rupees paid, at most 50,000 (as the server computes it)', () => {
    expect(eligibleAmount('40000')).toBe('30000');
    expect(eligibleAmount('40000.90')).toBe('30000');
    expect(eligibleAmount('100000')).toBe('50000');
    expect(eligibleAmount('')).toBe('');
    expect(eligibleAmount('0')).toBe('');
  });

  it('sends each upload field as SubmitFinancialPhotos and the data as JSON without base64', async () => {
    const server = new FakeServer();
    const app = await signedInApp(server);
    const claim = completeClaim();
    claim.CertificationDetails.Photos[0]!.photo = 'BASE64';
    await app.api.submitFinancialPhotos(claim.ZedId, claim.CertificationDetails.Photos);
    const photos = server.last('mobileapi/msme/SubmitFinancialPhotos')!;
    expect(photos.fields).toMatchObject({ zedId: ZED_ID });
    expect(photos.files!.map(f => [f.name, f.fileName])).toEqual([['files', 'ZEDRNTEST00011700000000001.jpg']]);

    await app.api.submitFinancialData(claim);
    const data = server.last('mobileapi/msme/SubmitFinancialData')!.json!;
    expect(data).toMatchObject({
      ZedId: ZED_ID,
      CertificationDetails: { CategoryOfCertificate: 'Quality', NameOfCertficate: 'ISO 9001', DateOfIssue: '2026-10-01' },
      ExpenditureDetails: { InvoiceNo: 'INV-1', AmountPaid: '40000', EligibleAmount: '30000' },
      AccountDetails: { IfscCode: 'SBIN0000001' },
    });
    const sent = data.CertificationDetails as { Photos: Array<Record<string, unknown>> };
    expect(sent.Photos[0]!.photoId).toBe('ZEDRNTEST00011700000000001');
    expect(sent.Photos[0]!.photo).toBeUndefined(); // base64 left out (null is not sent)
  });
});

describe('My Incentives (MyIncentivesFragment)', () => {
  it('Financial Assistance opens only when the server enables it; the other incentives after a certification', async () => {
    const app = await signedInApp();
    const status = app.user!.MsmeDetails!.msmeStatus!;
    status.financialAssistanceStatus = 0;
    status.bronze!.status = 1;
    let r = render(app, 'Incentives');
    // MSME KAWACH was removed: the list starts with the joining reward.
    expect(r.root.findAll((n) => n.props.testID === 'incentive-kawach')).toHaveLength(0);
    expect(pressable(r, 'incentive-joining-reward').props.disabled).toBe(false);
    expect(pressable(r, 'incentive-financial-assistance').props.disabled).toBe(true);
    expect(pressable(r, 'incentive-graded-0').props.disabled).toBe(true);

    status.financialAssistanceStatus = 1;
    status.bronze!.status = 3;
    r = render(app, 'Incentives');
    expect(pressable(r, 'incentive-financial-assistance').props.disabled).toBe(false);
    expect(pressable(r, 'incentive-graded-0').props.disabled).toBe(false);
    await act(async () => pressable(r, 'incentive-financial-assistance').props.onPress());
    expect(r.root.findAll(n => n.props.testID === 'fa-page-0' && typeof n.type === 'string')).toHaveLength(1);
  });
});

// ----- New in V4 (2026-11-08): the incentive cards the Admin manages (api/public/incentive-cards) -----

const CARDS_URL = 'http://10.0.2.2:5106/api/public/incentive-cards';

const ADMIN_CARDS: PublicIncentiveCards = {
  builtIn: [
    { card: 'JOINING_REWARD', title: 'Welcome Reward', highlight: 'Up to Rs. 10,000/-', details: '<p>Linked with <b>ZED levels</b></p>', active: true },
    { card: 'FINANCIAL_ASSISTANCE', title: 'Financial Assistance', highlight: null, details: null, active: false },
    { card: 'HANDHOLDING', title: 'Handholding by experts', highlight: 'Rs. 2,00,000/-', details: null, active: true },
    { card: 'TECHNOLOGY_UPGRADATION', title: null, highlight: null, details: null, active: false },
    { card: 'KAWACH', title: 'MSME KAWACH', highlight: null, details: null, active: true },
  ],
  incentives: [
    {
      id: 7,
      title: 'State Subsidy',
      highlight: '50% of the certification fee',
      details: '<p>For <b>ZED certified</b> units</p>',
      department: 'Industries Department',
      contactPerson: 'A. Kumar',
      email: 'subsidy@state.gov.in',
      mobileNo: '98765 43210',
      webLink: 'https://state.gov.in/zed',
      videoLink: 'https://videos.example.org/subsidy.mp4',
      applicableForBronze: true,
      applicableForSilver: true,
      applicableForGold: true,
    },
    {
      id: 8,
      title: 'Bank Loan',
      highlight: null,
      details: null,
      department: null,
      contactPerson: null,
      email: null,
      mobileNo: null,
      webLink: 'javascript:alert(1)',
      videoLink: null,
      applicableForBronze: false,
      applicableForSilver: false,
      applicableForGold: true,
    },
  ],
};

/** A server that answers the incentive cards with `cards` (the other calls as usual). */
const cardsServer = (cards: unknown) => new FakeServer(req => (req.url === CARDS_URL ? cards : { status: '1' }));

/** Every string shown on the screen. */
function strings(r: ReactTestRenderer.ReactTestRenderer): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === 'string') out.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (typeof node === 'object' && 'children' in (node as object)) walk((node as { children: unknown }).children);
  };
  walk(r.toJSON());
  return out;
}

const withTestId = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && typeof n.props.onPress === 'function');
const cardIds = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root
    .findAll(n => typeof n.type === 'string' && typeof n.props.testID === 'string' && /^incentive-(joining-reward|financial-assistance|graded-\d|admin-\d+)$/.test(n.props.testID))
    .map(n => n.props.testID as string);

/** Lets the screen's request and its re-render finish. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });

describe('My Incentives: the Admin cards (Main Dashboard Cards, 2026-11-08)', () => {
  let openURL: jest.SpyInstance;
  beforeEach(() => {
    openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  });
  afterEach(() => openURL.mockRestore());

  it('opening the screen asks the portal and shows the Admin title, highlight and details on the built-in cards', async () => {
    const server = cardsServer(ADMIN_CARDS);
    const app = await signedInApp(server);
    const r = render(app, 'Incentives');
    await settle();
    expect(server.requests.filter(q => q.url === CARDS_URL)).toHaveLength(1);
    const shown = strings(r);
    expect(shown).toEqual(expect.arrayContaining(['Welcome Reward', 'Up to Rs. 10,000/-', 'Linked with ZED levels', 'Handholding by experts', 'Rs. 2,00,000/-']));
    expect(shown).not.toContain('Joining Reward');
    expect(shown).not.toContain('Handholding Support');
    // A card the Admin gave no details keeps its built-in description.
    expect(shown).toContain(' for improving systems and processes');
    // The stakeholder cards stay as they are; KAWACH (removed) is ignored.
    expect(shown).toEqual(expect.arrayContaining(['Ministry of MSME', 'States/UTs', 'Financial Institutions', 'Other Incentives']));
    expect(shown).not.toContain('MSME KAWACH');

    // The joining reward's dialog carries the Admin title.
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await act(async () => withTestId(r, 'incentive-joining-reward')[0]!.props.onPress());
    expect(alert.mock.calls[0]?.[0]).toBe('Welcome Reward');
    alert.mockRestore();

    // Not asked again within a few minutes.
    render(app, 'Incentives');
    await settle();
    expect(server.requests.filter(q => q.url === CARDS_URL)).toHaveLength(1);
  });

  it('hides a built-in card the Admin turned off and adds the dashboard incentives after the built-in cards', async () => {
    const app = await signedInApp(cardsServer(ADMIN_CARDS));
    await app.refreshIncentiveCards();
    const r = render(app, 'Incentives');
    expect(cardIds(r)).toEqual([
      'incentive-joining-reward',
      'incentive-graded-0',
      'incentive-graded-2',
      'incentive-graded-3',
      'incentive-graded-4',
      'incentive-graded-5',
      'incentive-admin-7',
      'incentive-admin-8',
    ]);
    const shown = strings(r);
    expect(shown).toEqual(
      expect.arrayContaining(['State Subsidy', '50% of the certification fee', 'For ZED certified units', 'Industries Department', 'A. Kumar', 'subsidy@state.gov.in', '98765 43210', 'Bank Loan']),
    );
    expect(shown).not.toContain('Technology Upgradation');
  });

  it('the Website and Video buttons, the e-mail and the mobile open with Linking; a failure shows a toast', async () => {
    const app = await signedInApp(cardsServer(ADMIN_CARDS));
    await app.refreshIncentiveCards();
    const r = render(app, 'Incentives');
    expect(strings(r)).toEqual(expect.arrayContaining(['Website', 'Video']));
    await act(async () => withTestId(r, 'incentive-admin-7-website')[0]!.props.onPress());
    expect(openURL).toHaveBeenLastCalledWith('https://state.gov.in/zed');
    await act(async () => withTestId(r, 'incentive-admin-7-video')[0]!.props.onPress());
    expect(openURL).toHaveBeenLastCalledWith('https://videos.example.org/subsidy.mp4');
    await act(async () => withTestId(r, 'incentive-admin-7-email')[0]!.props.onPress());
    expect(openURL).toHaveBeenLastCalledWith('mailto:subsidy@state.gov.in');
    await act(async () => withTestId(r, 'incentive-admin-7-mobile')[0]!.props.onPress());
    expect(openURL).toHaveBeenLastCalledWith('tel:9876543210');
    // Only web links get a button.
    expect(withTestId(r, 'incentive-admin-8-website')).toHaveLength(0);
    expect(withTestId(r, 'incentive-admin-8-video')).toHaveLength(0);

    const toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => undefined);
    openURL.mockRejectedValueOnce(new Error('no app'));
    await act(async () => withTestId(r, 'incentive-admin-7-website')[0]!.props.onPress());
    expect(toast).toHaveBeenCalledWith('The link could not be opened.', ToastAndroid.SHORT);
    toast.mockRestore();
  });

  it.each([
    ['an empty answer', () => cardsServer({ builtIn: [], incentives: [] })],
    ['an older server', () => cardsServer({ status: '0' })],
    [
      'no network',
      () => {
        const s = new FakeServer();
        s.online = false;
        return s;
      },
    ],
  ])('shows the built-in cards after %s', async (_name, server) => {
    const app = await signedInApp(server());
    const r = render(app, 'Incentives');
    await settle();
    expect(app.incentiveCards).toBeNull();
    expect(cardIds(r)).toEqual([
      'incentive-joining-reward',
      'incentive-financial-assistance',
      'incentive-graded-0',
      'incentive-graded-1',
      'incentive-graded-2',
      'incentive-graded-3',
      'incentive-graded-4',
      'incentive-graded-5',
    ]);
    const shown = strings(r);
    expect(shown).toEqual(expect.arrayContaining(['Joining Reward', 'Rs. 10,000/-', 'Financial Assistance', 'Handholding Support', 'Technology Upgradation']));
  });

  it('keeps the last answer on the phone and shows it when the portal cannot be reached', async () => {
    const loginDb = await memoryDb();
    const mediaDb = await memoryDb();
    await writeLegacyLoginRow(loginDb, 'PW');
    const { app } = await makeApp(cardsServer(ADMIN_CARDS), { loginDb, mediaDb });
    await app.refreshIncentiveCards();

    const offline = new FakeServer();
    offline.online = false;
    const { app: again } = await makeApp(offline, { loginDb, mediaDb: await memoryDb() });
    await again.offlineLogin(ZED_ID, 'PW');
    const r = render(again, 'Incentives');
    await settle();
    expect(strings(r)).toEqual(expect.arrayContaining(['Welcome Reward', 'State Subsidy']));
    expect(cardIds(r)).toContain('incentive-admin-7');
    expect(cardIds(r)).not.toContain('incentive-financial-assistance');

    // An empty answer later does not wipe the kept cards.
    const empty = cardsServer({ builtIn: [], incentives: [] });
    const { app: third } = await makeApp(empty, { loginDb, mediaDb: await memoryDb() });
    await third.refreshIncentiveCards();
    expect(empty.requests.filter(q => q.url === CARDS_URL)).toHaveLength(1);
    expect(third.incentiveCards?.incentives.map(i => i.id)).toEqual([7, 8]);
  });
});
