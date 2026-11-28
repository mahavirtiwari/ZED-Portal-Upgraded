import React from 'react';
import { ToastAndroid } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StackNavigator, UiHost, type PhotoData } from '@zed/shared';
import { SCREENS } from '../App';
import { SaAppProvider } from '../src/app/context';
import type { SaApp } from '../src/app/SaApp';
import { formatBytes, photosIn } from '../src/clearData';
import { openAssessment, signIn } from '../src/flows/login';
import { jobKey, queueAttendance, saveOpenMeetingOffline, saveSelfieOffline } from '../src/flows/submissions';
import { COMPLETED, EVIDENCE_ADDED, EVIDENCE_SITE_TOUR, newBasicInformation, SUBMITTED, TO_START, type Attendance } from '../src/models';
import type { AssessmentSummary } from '../src/portfolio';
import { deletedFiles, FakeServer, makeApp } from './helpers/harness';
import { loginAnswer, SA_ID, ZED_ID } from './helpers/fixtures';

jest.setTimeout(60000);

const ID = SA_ID + ZED_ID;
const OWNER = ZED_ID + SA_ID;

const unit = (over: Partial<AssessmentSummary> = {}): AssessmentSummary => ({
  zedId: ZED_ID,
  certificationType: 'Silver',
  enterpriseName: 'RN Test Enterprise',
  stage: 'inProgress',
  canOpen: true,
  userType: 1,
  ...over,
});

function server(surveillance = false) {
  const s = new FakeServer(r => {
    const name = r.url.split('/SA/')[1]?.split('?')[0] ?? '';
    const surv = r.url.includes('surveillancemobileapi');
    if (name === 'SignIn')
      return {
        status: '1',
        appToken: surv ? 'tok-s' : 'tok-a',
        profile: { assessorId: SA_ID, name: 'RN Lead Assessor' },
        assessments: surv ? [unit({ zedId: 'ZEDS000009', enterpriseName: 'Surveillance Unit' })] : [unit()],
      };
    if (name === 'Assessment') return { ...loginAnswer(), appToken: 'tok-u' };
    return { status: '1' };
  });
  s.surveillanceOnline = surveillance;
  return s;
}

const stored = (photoId: string, size: number): PhotoData => ({ photoId, photo: 'P'.repeat(size), photoPath: `/files/${photoId}.jpg`, associatedId: OWNER, status: 0, isPdf: false });
const ref = (p: PhotoData): PhotoData => ({ ...p, photo: null });

