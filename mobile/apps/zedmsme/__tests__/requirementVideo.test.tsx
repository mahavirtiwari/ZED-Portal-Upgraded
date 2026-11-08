import React from 'react';
import { Linking, ToastAndroid } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StackNavigator, UiHost, type SqlDb } from '@zed/shared';
import { MsmeAppProvider } from '../src/app/context';
import { AppDrawerHost, AppDrawerOverlay } from '../src/app/AppDrawer';
import type { MsmeApp } from '../src/app/MsmeApp';
import { RequirementVideoButton, requirementVideoUrl } from '../src/components/RequirementVideoButton';
import { certificationDetailsOf, type Requirement } from '../src/models';
import { SCREENS } from '../App';
import { FakeServer, makeApp } from './helpers/harness';
import { memoryDb } from './helpers/sqljs';
import { writeLegacyLoginRow, writeLegacyPhotoRows, ZED_ID } from './helpers/legacyFixture';

jest.useFakeTimers();
jest.setTimeout(60000);

const VIDEO = 'https://videos.example.org/leadership-1.mp4';

async function signedInApp(dbs?: { loginDb: SqlDb; mediaDb: SqlDb }) {
  let used = dbs;
  if (!used) {
    used = { loginDb: await memoryDb(), mediaDb: await memoryDb() };
    await writeLegacyLoginRow(used.loginDb, 'PW');
    await writeLegacyPhotoRows(used.mediaDb);
  }
  const { app, loginDb, mediaDb } = await makeApp(new FakeServer(), used);
  await app.offlineLogin(ZED_ID, 'PW');
  return { app, dbs: { loginDb, mediaDb } };
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

/** Lets the screens' connectivity check finish. */
const settle = () =>
  act(async () => {
    await Promise.resolve();
  });

/** The pressables with the testID. */
const pressables = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && typeof n.props.onPress === 'function');
const videoButtons = (r: ReactTestRenderer.ReactTestRenderer) => r.root.findAll(n => n.props.accessibilityLabel === 'Watch video' && typeof n.props.onPress === 'function');

const bronze = (app: MsmeApp) => certificationDetailsOf(app.user?.MsmeDetails?.msmeStatus, 'Bronze')!;

/** An active NC of the Bronze level: requirement 1 (with the video when given) and 2 (none). */
function withNc(app: MsmeApp, videoUrl?: string) {
  const r1: Requirement = { id: '9301', code: '1', options: [{ id: '1', code: '1', label: 'Roles are defined' }], assessorRemarks: 'missing' };
  if (videoUrl) r1.videoUrl = videoUrl;
  const r2: Requirement = { id: '9302', code: '2', options: [{ id: '2', code: '1', label: 'Policy is displayed' }] };
  bronze(app).activeNcDetails = { products: [], parameters: [{ id: '41', code: '1', label: 'Leadership', requirements: [r1, r2] }], sitePhotosSubmitted: true };
}

