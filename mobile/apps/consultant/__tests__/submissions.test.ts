import { stampFormAnswers, type FormDefinition, type PhotoData } from '@zed/shared';
import {
  newPhoto,
  openMeetingRequest,
  queueTraining,
  saveCloseMeeting,
  saveOpenMeetingOffline,
  saveSitePhotos,
  submitAttendance,
  submitBasicInformation,
  submitEndAssessment,
  submitModuleParameter,
  submitProgressReviewSelfie,
  submitSiteTour,
  submitTraining,
  syncOpenMeeting,
} from '../src/flows/submissions';
import { BUILT_IN_BASIC_INFO, STANDARD_KEYS } from '../src/forms';
import { newAttendance } from '../src/attendance';
import { syncNow } from '../src/sync/queue';
import {
  allowCloseMeetingCapturing,
  allowCloseMeetingSubmission,
  COMPLETED,
  EVIDENCE_ADDED,
  hasSitePhotos,
  IN_PROGRESS,
  isBaselineDiagnosticInfoValid,
  isProgressReviewValid,
  newBasicInformation,
  onRequirementUpdated,
  Status,
  SUBMITTED,
  TO_START,
  tu,
  type AllottedParameters,
  type ConsultantPhoto,
  type FinancialAssistanceDetailsResponse,
  type PhotoInformation,
} from '../src/models';
import { FakeServer, makeApp, type SentRequest } from './helpers/harness';
import { loginAnswer, SA_ID, tuAnswer, ZED_ID } from './helpers/fixtures';

async function openConsultancy(server = new FakeServer(), answer = loginAnswer()) {
  const made = await makeApp(server);
  await made.app.saveDetails(answer, SA_ID, ZED_ID);
  return { ...made, server };
}

const names = (server: FakeServer) => server.requests.map(r => r.url.split('/').pop());
const photo = (id: string, over: Partial<ConsultantPhoto> = {}): ConsultantPhoto => ({
  photoId: SA_ID + id,
  associatedId: ZED_ID + SA_ID,
  photoPath: `/data/files/${id}.jpg`,
  latitude: '28.6',
  longitude: '77.2',
  timeStamp: 'Oct 24, 2026 3:05 PM',
  status: 0,
  isPdf: false,
  ...over,
});
/** SubmitPhotos answers the stored path, as V4 does. */
const uploads = (req: SentRequest) =>
  req.url.endsWith('SubmitPhotos') ? { status: '1', fileName: `${req.fields!.photoId}.jpg`, filePath: `${ZED_ID}\\Silver\\${req.fields!.sectionName}\\${req.fields!.photoId}.jpg` } : { status: '1' };

describe('site photos and the opening meeting (the OpenMeetingData row is the draft)', () => {
  it('keeps the site photos in the row; the meeting saved offline is sent by the queue', async () => {
    const { app, server } = await openConsultancy();
    const req = await openMeetingRequest(app);
    const ext: PhotoInformation = { ...newPhoto(), name: 'Site Exterior Photo', photo: 'EXT' };
    const int: PhotoInformation = { ...newPhoto(), name: 'Site Interior Photo', photo: 'INT' };
    expect(await saveSitePhotos(app, req, ext, int)).toBe(true);
    const row = await openMeetingRequest(app);
    expect(hasSitePhotos(row)).toBe(true);
    // Taking them again replaces them.
    await saveSitePhotos(app, row, { ...ext, photo: 'EXT2' }, int);
    expect((await openMeetingRequest(app)).assessmentPhotos?.map(p => p.photo)).toEqual(['EXT2', 'INT']);

    server.online = false;
    const meeting = await openMeetingRequest(app);
    meeting.startParticipants = [{ name: 'RN Lead Consultant', designation: 'Lead Consultant' }];
    expect(await saveOpenMeetingOffline(app, meeting, meeting.startParticipants)).toBe(true);
    expect(app.details!.isOpenMeetingSubmitted).toBe(true);
    await syncNow(app);
    expect(server.requests).toHaveLength(0);
    server.online = true;
    // (after the back-off)
    await app.queue.run({ userId: app.userId, force: true });
    expect(server.last('SubmitStartAssessment')!.url).toBe('http://10.0.2.2:5105/consultancymobileapi/SA/SubmitStartAssessment');
    expect(server.last('SubmitStartAssessment')!.json).toMatchObject({ saId: SA_ID, zedId: ZED_ID, startParticipants: [{ name: 'RN Lead Consultant' }] });
    expect(await app.store.meeting(app.userId, true)).toBeNull();
    // The legacy sync also marked the site tour as submitted (hiding it); not here.
    expect(app.details!.isSiteTourSubmitted).toBe(false);
  });

  it('technology upgradation sends its opening meeting to the consultancy web site', async () => {
    const { app, server } = await openConsultancy(new FakeServer(), tuAnswer());
    await app.store.saveMeeting(app.userId, { saId: SA_ID, zedId: ZED_ID, certificationType: 'Silver', userType: 0 }, true);
    await syncOpenMeeting(app);
    expect(server.requests[0]!.url).toBe('http://10.0.2.2:5102/Consultancy/FinancialAssistance/SubmitOpenMeeting');
  });
});