/** An assessment with work in every step: a parameter answered with a photo (unsent), one submitted, attendance, basic info, meeting, site tour. */
async function withWork(app: SaApp) {
  await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
  await openAssessment(app, unit(), true);
  const d = app.details!;
  const [p1, p2] = d.allottedParameters!;
  const photo = { photoId: 'ev-1', evidenceId: 'E1', photo: 'A'.repeat(4000), name: 'Test record', type: EVIDENCE_ADDED };
  Object.assign(p1!.requirements![0]!, { conformance: 'Yes', comments: 'Seen on site', addedEvidences: [photo] });
  p1!.status = COMPLETED;
  await app.store.saveEvidence(app.userId, photo);
  Object.assign(p2!.requirements![0]!, { conformance: 'No', addedEvidences: [{ photoId: 'ev-2', evidenceId: 'E2', photo: 'B'.repeat(400), type: EVIDENCE_ADDED }] });
  p2!.status = SUBMITTED;
  const selfie = stored('self-1', 8000);
  await app.photos.insert(selfie);
  const entry: Attendance = { time: '2026-10-24T09:00:00+05:30', attendanceType: 'LOGIN', isSubmitted: false, selfie: ref(selfie) };
  d.attendanceData = { attendanceList: [entry] };
  const product = stored('prod-1', 4000);
  await app.photos.insert(product);
  d.saBasicInformation = { ...newBasicInformation(), productDetailsList: [{ id: '1', productName: 'Widget', productPhoto: ref(product) }] };
  await app.update();
  await queueAttendance(app, entry);
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
  it('lists every step the phone holds data for, with its size and an unsynced mark', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    const sections = await app.dataSections(ZED_ID);
    expect(sections.map(s => s.id)).toEqual(['allocation', 'attendance', 'open-meeting', 'site-tour', 'basic-info', 'parameter:9101', 'parameter:9102']);
    const by = Object.fromEntries(sections.map(s => [s.id, s]));
    expect(by.attendance).toMatchObject({ title: 'Attendance', detail: '1 day · 1 selfie · 6 KB', unsent: true });
    expect(by['open-meeting']).toMatchObject({ detail: '2 records · 1 photo · 1 KB', unsent: true });
    expect(by['site-tour']).toMatchObject({ title: 'Site tour photographs', detail: '1 photo · 3 KB', unsent: true });
    expect(by['basic-info']).toMatchObject({ detail: '1 record · 1 photo · 3 KB', unsent: true });
    expect(by['parameter:9101']).toMatchObject({ title: 'Checklist · Test Parameter One', detail: '1 answer · 1 photo · 3 KB', unsent: true });
    expect(by['parameter:9102']).toMatchObject({ unsent: false, note: 'Submitted: only the photos kept on the phone are removed.' });
    expect(by.allocation).toMatchObject({ detail: '2 parameters · 2 photos · 3 KB', unsent: true });
    expect(formatBytes(24.6 * 1024 * 1024)).toBe('24.6 MB');
    expect(photosIn({ a: [{ photoId: 'x' }, { b: { photoId: 'y' } }], c: { photoId: 'x' } }).map(p => p.photoId)).toEqual(['x', 'y']);
  });

  it('store: a partial update keeps the meeting columns; evidences go by kind or ID', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    expect(await app.store.updateDetails(ID, d => void delete d.saBasicInformation)).toBe(true);
    expect((await app.store.load(ID))!.saBasicInformation).toBeUndefined();
    expect((await app.store.load(ID))!.attendanceData!.attendanceList).toHaveLength(1);
    expect(await app.store.meeting(ID, true)).not.toBeNull();
    expect(await app.store.updateDetails('nobody', () => undefined)).toBe(false);
    expect(await app.store.deleteEvidences(ID, ['E1', null, 'missing'])).toBe(1);
    expect(await app.store.evidencesOfType(ID, EVIDENCE_SITE_TOUR)).toHaveLength(1);
    expect(await app.store.deleteEvidencesOfType(ID, EVIDENCE_SITE_TOUR)).toBe(1);
  });

  it('one parameter: its answers, remarks and evidences go; the other parameter and steps stay', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    expect(await app.clearSections(ZED_ID, ['parameter:9101'])).toBe(true);
    const row = (await app.store.load(ID))!;
    const [p1, p2] = row.allottedParameters!;
    expect(p1!.status).toBe(TO_START);
    expect(p1!.requirements![0]).not.toHaveProperty('conformance');
    expect(p1!.requirements![0]).not.toHaveProperty('addedEvidences');
    expect(p2!.status).toBe(SUBMITTED);
    expect(p2!.requirements![0]!.conformance).toBe('No');
    expect(app.details!.allottedParameters![0]!.status).toBe(TO_START);
    expect(await app.store.evidence(ID, 'E1')).toBeNull();
    expect(await app.store.evidencesOfType(ID, EVIDENCE_SITE_TOUR)).toHaveLength(1);
    expect(await app.store.meeting(ID, true)).not.toBeNull();
    expect(row.attendanceData!.attendanceList).toHaveLength(1);
    expect((await app.queue.list(ID)).map(j => j.kind).sort()).toEqual(['attendance', 'openMeeting']);
  });

  it('a submitted parameter: only the photo copies go', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    await app.clearSections(ZED_ID, ['parameter:9102']);
    const p2 = (await app.store.load(ID))!.allottedParameters![1]!;
    expect(p2.status).toBe(SUBMITTED);
    expect(p2.requirements![0]!.conformance).toBe('No');
    expect(p2.requirements![0]!.addedEvidences).toBeUndefined();
  });

  it('opening meeting saved offline: the saved meeting and its queued send go, it is to be held again', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    await app.clearSections(ZED_ID, ['open-meeting']);
    expect(await app.store.meeting(ID, true)).toBeNull();
    expect(await app.queue.get(jobKey(app, 'openMeeting'))).toBeNull();
    expect(app.details!.isOpenMeetingSubmitted).toBe(false);
    expect(app.details!.openMeetingParticipants).toBeUndefined();
    expect((await app.queue.list(ID)).map(j => j.kind)).toEqual(['attendance']);
  });

  it('attendance: the entries, the selfie photo and file and the queued sends go; other photos stay', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    deletedFiles.length = 0;
    await app.clearSections(ZED_ID, ['attendance']);
    expect(app.details!.attendanceData!.attendanceList).toEqual([]);
    expect(await app.photos.get('self-1')).toBeNull();
    expect(deletedFiles).toEqual(['/files/self-1.jpg']);
    expect(await app.photos.get('prod-1')).not.toBeNull();
    expect((await app.queue.list(ID)).map(j => j.kind)).toEqual(['openMeeting']);
  });

  it('basic info: a photo still used by another section stays', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    const d = app.details!;
    d.basicInformation!.productDetailsList[0]!.productPhoto = ref(stored('prod-1', 0));
    await app.update();
    deletedFiles.length = 0;
    await app.clearSections(ZED_ID, ['basic-info']);
    expect((await app.store.load(ID))!.saBasicInformation).toBeUndefined();
    expect(await app.photos.get('prod-1')).not.toBeNull();
    expect(deletedFiles).toEqual([]);
  });

  it('2026-11-28: a cleared section takes its photos and files with it (they no longer show again under Other photos)', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    const tour = stored('tour-2', 4000);
    await app.photos.insert(tour);
    await app.store.saveEvidence(app.userId, { ...ref(tour), evidenceId: 'T2', type: EVIDENCE_SITE_TOUR });
    const meeting = stored('site-1', 400);
    await app.photos.insert(meeting);
    deletedFiles.length = 0;
    await app.clearSections(ZED_ID, ['site-tour', 'open-meeting']);
    expect(await app.photos.get('tour-2')).toBeNull();
    expect(await app.photos.get('site-1')).toBeNull();
    expect(deletedFiles.sort()).toEqual(['/files/site-1.jpg', '/files/tour-2.jpg']);
    const left = (await app.dataSections(ZED_ID)).map(s => s.id);
    expect(left).not.toContain('site-tour');
    expect(left).not.toContain('open-meeting');
    expect(left).not.toContain('other-photos');
    // Another step's photo stays.
    expect(await app.photos.get('prod-1')).not.toBeNull();
  });

  it('site tour and selfie: only their rows go', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    await saveSelfieOffline(app, { saId: SA_ID, zedId: ZED_ID, certificationType: 'Silver', selfieImage: { photoId: 's', photo: 'S'.repeat(100), type: 0 } });
    expect((await app.dataSections(ZED_ID)).find(s => s.id === 'selfie')).toMatchObject({ unsent: true });
    await app.clearSections(ZED_ID, ['site-tour', 'selfie']);
    expect(await app.store.evidencesOfType(ID, EVIDENCE_SITE_TOUR)).toHaveLength(0);
    expect(await app.store.evidencesOfType(ID, EVIDENCE_ADDED)).toHaveLength(1);
    expect(await app.store.selfie(ID)).toBeNull();
    expect(app.details!.isSelfieSubmitted).toBe(false);
    expect(await app.queue.get(jobKey(app, 'selfie'))).toBeNull();
  });

  it('parameter allocation: downloaded again on the next open; the phone’s other steps stay', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    await app.clearSections(ZED_ID, ['allocation']);
    expect((await app.store.load(ID))!.allottedParameters).toBeUndefined();
    expect(await app.store.evidence(ID, 'E1')).toBeNull();
    app.closeAssessment();
    expect((await openAssessment(app, unit(), true)).kind).toBe('open');
    const d = app.details!;
    expect(d.allottedParameters).toHaveLength(2);
    expect(d.allottedParameters![0]!.requirements![0]!.conformance).toBeUndefined();
    expect(d.attendanceData!.attendanceList).toHaveLength(1);
    expect(d.saBasicInformation).toBeDefined();
    expect(d.isOpenMeetingSubmitted).toBe(true);
    expect((await app.store.load(ID)) as Record<string, unknown>).not.toHaveProperty('reloadAllocation');
  });

  it('everything: the row, its evidences, photos and queued sends', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    expect(await app.deleteStoredAssessment(ZED_ID)).toBe(true);
    expect(await app.storedAssessment(ZED_ID)).toBeNull();
    expect(await app.queue.list(ID)).toEqual([]);
    expect(await app.photos.byAssociatedId(OWNER)).toEqual([]);
    expect(await app.store.evidencesOfType(ID, EVIDENCE_SITE_TOUR)).toEqual([]);
  });
});

