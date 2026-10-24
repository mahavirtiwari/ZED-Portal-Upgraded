import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CertificationDetailsPage } from './certification-details';
import { CertificationData } from './certification.api';

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

  /** Opens the page for a route value and answers the API with the given data. */
  async function open(route: string, data: CertificationData | null, expectedUrl = `/api/msme/certifications/${data?.certification}`) {
    fixture.componentRef.setInput('certification', route);
    await settle();
    for (const r of http.match('/api/config')) r.flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: LEGACY });
    if (data) http.expectOne(expectedUrl).flush(data);
    await settle();
  }

  const text = () => el.textContent!.replace(/\s+/g, ' ');
  const action = (label: string) =>
    Array.from(el.querySelectorAll<HTMLElement>('.alert-document')).find((a) => a.querySelector('p')!.textContent!.trim() === label);
  const visibleSteps = () =>
    Array.from(el.querySelectorAll<HTMLElement>('.cert-steps > li')).filter((li) => !li.hidden).map((li) => li.querySelector('h4')!.textContent!.trim());

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

  it('loads the certification in its canonical spelling and shows the unit summary', async () => {
    await open('bronze', details('Bronze'), '/api/msme/certifications/Bronze');

    expect(text()).toContain('Acme Castings');
    expect(text()).toContain('UDYAM-UP-29-0003915');
    expect(text()).toContain('Pledge taken on May 1, 2024');
    expect(el.querySelector('.entp-label.micro')).toBeTruthy();
    expect(el.querySelector('.zed-payment-success')).toBeTruthy();
  });

  it('shows the Bronze timeline, NC rounds and actions like the old page', async () => {
    await open('Bronze', details('Bronze', {
      ApplicationReceived: 'Application received on May 1, 2024',
      BasicInfoStatus: 'Submitted on May 2, 2024',
      BronzeDesktopVerification: 'In-progress',
      NcFinalClosureDate: 'Close by June 1, 2024',
      Nc1Raised: 'NC raised on May 5, 2024',
      Nc1Submitted: 'NC replied on May 6, 2024',
    }, { BronzeStatus: 3, CertPath: 'Certificates' }));

    expect(el.querySelector('zed-certification-steps .label-highlight strong')!.textContent).toBe('Application Received');
    expect(el.querySelector('zed-certification-steps .label-highlight li')!.textContent).toBe('Application received on May 1, 2024');
    expect(visibleSteps()).toEqual(['Basic Information and Document Upload', 'Desktop Verification']);
    expect(text()).toContain('YOU: Submitted on May 2, 2024');
    expect(text()).toContain('Non-Conformance(s) (NC) (Close by June 1, 2024)');
    expect(text()).toContain('ZED: NC raised on May 5, 2024');
    expect(text()).toContain('YOU: NC replied on May 6, 2024');

    // Basic information opens once BronzeStatus > 1, on the assessment report pages.
    const basic = action('View Basic Information & Documents Upload')!;
    expect(basic.classList).not.toContain('btn-disabled');
    expect(basic.querySelector('a')!.getAttribute('href')).toBe('/msme/assessment/basic-info/Bronze');
    const nc = action('Non-Conformance(s)')!;
    expect(nc.classList).toContain('alert-document-danger');
    expect(nc.querySelector('a')!.getAttribute('href')).toBe('/msme/assessment/non-conformances/Bronze');

    // Not certified yet: downloads are greyed out.
    expect(action('Download Certificate')!.classList).toContain('btn-disabled');
    expect(action('Download Report')!.classList).toContain('btn-disabled');
    expect(action('View My Incentives')!.classList).toContain('btn-disabled');
  });

  it('links the certificate and report of this portal and the incentives once certified', async () => {
    await open('Silver', details('Silver', {
      ApplicationReceived: 'Received',
      DesktopVerification: 'Done',
      ScheduledOn: 'Scheduled',
      CompletedOn: 'Completed',
      GetCertified: 'Certified on June 1, 2024',
      AvailIncentive: 'https://loginzed.msme.gov.in/Incentive/Details/9?ct=Silver',
    }, { CertPath: 'Certifications' }));

    expect(visibleSteps()).toEqual([
      'Basic Information and Document Upload', 'Desktop Verification', 'Remote/Onsite Assessment', 'Get Certified!', 'Avail Incentives',
    ]);
    expect(action('Download Certificate')!.querySelector('a')!.getAttribute('href'))
      .toBe('/api/msme/certification-documents/Silver/certificate');
    expect(action('Download Report')!.querySelector('a')!.getAttribute('href'))
      .toBe('/api/msme/certification-documents/Silver/report');
    expect(action('View My Incentives')!.querySelector('a')!.getAttribute('href'))
      .toBe('/incentives?ct=Silver&id=9'); // the public incentive list, now in this portal
    expect(action('View My Incentives')!.querySelector('a')!.getAttribute('target')).toBeNull();   // same tab
    expect(action('Download Certificate')!.querySelector('a')!.getAttribute('target')).toBe('_blank');
    expect(el.querySelector('.cert-steps a')!.getAttribute('target')).toBeNull();
    expect(action('View Onsite/Remote Assessment Information')!.classList).not.toContain('btn-disabled');
    expect(action('Download Certificate')!.classList).not.toContain('btn-disabled');
    expect(action('View Basic Information & Documents Upload')!.querySelector('a')!.getAttribute('href'))
      .toBe('/msme/assessment/basic-info/Silver');
    expect(action('View Onsite/Remote Assessment Information')!.querySelector('a')!.getAttribute('href'))
      .toBe('/msme/site-assessment/Silver');
  });

  it('links the Bronze certificate and report of this portal even before the file exists', async () => {
    await open('Bronze', details('Bronze', { GetCertified: 'Certified on June 1, 2024' }, { BronzeStatus: 6, CertPath: null }));
    expect(action('Download Certificate')!.querySelector('a')!.getAttribute('href')).toBe('/api/msme/certification-documents/Bronze/certificate');
    expect(action('Download Report')!.querySelector('a')!.getAttribute('href')).toBe('/api/msme/certification-documents/Bronze/report');
    expect(action('Download Certificate')!.classList).not.toContain('btn-disabled');
  });

  it('never links a surveillance certificate the surveillance system has not stored', async () => {
    await open('GoldSurveillance', details('GoldSurveillance', { GetCertified: 'Certified' }, { SurveCertPath: '../../etc' }));
    const box = action('Download Surveillance Certificate')!;
    expect(box.classList).toContain('btn-disabled');
  });

  it('shows the surveillance timeline and surveillance downloads', async () => {
    await open('BronzeSurveillance', details('BronzeSurveillance', {
      ApplicationReceived: 'Received',
      ScheduledOn: 'Scheduled on July 1, 2025',
      GetCertified: 'Certified',
      DesktopVerification: 1,
    }, { SurveCertPath: 'Surveillance/Certificates' }));

    expect(text()).toContain('Application Received for Surveillance Assessment');
    expect(visibleSteps()).toEqual(['Surveillance Assessment', 'Get Certified!', 'Avail Incentives']);
    expect(Array.from(el.querySelectorAll('.cert-steps > li .step-num')).map((n) => n.textContent!.trim())).toEqual(['1', '3', '4']);   // as the live page (no step 2)
    expect(el.querySelector('.zed-payment-success')).toBeNull();
    expect(action('Download Surveillance Certificate')!.querySelector('a')!.getAttribute('href'))
      .toBe('/api/msme/certification-documents/BronzeSurveillance/certificate');
    expect(action('Download Surveillance Report')!.querySelector('a')!.getAttribute('href'))
      .toBe('/api/msme/certification-documents/BronzeSurveillance/report');
    expect(action('View Onsite/Remote Assessment Information')).toBeUndefined();
  });

  it('shows a handholding milestone with the consultancy report', async () => {
    await open('goldmilestone2', details('GoldMilestone2', {
      AllocationCompleted: 'In-progress',
      BdsScheduledOn: 'BDS on May 1, 2025',
      HapScheduledOn: 'HAP on May 2, 2025',
      SubmittedByConsultant: 'Submitted',
      CompletedOn: 'Completed',
    }), '/api/msme/certifications/GoldMilestone2');

    expect(visibleSteps()).toEqual(['Allocation of consulting organisation', 'Milestone 2']);
    expect(text()).toContain('BDS on May 1, 2025');
    expect(text()).not.toContain('HAP on May 2, 2025'); // only milestone 1 lists the HAP date
    expect(action('View Milestone 2')!.querySelector('a')!.getAttribute('href')).toBe('/msme/site-assessment/GoldMilestone2');
    expect(action('Download Report')!.querySelector('a')!.getAttribute('href'))
      .toBe('/api/msme/certification-documents/Gold/report?milestone=2');
    expect(action('Download Certificate')).toBeUndefined();
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
    (el.querySelector('.refresh-link') as HTMLButtonElement).click();
    await settle();
    http.expectOne('/api/msme/certifications/Bronze').flush(details('Bronze'));
    await settle();

    await open('Gold', details('Gold'));
    expect(fixture.componentInstance).toBeTruthy();
  });
});
