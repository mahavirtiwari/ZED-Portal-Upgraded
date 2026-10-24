import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StackNavigator, UiHost } from '@zed/shared';
import { SCREENS } from '../App';
import { SaAppProvider } from '../src/app/context';
import type { SaApp } from '../src/app/SaApp';
import { newAttendance } from '../src/attendance';
import { COMPLETED, Status } from '../src/models';
import { FakeServer, makeApp } from './helpers/harness';
import { loginAnswer, SA_ID, tuAnswer, ZED_ID } from './helpers/fixtures';

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
const optionIds = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAll(n => typeof n.props.testID === 'string' && /^option-[a-z-]+$/.test(n.props.testID) && typeof n.props.onPress === 'function').map(n => n.props.testID as string).filter((v, i, a) => a.indexOf(v) === i);

async function appWith(answer = loginAnswer(), punchedIn = true) {
  const { app } = await makeApp(new FakeServer());
  await app.saveDetails(answer, SA_ID, ZED_ID);
  if (punchedIn) app.details!.attendanceData!.attendanceList.push(newAttendance(null, null, 'LOGIN'));
  return app;
}

describe('AssessmentOptionsActivity (the dashboard)', () => {
  it('first milestone, lead consultant: the sections in order with their statuses', async () => {
    const app = await appWith();
    const r = render(app, 'AssessmentOptions');
    await act(async () => undefined);
    expect(optionIds(r)).toEqual([
      'option-attendance',
      'option-site-photos',
      'option-open-meeting',
      'option-site-tour',
      'option-training-on-zed',
      'option-diagnostic-study',
      'option-basic-info',
      'option-handholding-action-plan',
      'option-technology-intervention',
      'option-training-on-handholding',
      'option-closing-meeting',
      'option-sync-data',
      'option-clear-data',
    ]);
    expect(texts(r)).toEqual(expect.arrayContaining(['Dashboard', 'In Progress', 'Not completed', 'Handholding Action Plan (Optional)']));
    // The opening meeting is needed first for the sections.
    await act(async () => handler(r, 'option-diagnostic-study').props.onPress());
    expect(texts(r)).toContain('Opening meeting is pending');
    // Without the site photos (toast) and before the sections are done (alert) nothing opens.
    await act(async () => handler(r, 'option-open-meeting').props.onPress());
    await act(async () => handler(r, 'option-closing-meeting').props.onPress());
    expect(byTestId(r, 'meeting')).toHaveLength(0);
    await act(async () => handler(r, 'option-site-photos').props.onPress());
    expect(byTestId(r, 'site-images')).toHaveLength(1);
  });

  it('without today\'s punch-in the attendance opens by itself and the sections ask for it', async () => {
    const app = await appWith(loginAnswer({ isOpenMeetingSubmitted: true }), false);
    const r = render(app, 'AssessmentOptions');
    await act(async () => undefined);
    expect(byTestId(r, 'attendance')).toHaveLength(1);
  });

  it('a co-consultant has no meetings, basic information or training on ZED, and the final submission', async () => {
    const app = await appWith(loginAnswer({ userType: 2, isOpenMeetingSubmitted: true }));
    const r = render(app, 'AssessmentOptions');
    await act(async () => undefined);
    const ids = optionIds(r);
    expect(ids).toContain('option-final-submission');
    for (const id of ['option-site-photos', 'option-open-meeting', 'option-basic-info', 'option-training-on-zed', 'option-closing-meeting']) expect(ids).not.toContain(id);
  });

  it('second and third milestones show the progress review instead of the first milestone\'s sections', async () => {
    const app = await appWith(loginAnswer({ milestone: 3, isOpenMeetingSubmitted: true }));
    const r = render(app, 'AssessmentOptions');
    await act(async () => undefined);
    const ids = optionIds(r);
    expect(ids).toContain('option-progress-review');
    expect(texts(r)).toContain('Progress Review 2');
    for (const id of ['option-site-tour', 'option-diagnostic-study', 'option-handholding-action-plan', 'option-technology-intervention']) expect(ids).not.toContain(id);
  });

  it('technology upgradation: no attendance needed, its own section, no basic information or closing meeting', async () => {
    const app = await appWith(tuAnswer(), false);
    const r = render(app, 'AssessmentOptions');
    await act(async () => undefined);
    expect(byTestId(r, 'attendance')).toHaveLength(0);
    const ids = optionIds(r);
    expect(ids).toContain('option-technology-upgradation');
    for (const id of ['option-basic-info', 'option-closing-meeting', 'option-training-on-handholding', 'option-progress-review']) expect(ids).not.toContain(id);
  });

  it('renders nothing once the consultancy is removed from the phone', async () => {
    const app = await appWith();
    const r = render(app, 'AssessmentOptions');
    await act(async () => {
      await app.deleteAssessorData();
    });
    expect(byTestId(r, 'assessment-options')).toHaveLength(0);
  });
});

