import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StackNavigator, UiHost } from '@zed/shared';
import { SCREENS } from '../App';
import { SaAppProvider } from '../src/app/context';
import type { SaApp } from '../src/app/SaApp';
import { newAttendance } from '../src/attendance';
import { COMPLETED, IN_PROGRESS } from '../src/models';
import { checkpointProblem, conformanceOf } from '../src/checkpoints';
import { FakeServer, makeApp } from './helpers/harness';
import { allocationAnswer, loginAnswer, SA_ID, ZED_ID } from './helpers/fixtures';

jest.setTimeout(60000);

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

async function appWith(answer = loginAnswer()) {
  const { app } = await makeApp(new FakeServer());
  await app.saveDetails(answer, SA_ID, ZED_ID);
  return app;
}

describe('Assessment Detail (AssessmentOptionsActivity)', () => {
  it('shows the lead assessor\'s steps and needs today\'s punch-in for every step but Attendance', async () => {
    const app = await appWith();
    const r = render(app, 'AssessmentOptions');
    expect(byTestId(r, 'option-open-meeting')).toHaveLength(1);
    expect(byTestId(r, 'option-close-meeting')).toHaveLength(1);
    expect(byTestId(r, 'option-final-submission')).toHaveLength(0);
    expect(texts(r)).toEqual(expect.arrayContaining(['Basic Info', 'Assessment Checklist', 'Start the assessment · Yes / Partial / No']));
    await act(async () => handler(r, 'option-site-tour').props.onPress());
    expect(texts(r)).toContain('Please log the attendance today to proceed');
  });

  it('renders nothing once the assessment is removed from the phone (end of the assessment)', async () => {
    const app = await appWith();
    const r = render(app, 'AssessmentOptions');
    await act(async () => {
      await app.deleteAssessorData();
    });
    expect(byTestId(r, 'assessment-options')).toHaveLength(0);
  });

  it('an assessor has no meetings or basic information, and the final submission', async () => {
    const answer = loginAnswer({ userType: 2 });
    answer.allottedParameters![0]!.status = IN_PROGRESS;
    const app = await appWith(answer);
    const r = render(app, 'AssessmentOptions');
    expect(byTestId(r, 'option-open-meeting')).toHaveLength(0);
    expect(byTestId(r, 'option-basic-info')).toHaveLength(0);
    expect(byTestId(r, 'option-final-submission')).toHaveLength(1);
    expect(texts(r)).toContain('Continue the assessment · Yes / Partial / No');
  });

  it('after a punch out the punch-in check comes first (the "already punched out" branch cannot be reached)', async () => {
    const app = await appWith();
    const list = app.details!.attendanceData!.attendanceList;
    list.push(newAttendance(null, 'LOGIN', new Date(Date.now() - 3600_000)), newAttendance(null, 'LOGOUT'));
    const r = render(app, 'AssessmentOptions');
    await act(async () => handler(r, 'option-start-assessment').props.onPress());
    expect(texts(r)).toContain('Please log the attendance today to proceed');
  });
});

describe('Assessment Detail (CompanyProfileActivity)', () => {
  it('shows the unit and its schedule; the allocation is done once the parameters are allotted', async () => {
    const app = await appWith();
    const r = render(app, 'CompanyProfile', { userType: 1, allottedParamsAvailable: true });
    expect(texts(r)).toEqual(expect.arrayContaining(['RN Test Enterprise Pvt Ltd', '24 Oct 2026', 'Company Details', 'Parameter Allocation', 'Completed']));
    expect(texts(r)).toContain('0 of 3 requirements assessed · 2 parameters');
  });

  it('shows the NIC sector with its name', async () => {
    const answer = loginAnswer();
    answer.companyProfile = { ...answer.companyProfile!, sectorId: '25', sectorName: 'Manufacture of fabricated metal products' };
    const app = await appWith(answer);
    const r = render(app, 'CompanyProfile', { userType: 1, allottedParamsAvailable: true });
    expect(texts(r)).toContain('25. Manufacture of fabricated metal products');
  });

  it('before the allocation the lead starts it', async () => {
    const app = await appWith(allocationAnswer());
    const r = render(app, 'CompanyProfile', { userType: 1, allottedParamsAvailable: false });
    expect(texts(r)).toContain('Locked · finish Parameter Allocation');
    await act(async () => handler(r, 'start-alloc-button').props.onPress());
    expect(byTestId(r, 'allocation')).toHaveLength(1);
    expect(texts(r)).toEqual(expect.arrayContaining(['ALLOCATION DETAILS', 'PARAMETERS', 'Exempted', 'Save allocation']));
  });
});

