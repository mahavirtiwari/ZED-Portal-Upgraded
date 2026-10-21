import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ViewStatusPage } from './view-status';

describe('ViewStatusPage', () => {
  let fixture: ComponentFixture<ViewStatusPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ViewStatusPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(ViewStatusPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
  });

  afterEach(() => http.verify());

  it("shows the signed-in MSME's status timeline", async () => {
    fixture.componentRef.setInput('certification', 'gold');
    await settle();
    for (const r of http.match('/api/config')) r.flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: 'https://legacy.example.test' });
    http.expectOne('/api/msme/certifications/Gold').flush({
      certification: 'Gold',
      msme: { ZedId: 'ZEDMSME000001', StateId: 9 },
      basicInfo: {},
      certStatus: {},
      status: { ApplicationReceived: 'Received on May 1, 2024', BasicInfoStatus: 'In-progress', DesktopVerification: 'In-progress', GetCertified: 'Certified' },
    });
    await settle();

    const text = el.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Status');
    expect(el.querySelector('.label-highlight strong')!.textContent).toBe('Application Received');
    expect(el.querySelector('.label-highlight li')!.textContent).toBe('Received on May 1, 2024');
    expect(text).toContain('YOU: In-progress');
    const visible = Array.from(el.querySelectorAll<HTMLElement>('.cert-steps > li')).filter((li) => !li.hidden);
    expect(visible.map((li) => li.querySelector('h4')!.textContent!.trim()))
      .toEqual(['Basic Information and Document Upload', 'Desktop Verification', 'Get Certified!', 'Avail Incentives']);
    expect(el.querySelector('.cert-steps a')!.getAttribute('href')).toBe('/incentives?ct=Gold&id=9');
  });

  it('only accepts Bronze, Silver and Gold', async () => {
    fixture.componentRef.setInput('certification', 'GoldSurveillance');
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Invalid certification.');
    http.expectNone((r) => r.url.startsWith('/api/msme/certifications'));
  });
});
