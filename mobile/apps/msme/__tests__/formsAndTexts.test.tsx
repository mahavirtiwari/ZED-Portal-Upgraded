import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import NetInfo from '@react-native-community/netinfo';
import { StackNavigator, UiHost, type FormDefinition } from '@zed/shared';
import { SCREENS } from '../App';
import { AppDrawerHost, AppDrawerOverlay } from '../src/app/AppDrawer';
import { MsmeAppProvider } from '../src/app/context';
import type { MsmeApp } from '../src/app/MsmeApp';
import { BUILT_IN_BASIC_INFO, stampFormAnswers, validateBasicInformation } from '../src/forms';
import { basicInformationIsValid, certificationDetailsOf, type BasicInformation } from '../src/models';
import { submitBasicInformation } from '../src/sync/submissions';
import { FakeServer, makeApp, type SentRequest } from './helpers/harness';
import { legacyPhoto, writeLegacyLoginRow, writeLegacyPhotoRows, ZED_ID } from './helpers/legacyFixture';
import { memoryDb } from './helpers/sqljs';

jest.useFakeTimers();
jest.setTimeout(60000);

/** The server's form with an Admin change: a custom GST field, outsourced processes disabled, audits relabelled. */
const SERVER_FORM: FormDefinition = {
  ...BUILT_IN_BASIC_INFO,
  status: '1',
  sections: [{ key: 'basic', label: 'Basic Information' }],
  fields: [
    ...BUILT_IN_BASIC_INFO.fields
      .filter(f => f.key !== 'outsourcedProcesses')
      .map(f => (f.key === 'auditsConducted' ? { ...f, label: 'Are 3rd party financial audits done?', help: 'Statutory audit counts.' } : f)),
    { key: 'cf_gst', label: 'GST number', help: 'As on the GST certificate', type: 'text', required: true, custom: true, section: 'basic', order: 35 },
  ],
  version: '3f9c0a1b2d4e5f60',
};

const TEXTS = {
  status: '1',
  texts: [
    { key: 'app.msme.offline.note', enabled: true, html: 'Admin: you are offline.' },
    { key: 'app.msme.evidences.finalSubmit.confirm', enabled: true, html: 'Admin: I confirm the unit.' },
    { key: 'app.msme.nc.whatIsNc', enabled: false, html: '<p>x</p>' },
  ],
};

const responder = (req: SentRequest) =>
  req.url.endsWith('/Content/Texts') ? TEXTS : req.url.includes('/Forms/Definition?form=msme.basicInfo') ? SERVER_FORM : { status: '1' };

async function signedInApp(server = new FakeServer(responder)) {
  const loginDb = await memoryDb();
  const mediaDb = await memoryDb();
  await writeLegacyLoginRow(loginDb, 'PW');
  await writeLegacyPhotoRows(mediaDb);
  const { app } = await makeApp(server, { loginDb, mediaDb });
  await app.offlineLogin(ZED_ID, 'PW');
  return { app, server, loginDb, mediaDb };
}

const info = (app: MsmeApp): BasicInformation => certificationDetailsOf(app.user?.MsmeDetails?.msmeStatus, 'Bronze')!.basicInformation!;

function render(app: MsmeApp, name: string, params?: Record<string, unknown>) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <UiHost>
        <MsmeAppProvider app={app}>
          <AppDrawerHost>
            <StackNavigator screens={SCREENS} initial={{ name, params }} overlay={<AppDrawerOverlay />} />
          </AppDrawerHost>
        </MsmeAppProvider>
      </UiHost>,
    );
  });
  return r;
}

const byTestId = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && typeof n.type === 'string');
const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root
    .findAll(n => (n.type as unknown) === 'Text')
    .map(n => (Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '')));

describe('server content (Content/Texts, Forms/Definition)', () => {
  it('asks the surveillance host for the texts and the form and keeps them for offline use', async () => {
    const { app, server, loginDb } = await signedInApp();
    await app.refreshServerContent();
    expect(server.requests.map(r => r.url).sort()).toEqual([
      'http://10.0.2.2:5106/surveillancemobileapi/Content/Texts',
      'http://10.0.2.2:5106/surveillancemobileapi/Forms/Definition?form=msme.basicInfo',
    ]);
    expect(app.texts.get('app.msme.offline.note')!.html).toBe('Admin: you are offline.');
    expect(app.forms.get('msme.basicInfo').version).toBe('3f9c0a1b2d4e5f60');

    // Next start without a network: the kept answers are used.
    const offline = new FakeServer();
    offline.online = false;
    const { app: again } = await makeApp(offline, { loginDb, mediaDb: await memoryDb() });
    await again.refreshServerContent();
    expect(again.texts.get('app.msme.evidences.finalSubmit.confirm')!.html).toBe('Admin: I confirm the unit.');
    expect(again.forms.get('msme.basicInfo').fields.some(f => f.key === 'cf_gst')).toBe(true);
  });

  it('falls back to the legacy wording and the built-in form before any answer', async () => {
    const { app } = await signedInApp(new FakeServer(() => ({ status: '0' })));
    await app.refreshServerContent();
    expect(app.texts.get('app.msme.certification.readOnly')!.html).toBe('To view Basic Information &amp; Documents uploaded, please login through the web module.');
    expect(app.forms.get('msme.basicInfo')).toBe(BUILT_IN_BASIC_INFO);
  });
});

