import { AssessorStore, PREFS } from '../src/db/stores';
import { login, normalizeLoginInput } from '../src/flows/login';
import { attendanceLog, addEntry, isAttendanceTakenToday, isLoggedOutToday, lastLogoutEntry, newAttendance, totalHours, gsonDate } from '../src/attendance';
import { base64Decode, base64EncodeDefault } from '../src/util/base64';
import { FakeServer, makeApp } from './helpers/harness';
import { allocationAnswer, loginAnswer, SA_ID, ZED_ID } from './helpers/fixtures';
import { memoryDb } from './helpers/sqljs';

const input = { assessorId: SA_ID, password: 'Secret1', zedId: ZED_ID };

describe('com.zed.assessmentdb (AssessorDataAccessObject, EvidenceDataAccessObject)', () => {
  it('reads rows written by the legacy app and keeps the meeting and selfie columns on save', async () => {
    const db = await memoryDb();
    // Exactly DBHelper.onCreate, then a row as createOrReplaceData and saveMeetingData wrote it.
    db.raw.run('create table if not exists AssessorData(UserId text, AssessorDataColumn text, OpenMeetingData text, SelfieData text, OpenCloseMeetingData text,  PRIMARY KEY (UserId));');
    db.raw.run('create table if not exists EvidenceData(UserId text, EvidenceId text, EvidenceDataColumn text, EvidenceTypeColumn integer,  PRIMARY KEY (EvidenceId));');
    db.raw.run('INSERT INTO AssessorData VALUES (?, ?, ?, NULL, NULL)', [SA_ID + ZED_ID, JSON.stringify(loginAnswer({ isOpenMeetingSubmitted: true })), JSON.stringify({ saId: SA_ID, zedId: ZED_ID, inputComment: "It's fine" })]);
    db.raw.run('INSERT INTO EvidenceData VALUES (?, ?, ?, 2)', [SA_ID + ZED_ID, SA_ID + '1', JSON.stringify({ photoId: 'u_1', evidenceId: SA_ID + '1', photo: 'B64\n', comment: 'Store', type: 2 })]);
    const store = new AssessorStore(db);
    await store.ensureSchema();
    const d = await store.load(SA_ID + ZED_ID);
    expect(d?.isOpenMeetingSubmitted).toBe(true);
    expect((await store.meeting(SA_ID + ZED_ID, true))?.inputComment).toBe("It's fine");
    expect((await store.evidencesOfType(SA_ID + ZED_ID, 2)).map(e => e.comment)).toEqual(['Store']);

    d!.isSelfieSubmitted = true;
    await store.save(SA_ID + ZED_ID, d!);
    expect((await store.load(SA_ID + ZED_ID))?.isSelfieSubmitted).toBe(true);
    expect((await store.meeting(SA_ID + ZED_ID, true))?.inputComment).toBe("It's fine"); // carried over
    expect(await store.clearMeeting(SA_ID + ZED_ID, true)).toBe(true);
    expect(await store.meeting(SA_ID + ZED_ID, true)).toBeNull();
  });
});

