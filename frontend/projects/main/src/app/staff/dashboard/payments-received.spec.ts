import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PaymentsReceivedPage, masked } from './payments-received';
import { TableExport } from '../table-export';

describe('PaymentsReceivedPage (2026-11-17 redesign)', () => {
  let fixture: ComponentFixture<PaymentsReceivedPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  const rows = [
    { RowNumber: 1, ZedId: 'ZEDM000005', Certification: 'Bronze', PUnitName: 'Pump Engineers', EnterpriseTypee: 'Micro', Gender: 'Male', IsCouponUsed: 1,
      PStateName: 'Delhi', PDistrictName: 'East', Tds: 0, SubsidyPercentage: 80, GstinNumber: null, TanNumber: null, FinalAmountPaid: 0, PaymentType: 'ZeroAmount' },
    { RowNumber: 2, ZedId: 'ZEDM000008', Certification: 'Gold', PUnitName: 'Lakshmi Auto', EnterpriseTypee: 'Medium', Gender: 'Male', IsCouponUsed: 0,
      PStateName: 'Tamil Nadu', PDistrictName: 'Chennai', Tds: 10, SubsidyPercentage: 50, GstinNumber: '33AACCL1234F1Z2', TanNumber: 'CHEL01234A',
      FinalAmountPaid: 120000, PaymentType: 'PaymentGateway' },
  ];

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PaymentsReceivedPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(PaymentsReceivedPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne((r) => r.url === '/api/staff/dashboard/payments-received').flush(rows);
    await settle();
  });

  afterEach(() => http.verify());

  const tiles = () => [...el.querySelectorAll('.pr-tile')].map((t) => t.textContent!.replace(/\s+/g, ' ').trim());

  it('shows the four totals of the loaded list, the merged unit column, masked tax numbers and the payment type', () => {
    expect(tiles()).toEqual(['₹ 1,20,000 Amount received', '2 Payments', '1 With TDS deducted', '1 Used Joining Reward']);
    const first = el.querySelectorAll('tbody tr')[0];
    expect(first.querySelector('.unit-cell')!.textContent).toContain('Pump Engineers');
    expect(first.querySelector('.unit-cell')!.textContent).toContain('ZEDM000005');
    expect(first.textContent).toContain('Zero amount');
    expect(first.textContent).toContain('Not given');
    const second = el.querySelectorAll('tbody tr')[1];
    expect(second.textContent).toContain('33AAC•••1Z2');
    expect(second.textContent).toContain('CHEL•••4A');
    expect(second.textContent).not.toContain('33AACCL1234F1Z2');
    expect(second.textContent).toContain('₹ 1,20,000');
    expect(second.textContent).toContain('10%');
    expect(el.querySelector('thead')!.textContent).not.toContain('Paid on');
  });

  it('totals follow the search box', async () => {
    const search = el.querySelector('#pr-search') as HTMLInputElement;
    search.value = 'Lakshmi';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(tiles()[0]).toBe('₹ 1,20,000 Amount received');
    expect(tiles()[1]).toBe('1 Payments');
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('exports the rows shown with the full GSTIN and TAN', async () => {
    const xlsx = vi.spyOn(TestBed.inject(TableExport), 'xlsx').mockResolvedValue();
    const button = [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Export')!;
    button.click();
    await settle();
    const [name, sheets] = xlsx.mock.calls.at(-1)!;
    expect(name).toBe('payments-received');
    expect(sheets[0].rows.length).toBe(2);
    expect(sheets[0].rows[1]).toContain('33AACCL1234F1Z2');
    expect(sheets[0].rows[0]).toContain('Zero amount');
  });

  it('masks short and long numbers', () => {
    expect(masked('27AABCU9603R1Z5')).toBe('27AAB•••1Z5');
    expect(masked('DELA12345B')).toBe('DELA•••5B');
    expect(masked('')).toBe('');
  });
});
