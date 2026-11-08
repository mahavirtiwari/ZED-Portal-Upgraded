import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { APP_TOKEN_HEADER, StackNavigator, UiHost } from '@zed/shared';
import { SCREENS } from '../App';
import { SaAppProvider } from '../src/app/context';
import type { SaApp } from '../src/app/SaApp';
import { openAssessment, signIn } from '../src/flows/login';
import { saveOpenMeetingOffline } from '../src/flows/submissions';
import { bulletsOf, bulletText, initialChecks, listedProblem } from '../src/listedEvidence';
import { decodeTourComment, encodeTourComment, sectionsOf, tourCounts, tourShortfall, withSection } from '../src/siteTour';
import { counts, formatRange, levelFilters, matches, progressOf, type AssessmentSummary } from '../src/portfolio';
import { FakeServer, makeApp } from './helpers/harness';
import { allocationAnswer, loginAnswer, SA_ID, ZED_ID } from './helpers/fixtures';

jest.setTimeout(60000);

const unit = (over: Partial<AssessmentSummary> = {}): AssessmentSummary => ({
  zedId: ZED_ID,
  certificationType: 'Silver',
  enterpriseName: 'RN Test Enterprise',
  district: 'New Delhi',
  state: 'Delhi',
  assessmentDate: '2026-10-24T09:00:00',
  stage: 'scheduled',
  canOpen: true,
  userType: 1,
  team: [
    { assessorId: SA_ID, name: 'RN Lead Assessor', role: 'Lead', userType: 1 },
    { assessorId: 'ZEDRNCA01', name: 'RN Co Assessor', role: 'Co', userType: 2 },
  ],
  ...over,
});

const signInAnswer = (over: Record<string, unknown> = {}) => ({
  status: '1',
  appToken: 'tok-a',
  profile: { assessorId: SA_ID, name: 'RN Lead Assessor', email: 'dev.zed@qcin.org', levels: [{ code: 'Silver', name: 'Silver', mode: 'Site' }] },
  assessments: [unit(), unit({ zedId: 'ZEDRNSA0002', enterpriseName: 'Second Unit', stage: 'submitted', canOpen: false, certificationType: 'Gold' })],
  ...over,
});

function server(answers: Record<string, unknown> = {}) {
  return new FakeServer(r => {
    const name = r.url.split('/SA/')[1]?.split('?')[0] ?? '';
    if (name in answers) return answers[name];
    if (name === 'SignIn') return signInAnswer();
    if (name === 'Assessment') return { ...loginAnswer(), appToken: 'tok-u' };
    return { status: '1' };
  });
}

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
const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAll(n => (n.type as unknown) === 'Text').map(n => (Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '')));

describe('sign-in (redesign: assessor ID + password, several assessments)', () => {
  it('signs in online, keeps the token for the assessor and the list; the offline sign-in uses them', async () => {
    const s = server();
    const { app, db, mediaDb, prefs } = await makeApp(s);
    expect(await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true)).toEqual({ kind: 'proceed', toast: 'Login Successful.' });
    expect(s.last('SA/SignIn')!.json).toMatchObject({ assessorId: SA_ID, password: 'Secret1', version: '1.3' });
    expect(s.last('SA/SignIn')!.headers![APP_TOKEN_HEADER]).toBeUndefined();
    expect(app.session.appToken).toBe('tok-a');
    expect(app.assessor?.name).toBe('RN Lead Assessor');
    expect(app.assessments).toHaveLength(2);

    const { app: restarted } = await makeApp(s, { db, mediaDb }, prefs);
    expect(await signIn(restarted, { assessorId: SA_ID, password: 'wrong' }, false)).toEqual({ kind: 'toast', message: 'Network Unavailable' });
    expect(await signIn(restarted, { assessorId: SA_ID, password: 'Secret1' }, false)).toEqual({ kind: 'proceed' });
    expect(restarted.session.appToken).toBe('tok-a');
    expect(restarted.assessments.map(a => a.zedId)).toEqual([ZED_ID, 'ZEDRNSA0002']);
  });

  it('keeps the server refusals and the update question', async () => {
    const { app } = await makeApp(server({ SignIn: { status: '0', errorMessage: 'Invalid Username or Password' } }));
    expect(await signIn(app, { assessorId: SA_ID, password: 'x' }, true)).toEqual({ kind: 'toast', message: 'Invalid Username or Password' });
    const { app: old } = await makeApp(server({ SignIn: { status: '2' } }));
    expect(await signIn(old, { assessorId: SA_ID, password: 'x' }, true)).toEqual({ kind: 'update' });
  });
});

