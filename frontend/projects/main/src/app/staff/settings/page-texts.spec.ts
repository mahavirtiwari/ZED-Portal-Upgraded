import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PageTextItem, PageTextsPanel } from './page-texts';

const url = '/api/staff/settings/page-texts';

const item = (key: string, standard: string, extra: Partial<PageTextItem> = {}): PageTextItem => {
  const [portal, page] = key.split('.');
  return { key, portal, page, pageName: page.charAt(0).toUpperCase() + page.slice(1), kind: 'heading', standard, text: null,
    placeholders: [...standard.matchAll(/\{(\w+)\}/g)].map((m) => m[1]), maxLength: 300, updatedBy: null, updatedOn: null, ...extra };
};

describe('PageTextsPanel (Texts → Page wording)', () => {
  let fixture: ComponentFixture<PageTextsPanel>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const button = (label: string, root: ParentNode = el) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent!.trim() === label) as HTMLButtonElement;
  const heads = () => [...el.querySelectorAll('.pt-head')].map((h) => h.querySelector('strong')!.textContent);
  const rows = () => [...el.querySelectorAll('.pt-row')] as HTMLElement[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PageTextsPanel], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(PageTextsPanel);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne(url).flush([
      item('msme.dashboard.welcome', 'Welcome, {name}', { kind: 'heading' }),
      item('msme.dashboard.refreshButton', 'Refresh', { kind: 'button', text: 'Reload', updatedBy: 'ADMIN1', updatedOn: '2026-11-19T04:30:00Z' }),
      item('staff.agencies.title', '{agencies}'),
      item('staff.agencies.search.placeholder', 'Search agencies', { kind: 'placeholder' }),
    ]);
    await settle();
  });

  afterEach(() => http.verify());

  it('lists the wording by portal and page, closed until opened, and filters it', async () => {
    expect(heads()).toEqual(['Dashboard', 'Agencies']);
    expect(el.querySelector('.pt-count')!.textContent).toContain('4 wordings · 1 changed');
    expect(rows().length).toBe(0);
    (el.querySelector('.pt-head') as HTMLButtonElement).click();
    await settle();
    expect(rows().map((r) => r.querySelector('.pt-text')!.textContent)).toEqual(['Welcome, {name}', 'Reload']);
    expect(rows()[1].textContent).toContain('Standard: Refresh');
    expect(rows()[1].textContent).toContain('Changed by ADMIN1 on 19-11-2026 10:00');

    // A search opens every group with a match.
    const search = el.querySelector('.pt-search') as HTMLInputElement;
    search.value = 'search';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(heads()).toEqual(['Agencies']);
    expect(rows().map((r) => r.querySelector('code')!.textContent)).toEqual(['staff.agencies.search.placeholder']);
  });

  it('saves the wording as plain text with its values and shows a refusal in the row', async () => {
    const search = el.querySelector('.pt-search') as HTMLInputElement;
    search.value = 'welcome';
    search.dispatchEvent(new Event('input'));
    await settle();
    button('Edit').click();
    await settle();
    const box = el.querySelector('.pt-edit textarea') as HTMLTextAreaElement;
    expect(box.value).toBe('Welcome, {name}');
    expect(button('{name}')).toBeTruthy();
    box.value = 'Hello <b>';
    box.dispatchEvent(new Event('input'));
    button('Save').click();
    http.expectOne({ method: 'PUT', url: `${url}/msme.dashboard.welcome` })
      .flush({ title: 'Use plain text: HTML tags are not allowed in page wording.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('.pt-edit')!.textContent).toContain('HTML tags are not allowed');

    box.value = 'Hello, {name}';
    box.dispatchEvent(new Event('input'));
    button('Save').click();
    const put = http.expectOne({ method: 'PUT', url: `${url}/msme.dashboard.welcome` });
    expect(put.request.body).toEqual({ text: 'Hello, {name}' });
    put.flush(item('msme.dashboard.welcome', 'Welcome, {name}', { text: 'Hello, {name}', updatedBy: 'ADMIN1', updatedOn: '2026-11-19T05:00:00Z' }));
    await settle();
    expect(el.querySelector('.pt-edit')).toBeNull();
    expect(rows()[0].querySelector('.pt-text')!.textContent).toBe('Hello, {name}');
    expect(el.querySelector('.alert-success')!.textContent).toContain('Wording saved');
  });

  it('resets a changed wording after confirming', async () => {
    (el.querySelector('input[type=checkbox]') as HTMLInputElement).click();
    await settle();
    expect(rows().length).toBe(1);
    button('Reset to standard', rows()[0]).click();
    await settle();
    const dialog = el.querySelector('zed-confirm-dialog')!;
    expect(dialog.textContent).toContain('Standard: Refresh');
    (dialog.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    http.expectOne({ method: 'DELETE', url: `${url}/msme.dashboard.refreshButton` }).flush(item('msme.dashboard.refreshButton', 'Refresh', { kind: 'button' }));
    await settle();
    expect(el.querySelector('zed-confirm-dialog')).toBeNull();
    expect(el.querySelector('.pt-count')!.textContent).toContain('0 changed');
  });
});
