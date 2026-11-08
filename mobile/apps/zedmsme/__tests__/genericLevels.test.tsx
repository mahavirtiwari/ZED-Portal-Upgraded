import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StackNavigator, UiHost } from '@zed/shared';
import type { PublicLevel } from '../src/api';
import { MsmeAppProvider } from '../src/app/context';
import { AppDrawerHost, AppDrawerOverlay } from '../src/app/AppDrawer';
import type { MsmeApp } from '../src/app/MsmeApp';
import { certificationStatus } from '../src/components/CertificationStatusDialog';
import { addedLevels, levelDisplayName } from '../src/levels';
import {
  allLevelCodes,
  certificationDetailsOf,
  isAnyCertificationCompleted,
  isDesktopLevel,
  normalizeLoginResponse,
  updateCertificationDetails,
  type AppLevelStatus,
  type CertificationDetails,
  type LoginResponse,
  type MsmeStatus,
} from '../src/models';
import { levelsText } from '../src/screens/DashboardScreen';
import { certificationAction, levelCards, levelInfo, ZEDX_COLOR } from '../src/screens/MyCertificationsScreen';
import { SCREENS } from '../App';
import { FakeServer, makeApp } from './helpers/harness';
import { memoryDb } from './helpers/sqljs';
import { writeLegacyLoginRow, writeLegacyPhotoRows, ZED_ID } from './helpers/legacyFixture';

jest.useFakeTimers();
jest.setTimeout(60000);

const cert = (status: number, over: Partial<CertificationDetails> = {}): CertificationDetails => ({
  status,
  nc1Status: 0,
  nc2Status: 0,
  nc3Status: 0,
  nc4Status: 0,
  nc5Status: 0,
  finalSubmitDone: false,
  ...over,
});

const level = (code: string, status: number, over: Partial<AppLevelStatus> = {}): AppLevelStatus => ({
  ...cert(status),
  code,
  name: code === 'PLATINUM' ? 'Platinum' : code,
  assessmentMode: 'Site',
  ...over,
});

const status = (b: number, s: number, g: number, levels: AppLevelStatus[] = [], x?: number): MsmeStatus => ({
  status: '1',
  bronze: cert(b),
  silver: cert(s),
  gold: cert(g),
  ...(x == null ? {} : { zedx: cert(x) }),
  levels,
  financialAssistanceStatus: 0,
});

const PLATINUM: PublicLevel = {
  code: 'PLATINUM',
  name: 'Platinum',
  description: 'Above ZED-X.',
  comment: 'Fee as the Admin sets it.',
  logoUrl: '/api/public/levels/PLATINUM/logo?v=3',
  assessmentMode: 'Site',
};
const BUILT_IN: PublicLevel[] = ['Bronze', 'Silver', 'Gold'].map(code => ({ code, name: code }));
const logo = (url: string) => 'https://zedv3.qci.org.in' + url;

