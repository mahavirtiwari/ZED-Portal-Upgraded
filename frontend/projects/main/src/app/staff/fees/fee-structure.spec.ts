import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeeStructurePage } from './fee-structure';
import { FeeRow, FeesResponse } from './fees.api';

function row(id: number, certification: string, category: number, pct: number, fee: number, coupon: number | null = null): FeeRow {
  const base = coupon === null ? fee : (fee * 1.18 - coupon) / 1.18;
  const taxable = (base * (100 - pct)) / 100;
  return {
    id, enterpriseTypee: 'Micro', certification, specialCategory: category, isActive: true, subsidyPercentage: pct,
    assessmentFee: fee, gst: fee * 0.18, total: fee * 1.18, coupon, assessmentFeeAfterCoupon: coupon === null ? null : base, gstAfterCoupon: null,
    totalAfterCoupon: null, subsidyPer: taxable, gstAfterSubsidy: taxable * 0.18, applicantContributionAfterSubsidy: taxable * 1.18,
    tds15: taxable * 0.02, tds75: taxable * 0.1, netPaybleTds15: taxable * 1.16, netPaybleTds75: taxable * 1.08, isCouponRow: coupon !== null,
  };
}

const micro: FeesResponse = {
  enterpriseType: 'Micro',
  levels: [
    { certification: 'Bronze', assessmentFee: 10000, coupon: 1000, hasCouponRows: true },
    { certification: 'Silver', assessmentFee: 20000, coupon: null, hasCouponRows: false },
  ],
  rows: [
    row(1, 'Bronze', 0, 80, 10000), row(2, 'Bronze', 2, 90, 10000), row(3, 'Bronze', 1, 90, 10000), row(4, 'Bronze', 0, 80, 10000, 1000),
    row(5, 'Silver', 0, 80, 20000),
  ],
};

