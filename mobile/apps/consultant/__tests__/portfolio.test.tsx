import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { APP_TOKEN_HEADER, StackNavigator, UiHost } from '@zed/shared';
import { SCREENS } from '../App';
import { SaAppProvider } from '../src/app/context';
import type { SaApp } from '../src/app/SaApp';
import { MILESTONES_MISMATCH, openAssessment, signIn } from '../src/flows/login';
import { milestoneProgress, milestoneSections } from '../src/milestone';
import { counts, matches, milestoneLabel, milestonesOf, type AssessmentSummary } from '../src/portfolio';
import { FakeServer, makeApp } from './helpers/harness';
import { allocationAnswer, loginAnswer, SA_ID, tuAnswer, ZED_ID } from './helpers/fixtures';

jest.setTimeout(60000);

const unit = (over: Partial<AssessmentSummary> = {}): AssessmentSummary => ({
  zedId: ZED_ID,
  certificationType: 'Silver',
  enterpriseName: 'RN Consultancy Unit Pvt Ltd',
  district: 'New Delhi',
  state: 'Delhi',
  assessmentDate: '2026-10-24T09:00:00',
  stage: 'scheduled',
  canOpen: true,
  userType: 1,
  milestone: 1,
  milestones: [
    { no: 1, status: 'current' },
    { no: 2, status: 'locked' },
    { no: 3, status: 'locked' },
  ],
  team: [
    { assessorId: SA_ID, name: 'RN Lead Consultant', role: 'Lead', userType: 1 },
    { assessorId: 'ZEDCCRN02', name: 'RN Co Consultant', role: 'Co', userType: 2 },
  ],
  ...over,
});

const signInAnswer = (over: Record<string, unknown> = {}) => ({
  status: '1',
  appToken: 'tok-a',
  profile: { assessorId: SA_ID, name: 'RN Lead Consultant', email: 'dev.zed@qcin.org' },
  assessments: [unit(), unit({ zedId: 'ZEDRNCS0002', enterpriseName: 'Second Unit', stage: 'closed', canOpen: false, certificationType: 'Gold', milestone: 3 })],
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
const handler = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && typeof n.props.onPress === 'function')[0]!;
const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAll(n => (n.type as unknown) === 'Text').map(n => (Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '')));

describe('sign-in (redesign: consultant ID + password, several cases)', () => {
  it('signs in online, keeps the token for the consultant and the list; the offline sign-in uses them', async () => {
    const s = server();
    const { app, db, mediaDb, prefs } = await makeApp(s);
    expect(await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true)).toEqual({ kind: 'proceed', toast: 'Login Successful.' });
    expect(s.last('SA/SignIn')!.url).toBe('http://10.0.2.2:5105/consultancymobileapi/SA/SignIn');
    expect(s.last('SA/SignIn')!.json).toMatchObject({ assessorId: SA_ID, password: 'Secret1' });
    expect(s.last('SA/SignIn')!.headers![APP_TOKEN_HEADER]).toBeUndefined();
    expect(app.session.appToken).toBe('tok-a');
    expect(app.assessor?.name).toBe('RN Lead Consultant');
    expect(app.assessments).toHaveLength(2);

    const { app: restarted } = await makeApp(s, { db, mediaDb }, prefs);
    expect(await signIn(restarted, { assessorId: SA_ID, password: 'wrong' }, false)).toEqual({ kind: 'toast', message: 'Network Unavailable' });
    expect(await signIn(restarted, { assessorId: SA_ID, password: 'Secret1' }, false)).toEqual({ kind: 'proceed' });
    expect(restarted.session.appToken).toBe('tok-a');
    expect(restarted.assessments.map(a => a.zedId)).toEqual([ZED_ID, 'ZEDRNCS0002']);
  });

  it('keeps the server refusals and the update question', async () => {
    const { app } = await makeApp(server({ SignIn: { status: '0', errorMessage: 'Invalid Username or Password' } }));
    expect(await signIn(app, { assessorId: SA_ID, password: 'x' }, true)).toEqual({ kind: 'toast', message: 'Invalid Username or Password' });
    const { app: old } = await makeApp(server({ SignIn: { status: '2' } }));
    expect(await signIn(old, { assessorId: SA_ID, password: 'x' }, true)).toEqual({ kind: 'update' });
  });
});

