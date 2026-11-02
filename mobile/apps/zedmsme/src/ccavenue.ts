/**
 * The CCAvenue checkout (PaymentActivity.makePayment / onTransactionResponse of the MSME code base) through the app's
 * native module ZedCcAvenue (android/.../ccavenue, CCAvenue's Android SDK). The order comes from the server
 * (Pay/GetToken); the payment is recorded by the server from CCAvenue's redirect (Pay/successtransmobile), so the
 * answer here only decides which result page shows.
 */
import { NativeModules } from 'react-native';
import type { PaymentHashResponse } from './api';
import type { MsmeDetails } from './models';

export type CheckoutOrder = Record<string, string>;
export type CheckoutResult = {
  outcome: 'response' | 'error' | 'cancel';
  status?: string | null;
  description?: string | null;
  error?: string | null;
};

type CcAvenueNative = { startTransaction(order: CheckoutOrder): Promise<CheckoutResult> };

let override: CcAvenueNative | null = null;

/** Tests replace the native module. */
export function setCcAvenueForTesting(native: CcAvenueNative | null) {
  override = native;
}

function native(): CcAvenueNative {
  const m = override ?? (NativeModules.ZedCcAvenue as CcAvenueNative | undefined);
  if (!m) throw new Error('Online payment is not available on this device.');
  return m;
}

/** The order as the legacy makePayment filled it: the server's order, the unit as billing and delivery details. */
export function checkoutOrder(token: PaymentHashResponse, details: MsmeDetails | null | undefined, certification: string, site: string): CheckoutOrder {
  const basic = details?.BasicDetails;
  const plant = details?.PlantDetails;
  const v = (s: string | null | undefined) => s ?? '';
  return {
    orderId: token.orderId,
    merchantId: token.merchantId,
    accessCode: token.accessCode,
    amount: token.amount,
    requestHash: token.requestHash,
    environment: token.paymentEnvironment ?? 'app_live',
    customerId: v(details?.PledgeEmailId),
    email: v(details?.PledgeEmailId),
    name: v(basic?.EnterpriseName),
    address: v(plant?.PAddress),
    tel: v(basic?.MobileNo),
    city: v(plant?.DISTRICT_NAME),
    state: v(plant?.state_name),
    zip: v(plant?.PPin),
    merchantParam1: v(details?.ZedId),
    merchantParam2: certification,
    redirectUrl: site + 'pay/successtransmobile',
    cancelUrl: site + 'pay/failuretransmobile',
  };
}

export function startCheckout(order: CheckoutOrder): Promise<CheckoutResult> {
  return native().startTransaction(order);
}

/** onTransactionResponse: verified_order_status "Success" (any case) is a success. */
export const isPaid = (r: CheckoutResult) => r.outcome === 'response' && (r.status ?? '').toLowerCase() === 'success';
