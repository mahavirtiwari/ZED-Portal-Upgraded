import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { RemoteAssessmentPage } from './remote-assessment';
import { RemoteDetails } from './remote.api';

const BASE = '/api/staff/remote/ZEDMSME000001/Silver';

async function settle(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

/** What the Surveillance API returns: meeting link mode, no video. */
function details(recordings = 1, meetingLink: string | null = 'https://meet.example/abc', surLatitude: string | null = '26.5'): RemoteDetails {
  return {
    zedId: 'ZEDMSME000001',
    certification: 'Silver',
    msme: {
      ZedId: 'ZEDMSME000001', EnterpriseName: 'Acme', PUnitName: 'Acme Plant 2', UdyogAadharNo: 'UDYAM-UP-01-0000001', PlantAddress: 'Kanpur',
      AssessmentDate: '12/03/2025', SiteAssessorId: 'AS0042', SiteAssessorName: 'R Verma', DaAllocationDate: '01/01/2024', CertificationStatus: 9,
    },
    products: [{ Id: 31, ProductName: 'Valve', Exported: 'No', IsSaVerified: null, RemotePhotos: [] }],
    rawMaterials: [],
    sections: [{ Id: 41, SectionCode: '1', SectionName: 'Leadership', IsAssessmentExcempted: 'No', OfiComments: null }],
    requirements: [{ Id: 51, SectionCode: '1', RequirementCode: '1', Conformance: 'Yes', SaConformance: null, RemotePhotos: [] }],
    options: [],
    subOptions: [],
    evidences: [],
    daPhotos: [],
    location: { ZedSaLatitude: '26.1', ZedSaLongitude: '80.2', SurLatitude: surLatitude, SurLongitude: surLatitude ? '80.3' : null },
    siteExteriorPhotos: [],
    siteTourPhotos: [{ id: 85, name: 'Shop floor', url: BASE + '/files/surveillancemobileapi/SaPhotos/ZEDMSME000001/Silver/SiteTour/1.jpg', deletable: false }],
    openMeeting: { id: 71, comments: 'Hello', participants: [], photos: [] },
    closeMeeting: { id: 72, comments: null, participants: [], photos: [] },
    selfies: [],
    permissions: { isLeadAssessor: true, canAssess: true, videoConfigured: false },
    usesMeetingLink: true,
    meetingLink,
    recordingLinks: Array.from({ length: recordings }, (_, i) => ({ id: i + 1, url: `https://rec.example/${i + 1}` })),
  };
}

describe('RemoteAssessmentPage (surveillance meeting link)', () => {
  let fixture: ComponentFixture<RemoteAssessmentPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function create(data: RemoteDetails) {
    await TestBed.configureTestingModule({
      imports: [RemoteAssessmentPage],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ zedId: 'ZEDMSME000001', certification: 'Silver' }) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RemoteAssessmentPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle(fixture);
    http.expectOne(BASE).flush(data);
    await settle(fixture);
  }

  const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === text) as HTMLButtonElement;

  async function openTab(title: string) {
    button(title).click();
    await settle(fixture);
  }

  afterEach(() => http.verify());

  it('offers the meeting link instead of the video call and no frame captures', async () => {
    await create(details());
    expect(el.querySelector('.video-panel')).toBeNull();
    expect(el.querySelector('.zed-tabs')!.classList).toContain('col-lg-12');
    expect(el.querySelector('.zed-tabs')!.classList).not.toContain('col-lg-8');
    expect(el.querySelector('a.join-meeting')).toBeNull(); // on the Overview tab, not beside the tabs
    await openTab('Assessment Overview');
    const join = el.querySelector('a.join-meeting') as HTMLAnchorElement;
    expect(join.getAttribute('href')).toBe('https://meet.example/abc');
    expect(join.getAttribute('target')).toBe('_blank');
    expect(join.getAttribute('rel')).toContain('noopener');
    expect(button('Start Assessment')).toBeUndefined();
    expect(el.textContent).not.toContain('Video calls are not configured');

    await openTab('Assessment Evidence');
    expect(el.querySelector('.capture')).toBeNull();
    await openTab('Parameters');
    expect(el.querySelector('.capture')).toBeNull();
    expect(el.querySelector('.from-tour')).not.toBeNull();
  });

  it('opens on the Instructions tab of the surveillance page', async () => {
    await create(details());
    expect(el.querySelector('.numberCircle')!.textContent!.trim()).toBe('1');
    expect(el.querySelector('.tab-title h4')!.textContent).toContain('Instructions');
    expect(el.textContent).toContain('Instructions for Completing the Silver/Gold Surveillance Process');
    const rows = [...el.querySelectorAll('.tab-content tbody tr')].map((r) => r.textContent!.trim());
    expect(rows.length).toBe(13);
    expect(rows[0]).toBe('1. Surveillance Assessments are mandatory for all Silver and Gold Certified MSMEs.');
    expect(rows[12]).toContain('13. A Weblink will be provided by the Assessment Agency');
    expect([...el.querySelectorAll('.nav-link')].map((b) => b.textContent!.trim())).toEqual([
      'Instructions', 'Assessment Overview', 'Opening Meeting', 'Basic Info', 'Assessment Evidence', 'Parameters', 'Closing Meeting',
    ]);
  });

  it('shows the surveillance overview: dates, assessor, meeting link and both locations', async () => {
    await create(details());
    await openTab('Assessment Overview');
    const rows = [...el.querySelectorAll('.tab-content table.table-bordered tr')].map((r) => [r.querySelector('th')!.textContent!.trim(), r.querySelector('td')!.textContent!.trim()]);
    expect(rows).toEqual([
      ['ZED ID', 'ZEDMSME000001'],
      ['Unit Name', 'Acme Plant 2'],
      ['UDYAM Number', 'UDYAM-UP-01-0000001'],
      ['Unit Address', 'Kanpur'],
      ['Surveillance Assessment Allocation Date', '12/03/2025'],
      ['Surveillance Assessment Date', '12/03/2025'],
      ['Surveillance Assessor Name', 'AS0042 - R Verma'],
      ['Meeting link', 'Click here to Join'],
    ]);
    expect(el.textContent).not.toContain('Document Verification Allocation Date');
    const boxes = [...el.querySelectorAll('.locations > div')];
    expect(boxes.map((b) => b.querySelector('.sub-heading')!.textContent!.trim())).toEqual(['Site Assessment', 'Surveillance Assessment']);
    expect([...el.querySelectorAll('.locations a.view-map')].map((a) => a.getAttribute('href'))).toEqual([
      'https://www.google.com/maps?q=26.1,80.2', 'https://www.google.com/maps?q=26.5,80.3',
    ]);
    expect(boxes[0].textContent).toContain('Latitude26.1');
    expect(boxes[1].textContent).toContain('Longitude80.3');
  });

  it('shows the surveillance location box only once it was recorded', async () => {
    await create(details(1, 'https://meet.example/abc', null));
    await openTab('Assessment Overview');
    expect([...el.querySelectorAll('.locations .sub-heading')].map((b) => b.textContent!.trim())).toEqual(['Site Assessment']);
  });

  it('has Refresh and ASSESSMENT REPORT buttons', async () => {
    await create(details());
    expect(el.querySelector('.refresh-link')).toBeNull();
    const report = el.querySelector('a.assessment-report') as HTMLAnchorElement;
    expect(report.getAttribute('href')).toBe('/api/staff/certification-documents/ZEDMSME000001/Silver/report');
    expect(report.getAttribute('target')).toBe('_blank');
    (el.querySelector('button.refresh') as HTMLButtonElement).click();
    await settle(fixture);
    http.expectOne((r) => r.method === 'GET' && r.url === BASE).flush(details());
    await settle(fixture);
  });

  it('warns when the agency gave no meeting link', async () => {
    await create(details(1, null));
    await openTab('Assessment Overview');
    expect(el.querySelector('a.join-meeting')).toBeNull();
    expect(el.textContent).toContain('No meeting link');
  });

  it('uploads the opening meeting photo as a JPEG data URL', async () => {
    await create(details());
    await openTab('Opening Meeting');
    const input = el.querySelector('.upload-meeting input') as HTMLInputElement;
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'p.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 50));
    await settle(fixture);
    const req = http.expectOne(BASE + '/photos');
    expect(req.request.body.target).toBe('OpenMeeting');
    expect(req.request.body.targetId).toBe(71);
    expect(req.request.body.image).toMatch(/^data:image\/jpeg;base64,/);
    req.flush({ photos: [] });
    await settle(fixture);
    http.expectOne((r) => r.method === 'GET' && r.url === BASE).flush(details());
    await settle(fixture);
  });

  it('refuses a PNG before sending', async () => {
    await create(details());
    await openTab('Basic Info');
    const input = el.querySelector('.upload-selfie input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File([new Uint8Array([0x89, 0x50])], 's.png', { type: 'image/png' })] });
    input.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(el.textContent).toContain('JPEG photo');
    http.expectNone(BASE + '/photos');
  });

  it('lists recording links and adds one to the closing meeting', async () => {
    await create(details());
    await openTab('Closing Meeting');
    const links = el.querySelectorAll('.recording-links a');
    expect(links.length).toBe(1);
    expect(links[0].getAttribute('href')).toBe('https://rec.example/1');

    const input = el.querySelector('.recording-links input') as HTMLInputElement;
    input.value = 'javascript:alert(1)';
    input.dispatchEvent(new Event('input'));
    await settle(fixture);
    (el.querySelector('.add-recording') as HTMLButtonElement).click();
    await settle(fixture);
    http.expectNone(BASE + '/meetings/72/recording-links');
    expect(el.textContent).toContain('valid recording link');

    input.value = 'https://rec.example/2';
    input.dispatchEvent(new Event('input'));
    await settle(fixture);
    (el.querySelector('.add-recording') as HTMLButtonElement).click();
    const req = http.expectOne(BASE + '/meetings/72/recording-links');
    expect(req.request.body).toEqual({ link: 'https://rec.example/2' });
    req.flush({ message: 'Recording link added.' });
    await settle(fixture);
    http.expectOne((r) => r.method === 'GET' && r.url === BASE).flush(details(2));
    await settle(fixture);
  });

  it('hides "Add Recording Link" at 6 links', async () => {
    await create(details(6));
    await openTab('Closing Meeting');
    expect(el.querySelectorAll('.recording-links a').length).toBe(6);
    expect(el.querySelector('.add-recording')).toBeNull();
  });
});
