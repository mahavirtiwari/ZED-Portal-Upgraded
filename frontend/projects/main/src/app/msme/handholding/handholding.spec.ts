import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
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

  it('2026-11-17: shows the unit and only the level open to it (no greyed-out cards)', async () => {
    await open();
    expect(el.textContent).toContain('Acme');
    expect(el.textContent).toContain('UDYAM-UP-29-0003915');
    expect(el.textContent).toContain('HANDHOLDING FOR SILVER LEVEL');
    expect(el.textContent).not.toContain('HANDHOLDING FOR GOLD LEVEL');
    expect(el.textContent).toContain('Get started');
    expect(el.querySelectorAll('.panel-cert-block').length).toBe(1);
    expect(el.querySelector('.plant-activity-disabled')).toBeNull();
    // 2026-11-14: the short unit card (no pledge row) in the right column.
    expect(el.querySelector('zed-msme-unit-summary .us-card')).not.toBeNull();
  });

  it('opens the milestones of a level and sends APPLY to the payment of the milestone due', async () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await open(summary({ SilverStatus: 2, SilverStatusOfNc: 1, SilverStatusOfNc1: 1, MilestoneCompletionStatus1: 100 }, [level('Silver', { milestonesStarted: 1, nextMilestone: 2 })]));

    find('p', 'APPLY')!.click();
    await settled();
    expect(el.textContent).toContain('Milestone 1: Baseline Diagnostic Study and Handholding Action Plan');
    expect(el.textContent).toContain('Milestone 2: Implementation & Progress Review 1');

    const view = find('a', 'VIEW')!;
    expect(view.getAttribute('href')).toBe('/msme/certification/SilverMilestone1');
    const applies = [...el.querySelectorAll('button')].filter((b) => b.textContent!.trim() === 'APPLY') as HTMLButtonElement[];
    // Milestone 2 can be paid; milestone 3 not yet (2026-11-14: shown as "Not started", no APPLY).
    expect(applies.map((b) => b.disabled)).toEqual([false]);
    expect(el.textContent).toContain('Not started');
    applies[0].click();
    expect(navigate).toHaveBeenCalledWith(['/msme/handholding', 'Silver', 'payment']);
  });

  it('says Completed for a milestone the unit accepted (2026-11-16: it read "Applied")', async () => {
    await open(summary({ SilverStatus: 2, SilverStatusOfNc: 2, SilverStatusOfNc1: 1, SilverStatusOfNc2: 1, MilestoneCompletionStatus1: 100, MilestoneCompletionStatus2: 9 },
      [level('Silver', { milestonesStarted: 2, nextMilestone: 3, canPay: false })]));
    find('p', 'APPLY')!.click();
    await settled();
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
    expect(el.textContent).toContain('HANDHOLDING FOR ZED-X LEVEL');
    const cards = [...el.querySelectorAll('.panel-cert-block')];
    expect(cards.length).toBe(1);
    expect(el.textContent).not.toContain('HANDHOLDING FOR SILVER LEVEL');
    expect(el.textContent).not.toContain('HANDHOLDING FOR GOLD LEVEL');
    expect(cards[0].classList).toContain('panel-zedx');
    expect(cards[0].classList).not.toContain('plant-activity-disabled');
    expect(cards[0].querySelector('.inner2 img')!.getAttribute('src')).toBe('/Images/Dashboard/zedx.svg');

    ([...cards[0].querySelectorAll('p')].find((p) => p.textContent!.trim() === 'APPLY') as HTMLElement).click();
    await settled();
    expect(el.textContent).toContain('Milestone 1: BASIC DIAGNOSTIC STUDY AND HANDHOLDING');
    expect(find('a', 'VIEW')!.getAttribute('href')).toBe('/msme/certification/ZEDXMilestone1');
    const applies = [...el.querySelectorAll('button')].filter((b) => b.textContent!.trim() === 'APPLY') as HTMLButtonElement[];
    applies[0].click();
    expect(navigate).toHaveBeenCalledWith(['/msme/handholding', 'ZEDX', 'payment']);
  });

  it('opens the milestones of the level in ?level= (BACK of the payment page)', async () => {
    await open(summary(), 'silver');
    expect(el.textContent).toContain('Milestone 1: Baseline Diagnostic Study and Handholding Action Plan');
    expect(el.textContent).not.toContain('HANDHOLDING FOR SILVER LEVEL');
  });

  it('ignores ?level= for a disabled level', async () => {
    await open(summary(), 'Gold');
    expect(el.textContent).toContain('HANDHOLDING FOR SILVER LEVEL');
    expect(el.textContent).not.toContain('Milestone 1');
  });

  it('keeps a disabled level the unit already started (paid or in progress)', async () => {
    await open(summary({ EnableSilver: 0, EnableGold: 1, SilverStatus: 2 }, [level('Silver', { enabled: false, canPay: false }), level('Gold')]));
    expect(el.textContent).toContain('HANDHOLDING FOR SILVER LEVEL');
    expect(el.textContent).toContain('HANDHOLDING FOR GOLD LEVEL');
  });

  it('says so when no level is open to the unit', async () => {
    await open(summary({ EnableSilver: 0, EnableGold: 0 }, [level('Silver', { enabled: false, canPay: false }), level('Gold', { enabled: false, canPay: false })]));
    expect(el.querySelectorAll('.panel-cert-block').length).toBe(0);
    expect(el.querySelector('[data-no-handholding]')!.textContent).toContain('No handholding is available');
  });

  it('shows the details pop-up for an unpaid level and the information pop-ups', async () => {
    await open();
    find('h5', 'VIEW DETAILS')!.click();
    await settled();
    expect(el.textContent).toContain('Click on APPLY button to start Application Process');
    (el.querySelector('[aria-label="Close"]') as HTMLElement).click();
    await settled();

    (el.querySelector('[aria-label="About Handholding for Silver Level"]') as HTMLElement).click();
    await settled();
    expect(el.querySelector('.modal [data-key="msme.handholding.info.level"]')).not.toBeNull();
  });

  it('accepts a milestone waiting for the unit after the declaration is ticked, then reloads', async () => {
    await open(
      summary({ SilverStatus: 9, SilverStatusOfNc: 1, SilverStatusOfNc1: 1, MilestoneCompletionStatus1: 16 }, [
        level('Silver', { milestonesStarted: 1, nextMilestone: 2, canPay: false, refusal: 'Milestone 1 must be completed and accepted before Milestone 2 can be paid.', awaitingAcceptance: 1 }),
      ]),
    );
    find('p', 'APPLY')!.click();
    await settled();
    expect(el.textContent).toContain('Milestone 1 must be completed and accepted');

    find('button', 'ACCEPT MILESTONE 1')!.click();
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
    expect(el.textContent).not.toContain('ACCEPT MILESTONE 1');
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