describe('Clear data sheet', () => {
  let toast: jest.SpyInstance;
  beforeEach(() => {
    toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => undefined);
  });
  afterEach(() => toast.mockRestore());

  it('the card opens the sheet; a synced step clears after one confirmation', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    app.details!.isSiteTourSubmitted = true;
    await app.update();
    app.closeAssessment();
    const r = render(app, 'Home');
    await act(async () => undefined);
    await press(r, 'clean-' + ZED_ID);
    expect(byTestId(r, 'clear-data')).toHaveLength(1);
    expect(texts(r)).toEqual(expect.arrayContaining(['CLEAR DATA', 'RN Test Enterprise', 'Select the captured data to remove from this device. Synced data stays on the server.', '0 of 7 selected']));
    expect(texts(r)).toContain('Unsynced data cannot be recovered. Sync before clearing.');
    expect(byTestId(r, 'clear-unsent-site-tour')).toHaveLength(0);
    expect(byTestId(r, 'clear-unsent-open-meeting')).toHaveLength(1);
    expect(disabled(r, 'clear-selected')).toBe(true);
    await press(r, 'clear-row-site-tour');
    expect(texts(r)).toContain('1 of 7 selected');
    await press(r, 'clear-selected');
    expect(byTestId(r, 'clear-confirm-step')).toHaveLength(1);
    expect(byTestId(r, 'clear-understand')).toHaveLength(0);
    expect(disabled(r, 'clear-confirm')).toBe(false);
    await press(r, 'clear-confirm');
    expect(await app.store.evidencesOfType(ID, EVIDENCE_SITE_TOUR)).toHaveLength(0);
    expect(await app.store.meeting(ID, true)).not.toBeNull();
    expect(toast).toHaveBeenCalledWith('1 section removed from the phone', expect.anything());
    expect(byTestId(r, 'clear-data')).toHaveLength(0);
  });

  it('a step with unsynced work needs the second step (I understand)', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    app.closeAssessment();
    const r = render(app, 'Home');
    await act(async () => undefined);
    await press(r, 'clean-' + ZED_ID);
    await press(r, 'clear-row-open-meeting');
    await press(r, 'clear-selected');
    expect(byTestId(r, 'clear-confirm-warning')).toHaveLength(1);
    expect(disabled(r, 'clear-confirm')).toBe(true);
    await press(r, 'clear-back');
    expect(byTestId(r, 'clear-confirm-step')).toHaveLength(0);
    await press(r, 'clear-selected');
    await press(r, 'clear-understand');
    expect(disabled(r, 'clear-confirm')).toBe(false);
    await press(r, 'clear-confirm');
    expect(await app.store.meeting(ID, true)).toBeNull();
    expect(await app.store.evidencesOfType(ID, EVIDENCE_SITE_TOUR)).toHaveLength(1);
  });

  it('Select all, and Remove everything (typed CLEAR while unsynced)', async () => {
    const { app } = await makeApp(server());
    await withWork(app);
    app.closeAssessment();
    const r = render(app, 'Home');
    await act(async () => undefined);
    await press(r, 'clean-' + ZED_ID);
    await press(r, 'clear-select-all');
    expect(texts(r)).toContain('7 of 7 selected');
    await press(r, 'clear-select-all');
    expect(texts(r)).toContain('0 of 7 selected');
    await press(r, 'clear-everything');
    expect(byTestId(r, 'clear-everything-step')).toHaveLength(1);
    expect(disabled(r, 'clear-everything-confirm')).toBe(true);
    const input = r.root.findAll(n => n.props.testID === 'clear-type' && typeof n.props.onChangeText === 'function')[0]!;
    await act(async () => input.props.onChangeText('clear'));
    expect(disabled(r, 'clear-everything-confirm')).toBe(false);
    await press(r, 'clear-everything-confirm');
    expect(await app.storedAssessment(ZED_ID)).toBeNull();
    expect(byTestId(r, 'clean-' + ZED_ID)).toHaveLength(0);
  });

  it('a surveillance visit offers the same steps, marked as surveillance', async () => {
    const { app } = await makeApp(server(true));
    await signIn(app, { assessorId: SA_ID, password: 'Secret1' }, true);
    const surv = app.assessments.find(a => a.system === 'surveillance')!;
    await openAssessment(app, surv, true);
    expect(app.currentSystem).toBe('surveillance');
    await app.store.saveEvidence(app.userId, { photoId: 'tour-s', evidenceId: 'TS', photo: 'F'.repeat(400), type: EVIDENCE_SITE_TOUR });
    app.closeAssessment();
    const r = render(app, 'Home', { tab: 'assessments' });
    await act(async () => undefined);
    await press(r, 'clean-ZEDS000009');
    expect(byTestId(r, 'clear-data-surveillance')).toHaveLength(1);
    expect(byTestId(r, 'clear-row-allocation')).toHaveLength(1);
    await press(r, 'clear-row-site-tour');
    await press(r, 'clear-selected');
    await press(r, 'clear-understand');
    await press(r, 'clear-confirm');
    expect(await app.store.evidencesOfType(SA_ID + 'ZEDS000009', EVIDENCE_SITE_TOUR)).toHaveLength(0);
    expect(await app.storedAssessment('ZEDS000009')).not.toBeNull();
  });
});