describe('QuestionsFragment', () => {
  it('validates the conformance, then "No" needs a comment, and saving completes the parameter', async () => {
    const app = await appWith();
    const results: string[] = [];
    const r = render(app, 'QuestionsPager', { parameterId: '9102', parameterName: 'Test Parameter Two', onResult: () => results.push('ok') });
    expect(texts(r)).toEqual(expect.arrayContaining(['Test Parameter Two', '1 of 1 requirement(s)', 'The unit trains its test staff', 'No option selected', 'Save']));
    await act(async () => handler(r, 'q-save').props.onPress());
    expect(texts(r)).toContain('Please enter required details');
    await act(async () => handler(r, 'q-no').props.onPress());
    await act(async () => handler(r, 'q-save').props.onPress());
    expect(texts(r)).toContain("Comments are mandatory when conformance is 'No'");
    // Comments are bullets: each observation is added as a point.
    act(() => handler(r, 'q-comment', 'onChangeText').props.onChangeText('  Not in place  '));
    act(() => handler(r, 'q-comment-add').props.onPress());
    act(() => handler(r, 'q-comment', 'onChangeText').props.onChangeText('No trainer named'));
    act(() => handler(r, 'q-comment-add').props.onPress());
    await act(async () => handler(r, 'q-save').props.onPress());
    const p = app.details!.allottedParameters!.find(x => x.parameterId === '9102')!;
    expect(p.status).toBe(COMPLETED);
    expect(p.requirements![0]).toMatchObject({ conformance: 'No', comments: '• Not in place\n• No trainer named', reviewNeeded: false });
    expect(results).toEqual(['ok']);
  });

  it('"Yes" needs at least one evidence; Review keeps the parameter in progress', async () => {
    const app = await appWith();
    const r = render(app, 'QuestionsPager', { parameterId: '9102', parameterName: 'Test Parameter Two' });
    await act(async () => handler(r, 'q-yes').props.onPress());
    await act(async () => handler(r, 'q-save').props.onPress());
    expect(texts(r)).toContain('Please add at least one Evidence');
    await act(async () => handler(r, 'q-review').props.onPress());
    const p = app.details!.allottedParameters!.find(x => x.parameterId === '9102')!;
    expect(p.status).toBe(IN_PROGRESS);
    expect(p.requirements![0]!.reviewNeeded).toBe(true);
  });
});

describe('evidences listed by the Admin (redesign)', () => {
  async function listedApp() {
    const answer = loginAnswer();
    answer.allottedParameters![1]!.requirements![0]!.listedEvidences = [
      { id: 71, name: 'Training register', mandatory: true, uploaded: true, verified: 'Yes' },
      { id: 72, name: 'Trainer certificate', mandatory: false, uploaded: false },
    ];
    return appWith(answer);
  }

  it('lists them instead of the free photos; each is answered, a Yes needs its photo, a No keeps the conformance from Yes', async () => {
    const app = await listedApp();
    const r = render(app, 'QuestionsPager', { parameterId: '9102', parameterName: 'Test Parameter Two' });
    expect(texts(r)).toEqual(expect.arrayContaining(['Required evidence · 0 of 2 done'.toUpperCase(), 'Training register', 'Trainer certificate', 'Mandatory']));
    expect(byTestId(r, 'q-capture-new')).toHaveLength(0);

    await act(async () => handler(r, 'q-yes').props.onPress());
    await act(async () => handler(r, 'q-save').props.onPress());
    expect(texts(r)).toContain('Please answer whether "Training register" is available at the site.');

    await act(async () => handler(r, 'ev-71-no').props.onPress());
    await act(async () => handler(r, 'ev-72-no').props.onPress());
    expect(texts(r)).toContain("Not available: the conformance can't be Yes.");
    await act(async () => handler(r, 'q-save').props.onPress());
    expect(texts(r)).toContain('The conformance cannot be Yes: "Training register" is not available at the site.');

    // No: the requirement is an NC (with its comment), and the answers travel with it.
    await act(async () => handler(r, 'q-no').props.onPress());
    act(() => handler(r, 'q-comment', 'onChangeText').props.onChangeText('Register not kept'));
    act(() => handler(r, 'q-comment-add').props.onPress());
    await act(async () => handler(r, 'q-save').props.onPress());
    const req = app.details!.allottedParameters!.find(x => x.parameterId === '9102')!.requirements![0]!;
    expect(req.conformance).toBe('No');
    expect(req.evidenceChecks).toEqual([
      { id: 71, available: 'No', photoIds: [] },
      { id: 72, available: 'No', photoIds: [] },
    ]);
  });
});

