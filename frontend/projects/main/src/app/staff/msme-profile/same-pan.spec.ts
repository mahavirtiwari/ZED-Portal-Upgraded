import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SamePanUnits } from './same-pan';

describe('SamePanUnits (2026-11-17)', () => {
  beforeEach(async () => {
    sessionStorage.clear();
    await TestBed.configureTestingModule({ imports: [SamePanUnits], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
  });

  async function render(answer: object) {
    const fixture = TestBed.createComponent(SamePanUnits);
    fixture.componentRef.setInput('zedId', 'ZEDM000457');
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne('/api/staff/msme-profile/ZEDM000457/same-pan').flush(answer);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return Object.assign(el, { refresh: () => fixture.detectChanges() });
  }

  const answer = {
    pan: 'ABXXXXXX4F',
    this: { zedId: 'ZEDM•••457', unitName: 'Acme Unit 2', address: 'Plot 4, Industrial Area, Kanpur 208001' },
    others: [
      { zedId: 'ZEDM•••102', unitName: 'Acme Unit 1', address: 'Plot-4, Industrial Area, Kanpur 208001' },
      { zedId: 'ZEDS•••311', unitName: 'Acme Services', address: '12 MG Road, Lucknow 226001' },
    ],
  };

  it('warns and opens the list by itself the first time, with masked ZED IDs and full names and addresses', async () => {
    const el = await render(answer);
    expect(el.querySelector('[data-same-pan]')!.textContent).toContain('2 other ZED units are registered with PAN ABXXXXXX4F');
    const rows = [...el.querySelectorAll('[data-same-pan-list] tbody tr')].map((r) => [...r.children].map((c) => c.textContent!.trim()));
    expect(rows).toEqual([
      ['ZEDM•••102', 'Acme Unit 1', 'Plot-4, Industrial Area, Kanpur 208001'],
      ['ZEDS•••311', 'Acme Services', '12 MG Road, Lucknow 226001'],
    ]);
  });

  it('does not open by itself again in the session; View units opens it', async () => {
    sessionStorage.setItem('zed.samePan.ZEDM000457', '1');
    const el = await render(answer);
    expect(el.querySelector('[data-same-pan-list]')).toBeNull();
    (el.querySelector('[data-same-pan] button') as HTMLButtonElement).click();
    el.refresh();
    expect(el.querySelectorAll('[data-same-pan-list] tbody tr').length).toBe(2);
  });

  it('shows nothing when the PAN has no other unit', async () => {
    const el = await render({ pan: 'ABXXXXXX4F', this: null, others: [] });
    expect(el.querySelector('[data-same-pan]')).toBeNull();
  });
});