describe('opening a case', () => {
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
    app.details!.isOpenMeetingSubmitted = true;
    await app.update();
    app.closeAssessment();
    expect(await openAssessment(app, unit(), false)).toMatchObject({ kind: 'open' });
    expect(app.details!.isOpenMeetingSubmitted).toBe(true);
  });

  it('takes the site tour sections of the unit as the server has them now', async () => {
    const sections = [{ id: 'gate', no: 1, title: 'Gate', min: 1, max: 2, uploaded: 1 }];
    const { app } = await makeApp(server({ Assessment: { ...loginAnswer(), siteTourSections: sections } }));
    await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
    await openAssessment(app, unit(), true);
    expect(app.details!.siteTourSections).toEqual(sections);
  });

  it('stops at another milestone than the one on the phone, as the legacy sign-in did', async () => {
    const answers: Record<string, unknown> = {};
    const { app } = await makeApp(server(answers));
    await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
    await openAssessment(app, unit(), true);
    answers.Assessment = loginAnswer({ milestone: 2 });
    expect(await openAssessment(app, unit({ milestone: 2 }), true)).toEqual({ kind: 'alert', message: MILESTONES_MISMATCH });
  });

  it('passes on the server refusal and needs the network the first time', async () => {
    const { app } = await makeApp(server({ Assessment: { status: '0', errorMessage: 'Consultancy not allocated' } }));
    await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
    expect(await openAssessment(app, unit(), true)).toEqual({ kind: 'toast', message: 'Consultancy not allocated' });
    expect(await openAssessment(app, unit(), false)).toEqual({ kind: 'toast', message: 'MSME Profile Missing' });
  });
});

