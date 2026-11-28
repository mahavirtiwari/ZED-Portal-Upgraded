import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StackNavigator, UiHost, type FormDefinition } from '@zed/shared';
import { SCREENS } from '../App';
import { AppDrawerHost, AppDrawerOverlay } from '../src/app/AppDrawer';
import { MsmeAppProvider } from '../src/app/context';
import type { MsmeApp } from '../src/app/MsmeApp';
import { BUILT_IN_REMOTE_ASSESSMENT, MSME_REMOTE_ASSESSMENT } from '../src/forms';
import { FakeServer, makeApp, type SentRequest } from './helpers/harness';
import { legacyPhoto, writeLegacyLoginRow, writeLegacyPhotoRows, ZED_ID } from './helpers/legacyFixture';
import { memoryDb } from './helpers/sqljs';

jest.useFakeTimers();
jest.setTimeout(60000);

/**
 * 2026-11-28 (the owner: the representative selfie belongs to App Forms): the Remote Assessment screen is the Admin's form
 * msme.remoteAssessment. Here the Admin renamed the selfie, switched the designation off and added a mobile number.
 */
const SERVER_FORM: FormDefinition = {
  ...BUILT_IN_REMOTE_ASSESSMENT,
  status: '1',
  fields: [
    ...BUILT_IN_REMOTE_ASSESSMENT.fields
      .filter(f => f.key !== 'representativeDesignation')
      .map(f => (f.key === 'representativeSelfie' ? { ...f, label: 'Selfie of the representative at the plant', help: 'Face and plant board visible.' } : f)),
    { key: 'cf_mobile', label: 'Representative mobile', type: 'text', required: true, custom: true, section: 'remote', order: 15 },
  ],
  version: '7a7a7a7a7a7a7a7a',
};

const responder = (req: SentRequest) => (req.url.includes(`/Forms/Definition?form=${MSME_REMOTE_ASSESSMENT}`) ? SERVER_FORM : { status: '1' });

async function signedInApp() {
  const server = new FakeServer(responder);
  const loginDb = await memoryDb();
  const mediaDb = await memoryDb();
  await writeLegacyLoginRow(loginDb, 'PW');
  await writeLegacyPhotoRows(mediaDb);
  const { app } = await makeApp(server, { loginDb, mediaDb });
  await app.offlineLogin(ZED_ID, 'PW');
  return { app, server };
}

function render(app: MsmeApp) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <UiHost>
        <MsmeAppProvider app={app}>
          <AppDrawerHost>
            <StackNavigator screens={SCREENS} initial={{ name: 'RemoteAssessmentDetails', params: { certificationType: 'Bronze' } }} overlay={<AppDrawerOverlay />} />
          </AppDrawerHost>
        </MsmeAppProvider>
      </UiHost>,
    );
  });
  return r;
}

const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root
    .findAll(n => (n.type as unknown) === 'Text')
    .map(n => (Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '')));
const press = async (r: ReactTestRenderer.ReactTestRenderer, id: string) => {
  const button = r.root.findAll(n => n.props.testID === id && typeof n.props.onPress === 'function')[0]!;
  await act(async () => {
    await button.props.onPress();
  });
};

describe('Remote Assessment from Admin → App Forms', () => {
  it('the built-in form has the four legacy fields, all required', () => {
    expect(BUILT_IN_REMOTE_ASSESSMENT.fields.map(f => [f.key, f.type, f.required])).toEqual([
      ['representativeName', 'text', true],
      ['representativeDesignation', 'text', true],
      ['representativeSelfie', 'photo', true],
      ['siteExteriorPhoto', 'photo', true],
    ]);
  });

  it('shows the Admin form, requires its fields, then sends the answers with the form version', async () => {
    const { app, server } = await signedInApp();
    await app.refreshServerContent();
    const r = render(app);
    await act(async () => {
      await Promise.resolve();
    });
    const t = texts(r);
    expect(t).toEqual(expect.arrayContaining(['Selfie of the representative at the plant', 'Face and plant board visible.', 'Representative mobile']));
    expect(t).not.toContain('Representative Designation');

    // Nothing filled in: nothing is sent.
    await press(r, 'remote-submit-selfie');
    expect(server.last('SubmitSelfie')).toBeUndefined();

    const data = app.user!.remoteAssessmentData;
    data.representativeName = 'R. Kumar';
    data.representativeDesignation = 'Typed before the Admin switched it off';
    data.selfie = legacyPhoto('ZEDRNTEST00011700000000001', 'a1.jpg');
    data.siteExteriorPhoto = legacyPhoto('ZEDRNTEST00011700000000002', 'a2.jpg');
    data.customAnswers = { cf_mobile: '9876543210' };
    await press(r, 'remote-submit-selfie');

    const sent = server.last('SubmitSelfie')!.json!;
    expect(sent).toMatchObject({ certificationType: 'Bronze', representativeName: 'R. Kumar', formVersion: '7a7a7a7a7a7a7a7a', customFields: { cf_mobile: '9876543210' } });
    expect(sent.representativeDesignation ?? null).toBeNull(); // switched off by the Admin: not sent
    expect((sent.photo as { photoId: string; photo: string | null }).photoId).toBe('ZEDRNTEST00011700000000001');
    expect((sent.photo as { photo: string | null }).photo).toBeTruthy();
    expect((sent.siteExteriorPhoto as { photoId: string }).photoId).toBe('ZEDRNTEST00011700000000002');
    expect(data.isSelfieSubmitted).toBe(true);
    expect(texts(r)).toContain('Remote assessment details submitted.');
  });
});
