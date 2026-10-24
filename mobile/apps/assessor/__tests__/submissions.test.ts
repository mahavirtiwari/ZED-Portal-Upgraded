import { stampFormAnswers, type FormDefinition, type PhotoData } from '@zed/shared';
import {
  checkQuestionsData,
  jobKey,
  saveCloseMeeting,
  saveOpenMeetingOffline,
  saveSelfieOffline,
  submitAttendance,
  submitBasicInformation,
  submitParameter,
  submitSiteTour,
} from '../src/flows/submissions';
import { BUILT_IN_BASIC_INFO, STANDARD_KEYS } from '../src/forms';
import { newAttendance } from '../src/attendance';
import { syncNow } from '../src/sync/queue';
import { EVIDENCE_ADDED, EVIDENCE_SITE_TOUR, newBasicInformation, type PhotoInformation } from '../src/models';
import { FakeServer, makeApp, type SentRequest } from './helpers/harness';
import { loginAnswer, SA_ID, ZED_ID } from './helpers/fixtures';

async function openAssessment(server = new FakeServer()) {
  const made = await makeApp(server);
  await made.app.saveDetails(loginAnswer(), SA_ID, ZED_ID);
  return { ...made, server };
}

const photoInfo = (id: string, type: number, over: Partial<PhotoInformation> = {}): PhotoInformation => ({ photoId: `u_${id}`, evidenceId: SA_ID + id, photo: `B64-${id}\n`, type, ...over });
const names = (server: FakeServer) => server.requests.map(r => r.url.split('/').pop());

describe('opening meeting and selfie saved offline, sent by the queue', () => {
  it('queues the meeting and then the selfie (same group, in order) and clears the columns when sent', async () => {
    const { app, server } = await openAssessment();
    const request = { saId: SA_ID, zedId: ZED_ID, certificationType: 'Silver', userType: 0, assessmentPhotos: [photoInfo('1', 0)], startParticipants: [{ name: 'A', designation: 'B' }] };
    expect(await saveOpenMeetingOffline(app, request, request.startParticipants)).toBe(true);
    expect(await saveSelfieOffline(app, { saId: SA_ID, zedId: ZED_ID, certificationType: 'Silver', selfieImage: photoInfo('2', 0) })).toBe(true);
    expect(app.details!.isOpenMeetingSubmitted && app.details!.isSelfieSubmitted).toBe(true);

    server.online = false;
    expect((await syncNow(app))?.offline).toBe(true);
    server.online = true;
    const s = await app.queue.run({ userId: app.userId, force: true });
    expect(s.sent.map(j => j.kind)).toEqual(['openMeeting', 'selfie']);
    expect(names(server)).toEqual(['SubmitStartAssessment', 'SubmitSelfie']);
    expect(server.last('SubmitStartAssessment')!.json).toMatchObject({ saId: SA_ID, startParticipants: [{ name: 'A' }], version: '1.3' });
    expect(await app.store.meeting(app.userId, true)).toBeNull();
    expect(await app.store.selfie(app.userId)).toBeNull();
  });

  it('a refused opening meeting keeps the selfie waiting', async () => {
    const server = new FakeServer(r => (r.url.endsWith('SubmitStartAssessment') ? { status: '0', errorMessage: 'MSME SA Closing Meeting Submitted' } : { status: '1' }));
    const { app } = await openAssessment(server);
    await saveOpenMeetingOffline(app, { saId: SA_ID, zedId: ZED_ID, certificationType: 'Silver', userType: 0 }, []);
    await saveSelfieOffline(app, { saId: SA_ID, zedId: ZED_ID, certificationType: 'Silver', selfieImage: photoInfo('2', 0) });
    const s = await app.queue.run({ userId: app.userId, force: true });
    expect(s.failed.map(j => [j.kind, j.lastError])).toEqual([['openMeeting', 'MSME SA Closing Meeting Submitted']]);
    expect(names(server)).toEqual(['SubmitStartAssessment']);
    expect(await app.store.selfie(app.userId)).not.toBeNull();
  });
});

