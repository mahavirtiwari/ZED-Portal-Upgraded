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
    pan: 'ABCDE1234F',
    this: { unitName: 'Acme Unit 2', address: 'Plot 4, Industrial Area, Panki, Kanpur, Kanpur Nagar, UTTAR PRADESH 208001' },
    others: [
      { unitName: 'Acme Unit 1', address: 'Plot-4, Industrial Area, Panki, Kanpur, Kanpur Nagar, UTTAR PRADESH 208001' },
      { unitName: 'Acme Services', address: '12 MG Road, Lucknow, UTTAR PRADESH 226001' },
    ],
  };

  it('warns and opens the list by itself the first time, with the full PAN, the unit names and complete addresses and no ZED IDs', async () => {
    const el = await render(answer);
    // 2026-11-18 (the user): the PAN in full; "ZED ID is not required to show"; "Please show the complete address".
    const strip = el.querySelector('[data-same-pan]')!;
    expect(strip.textContent).toContain('2 other ZED units are registered with PAN ABCDE1234F');
    expect(strip.textContent).not.toContain('•');
    expect([...strip.querySelectorAll('.sp-list li')].map((li) => [...li.children].map((c) => c.textContent!.trim()))).toEqual([
      ['Acme Unit 1', 'Plot-4, Industrial Area, Panki, Kanpur, Kanpur Nagar, UTTAR PRADESH 208001'],
      ['Acme Services', '12 MG Road, Lucknow, UTTAR PRADESH 226001'],
    ]);
    expect(el.querySelector('.sp-intro')!.textContent).toContain('ABCDE1234F');
    expect([...el.querySelectorAll('[data-same-pan-list] th')].map((th) => th.textContent!.trim())).toEqual(['Unit name', 'Complete address']);
    const rows = [...el.querySelectorAll('[data-same-pan-list] tbody tr')].map((r) => [...r.children].map((c) => c.textContent!.trim()));
    expect(rows).toEqual([
      ['Acme Unit 1', 'Plot-4, Industrial Area, Panki, Kanpur, Kanpur Nagar, UTTAR PRADESH 208001'],
      ['Acme Services', '12 MG Road, Lucknow, UTTAR PRADESH 226001'],
    ]);
    expect(el.textContent).not.toContain('ZED ID');
    expect(el.textContent).not.toMatch(/ZED[MS]/);
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
    const el = await render({ pan: 'ABCDE1234F', this: null, others: [] });
    expect(el.querySelector('[data-same-pan]')).toBeNull();
  });
});
