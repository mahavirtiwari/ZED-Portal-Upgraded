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

  it('shows each menu as a card with its headings', async () => {
    const el = await render(1, 'Admin');
    expect(el.querySelector('h3')!.textContent).toContain('Welcome, Test User');
    const cards = [...el.querySelectorAll('.group-card h4')].map((h) => h.textContent!.trim());
    expect(cards).toEqual(['Masters', 'Questionnaire', 'Technology Upgradation', 'Incentives', 'Administration']);
    const questionnaire = [...el.querySelectorAll('.group-card')].find((c) => c.querySelector('h4')!.textContent!.trim() === 'Questionnaire')!;
    expect([...questionnaire.querySelectorAll('li')].map((li) => li.textContent!.replace('›', '').trim())).toEqual(['Bronze', 'Silver', 'Gold', 'ESG Checklist']);
    expect(el.querySelector('.group-card')!.textContent).toContain('Sectors');
    // No row per state: the long incentives list is a chooser.
    const incentives = [...el.querySelectorAll('.group-card')].find((c) => c.querySelector('h4')!.textContent!.trim() === 'Incentives')!;
    expect(incentives.querySelector('select')).not.toBeNull();
    expect(incentives.querySelectorAll('li').length).toBe(0);
  });

  it('shows the single screens of a role as tiles', async () => {
    const el = await render(10, 'SuperAdmin');
    const tiles = [...el.querySelectorAll('a.tile')].map((a) => a.textContent!.replace(/\s+/g, ' ').trim());
    expect(tiles).toEqual(expect.arrayContaining([expect.stringContaining('Reports'), expect.stringContaining('Registered MSMEs')]));
    expect(tiles.some((t) => t.includes('Customer History'))).toBe(false);
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