describe('opening an assessment', () => {
  it('downloads the unit (SA/Assessment), stores it as a sign-in did, and opens it offline later', async () => {
    const s = server();
    const { app } = await makeApp(s);
    await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
    expect(await openAssessment(app, unit(), true)).toEqual({ kind: 'open', userType: 1, allottedParamsAvailable: true });
    expect(s.last('SA/Assessment')!.json).toMatchObject({ saId: SA_ID, zedId: ZED_ID, certificationType: 'Silver' });
    expect(s.last('SA/Assessment')!.headers![APP_TOKEN_HEADER]).toBe('tok-a');
    expect(app.userId).toBe(SA_ID + ZED_ID);
    expect(app.session.appToken).toBe('tok-u');

    // Work on the phone stays when the unit is opened again (the server's answer is stored only the first time).
    app.details!.allottedParameters![0]!.requirements![0]!.conformance = 'Yes';
    await app.update();
    app.closeAssessment();
    expect(await openAssessment(app, unit(), false)).toMatchObject({ kind: 'open' });
    expect(app.details!.allottedParameters![0]!.requirements![0]!.conformance).toBe('Yes');
  });

  it('passes on the server refusal (not allocated, closed) and needs the network the first time', async () => {
    const { app } = await makeApp(server({ Assessment: { status: '0', errorMessage: 'Assessment not allocated' } }));
    await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
    expect(await openAssessment(app, unit(), true)).toEqual({ kind: 'toast', message: 'Assessment not allocated' });
    expect(await openAssessment(app, unit(), false)).toEqual({ kind: 'toast', message: 'Network Unavailable' });
  });
});

describe('Clean data', () => {
  it('is refused while the unit has work the server does not have', async () => {
    const { app } = await makeApp(server());
    await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
    await openAssessment(app, unit(), true);
    expect(await app.hasUnsentWork(ZED_ID)).toBe(false);
    await saveOpenMeetingOffline(app, { saId: SA_ID, zedId: ZED_ID, certificationType: 'Silver', userType: 1 } as never, []);
    expect(await app.hasUnsentWork(ZED_ID)).toBe(true);
  });

  it('removes the copy kept on the phone', async () => {
    const { app } = await makeApp(server());
    await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
    await openAssessment(app, unit(), true);
    app.closeAssessment();
    expect(await app.deleteStoredAssessment(ZED_ID)).toBe(true);
    expect(await app.storedAssessment(ZED_ID)).toBeNull();
  });
});

describe('screens', () => {
  it('the dashboard counts the assessments and offers the next one', async () => {
    const { app } = await makeApp(server());
    await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
    const r = render(app, 'Home');
    await act(async () => undefined);
    expect(texts(r)).toEqual(expect.arrayContaining(['Welcome back,', 'RN Lead Assessor', 'Next assessment'.toUpperCase(), 'RN Test Enterprise', '2 member team']));
    expect(byTestId(r, 'view-' + ZED_ID)).toHaveLength(1);
    // Nothing of the unit on the phone yet: no "Clean data".
    expect(byTestId(r, 'clean-' + ZED_ID)).toHaveLength(0);
  });

  it('Help shows the own assessment agency of the assessor to contact', async () => {
    const { app } = await makeApp(server({ SignIn: signInAnswer({ profile: { assessorId: SA_ID, name: 'RN Lead Assessor', agencyName: 'Acme Agency', agencyEmail: 'help@acme.example', agencyMobile: '9810000000' } }) }));
    await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
    const r = render(app, 'Help');
    expect(texts(r)).toEqual(expect.arrayContaining(['YOUR ASSESSMENT AGENCY', 'Acme Agency', 'help@acme.example', '9810000000']));
  });

  it('the login page forwards a signed-in assessor to the dashboard (end of an assessment)', async () => {
    const { app } = await makeApp(server());
    await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
    const r = render(app, 'Login');
    await act(async () => undefined);
    expect(byTestId(r, 'home')).toHaveLength(1);
  });

  it('a co-assessor before the lead\'s allocation is told it is pending', async () => {
    const { app } = await makeApp(server());
    await app.saveDetails({ ...allocationAnswer(), userType: 2 }, SA_ID, ZED_ID);
    const r = render(app, 'CompanyProfile', { userType: 2, allottedParamsAvailable: false });
    expect(texts(r)).toContain("Waiting for the Lead Assessor's allocation");
    await act(async () => r.root.findAll(n => n.props.testID === 'option-start-assessment' && typeof n.props.onPress === 'function')[0]!.props.onPress());
    expect(byTestId(r, 'alert-message')).toHaveLength(1);
  });
});