describe('checkpoints (V4: Yes / Partial / No per checkpoint)', () => {
  /** Requirement 9203 with two checkpoints: 9303 with a mandatory evidence, 9304 with actions needed. */
  function withCheckpoints(verified: string | null = 'Yes') {
    const answer = loginAnswer();
    const p = answer.allottedParameters!.find(x => x.parameterId === '9102')!;
    p.requirements![0]!.options = [
      { id: 9303, code: '1', label: 'The unit trains its test staff', checkpoint: { actions: [], evidences: [{ name: 'Training register', mandatory: true, uploaded: true, verified }], desktopAnswer: 'Yes' } },
      { id: 9304, code: '2', label: 'Training is recorded', checkpoint: { actions: ['Keep a training register', 'Train new staff'], evidences: [], desktopAnswer: 'Partial' } },
    ];
    return answer;
  }

  it('answers each checkpoint; the conformance follows and the answers are kept with the requirement', async () => {
    const app = await appWith(withCheckpoints());
    const r = render(app, 'QuestionsPager', { parameterId: '9102', parameterName: 'Test Parameter Two' });
    expect(byTestId(r, 'q-yes')).toHaveLength(0); // no single Yes / No any more
    expect(texts(r)).toEqual(expect.arrayContaining(['1. The unit trains its test staff', 'DA: Partial · Evidence: none mandatory']));
    await act(async () => handler(r, 'q-save').props.onPress());
    expect(texts(r)).toContain('Checkpoint 1: please choose Yes, Partial or No.');

    await act(async () => handler(r, 'cp-9303-yes').props.onPress());
    await act(async () => handler(r, 'cp-9304-partial').props.onPress());
    await act(async () => handler(r, 'q-save').props.onPress());
    expect(texts(r)).toContain('Checkpoint 2: please tick the actions needed.');
    await act(async () => handler(r, 'cp-9304-action-0', 'onChange').props.onChange(true));
    await act(async () => handler(r, 'q-save').props.onPress());

    const req = app.details!.allottedParameters!.find(x => x.parameterId === '9102')!.requirements![0]!;
    // A Partial is not conforming; no comment is needed (the server writes the answers as the remarks).
    expect(req).toMatchObject({ conformance: 'No', reviewNeeded: false });
    expect(req.checkpointAnswers).toEqual([
      { id: 9303, answer: 'Yes', actions: [], remarks: null },
      { id: 9304, answer: 'Partial', actions: ['Keep a training register'], remarks: null },
    ]);
  });

  it('follows the web rules: a Yes needs the mandatory evidence not refused', () => {
    const q = withCheckpoints('No').allottedParameters!.find(x => x.parameterId === '9102')!.requirements![0]!;
    const yes = [{ id: 9303, answer: 'Yes', actions: [] }, { id: 9304, answer: 'Yes', actions: [] }];
    expect(checkpointProblem(q, yes)).toBe('Checkpoint 1: Yes needs every mandatory evidence; "Training register" was not verified.');
    expect(conformanceOf(yes)).toBe('Yes');
    expect(conformanceOf([{ id: 9303, answer: null, actions: [] }])).toBeNull();
  });
});