describe('Basic Information from the definition', () => {
  it('shows the Admin form: labels, help, custom fields; disabled fields are gone', async () => {
    const { app } = await signedInApp();
    await app.refreshServerContent();
    const r = render(app, 'BasicInformation', { certificationType: 'Bronze' });
    await act(async () => {
      await Promise.resolve();
    });
    const t = texts(r);
    expect(t).toEqual(expect.arrayContaining(['Basic Information', 'Are 3rd party financial audits done?', 'Statutory audit counts.', 'GST number', 'As on the GST certificate']));
    expect(t).not.toContain('Processes Outsourced, if any');
    expect(byTestId(r, 'outsourced')).toHaveLength(0);
    expect(byTestId(r, 'field-cf_gst')).toHaveLength(1);
  });

  it('requires the custom field, then submits customFields and formVersion and leaves the disabled field out', async () => {
    const { app, server } = await signedInApp();
    await app.refreshServerContent();
    const def = app.forms.get('msme.basicInfo');
    const b = info(app);
    b.outsourcedProcesses = 'Painting'; // entered before the Admin disabled the field
    b.productDetailsList = [
      { id: 'u1', productName: 'Widget', exported: 'No', productPhoto: legacyPhoto('ZEDRNTEST00011700000000003', 'e1.jpg'), productDescriptionPhoto: legacyPhoto('ZEDRNTEST00011700000000004', 'e2.jpg') },
    ];
    expect(validateBasicInformation(def, b).get('cf_gst')).toBe('Required');
    b.customAnswers = { cf_gst: '09ABCDE1234F1Z5' };
    expect([...validateBasicInformation(def, b)]).toEqual([]);
    stampFormAnswers(def, b);

    const res = await submitBasicInformation(app, 'Bronze', b);
    expect(res.status).toBe('1');
    const sent = server.last('SubmitBasicInformation')!.json!;
    expect(sent.formVersion).toBe('3f9c0a1b2d4e5f60');
    expect(sent.customFields).toEqual({ cf_gst: '09ABCDE1234F1Z5' });
    const basic = sent.basicInformation as Record<string, unknown>;
    expect(basic.outsourcedProcesses).toBeUndefined(); // null is not sent (legacy Gson)
    for (const k of ['customAnswers', 'customFields', 'formVersion', 'omittedFields', 'optionalFields']) expect(basic[k]).toBeUndefined();
  });

  it('an Admin who disables the selfie no longer gets "Assessor Selfie Missing"', async () => {
    const { app, server } = await signedInApp();
    const def = { ...SERVER_FORM, fields: SERVER_FORM.fields.filter(f => f.key !== 'assessorSelfie') };
    const b = info(app);
    b.assessorSelfie = null;
    b.customAnswers = { cf_gst: 'X' };
    stampFormAnswers(def, b);
    expect((await submitBasicInformation(app, 'Bronze', b)).status).toBe('1');
    expect((server.last('SubmitBasicInformation')!.json!.basicInformation as Record<string, unknown>).assessorSelfie).toBeUndefined();
    // The built-in rules still ask for it.
    expect(basicInformationIsValid(b)).toBe(false);
  });
});

describe('Admin texts on the screens', () => {
  it('the final submit confirmation and the offline banner use the Admin wording', async () => {
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: false });
    const { app } = await signedInApp();
    await app.texts.refresh(async () => TEXTS);
    const r = render(app, 'Evidences', { certificationType: 'Bronze' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(texts(r)).toContain('Admin: you are offline.');
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true });
  });

  it('a text the Admin switched off is not shown', async () => {
    const { app } = await signedInApp();
    await app.texts.refresh(async () => TEXTS);
    const c = certificationDetailsOf(app.user?.MsmeDetails?.msmeStatus, 'Bronze')!;
    c.nc1Status = 1;
    const r = render(app, 'NonConformances', { certificationType: 'Bronze', isSurveillance: false });
    await act(async () => {
      await Promise.resolve();
    });
    expect(byTestId(r, 'non-conformances')).toHaveLength(1);
    expect(byTestId(r, 'what-is-nc')).toHaveLength(0);
  });
});