describe('FeeStructurePage', () => {
  let fixture: ComponentFixture<FeeStructurePage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const button = (text: string, root: ParentNode = el) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent!.trim() === text) as HTMLButtonElement;
  const structure = () =>
    [...el.querySelectorAll('section[aria-labelledby="fs-structure"] tbody tr')].map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
  const typeIn = async (selector: string, value: string) => {
    const input = el.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FeeStructurePage], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(FeeStructurePage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne('/api/staff/fees/Micro').flush(micro);
    await settle();
  });

  afterEach(() => http.verify());

  it('shows the fee, joining reward and payment structure of each category, then the TDS', () => {
    expect(el.querySelector('h3')!.textContent).toContain('Fee Structure — Bronze');
    expect((el.querySelector('#fs-fee') as HTMLInputElement).value).toBe('10000');
    expect((el.querySelector('#fs-reward') as HTMLInputElement).value).toBe('1000');
    const rows = structure();
    expect([...el.querySelectorAll('section[aria-labelledby="fs-structure"] td.fs-code')].map((c) => c.textContent!.trim())).toEqual(['GEN', 'GEN', 'SC', 'WOM']);
    expect(rows[0]).toContain('80%');
    expect(rows[0]).toContain('₹ 8,000.00'); // the Government's share of 10,000 at 80%
    expect(rows[0]).toContain('₹ 2,360.00'); // the MSME's share with GST
    expect(rows[1]).toContain('with joining reward ₹ 1,000');
    expect(rows[3]).toContain('80% base + 10% additional');
    const tds = [...el.querySelectorAll('section[aria-labelledby="fs-tds"] tbody tr')][0].textContent!.replace(/\s+/g, ' ');
    expect(tds).toContain('₹ 40.00'); // 194C on 2,000
    expect(tds).toContain('₹ 2,160.00');
    // The joining reward row takes the subsidy of its category: no Edit of its own.
    expect([...el.querySelectorAll('section[aria-labelledby="fs-structure"] tbody tr')].map((r) => !!r.querySelector('button'))).toEqual([true, false, true, true]);
  });

  it('shows a card per level with its fee, General subsidy and what the MSME pays', () => {
    const card = (code: string) => (el.querySelector(`button[data-level="${code}"]`) as HTMLButtonElement).textContent!.replace(/\s+/g, ' ');
    expect(el.querySelectorAll('nav[aria-label="Certification level"] button').length).toBe(4);
    expect(el.querySelector('button[data-level="Bronze"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(card('Bronze')).toContain('₹ 10,000');
    expect(card('Bronze')).toContain('80%');
    expect(card('Bronze')).toContain('₹ 2,360.00');
    expect(card('Bronze')).toContain('Joining reward ₹ 1,000');
    expect(card('Silver')).toContain('₹ 4,720.00');
    expect(card('Silver')).not.toContain('Joining reward');
    expect(card('ZEDX')).toContain('ZED-X');
    expect(card('ZEDX')).toContain('No fee set for Micro');
  });

  it('saves the fee and joining reward of the level shown', async () => {
    expect(button('Save Fee').disabled).toBe(true);
    await typeIn('#fs-fee', '12000');
    expect(el.textContent).toContain('Not saved yet.');
    button('Save Fee').click();
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === '/api/staff/fees/Micro');
    expect(put.request.body).toEqual({ levels: [{ certification: 'Bronze', assessmentFee: 12000, coupon: 1000 }] });
    put.flush({ message: 'Data updated.' });
    await settle();
    http.expectOne('/api/staff/fees/Micro').flush(micro);
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('Data updated.');
  });

  it('switches level: the same structure with its own fee and no joining reward when it has none', async () => {
    (el.querySelector('button[data-level="Silver"]') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('h3')!.textContent).toContain('Fee Structure — Silver');
    expect((el.querySelector('#fs-fee') as HTMLInputElement).value).toBe('20000');
    expect(el.querySelector('#fs-reward')).toBeNull();
    expect(structure().length).toBe(1);
    expect(el.querySelector('button[data-level="Silver"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('edits the additional share of a category for every level', async () => {
    (el.querySelector('[aria-label="Edit the subsidy of Woman-owned MSME"]') as HTMLButtonElement).click();
    await settle();
    const dialog = el.querySelector('[role=dialog]')!;
    expect(dialog.textContent).toContain('WOM · subsidy share');
    expect((dialog.querySelector('#fs-base') as HTMLInputElement).disabled).toBe(true);
    expect((dialog.querySelector('#fs-base') as HTMLInputElement).value).toBe('80');
    await typeIn('#fs-additional', '15');
    expect((dialog.querySelector('#fs-total') as HTMLInputElement).value).toBe('95%');
    expect(dialog.textContent).toContain('The MSME pays the remaining 5%');
    // The preview on the Bronze fee of 10,000 at 95%.
    const preview = [...dialog.querySelectorAll('aside[aria-label="Preview"] dt')].map((dt) => `${dt.textContent!.trim()}: ${dt.nextElementSibling!.textContent!.trim()}`);
    expect(preview).toContain('GoI share: ₹ 9,500.00');
    expect(preview).toContain('MSME share: ₹ 590.00');
    expect(preview).toContain('Net after 194C: ₹ 580.00');
    expect(preview).toContain('Net after 194J: ₹ 540.00');
    button('Save Share', dialog).click();
    await settle();
    const put = http.expectOne((r) => r.url === '/api/staff/fees/Micro/subsidy');
    expect(put.request.body).toEqual({ certification: 'Bronze', category: 2, allLevels: true, baseShare: null, additionalShare: 15 });
    put.flush({ message: 'Subsidy share updated.' });
    await settle();
    http.expectOne('/api/staff/fees/Micro').flush(micro);
    await settle();
    expect(el.querySelector('[role=dialog]')).toBeNull();
    expect(el.querySelector('.alert-success')!.textContent).toContain('Subsidy share updated.');
  });

  it('edits the base share on General for this level only and shows a refusal', async () => {
    (el.querySelector('[aria-label="Edit the subsidy of General"]') as HTMLButtonElement).click();
    await settle();
    const dialog = el.querySelector('[role=dialog]')!;
    expect((dialog.querySelector('#fs-additional') as HTMLInputElement).disabled).toBe(true);
    await typeIn('#fs-base', '95');
    (dialog.querySelector('#fs-all') as HTMLInputElement).click();
    await settle();
    button('Save Share', dialog).click();
    await settle();
    const put = http.expectOne((r) => r.url === '/api/staff/fees/Micro/subsidy');
    expect(put.request.body).toEqual({ certification: 'Bronze', category: 0, allLevels: false, baseShare: 95, additionalShare: null });
    put.flush({ title: 'The Bronze subsidy of category 2 would be 105%: it must be between 0 and 100.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('would be 105%');
    expect(el.querySelector('[role=dialog]')).not.toBeNull();
  });

  it('warns in the preview when the total share is over 100%', async () => {
    (el.querySelector('[aria-label="Edit the subsidy of Woman-owned MSME"]') as HTMLButtonElement).click();
    await settle();
    await typeIn('#fs-additional', '25');
    const preview = el.querySelector('aside[aria-label="Preview"]')!;
    expect(preview.textContent).toContain('must be between 0 and 100%');
    expect(preview.querySelector('dl')).toBeNull();
  });

  it('shows Rejected units without subsidy edits', async () => {
    button('Rejected', el.querySelector('[role=group][aria-label="Enterprise type"]')!).click();
    await settle();
    http.expectOne('/api/staff/fees/Rejected').flush({
      enterpriseType: 'Rejected', levels: [{ certification: 'Bronze', assessmentFee: 10000, coupon: null, hasCouponRows: false }],
      rows: [{ ...row(9, 'Bronze', 0, 0, 10000), enterpriseTypee: 'Rejected' }],
    });
    await settle();
    expect(el.textContent).toContain('no subsidy and no joining reward');
    expect(el.querySelector('section[aria-labelledby="fs-structure"] tbody button')).toBeNull();
    expect(button('Rejected').getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('button[data-level="Bronze"]')!.textContent).not.toContain('Joining reward');
  });

  it('offers Add fees for a level without fees and sends the fee, reward, shares and the other types', async () => {
    (el.querySelector('button[data-level="ZEDX"]') as HTMLButtonElement).click();
    await settle();
    const add = el.querySelector('section[aria-labelledby="fs-add"]')!;
    expect(add.textContent).toContain('No fees are set for Micro ZED-X');
    expect(add.textContent).toContain('Creates 18 rows for Micro ZED-X');
    expect([...add.querySelectorAll('label')].map((l) => l.textContent!.trim())).toContain('Additional subsidy, WOM (%)');

    button('Add Fees', add).click();
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Please enter the fee and the General subsidy.');

    await typeIn('#fs-add-fee', '50000');
    await typeIn('#fs-add-reward', '5000');
    await typeIn('#fs-add-general', '80');
    await typeIn('#fs-add-cat-2', '10');
    button('Add Fees', el.querySelector('section[aria-labelledby="fs-add"]')!).click();
    await settle();
    const req = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/fees/Micro/add');
    expect(req.request.body).toEqual({
      certification: 'ZEDX', assessmentFee: 50000, reward: 5000, generalShare: 80, additionalShares: { 2: 10 }, alsoTypes: ['Small', 'Medium'],
    });
    req.flush({ message: 'Fees added for Micro, Small, Medium ZED-X.' });
    await settle();
    http.expectOne('/api/staff/fees/Micro').flush(micro);
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('Fees added');
  });
});

describe('FeeStructurePage on Consultancy', () => {
  let fixture: ComponentFixture<FeeStructurePage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const milestone = (r: FeeRow, m: string): FeeRow => ({ ...r, mileStone: m });
  const handholding: FeesResponse = {
    enterpriseType: 'Micro', groupBy: 'MileStone',
    levels: [{ certification: '1', assessmentFee: 150000, coupon: 1000, hasCouponRows: true }],
    rows: [
      milestone(row(11, 'Silver', 0, 90, 150000), '1'), milestone(row(12, 'Silver', 1, 95, 150000), '1'),
      milestone(row(13, 'Gold', 0, 90, 150000), '1'), milestone(row(14, 'Silver', 0, 90, 150000, 1000), '1'),
    ],
  };

  beforeEach(async () => {
    sessionStorage.setItem('zed.adminPortal', 'consultancy');
    await TestBed.configureTestingModule({ imports: [FeeStructurePage], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(FeeStructurePage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne('/api/staff/fees/Micro').flush(handholding);
    await settle();
  });

  afterEach(() => {
    http.verify();
    sessionStorage.clear();
  });

  it('shows a card per milestone and the Silver and Gold rows of the milestone with their level', () => {
    expect(el.querySelector('h3')!.textContent).toContain('Handholding Fee — Milestone 1');
    expect(el.querySelector('button[data-level="2"]')!.textContent).toContain('No fee set for Micro');
    const levels = [...el.querySelectorAll('section[aria-labelledby="fs-structure"] td.fs-level')].map((c) => c.textContent!.trim());
    expect(levels).toEqual(['Silver', 'Silver', 'Silver', 'Gold']);
    expect([...el.querySelectorAll('section[aria-labelledby="fs-structure"] td.fs-code')].map((c) => c.textContent!.trim())).toEqual(['GEN', 'GEN', 'SC', 'GEN']);
    // The milestone fee only: its joining reward stays as stored.
    expect(el.querySelector('#fs-reward')).toBeNull();
  });

  it('saves the milestone fee without the reward and edits the share for every milestone', async () => {
    const fee = el.querySelector('#fs-fee') as HTMLInputElement;
    fee.value = '160000';
    fee.dispatchEvent(new Event('input'));
    await settle();
    ([...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Save Fee') as HTMLButtonElement).click();
    await settle();
    const save = http.expectOne((r) => r.method === 'PUT' && r.url === '/api/staff/fees/Micro');
    expect(save.request.body).toEqual({ levels: [{ certification: '1', assessmentFee: 160000, coupon: null }] });
    save.flush({ message: 'Data updated.' });
    await settle();
    http.expectOne('/api/staff/fees/Micro').flush(handholding);
    await settle();

    (el.querySelector('section[aria-labelledby="fs-structure"] tbody button') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('.modal')!.textContent).toContain('Apply to all three milestones');
  });
});
