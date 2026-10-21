import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { USERS_ROUTES } from '../users/users.routes';
import { MASTERS_ROUTES } from './masters.routes';
import { TechnologiesPage } from './technologies';
import { TechnologyFormPage } from './technology-form';

async function settle(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

const tech = { id: 9, technologyCode: 'T1', technologyName: 'Solar', description: 'Roof top', sectors: ['24-Basic metals', '99-Old sector'], categories: ['C1 -Energy'], isActive: true };

describe('TechnologiesPage', () => {
  it('lists technologies and deactivates one after confirmation', async () => {
    await TestBed.configureTestingModule({ imports: [TechnologiesPage], providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(TechnologiesPage);
    const http = TestBed.inject(HttpTestingController);
    const el: HTMLElement = fixture.nativeElement;
    await settle(fixture);
    http.expectOne('/api/staff/masters/technologies').flush([tech]);
    await settle(fixture);
    expect([...el.querySelectorAll('tbody td:nth-child(3) p')].map((p) => p.textContent!.trim())).toEqual(['24-Basic metals', '99-Old sector']);
    expect(el.querySelector('tbody a')!.getAttribute('href')).toBe('/staff/masters/technologies/9');

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    ([...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'DE-ACTIVE') as HTMLButtonElement).click();
    await settle(fixture);
    const req = http.expectOne('/api/staff/masters/technologies/9/active');
    expect(req.request.body).toEqual({ isActive: false });
    req.flush({ message: 'Technology deactivated successfully.' });
    await settle(fixture);
    http.expectOne('/api/staff/masters/technologies').flush([{ ...tech, isActive: false }]);
    await settle(fixture);
    expect(el.querySelector('.alert-success')!.textContent).toContain('deactivated');
    http.verify();
    vi.restoreAllMocks();
  });
});

describe('TechnologyFormPage', () => {
  it('edits a technology keeping its stored sectors', async () => {
    await TestBed.configureTestingModule({
      imports: [TechnologyFormPage],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: '9' }) } } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(TechnologyFormPage);
    const http = TestBed.inject(HttpTestingController);
    const el: HTMLElement = fixture.nativeElement;
    await settle(fixture);
    http.expectOne('/api/staff/masters/technologies/options').flush({ sectors: ['24-Basic metals', '25-Metal products'], categories: ['C1 -Energy'] });
    await settle(fixture);
    http.expectOne('/api/staff/masters/technologies').flush([tech]);
    await settle(fixture);
    expect(el.querySelector('h3')!.textContent).toContain('Edit Technology');
    expect((el.querySelector('#technologyCode') as HTMLInputElement).value).toBe('T1');
    expect(el.querySelectorAll('zed-multi-select')[0].querySelectorAll('.chip').length).toBe(2);

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    const req = http.expectOne('/api/staff/masters/technologies/9');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ technologyCode: 'T1', technologyName: 'Solar', description: 'Roof top', sectors: ['24-Basic metals', '99-Old sector'], categories: ['C1 -Energy'] });
    req.flush({ message: 'Technology data updated.' });
    await settle(fixture);
    expect(navigate).toHaveBeenCalledWith(['/staff/masters/technologies'], { state: { message: 'Technology data updated.' } });
    http.verify();
  });
});

describe('route tables', () => {
  it('guards every user and master screen', () => {
    for (const r of [...USERS_ROUTES, ...MASTERS_ROUTES].filter((x) => !x.redirectTo)) {
      expect(r.canActivate?.length, r.path).toBe(1);
    }
    expect(USERS_ROUTES.map((r) => r.path)).toContain('agencies/:userId');
    expect(MASTERS_ROUTES.map((r) => r.path)).toContain('parameters/:sectionType');
  });
});