describe('milestone sections (AllottedParameters.onRequirementUpdated, the validators)', () => {
  const p = (): AllottedParameters => JSON.parse(JSON.stringify(loginAnswer().allottedParameters![0]));

  it('baseline diagnostic: Yes/Partial need evidences, No needs gaps; review keeps it in progress', () => {
    const r = p().requirements![0]!;
    expect(isBaselineDiagnosticInfoValid(r)).toBe(false);
    r.conformance = 'Yes';
    expect(isBaselineDiagnosticInfoValid(r)).toBe(false);
    r.capturedEvidences = [photo('1')];
    expect(isBaselineDiagnosticInfoValid(r)).toBe(true);
    r.conformance = 'No';
    r.capturedEvidences = null;
    expect(isBaselineDiagnosticInfoValid(r)).toBe(false);
    r.gapsIdentified = ['No written procedure'];
    expect(isBaselineDiagnosticInfoValid(r)).toBe(true);

    const param = p();
    onRequirementUpdated(param, 'baselineDiagnostic');
    expect(param.status).toBe(TO_START);
    param.requirements![0]!.conformance = 'No';
    onRequirementUpdated(param, 'baselineDiagnostic');
    expect(param.status).toBe(IN_PROGRESS);
    param.requirements![1]!.conformance = 'Yes';
    onRequirementUpdated(param, 'baselineDiagnostic');
    expect(param.status).toBe(COMPLETED);
    param.requirements![1]!.reviewNeeded = true;
    onRequirementUpdated(param, 'baselineDiagnostic');
    expect(param.status).toBe(IN_PROGRESS);
  });

  it('the action plan, technology suggestion and progress review complete when every requirement is valid', () => {
    const param = p();
    param.requirements!.forEach(r => ((r.plannedActivities = ['Train staff']), (r.estimatedTimeInDays = '10')));
    onRequirementUpdated(param, 'handholdingActionPlan');
    expect(param.status).toBe(COMPLETED);
    onRequirementUpdated(param, 'technologyIntervention');
    expect(param.status).toBe(IN_PROGRESS);
    const r = param.requirements![0]!;
    r.isProposedActivityCompleted = 'Partial';
    expect(isProgressReviewValid(r)).toBe(false);
    r.isProposedActivityCompleted = 'No';
    expect(isProgressReviewValid(r)).toBe(true);
  });

  it('uploads the evidences once (SubmitPhotos, section of the screen), then submits the parameter', async () => {
    const server = new FakeServer(uploads);
    const { app } = await openConsultancy(server);
    const param = p();
    param.requirements![0]!.conformance = 'Yes';
    param.requirements![0]!.capturedEvidences = [photo('1'), photo('2', { isPdf: true, photoPath: '/data/files/2.pdf' })];
    param.requirements![1]!.conformance = 'No';
    param.requirements![1]!.gapsIdentified = ['Gap'];
    expect(await submitModuleParameter(app, 'baselineDiagnostic', param)).toBeNull();
    expect(names(server)).toEqual(['SubmitPhotos', 'SubmitPhotos', 'SubmitBaselineDiagnostic']);
    const up = server.requests[1]!;
    expect(up.fields).toMatchObject({ zedId: ZED_ID, userName: SA_ID, certificationType: 'Silver', sectionName: 'BaselineDiagnosticStudy', photoId: SA_ID + '2', latitude: '28.6' });
    expect(up.files![0]).toMatchObject({ name: 'FormFile', fileName: SA_ID + '2.pdf', type: 'application/pdf' });
    const sent = server.last('SubmitBaselineDiagnostic')!.json!.allottedParameterObj as AllottedParameters;
    expect(sent.requirements![0]!.capturedEvidences![0]!.filePath).toBe(`${ZED_ID}\\Silver\\BaselineDiagnosticStudy\\${SA_ID}1.jpg`);
    expect(param.status).toBe(SUBMITTED);

    // A refusal keeps the parameter as it was; uploaded files are not sent again.
    server.responder = req => (req.url.endsWith('SubmitHandholdingActionPlan') ? { status: '0', errorMessage: 'Open Meeting not Submitted for the ZEDID: X' } : uploads(req));
    param.status = COMPLETED;
    expect(await submitModuleParameter(app, 'handholdingActionPlan', param)).toBe('Open Meeting not Submitted for the ZEDID: X');
    expect(names(server).slice(3)).toEqual(['SubmitHandholdingActionPlan']);
    expect(param.status).toBe(COMPLETED);
    server.online = false;
    expect(await submitModuleParameter(app, 'technologyIntervention', param)).toBe('Network not available');
  });

  it('the progress review selfie: the file, then SubmitSelfie with it', async () => {
    const server = new FakeServer(uploads);
    const { app } = await openConsultancy(server);
    const data = { status: Status.IN_PROGRESS, parameters: [], selfie: photo('9') };
    expect(await submitProgressReviewSelfie(app, data)).toBeNull();
    expect(names(server)).toEqual(['SubmitPhotos', 'SubmitSelfie']);
    expect(server.requests[0]!.fields!.sectionName).toBe('Progress Review');
    expect(server.last('SubmitSelfie')!.json).toMatchObject({ saId: SA_ID, selfie: { photoId: SA_ID + '9', filePath: expect.stringContaining('Progress Review') } });
  });
});

