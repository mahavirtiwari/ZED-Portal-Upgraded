import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StackNavigator, UiHost } from '@zed/shared';
import { MsmeAppProvider } from '../src/app/context';
import { AppDrawerHost } from '../src/app/AppDrawer';
import type { MsmeApp } from '../src/app/MsmeApp';
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
    expect(pressable(r, 'incentive-kawach').props.disabled).toBe(false);
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