describe('levels the Admin added (2026-11-08): as ZED-X', () => {
  it('a PLATINUM level enabled by the Admin gets a card with its name and logo, after ZED-X', () => {
    const cards = levelCards([...BUILT_IN, { code: 'ZEDX', name: 'ZED-X' }, PLATINUM], status(0, 0, 0, [level('PLATINUM', 0)]), logo);
    expect(cards.map(c => c.type)).toEqual(['Bronze', 'Silver', 'Gold', 'ZEDX', 'PLATINUM']);
    expect(cards[4]).toMatchObject({ title: 'PLATINUM CERTIFICATION', color: ZEDX_COLOR, image: { uri: 'https://zedv3.qci.org.in/api/public/levels/PLATINUM/logo?v=3' } });
    // Without a logo: the ZED logo (not ZED-X's badge); an SVG logo cannot be drawn either.
    const noLogo = levelCards([...BUILT_IN, { code: 'PLATINUM', name: 'Platinum', logoUrl: '/x/platinum.svg?v=1' }], null, logo)[3]!;
    expect((noLogo.image as { uri?: string }).uri).toBeUndefined();
  });

  it('a disabled level not started is hidden; once paid it stays, named from the status', () => {
    expect(levelCards(BUILT_IN, status(0, 0, 0, [level('PLATINUM', 0)]), logo).map(c => c.type)).toEqual(['Bronze', 'Silver', 'Gold']);
    expect(levelCards(null, status(0, 0, 0, [level('PLATINUM', 0)]), logo).map(c => c.type)).toEqual(['Bronze', 'Silver', 'Gold']);
    const paid = levelCards(BUILT_IN, status(0, 0, 0, [level('PLATINUM', 2)]), logo);
    expect(paid.map(c => c.type)).toEqual(['Bronze', 'Silver', 'Gold', 'PLATINUM']);
    expect(paid[3]!.title).toBe('PLATINUM CERTIFICATION');
    expect(addedLevels([PLATINUM], null)).toEqual([{ code: 'PLATINUM', name: 'Platinum', logoUrl: PLATINUM.logoUrl, assessmentMode: 'Site' }]);
  });

  it('reads its status from levels[], by code in any case; ZED-X keeps its own zedx', () => {
    const s = status(0, 0, 0, [level('ZEDX', 3), level('PLATINUM', 2)], 1);
    expect(certificationDetailsOf(s, 'PLATINUM')?.status).toBe(2);
    expect(certificationDetailsOf(s, 'platinum')?.status).toBe(2);
    expect(certificationDetailsOf(s, 'ZEDX')?.status).toBe(1);
    expect(certificationDetailsOf(s, 'DIAMOND')).toBeNull();
    expect(allLevelCodes(s)).toEqual(['Bronze', 'Silver', 'Gold', 'ZEDX', 'PLATINUM']);
    expect(levelDisplayName('PLATINUM', null, s)).toBe('Platinum');
    expect(levelDisplayName('PLATINUM', [{ ...PLATINUM, name: 'Platinum Plus' }], s)).toBe('Platinum Plus');
    expect(levelDisplayName('DIAMOND', null, null)).toBe('DIAMOND');
    expect(levelDisplayName('Gold', [{ code: 'Gold', name: 'ignored' }], s)).toBe('Gold');
  });

  it('APPLY / arrow / greyed out as ZED-X, and a V4 level waits for another one in progress', () => {
    expect(certificationAction(status(0, 0, 0, [level('PLATINUM', 0)]), 'PLATINUM')).toBe('apply');
    expect(certificationAction(status(0, 0, 0), 'PLATINUM')).toBe('apply'); // not in the status yet
    expect(certificationAction(status(2, 0, 0, [level('PLATINUM', 0)]), 'PLATINUM')).toBe('none'); // Bronze in progress
    expect(certificationAction(status(0, 0, 0, [level('PLATINUM', 0)], 2), 'PLATINUM')).toBe('none'); // ZED-X in progress
    expect(certificationAction(status(0, 0, 0, [level('PLATINUM', 1)]), 'ZEDX')).toBe('none'); // and the other way round
    expect(certificationAction(status(0, 0, 0, [level('PLATINUM', 0)], 4), 'PLATINUM')).toBe('apply'); // ZED-X certified
    for (const v of [1, 2, 3, 4]) expect(certificationAction(status(0, 0, 0, [level('PLATINUM', v)]), 'PLATINUM')).toBe('arrow');
    // Once a level the Admin added is paid, Bronze, Silver and Gold not started are greyed out.
    expect(certificationAction(status(0, 0, 0, [level('PLATINUM', 1)]), 'Gold')).toBe('none');
    expect(certificationAction(status(3, 0, 0, [level('PLATINUM', 1)]), 'Bronze')).toBe('arrow');
  });

  it('a desktop level has Bronze steps and numbers (3 certified)', () => {
    const desktop = status(0, 0, 0, [level('PLATINUM', 3, { assessmentMode: 'Desktop' })]);
    expect(isDesktopLevel('PLATINUM', desktop)).toBe(true);
    expect(isDesktopLevel('PLATINUM', status(0, 0, 0, [level('PLATINUM', 3)]))).toBe(false);
    expect(isAnyCertificationCompleted(desktop)).toBe(true);
    expect(isAnyCertificationCompleted(status(0, 0, 0, [level('PLATINUM', 3)]))).toBe(false);
    // Desktop level 2 (desktop verification) is in progress: ZED-X waits.
    expect(certificationAction(status(0, 0, 0, [level('PLATINUM', 2, { assessmentMode: 'Desktop' })], 0), 'ZEDX')).toBe('none');
    expect(certificationAction(status(0, 0, 0, [level('PLATINUM', 3, { assessmentMode: 'Desktop' })], 0), 'ZEDX')).toBe('apply');
    const steps = certificationStatus('PLATINUM', { ApplicationReceived: 'x', DesktopVerification: 'Verified' }, true).steps.map(s => s.title);
    expect(steps).toEqual(['Basic Information and Document Upload', 'Desktop Verification', 'Get Certified!', 'Avail Incentives']);
    expect(certificationStatus('PLATINUM', {}, false).steps.map(s => s.title)).toContain('Remote/Onsite Assessment');
  });

  it('takes a new level over whole from GetMsmeStatus, then only its statuses (local work stays)', () => {
    const local = status(0, 0, 0, []);
    delete local.levels;
    updateCertificationDetails(local, { ...status(0, 0, 0), levels: [level('PLATINUM', 1)] });
    expect(certificationDetailsOf(local, 'PLATINUM')?.status).toBe(1);
    certificationDetailsOf(local, 'PLATINUM')!.finalSubmitDone = true;
    updateCertificationDetails(local, { ...status(0, 0, 0), levels: [{ ...level('PLATINUM', 2), name: 'Platinum Plus' }] });
    expect(local.levels).toHaveLength(1);
    expect(local.levels![0]).toMatchObject({ status: 2, finalSubmitDone: true, name: 'Platinum Plus' });
    // A stored sign-in answer with a level gets the defaults Gson would fill.
    const r = normalizeLoginResponse({ remoteAssessmentData: { isSelfieSubmitted: false }, MsmeDetails: { msmeStatus: { status: '1', levels: [{ code: 'PLATINUM' }] } } } as unknown as LoginResponse);
    expect(r.MsmeDetails?.msmeStatus?.levels?.[0]).toMatchObject({ status: 0, nc1Status: 0, finalSubmitDone: false });
  });

  it('the dashboard text and the info dialog name the level', () => {
    const app = { levels: [...BUILT_IN, { code: 'ZEDX', name: 'ZED-X' }, PLATINUM], user: { MsmeDetails: { msmeStatus: status(0, 0, 0) } } } as unknown as MsmeApp;
    expect(levelsText(app)).toBe('Bronze, Silver, Gold, ZED-X or Platinum');
    expect(levelsText({ levels: BUILT_IN, user: null } as unknown as MsmeApp)).toBe('Bronze, Silver or Gold');
    expect(levelInfo('PLATINUM', PLATINUM)).toEqual({ title: 'Platinum Certification', lines: ['Above ZED-X.', 'Fee as the Admin sets it.'] });
    expect(levelInfo('PLATINUM', null, 'Platinum').title).toBe('Platinum Certification');
  });
});

