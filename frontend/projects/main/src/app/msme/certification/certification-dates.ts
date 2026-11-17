/**
 * 2026-11-18 (the user's applicant designs, zed-msme-01): the header card's "Valid till" and "Next surveillance" of a certified
 * level, from the certification date and the level's validity and surveillance months (Administration → Certification Levels).
 * Kept in the certification folder; nothing here is stored, every date is worked out when the page is drawn.
 */

/** The level's validity and the months after certification its surveillance visits fall due (api/msme/certifications). */
export interface LevelValidity {
  validityMonths: number;
  surveillanceMonths: number[];
}

/** A level as api/public/levels gives it (the fields read here only). */
export interface PublicLevelTiming {
  validityMonths?: number | null;
  surveillance?: { firstDueMonths: number; count: number | null; intervalMonths: number | null } | null;
}

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Nov 2026" (as splitDate gives it) → the date; null when it is not one. */
export function parseShortDate(text: string | null | undefined): Date | null {
  const m = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec((text ?? '').trim());
  if (!m) return null;
  const month = SHORT.findIndex((s) => s.toLowerCase() === m[2].toLowerCase());
  if (month < 0) return null;
  const d = new Date(Number(m[3]), month, Number(m[1]));
  return d.getMonth() === month ? d : null;
}

/** The date n months later, the day kept or the month's last day (as .NET AddMonths: 31 Jan + 1 → 28/29 Feb). */
export function addMonths(date: Date, months: number): Date {
  const first = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(date.getDate(), last));
}

/** The last day of validity: the certification date plus the validity, less one day (14 Nov 2026 + 60 months → 13 Nov 2031). */
export function validTill(certified: Date, validityMonths: number): Date {
  const end = addMonths(certified, validityMonths);
  return new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
}

/**
 * The month of the first surveillance visit not yet past (its month is this month or later), or null when every visit is
 * past or the level has none (14 Nov 2026 with months 18 and 36 → May 2028).
 */
export function nextSurveillance(certified: Date, months: readonly number[], today: Date = new Date()): Date | null {
  const now = today.getFullYear() * 12 + today.getMonth();
  return [...months]
    .filter((m) => Number.isFinite(m) && m > 0)
    .sort((a, b) => a - b)
    .map((m) => addMonths(certified, m))
    .find((d) => d.getFullYear() * 12 + d.getMonth() >= now) ?? null;
}

/** "13 Nov 2031". */
export function shortDate(date: Date): string {
  return `${date.getDate()} ${SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

/** "May 2028". */
export function monthYear(date: Date): string {
  return `${SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

/** The same from api/public/levels (an enabled level), when the certification API did not give it; null without a validity. */
export function validityOf(level: PublicLevelTiming | object | null | undefined): LevelValidity | null {
  const l = level as PublicLevelTiming | null | undefined;
  if (!l || !l.validityMonths) return null;
  const s = l.surveillance;
  const n = s ? (s.count && s.count > 1 && s.intervalMonths ? s.count : 1) : 0;
  return {
    validityMonths: l.validityMonths,
    surveillanceMonths: s ? Array.from({ length: n }, (_, i) => s.firstDueMonths + i * (s.intervalMonths ?? 0)) : [],
  };
}
