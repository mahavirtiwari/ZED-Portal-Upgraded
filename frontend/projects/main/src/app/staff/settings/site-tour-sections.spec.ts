import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SiteTourSection, SiteTourSectionsPage, SiteTourSectionsResponse, sectionId } from './site-tour-sections';

describe('SiteTourSectionsPage', () => {
  let fixture: ComponentFixture<SiteTourSectionsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  const url = '/api/staff/settings/site-tour-sections';

  const section = (id: string, title: string, more: Partial<SiteTourSection> = {}): SiteTourSection => ({
    id, title, hint: null, min: 1, max: 2, levels: [], nicSectors: [], active: true, ...more,
  });
  const sections = (): SiteTourSection[] => [
    section('entrance', 'Unit Entrance & Signage', { hint: 'Gate, unit name board, premises' }),
    section('production', 'Production / Machine Shop', { min: 3, max: 5, levels: ['ZEDX'], nicSectors: ['24'] }),
    section('utilities', 'Utilities', { min: 2, max: 3, active: false }),
  ];
  const response = (more: Partial<SiteTourSectionsResponse> = {}): SiteTourSectionsResponse => ({
    sections: sections(),
    levels: [{ code: 'Silver', name: 'Silver' }, { code: 'Gold', name: 'Gold' }, { code: 'ZEDX', name: 'ZED-X' }],
    customised: false,
    ...more,
  });

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const rows = () => [...el.querySelectorAll('tbody tr')].map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
  const row = (id: string) => el.querySelector(`tr[data-id="${id}"]`) as HTMLElement;
  const dialog = () => el.querySelector('[role=dialog]') as HTMLElement;
  const button = (text: string, root: ParentNode = el) =>
    [...root.querySelectorAll('button, input[type=button]')].find((b) => (b.textContent || (b as HTMLInputElement).value).trim() === text) as HTMLButtonElement;
  const type = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };
  const field = (id: string) => dialog().querySelector(`#${id}`) as HTMLInputElement;
  const pick = (label: string) =>
    ([...dialog().querySelectorAll('zed-multi-select label')].find((l) => l.textContent!.trim() === label)!.querySelector('input') as HTMLInputElement).click();

  async function reloaded(message: string, next = response({ customised: true })) {
    await settle();
    http.expectOne((r) => r.method === 'GET' && r.url === url).flush(next);
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain(message);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SiteTourSectionsPage], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(SiteTourSectionsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne(url).flush(response());
    http.expectOne('/api/staff/masters/sectors').flush([{ id: 1, code: '24', name: 'Basic metals' }, { id: 2, code: '62', name: 'IT services' }]);
    await settle();
  });

  afterEach(() => http.verify());

  it('lists the sections in order with their photos, scope and status', () => {
    expect(el.querySelector('h3')!.textContent).toContain('Site tour sections');
    const r = rows();
    expect(r.length).toBe(3);
    expect(r[0]).toContain('Unit Entrance & Signage');
    expect(r[0]).toContain('Gate, unit name board, premises');
    expect(r[0]).toContain('All levels · All sectors');
    expect([...row('production').querySelectorAll('.num')].map((x) => x.textContent!.trim())).toEqual(['3', '5']);
    expect([...row('production').querySelectorAll('.zed-chip')].map((x) => x.textContent!.trim())).toEqual(['ZED-X', 'NIC 24']);
    expect(row('utilities').querySelector('.status-badge')!.textContent!.trim()).toBe('Off');
    expect(row('entrance').querySelector('.status-badge')).toBeNull();
    expect(button('↑', row('entrance')).disabled).toBe(true);
    expect(button('↓', row('utilities')).disabled).toBe(true);
    // The photos of the sections in use only.
    expect(el.querySelector('.totals')!.textContent!.trim()).toBe('3 sections (1 off) · up to 7 photos in total');
    expect(el.querySelector('.sync-note')!.textContent).toContain('Standard sections (not changed yet)');
    expect(button('Reset to standard sections').disabled).toBe(true);
  });

  it('adds a section, checking the name and the photos first', async () => {
    button('Add section').click();
    await settle();
    expect(dialog().querySelector('h3')!.textContent).toContain('Add section');
    // Nothing is sent while the form breaks the rules.
    button('SAVE', dialog()).click();
    await settle();
    expect(dialog().querySelector('#sectionNameError')!.textContent).toContain('Enter the section name.');
    await type(field('sectionName'), '3 Paint Shop');
    expect(dialog().querySelector('#sectionNameError')!.textContent).toContain('cannot start with a number');
    await type(field('sectionName'), 'Paint - Shop');
    expect(dialog().querySelector('#sectionNameError')!.textContent).toContain('" - "');
    await type(field('sectionName'), 'utilities');
    expect(dialog().querySelector('#sectionNameError')!.textContent).toContain('Another section has this name.');
    await type(field('sectionName'), 'Paint Shop');
    expect(dialog().querySelector('#sectionNameError')).toBeNull();
    await type(field('sectionMax'), '60');
    expect(dialog().querySelector('#sectionMaxError')!.textContent).toContain('from 1 to 50');
    await type(field('sectionMax'), '2');
    await type(field('sectionMin'), '4');
    expect(dialog().querySelector('#sectionMinError')!.textContent).toContain('cannot be more than the maximum');
    button('SAVE', dialog()).click();
    await settle();
    http.expectNone((r) => r.method === 'PUT');

    await type(field('sectionMin'), '2');
    await type(field('sectionHint') as unknown as HTMLTextAreaElement, ' Spray booth, oven ');
    button('Only these levels', dialog()).click();
    await settle();
    pick('Gold');
    await settle();
    expect(dialog().textContent).toContain('Asked for Gold, of units of every sector.');
    button('SAVE', dialog()).click();
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === url);
    expect(put.request.body).toEqual({
      sections: [...sections(), { id: 'paint-shop', title: 'Paint Shop', hint: 'Spray booth, oven', min: 2, max: 2, levels: ['Gold'], nicSectors: [], active: true }],
    });
    // The server's reason shows in the pop-up.
    put.flush({ title: 'The sections could not be saved.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(dialog().querySelector('.alert-danger')!.textContent).toContain('The sections could not be saved.');
    button('SAVE', dialog()).click();
    await settle();
    http.expectOne((r) => r.method === 'PUT').flush({ message: 'Site tour sections saved.' });
    await reloaded('Site tour sections saved.');
    expect(dialog()).toBeNull();
    expect(el.querySelector('.sync-note')!.textContent).not.toContain('Standard sections');
    expect(button('Reset to standard sections').disabled).toBe(false);
  });

  it('edits a section, keeping its key, and clears the sectors when back to every sector', async () => {
    button('Edit', row('production')).click();
    await settle();
    expect(field('sectionName').value).toBe('Production / Machine Shop');
    // Limited already: the lists show.
    expect(dialog().querySelector('#sectionLevels')).toBeTruthy();
    expect(dialog().querySelector('#sectionSectors')).toBeTruthy();
    await type(field('sectionName'), 'Machine Shop');
    button('Every sector', dialog()).click();
    await settle();
    expect(dialog().querySelector('#sectionSectors')).toBeNull();
    pick('Silver');
    await settle();
    (dialog().querySelector('#sectionActive') as HTMLInputElement).click();
    await settle();
    button('SAVE', dialog()).click();
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === url);
    expect(put.request.body.sections[1]).toEqual({
      id: 'production', title: 'Machine Shop', hint: null, min: 3, max: 5, levels: ['ZEDX', 'Silver'], nicSectors: [], active: false,
    });
    expect(put.request.body.sections.map((s: SiteTourSection) => s.id)).toEqual(['entrance', 'production', 'utilities']);
    put.flush({ message: 'Site tour sections saved.' });
    await reloaded('Site tour sections saved.');
  });

  it('keeps at least one section in use', async () => {
    button('↓', row('entrance')).click();
    await settle();
    http.expectOne((r) => r.method === 'PUT').flush({ message: 'Saved.' });
    await reloaded('Saved.', response({ sections: [section('entrance', 'Unit Entrance & Signage'), section('utilities', 'Utilities', { active: false })] }));
    button('Edit', row('entrance')).click();
    await settle();
    (dialog().querySelector('#sectionActive') as HTMLInputElement).click();
    await settle();
    expect(dialog().textContent).toContain('At least one section must be in use.');
    button('SAVE', dialog()).click();
    await settle();
    http.expectNone((r) => r.method === 'PUT');
  });

  it('moves a section and saves the whole list in the new order', async () => {
    button('↓', row('entrance')).click();
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === url);
    expect(put.request.body.sections.map((s: SiteTourSection) => s.id)).toEqual(['production', 'entrance', 'utilities']);
    expect(put.request.body.sections[0]).toEqual(sections()[1]);
    put.flush({ message: 'Site tour sections saved.' });
    await reloaded('Site tour sections saved.');

    button('↑', row('utilities')).click();
    await settle();
    const failed = http.expectOne((r) => r.method === 'PUT');
    expect(failed.request.body.sections.map((s: SiteTourSection) => s.id)).toEqual(['entrance', 'utilities', 'production']);
    failed.flush({ title: 'At least one section must be in use.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('At least one section must be in use.');
  });

  it('resets to the standard sections after confirming', async () => {
    // Saved once, so there is something to reset.
    button('↓', row('entrance')).click();
    await settle();
    http.expectOne((r) => r.method === 'PUT').flush({ message: 'Saved.' });
    await reloaded('Saved.');

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    button('Reset to standard sections').click();
    await settle();
    http.expectNone((r) => r.method === 'DELETE');

    confirm.mockReturnValue(true);
    button('Reset to standard sections').click();
    await settle();
    http.expectOne((r) => r.method === 'DELETE' && r.url === url).flush({ message: 'Site tour sections reset to the standard ten sections.' });
    await reloaded('reset to the standard ten sections', response());
    expect(el.querySelector('.sync-note')!.textContent).toContain('Standard sections (not changed yet)');
  });
});

