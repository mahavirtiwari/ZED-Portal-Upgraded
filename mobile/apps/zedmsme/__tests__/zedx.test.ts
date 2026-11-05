import type { PublicLevel } from '../src/api';
import { showZedx, zedxLevel } from '../src/levels';
import {
  certificationDetailsOf,
  certificationLabel,
  isAnyCertificationCompleted,
  levelName,
  normalizeLoginResponse,
  updateCertificationDetails,
  type CertificationDetails,
  type LoginResponse,
  type MsmeStatus,
} from '../src/models';
import { levelsText } from '../src/screens/DashboardScreen';
import { certificationAction, levelCards, levelInfo, ZEDX_COLOR } from '../src/screens/MyCertificationsScreen';

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

const status = (b: number, s: number, g: number, x?: number): MsmeStatus => ({
  status: '1',
  bronze: cert(b),
  silver: cert(s),
  gold: cert(g),
  ...(x == null ? {} : { zedx: cert(x) }),
  financialAssistanceStatus: 0,
});

const ZEDX_LEVEL: PublicLevel = {
  code: 'ZEDX',
  name: 'ZED-X',
  description: 'The highest level, with desktop and site assessment.',
  comment: 'Fee as set by the Admin.',
  logoUrl: '/api/public/levels/ZEDX/logo?v=1',
};
const ENABLED: PublicLevel[] = [{ code: 'Bronze', name: 'Bronze' }, ZEDX_LEVEL];
const logo = (url: string) => 'https://zedv3.qci.org.in' + url;

