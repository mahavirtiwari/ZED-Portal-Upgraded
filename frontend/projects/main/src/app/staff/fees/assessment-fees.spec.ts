import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AssessmentFeesPage } from './assessment-fees';
import { FeeRow, FeesResponse } from './fees.api';

async function settle(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

function row(id: number, certification: string, fee: number, coupon: number | null, contribution: number): FeeRow {
  return {
    id, enterpriseTypee: 'Micro', certification, specialCategory: 0, isActive: true, subsidyPercentage: 80,
    assessmentFee: fee, gst: fee * 0.18, total: fee * 1.18, coupon, assessmentFeeAfterCoupon: null, gstAfterCoupon: null, totalAfterCoupon: null,
    subsidyPer: fee * 0.2, gstAfterSubsidy: fee * 0.036, applicantContributionAfterSubsidy: contribution, tds15: 0, tds75: 0,
    netPaybleTds15: 0, netPaybleTds75: 0, isCouponRow: coupon !== null,
  };
}

const micro: FeesResponse = {
  enterpriseType: 'Micro',
  levels: [
    { certification: 'Bronze', assessmentFee: 10000, coupon: 1000, hasCouponRows: true },
    { certification: 'Silver', assessmentFee: 20000, coupon: null, hasCouponRows: false },
  ],
  rows: [row(1, 'Bronze', 10000, null, 2360), row(3, 'Bronze', 10000, 1000, 2100), row(2, 'Silver', 20000, null, 4720)],
};

describe('AssessmentFeesPage', () => {
  let fixture: ComponentFixture<AssessmentFeesPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AssessmentFeesPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(AssessmentFeesPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle(fixture);
    http.expectOne('/api/staff/fees/Micro').flush(micro);
    await settle(fixture);
  });

  afterEach(() => http.verify());

  function setInput(id: string, value: string) {
    const input = el.querySelector(id) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
  }

  it('shows the rows and the level inputs, coupon only where coupon rows exist', () => {
    expect(el.querySelectorAll('table.fees tbody tr').length).toBe(3);
    expect(el.querySelector('table.fees tbody')!.textContent).toContain('2,360.00');
    expect(el.querySelector('table.fees tbody')!.textContent).toContain('with coupon');
    expect((el.querySelector('#fee-Bronze') as HTMLInputElement).value).toBe('10000');
    expect(el.querySelector('#coupon-Bronze')).not.toBeNull();
    expect(el.querySelector('#coupon-Silver')).toBeNull();
  });

  it('previews server-computed amounts and saves only fee and coupon', async () => {
    setInput('#fee-Bronze', '12000');
    await settle(fixture);
    const preview = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/fees/Micro/preview');
    expect(preview.request.body).toEqual({
      levels: [
        { certification: 'Bronze', assessmentFee: 12000, coupon: 1000 },
        { certification: 'Silver', assessmentFee: 20000, coupon: null },
      ],
    });
    preview.flush({ ...micro, rows: [row(1, 'Bronze', 12000, null, 2832), micro.rows[1], micro.rows[2]] });
    await settle(fixture);
    expect(el.textContent).toContain('2,832.00');
    expect(el.querySelector('.alert-warning')).not.toBeNull();

    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === '/api/staff/fees/Micro');
    expect(Object.keys(put.request.body.levels[0]).sort()).toEqual(['assessmentFee', 'certification', 'coupon']);
    put.flush({ message: 'Data updated.' });
    await settle(fixture);
    http.expectOne('/api/staff/fees/Micro').flush(micro);
    await settle(fixture);
    expect(el.querySelector('.alert-success')!.textContent).toContain('Data updated.');
  });

  it('shows the server message for invalid amounts and reloads on type change', async () => {
    setInput('#coupon-Bronze', '99999');
    await settle(fixture);
    http.expectOne('/api/staff/fees/Micro/preview').flush({ title: 'The Bronze coupon cannot be more than the total fee with GST.' }, { status: 400, statusText: 'Bad Request' });
    await settle(fixture);
    expect(el.querySelector('.alert-danger')!.textContent).toContain('cannot be more than the total');

    const select = el.querySelector('#msmeType') as HTMLSelectElement;
    select.value = 'Rejected';
    select.dispatchEvent(new Event('change'));
    await settle(fixture);
    http.expectOne('/api/staff/fees/Rejected').flush({
      enterpriseType: 'Rejected', levels: [{ certification: 'Bronze', assessmentFee: 5000, coupon: null, hasCouponRows: false }], rows: [row(9, 'Bronze', 5000, null, 5900)],
    });
    await settle(fixture);
    expect(el.querySelector('#coupon-Bronze')).toBeNull();
  });
});