// ------------------------------------------------------------------ the screens

async function signedInApp(server: FakeServer) {
  const loginDb = await memoryDb();
  const mediaDb = await memoryDb();
  await writeLegacyLoginRow(loginDb, 'PW');
  await writeLegacyPhotoRows(mediaDb);
  const { app } = await makeApp(server, { loginDb, mediaDb });
  await app.offlineLogin(ZED_ID, 'PW');
  await app.refreshLevels();
  return app;
}

function render(app: MsmeApp, name: string, params?: Record<string, unknown>) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <UiHost>
        <MsmeAppProvider app={app}>
          <AppDrawerHost>
            <StackNavigator screens={SCREENS} initial={{ name, params }} overlay={<AppDrawerOverlay />} />
          </AppDrawerHost>
        </MsmeAppProvider>
      </UiHost>,
    );
  });
  return r;
}

const byTestId = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && typeof n.type === 'string');
const press = (r: ReactTestRenderer.ReactTestRenderer, id: string) =>
  act(async () => r.root.findAll(n => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());
const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAll(n => (n.type as unknown) === 'Text').map(n => (Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '')));

const PARAMETERS = [{ id: 1, code: 'P1', name: 'Parameter 1', requirements: [] }];

function levelServer(levels: PublicLevel[]) {
  return new FakeServer(req => {
    if (req.url.endsWith('api/public/levels')) return levels;
    if (req.url.endsWith('GetParametersByType')) return { status: '1', parameters: PARAMETERS };
    return { status: '1' };
  });
}

