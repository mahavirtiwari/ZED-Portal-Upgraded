import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { RemoteAssessmentPage } from './remote-assessment';
import { RemoteDetails } from './remote.api';
import { TwilioParticipant, TwilioRoom } from './twilio-video';

const BASE = '/api/staff/remote/ZEDMSME000001/Silver';

async function settle(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

function details(canAssess = true): RemoteDetails {
  return {
    zedId: 'ZEDMSME000001',
    certification: 'Silver',
    msme: { ZedId: 'ZEDMSME000001', EnterpriseName: 'Acme <b>Steel</b>', CertificationStatus: 9, SaAuditsConducted: 'Yes', AuditsConducted: 'No' },
    products: [{ Id: 31, ProductName: 'Valve', Exported: 'No', IsSaVerified: null, RemotePhotos: [] }],
    rawMaterials: [],
    sections: [{ Id: 41, SectionCode: '1', SectionName: 'Leadership', IsAssessmentExcempted: 'No', OfiComments: null }],
    requirements: [{ Id: 51, SectionCode: '1', RequirementCode: '1', Conformance: 'Yes', SaConformance: null, RemotePhotos: [] }],
    options: [{ SectionCode: '1', RequirementCode: '1', OptionCode: '1', OptionName: '<img src=x onerror=alert(1)>' }],
    subOptions: [],
    evidences: [],
    daPhotos: [],
    location: { Latitude: '26.1', Longitude: '80.2' },
    siteExteriorPhotos: [{ id: 61, name: 'Front', url: BASE + '/files/SaPhotos/ZEDMSME000001/Silver/a.jpg', deletable: canAssess }],
    siteTourPhotos: [{ id: 85, name: 'Shop floor', url: BASE + '/files/SaPhotos/ZEDMSME000001/Silver/t.jpg', deletable: canAssess }],
    openMeeting: { id: 71, comments: 'Introductions', participants: [{ Name: 'R Sharma', Designation: 'Owner' }], photos: [] },
    closeMeeting: { id: 72, comments: null, participants: [], photos: [] },
    selfies: [],
    permissions: { isLeadAssessor: canAssess, canAssess, videoConfigured: true },
  };
}

describe('RemoteAssessmentPage', () => {
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

  function button(text: string): HTMLButtonElement {
    return [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === text) as HTMLButtonElement;
  }

  async function openTab(title: string) {
    button(title).click();
    await settle(fixture);
  }

  async function reload(data = details()) {
    await settle(fixture);
    http.expectOne((r) => r.method === 'GET' && r.url === BASE).flush(data);
    await settle(fixture);
  }

  afterEach(() => {
    http.verify();
    delete (window as { Twilio?: unknown }).Twilio;
    vi.restoreAllMocks();
  });

  it('shows the overview as text and a map link', async () => {
    await create(details());
    expect(el.textContent).toContain('Acme <b>Steel</b>');
    expect(el.querySelector('table b')).toBeNull();
    expect(el.querySelector('a.map-link')!.getAttribute('href')).toBe('https://www.google.com/maps?q=26.1,80.2');
    expect(button('Start Assessment')).toBeTruthy();
  });

  it('is read-only for the co-assessor', async () => {
    await create(details(false));
    expect(el.querySelector('.alert-info')!.textContent).toContain('Only the lead assessor');
    expect(button('Start Assessment')).toBeUndefined();
    await openTab('Parameters');
    expect(el.querySelector('.validate-requirement')).toBeNull();
    expect(el.querySelector('.final-submit')).toBeNull();
    expect(el.querySelector('table.requirement img')).toBeNull(); // option text is not HTML
    expect(el.querySelector('table.requirement')!.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('joins the video room with the token from the API', async () => {
    await create(details());
    const participants = new Map<string, TwilioParticipant>();
    const handlers: Record<string, (p: TwilioParticipant) => void> = {};
    const room: TwilioRoom = {
      name: 'ZEDMSME000001 Remote Assessment',
      participants,
      on: (event, cb) => { handlers[event] = cb; },
      once: () => undefined,
      disconnect: vi.fn(),
    };
    const connect = vi.fn().mockResolvedValue(room);
    (window as { Twilio?: unknown }).Twilio = { Video: { connect } };

    button('Start Assessment').click();
    await settle(fixture);
    http.expectOne((r) => r.method === 'POST' && r.url === BASE + '/join')
      .flush({ token: 'jwt-token', room: room.name, identity: 'ZEDMSME000001 Remote Assessor', expiresInSeconds: 3600 });
    await settle(fixture);
    expect(connect).toHaveBeenCalledWith('jwt-token', { audio: true, video: { width: 400 } });
    expect(el.textContent).toContain('Waiting for MSME');

    const video = document.createElement('video');
    handlers['participantConnected']({
      sid: 'PA1', identity: 'ZEDMSME000001',
      tracks: new Map([['t', { isSubscribed: true, track: { kind: 'video', attach: () => video, detach: () => [video] } }]]),
      on: () => undefined,
    });
    await settle(fixture);
    expect(el.querySelector('#output video')).toBe(video);
    fixture.destroy();
    expect(room.disconnect).toHaveBeenCalled();
  });

  it('shows the API message when the video cannot start', async () => {
    await create(details());
    button('Start Assessment').click();
    await settle(fixture);
    http.expectOne(BASE + '/join').flush({ title: 'Video calls are not configured on this server. Please contact the ZED team.' }, { status: 400, statusText: 'Bad Request' });
    await settle(fixture);
    expect(el.querySelector('.video-panel .alert-danger')!.textContent).toContain('not configured');
  });

  it('records conformance and reloads', async () => {
    await create(details());
    await openTab('Parameters');
    (el.querySelector('.validate-requirement') as HTMLButtonElement).click();
    await settle(fixture);
    const no = el.querySelector('.modal input[value=No]') as HTMLInputElement;
    no.click();
    no.dispatchEvent(new Event('change'));
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('Please enter remarks.');
    const remarks = el.querySelector('#choiceRemarks') as HTMLTextAreaElement;
    remarks.value = 'Not seen';
    remarks.dispatchEvent(new Event('input'));
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    const req = http.expectOne(BASE + '/requirements/51/conformance');
    expect(req.request.body).toEqual({ conformance: 'No', remarks: 'Not seen' });
    req.flush({ message: 'Data Updated' });
    await reload();
    expect(el.querySelector('.modal')).toBeNull();
  });

  it('asks for the MSME video before capturing and saves a captured frame', async () => {
    await create(details());
    await openTab('Site Tour');
    (el.querySelector('button.capture') as HTMLButtonElement).click();
    await settle(fixture);
    expect(el.querySelector('.alert-danger')!.textContent).toContain("The MSME's video is not available");

    const capture = (fixture.componentInstance as unknown as { capture: WritableSignal<unknown> }).capture;
    capture.set({ target: 'SiteTour', targetId: null, image: 'data:image/jpeg;base64,/9j/4AAQ', name: 'Boiler', fixedName: false });
    await settle(fixture);
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    const req = http.expectOne(BASE + '/photos');
    expect(req.request.body).toEqual({ target: 'SiteTour', targetId: null, name: 'Boiler', image: 'data:image/jpeg;base64,/9j/4AAQ' });
    req.flush({ photos: [] });
    await reload();
  });

  it('reuses a site tour photo for a parameter and removes own photos after confirmation', async () => {
    await create(details());
    await openTab('Parameters');
    (el.querySelector('.from-tour') as HTMLButtonElement).click();
    await settle(fixture);
    (el.querySelector('.select-tour') as HTMLButtonElement).click();
    await settle(fixture);
    const req = http.expectOne(BASE + '/photos');
    expect(req.request.body).toEqual({ target: 'Requirement', targetId: 51, fromPhotoId: 85 });
    req.flush({ photos: [] });
    await reload();

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openTab('Site Tour');
    (el.querySelector('[aria-label="Remove photo"]') as HTMLButtonElement).click();
    await settle(fixture);
    http.expectOne((r) => r.method === 'DELETE' && r.url === BASE + '/photos/85').flush({ message: 'Photo removed.' });
    await reload();
  });

  it('checks before the final submit and needs the confirmation', async () => {
    await create(details());
    await openTab('Parameters');
    (el.querySelector('.final-submit') as HTMLButtonElement).click();
    await settle(fixture);
    http.expectOne(BASE + '/final-submit/check').flush({ allowed: false, message: 'You may have missed one or more OFI comments. Please review.', raisesNc: false });
    await settle(fixture);
    expect(el.querySelector('.alert-danger')!.textContent).toContain('OFI comments');

    (el.querySelector('.final-submit') as HTMLButtonElement).click();
    await settle(fixture);
    http.expectOne(BASE + '/final-submit/check').flush({ allowed: true, message: null, raisesNc: true });
    await settle(fixture);
    expect(el.querySelector('.modal')!.textContent).toContain('Non-conformance(s) will be raised');
    const submit = el.querySelector('.modal .submit') as HTMLInputElement;
    expect(submit.disabled).toBe(true);
    const comments = el.querySelector('#finalComments') as HTMLTextAreaElement;
    comments.value = 'Assessment done';
    comments.dispatchEvent(new Event('input'));
    const confirm = el.querySelector('#finalConfirm') as HTMLInputElement;
    confirm.click();
    await settle(fixture);
    expect(submit.disabled).toBe(false);
    submit.click();
    await settle(fixture);
    const req = http.expectOne(BASE + '/final-submit');
    expect(req.request.body).toEqual({ comments: 'Assessment done' });
    req.flush({ message: 'Assessment submitted.' });
    await reload();
    expect(el.querySelector('.alert-success')!.textContent).toContain('Assessment submitted.');
  });
});
