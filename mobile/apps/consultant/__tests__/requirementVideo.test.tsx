import React from 'react';
import { Linking, ToastAndroid } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StackNavigator, UiHost } from '@zed/shared';
import { SCREENS } from '../App';
import { SaAppProvider } from '../src/app/context';
import type { SaApp } from '../src/app/SaApp';
import { RequirementVideoButton, requirementVideoUrl } from '../src/components/RequirementVideoButton';
import { mergeRequirementVideos } from '../src/models';
import { FakeServer, makeApp } from './helpers/harness';
import { newAttendance } from '../src/attendance';
import { loginAnswer, SA_ID, ZED_ID } from './helpers/fixtures';

jest.setTimeout(60000);

const VIDEO = 'https://videos.example.org/req-r3.mp4';

function render(app: SaApp, name: string, params?: Record<string, unknown>) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <UiHost>
        <SaAppProvider app={app}>
          <StackNavigator screens={SCREENS} initial={{ name, params }} />
        </SaAppProvider>
      </UiHost>,
    );
  });
  return r;
}

const pressables = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && typeof n.props.onPress === 'function');

async function appWith(videoUrl?: string) {
  const answer = loginAnswer({ isOpenMeetingSubmitted: true });
  const req = answer.allottedParameters![1]!.requirements![0]!;
  if (videoUrl) req.videoUrl = videoUrl;
  const { app } = await makeApp(new FakeServer());
  await app.saveDetails(answer, SA_ID, ZED_ID);
  app.details!.attendanceData!.attendanceList.push(newAttendance(null, null, 'LOGIN'));
  return app;
}

describe('Requirement video (2026-11-08)', () => {
  let openURL: jest.SpyInstance;
  beforeEach(() => {
    openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  });
  afterEach(() => openURL.mockRestore());

  it('the requirement page shows the play button next to the requirement and opens the video', async () => {
    const app = await appWith(VIDEO);
    const r = render(app, 'Module', { module: 'baselineDiagnostic' });
    await act(async () => pressables(r, 'module-param-1')[0]!.props.onPress());
    const button = pressables(r, 'req-video-R3');
    expect(button).toHaveLength(1);
    expect(button[0]!.props.accessibilityLabel).toBe('Watch video');
    await act(async () => button[0]!.props.onPress());
    expect(openURL).toHaveBeenCalledWith(VIDEO);
  });

  it('no button without a video', async () => {
    const app = await appWith();
    const r = render(app, 'Module', { module: 'baselineDiagnostic' });
    await act(async () => pressables(r, 'module-param-1')[0]!.props.onPress());
    expect(pressables(r, 'req-video-R3')).toHaveLength(0);
    expect(r.root.findAll(n => n.props.accessibilityLabel === 'Watch video')).toHaveLength(0);
  });

  it('only web addresses open; a failure shows a toast', async () => {
    expect(requirementVideoUrl('  https://x.org/v  ')).toBe('https://x.org/v');
    expect(requirementVideoUrl('javascript:alert(1)')).toBeNull();
    expect(requirementVideoUrl(undefined)).toBeNull();
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      r = ReactTestRenderer.create(
        <UiHost>
          <RequirementVideoButton url="intent://x" code="a" />
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

  it('a fresh sign-in brings the videos to the consultancy on the phone and the copies of the screens, keeping the answers', async () => {
    const app = await appWith();
    const d = app.details!;
    d.baselineDiagnosticStudyData = { status: 'TO_START' as never, parameters: JSON.parse(JSON.stringify(d.allottedParameters)) };
    const copy = d.baselineDiagnosticStudyData.parameters[1]!.requirements![0]!;
    copy.conformance = 'Yes';
    const fresh = loginAnswer();
    fresh.allottedParameters![1]!.requirements![0]!.videoUrl = VIDEO;
    for (const p of fresh.allottedParameters ?? []) for (const q of p.requirements ?? []) q.id = String(q.id);
    mergeRequirementVideos(d, fresh);
    expect(d.allottedParameters![1]!.requirements![0]!.videoUrl).toBe(VIDEO);
    expect(copy).toMatchObject({ conformance: 'Yes', videoUrl: VIDEO });
    const removed = loginAnswer();
    for (const p of removed.allottedParameters ?? []) for (const q of p.requirements ?? []) q.id = String(q.id);
    mergeRequirementVideos(d, removed);
    expect(copy.videoUrl).toBeUndefined();
  });
});
