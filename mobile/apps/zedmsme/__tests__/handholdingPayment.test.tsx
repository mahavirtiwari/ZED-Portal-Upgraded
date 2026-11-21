import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StackNavigator, UiHost } from '@zed/shared';
import { MsmeAppProvider } from '../src/app/context';
import { AppDrawerHost } from '../src/app/AppDrawer';
import type { MsmeApp } from '../src/app/MsmeApp';
import { setCcAvenueForTesting, type CheckoutOrder, type CheckoutResult } from '../src/ccavenue';
import { handholdingNotes } from '../src/screens/HandholdingScreens';
import { SCREENS } from '../App';
import { FakeServer, makeApp } from './helpers/harness';
import { memoryDb } from './helpers/sqljs';
import { writeLegacyLoginRow, writeLegacyPhotoRows, ZED_ID } from './helpers/legacyFixture';

jest.useFakeTimers();
jest.setTimeout(60000);

/** 2026-11-21 (the user: "add handholding payment screens also with the question"). */

const FEE = {
  Id: 30,
  EnterpriseTypee: 'Small',
  Certification: 'Silver',
  AssessmentFee: 169491.53,
  Gst: 30508.47,
  Total: 200000,
  SubsidyPercentage: 80,
  ApplicantContributionAfterSubsidy: 23600,
  GstAfterSubsidy: 3600,
  MileStone: 1,
};

const TOKEN = { status: '1', orderId: 'b1a2c3d4', merchantId: '12345', accessCode: 'AVMOBILE', amount: '23600', requestHash: 'h', paymentEnvironment: 'app_staging' };

type Level = { certification: string; name: string; milestonesStarted: number; nextMilestone: number; canPay: boolean; refusal?: string | null; awaitingAcceptance?: number | null };

function server(levels: Level[], fee: Record<string, unknown> = FEE) {
  return new FakeServer(req => {
    if (req.url.endsWith('ConsultancyPay/GetHandholdingStatus')) return { status: '1', levels };
    if (req.url.endsWith('Msme/GetConsultancyPaymentDetailsByType')) return { WithOutCoupon: [fee], WithCoupon: [], CouponStatus: [{ IsCouponUsed: 1 }] };
    if (req.url.endsWith('ConsultancyPay/GetConsultantOrganisations'))
      return { status: '1', organisations: [{ userId: 'CO_A', userName: 'Alpha Consultants' }, { userId: 'CO_C', userName: 'Gamma Partners' }] };
    if (req.url.endsWith('ConsultancyPay/GetToken')) return TOKEN;
    return { status: '1' };
  });
}

const SILVER_DUE: Level = { certification: 'Silver', name: 'Silver', milestonesStarted: 0, nextMilestone: 1, canPay: true, refusal: null, awaitingAcceptance: null };

async function signedInApp(s: FakeServer) {
  const loginDb = await memoryDb();
  const mediaDb = await memoryDb();
  await writeLegacyLoginRow(loginDb, 'PW');
  await writeLegacyPhotoRows(mediaDb);
  const { app } = await makeApp(s, { loginDb, mediaDb });
  await app.offlineLogin(ZED_ID, 'PW');
  return app;
}

function render(app: MsmeApp) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <UiHost>
        <MsmeAppProvider app={app}>
          <AppDrawerHost>
            <StackNavigator screens={SCREENS} initial={{ name: 'Handholding' }} />
          </AppDrawerHost>
        </MsmeAppProvider>
      </UiHost>,
    );
  });
  return r;
}

const handler = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && typeof n.props.onPress === 'function')[0]!;
const press = (r: ReactTestRenderer.ReactTestRenderer, id: string) => act(async () => handler(r, id).props.onPress());
const has = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && typeof n.type === 'string').length > 0;
const texts = (r: ReactTestRenderer.ReactTestRenderer) => r.root.findAll(n => (n.type as unknown) === 'Text').map(n => [n.props.children].flat().join(''));
const settle = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

let alerts: string[] = [];
let buttons: Array<{ text?: string; onPress?: () => unknown }> = [];
let alertSpy: jest.SpyInstance;
beforeEach(() => {
  alerts = [];
  buttons = [];
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, m, b) => {
    alerts.push(String(m ?? ''));
    buttons = (b as typeof buttons | undefined) ?? [];
  });
});
afterEach(() => {
  alertSpy.mockRestore();
  setCcAvenueForTesting(null);
});

async function toOptions(r: ReactTestRenderer.ReactTestRenderer) {
  await settle();
  await press(r, 'handholding-Silver-pay');
  await settle();
  await press(r, 'payment-proceed'); // disclaimer
  await press(r, 'payment-proceed'); // instructions
  await press(r, 'gst-No');
  await press(r, 'tds-No');
}

