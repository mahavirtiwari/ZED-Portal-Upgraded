import { formatDate } from '@angular/common';
import { LOCALE_ID, Pipe, PipeTransform, inject } from '@angular/core';

/** Indian Standard Time, as Angular's date formatting takes a zone. */
export const INDIAN_ZONE = '+0530';

/**
 * A UTC time sent without a zone ("2026-11-03T10:15:00", a C# DateTime of SYSUTCDATETIME()) marked as UTC, so it is not
 * read as the browser's own time. A value that already has a zone (Z or +05:30) is kept.
 */
export function asUtc(value: string | null): string | null;
export function asUtc(value: string | null | undefined): string | null | undefined;
export function asUtc(value: string | null | undefined): string | null | undefined {
  if (!value) return value;
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : value + 'Z';
}

/**
 * 2026-11-19 (admin audit: "last change 18-11-2026 23:01" for a save at 04:31 IST): a time the API stores in UTC, shown in
 * Indian time whatever the viewer's computer is set to. '' for none.
 */
export function indianTime(value: string | null | undefined, format = 'dd-MM-yyyy HH:mm', locale = 'en-US'): string {
  const v = asUtc(value);
  if (!v) return '';
  try {
    return formatDate(v, format, locale, INDIAN_ZONE);
  } catch {
    return value ?? '';
  }
}

/**
 * <code>{{ x.updatedOn | indianTime }}</code> (or <code>| indianTime: 'dd-MM-yyyy'</code>): for the "last saved / changed on"
 * times the API sends in UTC without a zone (SYSUTCDATETIME columns). Not for the legacy tables' GETDATE() times.
 */
@Pipe({ name: 'indianTime' })
export class IndianTimePipe implements PipeTransform {
  private readonly locale = inject(LOCALE_ID);

  transform(value: string | null | undefined, format = 'dd-MM-yyyy HH:mm'): string {
    return indianTime(value, format, this.locale);
  }
}
