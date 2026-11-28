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
import { encodeTourComment, sectionsOf, tourCounts, tourMissing, tourMissingMessage } from '../src/siteTour';
import { FakeServer, makeApp } from './helpers/harness';
import { loginAnswer, SA_ID, ZED_ID } from './helpers/fixtures';

jest.setTimeout(60000);

// 2026-11-28: the owner's site tour of two sections was accepted; every section must have its photos first.

const SECTIONS = [
  { id: 'gate', no: 1, title: 'Gate', hint: 'Name board', min: 1, max: 2, uploaded: 0 },
  { id: 'forge', no: 2, title: 'Forge & Press', hint: 'Furnaces', min: 2, max: 3, uploaded: 1 },
  { id: 'store', no: 3, title: 'Store', hint: 'Racks', min: 2, max: 3, uploaded: 0 },
];
/** A copy per unit: a submitted tour adds its photos to the sections' uploaded counts. */
const fresh = () => SECTIONS.map(s => ({ ...s }));

describe('site tour: every section before it is submitted', () => {
  const sections = sectionsOf({ siteTourSections: SECTIONS });
  const builtIn = new AppTexts(null, BUILT_IN_TEXTS);

  it('names every section short of its minimum, with what it has (the team uploaded ones counted)', () => {
    const local: PhotoInformation[] = [{ photoId: 'a', type: EVIDENCE_SITE_TOUR, comment: '[Gate] board' }];
    const counts = tourCounts(sections, local, false);
    expect(tourMissing(sections, counts).map(m => [m.section.key, m.count])).toEqual([['forge', 1], ['store', 0]]);
    expect(tourMissingMessage(builtIn, sections, counts)).toBe(
      'Site Tour cannot be submitted yet: every section needs its photos. Please capture: "Forge & Press" (1 of 2 photos), "Store" (0 of 2 photos).',
    );
    expect(tourMissingMessage(builtIn, sections, { gate: 1, forge: 2, store: 2 })).toBeNull();
  });

  it('uses the Admin wording, and the standard one when the Admin switched it off', () => {
    const texts = new AppTexts(null, BUILT_IN_TEXTS);
    // Admin → Texts answers (the cached answer is read through take(); refresh is the app's way in).
    return texts
      .refresh(async () => ({
        status: '1',
        texts: [
          { key: 'app.assessor.siteTour.missing', enabled: true, html: '<p>Capture first: {{Sections}}</p>' },
          { key: 'app.assessor.siteTour.missingSection', enabled: false, html: 'x' },
        ],
      }))
      .then(() => {
        expect(tourMissingMessage(texts, sections, { gate: 1, forge: 2, store: 0 })).toBe('Capture first: "Store" (0 of 2 photos)');
      });
  });

  it('sends the whole tour (each photo id and section) with every chunk of three', async () => {
    const server = new FakeServer();
    const { app } = await makeApp(server);
    await app.saveDetails(loginAnswer({ siteTourSections: fresh() } as Partial<AssessmentDetails>), SA_ID, ZED_ID);
    const photos: PhotoInformation[] = ['1', '2', '3', '4'].map((id, i) => ({
      photoId: `u_${id}`, evidenceId: SA_ID + id, photo: 'B64', type: EVIDENCE_SITE_TOUR,
      comment: i === 3 ? 'no section' : encodeTourComment(sections, i === 0 ? 'gate' : 'store', 'x'),
    }));
    expect(await submitSiteTour(app, photos)).toMatchObject({ status: '1' });
    const list = [
      { photoId: 'u_1', section: 'gate' }, { photoId: 'u_2', section: 'store' }, { photoId: 'u_3', section: 'store' },
      // No section: sent without it (nulls are left out of the request).
      { photoId: 'u_4' },
    ];
    expect(server.requests.map(q => q.json!.siteTour)).toEqual([list, list]);
    expect(server.requests.map(q => (q.json!.siteTourPhotos as unknown[]).length)).toEqual([3, 1]);
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

/** A unit whose phone has site tour photos of two of the three sections, the opening meeting synced. */
async function twoSectionTour(userType: number) {
  const server = new FakeServer();
  const { app } = await makeApp(server);
  await app.saveDetails(loginAnswer({ siteTourSections: fresh(), userType } as Partial<AssessmentDetails>), SA_ID, ZED_ID);
  app.details!.isOpenMeetingSubmitted = true;
  const sections = sectionsOf(app.details);
  await app.store.saveEvidence(app.userId, { photoId: 'p1', evidenceId: 'e1', photo: 'AAAA', type: EVIDENCE_SITE_TOUR, comment: encodeTourComment(sections, 'gate', 'board') });
  await app.store.saveEvidence(app.userId, { photoId: 'p2', evidenceId: 'e2', photo: 'BBBB', type: EVIDENCE_SITE_TOUR, comment: encodeTourComment(sections, 'forge', 'press') });
  return { app, server };
}

describe('Sync Assessment → Site Tour', () => {
  it('the lead cannot submit a site tour that leaves out a section; the missing ones are named', async () => {
    const { app, server } = await twoSectionTour(1);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const r = render(app, 'SubmitParameters');
    await flush();
    await act(async () => handler(r, 'sync-siteTour').props.onPress());
    await flush();
    expect(alert).toHaveBeenLastCalledWith(
      '',
      'Site Tour cannot be submitted yet: every section needs its photos. Please capture: "Store" (0 of 2 photos).',
      expect.anything(),
      expect.anything(),
    );
    expect(server.requests.filter(q => q.url.endsWith('SubmitSiteTour'))).toHaveLength(0);
    expect(app.details!.isSiteTourSubmitted).toBe(false);
    alert.mockRestore();
  });

  it('the co-assessor photos join the team tour without that check', async () => {
    const { app, server } = await twoSectionTour(2);
    const r = render(app, 'SubmitParameters');
    await flush();
    await act(async () => handler(r, 'sync-siteTour').props.onPress());
    await flush();
    const sent = server.requests.filter(q => q.url.endsWith('SubmitSiteTour'));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.json!.siteTour).toEqual([{ photoId: 'p1', section: 'gate' }, { photoId: 'p2', section: 'forge' }]);
    expect(app.details!.isSiteTourSubmitted).toBe(true);
  });
});
