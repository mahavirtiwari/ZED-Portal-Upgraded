import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { SITE_REVIEW_LEGACY_REDIRECTS, SITE_REVIEW_ROUTES } from './site-review.routes';
import { SiteVerificationPage } from './site-verification';

describe('SiteVerificationPage', () => {
  it('lists the assessor units and links each to the site assessment page', async () => {
    await TestBed.configureTestingModule({
      imports: [SiteVerificationPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(SiteVerificationPage);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/staff/site-review/site-verification').flush({
      rows: [{ ZedId: 'ZEDMSME000001', Certification: 'Gold', CertificationBodyUserId: 'AGENCYSV', AssessorName: 'A Assessor', EnterpriseName: 'Acme', UnitAddress: 'Plot 4', StateName: 'Delhi' }],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Acme');
    // Assessment Agency cell: agency id, line break, assessor name (SiteVerification.cshtml).
    expect(el.querySelectorAll('tbody td')[4].innerHTML).toMatch(/AGENCYSV<br>A Assessor/);
    expect(el.querySelector('a')!.getAttribute('href')).toBe('/staff/assessment/sa-details/ZEDMSME000001/Gold');
    http.verify();
  });

  it('redirects the old SaDetails address to the new page', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'staff', children: SITE_REVIEW_ROUTES.map((r) => ({ path: r.path, children: [] })) }, ...SITE_REVIEW_LEGACY_REDIRECTS])],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/Assessment/SaDetails?zedId=ZEDMSME000001_D_45&Certification=Silver');
    expect(router.url).toBe('/staff/assessment/sa-details/ZEDMSME000001_D_45/Silver');
  });
});
