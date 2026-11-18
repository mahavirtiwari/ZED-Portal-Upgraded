import React from 'react';
import { ToastAndroid } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StackNavigator, UiHost, type PhotoData } from '@zed/shared';
import { SCREENS } from '../App';
import { SaAppProvider } from '../src/app/context';
import type { SaApp } from '../src/app/SaApp';
import { stripPhotos } from '../src/clearData';
import { openAssessment, signIn } from '../src/flows/login';
import { jobKey, queueAttendance, queueTraining, saveOpenMeetingOffline } from '../src/flows/submissions';
import { EVIDENCE_ADDED, EVIDENCE_SITE_TOUR, newBasicInformation, Status, type AllottedParameters, type Attendance, type ConsultantPhoto } from '../src/models';
import type { AssessmentSummary } from '../src/portfolio';
import { deletedFiles, FakeServer, makeApp } from './helpers/harness';
import { loginAnswer, SA_ID, ZED_ID } from './helpers/fixtures';

jest.setTimeout(60000);

const ID = SA_ID + ZED_ID;
const OWNER = ZED_ID + SA_ID;

const unit = (over: Partial<AssessmentSummary> = {}): AssessmentSummary => ({
  zedId: ZED_ID,
  certificationType: 'Silver',
  enterpriseName: 'RN Consultancy Unit Pvt Ltd',
  stage: 'inProgress',
  canOpen: true,
  userType: 1,
  milestone: 1,
  ...over,
});

function server() {
  return new FakeServer(r => {
    const name = r.url.split('/SA/')[1]?.split('?')[0] ?? '';
    if (name === 'SignIn') return { status: '1', appToken: 'tok-a', profile: { assessorId: SA_ID, name: 'RN Lead Consultant' }, assessments: [unit()] };
    if (name === 'Assessment') return { ...loginAnswer(), appToken: 'tok-u' };
    return { status: '1' };
  });
}

const stored = (photoId: string, size: number): PhotoData => ({ photoId, photo: 'P'.repeat(size), photoPath: `/files/${photoId}.jpg`, associatedId: OWNER, status: 0, isPdf: false });
const ref = (p: PhotoData): ConsultantPhoto => ({ ...p, photo: null });

/** The allotted parameters with a captured photo on the first requirement (a milestone deliverable's copy). */
function withPhoto(params: AllottedParameters[], photo: ConsultantPhoto): AllottedParameters[] {
  const copy = JSON.parse(JSON.stringify(params)) as AllottedParameters[];
  Object.assign(copy[0]!.requirements![0]!, { conformance: 'Yes', capturedEvidences: [photo] });
  return copy;
}

/** A first milestone with work in many sections: trainings, the diagnostic study (unsent), the action plan (sent), attendance, meeting, site tour. */
async function withWork(app: SaApp) {
  await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
  await openAssessment(app, unit(), true);
  const d = app.details!;
  for (const p of [stored('train-1', 4000), stored('cap-1', 4000), stored('plan-1', 400), stored('self-1', 8000)]) await app.photos.insert(p);
  d.zedTrainingInfo = { status: Status.IN_PROGRESS, trainingTopic: 'ZED', trainingPhoto: [ref(stored('train-1', 0))] };
  d.handholdingTraining = { status: Status.IN_PROGRESS, remarks: 'Planned' };
  d.baselineDiagnosticStudyData = { status: Status.IN_PROGRESS, parameters: withPhoto(d.allottedParameters!, ref(stored('cap-1', 0))) };
  d.handholdingActionPlanData = { status: Status.SUBMITTED, parameters: withPhoto(d.allottedParameters!, ref(stored('plan-1', 0))) };
  d.saBasicInformation = { ...newBasicInformation(), status: Status.IN_PROGRESS };
  const entry: Attendance = { time: '2026-10-24T09:00:00+05:30', attendanceType: 'LOGIN', isSubmitted: false, selfie: ref(stored('self-1', 0)) };
  d.attendanceData = { attendanceList: [entry] };
  await app.update();
  await queueAttendance(app, entry);
  await queueTraining(app, false);
  await queueTraining(app, true);
  await saveOpenMeetingOffline(
    app,
    { saId: SA_ID, zedId: ZED_ID, certificationType: 'Silver', userType: 1, assessmentPhotos: [{ photoId: 'site-1', photo: 'E'.repeat(400), type: 0, name: 'Site Exterior Photo' }] },
    [{ name: 'MD', designation: 'Owner' }],
  );
  await app.store.saveEvidence(app.userId, { photoId: 'tour-1', evidenceId: 'T1', photo: 'F'.repeat(4000), type: EVIDENCE_SITE_TOUR });
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
const press = async (r: ReactTestRenderer.ReactTestRenderer, id: string) => {
  const node = r.root.findAll(n => n.props.testID === id && typeof n.props.onPress === 'function')[0];
  if (!node) throw new Error(`nothing to press: ${id}`);
  await act(async () => node.props.onPress());
  await act(async () => undefined);
};
const disabled = (r: ReactTestRenderer.ReactTestRenderer, id: string) => !!r.root.findAll(n => n.props.testID === id && n.props.accessibilityState)[0]!.props.accessibilityState.disabled;
const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAll(n => (n.type as unknown) === 'Text').map(n => (Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '')));

