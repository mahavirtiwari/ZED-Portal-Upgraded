import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StackNavigator, UiHost } from '@zed/shared';
import { SCREENS } from '../App';
import { SaAppProvider } from '../src/app/context';
import type { SaApp } from '../src/app/SaApp';
import { signIn } from '../src/flows/login';
import { CLEAR_CHECKS, CLEAR_START, clearPhotosSection, photoOwner, schemeUser, type SchemeShot } from '../src/schemes/schemeVisits';
import {
  eligibleAmount,
  isValidMobile,
  parseAmount,
  recommendProblems,
  rejectProblems,
  rupees,
  visitView,
  type SchemeVisitDetail,
} from '../src/schemes/visits';
import { syncNow, syncSchemeVisits } from '../src/sync/queue';
import { FakeServer, makeApp, type SentRequest } from './helpers/harness';
import { SA_ID } from './helpers/fixtures';

jest.setTimeout(60000);

const ID = 501;

/** A Desktop + Onsite application: two "Add more" items (body and cost checked onsite) and a plain section. */
function detail(over: Partial<SchemeVisitDetail> = {}): SchemeVisitDetail {
  return {
    applicationId: ID,
    zedId: 'ZEDMSME000321',
    unitName: 'Acme Forgings',
    address: 'Plot 7, MIDC, Pune',
    schemeCode: 'FA_ONSITE',
    schemeName: 'Financial Assistance',
    level: 'Silver',
    levelName: 'Silver',
    status: 'OnsiteWithAssessor',
    open: true,
    claimAmount: 80000,
    eligibleAmount: 50000,
    sharePercent: 75,
    maxAmount: 50000,
    photosMin: 1,
    photosMax: 2,
    sections: [
      {
        key: 'certs',
        title: 'Certification',
        repeating: true,
        items: [
          { index: 0, title: 'Certification 1', answers: [{ path: 'certs/0/body', field: 'body', label: 'Certifying body', type: 'text', value: 'BIS', checkOnsite: true }] },
          { index: 1, title: 'Certification 2', answers: [{ path: 'certs/1/body', field: 'body', label: 'Certifying body', type: 'text', value: 'NABCB', checkOnsite: true }] },
        ],
      },
      { key: 'unit', title: 'Unit', items: [{ index: 0, title: 'Unit', answers: [{ path: 'unit/0/note', field: 'note', label: 'Note', type: 'text', value: 'Night shift' }] }] },
    ],
    places: [
      { path: 'certs/0/body', label: 'Certifying body', section: 'certs', index: 0, field: 'body' },
      { path: 'certs/1/body', label: 'Certifying body', section: 'certs', index: 1, field: 'body' },
    ],
    items: [
      { section: 'certs', index: 0, title: 'Certification 1', photos: [] },
      { section: 'certs', index: 1, title: 'Certification 2', photos: [] },
      { section: 'unit', index: 0, title: 'Unit', photos: [] },
    ],
    checks: {},
    ...over,
  };
}

const shot = (n: string): SchemeShot => ({ base64: 'IMG' + n, timeStamp: 'Nov 20, 2026 11:05 AM', coords: { latitude: 18.5204, longitude: 73.8567 } });

const name = (r: SentRequest) => r.url.split('/SchemeVisits/')[1]?.split('?')[0] ?? '';

function server(over: (r: SentRequest) => unknown = () => undefined) {
  let n = 0;
  return new FakeServer(r => {
    const custom = over(r);
    if (custom !== undefined) return custom;
    if (r.url.endsWith('/SA/SignIn')) return { status: '1', appToken: 'tok-a', profile: { assessorId: SA_ID, name: 'RN Onsite Assessor' }, assessments: [] };
    switch (name(r)) {
      case 'List':
        return { status: '1', visits: [{ applicationId: ID, zedId: 'ZEDMSME000321', unitName: 'Acme Forgings', schemeName: 'Financial Assistance', status: 'OnsiteWithAssessor', claimAmount: 80000 }] };
      case 'Detail':
        return { status: '1', visit: detail() };
      case 'Start':
        return { status: '1', visitStatus: 'OnsiteVisit', visitStartedOn: '2026-11-20T11:06:00' };
      case 'SavePhoto':
        return { status: '1', name: `2026112011070000${++n}0abcdef1.jpg` };
      default:
        return { status: '1' };
    }
  });
}