describe('CompanyProfileActivity', () => {
  it('shows the BDS and HAP dates, the address and the contact boxes, and "Proceed"', async () => {
    const app = await appWith();
    const r = render(app, 'CompanyProfile', { userType: 1, allottedParamsAvailable: true });
    expect(texts(r)).toEqual(
      expect.arrayContaining(['Welcome', 'BASIC INFORMATION', 'BDS (From & To)', '10/24/2026 - 10/31/2026', 'HAP (From & To)', 'UNIT ADDRESS', 'Plot 2, Test Road', 'State/UT', 'PIN Code', 'UNIT SPOC DETAILS', 'PROCEED']),
    );
  });

  it('the HAP dates belong to the first milestone only', async () => {
    const app = await appWith(loginAnswer({ milestone: 2 }));
    const r = render(app, 'CompanyProfile', { userType: 1, allottedParamsAvailable: true });
    expect(texts(r)).not.toContain('HAP (From & To)');
  });
});

describe('Baseline diagnostic study (ParametersFragment, RequirementFragment)', () => {
  it('copies the parameters, validates a requirement and completes the parameter', async () => {
    const app = await appWith(loginAnswer({ isOpenMeetingSubmitted: true }));
    const r = render(app, 'Module', { module: 'baselineDiagnostic' });
    expect(app.details!.baselineDiagnosticStudyData?.parameters).toHaveLength(2);
    expect(texts(r)).toEqual(expect.arrayContaining(['PARAMETERS', 'Test Parameter Two', '1 Question(s) | To Start']));
    await act(async () => handler(r, 'module-param-1').props.onPress());
    expect(texts(r)).toEqual(expect.arrayContaining(['REQUIREMENT', 'The unit trains its test staff']));
    await act(async () => handler(r, 'req-proceed').props.onPress());
    expect(texts(r)).toContain('Missing/Invalid Data');
    // Conformance "No" needs the gaps identified.
    // The picker's promise settles with the choice: press without waiting for it.
    act(() => void handler(r, 'req-conformance-press').props.onPress());
    await act(async () => handler(r, 'pick-item-1').props.onPress());
    await act(async () => handler(r, 'req-proceed').props.onPress());
    const param = app.details!.baselineDiagnosticStudyData!.parameters[1]!;
    expect(param.status).not.toBe(COMPLETED);
    act(() => void handler(r, 'req-gaps-add').props.onPress());
    act(() => handler(r, 'comment-input', 'onChangeText').props.onChangeText('No training plan'));
    await act(async () => handler(r, 'comment-add').props.onPress());
    await act(async () => handler(r, 'req-proceed').props.onPress());
    expect(param.status).toBe(COMPLETED);
    expect(param.requirements![0]).toMatchObject({ conformance: 'No', gapsIdentified: ['No training plan'], reviewNeeded: false });
    // The allotted parameters themselves are untouched.
    expect(app.details!.allottedParameters![1]!.status).toBe(0);
    expect(texts(r)).toContain('1 Question(s) | Completed');
  });
});

describe('Basic information (nine groups)', () => {
  it('a group is completed when its fields are filled; Proceed waits for all groups', async () => {
    const app = await appWith(loginAnswer({ isOpenMeetingSubmitted: true }));
    const r = render(app, 'BasicInformation');
    expect(texts(r)).toEqual(expect.arrayContaining(['Occupational (Workplace) Safety', 'Financial Performance (Previous Financial Year)']));
    expect(byTestId(r, 'basic-footer-proceed')[0]?.props.accessibilityState).toMatchObject({ disabled: true });
    await act(async () => handler(r, 'basic-section-financialPerformance').props.onPress());
    expect(app.details!.saBasicInformation!.financialPerformance.status.status).toBe(Status.IN_PROGRESS);
    await act(async () => handler(r, 'section-footer-proceed').props.onPress());
    expect(texts(r)).toContain('Required');
    act(() => handler(r, 'field-financialPerformance.turnover', 'onChangeText').props.onChangeText('120'));
    act(() => handler(r, 'field-financialPerformance.grossProfit', 'onChangeText').props.onChangeText('12'));
    await act(async () => handler(r, 'section-footer-proceed').props.onPress());
    expect(app.details!.saBasicInformation!.financialPerformance).toMatchObject({ turnover: '120', grossProfit: '12', status: { status: Status.COMPLETED } });
    expect(texts(r)).toContain('Completed');
  });
});