describe('parameters (SubmitParametersActivity.submitParameter)', () => {
  it('needs a conformance on every requirement', async () => {
    const { app } = await openAssessment();
    const p = app.details!.allottedParameters![0]!;
    expect(checkQuestionsData(p)).toBe(false);
    p.requirements!.forEach(r => (r.conformance = 'Yes'));
    expect(checkQuestionsData(p)).toBe(true);
  });

  it('sends all added evidences two by two (deleting each), then the parameter', async () => {
    const { app, server } = await openAssessment();
    for (const id of ['1', '2', '3']) await app.store.saveEvidence(app.userId, photoInfo(id, EVIDENCE_ADDED, { name: `E${id}` }));
    await app.store.saveEvidence(app.userId, photoInfo('9', EVIDENCE_SITE_TOUR, { comment: 'Tour' }));
    const p = app.details!.allottedParameters![0]!;
    p.requirements![0]!.conformance = 'Yes';
    p.requirements![0]!.addedEvidences = [{ ...photoInfo('1', EVIDENCE_ADDED), photo: null }];
    p.requirements![1]!.conformance = 'No';
    expect((await submitParameter(app, p))?.status).toBe('1');
    expect(names(server)).toEqual(['SubmitEvidences', 'SubmitEvidences', 'SubmitParameter']);
    expect((server.requests[0]!.json!.addedEvidences as PhotoInformation[]).map(e => e.evidenceId)).toEqual([SA_ID + '1', SA_ID + '2']);
    expect(server.requests[0]!.json).toMatchObject({ userType: 1 });
    expect(await app.store.evidencesOfType(app.userId, EVIDENCE_ADDED)).toEqual([]);
    expect(await app.store.evidencesOfType(app.userId, EVIDENCE_SITE_TOUR)).toHaveLength(1);
    expect(server.last('SubmitParameter')!.json).toMatchObject({ allottedParameterObj: { parameterId: '9101' } });
  });
});

describe('site tour (submitSitetourData)', () => {
  it('sends three photos per request and stops at the first refusal', async () => {
    let calls = 0;
    const { app, server } = await openAssessment(new FakeServer(() => (++calls === 2 ? { status: '0', errorMessage: 'No' } : { status: '1' })));
    const photos = ['1', '2', '3', '4', '5', '6', '7'].map(id => photoInfo(id, EVIDENCE_SITE_TOUR));
    const r = await submitSiteTour(app, photos);
    expect(r).toMatchObject({ status: '0', errorMessage: 'No' });
    expect(server.requests.map(q => (q.json!.siteTourPhotos as unknown[]).length)).toEqual([3, 3]);
  });
});

