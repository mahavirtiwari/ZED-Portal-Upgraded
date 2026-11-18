import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RatesResponse } from '../expenditure/expenditure.api';
import { ExpenditureRatesPage } from './expenditure-rates';

const rates = (locked = false): RatesResponse => ({
  gstPercent: 18,
  today: '2026-11-18',
  agencyLevels: [{ level: 'Bronze', name: 'Bronze', flow: 'Desktop only' }, { level: 'Silver', name: 'Silver', flow: 'Desktop + Onsite' }],
  consultantLevels: [{ level: 'Silver', name: 'Silver', milestones: 3 }, { level: 'ZEDX', name: 'ZED-X', milestones: 2 }],
  sets: [
    { kind: 'Agency', effectiveFrom: '2026-11-01', gstPercent: 18, inForce: true, locked, savedBy: 'Admin', savedOn: '2026-11-01T10:00:00',
      levels: [{ level: 'Bronze', completed: 3000, rejected: 1500, surveillance: 2000, milestones: [] }] },
  ],
});

describe('ExpenditureRatesPage', () => {
  let fixture: ComponentFixture<ExpenditureRatesPage>;
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

  async function create(r: RatesResponse) {
    await TestBed.configureTestingModule({ imports: [ExpenditureRatesPage], providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] }).compileComponents();
    fixture = TestBed.createComponent(ExpenditureRatesPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne('/api/staff/expenditure-rates').flush(r);
    await settle();
    await settle();
  }

  afterEach(() => http.verify());

  it("shows the set in force, the flows and a milestone column per level's milestones", async () => {
    await create(rates());
    const cards = el.querySelectorAll('.xr-card');
    expect(cards[0].textContent).toContain('Desktop only');
    expect((cards[0].querySelector('input[aria-label="Bronze completed"]') as HTMLInputElement).value).toBe('3000');
    // ZED-X has two milestones: its third column is "not used".
    expect(cards[1].querySelectorAll('input[aria-label^="ZED-X milestone"]').length).toBe(2);
    expect(cards[1].textContent).toContain('not used');
  });

  it('adds a new rate set with its date of effect', async () => {
    await create(rates());
    const card = el.querySelectorAll('.xr-card')[0];
    const select = card.querySelector('select') as HTMLSelectElement;
    select.value = select.options[select.options.length - 1].value;
    select.dispatchEvent(new Event('change'));
    await settle();
    const date = card.querySelector('input[type="date"]') as HTMLInputElement;
    date.value = '2026-12-01';
    date.dispatchEvent(new Event('input'));
    const completed = card.querySelector('input[aria-label="Bronze completed"]') as HTMLInputElement;
    completed.value = '3500';
    completed.dispatchEvent(new Event('input'));
    await settle();
    button('Add rate set', card)!.click();
    await settle();
    const req = http.expectOne({ method: 'PUT', url: '/api/staff/expenditure-rates' });
    expect(req.request.body.kind).toBe('Agency');
    expect(req.request.body.effectiveFrom).toBe('2026-12-01');
    expect(req.request.body.edit).toBe(false);
    expect(req.request.body.levels[0]).toEqual({ level: 'Bronze', completed: 3500, rejected: 1500, surveillance: 2000 });
    req.flush({ message: 'Rate set from 01-12-2026 added.' });
    await settle();
    http.expectOne('/api/staff/expenditure-rates').flush(rates());
    await settle();
  });

  it('keeps a set read-only once an approved invoice priced cases with it', async () => {
    await create(rates(true));
    const card = el.querySelectorAll('.xr-card')[0];
    expect((card.querySelector('input[aria-label="Bronze completed"]') as HTMLInputElement).disabled).toBe(true);
    expect(button('Save rates', card)!.disabled).toBe(true);
    expect(card.textContent).toContain('Read-only');
  });
});