async function signedIn(s: FakeServer) {
  const made = await makeApp(s);
  await signIn(made.app, { assessorId: SA_ID, password: 'Secret1' }, true);
  return made;
}

const schemeCalls = (s: FakeServer) => s.requests.map(name).filter(Boolean);

// ------------------------------------------------------------------ rules

describe('scheme visit rules', () => {
  it('Recommend needs the start, the representative, every check valid, the photos and a verified claim within the claim', () => {
    const d = detail({ status: 'OnsiteVisit', visitStartedOn: '2026-11-20T11:06:00' });
    const empty = visitView(detail(), null);
    expect(recommendProblems(empty, null).map(p => p.code)).toEqual(['start', 'repName', 'repMobile', 'unchecked', 'photos', 'photos', 'photos', 'claim']);

    const ready = visitView(
      {
        ...d,
        representativeName: 'R. Kulkarni',
        representativeMobile: '9876543210',
        checks: { 'certs/0/body': { status: 'Yes' }, 'certs/1/body': { status: 'Yes' } },
        items: d.items.map(i => ({ ...i, photos: [{ name: `p-${i.section}-${i.index}.jpg`, slot: `onsite/${i.section}/${i.index}` }] })),
      },
      null,
    );
    expect(recommendProblems(ready, 60000)).toEqual([]);
    expect(recommendProblems(ready, 80000.01).map(p => p.code)).toEqual(['claim']);
    expect(recommendProblems({ ...ready, representativeMobile: '5876543210' }, 1).map(p => p.code)).toEqual(['repMobile']);
    const notValid = { ...ready, checks: { ...ready.checks, 'certs/1/body': { status: 'No', remarks: 'Other body' } } };
    expect(recommendProblems(notValid, 1)).toEqual([{ code: 'notValid', fields: { Count: 1 } }]);
    const photos = recommendProblems({ ...ready, photos: { ...ready.photos, 'onsite/unit/0': [] } }, 1);
    expect(photos).toEqual([{ code: 'photos', fields: { Item: 'Unit', Min: 1 } }]);
  });

  it('Reject needs the start, a reason, the remarks and a remark on each answer marked Not valid', () => {
    const v = visitView(detail({ status: 'OnsiteVisit', visitStartedOn: '2026-11-20T11:06:00' }), null);
    expect(rejectProblems(v, '').map(p => p.code)).toEqual(['reason', 'remarks']);
    expect(rejectProblems({ ...v, remarks: 'Plant closed', checks: { 'certs/0/body': { status: 'No', remarks: ' ' } } }, 'Not functional').map(p => p.code)).toEqual(['remark']);
    expect(rejectProblems({ ...v, remarks: 'Plant closed' }, 'Not functional')).toEqual([]);
    expect(rejectProblems(visitView(detail(), null), 'x').map(p => p.code)).toContain('start');
  });

  it('amounts and the mobile number follow the server', () => {
    expect(eligibleAmount(60001.99, 75, 50000)).toBe(45000.75);
    expect(eligibleAmount(100000, 75, 50000)).toBe(50000);
    expect(eligibleAmount(1000, null, null)).toBe(0);
    expect(parseAmount('60,001.75')).toBe(60001.75);
    expect(parseAmount('1.234')).toBeNull();
    expect(rupees(150000)).toBe('1,50,000');
    expect(rupees(45000.75)).toBe('45,000.75');
    expect(isValidMobile('9876543210')).toBe(true);
    expect(isValidMobile('5876543210')).toBe(false);
    expect(isValidMobile('987654321')).toBe(false);
  });

  it('the visit shown: the phone checks and texts win, its photos join the server ones, removed ones are hidden', () => {
    const d = detail({
      status: 'OnsiteVisit',
      representativeName: 'Server Name',
      checks: { 'certs/0/body': { status: 'No', remarks: 'x' } },
      items: [{ section: 'certs', index: 0, title: 'Certification 1', photos: [{ name: 'a.jpg', slot: 'onsite/certs/0' }, { name: 'b.jpg', slot: 'onsite/certs/0' }] }],
    });
    const v = visitView(d, {
      applicationId: ID,
      saId: SA_ID,
      summary: { applicationId: ID },
      startSent: true,
      photos: [{ photoId: 'L1', slot: 'onsite/certs/0', timeStamp: 't', latitude: '1', longitude: '2', uploaded: true, name: 'b.jpg' }, { photoId: 'L2', slot: 'onsite/certs/0', timeStamp: 't', latitude: '1', longitude: '2', uploaded: false }],
      removed: [{ photoId: 'a.jpg', slot: 'onsite/certs/0', name: 'a.jpg' }],
      checks: { 'certs/0/body': { status: 'Yes' }, 'certs/1/body': { status: '' } },
      representativeName: 'Phone Name',
      saveDirty: true,
      saveRev: 1,
    });
    expect(v.checks).toEqual({ 'certs/0/body': { status: 'Yes', remarks: undefined } });
    expect(v.representativeName).toBe('Phone Name');
    expect(v.photos['onsite/certs/0']!.map(p => p.key)).toEqual(['local:L1', 'local:L2']);
    expect(v.started).toBe(true);
  });
});

