import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CollapseCard } from './collapse-card';

@Component({
  imports: [CollapseCard],
  template: `<zed-collapse-card title="Add Parameter" summary="Open to add a new parameter." [(open)]="open"><input id="inside" /></zed-collapse-card>`,
})
class Host {
  readonly open = signal(false);
}

describe('CollapseCard', () => {
  it('opens and closes on its header, keeping its body (and what was typed) in the page', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const head = el.querySelector('.collapse-head') as HTMLButtonElement;
    const body = el.querySelector('.collapse-body') as HTMLElement;
    expect(el.querySelector('.card-title')!.textContent).toBe('Add Parameter');
    expect(el.querySelector('.collapse-summary')!.textContent).toBe('Open to add a new parameter.');
    expect(head.getAttribute('aria-controls')).toBe(body.id);
    expect([head.getAttribute('aria-expanded'), body.hidden]).toEqual(['false', true]);
    expect(el.querySelector('zed-collapse-card')!.classList).toContain('is-closed');

    (el.querySelector('#inside') as HTMLInputElement).value = 'typed';
    head.click();
    await fixture.whenStable();
    expect([head.getAttribute('aria-expanded'), body.hidden, fixture.componentInstance.open()]).toEqual(['true', false, true]);

    head.click();
    await fixture.whenStable();
    expect(body.hidden).toBe(true);
    expect((el.querySelector('#inside') as HTMLInputElement).value).toBe('typed');
  });
});
