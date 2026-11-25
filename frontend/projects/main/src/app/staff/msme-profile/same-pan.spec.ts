import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SamePanCount, SamePanUnits } from './same-pan';

describe('SamePanUnits (2026-11-17)', () => {
  beforeEach(async () => {
    sessionStorage.clear();
    await TestBed.configureTestingModule({ imports: [SamePanUnits, SamePanCount], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
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
    // 2026-11-22 (the product owner): the History-style side panel instead of the pop-up: this unit first, then the others.
    const drawer = el.querySelector('[data-drawer="same-pan-drawer"]')!;
    expect(drawer.querySelector('h3')!.textContent).toContain('Units with the same PAN');
    expect(drawer.textContent).toContain('PAN ABCDE1234F');
    const rows = [...drawer.querySelectorAll('[data-same-pan-list] li')].map((li) => [li.querySelector('b')!.textContent!.trim(), li.querySelector('.spd-addr')!.textContent!.trim()]);
    expect(rows).toEqual([
      ['Acme Unit 2', 'Plot 4, Industrial Area, Panki, Kanpur, Kanpur Nagar, UTTAR PRADESH 208001'],
      ['Acme Unit 1', 'Plot-4, Industrial Area, Panki, Kanpur, Kanpur Nagar, UTTAR PRADESH 208001'],
      ['Acme Services', '12 MG Road, Lucknow, UTTAR PRADESH 226001'],
    ]);
    // An agency / assessor answer has no ZED ID or status: none shown.
    expect(drawer.querySelector('[data-same-pan-meta]')).toBeNull();
    expect(el.textContent).not.toContain('ZED ID');
    expect(el.textContent).not.toMatch(/ZED[MS]/);
  });

  it('does not open by itself again in the session; View units opens it', async () => {
    sessionStorage.setItem('zed.samePan.ZEDM000457', '1');
    const el = await render(answer);
    expect(el.querySelector('[data-same-pan-list]')).toBeNull();
    (el.querySelector('[data-same-pan] button') as HTMLButtonElement).click();
    el.refresh();
    expect(el.querySelectorAll('[data-same-pan-list] li').length).toBe(3);
  });

  it('shows the Master Admin the ZED IDs, current statuses and the duplicate', async () => {
    const el = await render({
      pan: 'ABCDE1234F',
      this: { unitName: 'Acme Unit 2', address: 'Plot 4', zedId: 'ZEDM000457', status: 'Silver · Site assessment quality check', duplicate: false },
      others: [
        { unitName: 'Acme Unit 1', address: 'Plot 4', zedId: 'ZEDM000458', status: 'Silver · Certified', duplicate: true },
        { unitName: 'Acme Services', address: '12 MG Road', zedId: 'ZEDM000460', status: 'Registered', duplicate: false },
      ],
    });
    const drawer = el.querySelector('[data-drawer="same-pan-drawer"]')!;
    expect([...drawer.querySelectorAll('[data-same-pan-meta]')].map((m) => [...m.querySelectorAll('span')].map((x) => x.textContent!.trim())))
      .toEqual([['ZEDM000458', 'Silver · Certified'], ['ZEDM000460', 'Registered']]);
    // This unit's own ZED ID and status, at the top.
    expect(drawer.querySelector('.spd-this .spd-meta')!.textContent).toContain('ZEDM000457');
    expect(drawer.querySelector('[data-duplicate="yes"] b')!.textContent).toBe('Acme Unit 1');
    expect(drawer.textContent).toContain('1 unit has the same Udyam registration and plant address: a duplicate.');
  });

  it('shows the count of a list as a link that opens the side panel, asking for the units only then', async () => {
    const fixture = TestBed.createComponent(SamePanCount);
    fixture.componentRef.setInput('zedId', 'ZEDM000457');
    fixture.componentRef.setInput('count', 2);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectNone('/api/staff/msme-profile/ZEDM000457/same-pan');
    const el = fixture.nativeElement as HTMLElement;
    const link = el.querySelector<HTMLButtonElement>('button[data-same-pan-count]')!;
    expect(link.textContent!.trim()).toBe('2');
    link.click();
    fixture.detectChanges();
    http.expectOne('/api/staff/msme-profile/ZEDM000457/same-pan').flush(answer);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-drawer="same-pan-drawer"] [data-same-pan-list] li').length).toBe(3);
    // No other unit: a plain 0, nothing to open.
    fixture.componentRef.setInput('count', 0);
    fixture.detectChanges();
    expect(el.querySelector('button[data-same-pan-count]')).toBeNull();
  });

  // 2026-11-26 (zedv3, Monitoring): the call failed and the panel closed by itself, so the click seemed to do nothing.
  it('keeps the side panel open with a message when the units cannot be loaded', async () => {
    const fixture = TestBed.createComponent(SamePanCount);
    fixture.componentRef.setInput('zedId', 'ZEDM000005');
    fixture.componentRef.setInput('count', 2);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('button[data-same-pan-count]')!.click();
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne('/api/staff/msme-profile/ZEDM000005/same-pan')
      .flush({ title: 'An error occurred' }, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
    const drawer = el.querySelector('[data-drawer="same-pan-drawer"]')!;
    expect(drawer).not.toBeNull();
    expect(drawer.querySelector('[role="alert"]')!.textContent).toContain('could not be loaded');
    expect(el.querySelector('button[data-same-pan-count]')!.textContent!.trim()).toBe('2');
  });

  it('shows nothing when the PAN has no other unit', async () => {
    const el = await render({ pan: 'ABCDE1234F', this: null, others: [] });
    expect(el.querySelector('[data-same-pan]')).toBeNull();
  });
});
