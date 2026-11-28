import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppTexts, StackNavigator, UiHost } from '@zed/shared';
import { SCREENS } from '../App';
import { SaAppProvider } from '../src/app/context';
import type { SaApp } from '../src/app/SaApp';
import { BUILT_IN_TEXTS } from '../src/content/builtInTexts';
import { submitSiteTour } from '../src/flows/submissions';
import { EVIDENCE_SITE_TOUR, type AssessmentDetails, type PhotoInformation } from '../src/models';
import { encodeTourComment, sectionsOf, tourCounts, tourMissingMessage } from '../src/siteTour';
import { FakeServer, makeApp } from './helpers/harness';
import { loginAnswer, SA_ID, ZED_ID } from './helpers/fixtures';

jest.setTimeout(60000);

// 2026-11-28: a site tour of two sections was accepted; every section must have its photos first (milestone 1).

const SECTIONS = [
  { id: 'gate', no: 1, title: 'Gate', hint: 'Name board', min: 1, max: 2, uploaded: 0 },
  { id: 'forge', no: 2, title: 'Forge shop', hint: 'Furnaces', min: 2, max: 3, uploaded: 1 },
  { id: 'store', no: 3, title: 'Store', hint: 'Racks', min: 2, max: 3, uploaded: 0 },
];
/** A copy per unit. */
const fresh = () => SECTIONS.map(s => ({ ...s }));

describe('site tour: every section before it is submitted', () => {
  it('names every section short of its minimum (the team uploaded ones counted)', () => {
    const sections = sectionsOf({ siteTourSections: fresh() });
    const local: PhotoInformation[] = [{ photoId: 'a', type: EVIDENCE_SITE_TOUR, comment: '[Gate] board' }];
    const texts = new AppTexts(null, BUILT_IN_TEXTS);
    expect(tourMissingMessage(texts, sections, tourCounts(sections, local, false))).toBe(
      'Site Tour cannot be submitted yet: every section needs its photos. Please capture: "Forge shop" (1 of 2 photos), "Store" (0 of 2 photos).',
    );
    expect(tourMissingMessage(texts, sections, { gate: 1, forge: 2, store: 2 })).toBeNull();
  });

  it('sends the whole tour with every chunk of three', async () => {
    const server = new FakeServer();
    const { app } = await makeApp(server);
    await app.saveDetails(loginAnswer({ siteTourSections: fresh() } as Partial<AssessmentDetails>), SA_ID, ZED_ID);
    const sections = sectionsOf(app.details);
    const photos: PhotoInformation[] = ['1', '2', '3', '4'].map(id => ({
      photoId: `u_${id}`, evidenceId: SA_ID + id, photo: 'B64', type: EVIDENCE_SITE_TOUR, comment: encodeTourComment(sections, 'store', id),
    }));
    expect(await submitSiteTour(app, photos)).toMatchObject({ status: '1' });
    const list = photos.map(p => ({ photoId: p.photoId, section: 'store' }));
    expect(server.requests.map(q => q.json!.siteTour)).toEqual([list, list]);
  });
});

function render(app: SaApp, name: string) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <UiHost>
        <SaAppProvider app={app}>
          <StackNavigator screens={SCREENS} initial={{ name }} />
        </SaAppProvider>
      </UiHost>,
    );
  });
  return r;
}

const handler = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && typeof n.props.onPress === 'function')[0]!;
const flush = () => act(async () => new Promise<void>(resolve => setTimeout(resolve, 0)));

async function twoSectionTour(over: Partial<AssessmentDetails>) {
  const server = new FakeServer();
  const { app } = await makeApp(server);
  await app.saveDetails(loginAnswer({ siteTourSections: fresh(), ...over } as Partial<AssessmentDetails>), SA_ID, ZED_ID);
  app.details!.isOpenMeetingSubmitted = true;
  const sections = sectionsOf(app.details);
  await app.store.saveEvidence(app.userId, { photoId: 'p1', evidenceId: 'e1', photo: 'AAAA', type: EVIDENCE_SITE_TOUR, comment: encodeTourComment(sections, 'gate', 'board') });
  await app.store.saveEvidence(app.userId, { photoId: 'p2', evidenceId: 'e2', photo: 'BBBB', type: EVIDENCE_SITE_TOUR, comment: encodeTourComment(sections, 'forge', 'press') });
  return { app, server };
}

async function syncSiteTour(app: SaApp) {
  const r = render(app, 'SubmitParameters');
  await flush();
  await act(async () => handler(r, 'sync-siteTour').props.onPress());
  await flush();
}

const tourCalls = (server: FakeServer) => server.requests.filter(q => q.url.endsWith('SubmitSiteTour'));

describe('Sync → Site Tour', () => {
  it('the lead consultant cannot submit a milestone 1 site tour that leaves out a section; the missing ones are named', async () => {
    const { app, server } = await twoSectionTour({ userType: 1, milestone: 1 });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await syncSiteTour(app);
    expect(alert).toHaveBeenLastCalledWith(
      '',
      'Site Tour cannot be submitted yet: every section needs its photos. Please capture: "Store" (0 of 2 photos).',
      expect.anything(),
      expect.anything(),
    );
    expect(tourCalls(server)).toHaveLength(0);
    expect(app.details!.isSiteTourSubmitted).toBe(false);
    alert.mockRestore();
  });

  it('the co-consultant photos join the team tour without that check', async () => {
    const { app, server } = await twoSectionTour({ userType: 2, milestone: 1 });
    await syncSiteTour(app);
    expect(tourCalls(server)).toHaveLength(1);
    expect(tourCalls(server)[0]!.json!.siteTour).toEqual([{ photoId: 'p1', section: 'gate' }, { photoId: 'p2', section: 'forge' }]);
    expect(app.details!.isSiteTourSubmitted).toBe(true);
  });
});
