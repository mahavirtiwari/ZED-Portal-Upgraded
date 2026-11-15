import { certificationCardState } from '../src/components/CertificationCard';
import { certificationStatus } from '../src/components/CertificationStatusDialog';
import {
  certifiedStatus,
  isAnyCertificationCompleted,
  isDesktopLevel,
  updateCertificationDetails,
  type CertificationDetails,
  type MsmeStatus,
} from '../src/models';
import { certificationAction } from '../src/screens/MyCertificationsScreen';

// 2026-11-15 (approved design docs/designs/msme-app-bronze-with-visit.html): a Bronze whose record has a visit shows the
// visit's own steps (Silver's), from the server's assessmentMode "Site"; a Bronze at the desktop stays as it was.

const cert = (over: Partial<CertificationDetails> = {}): CertificationDetails => ({
  status: 1,
  nc1Status: 0,
  nc2Status: 0,
  nc3Status: 0,
  nc4Status: 0,
  nc5Status: 0,
  finalSubmitDone: false,
  ...over,
});

const status = (bronze: Partial<CertificationDetails>, silver = 0, gold = 0): MsmeStatus =>
  ({ financialAssistanceStatus: 0, bronze: cert(bronze), silver: cert({ status: silver }), gold: cert({ status: gold }) }) as MsmeStatus;

describe('Bronze with a visit', () => {
  it('is a site level only when the server says its record is Site; Desktop or no mode stays desktop', () => {
    expect(isDesktopLevel('Bronze', status({ status: 2, assessmentMode: 'Site' }))).toBe(false);
    expect(isDesktopLevel('Bronze', status({ status: 3, assessmentMode: 'Desktop' }))).toBe(true);
    expect(isDesktopLevel('Bronze', status({ status: 3 }))).toBe(true);
    expect(isDesktopLevel('Bronze', null)).toBe(true);
    expect(certifiedStatus('Bronze', status({ status: 4, assessmentMode: 'Site' }))).toBe(4);
    expect(certifiedStatus('Bronze', status({ status: 3 }))).toBe(3);
  });

  it('card: four steps with the visit named by the flow, the NC on the visit step, completed at 4', () => {
    const site = (s: number, over: Partial<CertificationDetails> = {}) => certificationCardState(cert({ status: s, assessmentMode: 'Site', ...over }), false, false, 'DesktopOnsite');
    expect(site(2)).toMatchObject({ statusText: 'Desktop Verification', one: 'completed', two: 'default', three: 'default', five: null });
    expect(site(3)).toMatchObject({ statusText: 'Onsite Assessment', two: 'completed', three: 'current' });
    expect(site(3, { nc1Status: 1 }).three).toBe('nc');
    expect(site(4)).toMatchObject({ statusText: 'Completed', three: 'completed', four: 'completed' });
    // Remote only: no desktop dot.
    expect(certificationCardState(cert({ status: 3, assessmentMode: 'Site' }), false, false, 'Remote')).toMatchObject({ statusText: 'Remote Assessment', two: null });
  });

  it('VIEW DETAILS lists the visit as its own step with its NCs', () => {
    const s = certificationStatus('Bronze', {
      ApplicationReceived: 'Received',
      BasicInfoStatus: 'Submitted',
      DesktopVerification: 'Desktop verification completed',
      ScheduledOn: 'Onsite assessment scheduled',
      NcFinalClosureDate: 'Close by',
      Nc1Raised: 'NC 1 raised',
    }, false, 'DesktopOnsite');
    expect(s.steps.map(x => x.title)).toEqual(['Basic Information and Document Upload', 'Desktop Verification', 'Onsite Assessment', 'Get Certified!', 'Avail Incentives']);
    expect(s.steps[1]?.nc).toBeNull();
    expect(s.steps[2]?.nc?.lines).toEqual([{ who: 'ZED', text: 'NC 1 raised' }]);
  });

  it('a Bronze certified after its visit (4) counts as certified for Silver / Gold and the incentives; 3 at the visit does not', () => {
    expect(certificationAction(status({ status: 4, assessmentMode: 'Site' }), 'Silver')).toBe('apply');
    expect(certificationAction(status({ status: 4, assessmentMode: 'Site' }), 'Gold')).toBe('apply');
    expect(certificationAction(status({ status: 3, assessmentMode: 'Site' }), 'Silver')).toBe('none');
    expect(certificationAction(status({ status: 3, assessmentMode: 'Site' }), 'Bronze')).toBe('arrow');
    expect(isAnyCertificationCompleted(status({ status: 4, assessmentMode: 'Site' }))).toBe(true);
    expect(isAnyCertificationCompleted(status({ status: 3, assessmentMode: 'Site' }))).toBe(false);
    // A Bronze at the desktop: as before.
    expect(certificationAction(status({ status: 3 }), 'Silver')).toBe('apply');
    expect(isAnyCertificationCompleted(status({ status: 3 }))).toBe(true);
  });

  it('the server\'s mode is taken into the stored data, and kept when an older server leaves it out', () => {
    const local = status({ status: 2 });
    updateCertificationDetails(local, status({ status: 3, assessmentMode: 'Site', remoteStatus: '1' }));
    expect(local.bronze).toMatchObject({ status: 3, assessmentMode: 'Site', remoteStatus: '1' });
    updateCertificationDetails(local, status({ status: 4 }));
    expect(local.bronze?.assessmentMode).toBe('Site');
  });
});
