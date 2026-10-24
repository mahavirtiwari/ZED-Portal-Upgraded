/**
 * The date formats of the legacy apps (java.text.SimpleDateFormat with Locale.ENGLISH / Locale.US), done in JS so
 * that they do not depend on the JS engine's Intl data. Only the pattern letters the apps use are supported:
 * yyyy MM MMM dd d EEEE HH hh h mm ss a.
 */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function formatDate(date: Date, pattern: string): string {
  return pattern.replace(/yyyy|MMMM|MMM|MM|dd|d|EEEE|EEE|HH|hh|h|mm|ss|a/g, token => {
    switch (token) {
      case 'yyyy':
        return String(date.getFullYear());
      case 'MMMM':
        return MONTHS[date.getMonth()]!;
      case 'MMM':
        return MONTHS[date.getMonth()]!.substring(0, 3);
      case 'MM':
        return pad(date.getMonth() + 1);
      case 'dd':
        return pad(date.getDate());
      case 'd':
        return String(date.getDate());
      case 'EEEE':
        return DAYS[date.getDay()]!;
      case 'EEE':
        return DAYS[date.getDay()]!.substring(0, 3);
      case 'HH':
        return pad(date.getHours());
      case 'hh':
        return pad(date.getHours() % 12 === 0 ? 12 : date.getHours() % 12);
      case 'h':
        return String(date.getHours() % 12 === 0 ? 12 : date.getHours() % 12);
      case 'mm':
        return pad(date.getMinutes());
      case 'ss':
        return pad(date.getSeconds());
      case 'a':
        return date.getHours() < 12 ? 'AM' : 'PM';
      default:
        return token;
    }
  });
}

/** BaseActivity.dateTimeFormat: the capture time shown under photos and stamped on them. */
export const PHOTO_TIMESTAMP_PATTERN = 'MMM dd, yyyy h:mm a';
/** Utils.getHeaderDate (toolbar date). */
export const HEADER_DATE_PATTERN = 'EEEE dd, MMM';

export function headerDate(now: Date = new Date()): string {
  return formatDate(now, HEADER_DATE_PATTERN);
}

/**
 * Utils.dateFormat "MM/dd/yyyy hh:mm:ss a" (.NET en-US, the default Mobile:Culture). Also accepts a missing
 * seconds/AM-PM part and ISO dates. Returns null when the text cannot be read (as Utils.parseDate).
 */
export function parseLegacyDate(text: string | null | undefined): Date | null {
  if (!text) return null;
  const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/);
  if (m) {
    let hours = Number(m[4] ?? 0);
    const ampm = m[7]?.toUpperCase();
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
    const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]), hours, Number(m[5] ?? 0), Number(m[6] ?? 0));
    return isNaN(d.getTime()) ? null : d;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const d = new Date(text);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Utils.isToday (yyyyMMdd comparison in local time). */
export function isToday(date: Date | null, now: Date = new Date()): boolean {
  if (!date) return false;
  return formatDate(date, 'yyyyMMdd') === formatDate(now, 'yyyyMMdd');
}
