import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TAT_API, TatPage, TatResponse } from './tat';
import { ToastService } from '../toast';
import { SWITCHED_APIS } from '../admin-portal';

/** 2026-11-18: Administration → TAT (Turnaround Time). */
describe('TatPage', () => {
  let fixture: ComponentFixture<TatPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const button = (root: ParentNode, text: string) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent!.trim() === text) as HTMLButtonElement;

  const chip = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('.cf-chip')].find((b) => b.textContent!.trim().startsWith(label))!;

  const data = (): TatResponse => ({
    module: 'Assessment',
    levels: [{ code: 'Bronze', name: 'Bronze' }, { code: 'Silver', name: 'Silver' }],
    statuses: [
      { code: '5', name: 'Desktop assessment quality check', track: 'desktop', final: false, systemText: 'Quality Check' },
      { code: '15', name: 'Site assessment quality check', track: 'site', final: false, systemText: null },
      { code: '16', name: 'Certified', track: null, final: true, systemText: null },
    ],
    points: [
      { code: 'registered', name: 'Registration (application received)', kind: 'milestone', track: null },
      { code: '5', name: 'Desktop assessment quality check', kind: 'status', track: 'desktop' },
      { code: '15', name: 'Site assessment quality check', kind: 'status', track: 'site' },
      { code: '16', name: 'Certified', kind: 'status', track: null },
    ],
    days: { Silver: { '15': 3 } },
    relations: [{ id: 4, name: 'Registration to certification', certification: null, fromStatus: 'registered', toStatus: '16', days: 90, isActive: true, sortOrder: 1 }],
    suggestions: [
      { name: 'Registration to certification', fromStatus: 'registered', toStatus: '16', days: 90, added: true },
      { name: 'Site QC', fromStatus: '15', toStatus: '16', days: 5, added: false },
    ],
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TatPage], providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(TatPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne(TAT_API).flush(data());
    await settle();
  });

  afterEach(() => http.verify());

  it('is switched per portal (Assessment, Handholding, Surveillance)', () => {
    expect(SWITCHED_APIS.find((a) => a.prefix === TAT_API)?.portals).toEqual(['main', 'consultancy', 'surveillance']);
  });

  it('lists every status per level with its days; a final status takes none', async () => {
    const days = (code: string) => el.querySelector(`tr[data-status="${code}"] input`) as HTMLInputElement | null;
    expect(el.textContent).toContain('Days allowed per status · Assessment');
    expect(days('15')!.value).toBe('');   // Bronze first: nothing set
    expect(days('16')).toBeNull();
    expect(el.querySelector('tr[data-status="16"]')!.textContent).toContain('Final status');
    expect(el.querySelector('tr[data-status="5"]')!.textContent).not.toContain('Quality Check'.repeat(2));

    chip('Silver').click();   // the level chip shows how many statuses have days
    expect(chip('Silver').textContent!.replace(/\s+/g, ' ').trim()).toBe('Silver 1');
    await settle();
    expect(days('15')!.value).toBe('3');
  });

  it('saves the chosen level’s days, blank as no TAT', async () => {
    chip('Silver').click();
    await settle();
    expect(button(el, 'Save days').disabled).toBe(true);
    const input = el.querySelector('tr[data-status="5"] input') as HTMLInputElement;
    input.value = '2';
    input.dispatchEvent(new Event('input'));
    await settle();
    button(el, 'Save days').click();
    await settle();
    const put = http.expectOne(`${TAT_API}/days/Silver`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ days: [{ status: '5', days: 2 }, { status: '15', days: 3 }] });
    put.flush({ message: 'Days allowed for Silver saved.' });
    await settle();
    http.expectOne(TAT_API).flush(data());
    await settle();
  });

  it('adds a relation after checking it, and edits and deactivates one', async () => {
    button(el, 'Add Relation').click();
    await settle();
    const dialog = el.querySelector('[role=dialog]') as HTMLElement;
    button(dialog, 'Save').click();
    await settle();
    expect(dialog.textContent).toContain("Please enter the relation's name.");
    http.expectNone(`${TAT_API}/relations`);

    const set = (sel: string, value: string, ev = 'input') => {
      const f = dialog.querySelector(sel) as HTMLInputElement | HTMLSelectElement;
      f.value = value;
      f.dispatchEvent(new Event(ev));
    };
    set('#tatName', 'Site QC to certification');
    set('#tatLevel', 'Silver', 'change');
    set('#tatFrom', '15', 'change');
    set('#tatTo', '16', 'change');
    set('#tatDays', '7');
    await settle();
    // A relation cannot start from a final status.
    expect([...(dialog.querySelector('#tatFrom') as HTMLSelectElement).options].map((o) => o.value)).not.toContain('16');
    button(dialog, 'Save').click();
    await settle();
    const post = http.expectOne(`${TAT_API}/relations`);
    expect(post.request.body).toEqual({ name: 'Site QC to certification', certification: 'Silver', fromStatus: '15', toStatus: '16', days: 7, isActive: true });
    post.flush({ message: 'Relation added.' });
    await settle();
    http.expectOne(TAT_API).flush(data());
    await settle();
    expect(el.querySelector('[role=dialog]')).toBeNull();

    const row = el.querySelector('tr[data-id="4"]') as HTMLElement;
    expect(row.textContent).toContain('Registration (application received) → Certified');
    expect(row.textContent).toContain('All levels');
    button(row, 'Deactivate').click();
    await settle();
    const put = http.expectOne(`${TAT_API}/relations/4`);
    expect(put.request.body.isActive).toBe(false);
    put.flush({ message: 'Relation saved.' });
    await settle();
    http.expectOne(TAT_API).flush(data());
    await settle();
  });

  it('deletes a relation and adds the suggested ones only after confirming', async () => {
    button(el.querySelector('tr[data-id="4"]')!, 'Delete').click();
    await settle();
    expect(el.textContent).toContain('Delete "Registration to certification"?');
    button(el.querySelector('.cd-no')!.parentElement!, 'Delete').click();
    await settle();
    http.expectOne((r) => r.method === 'DELETE' && r.url === `${TAT_API}/relations/4`).flush({ message: 'Relation deleted.' });
    await settle();
    http.expectOne(TAT_API).flush(data());
    await settle();

    const toast = vi.spyOn(TestBed.inject(ToastService), 'success');
    button(el, 'Add Suggested Relations').click();
    await settle();
    expect(el.textContent).toContain('Site QC: Site assessment quality check → Certified, 5 days');
    expect(el.textContent).not.toContain('Registration to certification: ');
    http.expectNone(`${TAT_API}/relations/suggested`);
    button(el.querySelector('.cd-no')!.parentElement!, 'Add').click();
    await settle();
    http.expectOne((r) => r.method === 'POST' && r.url === `${TAT_API}/relations/suggested`).flush({ message: '1 suggested relation added.', added: 1 });
    await settle();
    http.expectOne(TAT_API).flush(data());
    await settle();
    expect(toast).toHaveBeenCalledWith('Relations', '1 suggested relation added.');
  });

  it('checks a relation like the API', () => {
    const e = { id: null, name: 'X', certification: '', fromStatus: '5', toStatus: '5', days: 3, isActive: true };
    expect(TatPage.problem(e)).toBe('The relation must end at another status.');
    expect(TatPage.problem({ ...e, toStatus: '15', days: 0 })).toBe('Days must be 1 to 999.');
    expect(TatPage.problem({ ...e, toStatus: '15' })).toBeNull();
  });
});