describe('Requirement video (2026-11-08)', () => {
  let openURL: jest.SpyInstance;
  beforeEach(() => {
    openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  });
  afterEach(() => openURL.mockRestore());

  it('certification requirements: the play button on the requirement with a video opens it; none on the others', async () => {
    const { app } = await signedInApp();
    const reqs = bronze(app).parameters![0]!.requirements!;
    reqs[0]!.options = [{ id: '1', code: '1', label: 'Roles are defined' }];
    reqs[0]!.videoUrl = VIDEO;
    reqs.push({ id: '9202', code: '2', options: [{ id: '2', code: '1', label: 'Policy is displayed' }] });
    const r = render(app, 'CertificationRequirements', { certificationType: 'Bronze' });
    const button = pressables(r, 'req-video-1');
    expect(button).toHaveLength(1);
    expect(button[0]!.props.accessibilityLabel).toBe('Watch video');
    expect(pressables(r, 'req-video-2')).toHaveLength(0);
    await act(async () => button[0]!.props.onPress());
    expect(openURL).toHaveBeenCalledWith(VIDEO);
  });

  it('certification requirements: no button without a video', async () => {
    const { app } = await signedInApp();
    bronze(app).parameters![0]!.requirements![0]!.options = [{ id: '1', code: '1', label: 'Roles are defined' }];
    const r = render(app, 'CertificationRequirements', { certificationType: 'Bronze' });
    expect(videoButtons(r)).toHaveLength(0);
  });

  it('documents upload: the evidences of a requirement with a video have the play button', async () => {
    const { app } = await signedInApp();
    bronze(app).parameters![0]!.requirements![0]!.videoUrl = VIDEO;
    const r = render(app, 'Evidences', { certificationType: 'Bronze' });
    await settle();
    const buttons = pressables(r, 'req-video-1');
    expect(buttons.length).toBe(bronze(app).parameters![0]!.requirements![0]!.evidences!.length);
    await act(async () => buttons[0]!.props.onPress());
    expect(openURL).toHaveBeenCalledWith(VIDEO);
  });

  it('documents upload: no button without a video', async () => {
    const { app } = await signedInApp();
    const r = render(app, 'Evidences', { certificationType: 'Bronze' });
    await settle();
    expect(videoButtons(r)).toHaveLength(0);
  });

  it('non-conformances: the requirement list and the requirement page show the button of the requirement with a video only', async () => {
    const { app } = await signedInApp();
    withNc(app, VIDEO);
    const list = render(app, 'NcDetails', { certificationType: 'Bronze', isSurveillance: false });
    expect(pressables(list, 'req-video-1')).toHaveLength(1);
    expect(pressables(list, 'req-video-2')).toHaveLength(0);
    await act(async () => pressables(list, 'req-video-1')[0]!.props.onPress());
    expect(openURL).toHaveBeenCalledWith(VIDEO);
    act(() => list.unmount());

    const page = render(app, 'NcRequirement', { certificationType: 'Bronze', isSurveillance: false, requirementId: '9301', elementName: 'Leadership', elementCode: '1' });
    expect(pressables(page, 'req-video-1')).toHaveLength(1);
    expect(pressables(page, 'req-video-1')[0]!.props.accessibilityLabel).toBe('Watch video');
    act(() => page.unmount());

    const other = render(app, 'NcRequirement', { certificationType: 'Bronze', isSurveillance: false, requirementId: '9302', elementName: 'Leadership', elementCode: '1' });
    expect(videoButtons(other)).toHaveLength(0);
  });

  it('non-conformances without videos: no button', async () => {
    const { app } = await signedInApp();
    withNc(app);
    const r = render(app, 'NcDetails', { certificationType: 'Bronze', isSurveillance: false });
    expect(videoButtons(r)).toHaveLength(0);
  });

  it('only web addresses open; a failure shows a toast', async () => {
    expect(requirementVideoUrl(' https://x.org/v ')).toBe('https://x.org/v');
    expect(requirementVideoUrl('javascript:alert(1)')).toBeNull();
    expect(requirementVideoUrl('content://x/v.mp4')).toBeNull();
    expect(requirementVideoUrl(null)).toBeNull();
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      r = ReactTestRenderer.create(
        <UiHost>
          <RequirementVideoButton url="javascript:alert(1)" code="a" />
          <RequirementVideoButton url={VIDEO} code="b" />
        </UiHost>,
      );
    });
    expect(pressables(r, 'req-video-a')).toHaveLength(0);
    const toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => undefined);
    openURL.mockRejectedValueOnce(new Error('no app'));
    await act(async () => pressables(r, 'req-video-b')[0]!.props.onPress());
    expect(toast).toHaveBeenCalledWith('The video could not be opened.', ToastAndroid.SHORT);
    toast.mockRestore();
  });

  it('the video survives the offline copy on the phone (saved and read back at the next sign-in)', async () => {
    const { app, dbs } = await signedInApp();
    bronze(app).parameters![0]!.requirements![0]!.videoUrl = VIDEO;
    await app.persist();
    const { app: again } = await signedInApp(dbs);
    expect(bronze(again).parameters![0]!.requirements![0]!.videoUrl).toBe(VIDEO);
  });
});
