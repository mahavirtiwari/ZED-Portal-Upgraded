import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { StaffRoleDocumentsPage } from './staff-documents';

describe('StaffRoleDocumentsPage', () => {
  async function render() {
    TestBed.configureTestingModule({ imports: [StaffRoleDocumentsPage], providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    const fixture = TestBed.createComponent(StaffRoleDocumentsPage);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    return { fixture, http, el: fixture.nativeElement as HTMLElement };
  }

  async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const text = (e: Element) => e.textContent!.replace(/\s+/g, ' ').trim();
  const docs = [
    { id: 7, documentName: 'Assessor handbook', description: 'Read before a visit', downloadUrl: '/api/staff/documents/7/file', videoUrl: null, createdDate: '2026-11-10T09:00:00' },
    { id: 9, documentName: 'Tour', description: null, downloadUrl: null, videoUrl: 'https://www.youtube.com/watch?v=t', createdDate: '2026-10-01T10:00:00' },
    { id: 11, documentName: 'Scheme guidelines', description: null, downloadUrl: '/api/staff/documents/11/file', videoUrl: null, createdDate: null, fileName: 'guidelines.pdf' },
    { id: 12, documentName: 'Helpdesk', description: null, downloadUrl: null, videoUrl: 'https://example.org/helpdesk', createdDate: null },
  ];

  it('lists the documents shared with the role, with their type, date, downloads, videos and a search', async () => {
    const { fixture, http, el } = await render();
    http.expectOne('/api/staff/documents').flush(docs);
    await settle(fixture);
    const links = [...el.querySelectorAll('.sd-item a')].map((a) => `${text(a)} ${a.getAttribute('href')}`);
    expect(links).toEqual(['Download /api/staff/documents/7/file', 'Watch https://www.youtube.com/watch?v=t', 'Download /api/staff/documents/11/file',
      'Open https://example.org/helpdesk']);
    expect(el.textContent).toContain('Read before a visit');
    const first = el.querySelector('.sd-item')!;
    expect(text(first.querySelector('.sd-kind')!)).toBe('File');
    expect(text(first.querySelector('.sd-meta')!)).toBe('File · Added 10 Nov 2026');
    // 2026-11-18 (staff-18): the real type from the file name, "Video" and "Link".
    const items = el.querySelectorAll('.sd-item');
    expect(text(items[1].querySelector('.sd-kind')!)).toBe('Video');
    expect(text(items[1].querySelector('.sd-meta')!)).toBe('Video');
    expect(text(items[2].querySelector('.sd-kind')!)).toBe('PDF');
    expect(text(items[2].querySelector('.sd-meta')!)).toBe('PDF');
    expect(text(items[3].querySelector('.sd-kind')!)).toBe('Link');
    expect(text(items[3].querySelector('.sd-meta')!)).toBe('Opens in a new tab');
    // No size: the API does not return one.
    expect(el.textContent).not.toContain('MB');

    const search = el.querySelector('input[type=search]') as HTMLInputElement;
    search.value = 'tour';
    search.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect([...el.querySelectorAll('.sd-item strong')].map((s) => s.textContent)).toEqual(['Tour']);
    http.verify();
  });

  it('filters by type with the counts of each type, Links included (2026-11-18)', async () => {
    const { fixture, http, el } = await render();
    http.expectOne('/api/staff/documents').flush(docs);
    await settle(fixture);
    const chips = () => [...el.querySelectorAll('.cf-chip')];
    expect(chips().map(text)).toEqual(['All 4', 'Files 2', 'Videos 1', 'Links 1']);

    (chips()[2] as HTMLButtonElement).click();
    await settle(fixture);
    expect([...el.querySelectorAll('.sd-item strong')].map((s) => s.textContent)).toEqual(['Tour']);
    (chips()[1] as HTMLButtonElement).click();
    await settle(fixture);
    expect([...el.querySelectorAll('.sd-item strong')].map((s) => s.textContent)).toEqual(['Assessor handbook', 'Scheme guidelines']);
    (chips()[3] as HTMLButtonElement).click();
    await settle(fixture);
    expect([...el.querySelectorAll('.sd-item strong')].map((s) => s.textContent)).toEqual(['Helpdesk']);
  });

  it('says when nothing has been shared', async () => {
    const { fixture, http, el } = await render();
    http.expectOne('/api/staff/documents').flush([]);
    await settle(fixture);
    expect(el.textContent).toContain('No documents have been shared with you yet.');
  });
});