// ------------------------------------------------------------------ offline queue

describe('scheme visits offline', () => {
  it('queues the start, photos and checks offline and sends them in order when the connection returns', async () => {
    const s = server();
    const { app } = await signedIn(s);
    const d = detail();
    s.online = false;
    await app.schemes.startVisit(d, shot('S'), shot('T'));
    await app.schemes.addPhoto(d, 'certs', 0, shot('P1'));
    await app.schemes.setCheck(d, 'certs/0/body', 'Yes');
    await app.schemes.setCheck(d, 'certs/1/body', 'No'); // no remark yet: kept on the phone
    await app.schemes.setRepresentative(d, 'R. Kulkarni', '9876543210');

    expect((await app.queue.list(schemeUser(SA_ID))).map(j => j.kind)).toEqual(['schemeStart', 'schemePhoto', 'schemeSave']);
    expect(app.schemes.hasUnsent(ID)).toBe(true);
    expect((await app.photos.byAssociatedId(photoOwner(SA_ID, ID))).map(p => p.name)).toEqual(['onsite/selfie', 'onsite/site', 'onsite/certs/0']);
    await syncNow(app);
    expect(await app.schemes.pending(ID)).toHaveLength(3);

    // The connection is back (the back-off of the failed attempt is skipped, as the Sync button does).
    s.online = true;
    await syncSchemeVisits(app, true);
    expect(schemeCalls(s)).toEqual(['Start', 'SavePhoto', 'Save']);
    const start = s.last('/SchemeVisits/Start')!.json!;
    expect(start).toMatchObject({ saId: SA_ID, applicationId: ID, selfie: { photo: 'IMGS', latitude: '18.5204', longitude: '73.8567' }, site: { photo: 'IMGT' } });
    expect(s.last('/SchemeVisits/SavePhoto')!.json).toMatchObject({ section: 'certs', index: 0, photo: { photo: 'IMGP1' } });
    const save = s.last('/SchemeVisits/Save')!.json!;
    expect(save).toMatchObject({ representativeName: 'R. Kulkarni', representativeMobile: '9876543210', checks: [{ path: 'certs/0/body', status: 'Yes' }] });

    const draft = app.schemes.draftOf(ID)!;
    expect(draft.startSent).toBe(true);
    expect(draft.startedAt).toBe('2026-11-20T11:06:00');
    expect(draft.photos[0]).toMatchObject({ uploaded: true, name: '202611201107000010abcdef1.jpg' });
    // The Not valid check without its remark stays to send.
    expect(draft.saveDirty).toBe(true);
    expect(await app.schemes.pending(ID)).toEqual([]);

    // The remark: sent with the next save.
    await app.schemes.setCheck(d, 'certs/1/body', 'No', 'Certificate of another body');
    await syncNow(app);
    expect(s.last('/SchemeVisits/Save')!.json!.checks).toEqual([
      { path: 'certs/0/body', status: 'Yes' },
      { path: 'certs/1/body', status: 'No', remarks: 'Certificate of another body' },
    ]);
    expect(app.schemes.draftOf(ID)!.saveDirty).toBe(false);
    expect(app.schemes.hasUnsent(ID)).toBe(false);
  });

  it('a refused send stops the visit\'s later sends; a removed photo not sent is simply dropped', async () => {
    const s = server(r => (name(r) === 'Start' ? { status: '0', errorMessage: 'The photo has no location.' } : undefined));
    const { app } = await signedIn(s);
    const d = detail();
    await app.schemes.startVisit(d, shot('S'), shot('T'));
    const p = await app.schemes.addPhoto(d, 'certs', 0, shot('P1'));
    await syncNow(app);
    expect(schemeCalls(s)).toEqual(['Start']);
    const [first, second] = await app.schemes.pending(ID);
    expect(first).toMatchObject({ status: 'failed', lastError: 'The photo has no location.' });
    expect(second).toMatchObject({ status: 'pending' });

    await app.schemes.removePhoto(d, 'onsite/certs/0', { key: 'local:' + p.photoId, local: true, photoId: p.photoId, uploaded: false });
    expect((await app.schemes.pending(ID)).map(j => j.kind)).toEqual(['schemeStart']);
    expect(await app.photos.get(p.photoId)).toBeNull();
  });

  it('the result needs everything synced and a connection; afterwards the visit leaves the phone', async () => {
    const s = server();
    const { app } = await signedIn(s);
    await app.schemes.refreshList();
    const d = detail();
    await app.schemes.startVisit(d, shot('S'), shot('T'));
    s.online = false;
    // Offline: the start cannot be sent, so the result is not sent either.
    expect((await app.schemes.submit(d, { decision: 'reject', reason: 'Not functional', remarks: 'Closed' })).ok).toBe(false);
    expect(schemeCalls(s)).not.toContain('Submit');
    s.online = true;

    const r = await app.schemes.submit(d, { decision: 'reject', reason: 'Not functional', remarks: 'Closed' });
    expect(r.ok).toBe(true);
    expect(schemeCalls(s).slice(-2)).toEqual(['Start', 'Submit']);
    expect(s.last('/SchemeVisits/Submit')!.json).toMatchObject({ decision: 'reject', reason: 'Not functional', remarks: 'Closed' });
    expect(app.schemes.draftOf(ID)).toBeNull();
    expect(app.schemes.list).toEqual([]);
    expect(await app.photos.byAssociatedId(photoOwner(SA_ID, ID))).toEqual([]);
  });

  it('the result is refused while a send is refused', async () => {
    const s = server(r => (name(r) === 'SavePhoto' ? { status: '0', errorMessage: 'At most 2 photo(s).' } : undefined));
    const { app } = await signedIn(s);
    const d = detail({ status: 'OnsiteVisit' });
    await app.schemes.addPhoto(d, 'certs', 0, shot('P1'));
    const r = await app.schemes.submit(d, { decision: 'recommend', verifiedClaim: 1000 });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('At most 2 photo(s).');
    expect(schemeCalls(s)).not.toContain('Submit');
  });
});

