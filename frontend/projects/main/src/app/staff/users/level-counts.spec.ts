import { TestBed } from '@angular/core/testing';
import { LevelCount, LevelCounts, levelCountTiles, levelCountTip, levelKey } from './level-counts';

describe('LevelCounts (2026-11-18)', () => {
  const counts: LevelCount[] = [
    { code: 'Bronze', name: 'Bronze', allotted: 12, inProgress: 4, completed: 7, rejected: 1 },
    { code: 'Silver', name: 'Silver', allotted: 3, inProgress: 3, completed: 0, rejected: 0 },
    { code: 'Gold', name: 'Gold', allotted: 0, inProgress: 0, completed: 0, rejected: 0 },
    { code: 'ZEDX', name: 'ZED-X', allotted: 1, inProgress: 0, completed: 1, rejected: 0 },
    { code: 'TITANIUM', name: 'Titanium', allotted: 2, inProgress: 2, completed: 0, rejected: 0 },
  ];

  function render(value: LevelCount[] | null) {
    TestBed.configureTestingModule({ imports: [LevelCounts] });
    const fixture = TestBed.createComponent(LevelCounts);
    fixture.componentRef.setInput('counts', value);
    fixture.componentRef.setInput('label', 'Units allocated to Acme');
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows a chip per level with its medal colour and allocated count, zero levels too', () => {
    const el = render(counts);
    const chips = [...el.querySelectorAll('.lcs-chip')];
    expect(chips.map((c) => c.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['Bronze 12', 'Silver 3', 'Gold 0', 'ZED-X 1', 'Titanium 2']);
    expect(chips.map((c) => [...c.querySelector('.lcs-dot')!.classList].find((k) => k !== 'lcs-dot'))).toEqual([
      'lcs-bronze', 'lcs-silver', 'lcs-gold', 'lcs-zedx', 'lcs-other',
    ]);
    expect(chips[2].classList).toContain('is-zero');
    expect(chips[0].classList).not.toContain('is-zero');
    expect(el.querySelector('[role="list"]')!.getAttribute('aria-label')).toBe('Units allocated to Acme');
  });

  it('explains each count in its tooltip: allocated, in progress, completed and any rejected', () => {
    const el = render(counts);
    const chips = [...el.querySelectorAll('.lcs-chip')];
    expect(chips[0].getAttribute('title')).toBe('Bronze: 12 allocated · 4 in progress · 7 completed · 1 rejected');
    expect(chips[1].getAttribute('title')).toBe('Silver: 3 allocated · 3 in progress · 0 completed');
    expect(chips[0].getAttribute('aria-label')).toBe(chips[0].getAttribute('title'));
  });

  it('shows a dash when the counts could not be read', () => {
    const el = render(null);
    expect(el.querySelector('.lcs-chip')).toBeNull();
    expect(el.querySelector('.lcs-none')!.textContent!.trim()).toBe('—');
  });

  it('turns totals into tiles and knows the medal of each level', () => {
    expect(levelCountTiles(counts.slice(0, 1))).toEqual([{ key: 'lv-Bronze', label: 'Bronze Allocated', value: 12, sub: '4 in progress · 7 completed' }]);
    expect(levelCountTiles(null)).toEqual([]);
    expect(levelKey('ZEDX')).toBe('zedx');
    expect(levelKey('Platinum')).toBe('other');
    expect(levelCountTip(counts[3])).toBe('ZED-X: 1 allocated · 0 in progress · 1 completed');
  });
});
