import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StackNavigator, UiHost, type SqlDb } from '@zed/shared';
import { MsmeAppProvider } from '../src/app/context';
import { AppDrawerHost, AppDrawerOverlay } from '../src/app/AppDrawer';
import type { MsmeApp } from '../src/app/MsmeApp';
import { certificationDetailsOf, ncFieldValue, normalizeNcDetails, type NcDetails } from '../src/models';
import { SCREENS } from '../App';
import { FakeServer, makeApp } from './helpers/harness';
import { memoryDb } from './helpers/sqljs';
import { writeLegacyLoginRow, writeLegacyPhotoRows, ZED_ID } from './helpers/legacyFixture';

jest.useFakeTimers();
jest.setTimeout(60000);

/** V4 (migration 0080): NCs on the Admin's "Validation required" Basic Information fields. */
async function signedInApp(server: FakeServer) {
  const dbs: { loginDb: SqlDb; mediaDb: SqlDb } = { loginDb: await memoryDb(), mediaDb: await memoryDb() };
  await writeLegacyLoginRow(dbs.loginDb, 'PW');
  await writeLegacyPhotoRows(dbs.mediaDb);
  const { app } = await makeApp(server, dbs);
  await app.offlineLogin(ZED_ID, 'PW');
  return app;
}

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

const settle = () =>
  act(async () => {
    await Promise.resolve();
  });

const byTestId = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && typeof n.props.onPress === 'function');
const bronze = (app: MsmeApp) => certificationDetailsOf(app.user?.MsmeDetails?.msmeStatus, 'Bronze')!;

function withFieldNc(app: MsmeApp, answered = false) {
  const nc: NcDetails = normalizeNcDetails({
    products: [],
    parameters: [],
    sitePhotosSubmitted: true,
    formFields: [
      {
        form: 'msme.basicInfo',
        key: 'cf_pollution_consent',
        label: 'Pollution consent valid till',
        type: 'text',
        assessorRemarks: 'Consent has expired',
        previousValue: '2024-03-31',
        value: answered ? '2027-03-31' : null,
        answered,
      },
    ],
  });
  bronze(app).activeNcDetails = nc;
  return nc;
}

describe('NCs on Basic Information fields (Validation required)', () => {
  it('lists the field under Basic Information; Close is offered only once it is answered', async () => {
    const app = await signedInApp(new FakeServer());
    withFieldNc(app);
    const r = render(app, 'NcDetails', { certificationType: 'Bronze' });
    expect(byTestId(r, 'nc-field-cf_pollution_consent').length).toBeGreaterThan(0);
    expect(byTestId(r, 'nc-close')).toHaveLength(0);

    withFieldNc(app, true);
    const answered = render(app, 'NcDetails', { certificationType: 'Bronze' });
    expect(byTestId(answered, 'nc-close').length).toBeGreaterThan(0);
  });

  it('sends the new answer to SubmitNcFormField and marks the NC answered', async () => {
    const server = new FakeServer();
    const app = await signedInApp(server);
    const nc = withFieldNc(app);
    const r = render(app, 'NcFormField', { certificationType: 'Bronze', form: 'msme.basicInfo', fieldKey: 'cf_pollution_consent' });
    await settle();
    const input = r.root.findAll(n => n.props.testID === 'nc-field-input' && typeof n.props.onChange === 'function')[0]!;
    act(() => input.props.onChange('2027-03-31'));
    await act(async () => byTestId(r, 'nc-submit')[0]!.props.onPress());
    await settle();

    const sent = server.last('SubmitNcFormField')!;
    expect(sent.json).toMatchObject({ userName: ZED_ID, certificationType: 'Bronze', form: 'msme.basicInfo', key: 'cf_pollution_consent', value: '2027-03-31' });
    expect(nc.formFields![0]!.answered).toBe(true);
    expect(nc.formFields![0]!.value).toBe('2027-03-31');
  });

  it('does not send an empty answer', async () => {
    const server = new FakeServer();
    const app = await signedInApp(server);
    withFieldNc(app);
    const r = render(app, 'NcFormField', { certificationType: 'Bronze', form: 'msme.basicInfo', fieldKey: 'cf_pollution_consent' });
    await settle();
    await act(async () => byTestId(r, 'nc-submit')[0]!.props.onPress());
    await settle();
    expect(server.last('SubmitNcFormField')).toBeUndefined();
  });

  it('shows several stored choices as a list', () => {
    expect(ncFieldValue({ form: 'f', key: 'k', label: 'L', type: 'checkboxes', value: '["Solar","Wind"]', answered: true })).toEqual(['Solar', 'Wind']);
    expect(ncFieldValue({ form: 'f', key: 'k', label: 'L', type: 'text', value: 'x', answered: true })).toBe('x');
  });
});
