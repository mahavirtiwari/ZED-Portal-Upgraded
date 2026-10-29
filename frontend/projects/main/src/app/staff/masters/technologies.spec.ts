import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { routes } from '../../app.routes';
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

/** Each stat tile as "value label". */
const stats = (el: HTMLElement) => [...el.querySelectorAll('.stat')].map((s) => `${s.querySelector('.stat-value')!.textContent!.trim()} ${s.querySelector('.stat-label')!.textContent!.trim()}`);

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
    expect([...el.querySelectorAll('tbody td:nth-child(3) .zed-chip')].map((p) => p.textContent!.trim())).toEqual(['24-Basic metals', '99-Old sector']);
    expect(el.querySelector('tbody .status-badge')!.textContent!.trim()).toBe('Active');
    expect(el.querySelector('tbody a')!.getAttribute('href')).toBe('/staff/masters/technologies/9');

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    ([...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Deactivate') as HTMLButtonElement).click();
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

  it('shows the counts and filters by status and by category', async () => {
    await TestBed.configureTestingModule({ imports: [TechnologiesPage], providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(TechnologiesPage);
    const http = TestBed.inject(HttpTestingController);
    const el: HTMLElement = fixture.nativeElement;
    await settle(fixture);
    http.expectOne('/api/staff/masters/technologies').flush([
      tech,
      { ...tech, id: 10, technologyCode: 'T2', technologyName: 'Wind', categories: ['C2 -Water', 'C1 -Energy'], isActive: false },
      { ...tech, id: 11, technologyCode: 'T3', technologyName: 'Rain water', categories: ['C2 -Water'] },
    ]);
    await settle(fixture);
    const text = (sel: string) => [...el.querySelectorAll(sel)].map((t) => t.textContent!.replace(/\s+/g, ' ').trim());
    const names = () => text('tbody .tech-name');
    const click = (sel: string, label: string) => ([...el.querySelectorAll(sel)].find((b) => b.textContent!.trim().startsWith(label)) as HTMLButtonElement).click();
    expect(stats(el)).toEqual(['3 Technologies', '2 Active (MSMEs can choose them)', '1 Inactive', '2 Categories in use']);
    expect(text('.cat-chip')).toEqual(['All', 'C1 -Energy 2', 'C2 -Water 2']);

    click('.seg button', 'Inactive');
    await settle(fixture);
    expect(names()).toEqual(['Wind']);
    click('.seg button', 'All');
    await settle(fixture);
    click('.cat-chip', 'C2 -Water');
    await settle(fixture);
    expect(names()).toEqual(['Wind', 'Rain water']);
    click('.seg button', 'Active');
    await settle(fixture);
    expect(names()).toEqual(['Rain water']);
    click('.seg button', 'Inactive');
    click('.cat-chip', 'C1 -Energy');
    await settle(fixture);
    expect(names()).toEqual(['Wind']);
    click('.cat-chip', 'All');
    click('.seg button', 'Active');
    await settle(fixture);
    expect(names()).toEqual(['Solar', 'Rain water']);
    expect(el.querySelector('.cat-chip.is-on')!.textContent!.trim()).toBe('All');
    http.verify();
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
    // Stays on the form with the values, as the old page.
    expect(navigate).not.toHaveBeenCalled();
    expect(el.querySelector('.alert-success')!.textContent).toContain('Technology data updated.');
    expect((el.querySelector('#technologyCode') as HTMLInputElement).value).toBe('T1');
    http.verify();
    vi.restoreAllMocks();
  });

  it('clears the form after adding a technology and stays on the page', async () => {
    await TestBed.configureTestingModule({
      imports: [TechnologyFormPage],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({}) } } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(TechnologyFormPage);
    const http = TestBed.inject(HttpTestingController);
    const el: HTMLElement = fixture.nativeElement;
    await settle(fixture);
    http.expectOne('/api/staff/masters/technologies/options').flush({ sectors: ['24-Basic metals'], categories: [] });
    await settle(fixture);
    expect(el.querySelector('h3')!.textContent).toContain('Add New Technology');
    for (const [id, value] of [['#technologyCode', 'T2'], ['#technologyName', 'Wind']]) {
      const input = el.querySelector(id) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    await settle(fixture);
    // The preview beside the form shows the technology as the list will.
    expect(el.querySelector('.tf-preview .code-badge')!.textContent!.trim()).toBe('T2');
    expect(el.querySelector('.tf-preview .tf-name')!.textContent!.trim()).toBe('Wind');
    expect([...el.querySelectorAll('.tf-section h4')].map((h) => h.textContent!.trim())).toEqual(['1Technology', '2Where it applies', '3Description']);

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    const req = http.expectOne('/api/staff/masters/technologies');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ technologyCode: 'T2', technologyName: 'Wind', description: '', sectors: [], categories: [] });
    req.flush({ message: 'Technology saved.' });
    await settle(fixture);
    await settle(fixture);
    expect(navigate).not.toHaveBeenCalled();
    expect(el.querySelector('.alert-success')!.textContent).toContain('Sector saved.');
    expect((el.querySelector('#technologyCode') as HTMLInputElement).value).toBe('');
    expect(el.querySelector('.help-block')).toBeNull();
    http.verify();
    vi.restoreAllMocks();
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

  it('redirects bookmarked edit addresses of the old site to the new forms', () => {
    const redirect = (path: string) => routes.find((r) => r.path === path)?.redirectTo;
    expect(redirect('User/Assessor/:id')).toBe('staff/users/assessors/:id');
    expect(redirect('Technology/Create/:id')).toBe('staff/masters/technologies/:id');
    expect(redirect('Technology/Create')).toBe('staff/masters/technologies/new');
    expect(USERS_ROUTES.map((r) => r.path)).toContain('assessors/:userId');
    expect(MASTERS_ROUTES.map((r) => r.path)).toContain('technologies/:id');
  });
});
