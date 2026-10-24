import { AssessorStore, PREFS } from '../src/db/stores';
import { login, MILESTONES_MISMATCH, normalizeLoginInput } from '../src/flows/login';
import {
  addEntry,
  attendanceLog,
  gsonDate,
  isAttendanceDoneToday,
  isLoggedInToday,
  isLoggedOutToday,
  newAttendance,
  parseGsonDate,
  timeOf,
  totalHours,
} from '../src/attendance';
import { base64Decode } from '../src/util/base64';
import { FakeServer, makeApp } from './helpers/harness';
import { allocationAnswer, loginAnswer, SA_ID, tuAnswer, ZED_ID } from './helpers/fixtures';
import { memoryDb } from './helpers/sqljs';

const input = { assessorId: SA_ID, password: 'Secret1', zedId: ZED_ID };

describe('com.zed.assessmentdb (AssessorDataAccessObject with Gson DateFormat.FULL)', () => {
  it('reads rows written by the legacy app, with its full-style attendance dates', async () => {
    const db = await memoryDb();
    db.raw.run('create table if not exists AssessorData(UserId text, AssessorDataColumn text, OpenMeetingData text, SelfieData text, OpenCloseMeetingData text,  PRIMARY KEY (UserId));');
    db.raw.run('create table if not exists EvidenceData(UserId text, EvidenceId text, EvidenceDataColumn text, EvidenceTypeColumn integer,  PRIMARY KEY (EvidenceId));');
    const legacy = {
      ...loginAnswer({ isOpenMeetingSubmitted: true }),
      technologyUpgradationStatus: 'TO_START',
      zedTrainingInfo: { status: 'COMPLETED', trainingTopic: 'ZED basics' },
      attendanceData: { attendanceList: [{ time: 'Saturday, October 24, 2026 at 9:05:00 AM', attendanceType: 'LOGIN', isSubmitted: true, comments: 'Agenda' }] },
    };
    db.raw.run('INSERT INTO AssessorData VALUES (?, ?, ?, NULL, NULL)', [SA_ID + ZED_ID, JSON.stringify(legacy), JSON.stringify({ saId: SA_ID, zedId: ZED_ID, assessmentPhotos: [{ name: 'Site Exterior Photo', photo: 'B64' }] })]);
    const store = new AssessorStore(db);
    await store.ensureSchema();
    const d = await store.load(SA_ID + ZED_ID);
    expect(d?.zedTrainingInfo?.trainingTopic).toBe('ZED basics');
    const t = new Date(timeOf(d!.attendanceData!.attendanceList[0]!));
    expect([t.getFullYear(), t.getMonth(), t.getDate(), t.getHours(), t.getMinutes()]).toEqual([2026, 9, 24, 9, 5]);
    expect((await store.meeting(SA_ID + ZED_ID, true))?.assessmentPhotos?.[0]?.name).toBe('Site Exterior Photo');
  });

  it('writes and reads back the full date format; older variants and ISO dates still read', () => {
    const now = new Date(2026, 9, 24, 19, 17, 0);
    expect(gsonDate(now)).toBe('Saturday, October 24, 2026 at 7:17:00 PM');
    expect(parseGsonDate(gsonDate(now))).toBe(now.getTime());
    expect(parseGsonDate('October 24, 2026, 7:17:00 PM')).toBe(now.getTime());
    expect(parseGsonDate('Oct 24, 2026 12:05:09 AM')).toBe(new Date(2026, 9, 24, 0, 5, 9).getTime());
    expect(parseGsonDate('2026-10-24T19:17:00+05:30')).toBe(Date.parse('2026-10-24T19:17:00+05:30'));
    expect(parseGsonDate('')).toBe(0);
  });
});

