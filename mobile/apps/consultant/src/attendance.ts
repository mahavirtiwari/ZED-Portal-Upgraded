import { formatDate } from '@zed/shared';
import type { Attendance, AttendanceData, AttendanceType } from './models';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * Gson's Date format of this app's AssessorDataAccessObject: setDateFormat(DateFormat.FULL), i.e. the US full date and
 * medium time, "Saturday, October 24, 2026 at 7:17:00 PM" (local time).
 */
export function gsonDate(d: Date): string {
  return `${formatDate(d, 'EEEE')}, ${formatDate(d, 'MMMM')} ${d.getDate()}, ${d.getFullYear()} at ${formatDate(d, 'h:mm:ss a')}`;
}

/**
 * Reads what the legacy app wrote: the full date with or without the weekday and "at" (Android versions differ, and
 * newer ones put a narrow no-break space before AM/PM), or an ISO date.
 */
export function parseGsonDate(s: string | null | undefined): number {
  if (!s) return 0;
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})[,\s]*(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])\.?\s*[Mm]/.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[1]!.toLowerCase());
    if (month >= 0) {
      let hour = Number(m[4]) % 12;
      if (m[7]!.toLowerCase() === 'p') hour += 12;
      return new Date(Number(m[3]), month, Number(m[2]), hour, Number(m[5]), Number(m[6] ?? 0)).getTime();
    }
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

export const timeOf = (a: Attendance): number => parseGsonDate(a.time);

const day = (t: number) => formatDate(new Date(t), 'yyyy-MM-dd');
const today = () => formatDate(new Date(), 'yyyy-MM-dd');

/** Utils.fmtTime "h:mm a" / fmtDate "dd/MM/yyyy". */
export const formatTime = (t: number) => formatDate(new Date(t), 'h:mm a');
export const formatDay = (t: number) => formatDate(new Date(t), 'dd/MM/yyyy');

export function newAttendance(selfie: Attendance['selfie'], comments: string | null, type: AttendanceType, now = new Date()): Attendance {
  return { selfie, comments, time: gsonDate(now), attendanceType: type, isSubmitted: false };
}

const isToday = (a: Attendance) => day(timeOf(a)) === today();

/** AttendanceData.getLoginEntryToday / getLogoutEntryToday */
export const loginEntryToday = (d: AttendanceData | null | undefined) => d?.attendanceList.find(a => isToday(a) && a.attendanceType === 'LOGIN') ?? null;
export const logoutEntryToday = (d: AttendanceData | null | undefined) => d?.attendanceList.find(a => isToday(a) && a.attendanceType === 'LOGOUT') ?? null;

export const isLoggedInToday = (d: AttendanceData | null | undefined) => loginEntryToday(d) != null;
export const isLoggedOutToday = (d: AttendanceData | null | undefined) => logoutEntryToday(d) != null;
/** isAttendanceDoneToday: punched in and out today. */
export const isAttendanceDoneToday = (d: AttendanceData | null | undefined) => isLoggedInToday(d) && isLoggedOutToday(d);

/** AttendanceData.addEntry: null when added, else the reason. */
export function addEntry(d: AttendanceData, a: Attendance): string | null {
  if (a.attendanceType === 'LOGIN' && isLoggedInToday(d)) return "Today's login already captured";
  if (a.attendanceType === 'LOGOUT' && isLoggedOutToday(d)) return "Today's logout already captured";
  d.attendanceList.push(a);
  return null;
}

export const anyPendingData = (d: AttendanceData) => d.attendanceList.some(a => !a.isSubmitted);

/** AttendanceLogFragment.AttendanceAdapter: one row per date. */
export type AttendanceLogRow = { date: number; loginDate: number | null; logoutDate: number | null; status: string };

export function attendanceLog(list: Attendance[]): AttendanceLogRow[] {
  const log: AttendanceLogRow[] = [];
  for (const item of list) {
    const t = timeOf(item);
    const row = log.find(r => formatDay(r.date) === formatDay(t));
    if (!row) {
      log.push({
        date: t,
        loginDate: item.attendanceType === 'LOGIN' ? t : null,
        logoutDate: item.attendanceType === 'LOGOUT' ? t : null,
        status: item.isSubmitted ? 'Synced' : 'Pending',
      });
    } else if (item.attendanceType === 'LOGIN') {
      row.loginDate = t;
    } else {
      row.logoutDate = t;
    }
  }
  return log;
}

export function totalHours(r: AttendanceLogRow): string {
  if (r.logoutDate == null || r.loginDate == null) return '';
  return `${Math.trunc((r.logoutDate - r.loginDate) / 1000 / 3600)} hrs`;
}
