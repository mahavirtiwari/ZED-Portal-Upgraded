import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ContentService, ContentTextComponent, fillText, textParts } from './content-text';

@Component({
  imports: [ContentTextComponent],
  template: `
    <zed-text key="msme.payment.disclaimer" [values]="{ Fee: fee(), Name: name }"><p class="own">Own copy</p></zed-text>
    <zed-text key="msme.hidden"><p class="own-hidden">Hidden copy</p></zed-text>
    <label><zed-text key="msme.pledge.checkbox" [inline]="true">I agree</zed-text></label>
  `,
})
class Host {
  readonly fee = signal(1000);
  readonly name = 'A & B <Ltd>';
}

describe('zed-text', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Host],
      // The real service (test-providers.ts stubs it for the page specs).
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: ContentService, useClass: ContentService }],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('shows the own copy until the texts arrive, then the Admin version with the fields filled in', async () => {
    const fixture = TestBed.createComponent(Host);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.own')!.textContent).toBe('Own copy');

    http.expectOne('/api/content').flush([
      { key: 'msme.payment.disclaimer', enabled: true, html: '<p class="admin">Fee Rs. {{Fee}} for {{name}} {{Unknown}}</p>' },
      { key: 'msme.hidden', enabled: false, html: '<p>x</p>' },
      { key: 'msme.pledge.checkbox', enabled: true, html: 'I <b>pledge</b>' },
    ]);
    await settle(fixture);
    expect(el.querySelector('.own')).toBeNull();
    expect(el.querySelector('.admin')!.textContent).toBe('Fee Rs. 1000 for A & B <Ltd> ');
    expect(el.querySelector('.admin')!.innerHTML).toContain('A &amp; B &lt;Ltd&gt;');
    expect(el.querySelector('.own-hidden')).toBeNull();
    expect(el.querySelector('label span')!.innerHTML).toBe('I <b>pledge</b>');

    fixture.componentInstance.fee.set(2000);
    await settle(fixture);
    expect(el.querySelector('.admin')!.textContent).toContain('Fee Rs. 2000');
  });

  it('keeps the own copy when the texts cannot be loaded', async () => {
    const fixture = TestBed.createComponent(Host);
    await settle(fixture);
    http.expectOne('/api/content').flush(null, { status: 500, statusText: 'Server Error' });
    await settle(fixture);
    expect(fixture.nativeElement.querySelector('.own').textContent).toBe('Own copy');
    expect(fixture.nativeElement.querySelector('.own-hidden').textContent).toBe('Hidden copy');
  });

  it('encodes the values it fills in', () => {
    expect(fillText('<b>{{ A }}</b>{{b}}', { a: '"x"', B: 0 })).toBe('<b>&quot;x&quot;</b>0');
  });

  it('renders the key as data-key and shows the text in its box, no box when hidden', async () => {
    @Component({
      imports: [ContentTextComponent],
      template: `<zed-text key="staff.note" box="alert alert-warning" /><zed-text key="staff.hidden" box="alert alert-danger" />`,
    })
    class BoxHost {}
    const fixture = TestBed.createComponent(BoxHost);
    await settle(fixture);
    http.expectOne('/api/content').flush([
      { key: 'staff.note', enabled: true, html: '<strong>Note:</strong> check' },
      { key: 'staff.hidden', enabled: false, html: 'x' },
    ]);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-key="staff.note"] .zed-text.alert.alert-warning')!.innerHTML).toBe('<strong>Note:</strong> check');
    expect(el.querySelector('[data-key="staff.hidden"]')!.children.length).toBe(0);
  });

  it('splits a text into its lines or items', () => {
    expect(textParts('<p>One</p>\n<p class="x"> Two <b>2</b></p>', 'p')).toEqual(['One', 'Two <b>2</b>']);
    expect(textParts('<ol><li>A</li><li>B</li></ol>', 'li')).toEqual(['A', 'B']);
    expect(textParts('Just a line', 'p')).toEqual(['Just a line']);
    expect(textParts(' ', 'li')).toEqual([]);
  });
});