describe('Clear data sections (store and app)', () => {
  it('lists every section of the milestone the phone holds data for, with its size and an unsynced mark', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    const sections = await app.dataSections(ZED_ID);
    expect(sections.map(s => s.id)).toEqual([
      'allocation',
      'attendance',
      'open-meeting',
      'site-tour',
      'training-on-zed',
      'diagnostic-study',
      'basic-info',
      'handholding-action-plan',
      'training-on-handholding',
    ]);
    const by = Object.fromEntries(sections.map(s => [s.id, s]));
    expect(by.allocation).toMatchObject({ detail: '2 parameters', unsent: false, note: 'Downloaded again when you open the case online.' });
    expect(by.attendance).toMatchObject({ detail: '1 day · 1 selfie · 6 KB', unsent: true });
    expect(by['open-meeting']).toMatchObject({ title: 'Opening Meeting & site photos', detail: '2 records · 1 photo · 1 KB', unsent: true });
    expect(by['training-on-zed']).toMatchObject({ detail: '1 record · 1 photo · 3 KB', unsent: true });
    expect(by['diagnostic-study']).toMatchObject({ title: 'Baseline Diagnostic Study', detail: '2 parameters · 1 photo · 3 KB', unsent: true });
    expect(by['handholding-action-plan']).toMatchObject({ detail: '2 parameters · 1 photo · 1 KB', unsent: false, note: 'Sent: only the photos kept on the phone are removed.' });
    expect(by['basic-info']).toMatchObject({ title: 'Basic Information', detail: '1 record', unsent: true });
  });

  it('store: a partial update keeps the meeting column; evidences go by kind or ID', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    expect(await app.store.updateDetails(ID, d => void delete d.zedTrainingInfo)).toBe(true);
    expect((await app.store.load(ID))!.zedTrainingInfo).toBeUndefined();
    expect((await app.store.load(ID))!.baselineDiagnosticStudyData).toBeDefined();
    expect(await app.store.meeting(ID, true)).not.toBeNull();
    await app.store.saveEvidence(ID, { photoId: 'add-1', evidenceId: 'A1', photo: 'x', type: EVIDENCE_ADDED });
    expect(await app.store.deleteEvidences(ID, ['A1'])).toBe(1);
    expect(await app.store.deleteEvidencesOfType(ID, EVIDENCE_SITE_TOUR)).toBe(1);
  });

  it('an unsent deliverable starts again: its record and photos go, the other deliverables stay', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    deletedFiles.length = 0;
    expect(await app.clearSections(ZED_ID, ['diagnostic-study'])).toBe(true);
    const row = (await app.store.load(ID))!;
    expect(row.baselineDiagnosticStudyData).toBeUndefined();
    expect(app.details!.baselineDiagnosticStudyData).toBeUndefined();
    expect(row.handholdingActionPlanData!.parameters).toHaveLength(2);
    expect(row.zedTrainingInfo!.trainingPhoto).toHaveLength(1);
    expect(await app.photos.get('cap-1')).toBeNull();
    expect(deletedFiles).toEqual(['/files/cap-1.jpg']);
    expect(await app.photos.get('plan-1')).not.toBeNull();
    expect(await app.store.meeting(ID, true)).not.toBeNull();
  });

  it('a sent deliverable keeps its answers and status; only the photo copies go', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    await app.clearSections(ZED_ID, ['handholding-action-plan']);
    const plan = (await app.store.load(ID))!.handholdingActionPlanData!;
    expect(plan.status).toBe(Status.SUBMITTED);
    expect(plan.parameters[0]!.requirements![0]!.conformance).toBe('Yes');
    expect(plan.parameters[0]!.requirements![0]!.capturedEvidences).toEqual([]);
    expect(await app.photos.get('plan-1')).toBeNull();
  });

  it('a training: its record, photos and only its own queued send go', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    await app.clearSections(ZED_ID, ['training-on-zed']);
    expect(app.details!.zedTrainingInfo).toBeUndefined();
    expect(app.details!.handholdingTraining).toBeDefined();
    expect(await app.queue.get(jobKey(app, 'zedTraining'))).toBeNull();
    expect(await app.queue.get(jobKey(app, 'handholdingTraining'))).not.toBeNull();
    expect(await app.photos.get('train-1')).toBeNull();
  });

  it('opening meeting saved offline: the saved meeting with its site photos and its queued send go', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    await app.clearSections(ZED_ID, ['open-meeting', 'site-tour']);
    expect(await app.store.meeting(ID, true)).toBeNull();
    expect(await app.queue.get(jobKey(app, 'openMeeting'))).toBeNull();
    expect(app.details!.isOpenMeetingSubmitted).toBe(false);
    expect(await app.store.evidencesOfType(ID, EVIDENCE_SITE_TOUR)).toHaveLength(0);
    expect(app.details!.attendanceData!.attendanceList).toHaveLength(1);
  });

  it('attendance: the entries, selfie photo and queued sends go', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    await app.clearSections(ZED_ID, ['attendance']);
    expect(app.details!.attendanceData!.attendanceList).toEqual([]);
    expect(await app.photos.get('self-1')).toBeNull();
    expect((await app.queue.list(ID)).map(j => j.kind).sort()).toEqual(['openMeeting', 'training', 'training']);
  });

  it('parameter allocation: downloaded again on the next open; the deliverables and other sections stay', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    await app.clearSections(ZED_ID, ['allocation']);
    expect((await app.store.load(ID))!.allottedParameters).toBeUndefined();
    app.closeAssessment();
    expect((await openAssessment(app, unit(), true)).kind).toBe('open');
    const d = app.details!;
    expect(d.allottedParameters).toHaveLength(2);
    expect(d.baselineDiagnosticStudyData!.parameters).toHaveLength(2);
    expect(d.zedTrainingInfo!.trainingTopic).toBe('ZED');
    expect(d.attendanceData!.attendanceList).toHaveLength(1);
    expect(d.isOpenMeetingSubmitted).toBe(true);
  });

  it('everything: the row, its evidences, photos and queued sends', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    expect(await app.deleteStoredAssessment(ZED_ID)).toBe(true);
    expect(await app.storedAssessment(ZED_ID)).toBeNull();
    expect(await app.queue.list(ID)).toEqual([]);
    expect(await app.photos.byAssociatedId(OWNER)).toEqual([]);
  });

  it('stripPhotos takes photos out of lists and fields, the rest stays', () => {
    const data = { a: [{ photoId: 'x' }, 'keep'], b: { photoId: 'y' }, c: { d: [{ photoId: 'z' }], e: 1 } };
    stripPhotos(data);
    expect(data).toEqual({ a: ['keep'], c: { d: [], e: 1 } });
  });
});

