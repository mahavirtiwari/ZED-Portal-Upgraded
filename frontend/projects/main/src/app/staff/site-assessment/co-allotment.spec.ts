import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CoAllotmentPage } from './co-allotment';

describe('CoAllotmentPage', () => {
  it('shows the consultant details as the old page: each id over its names', async () => {
    await TestBed.configureTestingModule({
      imports: [CoAllotmentPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(CoAllotmentPage);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/staff/site-assessment/consultancy/allotments').flush({
      units: [{
        ZedId: 'ZEDMSME000836', Certification: 'Silver', NcCount: 1, SiteAssessorId: 'ZEDCC0015', SaAssessorName: 'Lead One',
        CoAssessorId: 'ZEDCC1019', CoConsultantNames: 'Co One', TechExpert: 'ZEDTE01', TechnicalExpertNames: 'Expert One',
      }],
      consultants: [],
      technicalExperts: [],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const cell = (fixture.nativeElement as HTMLElement).querySelector('td.consultants')!;
    expect(cell.textContent).toMatch(/^\s*ZEDCC0015\s*Lead One\s*ZEDCC1019\s*Co One\s*ZEDTE01\s*Expert One\s*$/);
    expect(cell.querySelectorAll('br').length).toBe(7);
    expect(cell.textContent).not.toContain('Lead:');
    http.verify();
  });
});