describe('portfolio helpers', () => {
  it('counts, progress, search and dates', () => {
    expect(counts([unit(), unit({ stage: 'inProgress' }), unit({ stage: 'ncRound' }), unit({ stage: 'certified' })])).toEqual({ total: 4, upcoming: 1, ongoing: 1, submitted: 1 });
    expect(progressOf(loginAnswer())).toMatchObject({ total: 3, done: 0, parameters: 2 });
    expect(matches(unit(), 'rn test', 'All')).toBe(true);
    expect(matches(unit(), '', 'Gold')).toBe(false);
    expect(formatRange('2026-05-04', '2026-05-05')).toBe('04 – 05 May 2026');
    expect(formatRange('04/29/2026 09:00:00 AM', '2026-05-02')).toBe('29 Apr – 02 May 2026');
  });
});

describe('level filters (2026-11-08, generic levels)', () => {
  it('adds a chip for a level the Admin added among the allotted units, labelled with its server name', () => {
    expect(levelFilters([]).map(f => f.label)).toEqual(['All', 'Bronze', 'Silver', 'Gold', 'ZED-X']);
    const units = [unit(), unit({ zedId: 'ZEDRNSA0003', certificationType: 'PLATINUM', levelName: 'Platinum' }), unit({ zedId: 'ZEDRNSA0004', certificationType: 'DIAMOND' })];
    expect(levelFilters(units)).toEqual([
      { code: 'All', label: 'All' },
      { code: 'Bronze', label: 'Bronze' },
      { code: 'Silver', label: 'Silver' },
      { code: 'Gold', label: 'Gold' },
      { code: 'ZEDX', label: 'ZED-X' },
      { code: 'PLATINUM', label: 'Platinum' },
      { code: 'DIAMOND', label: 'DIAMOND' },
    ]);
    expect(levelFilters([unit({ certificationType: 'zedx' })]).map(f => f.code)).toEqual(['All', 'Bronze', 'Silver', 'Gold', 'ZEDX']);
    expect(matches(units[1]!, '', 'PLATINUM')).toBe(true);
    expect(matches(units[0]!, '', 'PLATINUM')).toBe(false);
  });

  it('My assessments shows the PLATINUM chip from the allotments and filters by it', async () => {
    const platinum = unit({ zedId: 'ZEDRNSA0003', enterpriseName: 'Platinum Unit', certificationType: 'PLATINUM', levelName: 'Platinum' });
    const { app } = await makeApp(server({ SignIn: signInAnswer({ assessments: [unit(), platinum] }) }));
    await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
    const r = render(app, 'Home', { tab: 'assessments' });
    await act(async () => undefined);
    expect(byTestId(r, 'filter-platinum')).toHaveLength(1);
    expect(texts(r)).toEqual(expect.arrayContaining(['Platinum', 'ZED-X']));
    await act(async () => r.root.findAll(n => n.props.testID === 'filter-platinum' && typeof n.props.onPress === 'function')[0]!.props.onPress());
    expect(byTestId(r, 'assessment-ZEDRNSA0003')).toHaveLength(1);
    expect(byTestId(r, 'assessment-' + ZED_ID)).toHaveLength(0);
  });
});

