import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { SurveillanceUsersPage } from './surveillance-users';

describe('surveillance agencies and assessors', () => {
  function create(kind: 'agencies' | 'assessors') {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: ActivatedRoute, useValue: { snapshot: { data: { kind } } } }],
    });
    const fixture = TestBed.createComponent(SurveillanceUsersPage);
    return { fixture, http: TestBed.inject(HttpTestingController) };
  }

  const agency = {
    userId: 'ZEDAA0001', userName: 'Acme', spocName: 'Spoc', email: 'a@acme.test', mobileNo: '9', isActive: true, reasonForRejection: null,
    desktopVerification: true, siteVerification: false, allowBronzeSurveillance: false, reasonForRejectionForBS: null, tuPreferredState: '9', noOfUsers: 2,
  };

  it('lists the agencies with their Bronze surveillance state and preferred state', async () => {
    const { fixture, http } = create('agencies');
    http.expectOne('/api/staff/surveillance-users/agencies').flush([agency]);
    http.expectOne('/api/staff/surveillance-users/states').flush([{ code: '9', name: 'UTTAR PRADESH' }]);
    await fixture.whenStable();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Bronze Surveillance Agencies');
    expect(text).toContain('ZEDAA0001');
    expect(text).toContain('Not allowed');
    expect(text).toContain('UTTAR PRADESH');
  });

  it('enables Bronze surveillance with the state and districts', async () => {
    const { fixture, http } = create('agencies');
    http.expectOne('/api/staff/surveillance-users/agencies').flush([agency]);
    http.expectOne('/api/staff/surveillance-users/states').flush([{ code: '9', name: 'UTTAR PRADESH' }]);
    await fixture.whenStable();
    fixture.detectChanges();
    const page = fixture.componentInstance as unknown as { openBronze(a: unknown): Promise<void>; saveBronze(d: unknown): Promise<void>; bronze(): unknown };
    const opening = page.openBronze(agency);
    http.expectOne('/api/staff/surveillance-users/agencies/ZEDAA0001').flush({ agency, districts: ['160'] });
    await Promise.resolve();
    await Promise.resolve();
    http.expectOne((r) => r.url === '/api/staff/surveillance-users/districts').flush([{ districtCode: '160', districtName: 'Agra' }]);
    await opening;
    const dialog = page.bronze() as { allow: boolean; state: string; districts: string[] };
    dialog.allow = true;
    const saving = page.saveBronze(dialog);
    const put = http.expectOne('/api/staff/surveillance-users/agencies/ZEDAA0001/bronze-surveillance');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ allow: true, preferredState: '9', districts: ['160'] });
    put.flush({ message: 'Bronze surveillance enabled.' });
    await Promise.resolve();
    http.match(() => true).forEach((r) => r.flush([]));
    await saving;
  });

  it('lists assessors and blocks one with a reason', async () => {
    const { fixture, http } = create('assessors');
    http.expectOne('/api/staff/surveillance-users/assessors').flush([
      { userId: 'ZEDAS0001', userName: 'Asr', email: null, mobileNo: null, isActive: true, reasonForRejection: null, desktopVerification: true,
        siteVerification: false, allowBronzeSurveillance: true, agencyUserId: 'AGENCY1', agencyUserName: 'Acme' },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('ZEDAS0001');
    const page = fixture.componentInstance as unknown as { confirmBlock(b: unknown): Promise<void> };
    const blocking = page.confirmBlock({ kind: 'assessors', userId: 'ZEDAS0001', reason: ' Left ' });
    const post = http.expectOne('/api/staff/surveillance-users/assessors/ZEDAS0001/block');
    expect(post.request.body).toEqual({ reason: 'Left' });
    post.flush({ message: 'User Blocked successful' });
    await Promise.resolve();
    http.match(() => true).forEach((r) => r.flush([]));
    await blocking;
  });

  it('shows the old agency columns with the Bronze surveillance setting and Reset Link in Actions', async () => {
    const { fixture, http } = create('agencies');
    http.expectOne('/api/staff/surveillance-users/agencies').flush([{ ...agency, address: '12 Mill Road', pinCode: '208001' }]);
    http.expectOne('/api/staff/surveillance-users/states').flush([{ code: '9', name: 'UTTAR PRADESH' }]);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const table = el.querySelector('table')!;
    expect(table.classList).toContain('table-zed');
    expect(table.classList).toContain('table-bordered');
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent!.trim())).toEqual([
      'Status', 'Agency Id', 'Agency Details', 'Spoc Details', 'No. of Assessors', 'Actions',
    ]);
    const cells = [...table.querySelectorAll('tbody tr td')];
    expect(cells[0].textContent!.trim()).toBe('Active');
    expect(cells[1].textContent!.trim()).toBe('ZEDAA0001');
    expect(cells[2].textContent).toContain('Acme');
    expect(cells[2].textContent).toContain('12 Mill Road');
    expect(cells[2].textContent).toContain('208001');
    expect(cells[3].textContent).toContain('Spoc');
    expect(cells[4].textContent!.trim()).toBe('2');
    const actions = [...cells[5].querySelectorAll('button')].map((b) => b.textContent!.trim());
    expect(actions).toEqual(['Block', 'Bronze Surveillance', 'Reset Link']);
  });

  it('shows the old assessor columns with the Bronze surveillance switch in Actions', async () => {
    const { fixture, http } = create('assessors');
    http.expectOne('/api/staff/surveillance-users/assessors').flush([
      { userId: 'ZEDAS0001', userName: 'Asr', email: 'a@x.test', mobileNo: '98', isActive: false, reasonForRejection: null, desktopVerification: true,
        siteVerification: false, allowBronzeSurveillance: true, agencyUserId: 'AGENCY1', agencyUserName: 'Acme', address: 'Kanpur', idProofNumber: 'ID-77' },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();
    const table = (fixture.nativeElement as HTMLElement).querySelector('table')!;
    expect(table.classList).toContain('table-zed');
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent!.trim())).toEqual([
      'Status', 'Assessor ID', 'Assessor Details', 'Assessor Contact Details', 'Action(s)',
    ]);
    const cells = [...table.querySelectorAll('tbody tr td')];
    expect(cells[0].textContent!.trim()).toBe('In-Active');
    expect(cells[2].textContent).toContain('Kanpur');
    expect(cells[2].textContent).toContain('ID-77');
    expect(cells[3].textContent).toContain('98');
    expect(cells[4].querySelector('input[type=checkbox]')).not.toBeNull();
    expect(cells[4].textContent).toContain('UnBlock');
    expect(cells[4].textContent).not.toContain('Reset Link');
  });
});
