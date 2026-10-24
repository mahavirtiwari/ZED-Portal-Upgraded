import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DashboardPage } from './dashboard';

describe('DashboardPage', () => {
  let fixture: ComponentFixture<DashboardPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function render(certStatus: Record<string, unknown>, msme: Record<string, unknown> = {}) {
    fixture = TestBed.createComponent(DashboardPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    for (const r of http.match('/api/config')) r.flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: 'https://old.example' });
    http.expectOne('/api/msme/dashboard').flush({
      msme: { ZedId: 'ZEDMSME000001', EnterpriseName: 'Acme Castings', EnterpriseType: 'Micro', ...msme },
      basicInfo: { UdyogAadharNo: 'UDYAM-UP-29-0003915', ReCertification: 0 },
      certStatus: { BronzeStatus: 0, SilverStatus: 0, GoldStatus: 0, ...certStatus },
    });
    await settle();
  }

  const card = (level: string) => el.querySelector(`.panel-${level}`) as HTMLElement;
  const button = (label: string) => [...el.querySelectorAll('button, a')].find((b) => b.textContent!.trim().startsWith(label)) as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    window.scrollTo = () => undefined;
  });

  afterEach(() => http.verify());

  it('shows the unit and "Get started" on every level for a new MSME', async () => {
    await render({});
    expect(el.textContent).toContain('Acme Castings');
    expect(el.textContent).toContain('UDYAM-UP-29-0003915');
    for (const level of ['bronze', 'silver', 'gold']) {
      expect(card(level).textContent).toContain('Get started');
      expect(card(level).classList).not.toContain('plant-activity-disabled');
    }
    // Bronze has three steps, Silver and Gold four (legacy w-33 / w-25).
    expect([...card('bronze').querySelectorAll('.stepper li')].every((li) => li.classList.contains('w-33'))).toBe(true);
    for (const level of ['silver', 'gold']) {
      expect([...card(level).querySelectorAll('.stepper li')].every((li) => li.classList.contains('w-25'))).toBe(true);
    }
    expect(el.textContent).toMatch(/Refresh on \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} (AM|PM)/);
  });

  it('greys out Silver and Gold while Bronze is in progress, and marks Bronze steps', async () => {
    await render({ BronzeStatus: 3 }, { IsBronzePaymentDone: 1 });
    expect(card('bronze').textContent).toContain('In-progress');
    expect(card('silver').classList).toContain('plant-activity-disabled');
    expect(card('gold').classList).toContain('plant-activity-disabled');

    const steps = [...card('bronze').querySelectorAll('.stepper li')].map((li) =>
      ['completed', 'current'].find((c) => li.classList.contains(c)) ?? '',
    );
    expect(steps).toEqual(['completed', 'current', '']);
    // Paid levels link to the certification details page instead of APPLY.
    expect(card('bronze').querySelector('a[href="/msme/certification/Bronze"]')).toBeTruthy();
  });

  it('marks a certified level as completed and unlocks the incentives', async () => {
    await render({ SilverStatus: 16 }, { IsSilverPaymentDone: 1, LatestCertification: 'Silver', StateId: 9 });
    expect(card('silver').textContent).toContain('Completed');
    const states = [...el.querySelectorAll('a')].find((a) => a.getAttribute('href')?.includes('it=States'))!;
    expect(states.getAttribute('href')).toBe('/incentives?it=States&ct=Silver&id=9');
    expect(states.closest('.panel-incen-block')!.classList).not.toContain('plant-activity-disabled');
  });

  it('walks the apply flow: disclaimer, instructions, then the payment step', async () => {
    await render({});
    (card('gold').querySelector('.apply-btn') as HTMLElement).click();
    await settle();
    expect(el.textContent).toContain('DISCLAIMER');

    button('ACCEPT & PROCEED').click();
    await settle();
    expect(el.textContent).toContain('Instructions');

    button('ACCEPT & PROCEED').click();
    await settle();
    http.expectOne('/api/msme/payments/Gold/options').flush({
      certification: 'Gold', withReward: null, rewardAvailable: false, udyamPan: 'ABCDE1234F',
      withoutReward: { Total: 90000, ApplicantContributionAfterSubsidy: 21240, NetPaybleTds15: 20880, NetPaybleTds75: 19440, SubsidyLabel: '(80%)' },
    });
    await settle();
    expect(el.textContent).toContain('Payment Options');
    expect(el.textContent).toContain('21,240.00');
  });
});
