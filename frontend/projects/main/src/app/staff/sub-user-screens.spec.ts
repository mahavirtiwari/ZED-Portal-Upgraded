import { blockedScreen } from './sub-user-screens';

describe('sub-user screens (2026-11-21)', () => {
  const masterAdmin = 7;

  it('blocks an owner menu screen that was not given, and its sub-pages', () => {
    expect(blockedScreen('/staff/sub-users', masterAdmin, [], ['/staff/expenditure'])).toBe('/staff/sub-users');
    expect(blockedScreen('/staff/users/agencies/new', masterAdmin, [], ['/staff/expenditure'])).toBe('/staff/users/agencies');
    expect(blockedScreen('/staff/quality-observations?days=90', masterAdmin, [], ['/staff/expenditure'])).toBe('/staff/quality-observations');
  });

  it('leaves the given screens, the always-open ones, drill-down pages and non sub-users alone', () => {
    expect(blockedScreen('/staff/expenditure', masterAdmin, [], ['/staff/expenditure'])).toBeNull();
    expect(blockedScreen('/staff/dashboard', masterAdmin, [], ['/staff/expenditure'])).toBeNull();
    expect(blockedScreen('/staff', masterAdmin, [], ['/staff/expenditure'])).toBeNull();
    expect(blockedScreen('/staff/msme-profile/ZEDM000005', masterAdmin, [], ['/staff/expenditure'])).toBeNull();
    expect(blockedScreen('/staff/assessment/da-details/ZEDM000005/Silver', masterAdmin, [], ['/staff/expenditure'])).toBeNull();
    expect(blockedScreen('/staff/sub-users', masterAdmin, [], null)).toBeNull();
  });
});