describe('SiteTourSectionsPage portal switch', () => {
  afterEach(() => sessionStorage.clear());

  async function open(portal: string | null): Promise<HTMLElement> {
    sessionStorage.clear();
    if (portal) sessionStorage.setItem('zed.adminPortal', portal);
    await TestBed.configureTestingModule({ imports: [SiteTourSectionsPage], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    const fixture = TestBed.createComponent(SiteTourSectionsPage);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    http.match(() => true).forEach((r) => r.flush(r.request.url.endsWith('/sectors') ? [] : { sections: [], levels: [], customised: false }));
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement;
  }

  it('offers the three portals and names the app whose site tour the sections are', async () => {
    let el = await open(null);
    expect([...el.querySelectorAll('.ps-tab')].map((t) => t.textContent!.trim())).toEqual(['ZED Certification', 'Consultancy', 'Surveillance']);
    expect(el.querySelector('.page-sub')!.textContent).toContain('the site assessor app files');

    TestBed.resetTestingModule();
    el = await open('consultancy');
    expect(el.querySelector('.ps-tab.on')!.textContent!.trim()).toBe('Consultancy');
    expect(el.querySelector('.page-sub')!.textContent).toContain('the consultant app (milestone 1 visit) files');
  });
});

describe('sectionId', () => {
  it('makes a key from the name, unique among the others', () => {
    expect(sectionId('Paint Shop', ['entrance'])).toBe('paint-shop');
    expect(sectionId('Paint Shop', ['paint-shop', 'paint-shop-2'])).toBe('paint-shop-3');
    expect(sectionId('Safety & Fire', [])).toBe('safety-fire');
    expect(sectionId('&&&', [])).toBe('section');
    const long = sectionId('A'.repeat(60), ['a'.repeat(40)]);
    expect(long).toMatch(/^[a-z0-9][a-z0-9_-]{0,39}$/);
    expect(long.endsWith('-2')).toBe(true);
  });
});
