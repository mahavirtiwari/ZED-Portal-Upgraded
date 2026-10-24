import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '@zed/shared';
import { StaffHomePage } from './staff-home';

describe('StaffHomePage', () => {
  async function render(roleId: number, role: string) {
    TestBed.configureTestingModule({ imports: [StaffHomePage], providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    TestBed.inject(AuthService).setUser({ userId: 'U1', userName: 'Test User', roleId, role, subRoles: [] });
    const fixture = TestBed.createComponent(StaffHomePage);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).match('/api/config').forEach((r) => r.flush({ legacyPortalUrl: '' }));
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows single screens as tiles and menu groups as cards', async () => {
    const el = await render(1, 'Admin');
    expect(el.querySelector('h3')!.textContent).toContain('Welcome, Test User');
    const tiles = [...el.querySelectorAll('a.tile')].map((a) => a.textContent!.replace(/\s+/g, ' ').trim());
    expect(tiles).toEqual(expect.arrayContaining([expect.stringContaining('Sectors'), expect.stringContaining('Payments')]));
    const cards = [...el.querySelectorAll('.group-card h4')].map((h) => h.textContent!.trim());
    expect(cards).toEqual(expect.arrayContaining(['Questionnaire', 'Settings']));
    // No row per state: the long incentives group is a chooser.
    expect(el.textContent).not.toContain('OPEN');
    const incentives = [...el.querySelectorAll('.group-card')].find((c) => c.querySelector('h4')!.textContent!.trim() === 'Incentives')!;
    expect(incentives.querySelector('select')).not.toBeNull();
    expect(incentives.querySelectorAll('li').length).toBe(0);
  });

  it('opens the screen picked in a chooser', async () => {
    const el = await render(1, 'Admin');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const select = [...el.querySelectorAll('.group-card')].find((c) => c.querySelector('h4')!.textContent!.trim() === 'Incentives')!.querySelector('select')!;
    select.value = '0';
    select.dispatchEvent(new Event('change'));
    expect(navigate).toHaveBeenCalledWith(['/staff/incentives'], expect.objectContaining({ queryParams: expect.any(Object) }));
  });
});
