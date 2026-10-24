import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StackNavigator, UiHost } from '@zed/shared';
import { SCREENS } from '../App';
import { SaAppProvider } from '../src/app/context';
import type { SaApp } from '../src/app/SaApp';
import { newAttendance } from '../src/attendance';
import { COMPLETED, IN_PROGRESS } from '../src/models';
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

describe('AssessmentOptionsActivity', () => {
  it('shows the lead assessor\'s steps and needs today\'s punch-in for every step but Attendance', async () => {
    const app = await appWith();
    const r = render(app, 'AssessmentOptions');
    expect(byTestId(r, 'option-open-meeting')).toHaveLength(1);
    expect(byTestId(r, 'option-close-meeting')).toHaveLength(1);
    expect(byTestId(r, 'option-final-submission')).toHaveLength(0);
    expect(texts(r)).toEqual(expect.arrayContaining(['Capture Basic Info', 'Start Assessment']));
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
    expect(texts(r)).toContain('Continue Assessment');
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

describe('CompanyProfileActivity', () => {
  it('lists the profile and offers "Proceed" once the parameters are allotted', async () => {
    const app = await appWith();
    const r = render(app, 'CompanyProfile', { userType: 1, allottedParamsAvailable: true });
    expect(texts(r)).toEqual(expect.arrayContaining(['COMPANY PROFILE', 'SA DATE', '10/24/2026', 'MSME NAME', 'RN Test Enterprise Pvt Ltd', 'Show Company Details', 'Proceed']));
  });

  it('before the allocation the lead starts it', async () => {
    const app = await appWith(allocationAnswer());
    const r = render(app, 'CompanyProfile', { userType: 1, allottedParamsAvailable: false });
    expect(texts(r)).toContain('Start Allocation');
    await act(async () => handler(r, 'start-alloc-button').props.onPress());
    expect(byTestId(r, 'allocation')).toHaveLength(1);
    expect(texts(r)).toEqual(expect.arrayContaining(['ALLOCATION DETAILS', 'PARAMETERS', 'Exempted', 'SUBMIT ALLOCATION']));
  });
});

describe('QuestionsFragment', () => {
  it('validates the conformance, then "No" needs a comment, and saving completes the parameter', async () => {
    const app = await appWith();
    const results: string[] = [];
    const r = render(app, 'QuestionsPager', { parameterId: '9102', parameterName: 'Test Parameter Two', onResult: () => results.push('ok') });
    expect(texts(r)).toEqual(expect.arrayContaining(['Test Parameter Two', '1 of 1 Question(s)', 'The unit trains its test staff', 'No option selected', 'Save']));
    await act(async () => handler(r, 'q-save').props.onPress());
    expect(texts(r)).toContain('Please enter required details');
    await act(async () => handler(r, 'q-no').props.onPress());
    await act(async () => handler(r, 'q-save').props.onPress());
    expect(texts(r)).toContain("Comments are mandatory when conformance is 'No'");
    act(() => handler(r, 'q-comment', 'onChangeText').props.onChangeText('  Not in place  '));
    await act(async () => handler(r, 'q-save').props.onPress());
    const p = app.details!.allottedParameters!.find(x => x.parameterId === '9102')!;
    expect(p.status).toBe(COMPLETED);
    expect(p.requirements![0]).toMatchObject({ conformance: 'No', comments: 'Not in place', reviewNeeded: false });
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