describe('Login (LoginActivity)', () => {
  it('trims and upper-cases the IDs; a blank field stops', () => {
    expect(normalizeLoginInput(' zedas1 ', ' pw ', 'zedmsme1')).toEqual({ assessorId: 'ZEDAS1', password: 'pw', zedId: 'ZEDMSME1' });
    expect(normalizeLoginInput('A', ' ', 'Z')).toBeNull();
  });

  it('stores the first answer, sends version and deviceInfo, and keeps the offline credential as a hash', async () => {
    const server = new FakeServer(() => loginAnswer());
    const { app, prefs } = await makeApp(server);
    const out = await login(app, input, true);
    expect(out).toMatchObject({ kind: 'proceed', userType: 1, allottedParamsAvailable: true, toast: 'Login Successful.' });
    expect(server.last('SA/Login')!.url).toBe('http://10.0.2.2:5104/mobileapi/SA/Login');
    expect(server.last('SA/Login')!.json).toMatchObject({ assessorId: SA_ID, password: 'Secret1', zedId: ZED_ID, version: '1.3', deviceInfo: { deviceId: 'test-device-1' } });
    expect(app.userId).toBe(SA_ID + ZED_ID);
    expect(prefs.get(PREFS.login, PREFS.loginPassword)).toMatch(/^zed1\$pbkdf2-sha256\$/);
    expect(base64Decode(prefs.get(PREFS.login, PREFS.loginAssessorId)!)).toBe(SA_ID);
    // Offline: the stored credential (exact case) and the stored assessment.
    expect((await login(app, { ...input, password: 'secret1' }, false)).kind).toBe('toast');
    expect(await login(app, input, false)).toMatchObject({ kind: 'proceed', allottedParamsAvailable: true });
  });

  it('later sign-ins keep the work on the phone and take the server flags', async () => {
    let answer = loginAnswer();
    const { app } = await makeApp(new FakeServer(() => answer));
    await login(app, input, true);
    app.details!.allottedParameters![0]!.status = 2;
    await app.update();
    answer = loginAnswer({ isOpenMeetingSubmitted: true, allowFinalSubmit: true });
    await login(app, input, true);
    expect(app.details!.allottedParameters![0]!.status).toBe(2);
    expect(app.details!.isOpenMeetingSubmitted).toBe(true);
    expect(app.details!.allowFinalSubmit).toBe(true);
  });

  it('before the allocation: no offline credential, the lead allocates', async () => {
    const { app, prefs } = await makeApp(new FakeServer(() => allocationAnswer()));
    expect(await login(app, input, true)).toMatchObject({ kind: 'proceed', allottedParamsAvailable: false });
    expect(prefs.get(PREFS.login, PREFS.loginPassword)).toBeNull();
    expect(app.details!.inputParameters).toHaveLength(3);
  });

  it('accepts a legacy Base64 credential once and replaces it by a hash', async () => {
    const { app, prefs } = await makeApp(new FakeServer());
    await app.saveDetails(loginAnswer(), SA_ID, ZED_ID);
    prefs.set(PREFS.login, PREFS.loginAssessorId, base64EncodeDefault(SA_ID));
    prefs.set(PREFS.login, PREFS.loginPassword, base64EncodeDefault('Secret1'));
    prefs.set(PREFS.login, PREFS.loginZedId, base64EncodeDefault(ZED_ID));
    expect(base64EncodeDefault('Secret1')).toBe('U2VjcmV0MQ==\n'); // android Base64.DEFAULT
    expect(await login(app, input, false)).toMatchObject({ kind: 'proceed' });
    expect(prefs.get(PREFS.login, PREFS.loginPassword)).toMatch(/^zed1\$/);
    expect(await login(app, input, false)).toMatchObject({ kind: 'proceed' });
  });

  it('answers the update dialog, the server message, or the legacy default', async () => {
    const { app } = await makeApp(new FakeServer(() => ({ status: '2' })));
    expect(await login(app, input, true)).toEqual({ kind: 'update' });
    const { app: b } = await makeApp(new FakeServer(() => ({ status: '0', errorMessage: 'Invalid credetials.' })));
    expect(await login(b, input, true)).toEqual({ kind: 'toast', message: 'Invalid credetials.' });
    const { app: c } = await makeApp(new FakeServer(() => ({ status: '0' })));
    expect(await login(c, input, true)).toEqual({ kind: 'toast', message: 'Invalid Username or Password' });
  });
});

describe('Attendance (AttendanceData)', () => {
  it('punch in/out rules, today checks and the record', () => {
    const d = { attendanceList: [] as ReturnType<typeof newAttendance>[] };
    const nine = new Date();
    nine.setHours(9, 0, 0, 0);
    const six = new Date(nine);
    six.setHours(18, 30);
    expect(isAttendanceTakenToday(d)).toBe(false);
    expect(addEntry(d, newAttendance(null, 'LOGIN', nine))).toBeNull();
    expect(addEntry(d, newAttendance(null, 'LOGIN', nine))).toBe("You haven't punched out since last punch in");
    expect(isAttendanceTakenToday(d)).toBe(true);
    expect(isLoggedOutToday(d)).toBe(false);
    expect(addEntry(d, newAttendance(null, 'LOGOUT', six))).toBeNull();
    expect(addEntry(d, newAttendance(null, 'LOGOUT', six))).toBe("You haven't punched in since last punch out");
    expect(isLoggedOutToday(d)).toBe(true);
    expect(lastLogoutEntry(d)).not.toBeNull();
    const [row] = attendanceLog(d.attendanceList);
    expect(totalHours(row!)).toBe('9 hrs');
    expect(gsonDate(nine)).toMatch(/^\d{4}-\d{2}-\d{2}T09:00:00[+-]\d{2}:\d{2}$/);
  });
});
