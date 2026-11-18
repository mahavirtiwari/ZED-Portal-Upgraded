import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PoView } from './expenditure.api';
import { PoCard } from './po-card';

const view = (canEdit = true): PoView => ({
  partyId: 'ZEDAA0080', partyName: 'Mahavir Agency', canEdit,
  levelOptions: [{ code: 'Bronze', name: 'Bronze' }, { code: 'Silver', name: 'Silver' }, { code: 'Gold', name: 'Gold' }],
  levels: [
    { level: 'Bronze', name: 'Bronze', cases: 500, used: 312, inProgress: 0, left: 188, percent: 62, state: 'Open', pos: [{ id: 1, poNumber: 'QCI/ZED/PO/2026/114', poDate: '2026-04-02', cases: 500 }] },
    { level: 'Silver', name: 'Silver', cases: 120, used: 106, inProgress: 5, left: 9, percent: 92, state: 'Low', pos: [{ id: 2, poNumber: 'QCI/ZED/PO/2026/115', poDate: '2026-04-02', cases: 120 }] },
    { level: 'Gold', name: 'Gold', cases: 40, used: 40, inProgress: 0, left: 0, percent: 100, state: 'Stopped', pos: [{ id: 3, poNumber: 'QCI/ZED/PO/2026/116', poDate: '2026-04-02', cases: 40 }] },
  ],
});

describe('PoCard', () => {
  let fixture: ComponentFixture<PoCard>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const button = (label: string, root: ParentNode = el) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent!.trim() === label) as HTMLButtonElement | undefined;

  async function create(v: PoView) {
    await TestBed.configureTestingModule({ imports: [PoCard], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(PoCard);
    fixture.componentRef.setInput('partyId', 'ZEDAA0080');
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne((r) => r.url === '/api/staff/expenditure/po' && r.params.get('partyId') === 'ZEDAA0080').flush(v);
    await settle();
  }

  afterEach(() => http.verify());

  it('shows each level with its use bar and allotment pill', async () => {
    await create(view());
    const rows = [...el.querySelectorAll('tbody tr')];
    expect(rows.map((r) => r.querySelector('.status-badge')!.textContent!.trim())).toEqual(['Open', '9 left', 'Stopped']);
    expect(rows[2].querySelector('.bar i')!.classList).toContain('stop');
    expect(rows[1].querySelector('.bar i')!.classList).toContain('low');
    expect(button('Reopen', rows[2])).toBeTruthy();
    expect(button('Reopen', rows[0])).toBeUndefined();
  });

  it('reopens a used-up PO with a reason and extra cases', async () => {
    await create(view());
    button('Reopen', el.querySelectorAll('tbody tr')[2])!.click();
    await settle();
    const form = el.querySelector('form')!;
    const reason = form.querySelector('textarea[name="reason"]') as HTMLTextAreaElement;
    reason.value = 'More units in Gujarat';
    reason.dispatchEvent(new Event('input'));
    const extra = form.querySelector('input[name="extra"]') as HTMLInputElement;
    extra.value = '20';
    extra.dispatchEvent(new Event('input'));
    await settle();
    form.dispatchEvent(new Event('submit'));
    await settle();
    const req = http.expectOne({ method: 'POST', url: '/api/staff/expenditure/po/reopen' });
    expect(req.request.body).toEqual({ partyId: 'ZEDAA0080', level: 'Gold', reason: 'More units in Gujarat', extraCases: 20 });
    req.flush({ message: 'Reopened.' });
    await settle();
    http.expectOne((r) => r.url === '/api/staff/expenditure/po').flush(view());
    await settle();
    expect(el.querySelector('form')).toBeNull();
  });

  it('is read-only for the Admin', async () => {
    await create(view(false));
    expect(button('+ Add PO')).toBeUndefined();
    expect(button('Edit')).toBeUndefined();
    expect(button('History')).toBeTruthy();
  });
});
