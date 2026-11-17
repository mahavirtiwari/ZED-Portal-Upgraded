import { addMonths, monthYear, nextSurveillance, parseShortDate, shortDate, validTill, validityOf } from './certification-dates';

// 2026-11-18 (the user's applicant designs, zed-msme-01): the header card's Valid till and Next surveillance.
describe('certification dates', () => {
  const nov14 = new Date(2026, 10, 14);

  it('reads the dates the descriptions give', () => {
    expect(parseShortDate('14 Nov 2026')?.getTime()).toBe(nov14.getTime());
    expect(parseShortDate('31 Feb 2026')).toBeNull();
    expect(parseShortDate('Certified')).toBeNull();
    expect(parseShortDate('')).toBeNull();
  });

  it('adds months as .NET does, keeping the day or the month\'s last day', () => {
    expect(shortDate(addMonths(new Date(2026, 0, 31), 1))).toBe('28 Feb 2026');
    expect(shortDate(addMonths(new Date(2028, 0, 31), 1))).toBe('29 Feb 2028');
    expect(shortDate(addMonths(nov14, 18))).toBe('14 May 2028');
  });

  it('is valid till the day before the validity ends', () => {
    expect(shortDate(validTill(nov14, 60))).toBe('13 Nov 2031');
    expect(shortDate(validTill(new Date(2024, 5, 1), 36))).toBe('31 May 2027');
    expect(shortDate(validTill(new Date(2024, 0, 1), 12))).toBe('31 Dec 2024');
  });

  it('gives the first surveillance month not yet past', () => {
    expect(monthYear(nextSurveillance(nov14, [18, 36], new Date(2026, 10, 18))!)).toBe('May 2028');
    // Still due in its own month; then the next visit.
    expect(monthYear(nextSurveillance(nov14, [36, 18], new Date(2028, 4, 30))!)).toBe('May 2028');
    expect(monthYear(nextSurveillance(nov14, [18, 36], new Date(2028, 5, 1))!)).toBe('Nov 2029');
    expect(nextSurveillance(nov14, [18, 36], new Date(2029, 11, 1))).toBeNull();
    expect(nextSurveillance(nov14, [], new Date(2026, 10, 18))).toBeNull();
  });

  it('reads the validity of a level from api/public/levels', () => {
    expect(validityOf({ validityMonths: 36, surveillance: { firstDueMonths: 15, count: 2, intervalMonths: 12 } }))
      .toEqual({ validityMonths: 36, surveillanceMonths: [15, 27] });
    expect(validityOf({ validityMonths: 60, surveillance: { firstDueMonths: 18, count: null, intervalMonths: null } }))
      .toEqual({ validityMonths: 60, surveillanceMonths: [18] });
    expect(validityOf({ validityMonths: 36, surveillance: null })).toEqual({ validityMonths: 36, surveillanceMonths: [] });
    expect(validityOf({ code: 'Gold' } as object)).toBeNull();
    expect(validityOf(undefined)).toBeNull();
  });
});
