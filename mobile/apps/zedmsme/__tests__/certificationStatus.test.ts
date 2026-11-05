import { certificationStatus } from '../src/components/CertificationStatusDialog';

describe('VIEW DETAILS status steps (Views/Msme/ViewStatus.cshtml)', () => {
  it('Bronze: four steps, the NC rounds under Desktop Verification, later steps not reached', () => {
    const s = certificationStatus('Bronze', {
      ApplicationReceived: 'Application received on May 1, 2024',
      BasicInfoStatus: 'Submitted on May 2, 2024',
      BronzeDesktopVerification: 'Completed on May 5, 2024',
      NcFinalClosureDate: 'Close by May 20, 2024',
      Nc1Raised: 'NC 1 raised on May 5, 2024',
      Nc1Submitted: 'NC 1 submitted on May 6, 2024',
      Nc2Raised: ' ',
      GetCertified: null,
    });
    expect(s.applicationReceived).toBe('Application received on May 1, 2024');
    expect(s.steps.map(x => x.title)).toEqual(['Basic Information and Document Upload', 'Desktop Verification', 'Get Certified!', 'Avail Incentives']);
    expect(s.steps.map(x => x.reached)).toEqual([true, true, false, false]);
    expect(s.steps[0]?.lines).toEqual([{ who: 'YOU', text: 'Submitted on May 2, 2024' }]);
    expect(s.steps[1]?.nc).toEqual({
      closure: 'Close by May 20, 2024',
      lines: [
        { who: 'ZED', text: 'NC 1 raised on May 5, 2024' },
        { who: 'YOU', text: 'NC 1 submitted on May 6, 2024' },
      ],
    });
    expect(s.steps[3]?.pending).toBe('After certification');
  });

  it('Silver and Gold: Desktop Verification, then Remote/Onsite Assessment; certified opens the incentives', () => {
    const s = certificationStatus('Silver', {
      ApplicationReceived: 'Received',
      DesktopVerification: 'Completed on Oct 28, 2026',
      ScheduledOn: 'Scheduled on Nov 5, 2026',
      NcClosed: 'NC closed on Nov 9, 2026',
      GetCertified: 'Certified on Nov 10, 2026',
      AvailIncentive: 'https://zedv3.qci.org.in/Incentive/Details/9?ct=Silver',
    });
    expect(s.steps.map(x => x.title)).toEqual([
      'Basic Information and Document Upload',
      'Desktop Verification',
      'Remote/Onsite Assessment',
      'Get Certified!',
      'Avail Incentives',
    ]);
    expect(s.steps.every(x => x.reached)).toBe(true);
    expect(s.steps[2]?.lines).toEqual([{ who: 'ZED', text: 'Scheduled on Nov 5, 2026' }]);
    expect(s.steps[2]?.nc).toBeNull();
    expect(s.steps[2]?.after).toEqual([{ who: 'ZED', text: 'NC closed on Nov 9, 2026' }]);
    expect(s.steps[4]?.link).toBe('https://zedv3.qci.org.in/Incentive/Details/9?ct=Silver');
  });

  it('A step with data counts as reached even when its first entry is missing (NC rounds stay visible)', () => {
    const s = certificationStatus('Bronze', {
      BasicInfoStatus: 'In-progress',
      Nc1Raised: 'NC 1 Raised On November 5, 2026',
      NcFinalClosureDate: 'Final Closure Date: December 5, 2026',
    });
    expect(s.steps.map(x => x.reached)).toEqual([true, true, false, false]);
    expect(s.steps[1]?.lines).toEqual([]);
    expect(s.steps[1]?.nc?.lines).toEqual([{ who: 'ZED', text: 'NC 1 Raised On November 5, 2026' }]);
  });

  it('Nothing received yet: every step waits', () => {
    const s = certificationStatus('Gold', {});
    expect(s.applicationReceived).toBeNull();
    expect(s.steps.some(x => x.reached)).toBe(false);
  });
});