describe('training on ZED / on the handholding implementation plan', () => {
  it('uploads the photos and attendance sheets, then the details; offline it waits in the queue', async () => {
    const server = new FakeServer(uploads);
    const { app } = await openConsultancy(server);
    const info = { status: Status.TO_START, trainingTopic: 'ZED', trainingDate: '2026-10-25', trainingTime: '10:30 AM', remarks: 'Done', trainingPhoto: [photo('1')], attendanceSheet: [photo('2')] };
    const { response } = await submitTraining(app, info, false);
    expect(response?.status).toBe('1');
    expect(names(server)).toEqual(['SubmitPhotos', 'SubmitPhotos', 'SubmitZedTrainingInfo']);
    expect(server.requests[0]!.fields!.sectionName).toBe('Training on ZED');

    app.details!.handholdingTraining = { ...info, trainingPhoto: [photo('3')], attendanceSheet: [photo('4')] };
    server.online = false;
    await queueTraining(app, true);
    await syncNow(app);
    server.online = true;
    await app.queue.run({ userId: app.userId, force: true });
    await syncNow(app);
    expect(names(server).slice(3)).toEqual(['SubmitPhotos', 'SubmitPhotos', 'SubmitHouseholdingTrainingInfo']);
    expect(server.requests[3]!.fields!.sectionName).toBe('Training on Handholding Implementation Plan');
    expect(app.details!.handholdingTraining!.status).toBe(Status.SUBMITTED);
  });
});

