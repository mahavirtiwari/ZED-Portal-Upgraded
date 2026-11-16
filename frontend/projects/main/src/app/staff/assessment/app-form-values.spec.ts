import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AppFormValuesPanel } from './app-form-values';

describe('AppFormValuesPanel', () => {
  it('shows the repeating entries of an own field as a table with their photos (2026-11-16)', async () => {
    await TestBed.configureTestingModule({ imports: [AppFormValuesPanel], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    const fixture = TestBed.createComponent(AppFormValuesPanel);
    fixture.componentRef.setInput('zedId', 'Z1');
    fixture.componentRef.setInput('certification', 'Silver');
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/staff/app-form-values/Z1/Silver').flush([{
      form: 'msme.basicInfo', name: 'Basic Information', app: 'MSME app', values: [
        { key: 'cf_gst', label: 'GST number', type: 'text', value: '27AAAC', enabled: true, submittedBy: null, updatedOn: null },
        {
          key: 'cf_machines', label: 'Machines', type: 'rows', value: '2 entries', enabled: true, submittedBy: null, updatedOn: null,
          entries: [
            [{ label: 'Machine', type: 'text', text: 'Press', photoUrls: [] }, { label: 'Photo', type: 'photo', text: '', photoUrls: ['/api/staff/app-form-values/Z1/Silver/photos/msme.basicInfo/p1'] }],
            [{ label: 'Machine', type: 'text', text: 'Lathe', photoUrls: [] }, { label: 'Photo', type: 'photo', text: '', photoUrls: [] }],
          ],
        },
      ],
    }]);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const table = el.querySelector('[data-entries]')!;
    expect([...table.querySelectorAll('thead th')].map((t) => t.textContent!.trim())).toEqual(['#', 'Machine', 'Photo']);
    expect([...table.querySelectorAll('tr')].filter((r) => r.querySelector('td')).map((r) => r.children[1].textContent!.trim())).toEqual(['Press', 'Lathe']);
    expect(table.querySelector('img')!.getAttribute('src')).toContain('/api/staff/app-form-values/Z1/Silver/photos/msme.basicInfo/p1');
    expect(el.textContent).toContain('27AAAC');
    http.verify();
  });
});