// ------------------------------------------------------------------ Clear data

function render(app: SaApp, screen: string, params?: Record<string, unknown>) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <UiHost>
        <SaAppProvider app={app}>
          <StackNavigator screens={SCREENS} initial={{ name: screen, params }} />
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

describe('scheme visits in Clear data', () => {
  async function withVisitWork() {
    const s = server();
    const made = await signedIn(s);
    const d = detail();
    s.online = false;
    await made.app.schemes.startVisit(d, shot('S'), shot('T'));
    await made.app.schemes.addPhoto(d, 'certs', 0, shot('P1'));
    await made.app.schemes.setRemarks(d, 'Unit running');
    return { ...made, s, d };
  }

  it('lists the start, each item\'s photos and the checks, with the unsynced mark', async () => {
    const { app } = await withVisitWork();
    const sections = await app.schemes.dataSections(ID);
    expect(sections.map(x => x.id)).toEqual([CLEAR_START, clearPhotosSection('onsite/certs/0'), CLEAR_CHECKS]);
    expect(sections[0]).toMatchObject({ title: 'Start of visit (selfie and site photo)', detail: '2 photos · 1 KB', unsent: true });
    expect(sections[0]!.note).toContain('clearing it also clears');
    expect(sections[1]).toMatchObject({ title: 'Photos · onsite/certs/0'.replace('onsite/', ''), unsent: true, photos: 1 });
    expect(sections[2]).toMatchObject({ title: 'Checks, representative and remarks', detail: '1 record', unsent: true });
  });

  it('clears one item\'s photos only; an unsynced start clears the whole visit', async () => {
    const { app } = await withVisitWork();
    expect(await app.schemes.clearSections(ID, [clearPhotosSection('onsite/certs/0')])).toBe(true);
    expect(app.schemes.draftOf(ID)!.photos).toEqual([]);
    expect((await app.schemes.pending(ID)).map(j => j.kind)).toEqual(['schemeStart', 'schemeSave']);
    expect((await app.photos.byAssociatedId(photoOwner(SA_ID, ID))).map(p => p.name)).toEqual(['onsite/selfie', 'onsite/site']);

    expect(await app.schemes.clearSections(ID, [CLEAR_START])).toBe(true);
    expect(app.schemes.draftOf(ID)).toBeNull();
    expect(await app.schemes.pending(ID)).toEqual([]);
    expect(await app.photos.byAssociatedId(photoOwner(SA_ID, ID))).toEqual([]);
  });

  it('the list shows the visit with Clear data, and the sheet lists its sections', async () => {
    const { app, s } = await withVisitWork();
    s.online = true;
    await app.schemes.refreshList();
    s.online = false;
    const r = render(app, 'SchemeVisits');
    await act(async () => undefined);
    expect(byTestId(r, `scheme-visit-${ID}`)).toHaveLength(1);
    expect(byTestId(r, `scheme-unsent-${ID}`)).toHaveLength(1);
    await press(r, `scheme-clear-${ID}`);
    await act(async () => undefined);
    expect(byTestId(r, 'clear-data')).toHaveLength(1);
    expect(byTestId(r, 'clear-data-badge')).toHaveLength(1);
    expect(byTestId(r, `clear-row-${CLEAR_START}`)).toHaveLength(1);
    expect(byTestId(r, `clear-unsent-${CLEAR_CHECKS}`)).toHaveLength(1);
    await press(r, `clear-row-${CLEAR_CHECKS}`);
    await press(r, 'clear-selected');
    await press(r, 'clear-understand');
    await press(r, 'clear-confirm');
    expect(app.schemes.draftOf(ID)!.remarks).toBeUndefined();
    expect((await app.schemes.pending(ID)).map(j => j.kind)).toEqual(['schemeStart', 'schemePhoto']);
  });
});