describe('ZED-X in the ZED MSME app', () => {
  it('names the level ZED-X (the Admin name when given)', () => {
    expect(levelName('ZEDX')).toBe('ZED-X');
    expect(levelName('ZEDX', 'ZED X Plus')).toBe('ZED X Plus');
    expect(levelName('Gold', 'ignored')).toBe('Gold');
    expect(certificationLabel('ZEDX')).toBe('ZED-X Certification');
    expect(certificationLabel('Silver')).toBe('Silver Certification');
  });

  it('shows the card once the Admin enables ZED-X, or once the unit has paid for it', () => {
    expect(showZedx(null, status(0, 0, 0))).toBe(false);
    expect(showZedx([{ code: 'Bronze', name: 'Bronze' }], status(0, 0, 0, 0))).toBe(false);
    expect(showZedx(ENABLED, status(0, 0, 0))).toBe(true);
    expect(showZedx([{ code: 'zedx', name: 'ZED-X' }], null)).toBe(true);
    // Switched off (or never listed on this phone) while the unit's ZED-X is under way: the card stays.
    expect(showZedx([], status(0, 0, 0, 2))).toBe(true);
    expect(zedxLevel(ENABLED)?.name).toBe('ZED-X');
  });

  it('adds a fourth card with the Admin logo, or the built-in badge without one', () => {
    expect(levelCards(null, status(0, 0, 0), logo).map(c => c.type)).toEqual(['Bronze', 'Silver', 'Gold']);
    const cards = levelCards(ENABLED, status(0, 0, 0), logo);
    expect(cards.map(c => c.type)).toEqual(['Bronze', 'Silver', 'Gold', 'ZEDX']);
    expect(cards[3]).toMatchObject({ title: 'ZED-X CERTIFICATION', color: ZEDX_COLOR, image: { uri: 'https://zedv3.qci.org.in/api/public/levels/ZEDX/logo?v=1' } });
    const noLogo = levelCards([{ code: 'ZEDX', name: 'ZED-X' }], status(0, 0, 0), logo)[3]!;
    expect((noLogo.image as { uri?: string }).uri).toBeUndefined();
  });

  it('ZED-X may be applied for unless Bronze, Silver or Gold is in progress', () => {
    expect(certificationAction(status(0, 0, 0), 'ZEDX')).toBe('apply'); // not in the status yet
    expect(certificationAction(status(0, 0, 0, 0), 'ZEDX')).toBe('apply');
    expect(certificationAction(status(3, 0, 0, 0), 'ZEDX')).toBe('apply'); // Bronze certified
    expect(certificationAction(status(0, 4, 0, 0), 'ZEDX')).toBe('apply'); // Silver certified
    expect(certificationAction(status(2, 0, 0, 0), 'ZEDX')).toBe('none'); // Bronze under desktop verification
    expect(certificationAction(status(0, 3, 0, 0), 'ZEDX')).toBe('none');
    expect(certificationAction(status(0, 0, 1), 'ZEDX')).toBe('none');
  });

  it('ZED-X has the arrow from payment to certification', () => {
    for (const x of [1, 2, 3, 4]) expect(certificationAction(status(0, 0, 0, x), 'ZEDX')).toBe('arrow');
    expect(certificationAction(status(0, 0, 0, 5), 'ZEDX')).toBe('none');
  });

  it('once ZED-X is paid, Bronze, Silver and Gold that have not started are greyed out', () => {
    expect(certificationAction(status(0, 0, 0, 1), 'Bronze')).toBe('none');
    expect(certificationAction(status(0, 0, 0, 2), 'Silver')).toBe('none');
    expect(certificationAction(status(0, 0, 0, 4), 'Gold')).toBe('none');
    // A level already under way keeps its arrow; without ZED-X the old rules apply.
    expect(certificationAction(status(3, 0, 0, 1), 'Bronze')).toBe('arrow');
    expect(certificationAction(status(0, 0, 0, 0), 'Gold')).toBe('apply');
    expect(certificationAction(status(0, 0, 0), 'Silver')).toBe('apply');
  });

  it('the info dialog shows the Admin description and comment', () => {
    expect(levelInfo('ZEDX', ZEDX_LEVEL)).toEqual({
      title: 'ZED-X Certification',
      lines: ['The highest level, with desktop and site assessment.', 'Fee as set by the Admin.'],
    });
    expect(levelInfo('ZEDX', { code: 'ZEDX', name: 'ZED-X', description: '  ', comment: null }).lines).toEqual([]);
    expect(levelInfo('Gold', null).title).toBe('Gold Certification');
  });

  it('takes ZED-X over from GetMsmeStatus when the stored sign-in answer has none, then only its statuses', () => {
    const local = status(0, 0, 0);
    updateCertificationDetails(local, { ...status(0, 0, 0), zedx: { ...cert(1), certificate: null } as CertificationDetails });
    expect(certificationDetailsOf(local, 'ZEDX')?.status).toBe(1);

    local.zedx!.basicInformation = { status: 'IN_PROGRESS' } as never;
    updateCertificationDetails(local, { ...status(0, 0, 0), zedx: cert(2, { nc1Status: 1, certificate: 'Certificates/SA/Z/ZEDX.pdf' }) });
    expect(local.zedx).toMatchObject({ status: 2, nc1Status: 1, certificate: 'Certificates/SA/Z/ZEDX.pdf', basicInformation: { status: 'IN_PROGRESS' } });

    // A server that leaves ZED-X out does not remove the local one.
    updateCertificationDetails(local, status(0, 0, 0));
    expect(local.zedx?.status).toBe(2);
  });

  it('normalises a stored ZED-X and counts its certification as completed', () => {
    const r = normalizeLoginResponse({
      status: '1',
      MsmeDetails: { msmeStatus: { status: '1', zedx: { status: 4 } as CertificationDetails } as MsmeStatus },
    } as LoginResponse);
    const zedx = r.MsmeDetails!.msmeStatus!.zedx!;
    expect(zedx.nc5Status).toBe(0);
    expect(zedx.finalSubmitDone).toBe(false);
    expect(isAnyCertificationCompleted(r.MsmeDetails!.msmeStatus!)).toBe(true);
  });

  it('the dashboard names ZED-X once its card is shown', () => {
    const user = { status: '1', MsmeDetails: { msmeStatus: status(0, 0, 0) } } as LoginResponse;
    expect(levelsText({ levels: null, user })).toBe('Bronze, Silver or Gold');
    expect(levelsText({ levels: ENABLED, user })).toBe('Bronze, Silver, Gold or ZED-X');
  });
});
