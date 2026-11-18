import { TestBed } from '@angular/core/testing';
import { PhoneChip, PhoneSummary, hasPhone, phoneChip, phonesById, releaseMobileAsk } from './assessor-phone';

const registered: PhoneSummary = {
  userId: 'ZEDAS0001', app: 'SA', appName: 'Site assessment app', model: 'Samsung SM-A515F', make: 'Samsung',
  lastLoginAt: '2026-11-17T10:00:00', refusedToday: false, lastRefusedAt: null,
};

describe('Phone chip', () => {
  it('says registered with the make and model, not registered, or refused today in amber', () => {
    expect(phoneChip(registered)).toMatchObject({ label: 'Registered · Samsung SM-A515F', tone: 'ok' });
    expect(phoneChip(null)).toMatchObject({ label: 'Not registered', tone: 'none' });
    expect(phoneChip({ ...registered, model: null, make: null, lastLoginAt: null })).toMatchObject({ label: 'Not registered', tone: 'none' });
    const refused = phoneChip({ ...registered, refusedToday: true });
    expect(refused).toMatchObject({ label: 'Refused sign-in today', tone: 'warn' });
    expect(refused.title).toContain('Samsung SM-A515F');
    expect(hasPhone(registered)).toBe(true);
    expect(hasPhone({ ...registered, model: null, make: null, lastLoginAt: null, refusedToday: true })).toBe(false);
  });

  it('finds a row by its user id whatever the case', () => {
    const map = phonesById([{ ...registered, userId: 'zedas0001 ' }]);
    expect(map.get('ZEDAS0001')?.model).toBe('Samsung SM-A515F');
    expect(phonesById(null).size).toBe(0);
  });

  it('renders the chip with its tone', () => {
    const fixture = TestBed.createComponent(PhoneChip);
    fixture.componentRef.setInput('phone', { ...registered, refusedToday: true });
    fixture.detectChanges();
    const chip = (fixture.nativeElement as HTMLElement).querySelector('[data-phone]')!;
    expect(chip.classList).toContain('is-warn');
    expect(chip.textContent!.trim()).toBe('Refused sign-in today');
  });

  it('asks for a reason before releasing', () => {
    const ask = releaseMobileAsk('Mahavir Tiwari', 'ZEDAS0001', 'Samsung SM-A515F', 'assessor');
    expect(ask.title).toBe('Release the mobile of Mahavir Tiwari?');
    expect(ask.subtitle).toBe('ZEDAS0001 · Samsung SM-A515F');
    expect(ask.confirmLabel).toBe('Release Mobile');
    expect(ask.reason?.required).not.toBe(false);
    expect(ask.points?.[0]).toBe('The assessor can no longer use the app on the Samsung SM-A515F.');
  });
});
