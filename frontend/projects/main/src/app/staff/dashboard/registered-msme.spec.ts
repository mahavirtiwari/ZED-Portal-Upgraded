import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthService } from '@zed/shared';
import { RegisteredMsmePage } from './registered-msme';

describe('RegisteredMsmePage', () => {
  let fixture: ComponentFixture<RegisteredMsmePage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  const row = {
    RowNumber: 1, ZedId: 'ZEDMSME000001', Certification: 'Silver', CertificationPhase: 'Certification', PUnitName: 'Acme',
    RegisteredDate: '2024-01-02T10:00:00', AssessmentStatus: 'SA Verification in progress', FirstSurveDueDate: null,
    UnitAddress: 'Plot 4', PStateName: 'ASSAM', CertificationStatus: 13,
  };

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function render(roleId: number, extra: Record<string, unknown> = {}) {
    TestBed.inject(AuthService).setUser({ userId: 'U1', userName: 'U1', roleId, role: 'x', subRoles: [] });
    fixture = TestBed.createComponent(RegisteredMsmePage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    for (const r of http.match('/api/config')) r.flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: 'https://old.example' });
    const req = http.expectOne((r) => r.url === '/api/staff/dashboard/registered-msme');
    expect(req.request.params.get('pageNo')).toBe('1');
    expect(req.request.params.get('searchBy')).toBe('Zed Id');
    req.flush({ rows: [{ ...row, ...extra }], totalCounts: 31, pageNo: 1, pageSize: 10 });
    await settle();
  }

  const button = (label: string) => [...el.querySelectorAll('button, a')].find((b) => b.textContent!.trim().startsWith(label)) as HTMLElement | undefined;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RegisteredMsmePage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  afterEach(() => http.verify());

  it('shows QC users the list and current-portal links but no admin column or actions', async () => {
    await render(17);
    expect(el.textContent).toContain('Acme');
    expect(el.textContent).not.toContain('Assessment Agency');
    expect(button('Resend Details')).toBeUndefined();
    expect(button('IN-ACTIVE MSME')).toBeUndefined();
    expect(button('Assessment')!.getAttribute('href')).toBe('/staff/assessment/sa-details/ZEDMSME000001/Silver');
    expect([...el.querySelectorAll('select[aria-label="Page"] option')].length).toBe(4);
  });

  it('lets SuperAdmin deactivate a unit with a reason', async () => {
    await render(10, { CertificationBodyUserId: 'AGENCY1', UserName: 'Agency One', UdyogAadharNo: 'UDYAM-UP-29-0003915' });
    expect(el.textContent).toContain('UDYAM-UP-29-0003915');

    button('IN-ACTIVE MSME')!.click();
    await settle();
    const submit = [...el.querySelectorAll('.modal button')].find((b) => b.textContent!.trim() === 'SUBMIT') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    const textarea = el.querySelector('#disableRemarks') as HTMLTextAreaElement;
    textarea.value = 'Duplicate unit';
    textarea.dispatchEvent(new Event('input'));
    await settle();
    expect(submit.disabled).toBe(false);
    submit.click();
    await settle();

    const req = http.expectOne('/api/staff/dashboard/registered-msme/ZEDMSME000001/disable');
    expect(req.request.body).toEqual({ disableRemarks: 'Duplicate unit' });
    req.flush({ message: 'MSME deactivated.' });
    await settle();
    expect(el.querySelector('.modal')).toBeNull();
    expect(el.textContent).toContain('DISABLED');
  });

  it('searches by the chosen field from page 1', async () => {
    await render(11);
    (el.querySelector('#searchBy') as HTMLSelectElement).value = 'Unit Name';
    el.querySelector('#searchBy')!.dispatchEvent(new Event('change'));
    const input = el.querySelector('#search') as HTMLInputElement;
    input.value = 'Acme';
    input.dispatchEvent(new Event('input'));
    await settle();
    button('Search')!.click();
    await settle();
    const req = http.expectOne((r) => r.url === '/api/staff/dashboard/registered-msme');
    expect(req.request.params.get('searchBy')).toBe('Unit Name');
    expect(req.request.params.get('search')).toBe('Acme');
    req.flush({ rows: [], totalCounts: 0, pageNo: 1, pageSize: 10 });
    await settle();
    expect(el.textContent).toContain('No Data');
  });
});