describe('site tour sections', () => {
  const admin = sectionsOf({
    siteTourSections: [
      { id: 'gate', no: 1, title: 'Gate', hint: 'Name board', min: 1, max: 2, uploaded: 1 },
      { id: 'forge', no: 2, title: 'Forge shop', hint: 'Furnaces', min: 2, max: 3, uploaded: 0 },
    ],
  });
  const photo = (comment: string | null, id = 'p') => ({ photoId: id, type: 2, comment });

  it('takes the unit sections from the server, else the standard ten', () => {
    expect(admin.map(s => s.key)).toEqual(['gate', 'forge']);
    expect(sectionsOf(null)).toHaveLength(10);
    expect(sectionsOf({ siteTourSections: [] })[0]!.title).toBe('Unit Entrance & Signage');
  });

  it('sends a known section as the photo section (its key) and the remark alone; anything else unchanged', () => {
    expect(withSection(photo('[Forge shop] furnace 2'), admin)).toMatchObject({ section: 'forge', comment: 'furnace 2' });
    expect(withSection(photo('[Utilities] DG set'), sectionsOf(null))).toMatchObject({ section: 'utilities', comment: 'DG set' });
    expect(withSection(photo('[Utilities] DG set'), admin)).toEqual(photo('[Utilities] DG set'));
    expect(withSection(photo(null), admin)).toEqual(photo(null));
  });

  it('counts the team photos uploaded and this phone photos, and finds the first section short of its minimum', () => {
    const local = [photo('[Forge shop] a', '1'), photo('[Gate] b', '2'), photo('no section', '3')];
    const counts = tourCounts(admin, local, false);
    expect(counts).toEqual({ gate: 2, forge: 1 });
    expect(tourShortfall(admin, counts)).toBe(
      'Site Tour: "Forge shop" needs at least 2 photos (1 captured). Please capture and sync them before the closing meeting.',
    );
    expect(tourShortfall(admin, tourCounts(admin, [...local, photo('[Forge shop] c', '4')], false))).toBeNull();
    // Once this phone's tour is submitted its photos are among the uploaded ones.
    expect(tourCounts(admin, local, true)).toEqual({ gate: 1, forge: 0 });
    expect(encodeTourComment(admin, 'forge', 'x')).toBe('[Forge shop] x');
    expect(decodeTourComment(admin, '[Forge shop] x')).toEqual({ section: 'forge', remark: 'x' });
  });
});

describe('listed evidence rules and comment bullets', () => {
  const q = {
    id: '21',
    reviewNeeded: false,
    options: [
      { id: 501, code: '1', label: 'Policy' },
      { id: 502, code: '2', label: 'Displayed' },
    ],
    listedEvidences: [
      { id: 31, name: 'Policy', mandatory: true, checkpoint: '1', uploaded: true },
      { id: 32, name: 'Register', mandatory: false, uploaded: false },
    ],
  };
  const photos = [{ photoId: 'p1', type: 1 }];
  const yes = [
    { id: 501, answer: 'Yes', actions: [] },
    { id: 502, answer: 'Yes', actions: [] },
  ];

  it('follows the server rules', () => {
    expect(listedProblem(q, [{ id: 31, available: 'Yes', photoIds: ['p1'] }], photos, yes, 'Yes')).toBe('Please answer whether "Register" is available at the site.');
    expect(listedProblem(q, [{ id: 31, available: 'Yes', photoIds: ['p9'] }, { id: 32, available: 'No', photoIds: [] }], photos, yes, 'Yes')).toBe('Please capture a photo of "Policy".');
    expect(listedProblem(q, [{ id: 31, available: 'No', photoIds: [] }, { id: 32, available: 'No', photoIds: [] }], photos, yes, 'Yes')).toBe(
      'Checkpoint 1 cannot be Yes: "Policy" is not available at the site.',
    );
    expect(listedProblem(q, [{ id: 31, available: 'Yes', photoIds: ['p1', 'p2', 'p3', 'p4'] }, { id: 32, available: 'No', photoIds: [] }],
      [...photos, { photoId: 'p2', type: 1 }, { photoId: 'p3', type: 2 }, { photoId: 'p4', type: 1 }], yes, 'No')).toBe('"Policy" takes at most 3 photos.');
    const partial = [{ id: 501, answer: 'Yes', actions: [] }, { id: 502, answer: 'Partial', actions: ['x'] }];
    expect(listedProblem(q, [{ id: 31, available: 'Yes', photoIds: ['p1'] }, { id: 32, available: 'No', photoIds: [] }], photos, partial, 'No')).toBeNull();
    expect(initialChecks({ ...q, listedEvidences: [{ ...q.listedEvidences[0]!, available: 'Yes', photoIds: ['gone', 'p1'] }] }, photos)).toEqual([{ id: 31, available: 'Yes', photoIds: ['p1'] }]);
  });

  it('keeps comments as bullet lines', () => {
    expect(bulletsOf('• a\n• b')).toEqual(['a', 'b']);
    expect(bulletsOf('free text of an older version')).toEqual(['free text of an older version']);
    expect(bulletText(['a', ' b '])).toBe('• a\n• b');
  });
});
