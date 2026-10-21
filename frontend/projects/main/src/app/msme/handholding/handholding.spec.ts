import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { HandholdingPage } from './handholding';
import { HandholdingSummary, LevelState } from './handholding.api';

const API = '/api/msme/handholding';

function level(certification: 'Silver' | 'Gold', overrides: Partial<LevelState> = {}): LevelState {
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

  async function open(data: HandholdingSummary = summary()) {
    fixture = TestBed.createComponent(HandholdingPage);
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

  it('shows the unit and both level cards, the disabled level greyed out', async () => {
    await open();
    expect(el.textContent).toContain('Acme');
    expect(el.textContent).toContain('UDYAM-UP-29-0003915');
    expect(el.textContent).toContain('HANDHOLDING FOR SILVER LEVEL');
    expect(el.textContent).toContain('HANDHOLDING FOR GOLD LEVEL');
    expect(el.textContent).toContain('Get started');
    const gold = [...el.querySelectorAll('.panel-cert-block')].find((p) => p.textContent!.includes('GOLD'))!;
    expect(gold.classList).toContain('plant-activity-disabled');
    expect(el.querySelector('a[href="/api/msme/files/pledge-certificate"]')).not.toBeNull();
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
    expect(applies.map((b) => b.disabled)).toEqual([false, true]);   // milestone 2 can be paid, milestone 3 not yet
    applies[0].click();
    expect(navigate).toHaveBeenCalledWith(['/msme/handholding', 'Silver', 'payment']);
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
    expect(el.textContent).toContain('The Handholding Support cost is Rs. 2,00,000/- inclusive of taxes');
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
