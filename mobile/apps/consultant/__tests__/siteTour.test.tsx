import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StackNavigator, UiHost } from '@zed/shared';
import { SCREENS } from '../App';
import { SaAppProvider } from '../src/app/context';
import type { SaApp } from '../src/app/SaApp';
import { newAttendance } from '../src/attendance';
import { EVIDENCE_SITE_TOUR, type AssessmentDetails } from '../src/models';
import { decodeTourComment, encodeTourComment, sectionsOf, tourCounts, withSection } from '../src/siteTour';
import { FakeServer, makeApp } from './helpers/harness';
import { loginAnswer, SA_ID, ZED_ID } from './helpers/fixtures';

jest.setTimeout(60000);

const SECTIONS = [
  { id: 'gate', no: 1, title: 'Gate', hint: 'Name board', min: 1, max: 2, uploaded: 1 },
  { id: 'forge', no: 2, title: 'Forge shop', hint: 'Furnaces', min: 2, max: 3, uploaded: 0 },
];

describe('site tour sections', () => {
  const admin = sectionsOf({ siteTourSections: SECTIONS });
  const photo = (comment: string | null, id = 'p') => ({ photoId: id, type: 2, comment });

  it('takes the unit sections from the server, else the standard ten', () => {
    expect(admin.map(s => s.key)).toEqual(['gate', 'forge']);
    expect(admin[0]).toEqual({ key: 'gate', title: 'Gate', hint: 'Name board', min: 1, max: 2, uploaded: 1 });
    expect(sectionsOf(null)).toHaveLength(10);
    expect(sectionsOf(loginAnswer())).toHaveLength(10);
    expect(sectionsOf({ siteTourSections: [] })[0]!.title).toBe('Unit Entrance & Signage');
    // The overall limit of the site tour is the sum of the sections' maxima.
    expect(admin.reduce((n, s) => n + s.max, 0)).toBe(5);
  });

  it('sends a known section as the photo section (its key) and the remark alone; anything else unchanged', () => {
    expect(withSection(photo('[Forge shop] furnace 2'), admin)).toMatchObject({ section: 'forge', comment: 'furnace 2' });
    expect(withSection(photo('[Utilities] DG set'), sectionsOf(null))).toMatchObject({ section: 'utilities', comment: 'DG set' });
    expect(withSection(photo('[Utilities] DG set'), admin)).toEqual(photo('[Utilities] DG set'));
    expect(withSection(photo(null), admin)).toEqual(photo(null));
  });

  it('counts the team photos uploaded and this phone photos', () => {
    const local = [photo('[Forge shop] a', '1'), photo('[Gate] b', '2'), photo('no section', '3')];
    expect(tourCounts(admin, local, false)).toEqual({ gate: 2, forge: 1 });
    // Once this phone's tour is submitted its photos are among the uploaded ones.
    expect(tourCounts(admin, local, true)).toEqual({ gate: 1, forge: 0 });
    expect(encodeTourComment(admin, 'forge', 'x')).toBe('[Forge shop] x');
    expect(encodeTourComment(admin, null, 'x')).toBe('x');
    expect(decodeTourComment(admin, '[Forge shop] x')).toEqual({ section: 'forge', remark: 'x' });
    expect(decodeTourComment(admin, '[Paint shop] x')).toEqual({ section: null, remark: '[Paint shop] x' });
  });
});

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

const byTestId = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && typeof n.type === 'string');
const handler = (r: ReactTestRenderer.ReactTestRenderer, id: string, prop = 'onPress') => r.root.findAll(n => n.props.testID === id && typeof n.props[prop] === 'function')[0]!;
const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAll(n => (n.type as unknown) === 'Text').map(n => (Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '')));
const flush = () => act(async () => new Promise<void>(resolve => setTimeout(resolve, 0)));

async function tourApp() {
  const { app } = await makeApp(new FakeServer());
  await app.saveDetails(loginAnswer({ siteTourSections: SECTIONS } as Partial<AssessmentDetails>), SA_ID, ZED_ID);
  app.details!.attendanceData!.attendanceList.push(newAttendance(null, null, 'LOGIN'));
  app.prefs.setBoolean('SiteTourActivity', 'tour_instruction', true);
  await app.store.saveEvidence(app.userId, { photoId: 'p1', evidenceId: 'e1', photo: 'AAAA', type: EVIDENCE_SITE_TOUR, comment: '[Gate] name board' });
  await app.store.saveEvidence(app.userId, { photoId: 'p3', evidenceId: 'e3', photo: 'CCCC', type: EVIDENCE_SITE_TOUR, comment: 'taken before the sections' });
  return app;
}

describe('Site tour screens (sections from the server)', () => {
  it('lists the sections with their counts; a full section has no capture tile', async () => {
    const app = await tourApp();
    const r = render(app, 'SiteTour');
    await flush();
    expect(texts(r)).toEqual(expect.arrayContaining(['Gate', 'Forge shop', 'Other', '2/2', '0/3', '2 of 5 photos captured', '1 of 2 sections covered']));
    await act(async () => handler(r, 'site-tour-section-gate').props.onPress());
    expect(texts(r)).toContain('Maximum of 2 photographs reached for this section.');
    expect(byTestId(r, 'site-tour-add')).toHaveLength(0);
    expect(byTestId(r, 'site-tour-0')).toHaveLength(1);
    await act(async () => handler(r, 'header-back').props.onPress());
    await act(async () => handler(r, 'site-tour-section-forge').props.onPress());
    expect(texts(r)).toContain('Nothing captured yet');
    expect(byTestId(r, 'site-tour-add')).toHaveLength(1);
  });

  it('a photo needs a section, and a full section refuses it', async () => {
    const app = await tourApp();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const r = render(app, 'NewSitePhoto', { evidenceId: 'e3' });
    await flush();
    expect(byTestId(r, 'site-photo-comment')[0]!.props.value).toBe('taken before the sections');
    await act(async () => handler(r, 'site-photo-submit').props.onPress());
    expect(alert).toHaveBeenLastCalledWith('', 'Please select the section of this photo', expect.anything(), expect.anything());
    // The picker lists the unit's sections only (no "Other").
    act(() => {
      handler(r, 'site-photo-section').props.onPress();
    });
    expect(byTestId(r, 'pick-item-2')).toHaveLength(0);
    await act(async () => handler(r, 'pick-item-0').props.onPress());
    await act(async () => handler(r, 'site-photo-submit').props.onPress());
    expect(alert).toHaveBeenLastCalledWith('', 'Site Tour: "Gate" takes at most 2 photos.', expect.anything(), expect.anything());
    act(() => {
      handler(r, 'site-photo-section').props.onPress();
    });
    await act(async () => handler(r, 'pick-item-1').props.onPress());
    await act(async () => handler(r, 'site-photo-submit').props.onPress());
    expect((await app.store.evidence(app.userId, 'e3'))?.comment).toBe('[Forge shop] taken before the sections');
    alert.mockRestore();
  });
});
