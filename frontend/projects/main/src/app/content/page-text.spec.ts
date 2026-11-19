import { Component, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TextPipe, fillWords, setPageTexts, t } from './page-text';

@Component({
  imports: [TextPipe],
  template: `<h1>{{ 'Assessment Agencies' | t: 'staff.agencies.title' }}</h1>
    <p>{{ 'Showing {from} to {to}' | t: 'staff.agencies.showing' : { from: from(), to: 10 } }}</p>
    <input [placeholder]="'Search' | t: 'staff.agencies.search.placeholder'" />
    <span>{{ label() }}</span>`,
})
class Host {
  readonly from = signal(1);
  readonly label = computed(() => t('staff.agencies.toast.blocked', '{name} blocked', { name: 'ZEDAA0001' }));
}

describe('page wording (t, the t pipe)', () => {
  afterEach(() => setPageTexts([]));

  it('shows the standard wording until the Admin changes it, with its values', () => {
    expect(t('staff.agencies.title', 'Assessment Agencies')).toBe('Assessment Agencies');
    expect(t('staff.x.showing', 'Showing {from} to {to} of {total}', { from: 1, to: 10, total: 42 })).toBe('Showing 1 to 10 of 42');
    setPageTexts([
      { key: 'staff.agencies.title', enabled: true, html: 'Agencies' },
      { key: 'staff.x.showing', enabled: true, html: '{from}–{to} of {total}' },
      { key: 'staff.x.hidden', enabled: false, html: 'Not used' },
    ]);
    expect(t('staff.agencies.title', 'Assessment Agencies')).toBe('Agencies');
    expect(t('staff.x.showing', 'Showing {from} to {to} of {total}', { from: 1, to: 10, total: 42 })).toBe('1–10 of 42');
    expect(t('staff.x.hidden', 'Standard')).toBe('Standard');
  });

  it('leaves an unknown value as written and empties a missing one', () => {
    expect(fillWords('{a} and {b}', { a: 'A', b: null })).toBe('A and ');
    expect(fillWords('{a} and {c}', { a: 'A' })).toBe('A and {c}');
    expect(fillWords('Price {x}', null)).toBe('Price {x}');
  });

  it('updates a drawn page when the Admin wording arrives, and when a value changes', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('h1')!.textContent).toBe('Assessment Agencies');
    expect(el.querySelector('p')!.textContent).toBe('Showing 1 to 10');
    expect(el.querySelector('input')!.placeholder).toBe('Search');
    expect(el.querySelector('span')!.textContent).toBe('ZEDAA0001 blocked');

    setPageTexts([
      { key: 'staff.agencies.title', enabled: true, html: 'Agencies' },
      { key: 'staff.agencies.showing', enabled: true, html: 'Rows {from}–{to}' },
      { key: 'staff.agencies.search.placeholder', enabled: true, html: 'Find an agency' },
      { key: 'staff.agencies.toast.blocked', enabled: true, html: '{name} is blocked' },
    ]);
    fixture.detectChanges();
    expect(el.querySelector('h1')!.textContent).toBe('Agencies');
    expect(el.querySelector('p')!.textContent).toBe('Rows 1–10');
    expect(el.querySelector('input')!.placeholder).toBe('Find an agency');
    expect(el.querySelector('span')!.textContent).toBe('ZEDAA0001 is blocked');

    fixture.componentInstance.from.set(11);
    fixture.detectChanges();
    expect(el.querySelector('p')!.textContent).toBe('Rows 11–10');
  });

  it('works the wording out again only when something it depends on changes', () => {
    const pipe = new TextPipe();
    const values = { n: 1 };
    const first = pipe.transform('{n} item', 'staff.x.items', values);
    expect(first).toBe('1 item');
    values.n = 2; // the same object: Angular gives a new one when a template value changes
    expect(pipe.transform('{n} item', 'staff.x.items', values)).toBe('1 item');
    expect(pipe.transform('{n} item', 'staff.x.items', { n: 2 })).toBe('2 item');
    setPageTexts([{ key: 'staff.x.items', enabled: true, html: '{n} things' }]);
    expect(pipe.transform('{n} item', 'staff.x.items', { n: 2 })).toBe('2 things');
  });
});
