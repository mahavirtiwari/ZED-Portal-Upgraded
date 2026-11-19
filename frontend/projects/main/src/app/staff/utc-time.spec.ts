import { TestBed } from '@angular/core/testing';
import { IndianTimePipe, asUtc, indianTime } from './utc-time';

describe('utc-time (2026-11-19 admin audit: UTC save times shown 5½ hours early)', () => {
  it('marks a time sent without a zone as UTC and keeps one that has a zone', () => {
    expect(asUtc('2026-11-18T23:01:55')).toBe('2026-11-18T23:01:55Z');
    expect(asUtc('2026-11-18T23:01:55.123')).toBe('2026-11-18T23:01:55.123Z');
    expect(asUtc('2026-11-18T23:01:55Z')).toBe('2026-11-18T23:01:55Z');
    expect(asUtc('2026-11-19T04:31:55+05:30')).toBe('2026-11-19T04:31:55+05:30');
    expect(asUtc(null)).toBeNull();
    expect(asUtc(undefined)).toBeUndefined();
  });

  it('shows a UTC time in Indian time, whatever the computer is set to', () => {
    expect(indianTime('2026-11-18T23:01:55')).toBe('19-11-2026 04:31');
    expect(indianTime('2026-11-18T23:01:55', 'dd MMM yyyy')).toBe('19 Nov 2026');
    expect(indianTime('2026-11-19T04:31:55+05:30')).toBe('19-11-2026 04:31');
    expect(indianTime(null)).toBe('');
    expect(indianTime('not a date')).toBe('not a date');
  });

  it('is a pipe for the templates', () => {
    const pipe = TestBed.runInInjectionContext(() => new IndianTimePipe());
    expect(pipe.transform('2026-11-18T23:22:10')).toBe('19-11-2026 04:52');
    expect(pipe.transform('2026-11-18T23:22:10', 'dd-MM-yyyy')).toBe('19-11-2026');
    expect(pipe.transform(null)).toBe('');
  });
});