describe('Clear data sheet', () => {
  let toast: jest.SpyInstance;
  beforeEach(() => {
    toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => undefined);
  });
  afterEach(() => toast.mockRestore());

  it('the case card opens the sheet; a synced section clears after one confirmation', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    app.closeAssessment();
    const r = render(app, 'Home');
    await act(async () => undefined);
    await press(r, 'clean-' + ZED_ID);
    expect(byTestId(r, 'clear-data')).toHaveLength(1);
    expect(texts(r)).toEqual(expect.arrayContaining(['CLEAR DATA', 'RN Consultancy Unit Pvt Ltd', '0 of 9 selected', 'Unsynced data cannot be recovered. Sync before clearing.']));
    expect(byTestId(r, 'clear-unsent-handholding-action-plan')).toHaveLength(0);
    expect(byTestId(r, 'clear-unsent-diagnostic-study')).toHaveLength(1);
    expect(disabled(r, 'clear-selected')).toBe(true);
    await press(r, 'clear-row-handholding-action-plan');
    expect(texts(r)).toContain('1 of 9 selected');
    await press(r, 'clear-selected');
    expect(byTestId(r, 'clear-understand')).toHaveLength(0);
    await press(r, 'clear-confirm');
    expect(await app.photos.get('plan-1')).toBeNull();
    expect(await app.photos.get('cap-1')).not.toBeNull();
    expect(toast).toHaveBeenCalledWith('1 section removed from the phone', expect.anything());
    expect(byTestId(r, 'clear-data')).toHaveLength(0);
  });

  it('sections with unsynced work need the second step (I understand)', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    app.closeAssessment();
    const r = render(app, 'Home');
    await act(async () => undefined);
    await press(r, 'clean-' + ZED_ID);
    await press(r, 'clear-row-diagnostic-study');
    await press(r, 'clear-row-training-on-zed');
    await press(r, 'clear-selected');
    expect(texts(r)).toContain('Clear 2 sections?');
    expect(disabled(r, 'clear-confirm')).toBe(true);
    await press(r, 'clear-understand');
    await press(r, 'clear-confirm');
    const row = (await app.store.load(ID))!;
    expect(row.baselineDiagnosticStudyData).toBeUndefined();
    expect(row.zedTrainingInfo).toBeUndefined();
    expect(row.saBasicInformation).toBeDefined();
    expect(toast).toHaveBeenCalledWith('2 sections removed from the phone', expect.anything());
  });

  it('Remove everything needs CLEAR typed while anything is unsynced', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    app.closeAssessment();
    const r = render(app, 'Home');
    await act(async () => undefined);
    await press(r, 'clean-' + ZED_ID);
    await press(r, 'clear-everything');
    expect(disabled(r, 'clear-everything-confirm')).toBe(true);
    const input = r.root.findAll(n => n.props.testID === 'clear-type' && typeof n.props.onChangeText === 'function')[0]!;
    await act(async () => input.props.onChangeText('CLEA'));
    expect(disabled(r, 'clear-everything-confirm')).toBe(true);
    await act(async () => input.props.onChangeText('CLEAR'));
    await press(r, 'clear-everything-confirm');
    expect(await app.storedAssessment(ZED_ID)).toBeNull();
    expect(byTestId(r, 'clean-' + ZED_ID)).toHaveLength(0);
    expect(toast).toHaveBeenCalledWith('Case data removed from the phone', expect.anything());
  });
});
