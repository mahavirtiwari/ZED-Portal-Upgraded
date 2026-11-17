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

    expect(el.querySelector('zed-page-head .ph-title')!.textContent).toBe('Status');
    expect(Array.from(el.querySelectorAll('zed-step-tracker .st-label')).map((s) => s.textContent!.trim())).toEqual([
      'Application received', 'Information & documents', 'Desktop verification', 'Remote/onsite assessment', 'Certified', 'Avail incentives',
    ]);
    // Newest first, each with who acted.
    const items = Array.from(el.querySelectorAll<HTMLElement>('.tl-item'));
    expect(items.map((i) => i.querySelector('.tl-title')!.textContent!.trim()))
      .toEqual(['Certificate & report generated', 'Desktop verification', 'Basic information & documents', 'Application received']);
    expect(items[2].querySelector('.tl-who')!.textContent).toBe('YOU');
    expect(items[2].querySelector('.tl-note')!.textContent).toBe('In-progress');
    expect(items[3].querySelector('.tl-date')!.textContent).toBe('1 May 2024');
    expect(el.querySelector('.vs-incentives a')!.getAttribute('href')).toBe('/incentives?ct=Gold&id=9');
  });

  it('only accepts Bronze, Silver and Gold', async () => {
    fixture.componentRef.setInput('certification', 'GoldSurveillance');
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Invalid certification.');
    http.expectNone((r) => r.url.startsWith('/api/msme/certifications'));
  });
});