describe('Login (LoginActivity)', () => {
  it('trims and upper-cases the IDs; a blank field stops', () => {
    expect(normalizeLoginInput(' zedcc1 ', ' pw ', 'zedmsme1')).toEqual({ assessorId: 'ZEDCC1', password: 'pw', zedId: 'ZEDMSME1' });
    expect(normalizeLoginInput('A', ' ', 'Z')).toBeNull();
  });

  it('calls the consultancy host, stores the first answer and keeps the offline credential as a hash', async () => {
    const server = new FakeServer(() => loginAnswer());
    const { app, prefs } = await makeApp(server);
    const out = await login(app, input, true);
    expect(out).toMatchObject({ kind: 'proceed', userType: 1, allottedParamsAvailable: true, toast: 'Login Successful.' });
    expect(server.last('SA/Login')!.url).toBe('http://10.0.2.2:5105/consultancymobileapi/SA/Login');
    expect(server.last('SA/Login')!.json).toMatchObject({ assessorId: SA_ID, password: 'Secret1', zedId: ZED_ID, version: '1.3', deviceInfo: { deviceId: 'test-device-1' } });
    expect(app.details!.milestone).toBe(1);
    expect(prefs.get(PREFS.login, PREFS.loginPassword)).toMatch(/^zed1\$pbkdf2-sha256\$/);
    expect(base64Decode(prefs.get(PREFS.login, PREFS.loginAssessorId)!)).toBe(SA_ID);
    expect((await login(app, { ...input, password: 'secret1' }, false)).kind).toBe('toast');
    expect(await login(app, input, false)).toMatchObject({ kind: 'proceed', allottedParamsAvailable: true });
  });

  it('later sign-ins keep the work on the phone and take the server flags; another milestone stops', async () => {
    let answer = loginAnswer();
    const { app } = await makeApp(new FakeServer(() => answer));
    await login(app, input, true);
    app.details!.baselineDiagnosticStudyData = { status: 'IN_PROGRESS' as never, parameters: [] };
    await app.update();
    answer = loginAnswer({ isOpenMeetingSubmitted: true, isBasicInfoSubmitted: true });
    expect((await login(app, input, true)).kind).toBe('proceed');
    expect(app.details!.baselineDiagnosticStudyData?.status).toBe('IN_PROGRESS');
    expect(app.details!.isOpenMeetingSubmitted).toBe(true);
    expect(app.details!.isBasicInfoSubmitted).toBe(true);
    answer = loginAnswer({ milestone: 2 });
    expect(await login(app, input, true)).toEqual({ kind: 'alert', message: MILESTONES_MISMATCH });
  });

  it('a stored technology upgradation without parameters is kept; no offline credential then', async () => {
    let answer = tuAnswer();
    const { app, prefs } = await makeApp(new FakeServer(() => answer));
    expect(await login(app, input, true)).toMatchObject({ kind: 'proceed', allottedParamsAvailable: false });
    app.details!.technologyUpgradationStatus = 'SUBMITTED' as never;
    await app.update();
    answer = tuAnswer();
    await login(app, input, true);
    expect(app.details!.technologyUpgradationStatus).toBe('SUBMITTED');
    expect(prefs.get(PREFS.login, PREFS.loginPassword)).toBeFalsy();
  });

  it('before the allocation the answer is replaced at each sign-in', async () => {
    let answer = allocationAnswer();
    const { app } = await makeApp(new FakeServer(() => answer));
    expect(await login(app, input, true)).toMatchObject({ kind: 'proceed', allottedParamsAvailable: false });
    answer = loginAnswer();
    expect(await login(app, input, true)).toMatchObject({ kind: 'proceed', allottedParamsAvailable: true });
    expect(app.details!.allottedParameters).toHaveLength(2);
  });

  it('answers the update dialog, the server message, or the legacy default', async () => {
    const server = new FakeServer(() => ({ status: '2' }));
    const { app } = await makeApp(server);
    expect(await login(app, input, true)).toEqual({ kind: 'update' });
    server.responder = () => ({ status: '0', errorMessage: 'Handholding Consultant not yet allocated for the ZEDID: X' });
    expect(await login(app, input, true)).toEqual({ kind: 'toast', message: 'Handholding Consultant not yet allocated for the ZEDID: X' });
    server.responder = () => ({ status: '0' });
    expect(await login(app, input, true)).toEqual({ kind: 'toast', message: 'Invalid Username or Password' });
  });
});

describe('Attendance (AttendanceData of this app: one punch in and one punch out per day)', () => {
  it('punch rules, today checks and the record', () => {
    const data = { attendanceList: [] as ReturnType<typeof newAttendance>[] };
    const yesterday = new Date(Date.now() - 86_400_000);
    yesterday.setHours(9, 0, 0, 0);
    expect(addEntry(data, newAttendance(null, null, 'LOGIN', yesterday))).toBeNull();
    expect(isLoggedInToday(data)).toBe(false);
    const morning = new Date();
    morning.setHours(0, 30, 0, 0);
    expect(addEntry(data, newAttendance(null, 'Visit', 'LOGIN', morning))).toBeNull();
    expect(addEntry(data, newAttendance(null, null, 'LOGIN', morning))).toBe("Today's login already captured");
    expect(isLoggedInToday(data)).toBe(true);
    expect(isAttendanceDoneToday(data)).toBe(false);
    const later = new Date(morning.getTime() + 3 * 3_600_000);
    expect(addEntry(data, newAttendance(null, null, 'LOGOUT', later))).toBeNull();
    expect(addEntry(data, newAttendance(null, null, 'LOGOUT', later))).toBe("Today's logout already captured");
    expect(isLoggedOutToday(data)).toBe(true);
    expect(isAttendanceDoneToday(data)).toBe(true);
    const log = attendanceLog(data.attendanceList);
    expect(log).toHaveLength(2);
    expect(totalHours(log[1]!)).toBe('3 hrs');
    expect(data.attendanceList[1]!.comments).toBe('Visit');
  });
});