describe('screens', () => {
  it('the dashboard counts the cases and offers the next milestone visit', async () => {
    const { app } = await makeApp(server());
    await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
    const r = render(app, 'Home');
    await act(async () => undefined);
    expect(texts(r)).toEqual(expect.arrayContaining(['Welcome back,', 'RN Lead Consultant', 'RN Consultancy Unit Pvt Ltd', 'Milestone 1', '2 member team']));
    expect(byTestId(r, 'view-' + ZED_ID)).toHaveLength(1);
    // Nothing of the unit on the phone yet: no "Clear data".
    expect(byTestId(r, 'clean-' + ZED_ID)).toHaveLength(0);
  });

  it('the case detail lists the milestones and opens the current one', async () => {
    const { app } = await makeApp(server());
    await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
    const r = render(app, 'CaseDetail', { key: `${ZED_ID}|Silver` });
    await act(async () => undefined);
    expect(byTestId(r, 'milestone-1')).toHaveLength(1);
    expect(texts(r)).toEqual(expect.arrayContaining(['Milestone 2', 'Locked', 'Open Milestone 1']));
    await act(async () => handler(r, 'open-milestone').props.onPress());
    await act(async () => undefined);
    expect(byTestId(r, 'assessment-options')).toHaveLength(1);
  });

  it('Clear data is on the case card only: the legacy question, then the case is removed from the phone', async () => {
    const { app } = await makeApp(server());
    await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
    await openAssessment(app, unit(), true);
    app.closeAssessment();
    const r = render(app, 'Home');
    await act(async () => undefined);
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await act(async () => handler(r, 'clean-' + ZED_ID).props.onPress());
    const [title, message, buttons] = spy.mock.calls[spy.mock.calls.length - 1]!;
    expect([title, message, buttons!.map(x => x.text)]).toEqual(['Alert', 'Are you sure you want to clear the data associated with this login?', ['Yes', 'No']]);
    spy.mockRestore();
    await act(async () => {
      await buttons![0]!.onPress!();
    });
    await act(async () => undefined);
    expect(await app.storedAssessment(ZED_ID)).toBeNull();
    expect(byTestId(r, 'clean-' + ZED_ID)).toHaveLength(0);
    // Not on the milestone page.
    await openAssessment(app, unit(), true);
    const m = render(app, 'AssessmentOptions', { userType: 1, allottedParamsAvailable: true });
    await act(async () => undefined);
    expect(byTestId(m, 'option-clear-data')).toHaveLength(0);
  });

  it('Help shows the consultant organisation to contact', async () => {
    const profile = { assessorId: SA_ID, name: 'RN Lead Consultant', agencyName: 'Acme Consultants', agencyEmail: 'help@acme.example', agencyMobile: '9810000000' };
    const { app } = await makeApp(server({ SignIn: signInAnswer({ profile }) }));
    await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
    const r = render(app, 'Help');
    expect(texts(r)).toEqual(expect.arrayContaining(['Acme Consultants', 'help@acme.example', '9810000000']));
  });

  it('the login page forwards a signed-in consultant to the dashboard (end of a milestone visit)', async () => {
    const { app } = await makeApp(server());
    await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
    const r = render(app, 'Login');
    await act(async () => undefined);
    expect(byTestId(r, 'home')).toHaveLength(1);
  });

  it("a co-consultant before the lead's allocation is told it is pending", async () => {
    const { app } = await makeApp(server());
    await app.saveDetails({ ...allocationAnswer(), userType: 2 }, SA_ID, ZED_ID);
    const r = render(app, 'CompanyProfile', { userType: 2, allottedParamsAvailable: false });
    expect(texts(r)).toContain("Waiting for the Lead Consultant's allocation");
    await act(async () => handler(r, 'option-diagnostic-study').props.onPress());
    expect(byTestId(r, 'alert-message')).toHaveLength(1);
  });
});

describe('portfolio and milestone helpers', () => {
  it('counts, search, milestones and labels', () => {
    const list = [unit(), unit({ zedId: 'B', stage: 'inProgress' }), unit({ zedId: 'C', stage: 'closed' })];
    expect(counts(list)).toEqual({ total: 3, upcoming: 1, ongoing: 1, submitted: 0 });
    expect(matches(unit(), 'consultancy', 'All')).toBe(true);
    expect(matches(unit(), 'nothing', 'All')).toBe(false);
    expect(milestonesOf(unit({ milestones: null, milestone: 2 }))).toEqual([{ no: 2, status: 'current' }]);
    expect(milestoneLabel(4)).toBe('Technology Upgradation');
  });

  it('the sections of each milestone and the progress', () => {
    const m1 = loginAnswer();
    expect(milestoneSections(m1, false).map(s => s.id)).toContain('diagnostic-study');
    expect(milestoneProgress(m1)).toMatchObject({ done: 0, total: 11 });
    expect(milestoneSections(loginAnswer({ milestone: 2 }), false).map(s => s.id)).toContain('progress-review');
    expect(milestoneSections(tuAnswer(), false).map(s => s.id)).toEqual(['attendance', 'site-photos', 'open-meeting', 'technology-upgradation']);
    // Sent sections stay as completed (the legacy list dropped them), so the progress counts them.
    const opened = milestoneSections(loginAnswer({ isOpenMeetingSubmitted: true, isSiteTourSubmitted: true }), false);
    expect(opened.filter(s => s.submitted).map(s => s.id)).toEqual(['site-photos', 'open-meeting', 'site-tour']);
    expect(milestoneProgress(loginAnswer({ isOpenMeetingSubmitted: true, isSiteTourSubmitted: true }))).toMatchObject({ done: 3, total: 11 });
  });
});
