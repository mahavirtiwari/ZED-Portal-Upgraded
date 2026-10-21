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
function details(recordings = 1, meetingLink: string | null = 'https://meet.example/abc'): RemoteDetails {
  return {
    zedId: 'ZEDMSME000001',
    certification: 'Silver',
    msme: { ZedId: 'ZEDMSME000001', EnterpriseName: 'Acme', CertificationStatus: 9 },
    products: [{ Id: 31, ProductName: 'Valve', Exported: 'No', IsSaVerified: null, RemotePhotos: [] }],
    rawMaterials: [],
    sections: [{ Id: 41, SectionCode: '1', SectionName: 'Leadership', IsAssessmentExcempted: 'No', OfiComments: null }],
    requirements: [{ Id: 51, SectionCode: '1', RequirementCode: '1', Conformance: 'Yes', SaConformance: null, RemotePhotos: [] }],
    options: [],
    subOptions: [],
    evidences: [],
    daPhotos: [],
    location: null,
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
    const join = el.querySelector('a.join-meeting') as HTMLAnchorElement;
    expect(join.getAttribute('href')).toBe('https://meet.example/abc');
    expect(join.getAttribute('target')).toBe('_blank');
    expect(join.getAttribute('rel')).toContain('noopener');
    expect(button('Start Assessment')).toBeUndefined();
    expect(el.textContent).not.toContain('Video calls are not configured');

    await openTab('Site Tour');
    expect(el.querySelector('.capture')).toBeNull();
    await openTab('Parameters');
    expect(el.querySelector('.capture')).toBeNull();
    expect(el.querySelector('.from-tour')).not.toBeNull();
  });

  it('warns when the agency gave no meeting link', async () => {
    await create(details(1, null));
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