describe('Handholding Support in the app', () => {
  it('lists the levels with their milestones; a level that cannot be paid says why', async () => {
    const s = server([
      SILVER_DUE,
      { certification: 'ZEDX', name: 'ZED-X', milestonesStarted: 1, nextMilestone: 2, canPay: false, refusal: 'Milestone 1 must be completed and accepted before Milestone 2 can be paid.', awaitingAcceptance: 1 },
    ]);
    const r = render(await signedInApp(s));
    await settle();
    expect(s.last('ConsultancyPay/GetHandholdingStatus')!.json).toEqual({ zedId: ZED_ID });
    expect(texts(r)).toEqual(expect.arrayContaining(['Silver Handholding Support', 'ZED-X Handholding Support', 'Waiting for your acceptance']));
    expect(handler(r, 'handholding-Silver-pay').props.title ?? 'Pay Milestone 1').toMatch(/Pay Milestone 1/i);
    expect(has(r, 'handholding-ZEDX-pay')).toBe(false);
    // Waiting for the unit's acceptance: the Accept button instead of the reason.
    expect(has(r, 'handholding-ZEDX-accept')).toBe(true);
  });

  it('no level open: a message instead of an empty page', async () => {
    const r = render(await signedInApp(server([])));
    await settle();
    expect(has(r, 'handholding-none')).toBe(true);
  });

  it('milestone 1 asks who assisted the unit: required, then the chosen organisation goes with the order to the handholding checkout', async () => {
    const s = server([SILVER_DUE]);
    const orders: CheckoutOrder[] = [];
    setCcAvenueForTesting({ startTransaction: async (o: CheckoutOrder): Promise<CheckoutResult> => (orders.push(o), { outcome: 'response', status: 'Success' }) });
    const r = render(await signedInApp(s));
    await toOptions(r);
    expect(s.last('Msme/GetConsultancyPaymentDetailsByType')!.json).toEqual({ certification: 'Silver', zedId: ZED_ID });
    expect(texts(r)).toEqual(expect.arrayContaining(['Handholding Fee', 'Milestone 1: Baseline Diagnostic Study and Handholding Action Plan']));

    await press(r, 'payment-proceed');
    expect(alerts).toContain('Please answer whether any Consultant Organisation assisted you.');
    expect(has(r, 'payment-confirm')).toBe(false);

    await press(r, 'co-yes');
    await settle();
    await press(r, 'payment-proceed');
    expect(alerts).toContain('Please choose the Consultant Organisation that assisted you.');
    await press(r, 'co-CO_C');
    await press(r, 'payment-proceed');
    await press(r, 'payment-confirm');
    await settle();

    expect(s.last('ConsultancyPay/GetToken')!.json).toMatchObject({
      PaymentRefId: '30', ZedId: ZED_ID, Certification: 'Silver', Amount: '23600', Gst: 'No', TdsDeductible: 'No', AssistedByCo: 'Yes', AssistedCoId: 'CO_C',
    });
    expect(s.requests.some(q => /\/Pay\/GetToken$/.test(q.url) && !q.url.includes('ConsultancyPay'))).toBe(false);
    expect(orders[0]).toMatchObject({
      orderId: 'b1a2c3d4',
      merchantParam1: ZED_ID,
      merchantParam2: 'Silver',
      merchantParam3: 'Milestone 1',
      redirectUrl: 'http://10.0.2.2:5106/ConsultancyPay/successtransmobile',
      cancelUrl: 'http://10.0.2.2:5106/ConsultancyPay/failuretransmobile',
    });
    expect(has(r, 'handholding-payment-success')).toBe(true);
    expect(texts(r)).toContain('Milestone 1 is allotted to the Consultant Organisation you chose. It will contact you.');
  });

  it('No goes as No; a later milestone has no question; nothing to pay is confirmed without the gateway', async () => {
    let s = server([SILVER_DUE]);
    setCcAvenueForTesting({ startTransaction: async () => ({ outcome: 'response', status: 'Success' }) });
    let r = render(await signedInApp(s));
    await toOptions(r);
    await press(r, 'co-no');
    await press(r, 'payment-proceed');
    await press(r, 'payment-confirm');
    await settle();
    const no = s.last('ConsultancyPay/GetToken')!.json as Record<string, unknown>;
    expect(no.AssistedByCo).toBe('No');
    expect(no.AssistedCoId ?? null).toBeNull();
    expect(texts(r)).toContain('A Consultant Organisation will be allotted to you. It will contact you.');

    s = server(
      [{ certification: 'Silver', name: 'Silver', milestonesStarted: 1, nextMilestone: 2, canPay: true }],
      { ...FEE, MileStone: 2, PayAllAtMilestone1: true, ApplicantContributionAfterSubsidy: 0, GstAfterSubsidy: 0 },
    );
    r = render(await signedInApp(s));
    await settle();
    await press(r, 'handholding-Silver-pay');
    await settle();
    await press(r, 'payment-proceed');
    await press(r, 'payment-proceed');
    expect(has(r, 'co-question')).toBe(false);
    expect(texts(r)).toContain('Milestone 2 was paid with milestone 1: there is nothing to pay. Proceed to start it.');
    await press(r, 'gst-No');
    await press(r, 'tds-No');
    await press(r, 'payment-proceed');
    await press(r, 'payment-confirm');
    await settle();
    const zero = s.last('ConsultancyPay/SubmitZeroPaymentDetails')!.json as Record<string, unknown>;
    expect(zero).toMatchObject({ Certification: 'Silver', Amount: '0' });
    expect(zero.AssistedByCo).toBeUndefined();
    expect(s.last('ConsultancyPay/GetToken')).toBeUndefined();
    expect(has(r, 'handholding-payment-success')).toBe(true);
  });

  describe('Accept Milestone (2026-11-21)', () => {
    const WAITING: Level = {
      certification: 'Silver', name: 'Silver', milestonesStarted: 1, nextMilestone: 2, canPay: false,
      refusal: 'Milestone 1 must be completed and accepted before Milestone 2 can be paid.', awaitingAcceptance: 1,
    };

    async function acceptWith(answer: Record<string, unknown>, fee: Record<string, unknown> = { ...FEE, MileStone: 2 }) {
      let accepted = false;
      const s = new FakeServer(req => {
        if (req.url.endsWith('ConsultancyPay/GetHandholdingStatus'))
          return { status: '1', levels: [accepted ? { ...WAITING, awaitingAcceptance: null, milestonesStarted: answer.next === 'Started' ? 2 : 1 } : WAITING] };
        if (req.url.endsWith('ConsultancyPay/AcceptMilestone')) return ((accepted = true), answer);
        if (req.url.endsWith('Msme/GetConsultancyPaymentDetailsByType')) return { WithOutCoupon: [fee], WithCoupon: [], CouponStatus: [{ IsCouponUsed: 1 }] };
        return { status: '1' };
      });
      const r = render(await signedInApp(s));
      await settle();
      expect(has(r, 'handholding-Silver-pay')).toBe(false);
      await press(r, 'handholding-Silver-accept');
      expect(alerts[0]).toBe('I accept the activities conducted & recommendations given in Milestone-1');
      await act(async () => {
        await buttons.find(b => b.text === 'Accept')!.onPress!();
      });
      await settle();
      expect(s.last('ConsultancyPay/AcceptMilestone')!.json).toEqual({ certification: 'Silver', milestone: 1, zedId: ZED_ID });
      return { r, s };
    }

    it('each milestone paid: accepting opens the payment of the next milestone', async () => {
      const { r, s } = await acceptWith({ status: '1', message: 'Milestone 1 accepted. Please pay for Milestone 2 to start it.', next: 'Pay', nextMilestone: 2 });
      expect(has(r, 'handholding-payment')).toBe(true);
      expect(s.last('Msme/GetConsultancyPaymentDetailsByType')!.json).toEqual({ certification: 'Silver', zedId: ZED_ID });
      await press(r, 'payment-proceed');
      await press(r, 'payment-proceed');
      expect(texts(r)).toContain('Milestone 2: Implementation & Progress Review 1');
      expect(has(r, 'co-question')).toBe(false);
    });

    it('one payment for all milestones: accepting starts the next milestone, no payment screen', async () => {
      const { r, s } = await acceptWith({
        status: '1', message: 'Milestone 1 accepted. Milestone 2 has started with your Consultant Organisation (already paid with milestone 1).', next: 'Started', nextMilestone: 2,
      });
      expect(has(r, 'handholding-payment')).toBe(false);
      expect(alerts).toContain('Milestone 1 accepted. Milestone 2 has started with your Consultant Organisation (already paid with milestone 1).');
      expect(s.last('Msme/GetConsultancyPaymentDetailsByType')).toBeUndefined();
      expect(s.requests.filter(q => q.url.endsWith('ConsultancyPay/GetHandholdingStatus')).length).toBe(2);
    });
  });

  it("the summary's notes follow the fee row as the web page", () => {
    expect(handholdingNotes({ ...FEE, PayAllAtMilestone1: 1 } as never, 'Gold')).toEqual([
      'This payment covers all three milestones of Gold handholding. Milestones 2 and 3 will have nothing more to pay.',
    ]);
    expect(handholdingNotes({ ...FEE, StateSubsidyLabel: 'Andhra Pradesh Govt. subsidy (100%)', PayAllAtMilestone1: 1 } as never, 'Gold')).toEqual([
      'Andhra Pradesh Govt. subsidy (100%)',
    ]);
    expect(handholdingNotes(FEE as never, 'Gold')).toEqual([]);
  });
});
