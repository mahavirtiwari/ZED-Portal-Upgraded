import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StackNavigator, UiHost } from '@zed/shared';
import { MsmeAppProvider } from '../src/app/context';
import { AppDrawerHost } from '../src/app/AppDrawer';
import type { MsmeApp } from '../src/app/MsmeApp';
import { checkoutOrder, isPaid, setCcAvenueForTesting, type CheckoutOrder, type CheckoutResult } from '../src/ccavenue';
import { SCREENS } from '../App';
import { FakeServer, makeApp } from './helpers/harness';
import { memoryDb } from './helpers/sqljs';
import { writeLegacyLoginRow, writeLegacyPhotoRows, ZED_ID } from './helpers/legacyFixture';

jest.useFakeTimers();
jest.setTimeout(60000);

const FEE = {
  Id: 7,
  EnterpriseTypee: 'Small',
  Certification: 'Bronze',
  AssessmentFee: 10000,
  Gst: 1800,
  Total: 11800,
  SubsidyPercentage: 80,
  ApplicantContributionAfterSubsidy: 2360,
  GstAfterSubsidy: 360,
};

const TOKEN = {
  status: '1',
  orderId: '100001',
  merchantId: '12345',
  accessCode: 'AVMOBILE',
  amount: '2360',
  requestHash: 'abc123',
  paymentEnvironment: 'app_staging',
};

function server() {
  return new FakeServer(req => {
    if (req.url.endsWith('Msme/GetPaymentDetailsByType')) return { WithOutCoupon: [FEE], WithCoupon: [], CouponStatus: [{ IsCouponUsed: 1 }] };
    if (req.url.endsWith('Pay/GetToken')) return TOKEN;
    return { status: '1' };
  });
}

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
            <StackNavigator screens={SCREENS} initial={{ name: 'Payment', params: { certificationType: 'Bronze' } }} />
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
const title = (r: ReactTestRenderer.ReactTestRenderer) => r.root.findAll(n => n.props.testID === 'header-title' && typeof n.type === 'string')[0]!.props.children;

async function toCheckout(r: ReactTestRenderer.ReactTestRenderer) {
  await act(async () => {
    await Promise.resolve();
  });
  await press(r, 'payment-proceed'); // disclaimer
  await press(r, 'payment-proceed'); // instructions
  await press(r, 'gst-No');
  await press(r, 'tds-No');
  await press(r, 'payment-proceed'); // summary dialog
  await press(r, 'payment-confirm');
}

afterEach(() => setCcAvenueForTesting(null));

describe('CCAvenue checkout (PaymentActivity.makePayment)', () => {
  it('opens the checkout with the server order and the unit as billing details, and shows the success page', async () => {
    const s = server();
    const app = await signedInApp(s);
    const orders: CheckoutOrder[] = [];
    setCcAvenueForTesting({
      startTransaction: async (o: CheckoutOrder): Promise<CheckoutResult> => (orders.push(o), { outcome: 'response', status: 'Success' }),
    });
    const r = render(app);
    await toCheckout(r);

    expect(s.last('Pay/GetToken')!.json).toMatchObject({ PaymentRefId: '7', ZedId: ZED_ID, Certification: 'Bronze', Amount: '2360', Gst: 'No', TdsDeductible: 'No' });
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      orderId: '100001',
      merchantId: '12345',
      accessCode: 'AVMOBILE',
      amount: '2360',
      requestHash: 'abc123',
      environment: 'app_staging',
      merchantParam1: ZED_ID,
      merchantParam2: 'Bronze',
      redirectUrl: 'http://10.0.2.2:5106/pay/successtransmobile',
      cancelUrl: 'http://10.0.2.2:5106/pay/failuretransmobile',
    });
    expect(title(r)).toBe('Success');
  });

  it('a failed payment shows the failure page; a cancelled one stays on the details', async () => {
    const app = await signedInApp(server());
    setCcAvenueForTesting({ startTransaction: async () => ({ outcome: 'response', status: 'Failure' }) });
    let r = render(app);
    await toCheckout(r);
    expect(title(r)).toBe('Failure');

    setCcAvenueForTesting({ startTransaction: async () => ({ outcome: 'cancel' }) });
    r = render(app);
    await toCheckout(r);
    expect(title(r)).toBe('Payment');
    expect(has(r, 'gst-No')).toBe(true);
  });

  it('the fee cannot be loaded: a message with BACK / RETRY, no disclaimer or summary; RETRY loads it', async () => {
    const s = server();
    const app = await signedInApp(s);
    s.online = false;
    const r = render(app);
    await act(async () => {
      await Promise.resolve();
    });
    expect(has(r, 'payment-fee-error')).toBe(true);
    expect(has(r, 'gst-No')).toBe(false);
    expect(r.root.findAll(n => n.props.testID === 'app.msme.certification.payment.disclaimer').length).toBe(0);

    s.online = true;
    await press(r, 'payment-retry');
    expect(has(r, 'payment-fee-error')).toBe(false);
    await press(r, 'payment-proceed'); // disclaimer
    await press(r, 'payment-proceed'); // instructions
    expect(has(r, 'gst-No')).toBe(true);
  });

  it('a fee row without the amount due never becomes a free (zero) payment', async () => {
    const s = new FakeServer(req => {
      if (req.url.endsWith('Msme/GetPaymentDetailsByType')) return { WithOutCoupon: [{ ...FEE, ApplicantContributionAfterSubsidy: null }], WithCoupon: [], CouponStatus: [{ IsCouponUsed: 1 }] };
      return { status: '1' };
    });
    const app = await signedInApp(s);
    const r = render(app);
    await act(async () => {
      await Promise.resolve();
    });
    await press(r, 'payment-proceed'); // disclaimer
    await press(r, 'payment-proceed'); // instructions
    await press(r, 'gst-No');
    await press(r, 'tds-No');
    expect(handler(r, 'payment-proceed').props.disabled).toBe(true);
    await press(r, 'payment-proceed'); // even when pressed: no summary, no payment
    expect(has(r, 'payment-confirm')).toBe(false);
    expect(s.requests.some(q => /ZeroPayment|Pay\/GetToken/.test(q.url))).toBe(false);
    expect(title(r)).toBe('Payment');
  });

  it('isPaid: only a "Success" response (any case)', () => {
    expect(isPaid({ outcome: 'response', status: 'SUCCESS' })).toBe(true);
    expect(isPaid({ outcome: 'response', status: 'Aborted' })).toBe(false);
    expect(isPaid({ outcome: 'error', error: 'x' })).toBe(false);
  });

  it('defaults to the live environment when an older server does not say', () => {
    const o = checkoutOrder({ ...TOKEN, paymentEnvironment: undefined }, null, 'Silver', 'https://zedv3.qci.org.in/');
    expect(o.environment).toBe('app_live');
    expect(o.redirectUrl).toBe('https://zedv3.qci.org.in/pay/successtransmobile');
  });
});
