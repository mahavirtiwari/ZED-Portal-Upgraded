import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '@zed/shared';
import { PortalSystem } from '../../portal-system';
import { AssessmentResultsPage } from './assessment-results';
import { ASSESSMENT_SYSTEM } from './assessment-shared';

/** The Gender filter of "Completed Surveillance" (ZEDCS_SURVEILLANCE Assessment/Completed.cshtml). */
describe('AssessmentResultsPage gender filter', () => {
  let http: HttpTestingController;
  const empty = { rows: [], totalCount: 0, pageNo: 1, pageSize: 10 };

  async function settle(fixture: ComponentFixture<unknown>) {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function create(system: PortalSystem, kind: 'completed' | 'rejected') {
    await TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: ASSESSMENT_SYSTEM, useValue: system }],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthService).setUser({ userId: 'MADMIN', userName: 'M', roleId: 7, role: 'MasterAdmin', subRoles: [] });
    const fixture = TestBed.createComponent(AssessmentResultsPage);
    fixture.componentRef.setInput('kind', kind);
    await settle(fixture);
    for (const r of http.match('/api/config')) r.flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: 'https://legacy.example.test' });
    return fixture;
  }

  afterEach(() => http.verify());

  it('surveillance Completed: the old options in their order, sent as gender', async () => {
    const fixture = await create('surveillance', 'completed');
    const el: HTMLElement = fixture.nativeElement;
    const first = http.expectOne((r) => r.url === '/api/staff/assessment/completed');
    expect(first.request.params.has('gender')).toBe(false);
    first.flush(empty);
    await settle(fixture);

    const options = [...el.querySelectorAll<HTMLOptionElement>('#resGender option')];
    expect(options.map((o) => o.text.trim())).toEqual(['Show All', 'Male', 'Female', 'Others']);
    expect(options.map((o) => o.value)).toEqual(['', 'male', 'female', 'Others']);

    const select = el.querySelector('#resGender') as HTMLSelectElement;
    select.value = 'female';
    select.dispatchEvent(new Event('change'));
    await settle(fixture);
    const req = http.expectOne((r) => r.url === '/api/staff/assessment/completed');
    expect(req.request.params.get('gender')).toBe('female');
    expect(req.request.params.get('pageNo')).toBe('1');
    req.flush(empty);
  });

  it('main Completed has no Gender filter', async () => {
    const fixture = await create('main', 'completed');
    http.expectOne((r) => r.url === '/api/staff/assessment/completed').flush({ ...empty, pageSize: 20 });
    await settle(fixture);
    expect((fixture.nativeElement as HTMLElement).querySelector('#resGender')).toBeNull();
  });

  it('surveillance Rejected has no Gender filter and sends none', async () => {
    const rejected = await create('surveillance', 'rejected');
    const req = http.expectOne((r) => r.url === '/api/staff/assessment/rejected');
    expect(req.request.params.has('gender')).toBe(false);
    req.flush(empty);
    await settle(rejected);
    expect((rejected.nativeElement as HTMLElement).querySelector('#resGender')).toBeNull();
  });
});
