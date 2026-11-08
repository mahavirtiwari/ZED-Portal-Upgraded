import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RequirementVideo } from './requirement-video';

@Component({
  imports: [RequirementVideo],
  template: `<zed-requirement-video [url]="url()" code="1.2" [compact]="compact()" />`,
})
class Host {
  readonly url = signal<unknown>(null);
  readonly compact = signal(false);
}

describe('RequirementVideo', () => {
  function render(url: unknown, compact = false): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [Host] });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.url.set(url);
    fixture.componentInstance.compact.set(compact);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('links to the Admin video in a new tab', () => {
    const a = render(' https://youtu.be/abc ').querySelector('a.req-video') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('https://youtu.be/abc');
    expect(a.target).toBe('_blank');
    expect(a.rel).toContain('noopener');
    expect(a.textContent).toContain('Watch video');
    expect(a.title).toContain('1.2');
  });

  it('shows nothing without a web address', () => {
    for (const url of [null, '', 'javascript:alert(1)', 42]) expect(render(url).querySelector('a')).toBeNull();
  });

  it('keeps only the play sign in compact cells, with a text for screen readers', () => {
    const a = render('https://youtu.be/abc', true).querySelector('a.req-video') as HTMLAnchorElement;
    expect(a.classList).toContain('compact');
    expect(a.querySelector('.visually-hidden')?.textContent).toBe('Watch video');
  });
});