describe('the scheme visit screen', () => {
  it('before the start: the unit, the start tiles and the answers read-only', async () => {
    const { app } = await signedIn(server());
    const r = render(app, 'SchemeVisit', { applicationId: ID });
    await act(async () => undefined);
    await act(async () => undefined);
    expect(byTestId(r, 'scheme-unit')).toHaveLength(1);
    expect(byTestId(r, 'scheme-start')).toHaveLength(1);
    expect(byTestId(r, 'scheme-answer-certs/0/body')).toHaveLength(1);
    // Nothing to check or photograph before the start.
    expect(r.root.findAll(n => n.props.testID === 'scheme-check-certs/0/body-valid' && typeof n.props.onPress === 'function')).toHaveLength(0);
    expect(byTestId(r, 'scheme-take-onsite/certs/0')).toHaveLength(0);
    expect(byTestId(r, 'scheme-decision')).toHaveLength(0);
  });

  it('a started visit: checks, photos and the result with what is still missing', async () => {
    const s = server(q => (name(q) === 'Detail' ? { status: '1', visit: detail({ status: 'OnsiteVisit', visitStartedOn: '2026-11-20T11:06:00' }) } : undefined));
    const { app } = await signedIn(s);
    const r = render(app, 'SchemeVisit', { applicationId: ID });
    await act(async () => undefined);
    await act(async () => undefined);
    expect(byTestId(r, 'scheme-started')).toHaveLength(1);
    expect(byTestId(r, 'scheme-take-onsite/unit/0').length).toBeGreaterThan(0);
    await press(r, 'scheme-check-certs/0/body-valid');
    await act(async () => undefined);
    expect(app.schemes.draftOf(ID)!.checks['certs/0/body']).toEqual({ status: 'Yes', remarks: null });
    await press(r, 'scheme-decision-recommend');
    const problems = r.root.findAll(n => n.props.testID === 'scheme-problems' && typeof n.type === 'string');
    expect(problems).toHaveLength(1);
    const lines = r.root.findAll(n => (n.type as unknown) === 'Text').map(n => String(n.props.children ?? ''));
    expect(lines).toContain("• Enter the representative's name");
    expect(lines).toContain('• Check every answer (1 left)');
    expect(lines).toContain('• Certification 1: take at least 1 photo(s)');
  });
});
