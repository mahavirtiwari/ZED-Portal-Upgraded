import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { StaffRoleDocumentsPage } from './staff-documents';

describe('StaffRoleDocumentsPage', () => {
  async function render() {
    TestBed.configureTestingModule({ imports: [StaffRoleDocumentsPage], providers: [provideHttpClient(), provideHttpClientTesting()] });
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

  it('lists the documents shared with the role, with downloads, videos and a search', async () => {
    const { fixture, http, el } = await render();
    http.expectOne('/api/staff/documents').flush([
      { id: 7, documentName: 'Assessor handbook', description: 'Read before a visit', downloadUrl: '/api/staff/documents/7/file', videoUrl: null, createdDate: null },
      { id: 9, documentName: 'Tour', description: null, downloadUrl: null, videoUrl: 'https://www.youtube.com/watch?v=t', createdDate: '2026-10-01T10:00:00' },
    ]);
    await settle(fixture);
    const links = [...el.querySelectorAll('.sd-item a')].map((a) => `${a.textContent!.trim()} ${a.getAttribute('href')}`);
    expect(links).toEqual(['Download /api/staff/documents/7/file', 'Watch https://www.youtube.com/watch?v=t']);
    expect(el.textContent).toContain('Read before a visit');

    const search = el.querySelector('input[type=search]') as HTMLInputElement;
    search.value = 'tour';
    search.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect([...el.querySelectorAll('.sd-item strong')].map((s) => s.textContent)).toEqual(['Tour']);
    http.verify();
  });

  it('says when nothing has been shared', async () => {
    const { fixture, http, el } = await render();
    http.expectOne('/api/staff/documents').flush([]);
    await settle(fixture);
    expect(el.textContent).toContain('No documents have been shared with you yet.');
  });
});