describe('My Certifications with a level the Admin added', () => {
  it('shows the PLATINUM card with the Admin name and its status from levels[]; the arrow opens it as ZED-X', async () => {
    const server = levelServer([...BUILT_IN, PLATINUM]);
    const app = await signedInApp(server);
    app.user!.MsmeDetails!.msmeStatus!.levels = [level('PLATINUM', 1)];
    const r = render(app, 'MyCertifications');
    await act(async () => undefined);
    expect(byTestId(r, 'platinum-card')).toHaveLength(1);
    expect(texts(r)).toContain('PLATINUM CERTIFICATION');
    expect(texts(r)).toContain('Basic Information & Document Upload'); // status 1: paid, entry under way
    expect(byTestId(r, 'platinum-card-apply')).toHaveLength(0);
    await press(r, 'platinum-card-open');
    expect(server.last('GetParametersByType')!.json).toMatchObject({ certificationType: 'PLATINUM' });
    expect(byTestId(r, 'option-basic-info')).toHaveLength(1);
    expect(texts(r)).toContain('Platinum Certification');
    expect(certificationDetailsOf(app.user!.MsmeDetails!.msmeStatus, 'PLATINUM')!.parameters).toHaveLength(1);
  });

  it('APPLY on a PLATINUM level not paid opens the payment for PLATINUM', async () => {
    const server = levelServer([...BUILT_IN, PLATINUM]);
    const app = await signedInApp(server);
    const s = app.user!.MsmeDetails!.msmeStatus!;
    s.bronze!.status = 3; // certified: nothing in progress
    s.levels = [level('PLATINUM', 0)];
    const r = render(app, 'MyCertifications');
    await act(async () => undefined);
    await press(r, 'platinum-card-apply');
    expect(byTestId(r, 'payment')).toHaveLength(1);
    expect(server.last('GetPaymentDetailsByType')!.json).toMatchObject({ certification: 'PLATINUM' });
  });

  it('hides a disabled PLATINUM level the unit has not started', async () => {
    const app = await signedInApp(levelServer(BUILT_IN));
    app.user!.MsmeDetails!.msmeStatus!.levels = [level('PLATINUM', 0)];
    const r = render(app, 'MyCertifications');
    await act(async () => undefined);
    expect(byTestId(r, 'gold-card')).toHaveLength(1);
    expect(byTestId(r, 'platinum-card')).toHaveLength(0);
  });
});

describe('My Documents with a level the Admin added', () => {
  it('lists the certificate of PLATINUM (its code column) with the Admin name', async () => {
    const server = new FakeServer(req => {
      if (req.url.endsWith('api/public/levels')) return [...BUILT_IN, PLATINUM];
      if (req.url.endsWith('GetMyDocuments'))
        return { Guidelines: [], Certificates: [{ Pledge: null, Bronze: null, ZEDX: null, PLATINUM: 'Certificates/SA/X/PLATINUM.pdf', DIAMOND: null }] };
      return { status: '1' };
    });
    const app = await signedInApp(server);
    const r = render(app, 'MyDocuments');
    await act(async () => {
      await Promise.resolve();
    });
    expect(byTestId(r, 'certificate-PLATINUM')).toHaveLength(1);
    expect(byTestId(r, 'certificate-DIAMOND')).toHaveLength(0);
    expect(texts(r)).toContain('Platinum Certificate');
  });
});
