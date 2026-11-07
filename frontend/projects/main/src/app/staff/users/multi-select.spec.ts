import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MultiSelect, MultiSelectOption } from './multi-select';

const STATES: MultiSelectOption[] = ['ASSAM', 'BIHAR', 'DELHI', 'GOA'].map((s) => ({ value: s, label: s }));
const SECTORS: MultiSelectOption[] = [
  { value: '10', label: '10-Manufacture of food products' },
  { value: '14', label: '14-Manufacture of wearing apparel and other garments' },
];

@Component({
  imports: [MultiSelect],
  template: `<zed-multi-select label="Applicable States" [options]="options()" [(value)]="value" />`,
})
class Host {
  readonly options = signal(STATES);
  readonly value = signal<string[]>([]);
}

describe('MultiSelect', () => {
  it('shows the count, picks with Select all (the filter matches) and Clear, and removes a chip', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const host = fixture.componentInstance;
    const count = () => el.querySelector('.ms-count')!.textContent!.trim();
    const button = (t: string) => [...el.querySelectorAll('.ms-actions button')].find((b) => b.textContent!.trim() === t) as HTMLButtonElement;

    expect(count()).toBe('None selected');
    expect(el.querySelectorAll('.option').length).toBe(4);
    expect(el.querySelector('.options')!.classList).not.toContain('wide');

    const filter = el.querySelector('input[type=search]') as HTMLInputElement;
    filter.value = 'a';
    filter.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    button('Select all').click();
    await fixture.whenStable();
    expect(host.value()).toEqual(['ASSAM', 'BIHAR', 'GOA']);
    expect(count()).toBe('3 of 4 selected');
    expect(el.querySelectorAll('.option.on').length).toBe(3);

    (el.querySelector('.chip-remove') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(host.value()).toEqual(['BIHAR', 'GOA']);

    button('Clear').click();
    await fixture.whenStable();
    expect(host.value()).toEqual([]);
    expect(el.querySelector('.chips')).toBeNull();
  });

  it('long names (NIC sectors) get the wider, two-column layout', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.options.set(SECTORS);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('.options')!.classList).toContain('wide');
  });
});
