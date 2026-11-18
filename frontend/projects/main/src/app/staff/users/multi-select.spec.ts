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

  // 2026-11-18 (the user: staff pages 'not aligned with SVG files'): the compact variants of staff-02 and popup-02.
  it("'chips': the label and the count on one line, the choices as chips, the matches listed while the field has the focus", async () => {
    @Component({
      imports: [MultiSelect],
      template: `<zed-multi-select variant="chips" heading="Applicable states" inputId="st" [options]="options" [(value)]="value" />`,
    })
    class ChipsHost {
      readonly options = STATES;
      readonly value = signal<string[]>(['GOA']);
    }
    const fixture = TestBed.createComponent(ChipsHost);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('label[for="st"]')!.textContent!.trim()).toBe('Applicable states');
    expect(el.querySelector('.msc-meta')!.textContent!.replace(/\s+/g, ' ')).toContain('1 of 4 selected · Select all · Clear');
    expect([...el.querySelectorAll('.msc-box .chip')].map((c) => c.firstChild!.textContent!.trim())).toEqual(['GOA']);
    expect(el.querySelector('.msc')!.classList).not.toContain('open');
    const input = el.querySelector('#st') as HTMLInputElement;
    input.dispatchEvent(new Event('focus'));
    input.value = 'bi';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(el.querySelector('.msc')!.classList).toContain('open');
    expect([...el.querySelectorAll('.msc-list .option')].map((o) => o.textContent!.trim())).toEqual(['BIHAR']);
    (el.querySelector('.msc-list input') as HTMLInputElement).click();
    await fixture.whenStable();
    expect(fixture.componentInstance.value()).toEqual(['GOA', 'BIHAR']);
  });

  it("'dropdown': a button that sums up the choice and opens the ticks", async () => {
    @Component({
      imports: [MultiSelect],
      template: `<zed-multi-select variant="dropdown" label="States" allText="every state" [options]="options" [(value)]="value" />`,
    })
    class DropHost {
      readonly options = STATES;
      readonly value = signal<string[]>(STATES.map((s) => s.value));
    }
    const fixture = TestBed.createComponent(DropHost);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const button = el.querySelector('.msd-btn') as HTMLButtonElement;
    expect(button.textContent!.trim()).toBe('4 of 4 selected (every state)');
    button.click();
    await fixture.whenStable();
    expect(el.querySelector('.msd')!.classList).toContain('open');
    [...el.querySelectorAll<HTMLButtonElement>('.msd-panel .ms-actions button')].find((b) => b.textContent!.trim() === 'Clear')!.click();
    await fixture.whenStable();
    expect(button.textContent!.trim()).toBe('None selected');
  });
});
