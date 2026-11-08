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
import { loginAnswer, SA_ID, ZED_ID } from './helpers/fixtures';

jest.setTimeout(60000);

const VIDEO = 'https://videos.example.org/req-2-1.mp4';

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
  const answer = loginAnswer();
  const req = answer.allottedParameters!.find(p => p.parameterId === '9102')!.requirements![0]!;
  if (videoUrl) req.videoUrl = videoUrl;
  const { app } = await makeApp(new FakeServer());
  await app.saveDetails(answer, SA_ID, ZED_ID);
  return app;
}

describe('Requirement video (2026-11-08)', () => {
  let openURL: jest.SpyInstance;
  beforeEach(() => {
    openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  });
  afterEach(() => openURL.mockRestore());

  it('the question page shows the play button next to the requirement and opens the video', async () => {
    const app = await appWith(VIDEO);
    const r = render(app, 'QuestionsPager', { parameterId: '9102', parameterName: 'Test Parameter Two' });
    const button = pressables(r, 'req-video-2.1');
    expect(button).toHaveLength(1);
    expect(button[0]!.props.accessibilityLabel).toBe('Watch video');
    await act(async () => button[0]!.props.onPress());
    expect(openURL).toHaveBeenCalledWith(VIDEO);
  });

  it('no button without a video', async () => {
    const app = await appWith();
    const r = render(app, 'QuestionsPager', { parameterId: '9102', parameterName: 'Test Parameter Two' });
    expect(pressables(r, 'req-video-2.1')).toHaveLength(0);
    expect(r.root.findAll(n => n.props.accessibilityLabel === 'Watch video')).toHaveLength(0);
  });

  it('only web addresses open; a failure shows a toast', async () => {
    expect(requirementVideoUrl('  https://x.org/v  ')).toBe('https://x.org/v');
    expect(requirementVideoUrl('http://x.org/v')).toBe('http://x.org/v');
    expect(requirementVideoUrl('javascript:alert(1)')).toBeNull();
    expect(requirementVideoUrl('file:///sdcard/v.mp4')).toBeNull();
    expect(requirementVideoUrl('')).toBeNull();
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
    expect(openURL).toHaveBeenCalledWith(VIDEO);
    expect(toast).toHaveBeenCalledWith('The video could not be opened.', ToastAndroid.SHORT);
    toast.mockRestore();
  });

  it('a fresh sign-in brings the videos to an assessment already on the phone, keeping the answers', () => {
    const kept = loginAnswer();
    const req = kept.allottedParameters!.find(p => p.parameterId === '9102')!.requirements![0]!;
    req.conformance = 'Yes';
    const fresh = loginAnswer();
    fresh.allottedParameters!.find(p => p.parameterId === '9102')!.requirements![0]!.videoUrl = VIDEO;
    for (const p of fresh.allottedParameters ?? []) for (const q of p.requirements ?? []) q.id = String(q.id);
    for (const p of kept.allottedParameters ?? []) for (const q of p.requirements ?? []) q.id = String(q.id);
    mergeRequirementVideos(kept, fresh);
    expect(req).toMatchObject({ conformance: 'Yes', videoUrl: VIDEO });
    // Removed by the Admin: gone on the next sign-in.
    mergeRequirementVideos(kept, loginAnswer());
    expect(req.videoUrl).toBeUndefined();
  });
});