describe('basic information (BasicInfoViewModel)', () => {
  it('sends the information, then one photo per SubmitBasicInfoPhotos, with customFields and formVersion', async () => {
    const { app, server } = await openAssessment();
    const stored: PhotoData = { photoId: SA_ID + '100', associatedId: ZED_ID + SA_ID, photo: 'P100', photoPath: '/files/a.jpg', status: 0, isPdf: false };
    await app.photos.insert(stored);
    await app.photos.insert({ ...stored, photoId: SA_ID + '101', photo: 'P101' });
    const info = Object.assign(newBasicInformation(), {
      auditsConducted: 'Yes',
      productDetailsList: [{ id: 'r1', productName: 'Widget', exported: 'No', productPhoto: { ...stored, photo: null }, productDescriptionPhoto: { ...stored, photoId: SA_ID + '101', photo: null } }],
      domesticCustomers: 'A',
      rawMaterialImported: 'No',
      monthlyManufacturingCapacityUnits: 'Number',
      monthlyManufacturingCapacityValue: '10',
      monthlyUtilizationUnits: 'Number',
      monthlyUtilizationValue: '5',
      energySources: ['Solar'],
      outsourcedProcesses: 'Painting',
      customAnswers: { cf_gst: '09ABC' },
    });
    const def: FormDefinition = {
      ...BUILT_IN_BASIC_INFO,
      numbered: true,
      fields: [
        ...BUILT_IN_BASIC_INFO.fields.filter(f => f.key !== 'outsourcedProcesses'),
        { key: 'cf_gst', label: 'GST', type: 'text', required: true, custom: true, section: 'basic', order: 15 },
      ],
      version: 'v9',
    };
    stampFormAnswers(def, info, STANDARD_KEYS);
    expect((await submitBasicInformation(app, info)).status).toBe('1');
    expect(names(server)).toEqual(['SubmitBasicInformation', 'SubmitBasicInfoPhotos', 'SubmitBasicInfoPhotos']);
    const sent = server.requests[0]!.json!;
    expect(sent).toMatchObject({ saId: SA_ID, zedId: ZED_ID, certificationType: 'Silver', formVersion: 'v9', customFields: { cf_gst: '09ABC' } });
    const basic = sent.basicInformation as Record<string, unknown>;
    expect(basic.outsourcedProcesses).toBeUndefined();
    expect(basic.customAnswers).toBeUndefined();
    expect(((server.requests[1] as SentRequest).json!.photos as PhotoData[])[0]!.photo).toBe('P100');
  });

  it('stops with the legacy message when a product photo is missing on the phone', async () => {
    const { app } = await openAssessment();
    const info = Object.assign(newBasicInformation(), {
      productDetailsList: [{ id: 'r1', productName: 'Widget', productPhoto: { photoId: 'nope', associatedId: 'x', status: 0, isPdf: false } }],
    });
    expect((await submitBasicInformation(app, info)).errorMessage).toBe('Widget product photos missing, please capture again');
  });
});

describe('closing meeting and attendance', () => {
  it('saves the closing meeting without added evidences and marks it submitted', async () => {
    const { app } = await openAssessment();
    const req = { saId: SA_ID, zedId: ZED_ID, certificationType: 'Silver', userType: 1, endComment: 'Done', addedEvidences: [photoInfo('1', 1)] };
    expect(await saveCloseMeeting(app, req)).toBe(true);
    expect((await app.store.meeting(app.userId, false))?.addedEvidences).toBeUndefined();
    expect(app.details!.isCloseMeetingSubmitted).toBe(true);
  });

  it('sends the attendance as multipart (selfie file as photoId + extension) and marks it synced only on success', async () => {
    const server = new FakeServer(() => ({ status: '0', errorMessage: 'Already marked' }));
    const { app } = await openAssessment(server);
    const selfie: PhotoData = { photoId: SA_ID + '5', associatedId: ZED_ID + SA_ID, photo: 'B64', photoPath: '/data/files/x.jpg', latitude: '28.6', longitude: '77.2', status: 0, isPdf: false };
    const a = newAttendance(selfie, 'LOGIN');
    app.details!.attendanceData!.attendanceList.push(a);
    expect((await submitAttendance(app, a)).errorMessage).toBe('Already marked');
    expect(a.isSubmitted).toBe(false);
    const q = server.last('SubmitAttendance')!;
    expect(q.fields).toMatchObject({ saId: SA_ID, zedId: ZED_ID, certificationType: 'Silver', attendanceType: 'LOGIN', version: '1.3' });
    expect(JSON.parse(q.fields!.selfieMetadata!)).toMatchObject({ photoId: SA_ID + '5', latitude: '28.6' });
    expect(JSON.parse(q.fields!.selfieMetadata!).photo).toBeUndefined();
    expect(q.files![0]).toMatchObject({ name: 'files', fileName: SA_ID + '5.jpg', type: 'image/*' });
    server.responder = () => ({ status: '1' });
    await submitAttendance(app, a);
    expect(a.isSubmitted).toBe(true);
    expect(jobKey(app, 'attendance', a.time)).toContain(':attendance:');
  });
});