describe('basic information (the nine groups)', () => {
  it('sends the groups with customFields and formVersion; a disabled field is left empty; no photos', async () => {
    const server = new FakeServer();
    const { app } = await openConsultancy(server);
    const info = newBasicInformation();
    for (const f of BUILT_IN_BASIC_INFO.fields) {
      const [group, ...rest] = f.key.split('.');
      let cur = (info as unknown as Record<string, Record<string, unknown>>)[group!]!;
      for (const k of rest.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
      cur[rest[rest.length - 1]!] = f.type === 'text' ? 'kWh' : '5';
    }
    info.customAnswers = { cf_licence: 'FL-1' };
    const def: FormDefinition = {
      ...BUILT_IN_BASIC_INFO,
      version: 'v7',
      fields: [
        ...BUILT_IN_BASIC_INFO.fields.filter(f => f.key !== 'energyManagement.solar.unit'),
        { key: 'cf_licence', label: 'Licence', type: 'text', required: true, custom: true, section: 'occupationalSafety', order: 99 },
      ],
    };
    stampFormAnswers(def, info, STANDARD_KEYS);
    const r = await submitBasicInformation(app, info);
    expect(r.status).toBe('1');
    expect(names(server)).toEqual(['SubmitBasicInformation']);
    const body = server.last('SubmitBasicInformation')!.json!;
    expect(body).toMatchObject({ formVersion: 'v7', customFields: { cf_licence: 'FL-1' } });
    const sent = body.basicInformation as Record<string, Record<string, Record<string, unknown>>>;
    // Emptied (null, left out of the JSON as Gson did).
    expect(sent.energyManagement!.solar!).not.toHaveProperty('unit');
    expect(sent.energyManagement!.electrical!.unit).toBe('kWh');
    expect(sent.occupationalSafety).toMatchObject({ numOfAccidents: '5', label: 'Occupational (Workplace) Safety' });
    expect(sent.customAnswers).toBeUndefined();
  });
});

describe('closing the meeting (allowCloseMeetingCapturing / allowCloseMeetingSubmission)', () => {
  it('the first milestone needs the study, the trainings and the basic information (lead); the second the progress review', async () => {
    const d = loginAnswer();
    expect(allowCloseMeetingCapturing(d)).toBe(false);
    d.baselineDiagnosticStudyData = { status: Status.COMPLETED, parameters: [] };
    expect(allowCloseMeetingCapturing({ ...d, userType: 2 })).toBe(true);
    d.zedTrainingInfo = { status: Status.SUBMITTED };
    d.handholdingTraining = { status: Status.SUBMITTED };
    d.saBasicInformation = { ...newBasicInformation(), status: Status.COMPLETED };
    expect(allowCloseMeetingCapturing(d)).toBe(true);
    expect(allowCloseMeetingSubmission(d)).toBe(false);
    d.baselineDiagnosticStudyData.status = Status.SUBMITTED;
    d.saBasicInformation.status = Status.SUBMITTED;
    expect(allowCloseMeetingSubmission(d)).toBe(false); // the opening meeting
    d.isOpenMeetingSubmitted = true;
    expect(allowCloseMeetingSubmission(d)).toBe(true);
    const m2 = { ...d, milestone: 2 };
    expect(allowCloseMeetingCapturing(m2)).toBe(false);
    m2.progressReview = { status: Status.SUBMITTED, parameters: [] };
    expect(allowCloseMeetingSubmission(m2)).toBe(true);
  });

  it('sends the added evidences three per request, then SubmitEndAssessment', async () => {
    const server = new FakeServer();
    const { app } = await openConsultancy(server);
    for (let i = 1; i <= 4; i++) await app.store.saveEvidence(app.userId, { photoId: `u_${i}`, evidenceId: SA_ID + i, photo: 'B', type: EVIDENCE_ADDED });
    const req = { saId: SA_ID, zedId: ZED_ID, certificationType: 'Silver', userType: 1, endComment: 'Done' };
    expect(await saveCloseMeeting(app, { ...req })).toBe(true);
    const r = await submitEndAssessment(app, req, () => undefined);
    expect(r?.status).toBe('1');
    expect(names(server)).toEqual(['SubmitEvidences', 'SubmitEvidences', 'SubmitEndAssessment']);
    expect((server.requests[0]!.json!.addedEvidences as unknown[]).length).toBe(3);
  });
});

describe('site tour and attendance', () => {
  it('sends three site photos per request and stops at the first refusal', async () => {
    let n = 0;
    const server = new FakeServer(() => (++n === 2 ? { status: '0', errorMessage: 'Refused' } : { status: '1' }));
    const { app } = await openConsultancy(server);
    const photos = Array.from({ length: 7 }, (_, i) => ({ photoId: `u_${i}`, photo: 'B', type: 2, comment: 'c' }));
    expect((await submitSiteTour(app, photos))?.errorMessage).toBe('Refused');
    expect(server.requests).toHaveLength(2);
  });

  it('sends the attendance as multipart with the day agenda; synced only on success', async () => {
    const server = new FakeServer(() => ({ status: '0', errorMessage: 'Already marked' }));
    const { app } = await openConsultancy(server);
    const selfie: PhotoData = { photoId: SA_ID + '5', associatedId: ZED_ID + SA_ID, photo: 'B64', photoPath: '/data/files/x.jpg', latitude: '28.6', longitude: '77.2', status: 0, isPdf: false };
    const a = newAttendance(selfie, 'Visit the unit', 'LOGIN');
    app.details!.attendanceData!.attendanceList.push(a);
    expect((await submitAttendance(app, a)).errorMessage).toBe('Already marked');
    expect(a.isSubmitted).toBe(false);
    const q = server.last('SubmitAttendance')!;
    expect(q.fields).toMatchObject({ saId: SA_ID, zedId: ZED_ID, attendanceType: 'LOGIN', comments: 'Visit the unit' });
    expect(q.files![0]).toMatchObject({ name: 'files', fileName: SA_ID + '5.jpg' });
    server.responder = () => ({ status: '1' });
    await submitAttendance(app, a);
    expect(a.isSubmitted).toBe(true);
  });
});

describe('technology upgradation (consultancy web site)', () => {
  const details: FinancialAssistanceDetailsResponse = {
    Table1: [{ Id: 7, ZedId: ZED_ID, IsApproved: 0, EligibleSubsidyPer: 50, MaxEligibleSubsidy: 100000 }],
    Table4: [
      { Id: 1, Name: 'Copy of Certificate', PhotoId: 'c.pdf' },
      { Id: 2, Name: 'Purchased Technology', TechnologyCode: 'T1', IsVerified: 'Yes', PhotoId: 'p.jpg' },
      { Id: 3, Name: 'Copy of Invoice', TechnologyCode: 'T1', IsVerified: 'Yes' },
      { Id: 4, Name: 'Copy of Invoice', TechnologyCode: 'T2', IsVerified: 'No' },
    ],
    Table10: [
      { Id: '11', TechnologyCode: 'T1', TechnologyName: 'CNC', AmountPaid: '150000' },
      { Id: '12', TechnologyCode: 'T2', TechnologyName: 'Lathe', AmountPaid: '50000' },
    ],
  };

  it('reads the tables of the certification and finds the documents', () => {
    expect(tu.certificationDetails(details, 'Silver')?.Id).toBe(7);
    expect(tu.technologies(details, 'Silver')).toHaveLength(2);
    expect(tu.technologies(details, 'Bronze')).toBeNull();
    expect(tu.copyOfInvoice(details, 'Silver', 'T2')?.Id).toBe(4);
    expect(tu.isAnyDocumentRejected(details, 'Silver', 'T1')).toBe(false);
    expect(tu.isAnyDocumentRejected(details, 'Silver', 'T2')).toBe(true);
  });

  it('calls GetDetails, ValidateEvidence, updatetechnology and FinalSubmit on the web site', async () => {
    const server = new FakeServer(() => ({ status: '1' }));
    const { app } = await openConsultancy(server, tuAnswer());
    await app.api.financialAssistanceDetails(ZED_ID);
    expect(server.requests[0]!.url).toBe('http://10.0.2.2:5102/Consultancy/FinancialAssistance/GetDetails');
    // BaseServiceRequest(null, zedId, null): Gson left the nulls out.
    expect(server.requests[0]!.json).toMatchObject({ zedId: ZED_ID });
    expect(server.requests[0]!.json).not.toHaveProperty('saId');
    await app.api.validateEvidence({ id: 2, zedId: ZED_ID, certificationType: 'Silver', isVerified: 'Yes', remarks: null, attachments: [photo('1')] });
    expect(server.requests[1]!.fields).toMatchObject({ Id: '2', ZedId: ZED_ID, CertificationType: 'Silver', IsVerified: 'Yes' });
    expect(server.requests[1]!.files![0]).toMatchObject({ name: 'files', fileName: SA_ID + '1.jpg' });
    await app.api.updateTechnology(ZED_ID, '11', '140000');
    expect(server.requests[2]!.json).toEqual({ ZedID: ZED_ID, Id: '11', AmountPaid: '140000' });
    await app.api.financialAssistanceFinalSubmit({ Id: 7, IsApproved: 1, Comments: 'OK' });
    expect(server.requests[3]!.url).toBe('http://10.0.2.2:5102/Consultancy/FinancialAssistance/FinalSubmit');
    expect(app.api.technologyUpgradationPhotoUrl(ZED_ID, 'p.jpg')).toBe(`http://10.0.2.2:5104/mobileapi/photos/${ZED_ID}/TechnologyUpgradation/p.jpg`);
  });
});
