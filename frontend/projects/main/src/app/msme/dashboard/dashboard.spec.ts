import { formatDate } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
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
                        incentives: object = { builtIn: [], incentives: [] }, levels: object[] = [], basic: Record<string, unknown> = {},
                        levelFees: Record<string, number | null> = {}, certifiedOn?: Record<string, string>) {
    fixture = TestBed.createComponent(DashboardPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    for (const r of http.match('/api/config')) r.flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: 'https://old.example' });
    http.expectOne('/api/msme/dashboard').flush({
      msme: { ZedId: 'ZEDMSME000001', EnterpriseName: 'Acme Castings', EnterpriseType: 'Micro', ...msme },
      basicInfo: { UdyogAadharNo: 'UDYAM-UP-29-0003915', ReCertification: reCertification, ...basic },
      certStatus: { BronzeStatus: 0, SilverStatus: 0, GoldStatus: 0, ...certStatus },
      ...(certifiedOn ? { certifiedOn } : {}),
    });
    for (const r of http.match('/api/msme/dashboard/incentives')) r.flush(incentives);
    for (const r of http.match('/api/public/levels')) r.flush(levels);
    for (const r of http.match('/api/msme/dashboard/level-fees')) r.flush(levelFees);
    await settle();
  }

  const card = (level: string) => el.querySelector(`.panel-${level}`) as HTMLElement;
  const keys = () => [...el.querySelectorAll('zed-text')].map((t) => t.getAttribute('data-key'));
  const consent = () => (el.querySelector('input[name="consent"]') as HTMLInputElement).click();
  const button = (label: string) => [...el.querySelectorAll('button, a')].find((b) => b.textContent!.trim().startsWith(label)) as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    window.scrollTo = () => undefined;
  });

  afterEach(() => http.verify());

  it('shows the unit, Bronze as the recommended next level and the others not started for a new MSME', async () => {
    await render({});
    expect(el.textContent).toContain('Acme Castings');
    expect(el.textContent).toContain('UDYAM-UP-29-0003915');
    for (const level of ['bronze', 'silver', 'gold']) expect(card(level).classList).not.toContain('plant-activity-disabled');
    // The next level is ready to apply; 2026-11-18 (the user): no "Recommended next" tag or outline.
    expect(card('bronze').textContent).toContain('Ready to apply');
    expect(card('bronze').classList).not.toContain('is-rec');
    expect(card('bronze').textContent).not.toContain('RECOMMENDED NEXT');
    for (const level of ['silver', 'gold']) {
      expect(card(level).textContent).toContain('Not started');
      expect(card(level).classList).not.toContain('is-rec');
    }
    // Bronze has three steps, Silver and Gold four.
    expect(card('bronze').querySelectorAll('.stepper li').length).toBe(3);
    for (const level of ['silver', 'gold']) expect(card(level).querySelectorAll('.stepper li').length).toBe(4);
    // The unit is in the band at the top; the side bar is gone.
    expect(el.querySelector('zed-msme-unit-summary')).toBeNull();
    // The breadcrumb, "Welcome, <unit>", when it was refreshed and Refresh; no level in progress before a payment.
    expect(el.querySelector('zed-page-head .ph-crumb')!.textContent).toContain('Dashboard');
    expect(el.querySelector('zed-page-head .ph-title')!.textContent).toBe('Welcome, Acme Castings');
    expect(el.querySelector('zed-page-head .ph-sub')!.textContent).toMatch(/^Last refreshed on \d{1,2} \w{3} \d{4}, \d{2}:\d{2} (AM|PM)$/);
    expect(el.querySelector('zed-page-head .refresh-btn')).toBeTruthy();
    expect(el.querySelector('.next-step')).toBeNull();
    // Your next steps: apply for the recommended level (to the disclaimer); no current level before a certification.
    const steps = [...el.querySelectorAll('.ns-card')];
    expect(steps.map((c) => c.querySelector('h3')!.textContent)).toEqual(['Apply for Bronze certification']);
    expect(el.querySelector('.uc-facts')).toBeNull();
    // 2026-11-15: no separate green app banner; the foot has Contact ZED and the app's store links (Admin → Links).
    expect(el.querySelector('.app-banner')).toBeNull();
    expect(el.querySelector('zed-dash-extras a[href="https://play.google.com/store/apps/details?id=com.qci.zed.msme"]')!.textContent).toContain('Android app');
    expect(el.querySelector('zed-dash-extras a[href="https://apps.apple.com/in/app/zed-msme/id1631537071"]')!.textContent).toContain('iOS app');
    expect(el.querySelector('zed-dash-extras a[href="https://zed.msme.gov.in/contact-us"]')!.textContent).toContain('Contact ZED');
    // 2026-11-18 (the user's applicant designs): the scheme guidelines (Admin → Links) and the app's QR code.
    expect(el.querySelector('zed-dash-extras a[href="https://zed.msme.gov.in/uploads/Guideline_Book.pdf"]')!.textContent).toContain('Scheme guidelines');
    expect(el.querySelector('zed-dash-extras')!.textContent).toContain('Talk to the ZED helpdesk or read the scheme guidelines.');
    expect(el.querySelector('zed-dash-extras img[src="/Images/qrcode.png"]')).toBeTruthy();
    (steps[0].querySelector('button') as HTMLButtonElement).click();
    await settle();
    expect(el.textContent).toContain('Disclaimer / declaration');
  });

  it('shows the next step of the first paid level that is not completed', async () => {
    await render({ BronzeStatus: 1 }, { IsBronzePaymentDone: 1 });
    const next = el.querySelector('.next-step') as HTMLElement;
    expect(next.textContent).toContain('Continue Bronze certification');
    expect(next.textContent).toContain('Complete Basic Information & Documents in the ZED MSME app and final submit.');
    expect(next.querySelector('a')!.getAttribute('href')).toBe('/msme/certification/Bronze');
  });

  it('asks for the non-conformances in the next step', async () => {
    await render({ BronzeStatus: 4 }, { IsBronzePaymentDone: 1 });
    const next = el.querySelector('.next-step') as HTMLElement;
    expect(next.classList).toContain('is-nc');
    expect(next.textContent).toContain('in the ZED MSME app');
  });

  it('shows the unit band, and on each card its validity, surveillance and fee and how far the bar is filled', async () => {
    const level = (code: string, name: string, more: object = {}) => ({ code, name, description: null, comment: null, logoUrl: null,
      assessmentMode: 'Site', validityMonths: 36, fee: null, surveillance: { firstDueMonths: 12, count: null, intervalMonths: null }, ...more });
    await render({ BronzeStatus: 3 }, { IsBronzePaymentDone: 1, PledgeOn: 'October 28, 2026' }, 0, undefined, [
      level('Bronze', 'Bronze', { assessmentMode: 'Desktop', surveillance: { firstDueMonths: 15, count: null, intervalMonths: null } }),
      level('Silver', 'Silver'), level('Gold', 'Gold'),
      level('ZEDX', 'ZED-X (Export)', { validityMonths: 60, fee: 75000, surveillance: { firstDueMonths: 15, count: 2, intervalMonths: 12 } }),
    ], {}, { ZEDX: 75000 });
    const band = el.querySelector('.unit-card') as HTMLElement;
    expect(band.querySelector('h3')!.textContent).toBe('Acme Castings');
    expect([...band.querySelectorAll('.id-tag')].map((t) => [t.querySelector('i')!.textContent, t.lastChild!.textContent]))
      .toEqual([['UDYAM', 'UDYAM-UP-29-0003915'], ['ZED ID', 'ZEDMSME000001']]);
    expect(band.querySelector('.ent')!.classList).toContain('ent-micro');
    expect(band.querySelector('.pledge')!.textContent).toContain('ZED Pledge taken on October 28, 2026');
    expect(band.querySelector('a[href="/msme/pledge-certificate"]')).toBeTruthy();

    const facts = (code: string) => [...card(code).querySelectorAll('.lv-facts > div')].map((d) => `${d.querySelector('dt')!.textContent}: ${d.querySelector('dd b')!.textContent}`);
    expect(facts('bronze')).toEqual(['Valid for: 3 years', 'Surveillance: 1 visit (month 15)']);
    expect(facts('silver')).toEqual(['Valid for: 3 years', 'Surveillance: 1 visit (month 12)']);
    expect(facts('zedx')).toEqual(['Valid for: 5 years', 'Surveillance: 2 visits (month 15, 27)', 'Your fee: ₹ 75,000']);
    expect(card('zedx').querySelector('.lv-facts > div:last-child dd small')!.textContent).toBe('incl. GST, after subsidy');

    // Bronze at status 3: the first step done, the second in hand, so the bar is half filled.
    const bar = (code: string) => (card(code).querySelector('.lv-steps') as HTMLElement).style.getPropertyValue('--fill');
    expect(bar('bronze')).toBe('0.5');
    expect(bar('silver')).toBe('0');
    // An applied level: VIEW DETAILS and the arrow, both to its details; a level not applied for: VIEW DETAILS and APPLY.
    expect([...card('bronze').querySelectorAll('.lv-actions a')].map((a) => a.getAttribute('href'))).toEqual(['/msme/certification/Bronze', '/msme/certification/Bronze']);
    expect([...card('silver').querySelectorAll('.lv-actions button')].map((b) => b.textContent!.trim())).toEqual(['View details', 'Apply']);
  });

  it('greys out Silver and Gold while Bronze is in progress, and marks Bronze steps', async () => {
    await render({ BronzeStatus: 3 }, { IsBronzePaymentDone: 1 });
    expect(card('bronze').textContent).toContain('In progress');
    // 2026-11-18: the level in progress is the recommended next one.
    expect(card('bronze').classList).not.toContain('is-rec');
    expect(card('silver').classList).toContain('plant-activity-disabled');
    expect(card('gold').classList).toContain('plant-activity-disabled');
    // A locked level says so, and why.
    expect(card('silver').querySelector('.lv-status')!.textContent!.trim()).toBe('Locked');
    expect(card('silver').querySelector('.lv-lock-note')).toBeTruthy();
    expect(el.querySelector('.next-step')!.textContent).toContain('under assessment');

    const steps = [...card('bronze').querySelectorAll('.stepper li')].map((li) =>
      ['completed', 'current'].find((c) => li.classList.contains(c)) ?? '',
    );
    expect(steps).toEqual(['completed', 'current', '']);
    // Paid levels link to the certification details page instead of APPLY.
    expect(card('bronze').querySelector('a[href="/msme/certification/Bronze"]')).toBeTruthy();
  });

  it('shows the built-in incentive cards as the Admin set them and the incentives put on the dashboard', async () => {
    const titles = () => [...el.querySelectorAll('.inc-card h4')].map((h) => h.textContent!.trim());
    await render({ BronzeStatus: 6 }, {}, 0, {
      builtIn: [
        { card: 'JOINING_REWARD', title: 'Welcome Reward', highlight: 'Rs. 12,000/-', details: 'For new units', active: true },
      ],
      incentives: [
        { id: 57, title: 'Export Booster', highlight: 'Up to Rs. 5,00,000/-', details: 'Line one. Line two.', department: 'MoMSME', contactPerson: 'Officer',
          email: 'o@msme.gov.in', mobileNo: '011', webLink: 'https://scheme.example.org', videoLink: null,
          applicableForBronze: false, applicableForSilver: true, applicableForGold: false },
      ],
    });
    // Joining Reward with the Admin's wording; the others as before V4; the incentive before the stakeholder cards.
    expect(titles()).toEqual(['Welcome Reward', 'Financial Assistance', 'Handholding Support', 'Technology Upgradation', 'Export Booster',
      'Ministry of MSME', 'States/UTs', 'Financial Institutions', 'Other Incentives']);
    expect(el.textContent).toContain('Rs. 12,000/-');
    // Bronze certified only: a Silver incentive is locked, says why, and its details open from View details.
    const exportCard = [...el.querySelectorAll('.inc-card')].find((p) => p.textContent!.includes('Export Booster')) as HTMLElement;
    expect(exportCard.classList).toContain('is-locked');
    expect(exportCard.querySelector('.inc-chip')!.textContent!.trim()).toBe('Locked');
    expect(exportCard.textContent).toContain('For Silver certified units');
    (exportCard.querySelector('button') as HTMLButtonElement).click();
    await settle();
    const dialog = el.querySelector('.modal-content') as HTMLElement;
    expect(dialog.textContent).toContain('Export Booster');
    expect(dialog.textContent).toContain('Silver certified MSMEs');
    expect(dialog.textContent).toContain('Available once your unit is certified at Silver level.');
    expect(dialog.querySelector('a[href="https://scheme.example.org"]')).not.toBeNull();
  });

  it('unlocks a ZED-X incentive for a ZED-X certified unit (2026-11-16)', async () => {
    await render({ ZEDXStatus: 16 }, {}, 0, {
      builtIn: [],
      incentives: [
        { id: 58, title: 'Export Shield', highlight: null, details: 'D', department: 'MoMSME', contactPerson: 'Officer', email: 'o@msme.gov.in',
          mobileNo: '011', webLink: 'https://scheme.example.org', videoLink: null, applicableForBronze: false, applicableForSilver: false,
          applicableForGold: false, applicableForZEDX: true },
      ],
    });
    const card = [...el.querySelectorAll('.inc-card')].find((p) => p.textContent!.includes('Export Shield')) as HTMLElement;
    expect(card.classList).not.toContain('is-locked');
    expect(card.querySelector('.inc-chip')!.textContent!.trim()).toBe('Open');
    (card.querySelector('button') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('.modal-content')!.textContent).toContain('ZED-X certified MSMEs');
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
    expect(el.textContent).toContain('Apply for Bronze, Silver, Gold or ZED-X certification.');
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

  it('shows a level the Admin added (PLATINUM) as ZED-X: its card, apply and pay, details on the web, greyed out while another level runs', async () => {
    const lv = (code: string, name: string, more: object = {}) => ({ code, name, description: null, comment: null, logoUrl: null,
      assessmentMode: 'Site', validityMonths: 36, fee: null, ...more });
    const levels = [lv('Bronze', 'Bronze'), lv('Silver', 'Silver'), lv('Gold', 'Gold'),
      lv('PLATINUM', 'Platinum', { comment: 'Platinum: beyond Gold.', logoUrl: '/api/public/levels/PLATINUM/logo', assessmentMode: 'Desktop' })];
    await render({ PLATINUMStatus: 0 }, {}, 0, undefined, levels, {}, { PLATINUM: 50000 });
    const p = card('platinum');
    expect(p).not.toBeNull();
    expect(p.classList).toContain('panel-added');
    expect(p.querySelector('h5')!.textContent).toContain('PLATINUM CERTIFICATION');
    expect(p.querySelector('.inner2 img')!.getAttribute('src')).toBe('/api/public/levels/PLATINUM/logo');
    expect(p.textContent).toContain('Not started');
    expect(p.textContent).toContain('₹ 50,000');
    // Desktop assessment only: details, desktop, certified.
    expect([...p.querySelectorAll('.lv-steps-labels span')].map((x) => x.textContent!.trim())).toEqual(['Details', 'Desktop', 'Certified']);
    expect(el.textContent).toContain('Apply for Bronze, Silver, Gold or Platinum certification.');
    (p.querySelector('.panel-heading button') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('.modal-content')!.textContent).toContain('Platinum Certification');
    expect(el.querySelector('.modal-content')!.textContent).toContain('beyond Gold');
    (el.querySelector('.modal-content button[aria-label="Close"], .modal-content .close, .modal-header button') as HTMLElement)?.click();
    await settle();

    // APPLY: disclaimer, instructions, then the payment of PLATINUM.
    (p.querySelector('.apply-btn') as HTMLElement).click();
    await settle();
    consent();
    await settle();
    button('Accept & proceed').click();
    await settle();
    button('Accept & proceed').click();
    await settle();
    http.expectOne('/api/msme/payments/PLATINUM/options').flush({
      certification: 'PLATINUM', withReward: null, rewardAvailable: false, udyamPan: 'ABCDE1234F',
      withoutReward: { Total: 59000, ApplicantContributionAfterSubsidy: 59000, NetPaybleTds15: 58000, NetPaybleTds75: 57000, SubsidyLabel: '' },
    });
    await settle();
    expect(el.textContent).toContain('Tax details');
    fixture.destroy();

    // Paid: basic information and documents on the web, as ZED-X.
    await render({ PLATINUMStatus: 1 }, { IsPLATINUMPaymentDone: 1 }, 0, undefined, levels);
    // 2026-11-14: no web entry; the details are entered in the ZED MSME app.
    expect(card('platinum').querySelector('a[href="/msme/entry/PLATINUM"]')).toBeNull();
    // While it runs, Bronze, Silver and Gold are greyed out.
    for (const level of ['bronze', 'silver', 'gold']) expect(card(level).classList).toContain('plant-activity-disabled');
    fixture.destroy();

    // Bronze in progress greys it out.
    await render({ BronzeStatus: 3, PLATINUMStatus: 0 }, { IsBronzePaymentDone: 1 }, 0, undefined, levels);
    expect(card('platinum').classList).toContain('plant-activity-disabled');
  });

  it('marks a certified level as completed and unlocks the incentives', async () => {
    await render({ SilverStatus: 16 }, { IsSilverPaymentDone: 1, LatestCertification: 'Silver', StateId: 9 });
    expect(card('silver').textContent).toContain('Certified');
    const states = [...el.querySelectorAll('a')].find((a) => a.getAttribute('href')?.includes('it=States'))!;
    expect(states.getAttribute('href')).toBe('/incentives?it=States&ct=Silver&id=9');
    expect(states.closest('.inc-card')!.classList).not.toContain('is-locked');
    // The unit card's current level, and the next steps: the incentives open now, and the next level (Gold) outlined.
    expect(el.querySelector('.uc-facts')!.textContent).toContain('Silver');
    expect([...el.querySelectorAll('.ns-card h3')].map((h) => h.textContent)).toEqual(['Avail your Silver incentives', 'Apply for Gold certification']);
    expect(card('gold').classList).not.toContain('is-rec');
  });

  it('shows when the current level was certified, its validity end and the next surveillance (2026-11-18)', async () => {
    const levels = ['Bronze', 'Silver', 'Gold'].map((code) => ({ code, name: code, description: null, comment: null, logoUrl: null, assessmentMode: 'Site',
      validityMonths: 60, fee: null, surveillance: { firstDueMonths: 18, count: 2, intervalMonths: 18 } }));
    // Certified two years ago: the visit of month 18 has passed, the one of month 36 is next.
    const now = new Date();
    const on = new Date(now.getFullYear() - 2, now.getMonth(), 1);
    const iso = `${on.getFullYear()}-${String(on.getMonth() + 1).padStart(2, '0')}-01`;
    const day = (d: Date) => formatDate(d, 'd MMM y', 'en-US');
    const fact = (i: number) => {
      const d = el.querySelectorAll('.uc-facts > div')[i];
      return [d.querySelector('dt')!.textContent!.trim(), d.querySelector('b, .uc-level')!.textContent!.trim(), d.querySelector('small')!.textContent!.trim()];
    };
    await render({ BronzeStatus: 6 }, { IsBronzePaymentDone: 1 }, 0, undefined, levels, {}, {}, { Bronze: iso });
    expect(fact(0)).toEqual(['Current level', 'Bronze', `Certified ${day(on)}`]);
    expect(fact(1)).toEqual(['Valid till', day(new Date(on.getFullYear() + 5, on.getMonth(), 0)), '5-year validity']);
    expect(fact(2)).toEqual(['Next surveillance', formatDate(new Date(on.getFullYear() + 3, on.getMonth(), 1), 'MMM y', 'en-US'), '2nd of 2 visits']);
    expect(card('bronze').querySelector('.lv-status')!.textContent!.trim()).toBe(`Certified · ${day(on)}`);
    // Silver is the recommended next level.
    expect(card('silver').classList).not.toContain('is-rec');
    fixture.destroy();

    // Without the date: as before.
    await render({ BronzeStatus: 6 }, { IsBronzePaymentDone: 1 }, 0, undefined, levels);
    expect(fact(0)).toEqual(['Current level', 'Bronze', 'Certified']);
    expect(fact(1)).toEqual(['Valid for', '5 years', 'from certification']);
    expect(fact(2)).toEqual(['Surveillance', 'Month 18, 36', '2 visits after certification']);
    expect(card('bronze').querySelector('.lv-status')!.textContent!.trim()).toBe('Certified');
  });

  it('walks the apply flow: disclaimer, instructions, then the payment step', async () => {
    await render({}, {}, 0, undefined, [], {}, { Gold: 21240 });
    (card('gold').querySelector('.apply-btn') as HTMLElement).click();
    await settle();
    // 2026-11-17 (the user's design): the page head, step 1 of the four-step tracker, the Admin's disclaimer and the right rail.
    expect(el.querySelector('.ph-title')!.textContent).toBe('Apply for Gold Certification');
    expect(el.querySelector('.ph-sub')!.textContent).toContain('Step 1 of 4');
    expect([...el.querySelectorAll('.st-label')].map((s) => s.textContent)).toEqual(['Disclaimer', 'Fee & tax details', 'Payment', 'Confirmation']);
    expect(el.textContent).toContain('Disclaimer / declaration');
    expect(keys()).toEqual([
      'msme.certification.payment.disclaimer', 'msme.certification.payment.disclaimer.firstCertification', 'msme.certification.payment.disclaimer.closing',
    ]);
    const rail = el.querySelector('.af-rail')!;
    expect(rail.textContent).toContain('Gold Certification');
    expect(rail.textContent).toContain('Acme Castings · ZEDMSME000001');
    expect(rail.textContent).toContain('₹ 21,240');
    expect(rail.textContent).toContain('Desktop check and site visit');
    expect(rail.textContent).toContain('Key points at a glance');
    expect(el.textContent).toContain('Nothing is charged at this step.');

    // The explicit consent comes first.
    expect(button('Accept & proceed').hasAttribute('disabled')).toBe(true);
    consent();
    await settle();
    button('Accept & proceed').click();
    await settle();
    expect(el.textContent).toContain('Instructions');
    expect(keys()).toEqual(['msme.certification.payment.instructions']);

    button('Accept & proceed').click();
    await settle();
    http.expectOne('/api/msme/payments/Gold/options').flush({
      certification: 'Gold', withReward: null, rewardAvailable: false, udyamPan: 'ABCDE1234F',
      withoutReward: { Total: 90000, ApplicantContributionAfterSubsidy: 21240, NetPaybleTds15: 20880, NetPaybleTds75: 19440, SubsidyLabel: '(80%)' },
    });
    await settle();
    expect(el.textContent).toContain('Tax details');
    expect(el.textContent).toContain('21,240.00');
    expect(el.querySelector('.ph-sub')!.textContent).toContain('Step 2 of 4');
    expect(el.querySelector('#billTitle')!.closest('section')!.textContent).toContain('Acme Castings');

    // Back to disclaimer, then Back to dashboard.
    button('← Back to disclaimer').click();
    await settle();
    expect(el.textContent).toContain('Disclaimer / declaration');
    button('← Back to dashboard').click();
    await settle();
    expect(el.querySelector('#certifications')).not.toBeNull();
    expect(el.querySelector('#incentives')).not.toBeNull();
  });

  it('opens the apply flow from a direct link (?apply=Silver) only when the level may be applied for', async () => {
    await TestBed.inject(Router).navigateByUrl('/?apply=silver');
    await render({});
    expect(el.querySelector('.ph-title')!.textContent).toBe('Apply for Silver Certification');
    fixture.destroy();

    // Silver already paid: the dashboard stays.
    await render({ SilverStatus: 3 }, { IsSilverPaymentDone: 1 });
    expect(el.querySelector('.af-rail')).toBeNull();
    expect(el.querySelector('#certifications')).not.toBeNull();
  });

  it('leaves out the first-certification points of the disclaimer for a re-certification', async () => {
    await render({}, {}, 1);
    (card('gold').querySelector('.apply-btn') as HTMLElement).click();
    await settle();
    expect(keys()).toEqual(['msme.certification.payment.disclaimer', 'msme.certification.payment.disclaimer.closing']);
  });

  it('offers Bronze re-certification to every unit it is enabled for', async () => {
    await render({ BronzeStatus: 6 }, {}, 1, undefined, [], { ReCertificationLevel: 'Bronze' });
    expect(card('bronze').textContent).toContain('Re-certification');
    expect(card('silver').textContent).not.toContain('Re-certification');
  });

  it('gives each incentive its status, and puts surveillance, incentives, the next level and handholding in the next steps', async () => {
    const chip = (title: string) => [...el.querySelectorAll('.inc-card')].find((c) => c.querySelector('h4')!.textContent!.trim() === title)!
      .querySelector('.inc-chip')!.textContent!.trim();
    const eligible = { IsEligibleForFinancial: 1, IsEligibleForBenefits: 1 };
    await render({ BronzeStatus: 6, ConsultancyStatus: 2, TechnologyUpgradationStatus: 0, FinancialAssistanceStatus: 1 },
      { IsBronzePaymentDone: 1, IsCouponUsed: 1, BronzeDashboardSurStatus: 1, IsSurBronzePaymentDone: 0 }, 0, undefined, [], eligible);
    expect(chip('Joining Reward')).toBe('Availed');
    expect(chip('Financial Assistance')).toBe('Open');
    expect(chip('Handholding Support')).toBe('In progress');
    expect(chip('Technology Upgradation')).toBe('Availed');
    expect(chip('Ministry of MSME')).toBe('Open');
    // Three next steps at most, most urgent first.
    const steps = [...el.querySelectorAll('.ns-card')];
    expect(steps.map((c) => c.querySelector('h3')!.textContent)).toEqual(['Bronze surveillance due', 'Avail your Bronze incentives', 'Apply for Silver certification']);
    expect(steps[0].querySelector('a')!.getAttribute('href')).toBe('/msme/surveillance-payment/Bronze');
    // The unit card: the current level and its surveillance due now.
    const facts = el.querySelector('.uc-facts') as HTMLElement;
    expect(facts.textContent).toContain('Bronze');
    expect(facts.textContent).toContain('Due now');
    expect(facts.querySelector('a')!.getAttribute('href')).toBe('/msme/surveillance-payment/Bronze');
    // The joining reward's details show it availed.
    const joining = [...el.querySelectorAll('.inc-card')].find((c) => c.textContent!.includes('Joining Reward'))!;
    (joining.querySelector('button') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('.modal-content .dp-chip')!.textContent).toContain('Availed');
    fixture.destroy();

    await render({ BronzeStatus: 6, ConsultancyStatus: 2 }, { IsBronzePaymentDone: 1, BronzeDashboardSurStatus: 0 }, 0, undefined, [], eligible);
    const last = [...el.querySelectorAll('.ns-card')].pop()!;
    expect(last.querySelector('h3')!.textContent).toBe('Continue handholding');
    expect(last.querySelector('a')!.getAttribute('href')).toBe('/msme/handholding');
  });

  it('shows the certification steps from the Texts', async () => {
    await render({});
    expect([...el.querySelectorAll('.cert-steps .step-details zed-text')].map((t) => t.getAttribute('data-key'))).toEqual(
      [1, 2, 3, 4, 5].map((n) => `msme.dashboard.certificationSteps.${n}`),
    );
  });
});
