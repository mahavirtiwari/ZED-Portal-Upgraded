import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ContentService } from '../../content/content-text';
import { HandholdingPage } from './handholding';
import { HandholdingSummary, LevelState } from './handholding.api';

const API = '/api/msme/handholding';

function level(certification: 'Silver' | 'Gold' | 'ZEDX', overrides: Partial<LevelState> = {}): LevelState {
  return { certification, enabled: true, milestonesStarted: 0, nextMilestone: 1, canPay: true, refusal: null, awaitingAcceptance: null, ...overrides };
}

function summary(status: Record<string, number> = {}, levels: LevelState[] = [level('Silver'), level('Gold', { enabled: false, canPay: false })]): HandholdingSummary {
  return {
    msme: { ZedId: 'ZEDMSME000001', EnterpriseName: 'Acme', EnterpriseType: 'Micro', RegistrationType: 'UDYAM', PledgeOn: 'May 1, 2024', IsSilverPaymentDone: 0, IsGoldPaymentDone: 0 },
    basicInfo: { UdyogAadharNo: 'UDYAM-UP-29-0003915' },
    status: { EnableSilver: 1, EnableGold: 0, SilverStatus: 0, SilverStatusOfNc: 0, ...status },
    levels,
  };
}

async function settle(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('HandholdingPage', () => {
  let fixture: ComponentFixture<HandholdingPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  let router: Router;

  const settled = () => settle(fixture);
  const find = (selector: string, label: string) =>
    [...el.querySelectorAll(selector)].find((b) => b.textContent!.trim().startsWith(label)) as HTMLElement | undefined;
  const cards = () => [...el.querySelectorAll('.hh-card')] as HTMLElement[];
  const card = (code: string) => el.querySelector(`.hh-card[data-level="${code}"]`) as HTMLElement | null;
  const milestoneApplies = () => [...el.querySelectorAll('button.ms-apply')] as HTMLButtonElement[];
  const msTitle = () => el.querySelector('#hh-ms-title')?.textContent?.trim();

  async function open(data: HandholdingSummary = summary(), levelParam?: string) {
    fixture = TestBed.createComponent(HandholdingPage);
    if (levelParam !== undefined) fixture.componentRef.setInput('level', levelParam);
    el = fixture.nativeElement;
    await settled();
    http.expectOne(API).flush(data);
    await settled();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HandholdingPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    window.scrollTo = () => undefined;
  });

  afterEach(() => http.verify());

  it('2026-11-17: shows only the level open to the unit (no greyed-out cards), its milestones open below', async () => {
    await open();
    expect(el.querySelector('.ph-title')!.textContent).toContain('Handholding support');
    expect(el.querySelector('.ph-crumb')!.textContent).toContain('Incentives');
    expect(cards().length).toBe(1);
    expect(card('Silver')!.querySelector('.hh-name')!.textContent).toBe('Silver');
    expect(card('Gold')).toBeNull();
    expect(card('Silver')!.querySelector('.hh-chip')!.textContent).toContain('Not started');
    expect([...card('Silver')!.querySelectorAll('.hh-track .lbl')].map((l) => l.textContent)).toEqual(['Baseline', 'Review 1', 'Review 2', 'Complete']);
    // The only level is outlined and its milestones are shown on the same page.
    expect(card('Silver')!.classList).toContain('is-active');
    expect(msTitle()).toBe('Silver handholding: milestones');
    expect(el.querySelectorAll('li.milestone').length).toBe(3);
    expect(el.textContent).toContain('Handholding closed');
    // Cost and subsidy in the right column; no consultant card (the data names none).
    expect(el.textContent).toContain('Cost and subsidy');
    expect(el.textContent).toContain('Subsidy (Micro)');
    expect(el.textContent).toContain('Shown before you pay');
    expect(el.textContent).not.toContain('consultant / agency');
  });

  it('takes the cost from the Admin text into the subtitle and the cost card', async () => {
    const html = '<ul><li><p>Study.</p></li><li><p>The Handholding Support cost is Rs. 2,00,000/- inclusive of taxes; subsidy as applicable.</p></li></ul>';
    const text = vi.spyOn(TestBed.inject(ContentService), 'text').mockImplementation((key: string) =>
      key === 'msme.handholding.info.level' ? { key, enabled: true, html } : null);
    try {
      await open();
      expect(el.querySelector('.ph-sub')!.textContent).toContain('Cost ₹ 2,00,000');
      expect(el.querySelector('.hh-cost')!.textContent).toContain('₹ 2,00,000');
      expect(el.querySelector('.hh-cost')!.textContent).toContain('incl. taxes');
    } finally {
      text.mockRestore();
    }
  });

  it('shows no cost line when the Admin text gives none', async () => {
    await open();
    expect(el.querySelector('.ph-sub')!.textContent!.trim()).toBe('Consultancy to help you reach your target level.');
    expect(el.querySelector('.hh-cost')!.textContent).not.toContain('Handholding cost');
  });

  it('Apply on a level not started goes to the payment of its first milestone', async () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await open();
    (card('Silver')!.querySelector('.hh-apply') as HTMLElement).click();
    expect(navigate).toHaveBeenCalledWith(['/msme/handholding', 'Silver', 'payment']);
  });

  it('shows the milestones of a level and sends APPLY to the payment of the milestone due', async () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await open(summary({ SilverStatus: 2, SilverStatusOfNc: 1, SilverStatusOfNc1: 1, MilestoneCompletionStatus1: 100 }, [level('Silver', { milestonesStarted: 1, nextMilestone: 2 })]));

    // Started: no Apply on the card, "In progress" at the milestone due.
    expect(card('Silver')!.querySelector('.hh-apply')).toBeNull();
    expect(card('Silver')!.querySelector('.hh-chip')!.textContent).toContain('In progress · Milestone 2');
    expect(card('Silver')!.querySelector('.hh-track li.done .lbl')!.textContent).toBe('Baseline');
    expect(card('Silver')!.querySelector('.hh-track li.now .lbl')!.textContent).toBe('Review 1');

    expect(el.textContent).toContain('Baseline Diagnostic Study and Handholding Action Plan');
    expect(el.textContent).toContain('Implementation & Progress Review 1');

    const view = find('a', 'View action plan')!;
    expect(view.getAttribute('href')).toBe('/msme/certification/SilverMilestone1');
    // Milestone 2 can be paid (highlighted); milestone 3 not yet (no APPLY).
    const applies = milestoneApplies();
    expect(applies.map((b) => b.disabled)).toEqual([false]);
    const items = [...el.querySelectorAll('li.milestone')];
    expect(items[1].classList).toContain('is-now');
    expect(items[2].textContent).toContain('Starts after Milestone 2');
    applies[0].click();
    expect(navigate).toHaveBeenCalledWith(['/msme/handholding', 'Silver', 'payment']);
  });

  it('says Completed for a milestone the unit accepted (2026-11-16: it read "Applied")', async () => {
    await open(summary({ SilverStatus: 2, SilverStatusOfNc: 2, SilverStatusOfNc1: 1, SilverStatusOfNc2: 1, MilestoneCompletionStatus1: 100, MilestoneCompletionStatus2: 9 },
      [level('Silver', { milestonesStarted: 2, nextMilestone: 3, canPay: false })]));
    const items = [...el.querySelectorAll('li.milestone')].map((li) => li.textContent!);
    expect(items[0]).toContain('Completed');
    expect(items[0]).not.toContain('Applied');
    expect(items[1]).toContain('Applied');
  });

  it('2026-11-16: a Gold-certified unit takes ZED-X handholding, only its card shown', async () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await open(summary(
      { EnableSilver: 0, EnableGold: 0, EnableZEDX: 1, ZEDXStatus: 4, ZEDXStatusOfNc: 1, ZEDXStatusOfNc1: 1, MilestoneCompletionStatusZEDX1: 100 },
      [level('Silver', { enabled: false, canPay: false }), level('Gold', { enabled: false, canPay: false }), level('ZEDX', { milestonesStarted: 1, nextMilestone: 2 })]));
    expect(cards().length).toBe(1);
    expect(card('ZEDX')!.querySelector('.hh-name')!.textContent).toBe('ZED-X');
    expect(card('ZEDX')!.classList).toContain('hh-zedx');
    expect(card('ZEDX')!.querySelector('.hh-badge img')!.getAttribute('src')).toBe('/Images/Dashboard/zedx.svg');

    expect(msTitle()).toBe('ZED-X handholding: milestones');
    expect(el.textContent).toContain('Basic diagnostic study and handholding');
    expect(find('a', 'View action plan')!.getAttribute('href')).toBe('/msme/certification/ZEDXMilestone1');
    milestoneApplies()[0].click();
    expect(navigate).toHaveBeenCalledWith(['/msme/handholding', 'ZEDX', 'payment']);
  });

  it('opens the milestones of the level in ?level= (BACK of the payment page)', async () => {
    await open(summary({ EnableGold: 1 }, [level('Silver'), level('Gold')]), 'gold');
    expect(msTitle()).toBe('Gold handholding: milestones');
    expect(card('Gold')!.classList).toContain('is-active');
    expect(card('Silver')!.classList).not.toContain('is-active');
  });

  it('ignores ?level= for a disabled level', async () => {
    await open(summary(), 'Gold');
    expect(card('Gold')).toBeNull();
    expect(msTitle()).toBe('Silver handholding: milestones');
  });

  it('keeps a disabled level the unit already started (paid or in progress) and switches levels from the cards', async () => {
    await open(summary({ EnableSilver: 0, EnableGold: 1, SilverStatus: 2 }, [level('Silver', { enabled: false, canPay: false }), level('Gold')]));
    expect(cards().map((c) => c.dataset['level'])).toEqual(['Silver', 'Gold']);
    (card('Gold')!.querySelector('.hh-pick') as HTMLElement).click();
    await settled();
    expect(msTitle()).toBe('Gold handholding: milestones');
    expect(card('Gold')!.querySelector('.hh-viewing')).toBeNull(); // Gold keeps its Apply
    expect(card('Gold')!.classList).toContain('is-active');
  });

  it('says so when no level is open to the unit', async () => {
    await open(summary({ EnableSilver: 0, EnableGold: 0 }, [level('Silver', { enabled: false, canPay: false }), level('Gold', { enabled: false, canPay: false })]));
    expect(cards().length).toBe(0);
    expect(el.querySelector('[data-no-handholding]')!.textContent).toContain('No handholding is available');
    expect(el.querySelector('#hh-milestones')).toBeNull();
  });

  it('shows the details pop-up for an unpaid level and the information pop-ups', async () => {
    await open();
    find('button', 'View details')!.click();
    await settled();
    expect(el.textContent).toContain('Click on APPLY button to start Application Process');
    (el.querySelector('.modal [aria-label="Close"]') as HTMLElement).click();
    await settled();

    (el.querySelector('[aria-label="About Handholding for Silver Level"]') as HTMLElement).click();
    await settled();
    expect(el.querySelector('.modal [data-key="msme.handholding.info.level"]')).not.toBeNull();
    (el.querySelector('.modal [aria-label="Close"]') as HTMLElement).click();
    await settled();

    (el.querySelector('[aria-label="About Handholding Support"]') as HTMLElement).click();
    await settled();
    expect(el.querySelector('.modal [data-key="msme.handholding.info.general"]')).not.toBeNull();
  });

  it('accepts a milestone waiting for the unit after the declaration is ticked, then reloads', async () => {
    await open(
      summary({ SilverStatus: 9, SilverStatusOfNc: 1, SilverStatusOfNc1: 1, MilestoneCompletionStatus1: 16 }, [
        level('Silver', { milestonesStarted: 1, nextMilestone: 2, canPay: false, refusal: 'Milestone 1 must be completed and accepted before Milestone 2 can be paid.', awaitingAcceptance: 1 }),
      ]),
    );
    expect(el.textContent).toContain('Milestone 1 must be completed and accepted');
    expect(el.querySelector('li.milestone')!.textContent).toContain('Submitted by the consultant: please accept');

    find('button', 'Accept milestone 1')!.click();
    await settled();
    const submit = find('button', 'SUBMIT') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(el.querySelector('input[name="isAccepted"]')!.closest('label')!.querySelector('[data-key="msme.handholding.acceptMilestone.checkbox"]')).not.toBeNull();
    (el.querySelector('input[name="isAccepted"]') as HTMLInputElement).click();
    await settled();
    expect(submit.disabled).toBe(false);
    submit.click();
    await settled();

    const req = http.expectOne(`${API}/accept-milestone`);
    expect(req.request.body).toEqual({ certification: 'Silver', milestone: 1 });
    req.flush({ message: 'Milestone 1 accepted.' });
    await settled();
    http.expectOne(API).flush(summary({ MilestoneCompletionStatus1: 100 }));
    await settled();
    expect(el.textContent).not.toContain('Accept milestone 1');
  });

  it('shows the API error', async () => {
    fixture = TestBed.createComponent(HandholdingPage);
    el = fixture.nativeElement;
    await settled();
    http.expectOne(API).flush({ title: 'Handholding Support details are not available for this unit.' }, { status: 404, statusText: 'Not Found' });
    await settled();
    expect(el.textContent).toContain('Handholding Support details are not available for this unit.');
  });
});
