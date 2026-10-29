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

  async function render(certStatus: Record<string, unknown>, msme: Record<string, unknown> = {}, reCertification = 0,
                        incentives: object = { builtIn: [], incentives: [] }, levels: object[] = []) {
    fixture = TestBed.createComponent(DashboardPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    for (const r of http.match('/api/config')) r.flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: 'https://old.example' });
    http.expectOne('/api/msme/dashboard').flush({
      msme: { ZedId: 'ZEDMSME000001', EnterpriseName: 'Acme Castings', EnterpriseType: 'Micro', ...msme },
      basicInfo: { UdyogAadharNo: 'UDYAM-UP-29-0003915', ReCertification: reCertification },
      certStatus: { BronzeStatus: 0, SilverStatus: 0, GoldStatus: 0, ...certStatus },
    });
    for (const r of http.match('/api/msme/dashboard/incentives')) r.flush(incentives);
    for (const r of http.match('/api/public/levels')) r.flush(levels);
    await settle();
  }

  const card = (level: string) => el.querySelector(`.panel-${level}`) as HTMLElement;
  const keys = () => [...el.querySelectorAll('zed-text')].map((t) => t.getAttribute('data-key'));
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

  it('shows the built-in incentive cards as the Admin set them and the incentives put on the dashboard', async () => {
    const titles = () => [...el.querySelectorAll('.panel-incen-block h4')].map((h) => h.textContent!.trim());
    await render({ BronzeStatus: 6 }, {}, 0, {
      builtIn: [
        { card: 'KAWACH', title: 'MSME KAWACH', highlight: 'Free', details: 'WASH', active: false },
        { card: 'JOINING_REWARD', title: 'Welcome Reward', highlight: 'Rs. 12,000/-', details: 'For new units', active: true },
      ],
      incentives: [
        { id: 57, title: 'Export Booster', highlight: 'Up to Rs. 5,00,000/-', details: 'Line one. Line two.', department: 'MoMSME', contactPerson: 'Officer',
          email: 'o@msme.gov.in', mobileNo: '011', webLink: 'https://scheme.example.org', videoLink: null,
          applicableForBronze: false, applicableForSilver: true, applicableForGold: false },
      ],
    });
    // KAWACH hidden; Joining Reward with the Admin's wording; the others as before V4; the incentive before the stakeholder cards.
    expect(titles()).toEqual(['Welcome Reward', 'Financial Assistance', 'Handholding Support', 'Technology Upgradation', 'Export Booster',
      'Ministry of MSME', 'States/UTs', 'Financial Institutions', 'Other Incentives']);
    expect(el.textContent).toContain('Rs. 12,000/-');
    // Bronze certified only: a Silver incentive is faded, its details open from Avail.
    const exportCard = [...el.querySelectorAll('.panel-incen-block')].find((p) => p.textContent!.includes('Export Booster')) as HTMLElement;
    expect(exportCard.classList).toContain('plant-activity-disabled');
    (exportCard.querySelector('button') as HTMLButtonElement).click();
    await settle();
    const dialog = el.querySelector('.modal-content') as HTMLElement;
    expect(dialog.textContent).toContain('Export Booster');
    expect(dialog.textContent).toContain('Silver certified MSMEs');
    expect(dialog.textContent).toContain('Available once your unit is certified at Silver level.');
    expect(dialog.querySelector('a[href="https://scheme.example.org"]')).not.toBeNull();
  });

  it('shows ZED-X once the Admin enables it, with its own name, logo and text, greyed out while another level is in progress', async () => {
    const zedx = { code: 'ZEDX', name: 'ZED-X', description: 'Open to every MSME', comment: 'ZED-X: the sector-wise certification.', logoUrl: null,
      assessmentMode: 'Site', validityMonths: 36, fee: 75000 };
    const three = ['Bronze', 'Silver', 'Gold'].map((code) => ({ code, name: code, description: null, comment: null, logoUrl: `/Images/Dashboard/${code.toLowerCase()}.png`,
      assessmentMode: 'Site', validityMonths: 36, fee: null }));
    // Bronze in progress greys out Silver, Gold and ZED-X.
    await render({ BronzeStatus: 3, ZEDXStatus: 0 }, { IsZEDXPaymentDone: 0 }, 0, undefined, [...three, zedx]);
    const zcard = card('zedx');
    expect(zcard.querySelector('h5')!.textContent).toContain('ZED-X CERTIFICATION');
    expect(zcard.classList).toContain('plant-activity-disabled');
    expect(card('gold').classList).toContain('plant-activity-disabled');
    expect(zcard.querySelector('.inner2 img')!.getAttribute('src')).toBe('/Images/Dashboard/zedx.svg');
    expect(el.textContent).toContain('Apply for Bronze, Silver, Gold or ZED-X Certifications.');
    (zcard.querySelector('.panel-heading button') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('.modal-content')!.textContent).toContain('ZED-X Certification');
    expect(el.querySelector('.modal-content')!.textContent).toContain('the sector-wise certification');
  });

  it('greys out Bronze, Silver and Gold while ZED-X is in progress, and opens ZED-X once Bronze is certified', async () => {
    const levels = ['Bronze', 'Silver', 'Gold', 'ZEDX'].map((code) => ({ code, name: code === 'ZEDX' ? 'ZED-X' : code, description: null, comment: null,
      logoUrl: null, assessmentMode: 'Site', validityMonths: 36, fee: null }));
    await render({ ZEDXStatus: 1 }, { IsZEDXPaymentDone: 1 }, 0, undefined, levels);
    for (const level of ['bronze', 'silver', 'gold']) expect(card(level).classList).toContain('plant-activity-disabled');
    expect(card('zedx').classList).not.toContain('plant-activity-disabled');
    fixture.destroy();

    await render({ BronzeStatus: 6, ZEDXStatus: 0 }, { IsBronzePaymentDone: 1 }, 0, undefined, levels);
    expect(card('zedx').classList).not.toContain('plant-activity-disabled');
    expect(card('silver').classList).not.toContain('plant-activity-disabled');
    fixture.destroy();

    // ZED-X certified: the highest level, the three stay closed.
    await render({ ZEDXStatus: 16 }, { IsZEDXPaymentDone: 1 }, 0, undefined, levels);
    for (const level of ['bronze', 'silver', 'gold']) expect(card(level).classList).toContain('plant-activity-disabled');
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
    expect(keys()).toEqual([
      'msme.certification.payment.disclaimer', 'msme.certification.payment.disclaimer.firstCertification', 'msme.certification.payment.disclaimer.closing',
    ]);

    button('ACCEPT & PROCEED').click();
    await settle();
    expect(el.textContent).toContain('Instructions');
    expect(keys()).toEqual(['msme.certification.payment.instructions']);

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

  it('leaves out the first-certification points of the disclaimer for a re-certification', async () => {
    await render({}, {}, 1);
    (card('gold').querySelector('.apply-btn') as HTMLElement).click();
    await settle();
    expect(keys()).toEqual(['msme.certification.payment.disclaimer', 'msme.certification.payment.disclaimer.closing']);
  });

  it('shows the certification steps from the Texts', async () => {
    await render({});
    expect([...el.querySelectorAll('.cert-steps .step-details zed-text')].map((t) => t.getAttribute('data-key'))).toEqual(
      [1, 2, 3, 4, 5].map((n) => `msme.dashboard.certificationSteps.${n}`),
    );
  });
});
