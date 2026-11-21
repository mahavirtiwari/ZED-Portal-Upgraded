import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TableExport } from '../table-export';
import { HistoryItem, UserHistoryPanel, blockHistoryItems } from './history-panel';
import { BlockHistoryEntry } from './users.api';

/** 2026-11-21 (the product owner: "profile Edit histories etc. are missing"): the account's whole history in the side panel. */
describe('UserHistoryPanel: the account history', () => {
  const entries: BlockHistoryEntry[] = [
    { action: 'Edited', reason: null, actionBy: 'AGENCY1 / OPS1', actionByRole: 2, actionDate: '2026-11-21T12:00:00', actionByName: 'Acme / Ops One',
      details: JSON.stringify([
        { field: 'mobile', old: '9000000001', new: '9000000002' },
        { field: 'states', added: ['KERALA'], removed: ['DELHI'] },
        { field: 'districts', added: ['A', 'B', 'C', 'D', 'E'], addedCount: 9 },
        { field: 'verifications', old: null, new: 'true' },
      ]) },
    { action: 'PasswordLink', reason: null, actionBy: 'MASTER1', actionByRole: 7, actionDate: '2026-11-21T11:00:00', details: JSON.stringify([{ field: 'sentTo', new: 'a@b.in' }]) },
    { action: 'PasswordLink', reason: 'self', actionBy: 'ZEDAS0001', actionByRole: 3, actionDate: '2026-11-21T10:30:00', details: JSON.stringify([{ field: 'sentTo', new: 'a@b.in' }]) },
    { action: 'MobileReset', reason: null, actionBy: 'MASTER1', actionByRole: 7, actionDate: '2026-11-21T10:00:00', details: JSON.stringify([{ field: 'mobile', old: '9000000000', new: '9000000001' }]) },
    { action: 'Allotment', reason: null, actionBy: null, actionByRole: null, actionDate: '2026-11-15T00:00:00', zedId: 'ZED201', level: 'Silver', allotment: 'SiteCo' },
    { action: 'Allotment', reason: null, actionBy: null, actionByRole: null, actionDate: '2026-11-10T00:00:00', zedId: 'ZED200', level: 'Bronze', allotment: 'Desktop', replaced: true },
    { action: 'Blocked', reason: 'Absent', actionBy: 'MASTER1', actionByRole: 7, actionDate: '2026-11-05T00:00:00' },
    { action: 'Created', reason: null, actionBy: 'AGENCY1', actionByRole: 2, actionDate: '2026-11-01T09:00:00',
      details: JSON.stringify([{ field: 'name', new: 'Assessor One' }, { field: 'states', added: ['DELHI'] }]) },
  ];

  function render(items: HistoryItem[] | null) {
    TestBed.configureTestingModule({ imports: [UserHistoryPanel], providers: [provideHttpClient(), provideHttpClientTesting()] });
    const fixture = TestBed.createComponent(UserHistoryPanel);
    fixture.componentRef.setInput('subtitle', 'Assessor One · ZEDAS0001');
    fixture.componentRef.setInput('fileName', 'history-ZEDAS0001');
    fixture.componentRef.setInput('items', items);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const lines = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.hp-list > li')];

  it('turns every kind into a readable line', () => {
    const items = blockHistoryItems(entries);
    expect(items.map((i) => i.kind)).toEqual(['edited', 'passwordLink', 'passwordLink', 'mobileReset', 'allotment', 'allotment', 'blocked', 'created']);
    expect(items.map((i) => i.title)).toEqual(['Profile edited', 'Password link sent', 'Password link sent', 'Mobile number changed', 'Allotment: ZED201',
      'Allotment: ZED200', 'Blocked', 'Account created']);
    expect(items[0].detail).toBe('By Acme / Ops One (agency) · 4 changed');
    expect(items[0].changes).toEqual(['Mobile: 9000000001 → 9000000002', 'States: added KERALA; removed DELHI', 'Districts: added A, B, C, D, E and 4 more',
      'Verifications: (none) → Yes']);
    expect(items[1].detail).toBe('By MASTER1 (Master Admin) · Sent to a@b.in');
    expect(items[2].detail).toBe('Asked by the user (Forgot password) · Sent to a@b.in');
    expect(items[3].detail).toBe('By MASTER1 (Master Admin) · Mobile: 9000000000 → 9000000001');
    expect(items[4].detail).toBe('Silver · co-assessor (site / remote)');
    expect(items[5].detail).toBe('Bronze · desktop assessment · later allotted to someone else');
    expect(items[7].changes).toEqual(['Name: Assessor One', 'States: DELHI']);
  });

  it('shows each kind with its own mark, opens an edit on demand and filters by kind', () => {
    const { fixture, el } = render(blockHistoryItems(entries));
    expect(lines(el).map((li) => li.dataset['kind'])).toEqual(['edited', 'passwordLink', 'passwordLink', 'mobileReset', 'allotment', 'allotment', 'blocked', 'created']);
    expect(lines(el)[6].className).toBe('is-bad');
    expect(lines(el).every((li) => li.querySelector('strong .hp-ic'))).toBe(true);
    const edit = lines(el)[0].querySelector('details')!;
    expect(edit.querySelector('summary')!.textContent!.trim()).toBe('What changed (4)');
    expect([...edit.querySelectorAll('.hp-change')].map((d) => d.textContent!.trim())[0]).toBe('Mobile: 9000000001 → 9000000002');
    expect(lines(el)[7].querySelector('summary')!.textContent!.trim()).toBe('Created with (2)');

    const chips = [...el.querySelectorAll<HTMLButtonElement>('.hp-chip')];
    expect(chips.map((c) => c.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      'All 8', 'Created 1', 'Edited 1', 'Password link 2', 'Mobile reset 1', 'Blocked 1', 'Allotment 2',
    ]);
    chips.find((c) => c.textContent!.includes('Allotment'))!.click();
    fixture.detectChanges();
    expect(lines(el).map((li) => li.querySelector('strong')!.textContent!.trim())).toEqual(['Allotment: ZED201', 'Allotment: ZED200']);
    expect(el.querySelector('.hp-chip.on')!.getAttribute('aria-pressed')).toBe('true');
    chips[0].click();
    fixture.detectChanges();
    expect(lines(el)).toHaveLength(8);
    expect(el.querySelector('.hp-note')!.textContent).toContain('Profile edits and links are recorded from 21 Nov 2026.');
  });

  it('downloads every kind with its changes in the CSV', () => {
    const { el } = render(blockHistoryItems(entries));
    const csv = vi.spyOn(TestBed.inject(TableExport), 'csv').mockImplementation(() => undefined);
    el.querySelector<HTMLButtonElement>('.hp-csv')!.click();
    const [name, sheet] = csv.mock.calls[0];
    expect(name).toBe('history-ZEDAS0001');
    expect(sheet.columns).toEqual(['Date', 'Kind', 'Event', 'Details', 'Changes']);
    expect(sheet.rows.map((r) => r[1])).toEqual(['Edited', 'Password link', 'Password link', 'Mobile reset', 'Allotment', 'Allotment', 'Blocked', 'Created']);
    expect(sheet.rows[0][4]).toBe('Mobile: 9000000001 → 9000000002; States: added KERALA; removed DELHI; Districts: added A, B, C, D, E and 4 more; Verifications: (none) → Yes');
    expect(sheet.rows[6][3]).toBe('By MASTER1 (Master Admin) · Reason: Absent');
  });

  it('has no chips for a single kind and says when nothing is recorded', () => {
    let { el } = render(blockHistoryItems([entries[6]]));
    expect(el.querySelector('.hp-chips')).toBeNull();
    TestBed.resetTestingModule();
    ({ el } = render([]));
    expect(el.querySelector('.hp-list .hp-none')!.textContent!.trim()).toBe('Nothing recorded yet.');
    expect(el.querySelector<HTMLButtonElement>('.hp-csv')!.disabled).toBe(true);
  });
});
