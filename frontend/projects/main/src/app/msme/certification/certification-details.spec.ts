import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CertificationDetailsPage } from './certification-details';
import { CertificationData } from './certification.api';
import { PublicLevels } from '../shared/levels';

const LEGACY = 'https://legacy.example.test';

function details(certification: string, status: CertificationData['status'] = {}, certStatus: CertificationData['certStatus'] = {}): CertificationData {
  return {
    certification,
    msme: { ZedId: 'ZEDMSME000001', EnterpriseName: 'Acme Castings', EnterpriseType: 'Micro', RegistrationType: 'UDYAM', StateId: 9, PUnitName: 'Unit 1', PledgeOn: 'May 1, 2024' },
    basicInfo: { UdyogAadharNo: 'UDYAM-UP-29-0003915' },
    certStatus,
    status,
  };
}

describe('CertificationDetailsPage', () => {
  let fixture: ComponentFixture<CertificationDetailsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Opens the page for a route value and answers the API with the given data (and the dashboard's, for "Go further"). */
  async function open(
    route: string,
    data: CertificationData | null,
    expectedUrl = `/api/msme/certifications/${data?.certification}`,
    dashboard: { msme: Record<string, unknown> } = { msme: {} },
    fees: Record<string, number | null> = {},
  ) {
    fixture.componentRef.setInput('certification', route);
    await settle();
    for (const r of http.match('/api/config')) r.flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: LEGACY });
    if (data) http.expectOne(expectedUrl).flush(data);
    await settle();
    for (const r of http.match('/api/msme/dashboard')) r.flush(dashboard);
    for (const r of http.match('/api/msme/dashboard/level-fees')) r.flush(fees);
    await settle();
  }

  const text = () => el.textContent!.replace(/\s+/g, ' ');
  /** A row of "Quick actions" by its label. */
  const action = (label: string) =>
    Array.from(el.querySelectorAll<HTMLElement>('.qa-row')).find((a) => a.querySelector('.qa-label')!.textContent!.trim() === label);
  const link = (label: string) => action(label)!.querySelector('a');
  const trackerSteps = () => Array.from(el.querySelectorAll('zed-step-tracker .st-label')).map((s) => s.textContent!.trim());
  const currentStep = () => el.querySelector('zed-step-tracker .st-now .st-label')?.textContent!.trim() ?? null;
  const facts = () => Array.from(el.querySelectorAll('.cd-facts > div')).map((f) => `${f.querySelector('dt')!.textContent}: ${f.querySelector('dd')!.textContent}`);
  const timelineTitles = () => Array.from(el.querySelectorAll('zed-certification-timeline .tl-title')).map((t) => t.textContent!.trim());

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CertificationDetailsPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(CertificationDetailsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
  });

  afterEach(() => http.verify());

  it('loads the certification in its canonical spelling and shows the unit in the header card', async () => {
    await open('bronze', details('Bronze'), '/api/msme/certifications/Bronze');

    expect(el.querySelector('zed-page-head .ph-title')!.textContent).toBe('Bronze Certification');
    expect(Array.from(el.querySelectorAll('zed-page-head .ph-crumb > *:not(.ph-sep)')).map((c) => c.textContent!.trim())).toEqual(['Home', 'Certifications', 'Bronze']);
    expect(el.querySelector('.cd-hero h3')!.textContent).toBe('Acme Castings');
    expect(text()).toContain('UDYAM-UP-29-0003915');
    expect(text()).toContain('ZED ID ZEDMSME000001');
    expect(text()).toContain('Plant: Unit 1');
    expect(text()).not.toContain('Pledge taken on');
    expect(el.querySelector('.chip-size')!.textContent!.trim()).toBe('MICRO');
    // Basic information not submitted yet: the app banner shows (design note: only while a step is pending in the app).
    expect(el.querySelector('.cd-app')).toBeTruthy();
    // Nothing to download yet: no buttons in the header card.
    expect(el.querySelector('.cd-btns')).toBeNull();
  });

  it('shows the Bronze progress, the timeline with the NC rounds in one block and the actions', async () => {
    await open('Bronze', details('Bronze', {
      ApplicationReceived: 'Application received on May 1, 2024',
      BasicInfoStatus: 'Submitted on May 2, 2024',
      BronzeDesktopVerification: 'In-progress',
      NcFinalClosureDate: 'Close by June 1, 2024',
      Nc1Raised: 'NC raised on May 5, 2024',
      Nc1Submitted: 'NC replied on May 6, 2024',
    }, { BronzeStatus: 3, CertPath: 'Certificates' }));

    expect(trackerSteps()).toEqual(['Application received', 'Information & documents', 'Desktop verification', 'Certified', 'Avail incentives']);
    expect(currentStep()).toBe('Desktop verification');
    expect(el.querySelectorAll('zed-step-tracker .st-done').length).toBe(2);
    expect(el.querySelector('.chip-status')!.textContent!.trim()).toBe('IN PROGRESS');
    expect(facts()).toEqual(['Applied on: 1 May 2024']);

    // Newest first; the NC rounds in one block.
    expect(timelineTitles()).toEqual(['Non-conformances', 'Desktop verification', 'Basic information & documents', 'Application received']);
    const items = Array.from(el.querySelectorAll<HTMLElement>('.tl-item'));
    expect(items[2].querySelector('.tl-date')!.textContent).toBe('2 May 2024');
    expect(items[2].querySelector('.tl-who')!.textContent).toBe('YOU');
    expect(items[1].querySelector('.tl-who')!.textContent).toBe('ZED');
    expect(items[1].querySelector('.tl-note')!.textContent).toBe('In-progress');
    const nc = el.querySelector<HTMLElement>('.tl-nc')!;
    expect(nc.querySelector('.nc-chip')!.textContent).toBe('1 RAISED · 1 RESPONDED');
    expect(nc.querySelector('.nc-final')!.textContent).toBe('Final closure date 1 Jun 2024');
    expect(nc.querySelectorAll('.nc-row').length).toBe(1);
    expect(nc.querySelector('.nc-row')!.textContent!.replace(/\s+/g, ' ')).toContain('Raised by ZED · 5 May 2024 → You responded · 6 May 2024');
    expect(nc.querySelector('.nc-view')!.getAttribute('href')).toBe('/msme/assessment/non-conformances/Bronze');
    // Basic information submitted: no app banner.
    expect(el.querySelector('.cd-app')).toBeNull();
    expect(el.querySelector('.rail-next h3')!.textContent).toBe('Desktop verification');

    // Basic information opens once BronzeStatus > 1, on the assessment report pages.
    const basic = action('View basic information & documents')!;
    expect(basic.classList).not.toContain('qa-off');
    expect(link('View basic information & documents')!.getAttribute('href')).toBe('/msme/assessment/basic-info/Bronze');
    const ncAction = action('Non-conformance history')!;
    expect(ncAction.classList).toContain('qa-danger');
    expect(link('Non-conformance history')!.getAttribute('href')).toBe('/msme/assessment/non-conformances/Bronze');

    // Not certified yet: downloads are greyed out and not links.
    for (const label of ['Download certificate (PDF)', 'View assessment report', 'View my incentives']) {
      expect(action(label)!.classList).toContain('qa-off');
      expect(link(label)).toBeNull();
    }
  });

  it('asks for a response while the last NC round is not answered', async () => {
    await open('Bronze', details('Bronze', {
      ApplicationReceived: 'Received on May 1, 2024',
      BasicInfoStatus: 'Submitted on May 2, 2024',
      NcFinalClosureDate: 'Final Closure Date: June 1, 2024',
      Nc1Raised: 'NC raised on May 5, 2024',
    }, { BronzeStatus: 3 }));
    expect(el.querySelector('.rail-next h3')!.textContent).toBe('Respond to the non-conformances');
    expect(el.querySelector('.rail-next a')!.getAttribute('href')).toBe('/msme/assessment/non-conformances/Bronze');
    expect(el.querySelector('.nc-row')!.textContent).toContain('Awaiting your response');
  });

  it('follows the flow of the level: Remote only has no desktop step and a Remote assessment step (2026-11-14)', async () => {
    TestBed.inject(PublicLevels).levels.set([{ code: 'Silver', name: 'Silver', logoUrl: null, assessmentFlow: 'Remote' }]);
    await open('Silver', details('Silver', { ApplicationReceived: 'Received', ScheduledOn: 'Scheduled' }));
    expect(trackerSteps()).toEqual(['Application received', 'Information & documents', 'Remote assessment', 'Certified', 'Avail incentives']);
    expect(timelineTitles()).toEqual(['Remote assessment', 'Application received']);
  });

  it('links the certificate and report of this portal and the incentives once certified', async () => {
    await open('Silver', details('Silver', {
      ApplicationReceived: 'Received',
      DesktopVerification: 'Done',
      ScheduledOn: 'Scheduled',
      CompletedOn: 'Completed',
      GetCertified: 'Certificate & Report generated on June 1, 2024',
      AvailIncentive: 'https://loginzed.msme.gov.in/Incentive/Details/9?ct=Silver',
    }, { CertPath: 'Certifications' }));

    expect(trackerSteps()).toEqual([
      'Application received', 'Information & documents', 'Desktop verification', 'Remote/onsite assessment', 'Certified', 'Avail incentives',
    ]);
    expect(currentStep()).toBe('Avail incentives');
    expect(el.querySelector('zed-step-tracker .st-now .st-note')!.textContent).toBe('Your next step');
    expect(el.querySelector('.chip-status')!.textContent).toContain('SILVER CERTIFIED');
    expect(facts()).toEqual(['Certified on: 1 Jun 2024']);
    expect(timelineTitles()[0]).toBe('Certificate & report generated');

    // The header card's two buttons.
    const [cert, report] = Array.from(el.querySelectorAll('.cd-btns a'));
    expect(cert.getAttribute('href')).toBe('/api/msme/certification-documents/Silver/certificate');
    expect(cert.textContent!.trim()).toContain('Download certificate');
    expect(report.getAttribute('href')).toBe('/msme/report/assessment/Silver');
    expect(report.getAttribute('target')).toBe('_blank');

    expect(link('Download certificate (PDF)')!.getAttribute('href')).toBe('/api/msme/certification-documents/Silver/certificate');
    expect(link('Download certificate (PDF)')!.getAttribute('target')).toBe('_blank');
    // 2026-11-15: the report page (a new tab) instead of the PDF.
    expect(link('View assessment report')!.getAttribute('href')).toBe('/msme/report/assessment/Silver');
    expect(link('View assessment report')!.getAttribute('target')).toBe('_blank');
    expect(link('View my incentives')!.getAttribute('href')).toBe('/incentives?ct=Silver&id=9'); // the public incentive list, now in this portal
    expect(link('View my incentives')!.getAttribute('target')).toBeNull(); // same tab
    expect(action('View onsite/remote assessment information')!.classList).not.toContain('qa-off');
    expect(link('View basic information & documents')!.getAttribute('href')).toBe('/msme/assessment/basic-info/Silver');
    expect(link('View onsite/remote assessment information')!.getAttribute('href')).toBe('/msme/site-assessment/Silver');

    // Your next step: the incentives, in the same tab.
    expect(el.querySelector('.rail-next h3')!.textContent).toBe('Avail your incentives');
    expect(el.querySelector('.rail-next a')!.getAttribute('href')).toBe('/incentives?ct=Silver&id=9');
    expect(el.querySelector('.rail-next a')!.getAttribute('target')).toBeNull();
    // The dashboard gave no payment flag for Gold: no "Go further".
    expect(el.querySelector('.rail-further')).toBeNull();
  });

  it('offers the next level with the unit\'s fee once certified and the next level is not paid for', async () => {
    await open('Bronze', details('Bronze', { GetCertified: 'Certificate & Report generated on June 1, 2024' }, { BronzeStatus: 6 }),
      '/api/msme/certifications/Bronze', { msme: { IsSilverPaymentDone: 0 } }, { Silver: 5000 });
    expect(el.querySelector('#furtherTitle')!.textContent).toBe('Go further: Silver');
    expect(el.querySelector('.rail-further')!.textContent).toContain('Your fee ₹ 5,000');
    // 2026-11-17: straight to the apply flow of that level on the dashboard.
    expect(el.querySelector('.rail-further a')!.getAttribute('href')).toBe('/msme/dashboard?apply=Silver');
  });

  it('does not offer the next level once it is paid for', async () => {
    await open('Bronze', details('Bronze', { GetCertified: 'Certified on June 1, 2024' }, { BronzeStatus: 6 }),
      '/api/msme/certifications/Bronze', { msme: { IsSilverPaymentDone: 1 } }, { Silver: 5000 });
    expect(el.querySelector('.rail-further')).toBeNull();
  });

  it('links the Bronze certificate and report of this portal even before the file exists', async () => {
    await open('Bronze', details('Bronze', { GetCertified: 'Certified on June 1, 2024' }, { BronzeStatus: 6, CertPath: null }));
    expect(link('Download certificate (PDF)')!.getAttribute('href')).toBe('/api/msme/certification-documents/Bronze/certificate');
    expect(link('View assessment report')!.getAttribute('href')).toBe('/msme/report/assessment/Bronze');
    expect(action('Download certificate (PDF)')!.classList).not.toContain('qa-off');
    expect(el.querySelector('.cd-app')).toBeNull();
  });

  it('never links a surveillance certificate the surveillance system has not stored', async () => {
    await open('GoldSurveillance', details('GoldSurveillance', { GetCertified: 'Certified' }, { SurveCertPath: '../../etc' }));
    expect(action('Download surveillance certificate (PDF)')!.classList).toContain('qa-off');
    expect(link('Download surveillance certificate (PDF)')).toBeNull();
    expect(Array.from(el.querySelectorAll('.cd-btns a')).map((a) => a.textContent!.trim())).toEqual(['View surveillance report']);
  });

  it('shows the surveillance progress and surveillance downloads', async () => {
    await open('BronzeSurveillance', details('BronzeSurveillance', {
      ApplicationReceived: 'Received',
      ScheduledOn: 'Scheduled on July 1, 2025',
      GetCertified: 'Certified',
      DesktopVerification: 1,
    }, { SurveCertPath: 'Surveillance/Certificates' }));

    expect(el.querySelector('zed-page-head .ph-title')!.textContent).toBe('Bronze Surveillance');
    expect(trackerSteps()).toEqual(['Application received', 'Surveillance assessment', 'Certified', 'Avail incentives']);
    expect(timelineTitles()).toEqual(['Certificate & report generated', 'Surveillance assessment', 'Application received for surveillance assessment']);
    expect(el.querySelector('.cd-app')).toBeNull();
    expect(link('Download surveillance certificate (PDF)')!.getAttribute('href'))
      .toBe('/api/msme/certification-documents/BronzeSurveillance/certificate');
    expect(link('View surveillance report')!.getAttribute('href')).toBe('/msme/report/surveillance/Bronze');
    expect(action('View onsite/remote assessment information')).toBeUndefined();
  });

  it('shows a handholding milestone with the consultancy report', async () => {
    await open('goldmilestone2', details('GoldMilestone2', {
      AllocationCompleted: 'In-progress',
      BdsScheduledOn: 'BDS on May 1, 2025',
      HapScheduledOn: 'HAP on May 2, 2025',
      SubmittedByConsultant: 'Submitted',
      CompletedOn: 'Completed',
    }), '/api/msme/certifications/GoldMilestone2');

    expect(el.querySelector('zed-page-head .ph-title')!.textContent).toBe('Handholding Support: Milestone 2');
    expect(trackerSteps()).toEqual(['Consulting organisation allocated', 'Milestone 2', 'Accepted by you']);
    expect(currentStep()).toBe('Accepted by you');
    expect(timelineTitles()).toEqual(['Submitted by the consultant', 'Milestone 2', 'Allocation of consulting organisation']);
    expect(el.querySelectorAll('.tl-date')[1].textContent).toBe('1 May 2025');
    expect(text()).not.toContain('HAP'); // only milestone 1 lists the HAP date
    expect(link('View milestone 2')!.getAttribute('href')).toBe('/msme/site-assessment/GoldMilestone2');
    expect(link('View report')!.getAttribute('href')).toBe('/msme/report/milestone/Gold?milestone=2');
    expect(action('Download certificate (PDF)')).toBeUndefined();
    expect(el.querySelector('.rail-next a')!.getAttribute('href')).toBe('/msme/site-assessment/GoldMilestone2');
  });

  it('rejects an unknown certification without calling the API', async () => {
    await open('Platinum', null);
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Invalid certification.');
    http.expectNone((r) => r.url.startsWith('/api/msme/certifications'));
  });

  it('shows the message from the API', async () => {
    fixture.componentRef.setInput('certification', 'SilverSurveillance');
    await settle();
    for (const r of http.match('/api/config')) r.flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: LEGACY });
    http.expectOne('/api/msme/certifications/SilverSurveillance')
      .flush({ title: 'No details are available for this certification yet.' }, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('No details are available for this certification yet.');
  });

  it('reloads on Refresh and when the route changes', async () => {
    await open('Bronze', details('Bronze'));
    ([...el.querySelectorAll('zed-page-head button')].find((b) => b.textContent!.includes('Refresh')) as HTMLButtonElement).click();
    await settle();
    http.expectOne('/api/msme/certifications/Bronze').flush(details('Bronze'));
    await settle();

    await open('Gold', details('Gold'));
    expect(fixture.componentInstance).toBeTruthy();
  });
});
